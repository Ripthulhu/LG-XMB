// SPDX-License-Identifier: GPL-3.0-or-later
// Source/method tests: no GPU, captured buffers, TV calls or frame timing claims.
'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),repo=fs.existsSync(path.join(root,'app'))?root:path.resolve(root,'..');
const source=fs.readFileSync(path.join(repo,'app/ps3-native-renderer.js'),'utf8');
const css=fs.readFileSync(path.join(repo,'app/style.css'),'utf8');
const shaders=require(path.join(repo,'app/ps3-native-shaders.js'));
function method(owner,name){
 const a=source.indexOf('  '+owner+'.prototype.'+name+' = function (');assert.ok(a>=0,name);
 const start=source.indexOf('function (',a),end=source.indexOf('\n  };',start);
 return Function('return ('+source.slice(start,end+4)+');')();
}
function wave(monthly){
 const attrs={},writes=[];
 const w={mode:'webgl',canvas:{setAttribute(k,v){attrs[k]=v;writes.push([k,v]);},removeAttribute(k){delete attrs[k];writes.push([k,null]);}}};
 w.syncBackgroundLayer=method('C5Wave','syncBackgroundLayer');w.syncBackgroundLayer(monthly);
 return {w,attrs,writes};
}
function terms(x,y){
 y=1-y;const halo=.05*Math.max(0,1-Math.hypot((x-.57)/.57,(y-.21)/.79)/(Math.SQRT2*.52));
 const shade=Math.max(.08*(1-y/.55),.22*(y-.55)/.45);return [(1-shade)*(1-halo),halo];
}
test('all three modified GLSL stages match the generated script',()=>{
 for(const name of ['compositeFragment','particleFragment','glareFragment']){
  assert.equal(shaders[name],fs.readFileSync(path.join(repo,'shaders',name+'.frag'),'utf8'));
  assert.ok(shaders[name].startsWith('#version 300 es\n'));
 }
});
test('all colour modes suppress the post-canvas CSS, but keep the PS3 marker specific',()=>{
 for(const monthly of [false,true]){
  const {attrs}=wave(monthly);assert.equal(attrs['data-background-composited'],'true');
  assert.equal(attrs['data-ps3-background'],monthly?'true':undefined);
 }
 assert.match(css,/#wave\[data-background-composited="true"\] \+ \.ambient\{display:none\}/);
});
test('same-mode redraws do not write DOM attributes every frame',()=>{
 const {w,writes}=wave(false),before=writes.length;
 for(let n=0;n<1000;n++)w.syncBackgroundLayer(false);
 assert.equal(writes.length,before);
 w.syncBackgroundLayer(true);assert.equal(writes.length,before+1);
 w.syncBackgroundLayer(false);assert.equal(writes.length,before+2);
});
test('static failure and destruction remove the general WebGL marker',()=>{
 for(const kind of ['static','destroyed']){
  const {w,attrs}=wave(true);
  if(kind==='static')w.mode='static';else w.destroyed=true;
  w.syncBackgroundLayer(false);assert.equal(attrs['data-background-composited'],undefined);
  assert.equal(attrs['data-ps3-background'],undefined);
 }
});
test('the same ambient terms are used for the composite and both particle passes',()=>{
 const take=s=>s.slice(s.indexOf('highp vec2 ambientTerms('),s.indexOf('\n}',s.indexOf('highp vec2 ambientTerms('))+2);
 const a=take(shaders.compositeFragment);assert.ok(a.length>200);
 for(const n of ['particleFragment','glareFragment'])assert.equal(take(shaders[n]),a);
});
test('vignette/halo terms reproduce the CSS corner and center values without quantization',()=>{
 assert.deepEqual(terms(0,1-.55),[1,0]); // outside the halo and vignette zero
 assert.ok(Math.abs(terms(.57,1-.21)[1]-.05)<1e-12);
 assert.ok(Math.abs(terms(0,0)[0]-.78)<1e-12);
 for(let y=0;y<=100;y++)for(let x=0;x<=100;x++){
  const [a,h]=terms(x/100,y/100);assert.ok(a>=.77&&a<=1);assert.ok(h>=0&&h<=.05);
 }
});
test('additive particle light gets transmission only, without repeating the white halo',()=>{
 for(const n of ['particleFragment','glareFragment']){
  const s=shaders[n];assert.match(s,/outColor\.rgb \*= ambientTerms\(gl_FragCoord\.xy\*uAmbientInvSize\)\.x/);
  assert.ok(s.indexOf('discard;')<s.indexOf('outColor.rgb *= ambientTerms'));
  assert.doesNotMatch(s,/outColor\.a\s*\*=/);
 }
 for(let i=0;i<100;i++){
  const [a,h]=terms((i*.618)%1,(i*.37)%1),base=.13,light=.27;
  assert.ok(Math.abs(((base+light)*a+h)-((base*a+h)+light*a))<1e-15);
 }
});
test('particle uniforms use actual output resolution and are off for PS3-original frames',()=>{
 for(const [monthly,width,height] of [[false,1920,1080],[false,1280,720],[true,1920,1080]]){
  const calls=[],gl={useProgram(){},bindVertexArray(){},uniform4fv(){},uniform1f(){},activeTexture(){},bindTexture(){},drawArraysInstanced(){},
    uniform1i:(u,v)=>calls.push([u,v]),uniform2f:(u,x,y)=>calls.push([u,x,y])};
  const r={gl,monthlyActive:monthly,outputWidth:width,outputHeight:height,material:{uModelviewProjection:new Float32Array(16)},
   materialRows:new Float32Array(16),simulation:{reference:{particleMaterial:{'iridescent exp':1}}}};
  method('Renderer','particlePass').call(r,{}, {uAmbientEnabled:'ambient',uAmbientInvSize:'size'},width/height,1);
  assert.ok(calls.some(x=>x[0]==='ambient'&&x[1]===(monthly?0:1)));
  assert.ok(calls.some(x=>x[0]==='size'&&x[1]===1/width&&x[2]===1/height));
 }
});
test('compositor sets the same mode flag and applies decoration before its existing dither',()=>{
 assert.match(source,/gl\.uniform1i\(u\.uAmbientEnabled, monthly \? 0 : 1\)/);
 const s=shaders.compositeFragment,a=s.indexOf('rgb=rgb*ambient.x+ambient.y;');
 assert.ok(a>s.indexOf('highp vec3 displayColour'));
 assert.ok(a<s.indexOf('return clamp(rgb+noise*amount'));
 assert.match(s,/precision mediump float;/);assert.match(s,/float m=signalAt\(vUV\);/);
 assert.match(s,/highp float d=\(n0\+n1-1\.0\)\/255\.0;/);
});
test('diagnostics identify the actual pre-dither pipeline',()=>{
 assert.match(source,/pipelineRevision: 'ambient-before-dither-1'/);
 assert.match(source,/ambientStage: this\.monthlyActive \? 'none' : 'pre-dither'/);
});
