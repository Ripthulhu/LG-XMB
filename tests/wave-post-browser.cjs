'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
// CI loads the packaged page normally. The optional loader is for offline shader tests.
module.exports=async function checkWavePost(browser,checks,errors,loader) {
  const load=loader||((p)=>p.goto('http://127.0.0.1:8765/'));
  const capture=()=>{
    let constructor;
    Object.defineProperty(window,'C5Wave',{configurable:true,get:()=>constructor,set:original=>{
      constructor=function(c,o){const w=new original(c,o);window.postTestWave=w;return w;};constructor.prototype=original.prototype;
    }});
  };
  const prefs=()=>{if(!localStorage.getItem('lg-xmb-preferences-v1'))localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({motion:'reduced',theme:'ocean',previewMode:'live',waveSampling:2,waveDetail:'fine',waveSoftness:0}));};
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.on('pageerror',e=>errors.push(e.message));
  const image=()=>page.evaluate(()=>document.getElementById('wave').toDataURL());
  const diag=()=>page.evaluate(()=>postTestWave.getDiagnostics());
  try {
    await page.addInitScript(capture);await page.addInitScript(prefs);await load(page,[capture,prefs]);
    await page.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');
    await page.evaluate(()=>{postTestWave.time=14;postTestWave._draw();});
    let d=await diag();assert.equal(d.surface.postprocess,'wave');assert.equal(d.surface.strength,'strong');
    assert.deepEqual([d.surface.postWidth,d.surface.postHeight,d.backingWidth,d.backingHeight],[1920,d.surface.bandHeight,1920,1080]);
    assert.equal(d.surface.surfaceWidth,3840);assert.equal(d.surface.virtualHeight,2160);assert.ok(d.surface.surfaceHeight<2160);
    const geometry=await page.locator('#categories').boundingBox();
    const frames={};
    for(const mode of ['off','fxaa','wave']) {
      await page.evaluate(mode=>postTestWave.setQuality({postprocess:mode}),mode);
      frames[mode]=await image();assert.equal((await diag()).surface.postprocess,mode);
      assert.equal(await page.evaluate(()=>postTestWave.time),14);assert.equal(await page.evaluate(()=>postTestWave.gl.getError()),0);
      await page.screenshot({path:path.resolve(__dirname,`../qa/ps3-waves-filter-${mode}.png`)});
    }
    assert.notEqual(frames.fxaa,frames.off);assert.notEqual(frames.wave,frames.off);
    await page.evaluate(()=>postTestWave.setQuality({postprocess:'fxaa'}));assert.equal(await image(),frames.fxaa);
    // The captured frame used the default strength, so end the sweep back on it.
    for(const strength of ['gentle','normal','strong'])await page.evaluate(strength=>postTestWave.setQuality({strength}),strength);
    assert.equal(await image(),frames.fxaa,'Changing strength never advances a frozen spline');
    assert.deepEqual(await page.locator('#categories').boundingBox(),geometry);
    await page.evaluate(()=>{postTestWave.setPaused(true);postTestWave.setQuality({postprocess:'wave'});});
    assert.equal(await image(),frames.fxaa);assert.equal((await diag()).surface.postprocess,'fxaa');
    await page.evaluate(()=>postTestWave.setPaused(false));assert.equal(await image(),frames.wave);
    await page.evaluate(()=>{
      window.postHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>postHidden});document.dispatchEvent(new Event('visibilitychange'));
      postTestWave.setQuality({postprocess:'off'});
    });
    assert.equal((await diag()).surface.postprocess,'wave');assert.equal(await image(),frames.wave);
    await page.evaluate(()=>{postHidden=false;document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await image(),frames.off);
    await page.evaluate(()=>postTestWave.setQuality({postprocess:'fxaa'}));
    await page.evaluate(()=>{window.postLoss=postTestWave.gl.getExtension('WEBGL_lose_context');postLoss.loseContext();});
    await page.waitForFunction(()=>postTestWave.contextLost);assert.equal(await page.evaluate(()=>postTestWave.raf),0);
    await page.evaluate(()=>postLoss.restoreContext());
    await page.waitForFunction(()=>!postTestWave.contextLost&&postTestWave.getDiagnostics().surface&&postTestWave.getDiagnostics().surface.postprocess==='fxaa');
    d=await diag();assert.deepEqual([d.surface.postWidth,d.surface.postHeight],[1920,d.surface.bandHeight]);
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    const group=name=>page.getByRole('group',{name,exact:true});
    await group('Post-process antialiasing').getByRole('button',{name:'Wave FXAA',exact:true}).click();
    await group('Smoothing strength').getByRole('button',{name:'Strong',exact:true}).click();
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('lg-xmb-preferences-v1')));
    assert.equal(stored.wavePostprocess,'wave');assert.equal(stored.waveSmoothing,'strong');assert.equal(stored.waveSampling,2);assert.equal(stored.previewMode,'live');
    assert.ok((await page.locator('#waveRenderStatus').innerText()).includes('Wave FXAA at 1920 × '+(await diag()).surface.bandHeight));
    for(const width of [1920,1280]) {
      await page.setViewportSize({width,height:width*9/16});
      await group('Smoothing strength').getByRole('button',{name:'Strong',exact:true}).focus();
      await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>C5App.getState().preferences.waveSmoothing),'normal');
      assert.ok(await page.evaluate(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
      await page.screenshot({path:path.resolve(__dirname,`../qa/ps3-waves-post-settings-${width}.png`)});
      await group('Smoothing strength').getByRole('button',{name:'Strong',exact:true}).click();
    }
    // Reload with real saved preferences in CI; preserve equivalent input offline.
    if(!loader) {
      await page.reload();await page.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');
      assert.equal((await diag()).surface.postprocess,'wave');assert.equal((await diag()).surface.strength,'strong');
      await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('lg-xmb-preferences-v1'));p.wavePostprocess='__proto__';p.waveSmoothing=5;localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify(p));});
      await page.reload();await page.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');
      assert.equal((await diag()).surface.postprocess,'wave');assert.equal((await diag()).surface.strength,'strong');
      assert.equal((await diag()).surface.requestedScale,2);
    }
    // A synthetic stair edge must acquire fractional coverage, not just a new size.
    const synthetic=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=96;c.height=64;
      const gl=c.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
      const post=LGXMBWavePost.create(gl,'highp');post.prepare(96,64);
      gl.bindFramebuffer(gl.FRAMEBUFFER,post.target());
      const texture=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);
      const input=new Uint8Array(96*64*4);
      for(let y=0;y<64;y++)for(let x=0;x<96;x++) {
        const on=y<x*0.37+12,i=(y*96+x)*4;input.set(on?[220,220,220,255]:[20,20,20,0],i);
      }
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,96,64,0,gl.RGBA,gl.UNSIGNED_BYTE,input);
      post.render('wave','normal');const pixels=new Uint8Array(input.length);gl.readPixels(0,0,96,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let intermediate=0,opaque=true;for(let i=0;i<pixels.length;i+=4){if(pixels[i]>20&&pixels[i]<220)intermediate++;opaque=opaque&&pixels[i+3]===255;}
      const result={intermediate,opaque,white:pixels[0],dark:pixels[(63*96)*4],error:gl.getError()};post.destroy(false);gl.getExtension('WEBGL_lose_context').loseContext();return result;
    });
    assert.ok(synthetic.intermediate>20);assert.equal(synthetic.opaque,true);assert.equal(synthetic.white,220);assert.equal(synthetic.dark,20);assert.equal(synthetic.error,0);
    await page.evaluate(()=>postTestWave.destroy());assert.equal((await diag()).surface,null);
    checks.push('Output-space FXAA and wave-opacity mode: real edge smoothing, fixed-frame round trips, preserved supersampling, pause/hidden/context recovery, saved controls and D-pad scrolling');
  } finally {await page.close();}
  for(const kind of ['allocation','shader']) {
    const p=await browser.newPage({viewport:{width:1920,height:1080}});p.on('pageerror',e=>errors.push(e.message));
    const inject=kind==='allocation'?()=>{
      const old=HTMLCanvasElement.prototype.getContext;window.postRefusals=0;
      HTMLCanvasElement.prototype.getContext=function(...args){const gl=old.apply(this,args);if(!gl||!/webgl/.test(args[0]))return gl;
        const image=gl.texImage2D.bind(gl),getError=gl.getError.bind(gl);let failed=false;
        gl.texImage2D=function(...a){if(a[3]===1920){failed=true;postRefusals++;return;}return image(...a);};
        gl.getError=function(){if(failed){failed=false;return gl.OUT_OF_MEMORY;}return getError();};return gl;};
    }:()=>{
      const old=HTMLCanvasElement.prototype.getContext;window.postRefusals=0;
      HTMLCanvasElement.prototype.getContext=function(...args){const gl=old.apply(this,args);if(!gl||!/webgl/.test(args[0]))return gl;
        const shader=gl.shaderSource.bind(gl),attach=gl.attachShader.bind(gl),query=gl.getProgramParameter.bind(gl),marked=new Set(),programs=new Set();
        gl.shaderSource=(s,src)=>{if(src.includes('uniform bool uCoverage'))marked.add(s);return shader(s,src);};
        gl.attachShader=(p,s)=>{if(marked.has(s))programs.add(p);return attach(p,s);};
        gl.getProgramParameter=(p,k)=>{if(programs.has(p)&&k===gl.LINK_STATUS){postRefusals++;return false;}return query(p,k);};return gl;};
    };
    try {
      const quiet=()=>localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({motion:'reduced'}));
      for(const init of [capture,quiet,inject])await p.addInitScript(init);
      await load(p,[capture,quiet,inject]);await p.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');
      const d=await p.evaluate(()=>postTestWave.getDiagnostics());assert.equal(d.pattern,'ps3');assert.equal(d.surface.postprocess,'off');assert.match(d.surface.postprocessFallback,/refused/);
      const attempts=await p.evaluate(()=>postRefusals);await p.evaluate(()=>{for(let i=0;i<3;i++)postTestWave._draw();});assert.equal(await p.evaluate(()=>postRefusals),attempts);
      assert.equal(await p.locator('#items').isVisible(),true);assert.equal(await p.evaluate(()=>C5App.getState().preferences.wavePostprocess),'wave');
      checks.push('Optional FXAA '+kind+' refusal keeps PS3 waves, reports fallback and does not retry every frame');
    } finally {await p.close();}
  }
  assert.deepEqual(errors,[]);
};
