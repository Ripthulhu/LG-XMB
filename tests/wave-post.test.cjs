'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const window={};
const source=fs.readFileSync(path.join(__dirname,'../app/wave-post.js'),'utf8');
vm.runInNewContext(source,{window});
function fakeGL(options={}) {
  const live=new Set(),calls=[];let id=0,attached=null,bound=null,fail=false;
  const gl=new Proxy({}, {get(t,k){
    if(k in t)return t[k];if(/^[A-Z_0-9]+$/.test(k))return k;
    if(k.startsWith('create'))return ()=>{const v={id:++id,kind:k};live.add(v);return v;};
    if(k.startsWith('delete'))return v=>{assert.ok(live.delete(v));calls.push([k,v]);};
    return (...a)=>calls.push([k,...a]);
  }});
  Object.assign(gl,{
    getProgramParameter:()=>options.link!==false,getAttribLocation:()=>0,getUniformLocation:(_p,n)=>n,
    getParameter:k=>k==='MAX_TEXTURE_SIZE'?(options.limit||4096):[4096,4096],
    getError:()=>{const e=fail;fail=false;return e?'OUT_OF_MEMORY':'NO_ERROR';},
    texImage2D:(...a)=>{calls.push(['texImage2D',...a]);fail=!!options.refuse;},
    checkFramebufferStatus:()=>options.fbo===false?'FRAMEBUFFER_UNSUPPORTED':'FRAMEBUFFER_COMPLETE',
    bindFramebuffer:(_t,f)=>{attached=f;calls.push(['framebuffer',f]);},
    bindTexture:(_t,t)=>{bound=t;calls.push(['texture',t]);},
    drawArrays:()=>{assert.equal(attached,null,'FXAA must not sample its render target');assert.ok(bound);calls.push(['draw']);}
  });
  return {gl,live,calls};
}
test('FXAA allocates one output-size RGBA8 surface, reuses it and switches edge signal/strength without reallocating',()=>{
  const h=fakeGL(),p=window.LGXMBWavePost.create(h.gl,'highp');
  assert.equal(p.prepare(1920,1080),true);assert.equal(p.prepare(1920,1080),true);
  p.render('fxaa','normal');p.render('wave','strong');
  assert.equal(h.calls.filter(c=>c[0]==='texImage2D').length,1);
  assert.ok(h.calls.some(c=>c[0]==='uniform1i'&&c[1]==='uCoverage'&&c[2]===1));
  assert.deepEqual(Array.from(h.calls.filter(c=>c[0]==='uniform3fv').at(-1)[2]),[0.00390625,0.0625,1]);
  p.release();assert.equal(p.diagnostics().width,0);p.destroy(false);p.destroy(false);assert.equal(h.live.size,0);
});
test('A failed output allocation never uses stale storage and is not retried per frame',()=>{
  const o={},h=fakeGL(o),p=window.LGXMBWavePost.create(h.gl,'highp');
  assert.ok(p.prepare(1280,720));o.refuse=true;
  assert.equal(p.prepare(1920,1080),false);const calls=h.calls.length;
  for(let i=0;i<20;i++)assert.equal(p.prepare(1920,1080),false);
  assert.equal(h.calls.length,calls);assert.equal(p.target(),null);assert.equal(p.diagnostics().failure,'allocation refused');
  p.destroy(false);assert.equal(h.live.size,0);
});
test('Post-process respects GPU limits and rejects unbounded dimensions',()=>{
  const h=fakeGL({limit:1024}),p=window.LGXMBWavePost.create(h.gl,'mediump');
  assert.equal(p.prepare(1920,1080),false);assert.equal(p.diagnostics().failure,'GPU limit');
  assert.equal(h.calls.filter(c=>c[0]==='texImage2D').length,0);
  for(const pair of [[3840,2160],[0,720],[NaN,1080],[1920.5,1080]])assert.throws(()=>p.prepare(...pair));
  p.destroy(false);assert.equal(h.live.size,0);
});
test('Refused optional shaders release all resources',()=>{
  const h=fakeGL({link:false});assert.throws(()=>window.LGXMBWavePost.create(h.gl,'highp'),/shader refused/);assert.equal(h.live.size,0);
});
test('Lost-context cleanup makes no GL calls or subsequent draws',()=>{
  const h=fakeGL(),p=window.LGXMBWavePost.create(h.gl,'highp');p.prepare(1280,720);
  const before=h.calls.length;p.destroy(true);p.render('fxaa','normal');assert.equal(p.prepare(1280,720),false);assert.equal(h.calls.length,before);
});
test('FXAA uses bounded directional search without temporal, WebGL2, native or network dependencies',()=>{
  assert.match(source,/for\(int i=0;i<5;i\+\+\)/);assert.match(source,/nearest\/max\(pDistance\+nDistance/);
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|PalmServiceBridge|localStorage|createVertexArray|textureLod)\b|#version 300/);
});
