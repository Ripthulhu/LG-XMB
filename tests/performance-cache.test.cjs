// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app/ps3-native-renderer.js'),'utf8');
function load() {
  const names=['prepareAmbient','backdropPass','monthlyPass','prepareMonthlyTarget','allocateBackdrop','allocate','releaseTarget','texture','resource','draw','particlePass','destroy'];
  const code=names.map(n=>{const m=new RegExp('  Renderer\\.prototype\\.'+n+' = function[\\s\\S]*?\\n  };').exec(source);assert.ok(m,n);return m[0];}).join('\n');
  const equal=/  function sameBackgroundVector\([\s\S]*?\n  }/.exec(source);assert.ok(equal);
  const clock={calls:0,coordinates(date,auto,month,period){return auto?this.fromLocalDate(date):this.calendar(month,1,period==='night'?0:12);},fromLocalDate(d){this.calls++;return{seconds:Math.floor(d.getTime()/1000)};},calendar(month,day,hour){this.calls++;return{month,day,hour};},uniforms(c){return{layers:[0,1,2,3],values:{_DayTime: c.seconds||c.hour||0}};}};
  const sandbox={root:{LGXMBPS3BackgroundClock:clock},Renderer:function(){},RETAINED_DAY_NIGHT:{},Date,Float32Array};
  vm.runInNewContext(equal[0]+'\n'+code,sandbox);return {Renderer:sandbox.Renderer,clock};
}
function fakeGL() {
  const log=[],textures=new Map();let next=1,error=0,active=0,fb=null;const bindings={};
  const g={log,failFormat:null,ext:true,NO_ERROR:0,FRAMEBUFFER_COMPLETE:36053,RGBA8:32856,RGBA16F:34842,RGB10_A2:32857,RG16F:33327,RG:33319,RGBA:6408,
    FRAMEBUFFER:36160,TEXTURE_2D:3553,TEXTURE0:33984,TEXTURE1:33985,TEXTURE2:33986,FLOAT:5126,LINEAR:9729,NEAREST:9728,
    createTexture(){const x={id:next++};textures.set(x,{});return x;},createFramebuffer(){return{id:next++};},
    activeTexture(v){active=v;log.push(['active',v]);},bindTexture(t,x){bindings[active]=x;log.push(['bindTexture',active,x]);},
    bindFramebuffer(t,x){fb=x;},texStorage2D(t,n,f,w,h){textures.get(bindings[active]).format=f;log.push(['storage',f,w,h]);if(g.failFormat===f)error=1282;},
    framebufferTexture2D(t,a,target,tex){fb.format=textures.get(tex).format;},checkFramebufferStatus(){return fb&&fb.format===g.failFormat?36054:g.FRAMEBUFFER_COMPLETE;},
    getError(){const e=error;error=0;return e;},getExtension(){return g.ext?{}:null;},
    texSubImage2D(...args){log.push(['upload',args[4],args[5],args[6],Array.from(args[8])]);},
    drawArrays(){log.push(['draw',fb]);},deleteTexture(x){log.push(['deleteTexture',x]);},deleteFramebuffer(x){log.push(['deleteFramebuffer',x]);},
    uniform1i(k,v){log.push(['uniform1i',k,v]);},uniform1f(){},uniform1fv(){},uniform2fv(){},uniform3fv(){},uniform4fv(){},uniform2f(){},
  };
  for(const n of ['viewport','texParameteri','disable','colorMask','useProgram','bindVertexArray','bindRenderbuffer','clearColor','clear','enable','blendEquationSeparate','blendFuncSeparate','bindBuffer','bufferSubData','blitFramebuffer'])g[n]=(...args)=>log.push([n,...args]);
  return g;
}
function fixture(){const {Renderer,clock}=load(),g=fakeGL(),r=Object.create(Renderer.prototype);Object.assign(r,{gl:g,objects:[],programs:[],allocations:0,uploadedBytes:0,monthlyKey:'',uniforms:{backdrop:{},monthly:{}},fresnelTexture:{id:'complete-fallback'}});return {r,g,clock};}
const bg=[.02,.04,.08],palette=()=>({start:[.05,.1,.2],end:[.15,.25,.45],dir:[0,1],range:[0,1]});
test('static theme backdrop renders once across 600 calls; identical new arrays do not invalidate it',()=>{
 const {r,g}=fixture();for(let i=0;i<600;i++)r.backdropPass(1920,1080,false,bg.slice(),null);
 assert.equal(r.backdropRenders,1);assert.equal(r.allocations,1);assert.equal(g.log.filter(x=>x[0]==='draw').length,1);assert.equal(r.backdrop.format,g.RGB10_A2);
});
test('background palette, source mode and dimensions invalidate without per-frame allocation',()=>{
 const {r,g}=fixture(),p=palette();r.backdropPass(1920,1080,false,bg,p);r.backdropPass(1920,1080,false,bg,palette());assert.equal(r.backdropRenders,1);
 p.start[0]+=.01;r.backdropPass(1920,1080,false,bg,p);assert.equal(r.backdropRenders,2);
 r.monthlyKey='month-a';r.backdropPass(1920,1080,true,bg,p);r.backdropPass(1920,1080,true,bg,p);assert.equal(r.backdropRenders,3);
 r.monthlyKey='month-b';r.backdropPass(1920,1080,true,bg,p);assert.equal(r.backdropRenders,4);
 r.backdropPass(1280,720,true,bg,p);assert.equal(r.backdropRenders,5);assert.equal(r.allocations,2);
 r.backdropPass(1280,720,false,bg,p);assert.equal(r.backdropRenders,6);
 assert.equal(g.log.filter(x=>x[0]==='deleteTexture').length,1);
});
test('refused RGB10_A2 falls back once to RGBA8 and remains cached',()=>{
 const {r,g}=fixture();g.failFormat=g.RGB10_A2;r.backdropPass(1280,720,false,bg,null);for(let i=0;i<60;i++)r.backdropPass(1280,720,false,bg,null);
 assert.equal(r.backdrop.format,g.RGBA8);assert.equal(r.backdropFallback,'RGB10_A2 unavailable');assert.equal(r.backdropRenders,1);
 assert.equal(g.log.filter(x=>x[0]==='storage').length,2);
});
test('full-size float render targets are rejected while the 64x32 intermediate is allowed',()=>{
 const {r,g}=fixture();assert.throws(()=>r.allocate(1920,1080,g.RGBA16F),/Full-size/);assert.throws(()=>r.allocate(1280,720,34836),/Full-size/);
 assert.equal(g.log.length,0);const t=r.allocate(64,32,g.RGBA16F);assert.equal(t.format,g.RGBA16F);
});
test('transmission/halo LUT uploads once, without requiring a float framebuffer extension',()=>{
 const {r,g}=fixture();g.ext=false;r.prepareAmbient();for(let i=0;i<600;i++)r.prepareAmbient();
 const uploads=g.log.filter(x=>x[0]==='upload');assert.equal(uploads.length,1);assert.deepEqual(uploads[0].slice(1,4),[64,32,g.RG]);
 const data=uploads[0][4];assert.equal(data.length,4096);assert.equal(r.uploadedBytes,16384);
 for(let i=0;i<data.length;i+=2){assert.ok(data[i]>=.77&&data[i]<=1);assert.ok(data[i+1]>=0&&data[i+1]<=.05);}
 assert.equal(g.log.filter(x=>x[0]==='draw').length,0);assert.equal(g.log.filter(x=>x[0]==='storage')[0][1],g.RG16F);
});
test('fixed monthly controls are computed once; changing month/time mode re-evaluates them',()=>{
 const {r,g,clock}=fixture();r.monthlyTexture={};r.monthlyFbo={};for(let i=0;i<600;i++)r.monthlyPass({auto:false,month:8,period:'day'});assert.equal(clock.calls,1);
 r.monthlyPass({auto:false,month:9,period:'day'});assert.equal(clock.calls,2);
 for(let i=0;i<100;i++)r.monthlyPass({auto:true});assert.ok(clock.calls<=4,'whole-second cache');
 r.monthlyPass({auto:false,month:9,period:'day'});assert.ok(clock.calls<=5);
});
test('loss of/recreation of the monthly target cannot reuse an unpainted clock key',()=>{
 const {r,g,clock}=fixture();r.prepareMonthlyTarget();r.monthlyPass({auto:false,month:8,period:'day'});r.prepareMonthlyTarget();r.monthlyPass({auto:false,month:8,period:'day'});assert.equal(clock.calls,2);
 g.ext=false;r.prepareMonthlyTarget();assert.equal(r.monthlyTarget.format,g.RGBA8);
});
test('destroy releases ambient texture and every target; repeated destruction is inert',()=>{
 const {r,g}=fixture();r.prepareAmbient();r.backdropPass(32,18,false,bg,null);r.prepareMonthlyTarget();r.destroy(false);
 assert.equal(r.ambientTexture,null);assert.equal(r.backdropInputs,null);assert.equal(r.objects.length,0);const n=g.log.length;r.destroy(false);assert.equal(g.log.length,n);
 assert.equal(g.log.filter(x=>x[0]==='deleteTexture').length,3);
});
test('frame integration binds independent complete scene/backdrop/ambient textures and uses existing draws',()=>{
 const {r,g}=fixture();Object.assign(r,{ready:true,settings:{sampling:1,strength:'normal',postprocess:'off',softness:0,particles:false},
 simulation:{particles:{},wave:{}},updateGrid(){},resize(){this.target={width:64,height:32,texture:{id:'wave'}};},band(){return[0,1];},wavePass(){},filterTunings:{normal:[0,0,0]},drawCount:0});
 r.uniforms.composite={uScene:'scene',uBackdrop:'backdrop',uAmbient:'ambient'};r.draw(64,32,[1,1,1],1,bg,null);
 assert.equal(r.drawCount,1);assert.equal(r.backdropRenders,1);assert.ok(g.log.some(x=>x[0]==='uniform1i'&&x[1]==='ambient'&&x[2]===2));
 g.log.length=0;r.draw(64,32,[1,1,1],1,bg,null);assert.equal(g.log.filter(x=>x[0]==='draw').length,1,'only existing compositor draw after cache hit');
 assert.equal(g.log.filter(x=>x[0]==='upload'||x[0]==='storage').length,0);
});
const shader=n=>fs.readFileSync(path.join(root,'shaders',n),'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
test('composite precision and one-hash contract cannot silently regress',()=>{
 const s=shader('compositeFragment.frag');assert.match(s,/precision mediump float/);assert.match(s,/precision mediump sampler2D/);assert.match(s,/out mediump vec4 outColor/);
 assert.doesNotMatch(s,/highp\s+(?:sampler|vec[34])|ambientTerms|length\(|uColorStart|uColorEnd/);
 assert.equal((s.match(/52\.9829189/g)||[]).length,1);assert.doesNotMatch(s,/n1|sin\(/);
});
test('all recurring fragment shaders avoid analytic ambient shading and share the cached path',()=>{
 for(const k of ['particle','glare']){const s=shader(k+'Fragment.frag'),v=shader(k+'Vertex.vert');assert.doesNotMatch(s,/ambientTerms|uAmbientInvSize|gl_FragCoord/);assert.match(s,/outColor\.rgb \*= vBackdropTransmission/);assert.match(v,/texture\(uAmbient,/);}
 assert.match(shader('backdropFragment.frag'),/ambientTerms/);
});
