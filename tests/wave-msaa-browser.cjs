// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function(browser,checks,errors,loader){
 const load=loader||((p)=>p.goto('http://127.0.0.1:8765/'));
 const capture=()=>{
  let C;Object.defineProperty(window,'C5Wave',{configurable:true,get:()=>C,set:Original=>{
   C=function(...args){const w=new Original(...args);window.msaaWave=w;return w;};C.prototype=Original.prototype;
  }});
  localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({motion:'reduced',waveSampling:1,waveParticles:false}));
 };
 async function page(width,init){
  const p=await browser.newPage({viewport:{width,height:width*9/16}});p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(capture);if(init)await p.addInitScript(init);await load(p,[capture,init].filter(Boolean));
  await p.waitForFunction(()=>window.msaaWave&&!['pending','compiling'].includes(msaaWave.mode),null,{timeout:15000});return p;
 }
 const output=path.resolve(__dirname,'../qa');fs.mkdirSync(output,{recursive:true});
 for(const width of [1280,1920]){
  const p=await page(width);
  try{
   const diag=()=>p.evaluate(()=>msaaWave.getDiagnostics());
   let d=await diag();assert.equal(d.contextVersion,2);assert.equal(d.pattern,'ps3');assert.equal(d.surface.msaaSamples,0);
   assert.ok(d.surface.msaaSupported.includes(4),'Test GPU needs 4x RGBA8 support');
   await p.getByRole('button',{name:'Settings',exact:true}).click();await p.getByRole('option',{name:'Waves',exact:true}).click();
   const group=p.getByRole('group',{name:'MSAA',exact:true});
   await group.getByRole('button',{name:'4×',exact:true}).click();d=await diag();
   assert.equal(d.surface.msaaSamples,4);assert.equal(d.surface.msaaFallback,null);assert.equal(d.surface.effectiveScale,1);
   assert.equal(await p.evaluate(()=>C5App.getState().preferences.waveMSAA),4);
   assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lg-xmb-preferences-v1')).waveMSAA),4);
   await p.screenshot({path:path.join(output,`msaa-settings-${width}.png`)});
   // Fractional and 2x supersampling can be combined deliberately; never set automatically.
   for(const sampling of [1,1.25,1.5,2]){
    await p.evaluate(s=>msaaWave.setQuality({msaa:4,sampling:s}),sampling);d=await diag();
    assert.equal(d.surface.msaaSamples,4);assert.equal(d.surface.effectiveScale,sampling);
    assert.equal(d.surface.surfaceWidth,width*sampling);assert.ok(d.surface.surfaceHeight<width*9/16*sampling);
    assert.equal(await p.evaluate(()=>msaaWave.gl.getError()),0);
   }
   await p.evaluate(()=>msaaWave.setQuality({msaa:4,sampling:1}));
   // 2x is offered only where the driver can allocate it. An unsupported level is
   // never rounded up, so offering it would render without MSAA at all.
   const twice=group.getByRole('button',{name:'2×',exact:true});
   if((await diag()).surface.msaaSupported.includes(2)){
    assert.equal(await twice.count(),1);
    await twice.click();d=await diag();
    assert.equal(d.surface.msaaSamples,2);assert.equal(d.surface.msaaFallback,null);
   } else assert.equal(await twice.count(),0);
   await group.getByRole('button',{name:'4×',exact:true}).click();
   // Still-frame toggles round-trip; independent of menus/text and particles.
   const pixels=()=>p.evaluate(()=>document.getElementById('wave').toDataURL());
   const before=await pixels(),at=await p.evaluate(()=>msaaWave.time);
   await group.getByRole('button',{name:'Off',exact:true}).click();const off=await pixels();assert.notEqual(off,before);
   assert.equal((await diag()).surface.msaaBytes,0);
   await group.getByRole('button',{name:'4×',exact:true}).click();assert.equal(await pixels(),before);
   await p.evaluate(()=>{msaaWave.setPaused(true);msaaWave.setQuality({msaa:0});});
   assert.equal((await diag()).surface.msaaSamples,4);assert.equal(await pixels(),before);
   await p.evaluate(()=>msaaWave.setPaused(false));assert.equal((await diag()).surface.msaaSamples,0);assert.equal(await pixels(),off);
   await p.evaluate(()=>{msaaWave.setQuality({msaa:4});window.hiddenMSAA=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hiddenMSAA});hiddenMSAA=true;document.dispatchEvent(new Event('visibilitychange'));msaaWave.setQuality({msaa:0});});
   assert.equal((await diag()).surface.msaaSamples,4);assert.equal(await p.evaluate(()=>msaaWave.raf),0);
   await p.evaluate(()=>{hiddenMSAA=false;document.dispatchEvent(new Event('visibilitychange'));});assert.equal((await diag()).surface.msaaSamples,0);
   await p.evaluate(()=>{msaaWave.setQuality({msaa:4});window.loseMSAA=msaaWave.gl.getExtension('WEBGL_lose_context');loseMSAA.loseContext();});
   await p.waitForFunction(()=>msaaWave.contextLost);await p.evaluate(()=>loseMSAA.restoreContext());
   await p.waitForFunction(()=>!msaaWave.contextLost&&msaaWave.mode==='webgl'&&msaaWave.getDiagnostics().surface.msaaSamples===4);
   assert.equal(await p.evaluate(()=>msaaWave.time),at);assert.equal(await pixels(),before);
   await p.keyboard.press('Escape');await p.evaluate(()=>msaaWave.setQuality({particles:true}));
   await p.screenshot({path:path.join(output,`msaa-waves-${width}.png`)});
   // All existing palette endpoints still render with multisampling active.
   for(let month=1;month<=12;month++)for(const period of ['day','night']){
    await p.evaluate(o=>msaaWave.setTheme({colors:{mode:'monthly',month:o.month,period:o.period}}),{month,period});
    assert.equal(await p.evaluate(()=>msaaWave.gl.getError()),0);
   }
   await p.evaluate(()=>msaaWave.destroy());assert.equal(await p.evaluate(()=>msaaWave.ps3Surface),null);
   checks.push(`MSAA ${width}: real WebGL2 4x resolve, all SSAA/palette modes, settings, frozen/hidden/paused/context lifecycle`);
  }finally{await p.close();}
 }
 for(const kind of ['webgl1','allocate','resolve']){
  const init=kind==='webgl1'?()=>{
   const orig=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){return t==='webgl2'?null:orig.call(this,t,...a);};
  }:kind==='allocate'?()=>{WebGL2RenderingContext.prototype.renderbufferStorageMultisample=function(){window.msaaFailures=(window.msaaFailures||0)+1;throw new Error('Test MSAA allocation refused');};}
  :()=>{WebGL2RenderingContext.prototype.blitFramebuffer=function(){window.msaaFailures=(window.msaaFailures||0)+1;throw new Error('Test MSAA resolve refused');};};
  const p=await page(1280,init);
  try{
   const off=await p.evaluate(()=>document.getElementById('wave').toDataURL());
   await p.evaluate(()=>msaaWave.setQuality({msaa:4}));
   const d=await p.evaluate(()=>msaaWave.getDiagnostics());assert.equal(d.pattern,'ps3');assert.equal(d.surface.msaaSamples,0);assert.ok(d.surface.msaaFallback);
   assert.equal(await p.evaluate(()=>document.getElementById('wave').toDataURL()),off,'Fallback must redraw, not present a stale MSAA resolve');
   const attempts=await p.evaluate(()=>window.msaaFailures||0);
   await p.evaluate(()=>{for(let n=0;n<4;n++)msaaWave._draw();});assert.equal(await p.evaluate(()=>window.msaaFailures||0),attempts);
   assert.equal(await p.evaluate(()=>msaaWave.gl.getError()),0);
   checks.push(`MSAA ${kind} refusal: intact single-sample PS3 rendering and no per-frame retry`);
  }finally{await p.close();}
 }
 const probe=await page(1280);
 try{
  const coverage=await probe.evaluate(()=>{
   const c=document.createElement('canvas');c.width=c.height=64;const gl=c.getContext('webgl2',{antialias:false});
   const program=gl.createProgram(),shaders=[];
   for(const [type,source] of [[gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}'],[gl.FRAGMENT_SHADER,'precision highp float;void main(){gl_FragColor=vec4(1.0);}']]){
    const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);gl.attachShader(program,s);
   }
   gl.linkProgram(program);gl.useProgram(program);
   const v=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,v);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-.93,-.7,.93,-.54,.73,.75]),gl.STATIC_DRAW);
   const at=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
   const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,64,64,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
   const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
   const m=LGXMBWaveMSAA.create(gl);const result=[];
   for(const n of [0,4]){
    const on=m.prepare(n,64,64);gl.bindFramebuffer(gl.FRAMEBUFFER,on?m.target():f);gl.viewport(0,0,64,64);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);
    if(on&&!m.resolve(f))throw new Error('Probe resolve failed');
    gl.bindFramebuffer(gl.FRAMEBUFFER,f);const data=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,data);
    let partial=0;for(let i=0;i<data.length;i+=4)if(data[i]>0&&data[i]<255)partial++;result.push(partial);
   }
   const error=gl.getError();m.destroy(false);gl.deleteFramebuffer(f);gl.deleteTexture(t);gl.deleteBuffer(v);gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));
   return {off:result[0],msaa4:result[1],error};
  });
  assert.equal(coverage.error,0);assert.equal(coverage.off,0);assert.ok(coverage.msaa4>20,JSON.stringify(coverage));
  checks.push('Real multisample triangle resolve produces fractional edge coverage: '+JSON.stringify(coverage));
 }finally{await probe.close();}
 assert.deepEqual(errors,[]);
};
