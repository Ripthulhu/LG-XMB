// SPDX-License-Identifier: GPL-3.0-or-later
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(options = {}) {
  const timers = new Map(), audios = [], changes = [];
  let serial = 0, creates = 0;
  const document = {hidden:false, body:{
    appendChild(audio) {audio.parentNode=this;},
    removeChild(audio) {audio.parentNode=null;}
  }, createElement(tag) {
    assert.equal(tag, 'audio'); creates++;
    const events = new Map();
    const audio = {currentTime:0,duration:386,paused:true,playCalls:0,loads:0,removed:false,
      addEventListener(name, fn) {events.set(name, fn);},
      removeEventListener(name, fn) {if(events.get(name)===fn)events.delete(name);},
      setAttribute() {}, removeAttribute(name) {assert.equal(name,'src');delete this.src;this.removed=true;},
      load() {this.loads++;this.emit('error');},
      pause() {this.paused=true;this.emit('pause');},
      play() {this.playCalls++;this.paused=false;return this.promise;},
      emit(name) {const fn=events.get(name);if(fn)fn();},
      listener(name) {return events.get(name);}
    };
    if (options.promise) audio.promise=options.promise();
    audios.push(audio);return audio;
  }};
  const context = {console,Number,globalThis:null};context.globalThis=context;
  vm.runInNewContext(fs.readFileSync('app/background-music.js','utf8'),context);
  const music = new context.LGXMBBackgroundMusic({document,
    setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),
    onChange:state=>changes.push(state),enabled:options.enabled,volume:options.volume});
  const flush = async () => {await Promise.resolve();await Promise.resolve();};
  return {music,document,timers,audios,changes,flush,get creates(){return creates;}};
}
function deferred() {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test('music is opt-in: no element, requests or timer while Off',()=>{
  const f=fixture();f.music.setContext(true,false);
  assert.equal(f.creates,0);assert.equal(f.timers.size,0);assert.equal(f.music.getState().phase,'off');
  f.music.setVolume(0.5);assert.equal(f.creates,0);
});
test('one local MP3 loops at a saved volume without recreating on navigation',()=>{
  const f=fixture({enabled:true,volume:0.5});f.music.setContext(true,false);
  const a=f.audios[0];assert.equal(a.src,'user-music.mp3');assert.equal(a.loop,true);
  assert.equal(a.autoplay,false);assert.equal(a.volume,0.5);assert.equal(a.hidden,true);
  a.emit('playing');f.music.setContext(true,false);f.music.setContext(true,false);
  assert.equal(f.creates,1);assert.equal(a.playCalls,1);assert.equal(f.timers.size,0);
  f.music.setVolume(0.1);assert.equal(a.volume,0.1);assert.equal(f.creates,1);
});
test('suspend releases the source and resumes the in-session position without overlap',()=>{
  const f=fixture({enabled:true});f.music.setContext(true,false);const a=f.audios[0];
  a.emit('playing');a.currentTime=42;f.music.setContext(false,false);
  assert.equal(a.paused,true);assert.equal(a.removed,true);assert.equal(a.loads,1);assert.equal(a.parentNode,null);
  assert.equal(f.timers.size,0);assert.equal(f.music.getState().phase,'suspended');
  f.music.setContext(true,false);const b=f.audios[1];b.emit('loadedmetadata');
  assert.equal(b.currentTime,42);assert.equal(a.playCalls,1);assert.equal(f.creates,2);
});
test('live preview suppresses loading and releases a currently playing track',()=>{
  const f=fixture({enabled:true});f.music.setContext(true,true);assert.equal(f.creates,0);
  assert.equal(f.music.getState().phase,'preview');f.music.setContext(true,false);f.audios[0].emit('playing');
  f.music.setContext(true,true);assert.equal(f.audios[0].parentNode,null);assert.equal(f.timers.size,0);
  f.music.setContext(true,true);assert.equal(f.creates,1);
});
test('hidden documents and destroyed controllers never load audio',()=>{
  const f=fixture({enabled:true});f.document.hidden=true;f.music.setContext(true,false);assert.equal(f.creates,0);
  f.document.hidden=false;f.music.setContext(true,false);f.music.destroy();
  f.music.setContext(true,false);f.music.setEnabled(false);f.music.retry();
  assert.equal(f.creates,1);assert.equal(f.timers.size,0);assert.equal(f.audios[0].parentNode,null);
});
test('turning Off resets the position, clears errors and creates nothing until reenabled',()=>{
  const f=fixture({enabled:true});f.music.setContext(true,false);f.audios[0].currentTime=65;
  f.music.setEnabled(false);assert.equal(f.music.position,0);assert.equal(f.music.phase,'off');
  f.music.setEnabled(true);f.audios[1].emit('loadedmetadata');assert.equal(f.audios[1].currentTime,0);
});
test('autoplay denial waits for a trusted gesture, not timers or repeated render calls',async()=>{
  const d=deferred();const f=fixture({enabled:true,promise:()=>d.promise});f.music.setContext(true,false);
  d.reject({name:'NotAllowedError'});await f.flush();
  assert.equal(f.music.phase,'blocked');assert.equal(f.timers.size,0);assert.equal(f.audios[0].parentNode,null);
  f.music.setContext(true,false);f.music.gesture({isTrusted:false});f.music.gesture({isTrusted:true,repeat:true});
  assert.equal(f.creates,1);f.music.gesture({isTrusted:true});assert.equal(f.creates,2);
  await f.flush();f.music.setContext(false,false);f.music.gesture({isTrusted:true});assert.equal(f.creates,2);
});
test('late play resolution and captured events cannot revive released or replacement audio',async()=>{
  const first=deferred(),second=deferred();let call=0;
  const f=fixture({enabled:true,promise:()=>call++?second.promise:first.promise});f.music.setContext(true,false);
  const event=f.audios[0].listener('playing');f.music.setContext(false,false);first.resolve();await f.flush();event();
  assert.equal(f.music.phase,'suspended');assert.equal(f.audios[0].paused,true);
  f.music.setContext(true,false);event();assert.equal(f.music.phase,'loading');
  second.resolve();await f.flush();assert.equal(f.music.phase,'playing');
});
test('missing/unsupported audio reports failure once, with explicit retry',()=>{
  const f=fixture({enabled:true});f.music.setContext(true,false);f.audios[0].emit('error');
  assert.equal(f.music.phase,'unavailable');assert.equal(f.timers.size,0);
  f.music.setContext(true,false);f.music.gesture({isTrusted:true});assert.equal(f.creates,1);
  f.music.retry();assert.equal(f.creates,2);
});
test('startup deadline is bounded and a stale timer cannot fail a new generation',()=>{
  const f=fixture({enabled:true});f.music.setContext(true,false);const expired=[...f.timers.values()][0];
  expired();assert.equal(f.music.phase,'recovering');assert.equal(f.audios[0].parentNode,null);
  f.music.retry();expired();assert.equal(f.music.phase,'loading');
});

test('transient failure retries once then waits until a new foreground visit',()=>{
  const f=fixture({enabled:true});f.music.setContext(true,false);
  const expire=()=>{const [id,fn]=[...f.timers.entries()][0];f.timers.delete(id);fn();};
  expire();assert.equal(f.music.phase,'recovering');
  f.music.setContext(true,false);assert.equal(f.creates,1);
  expire();assert.equal(f.creates,2);expire();
  assert.equal(f.music.phase,'unavailable');assert.equal(f.timers.size,0);
  assert.equal(f.music.getState().failure.kind,'timeout');
  f.music.setContext(true,false);assert.equal(f.creates,2);
  f.music.setContext(false,false);f.music.setContext(true,false);assert.equal(f.creates,3);
});
test('decode and resource interruption recover only on a new foreground visit',()=>{
  for(const kind of ['decode','pause']){
    const f=fixture({enabled:true});f.music.setContext(true,false);
    if(kind==='decode'){f.audios[0].error={code:3};f.audios[0].emit('error');}
    else{f.audios[0].emit('playing');f.audios[0].pause();}
    assert.equal(f.timers.size,0);f.music.setContext(true,false);assert.equal(f.creates,1);
    f.music.setContext(false,false);f.music.setContext(true,false);assert.equal(f.creates,2);
  }
});
test('scheduled recovery cannot start in HDMI, preview, Off, or a replacement session',()=>{
  for(const action of [f=>f.music.setContext(false,false),f=>f.music.setContext(true,true),f=>f.music.setEnabled(false),f=>f.music.destroy(),f=>f.music.retry()]){
    const f=fixture({enabled:true});f.music.setContext(true,false);
    f.audios[0].error={code:2};f.audios[0].emit('error');
    const stale=[...f.timers.values()][0];action(f);const count=f.creates;
    stale();assert.equal(f.creates,count);
  }
});
test('policy denial remains blocked through lifecycle transitions',async()=>{
  const d=deferred(),f=fixture({enabled:true,promise:()=>d.promise});f.music.setContext(true,false);
  d.reject({name:'NotAllowedError'});await f.flush();
  f.music.setContext(false,false);f.music.setContext(true,false);
  assert.equal(f.creates,1);assert.equal(f.music.phase,'blocked');
});
test('native audio interruption does not fight the resource owner in a retry loop',()=>{
  const f=fixture({enabled:true});f.music.setContext(true,false);f.audios[0].emit('playing');f.audios[0].pause();
  assert.equal(f.music.phase,'blocked');f.music.setContext(true,false);assert.equal(f.creates,1);
});
test('preference types and volume choices are bounded; no root, network URL or Web Audio decoding',()=>{
  const f=fixture({enabled:'true',volume:'0.5'});f.music.setContext(true,false);assert.equal(f.creates,0);
  assert.equal(f.music.volume,0.25);f.music.setEnabled(1);assert.equal(f.music.enabled,false);
  for(const v of [NaN,Infinity,-1,0,3,'1'])f.music.setVolume(v);
  assert.equal(f.music.volume,0.25);
  const src=fs.readFileSync('app/background-music.js','utf8');
  assert.doesNotMatch(src,/https?:|PalmServiceBridge|luna:\/\/|decodeAudioData|createMediaElementSource/);
});
test('local audio is allowed by CSP without allowing remote media or connection requests',()=>{
  const src=fs.readFileSync('app/index.html','utf8');
  assert.match(src,/media-src 'self' ext:;/);
  // 'self' since the menu sounds read their own WAVs. Still nothing remote.
  assert.match(src,/connect-src 'self';/);
  assert.doesNotMatch(src.match(/Content-Security-Policy[^>]*/)[0],/https?:|\*/);
  assert.ok(src.indexOf('background-music.js')<src.indexOf('src="app.js"'));
});

test('explicit retry reloads a manually replaced track from its beginning',()=>{
  const f=fixture({enabled:true});f.music.setContext(true,false);f.audios[0].emit('playing');
  f.audios[0].currentTime=120;f.music.retry();f.audios[1].emit('loadedmetadata');
  assert.equal(f.music.position,0);assert.equal(f.audios[1].currentTime,0);
  assert.equal(f.audios[0].parentNode,null);assert.equal(f.audios[1].src,'user-music.mp3');
});
