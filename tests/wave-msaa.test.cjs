'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/wave-msaa.js'),'utf8'),{window});
function fixture(options={}) {
 const calls=[],live=new Set();let id=0,error=0,count=0;
 const gl={NO_ERROR:0,OUT_OF_MEMORY:1285,RGBA8:32856,RENDERBUFFER:36161,FRAMEBUFFER:36160,
 READ_FRAMEBUFFER:36008,DRAW_FRAMEBUFFER:36009,RENDERBUFFER_SAMPLES:36011,COLOR_ATTACHMENT0:36064,
 SAMPLES:32937,MAX_RENDERBUFFER_SIZE:34024,FRAMEBUFFER_COMPLETE:36053,COLOR_BUFFER_BIT:16384,NEAREST:9728,
 MAX_SAMPLES:36183};
 const add=k=>{const v={k,id:++id};live.add(v);return v;};
 Object.assign(gl,{
 getInternalformatParameter:(...a)=>{calls.push(['counts',...a]);return new Int32Array(options.counts||[4,2]);},
 getParameter:p=>p===gl.MAX_SAMPLES?(options.maxSamples===undefined?32:options.maxSamples):(options.limit||4096),
 getError:()=>{const e=error;error=0;return e;},isContextLost:()=>false,
 createRenderbuffer:()=>add('rb'),createFramebuffer:()=>add('fb'),
 deleteRenderbuffer:v=>{assert.ok(live.delete(v));},deleteFramebuffer:v=>{assert.ok(live.delete(v));},
 bindRenderbuffer:(...a)=>calls.push(['bindRB',...a]),bindFramebuffer:(...a)=>calls.push(['bindFB',...a]),
 renderbufferStorageMultisample:(...a)=>{calls.push(['allocate',...a]);count=a[1];if(options.failCount===count||options.failAll)error=1285;},
 getRenderbufferParameter:()=>options.roundTo||count,
 framebufferRenderbuffer:(...a)=>calls.push(['attach',...a]),checkFramebufferStatus:()=>options.badFbo?36061:36053,
 blitFramebuffer:(...a)=>{calls.push(['blit',...a]);if(options.badResolve)error=1282;}
 });
 if(options.webgl1){delete gl.RGBA8;delete gl.blitFramebuffer;delete gl.renderbufferStorageMultisample;}
 return {gl,calls,live,options};
}
test('MSAA is opt-in and its supported sample list is format-specific',()=>{
 const h=fixture(),m=window.LGXMBWaveMSAA.create(h.gl);
 assert.equal(m.prepare(0,1920,264),false);assert.equal(h.live.size,0);
 assert.deepEqual(Array.from(m.diagnostics().supported),[4,2]);assert.equal(h.calls.filter(c=>c[0]==='counts').length,1);
 assert.ok(m.prepare(4,1920,264));assert.ok(m.prepare(4,1920,264));assert.equal(h.calls.filter(c=>c[0]==='allocate').length,1);
 assert.equal(m.diagnostics().samples,4);assert.equal(m.diagnostics().bytes,1920*264*4*4);
 m.prepare(0,1920,264);assert.equal(h.live.size,0);assert.equal(m.diagnostics().samples,0);m.destroy(false);
});
test('Sample counts above MAX_SAMPLES are not reported or requested',()=>{
 // The C5's Mali-G52 lists 16, 8 and 4 for RGBA8 while MAX_SAMPLES is 4;
 // allocating 16 or 8 fails with INVALID_VALUE and an incomplete framebuffer.
 const h=fixture({counts:[16,8,4],maxSamples:4}),m=window.LGXMBWaveMSAA.create(h.gl);
 assert.deepEqual(Array.from(m.diagnostics().supported),[4]);
 assert.ok(m.prepare(4,1920,264));
 assert.deepEqual(h.calls.filter(c=>c[0]==='allocate').map(c=>c[2]),[4]);
 assert.equal(m.diagnostics().samples,4);m.destroy(false);
});
test('MSAA resolve has matching dimensions/formats and resets READ and DRAW framebuffer bindings',()=>{
 const h=fixture(),m=window.LGXMBWaveMSAA.create(h.gl);m.prepare(4,1920,264);assert.ok(m.target());
 const target={textureFbo:true};assert.ok(m.resolve(target));
 assert.deepEqual(h.calls.find(c=>c[0]==='blit').slice(1),[0,0,1920,264,0,0,1920,264,16384,9728]);
 assert.ok(h.calls.some(c=>c[0]==='bindFB'&&c[1]===36009&&c[2]===target));
 assert.deepEqual(h.calls.at(-1),['bindFB',36160,null]);m.destroy(false);assert.equal(h.live.size,0);
});
test('MSAA falls back downward only and never silently rounds a 2x request up to 4x',()=>{
 for(const o of [{counts:[2]},{counts:[4,2],failCount:4}]) {
  const h=fixture(o),m=window.LGXMBWaveMSAA.create(h.gl);assert.ok(m.prepare(4,1920,264));
  assert.equal(m.diagnostics().samples,2);assert.ok(m.diagnostics().failure);m.destroy(false);assert.equal(h.live.size,0);
 }
 const h=fixture({counts:[4]}),m=window.LGXMBWaveMSAA.create(h.gl);
 assert.equal(m.prepare(2,1920,264),false);assert.match(m.diagnostics().failure,/unsupported/);assert.equal(h.live.size,0);
 assert.ok(m.prepare(4,1920,264));m.destroy(false);
});
test('Unsupported WebGL1, size limits, refused allocation and rounded storage do not allocate/retry every frame',()=>{
 for(const o of [{webgl1:true},{limit:1000},{failAll:true},{badFbo:true},{counts:[2],roundTo:4}]) {
  const h=fixture(o),m=window.LGXMBWaveMSAA.create(h.gl);assert.equal(m.prepare(4,1920,264),false);
  assert.equal(h.live.size,0);assert.equal(m.diagnostics().samples,0);assert.ok(m.diagnostics().failure);
  const before=h.calls.length;for(let i=0;i<30;i++)assert.equal(m.prepare(4,1920,264),false);
  assert.equal(h.calls.length,before);m.destroy(false);
 }
});
test('Failed resolves release MSAA, are not retried per frame, and can be retried by changing the setting',()=>{
 const h=fixture({badResolve:true}),m=window.LGXMBWaveMSAA.create(h.gl);m.prepare(4,1920,264);
 assert.equal(m.resolve({}),false);assert.equal(h.live.size,0);assert.match(m.diagnostics().failure,/resolve/);
 const before=h.calls.length;assert.equal(m.prepare(4,1920,264),false);assert.equal(h.calls.length,before);
 h.options.badResolve=false;m.prepare(0,1920,264);assert.ok(m.prepare(4,1920,264));assert.ok(m.resolve({}));m.destroy(false);
});
test('MSAA validates configuration and handles context loss and repeated destruction without GL calls',()=>{
 const h=fixture(),m=window.LGXMBWaveMSAA.create(h.gl);
 for(const args of [[8,1920,264],[NaN,1,1],[2,0,1],[4,1920.5,1],[4,1,Infinity]])assert.throws(()=>m.prepare(...args));
 m.prepare(4,1920,264);const before=h.calls.length;
 m.destroy(true);m.destroy(false);assert.equal(m.prepare(4,1920,264),false);assert.equal(m.resolve({}),false);assert.equal(h.calls.length,before);
});
