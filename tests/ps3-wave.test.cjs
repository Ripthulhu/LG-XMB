'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../app/ps3-wave.js'),'utf8');
const window = {};
vm.runInNewContext(source,{window,console});
const api = window.LGXMBPS3Wave;
function fakeGL({link=true, framebuffer=true, maxTexture=4096, maxViewport=[4096,4096], failAbove=Infinity, outOfMemory=false}={}) {
  const calls=[],live=new Set(); let next=0, allocationWidth=0;
  const gl = new Proxy({}, {get(target,key) {
    if (key in target) return target[key];
    if (/^[A-Z_0-9]+$/.test(key)) return key;
    if (key.startsWith('create')) return () => {const value={id:++next,kind:key};live.add(value);return value;};
    if (key.startsWith('delete')) return value => {assert.ok(live.delete(value), 'No resource double-delete');calls.push([key,value]);};
    return (...args) => {calls.push([key,...args]);};
  }});
  Object.assign(gl,{
    getParameter:key=>key==='MAX_TEXTURE_SIZE'?maxTexture:maxViewport,
    texImage2D:(...args)=>{allocationWidth=args[3];calls.push(['texImage2D',...args]);},
    getError:()=>outOfMemory&&allocationWidth>failAbove?'OUT_OF_MEMORY':'NO_ERROR',
    getProgramParameter:()=>link, getShaderParameter:()=>link,
    getProgramInfoLog:()=> 'simulated shader failure', getShaderInfoLog:()=> 'simulated compile failure',
    getAttribLocation:(_p,name)=>name==='aNormal'?1:0, getUniformLocation:(_p,name)=>name,
    checkFramebufferStatus:()=>framebuffer&&(outOfMemory||allocationWidth<=failAbove)?'FRAMEBUFFER_COMPLETE':'FRAMEBUFFER_UNSUPPORTED'
  });
  return {gl,calls,live};
}
test('PS3 mesh fits unsigned-short indices and reuses its CPU buffers',()=>{
  const mesh=api.createGeometry(128,48), vertices=mesh.vertices, indices=mesh.indices;
  assert.equal(vertices.length,129*49*7);assert.equal(indices.length,128*48*6);
  assert.ok(Math.max(...indices)<vertices.length/7);
  mesh.update(14);mesh.update(14.035);
  assert.equal(mesh.vertices,vertices);assert.equal(mesh.indices,indices);
});
test('PS3 geometry rejects unbounded grids and invalid times',()=>{
  for(const pair of [[0,48],[128,0],[385,48],[128,129],[NaN,48],[128.5,48]])assert.throws(()=>api.createGeometry(...pair));
  const mesh=api.createGeometry(32,16);
  for(const t of [-1,NaN,Infinity,'14'])assert.throws(()=>mesh.update(t));
});
test('PS3 spline samples stay finite, continuous and have unit normals',()=>{
  const mesh=api.createGeometry(128,48);
  for(const time of [0,0.035,14,70,300,86400]){
    mesh.update(time);const v=mesh.vertices;
    assert.ok(v.every(Number.isFinite));
    for(let i=0;i<v.length;i+=7){
      assert.ok(Math.abs(v[i])<=1 && Math.abs(v[i+1])<0.5 && Math.abs(v[i+2])<1.2);
      assert.ok(Math.abs(Math.hypot(v[i+4],v[i+5],v[i+6])-1)<1e-5);
      if(i/7%129<128)assert.ok(Math.abs(v[i+1]-v[i+8])<0.05);
    }
  }
});
test('Repainting the same time does not advance smoothing or change a still',()=>{
  const mesh=api.createGeometry(32,16);mesh.update(14);
  const before=Array.from(mesh.vertices),kernel=Array.from(mesh.kernel);
  for(let i=0;i<10;i++)assert.equal(mesh.update(14),false);
  assert.deepEqual(Array.from(mesh.vertices),before);assert.deepEqual(Array.from(mesh.kernel),kernel);
});
test('Independent spline instances and an explicit rewind are deterministic',()=>{
  const a=api.createGeometry(32,16),b=api.createGeometry(32,16);
  for(const time of [14,14.035,14.07,15]){a.update(time);b.update(time);assert.deepEqual(a.vertices,b.vertices);}
  a.update(0);const fresh=api.createGeometry(32,16);fresh.update(0);assert.deepEqual(a.vertices,fresh.vertices);
});
test('Mesh renders full HD in RGBA8 and uploads geometry only when time changes',()=>{
  const h=fakeGL(),renderer=api.create(h.gl,'highp');renderer.finish();
  renderer.draw(14,[0.5,0.5,1],1,1920,1080);
  const diag=renderer.diagnostics();assert.equal(diag.surfaceWidth,1920);assert.equal(diag.surfaceHeight,1080);
  assert.equal(diag.floatTextures,false);
  renderer.draw(14,[1,0.5,0.5],0.6,1920,1080);
  assert.equal(h.calls.filter(c=>c[0]==='bufferSubData').length,1);
  assert.equal(h.calls.filter(c=>c[0]==='texImage2D').length,1);
  renderer.draw(14.035,[1,0.5,0.5],1,960,540);
  assert.equal(h.calls.filter(c=>c[0]==='bufferSubData').length,2);
  assert.equal(renderer.diagnostics().surfaceWidth,960);
  assert.ok(h.calls.filter(c=>c[0]==='texImage2D').every(c=>c[3]==='RGBA'&&c[8]==='UNSIGNED_BYTE'));
  renderer.destroy(false);assert.equal(h.live.size,0);renderer.destroy(false);
});
test('Spline surface matches smaller viewports, caps 4K at 1080p and reuses unchanged allocations',()=>{
  const h=fakeGL(),renderer=api.create(h.gl,'highp');renderer.finish();
  for (const [width,height,expectedWidth,expectedHeight] of [
    [1280,720,1280,720],[1920,1080,1920,1080],[3840,2160,1920,1080],[960,540,960,540]
  ]) {
    renderer.draw(14,[1,1,1],1,width,height);
    const diag=renderer.diagnostics();
    assert.equal(diag.surfaceWidth,expectedWidth);assert.equal(diag.surfaceHeight,expectedHeight);
  }
  assert.equal(h.calls.filter(c=>c[0]==='texImage2D').length,3,'A 4K request reuses the full-HD surface');
  assert.equal(h.calls.filter(c=>c[0]==='bufferSubData').length,1,'Resolution changes do not advance the simulation');
  renderer.destroy(false);assert.equal(h.live.size,0);
});
test('Compilation failure releases every allocated shader and program',()=>{
  const h=fakeGL({link:false}),renderer=api.create(h.gl,'mediump');
  assert.throws(()=>renderer.finish(),/shader failure/);renderer.destroy(false);assert.equal(h.live.size,0);
});
test('Framebuffer refusal is observable and its resources can all be released',()=>{
  const h=fakeGL({framebuffer:false}),renderer=api.create(h.gl,'highp');renderer.finish();
  assert.throws(()=>renderer.draw(0,[1,1,1],1,1280,720),/framebuffer unavailable/);
  assert.ok(h.calls.some(c=>c[0]==='bindFramebuffer'&&c[2]===null));
  renderer.destroy(false);assert.equal(h.live.size,0);
});
test('Context-loss cleanup makes no GL calls and stops later draws',()=>{
  const h=fakeGL(),renderer=api.create(h.gl,'highp');renderer.finish();
  const before=h.calls.length;renderer.destroy(true);renderer.draw(0,[1,1,1],1,1280,720);
  assert.equal(h.calls.length,before);
});
test('The renderer has no network, storage, TV bridge or WebGL 2 dependency',()=>{
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|localStorage|PalmServiceBridge|luna-send|createVertexArray)\b/);
  assert.doesNotMatch(source,/#version 300|\bR32F\b|dFdx|dFdy/);
  assert.match(fs.readFileSync(path.join(__dirname,'../app/licenses/PS3-XMB-MIT.txt'),'utf8'),/Copyright \(c\) 2025 Mart/);
});

