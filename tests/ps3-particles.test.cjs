'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root={};
const source=fs.readFileSync(path.join(__dirname,'../app/ps3-particles.js'),'utf8');
vm.runInNewContext(source,{window:root});
const api=root.LGXMBPS3Particles;
function fakeGL(options={}){
  const live=new Set(),calls=[];let id=0;
  const gl=new Proxy({},{get(target,key){
    if(key in target)return target[key];
    if(/^[A-Z_0-9]+$/.test(key))return key;
    if(key.startsWith('create'))return()=>{const v={id:++id};live.add(v);return v;};
    if(key.startsWith('delete'))return v=>{assert.ok(live.delete(v),'each GL object deleted once');calls.push([key,v]);};
    return(...a)=>calls.push([key,...a]);
  }});
  Object.assign(gl,{
    getProgramParameter:()=>!options.refuseShader,
    getParameter:()=>options.range||[1,64],
    getAttribLocation:()=>0,getUniformLocation:(_,n)=>n,
    getError:()=>options.oom?'OUT_OF_MEMORY':'NO_ERROR',isContextLost:()=>false
  });
  return{gl,live,calls};
}
test('reference particle seed distribution is bounded, independent and deterministic',()=>{
  const a=api.createSeeds(),b=api.createSeeds();assert.notEqual(a,b);assert.deepEqual(a,b);
  assert.equal(a.length,12000);assert.equal(a.byteLength,48000);
  for(let i=0;i<a.length;i+=3){assert.ok(a[i]>=0&&a[i]<1);assert.ok(a[i+1]>=0&&a[i+1]<1);assert.ok(a[i+2]>=0.1-1e-7&&a[i+2]<=1.1);}
});
test('particle density, time and brightness change only uniforms/draw count, not storage',()=>{
  const h=fakeGL(),layer=api.create(h.gl,'highp');
  for(const count of [500,2000,4000])layer.draw(14,1920,1080,[0.5,0.6,1],1,count);
  assert.equal(h.calls.filter(c=>c[0]==='bufferData').length,1);
  assert.deepEqual(h.calls.filter(c=>c[0]==='drawArrays').map(c=>c.slice(1)),[['POINTS',0,500],['POINTS',0,2000],['POINTS',0,4000]]);
  assert.ok(h.calls.some(c=>c[0]==='blendFuncSeparate'&&c.slice(1).join()==='ONE,ONE,ZERO,ONE'));
  layer.draw(14,1280,720,[1,1,1],0.6,2000);
  assert.equal(h.calls.filter(c=>c[0]==='uniform1f'&&c[1]==='uSizeScale').at(-1)[2],720/1080);
  layer.destroy(false);layer.destroy(false);assert.equal(h.live.size,0);
});
test('point range is supplied by GPU and unreasonable draw inputs are rejected',()=>{
  const h=fakeGL({range:[1,2]}),layer=api.create(h.gl,'mediump');layer.draw(14,1920,1080,[1,1,1],1,500);
  assert.deepEqual(h.calls.filter(c=>c[0]==='uniform2f').at(-1),['uniform2f','uPointRange',1,2]);
  for(const count of [-1,0,100000,NaN,Infinity])assert.throws(()=>layer.draw(14,1920,1080,[1,1,1],1,count),/Invalid/);
  assert.throws(()=>layer.draw(NaN,1920,1080,[1,1,1],1,500),/Invalid/);
  layer.destroy(false);assert.equal(h.live.size,0);
});
test('optional particle shader/buffer refusal does not leak resources',()=>{
  for(const options of [{refuseShader:true},{oom:true},{range:[0,0]}]){
    const h=fakeGL(options);assert.throws(()=>api.create(h.gl,'highp'),/Particle/);assert.equal(h.live.size,0);
  }
});
test('lost-context particle cleanup performs no GL calls and prevents later drawing',()=>{
  const h=fakeGL(),layer=api.create(h.gl,'highp');const before=h.calls.length;
  layer.destroy(true);layer.draw(14,1920,1080,[1,1,1],1,500);assert.equal(h.calls.length,before);
});
test('particle code uses one WebGL 1 draw, no texture assets, separate clock or native calls',()=>{
  assert.doesNotMatch(source,/createVertexArray|#version 300|requestAnimationFrame|setInterval|fetch\(|localStorage|PalmServiceBridge/);
  assert.match(source,/gl_PointCoord/);assert.match(source,/gl\.POINTS/);
});
