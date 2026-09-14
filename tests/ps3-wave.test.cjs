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
function fakeGL({link=true, framebuffer=true}={}) {
  const calls=[],live=new Set(); let next=0;
  const gl = new Proxy({}, {get(target,key) {
    if (key in target) return target[key];
    if (/^[A-Z_0-9]+$/.test(key)) return key;
    if (key.startsWith('create')) return () => {const value={id:++next,kind:key};live.add(value);return value;};
    if (key.startsWith('delete')) return value => {assert.ok(live.delete(value), 'No resource double-delete');calls.push([key,value]);};
    return (...args) => {calls.push([key,...args]);};
  }});
  Object.assign(gl,{
    getProgramParameter:()=>link, getShaderParameter:()=>link,
    getProgramInfoLog:()=> 'simulated shader failure', getShaderInfoLog:()=> 'simulated compile failure',
    getAttribLocation:(_p,name)=>name==='aNormal'?1:0, getUniformLocation:(_p,name)=>name,
    checkFramebufferStatus:()=>framebuffer?'FRAMEBUFFER_COMPLETE':'FRAMEBUFFER_UNSUPPORTED'
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
  for(const pair of [[0,48],[128,0],[193,48],[128,65],[NaN,48],[128.5,48]])assert.throws(()=>api.createGeometry(...pair));
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
test('Mesh uses RGBA8, bounded surfaces and uploads geometry only when time changes',()=>{
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
test('PS3 surface is native at 1080p and capped on larger viewports',()=>{
  const h=fakeGL(),renderer=api.create(h.gl,'highp');renderer.finish();
  for (const [w,height,expectedWidth,expectedHeight] of [
    [1280,720,1280,720],[1920,1080,1920,1080],[3840,2160,1920,1080],[960,540,960,540]
  ]) {
    renderer.draw(14,[0.5,0.5,1],1,w,height);
    const diag=renderer.diagnostics();
    assert.equal(diag.surfaceWidth,expectedWidth);assert.equal(diag.surfaceHeight,expectedHeight);
    const allocation=h.calls.filter(c=>c[0]==='texImage2D').at(-1);
    assert.deepEqual(allocation.slice(4,6),[expectedWidth,expectedHeight]);
  }
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