test('Supersampling uses bounded dimensions and linear filtering at every preset',()=>{
  const h=fakeGL(),renderer=api.create(h.gl,'highp');renderer.finish();
  for (const sampling of [1,1.25,1.5,2]) {
    renderer.configure({sampling});renderer.draw(14,[1,1,1],1,1920,1080);
    const d=renderer.diagnostics();assert.equal(d.surfaceWidth,1920*sampling);assert.equal(d.surfaceHeight,1080*sampling);
    assert.equal(d.requestedScale,sampling);assert.equal(d.effectiveScale,sampling);assert.equal(d.samplingFallback,null);
  }
  assert.ok(h.calls.filter(c=>c[0]==='texParameteri'&&/FILTER$/.test(c[2])).every(c=>c[3]==='LINEAR'));
  renderer.configure({sampling:2});renderer.draw(14,[1,1,1],1,7680,4320);
  assert.equal(renderer.diagnostics().surfaceWidth,3840);assert.equal(renderer.diagnostics().surfaceHeight,2160);
  renderer.destroy(false);assert.equal(h.live.size,0);
});
test('GPU limits, incomplete FBOs and OOM reduce sampling without retrying every frame',()=>{
  for(const options of [{maxTexture:2048},{maxViewport:[2048,2048]},{failAbove:2600},{failAbove:2600,outOfMemory:true}]) {
    const h=fakeGL(options),renderer=api.create(h.gl,'highp',{sampling:1.5});renderer.finish();
    renderer.draw(14,[1,1,1],1,1920,1080);
    const d=renderer.diagnostics();assert.equal(d.requestedScale,1.5);assert.ok(d.effectiveScale<=1.25);assert.ok(d.samplingFallback);
    const allocations=h.calls.filter(c=>c[0]==='texImage2D').length;
    renderer.draw(14.03,[1,1,1],1,1920,1080);renderer.configure({softness:0});renderer.draw(14.06,[1,1,1],1,1920,1080);
    assert.equal(h.calls.filter(c=>c[0]==='texImage2D').length,allocations);
    renderer.destroy(false);assert.equal(h.live.size,0);
  }
});
test('A failed upgrade reuses a valid lower-resolution surface and can be retried explicitly',()=>{
  const h=fakeGL({failAbove:1920}),renderer=api.create(h.gl,'highp');renderer.finish();
  renderer.draw(14,[1,1,1],1,1920,1080);renderer.configure({sampling:1.5});renderer.draw(14,[1,1,1],1,1920,1080);
  assert.equal(renderer.diagnostics().effectiveScale,1);assert.equal(renderer.diagnostics().requestedScale,1.5);
  const count=h.calls.filter(c=>c[0]==='texImage2D').length;
  renderer.draw(15,[1,1,1],1,1920,1080);assert.equal(h.calls.filter(c=>c[0]==='texImage2D').length,count);
  renderer.configure({sampling:1});renderer.draw(15,[1,1,1],1,1920,1080);
  renderer.configure({sampling:1.5});renderer.draw(15,[1,1,1],1,1920,1080);
  assert.ok(h.calls.filter(c=>c[0]==='texImage2D').length>count);
  renderer.destroy(false);assert.equal(h.live.size,0);
});
test('Mesh presets remain within 16-bit indices and settings changes retain spline state',()=>{
  const h=fakeGL(),renderer=api.create(h.gl,'highp');renderer.finish();renderer.draw(14,[1,1,1],1,1920,1080);
  renderer.draw(14.03,[1,1,1],1,1920,1080);
  for(const [detail,columns,rows] of [['standard',128,48],['high',256,96],['fine',384,128]]) {
    renderer.configure({detail});renderer.draw(14.03,[1,1,1],1,1920,1080);
    const d=renderer.diagnostics();assert.equal(d.vertices,(columns+1)*(rows+1));assert.equal(d.triangles,columns*rows*2);
    const mesh=api.createGeometry(columns,rows);mesh.update(14);
    assert.ok(mesh.indices.every(i=>i<65535&&i<d.vertices));assert.ok(mesh.vertices.every(Number.isFinite));
  }
  const allocations=h.calls.filter(c=>c[0]==='bufferData').length;
  renderer.draw(14.03,[1,1,1],1,1920,1080);assert.equal(h.calls.filter(c=>c[0]==='bufferData').length,allocations);
  renderer.destroy(false);assert.equal(h.live.size,0);
});
test('Quality values are validated independently and configuring never allocates GPU resources',()=>{
  const h=fakeGL(),renderer=api.create(h.gl,'highp',{sampling:1.5,detail:'high',softness:0.75});renderer.finish();
  const before=h.calls.length;
  renderer.configure({sampling:Infinity,detail:'__proto__',softness:'1.5'});assert.equal(h.calls.length,before);
  renderer.draw(14,[1,1,1],1,1920,1080);let d=renderer.diagnostics();
  assert.equal(d.requestedScale,1.5);assert.equal(d.detail,'high');assert.equal(d.softness,0.75);
  for (const softness of [0,0.75,1.5]) {
    renderer.configure({softness});renderer.draw(14,[1,1,1],1,1920,1080);
    const call=h.calls.filter(c=>c[0]==='uniform2f').at(-1);
    assert.equal(call[2],Math.max(softness,0.5)/1920);
    assert.equal(renderer.diagnostics().softness,softness);
  }
  renderer.destroy(false);assert.equal(h.live.size,0);
});

