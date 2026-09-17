// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const MenuSounds=require('../app/menu-sounds.js');
function riff(n=48){const b=new ArrayBuffer(n),v=new Uint8Array(b);v.set([82,73,70,70],0);v.set([87,65,86,69],8);return b;}
function harness(options={}) {
  let gets=[],nodes=[],decodes=0,maximum=0,live=0,pending=[],resumeResolve;
  const document={hidden:false};
  function source(kind){const n={kind,connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;},frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}}};nodes.push(n);return n;}
  const context={state:'running',currentTime:0,destination:{},
    decodeAudioData(data,ok,bad){decodes++;if(options.decodeFail){bad();return Promise.reject(new Error('bad'));}
      const b={duration:options.duration||.1,numberOfChannels:2,length:4800};ok(b);return Promise.resolve(b);},
    createBufferSource(){return source('sample');},createOscillator(){return source('fallback');},
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};},
    resume(){if(options.delayedResume)return new Promise(resolve=>{resumeResolve=()=>{context.state='running';resolve();};});context.state='running';return Promise.resolve();},
    suspend(){context.state='suspended';return Promise.resolve();},close(){context.state='closed';return Promise.resolve();}};
  function createRequest(){let counted=false;return {
    open(method,url,async){assert.equal(method,'GET');assert.equal(async,true);this.url=url;},
    send(){gets.push(this.url);live++;counted=true;maximum=Math.max(maximum,live);
      const complete=()=>{if(!this.onload)return;
        if(options.progressTooLarge){this.onprogress({loaded:600000});return;}
        this.status=options.missing?.includes(this.url.split('/').pop().split('?')[0])?404:(options.status??200);
        this.response=options.invalid?new ArrayBuffer(30):riff(options.bytes||48);this.onload();};
      if(options.delayed)pending.push(complete);else queueMicrotask(complete);},
    abort(){if(counted){live--;counted=false;}this.aborted=true;}
  };}
  const sounds=new MenuSounds({enabled:options.enabled!==false,document,createContext:()=>context,createRequest});
  return {sounds,context,document,gets,nodes,pending,get decodes(){return decodes;},get maximum(){return maximum;},get live(){return live;},finishResume(){resumeResolve();}};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('Off performs no requests, context work or playback',async()=>{
  const h=harness({enabled:false});await h.sounds.prepare();assert.equal(h.sounds.context,null);assert.deepEqual(h.gets,[]);assert.equal(h.sounds.play('cursor'),false);h.sounds.destroy();
});
test('loads six exact WAV aliases with at most two requests; playback is cached',async()=>{
  const h=harness();await h.sounds.prepare();assert.equal(h.sounds.getState().phase,'ready');assert.equal(h.gets.length,6);assert.ok(h.maximum<=2);assert.equal(h.decodes,6);
  for(const k of Object.keys(MenuSounds.FILES))h.sounds.play(k);
  assert.equal(h.nodes.length,6);assert.equal(h.gets.length,6);assert.equal(h.sounds.voices.length,4);assert.equal(h.nodes[0].stopped,true);h.sounds.destroy();
});
test('file status zero with RIFF bytes is accepted',async()=>{const h=harness({status:0});await h.sounds.prepare();assert.equal(h.sounds.getState().loaded,6);h.sounds.destroy();});
test('missing folder falls back only for navigation; never retries per key',async()=>{
  const h=harness({missing:Object.values(MenuSounds.FILES)});await h.sounds.prepare();assert.equal(h.sounds.phase,'fallback');h.sounds.play('category');h.sounds.play('error');assert.equal(h.nodes.length,1);assert.equal(h.nodes[0].kind,'fallback');
  for(let i=0;i<10;i++)h.sounds.play('category');assert.equal(h.gets.length,6);h.sounds.destroy();
});
test('partial folder fails independently per effect',async()=>{
  const h=harness({missing:['snd_cancel.wav']});await h.sounds.prepare();assert.equal(h.sounds.phase,'partial');assert.deepEqual(h.sounds.getState().missing,['snd_cancel.wav']);h.sounds.play('decide');h.sounds.play('cancel');assert.equal(h.nodes.length,1);h.sounds.destroy();
});
test('rejects non-WAV bytes and oversized responses without decoding',async()=>{
  for(const opts of [{invalid:true},{bytes:524289},{progressTooLarge:true},{status:500}]){
    const h=harness(opts);await h.sounds.prepare();assert.equal(h.decodes,0);assert.equal(h.sounds.phase,'fallback');h.sounds.destroy();
  }
});
test('decode errors and long clips fail closed',async()=>{for(const opts of [{decodeFail:true},{duration:60}]){const h=harness(opts);await h.sounds.prepare();assert.equal(h.sounds.phase,'fallback');h.sounds.destroy();}await flush();});
test('Off aborts pending loads and ignores stale results',async()=>{
  const h=harness({delayed:true});h.sounds.prepare();assert.equal(h.pending.length,2);h.sounds.setEnabled(false);h.pending.forEach(fn=>fn());await flush();assert.equal(h.live,0);assert.equal(h.sounds.getState().loaded,0);assert.equal(h.sounds.phase,'off');h.sounds.destroy();
});
test('reload re-reads files; completed samples do not play retroactively',async()=>{
  const h=harness();await h.sounds.prepare();await h.sounds.retry();assert.equal(h.gets.length,12);assert.equal(h.nodes.length,0);h.sounds.destroy();
});
test('hide stops voices, prevents playback and foreground never replays',async()=>{
  const h=harness();await h.sounds.prepare();h.sounds.play('decide');h.sounds.setActive(false);assert.equal(h.nodes[0].stopped,true);assert.equal(h.sounds.play('error'),false);h.sounds.setActive(true);await flush();assert.equal(h.nodes.length,1);h.sounds.destroy();
});
test('a resume racing a hide cannot play or leave audio running',async()=>{
  const h=harness({delayedResume:true});await h.sounds.prepare();h.context.state='suspended';h.sounds.play('decide');h.sounds.setActive(false);h.finishResume();await flush();assert.equal(h.nodes.length,0);assert.equal(h.context.state,'suspended');h.sounds.destroy();
});
test('resume coalesces rapid input instead of queuing a burst',async()=>{
  const h=harness({delayedResume:true});await h.sounds.prepare();h.context.state='suspended';h.sounds.play('decide');h.sounds.play('category');h.sounds.play('option');h.finishResume();await flush();assert.equal(h.nodes.length,1);assert.equal(h.nodes[0].buffer,h.sounds.buffers.option);h.sounds.destroy();
});
test('unknown names cannot request paths or play a sound',async()=>{const h=harness();for(const s of ['../trophy','__proto__','system_ok','trophy'])assert.equal(h.sounds.play(s),false);assert.equal(h.gets.length,0);h.sounds.destroy();});
test('destroy stops nodes, closes context and remains inert',async()=>{const h=harness();await h.sounds.prepare();h.sounds.play('decide');h.sounds.destroy();h.sounds.destroy();assert.equal(h.context.state,'closed');assert.equal(h.nodes[0].stopped,true);assert.equal(h.sounds.play('cursor'),false);});