test('Retessellating at a frozen time keeps the temporal kernel and shared samples',()=>{
  const coarse=api.createGeometry(128,48);coarse.update(14);coarse.update(14.03);
  const dense=api.createGeometry(256,96);dense.kernel.set(coarse.kernel);dense.time=coarse.time;
  dense.update(coarse.time);assert.deepEqual(dense.kernel,coarse.kernel);
  for(let row=0;row<=48;row++)for(let col=0;col<=128;col++) {
    const a=(row*129+col)*7,b=(row*2*257+col*2)*7;
    assert.ok(Math.abs(coarse.vertices[a+1]-dense.vertices[b+1])<1e-6);
  }
});

test('A missing or refused post-process leaves the PS3 surface usable and reports fallback',()=>{
  const h=fakeGL(),renderer=api.create(h.gl,'highp',{postprocess:'fxaa'});renderer.finish();
  renderer.draw(14,[1,1,1],1,1920,1080);
  assert.equal(renderer.diagnostics().postprocess,'off');assert.match(renderer.diagnostics().postprocessFallback,/module unavailable/);
  assert.equal(renderer.diagnostics().surfaceWidth,1920);renderer.destroy(false);assert.equal(h.live.size,0);
});
test('Post-process presets validate independently from retained sampling and geometry',()=>{
  const q=api.quality({sampling:2,detail:'fine',postprocess:'wave',strength:'strong'});
  const next=api.quality({postprocess:'__proto__',strength:Infinity},q);
  assert.equal(next.sampling,2);assert.equal(next.detail,'fine');assert.equal(next.postprocess,'wave');assert.equal(next.strength,'strong');
});
