'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/helper.js'),'utf8');
function setup(tv=true){
  const calls=[],timers=new Map();let seq=0;
  const window={C5TV:{isTV:()=>tv},setTimeout:(fn,delay)=>{timers.set(++seq,{fn,delay});return seq;},clearTimeout:id=>timers.delete(id)};
  window.PalmServiceBridge=class{call(uri,body){calls.push({uri,command:JSON.parse(body).command,bridge:this});}cancel(){this.cancelled=true;}};
  vm.runInNewContext(source,{window,Promise});
  function reply(index,value,outer={}){calls[index].bridge.onservicecallback(JSON.stringify({returnValue:true,stdoutString:JSON.stringify(value),stderrString:'',...outer}));}
  return {helper:window.LGXMBHelper,calls,timers,reply,window};
}
const ready={returnValue:true,ready:true,captureRunning:true};
test('desktop setup sends no native calls',async()=>{
  const h=setup(false);await assert.rejects(h.helper.ensure());assert.equal(h.calls.length,0);
});
test('clean-install setup uses one fixed app-owned command and shares concurrent callers',async()=>{
  const h=setup(),first=h.helper.ensure(),second=h.helper.ensure();
  assert.equal(first,second);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].uri,'luna://org.webosbrew.hbchannel.service/exec');
  assert.match(h.calls[0].command,/python3 -I -B \/media\/developer\/apps\/usr\/palm\/applications\/org\.local\.openxmb\.c5\/helper-startup\.py ensure/);
  assert.doesNotMatch(h.calls[0].command,/\/var\/lib\/openxmb|curl|wget|remote-set|setDefaultApp/);
  h.reply(0,ready);await first;assert.equal(h.helper.isReady(),true);
  await h.helper.ensure();assert.equal(h.calls.length,1);assert.equal(h.calls[0].bridge.cancelled,true);assert.equal(h.timers.size,0);
});
test('only an explicit non-root effective UID is reported as missing root privileges',async()=>{
  for(const [value,expected] of [
    [{returnValue:false,errorCode:'root_required',effectiveUid:1000},'ROOT_REQUIRED'],
    [{returnValue:false,errorCode:'root_required'},'SETUP_FAILED'],
    [{returnValue:false,errorCode:'bundle_incomplete'},'BUNDLE_INCOMPLETE'],
    [{returnValue:false,errorCode:'python_missing'},'PYTHON_MISSING'],
    [{returnValue:false,errorCode:'legacy_config_conflict'},'CONFIG_CONFLICT']
  ]){
    const h=setup(),p=h.helper.ensure();h.reply(0,value,{returnValue:false,error:'Command failed'});
    await assert.rejects(p,e=>e.code===expected);assert.equal(h.helper.isReady(),false);
  }
});
test('service denial and an outer execution failure cannot be treated as success',async()=>{
  for(const outer of [{returnValue:false},{errorCode:-1},{stderrString:'private traceback'},{exitCode:2}]){
    const h=setup(),p=h.helper.ensure();h.reply(0,ready,outer);
    await assert.rejects(p,e=>e.code==='EXEC_UNAVAILABLE'&&!/private traceback/.test(e.message));
  }
});
test('timeout does not retry and ignores a late success; retry is explicit',async()=>{
  const h=setup(),p=h.helper.ensure(),late=h.calls[0].bridge.onservicecallback;
  assert.equal([...h.timers.values()][0].delay,45000);[...h.timers.values()][0].fn();
  await assert.rejects(p,e=>e.code==='TIMEOUT');
  late(JSON.stringify({returnValue:true,stdoutString:JSON.stringify(ready)}));
  await assert.rejects(h.helper.ensure(),e=>e.code==='TIMEOUT');assert.equal(h.calls.length,1);
  const retry=h.helper.retry();h.reply(1,ready);await retry;assert.equal(h.helper.isReady(),true);
});
test('capture failure leaves on-demand Home controls ready and gives a distinct status',async()=>{
  const h=setup(),p=h.helper.ensure();h.reply(0,{...ready,captureRunning:false});await p;
  assert.equal(h.helper.isReady(),true);assert.equal(h.helper.getState().captureRunning,false);
  assert.match(h.helper.getState().message,/HDMI capture did not start/);
});
test('malformed and oversized execution replies cannot enable the helper',async()=>{
  for(const raw of ['garbage','[]','x'.repeat(65537),JSON.stringify({returnValue:true,stdoutString:'{}'})]){
    const h=setup(),p=h.helper.ensure();h.calls[0].bridge.onservicecallback(raw);await assert.rejects(p);
    assert.equal(h.helper.isReady(),false);assert.equal(h.timers.size,0);
  }
});

test('directory permission errors show the log only when the helper wrote it',async()=>{
  for(const [errorCode,code] of [['helper_directory_writable','HELPER_PERMISSIONS'],['helper_owner_mismatch','HELPER_OWNER']]){
    for(const logWritten of [true,false,undefined]){
      const h=setup(),p=h.helper.ensure();
      h.reply(0,{returnValue:false,errorCode,logWritten},{returnValue:false,error:'Command failed'});
      await assert.rejects(p,e=>e.code===code && e.message.includes('/var/lib/webosbrew/lg-xmb-startup.log')===(logWritten===true));
      assert.equal(h.helper.isReady(),false);
      assert.equal(h.calls.length,1,'No permission bypass or automatic retry');
    }
  }
});

test('a prolonged setup lock wait is transient, shared by callers, and rechecked on the next menu request',async()=>{
  const h=setup(),first=h.helper.ensure();
  assert.equal(h.helper.ensure(),first);
  h.reply(0,{returnValue:false,errorCode:'setup_in_progress'},{returnValue:false,error:'Command failed'});
  await assert.rejects(first,e=>e.code==='SETUP_PENDING');
  assert.equal(h.helper.getState().phase,'waiting');
  assert.equal(h.helper.isReady(),false);
  assert.equal(h.calls.length,1,'No automatic RPC or uncertain-write retry loop');
  const next=h.helper.ensure();
  assert.equal(h.helper.ensure(),next);
  assert.equal(h.calls.length,2);
  assert.equal(h.helper.getState().phase,'starting');
  assert.equal(h.helper.getState().code,null);
  h.reply(1,ready);await next;
  assert.equal(h.helper.isReady(),true);
  assert.equal(h.helper.getState().code,null);
});

test('a true worker lock conflict stays distinct and cannot trigger an automatic second worker',async()=>{
  const h=setup(),p=h.helper.ensure();
  h.reply(0,{returnValue:false,errorCode:'worker_lock_busy'},{returnValue:false,error:'Command failed'});
  await assert.rejects(p,e=>e.code==='WORKER_BUSY');
  await assert.rejects(h.helper.ensure(),e=>e.code==='WORKER_BUSY');
  assert.equal(h.helper.isReady(),false);
  assert.equal(h.calls.length,1);
  assert.match(h.helper.getState().message,/No additional worker/);
});

test('fresh capture heartbeat overrides an unconfirmed setup without rerunning it',async()=>{
 const h=setup(),op=h.helper.ensure();h.reply(0,{returnValue:false,errorCode:'helper_bundle_mismatch'});await assert.rejects(op);
 let xhr,count=0;h.window.XMLHttpRequest=class{constructor(){xhr=this;count++;}open(method,url){assert.equal(method,'GET');assert.match(url,/^thumbnails\/status.json\?t=/);}send(){}};
 const first=h.helper.checkCapture(),second=h.helper.checkCapture();assert.equal(first,second);assert.equal(count,1);
 xhr.status=0;xhr.responseText=JSON.stringify({version:1,state:'idle',updatedAt:Date.now()/1000,captures:{}});xhr.onload();
 assert.equal(await first,'running');assert.equal(h.helper.getState().captureHealth,'running');assert.equal(h.helper.getState().phase,'failed');assert.equal(h.calls.length,1);
});
test('capture health distinguishes stale, stopped, skipped and unreadable reports',async()=>{
 for(const [state,age,expected] of [['captured',100,'stale'],['stopped',0,'stopped'],['skipped',0,'skipped'],['waiting',0,'running'],['bogus',0,'unknown']]){
  const h=setup();h.window.XMLHttpRequest=class{open(){}send(){this.status=200;this.responseText=JSON.stringify({version:1,state,updatedAt:Date.now()/1000-age});this.onload();}};
  assert.equal(await h.helper.checkCapture(),expected);
 }
 const h=setup();h.window.XMLHttpRequest=class{open(){}send(){this.ontimeout();}};
 assert.equal(await h.helper.checkCapture(),'unknown');assert.equal(h.calls.length,0);
});


function lifecycleSetup() {
  let now = 100000, sequence = 0;
  const timers = new Map(), calls = [], reads = [], events = [];
  const window = {
    C5TV: { isTV: () => true },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: { dispatchEvent(event) { events.push({ type: event.type, health: window.LGXMBHelper.getState().captureHealth }); } },
    Event: class { constructor(type) { this.type = type; } },
    PalmServiceBridge: class {
      call(uri, body) { calls.push(this); }
      cancel() {}
    },
    XMLHttpRequest: class {
      constructor() { reads.push(this); }
      open(method, url) { assert.equal(method, 'GET'); assert.match(url, /^thumbnails\/status.json\?t=/); }
      send() {}
      abort() { this.aborted = true; }
    }
  };
  vm.runInNewContext(source, { window, Promise, Date: { now: () => now } });
  const helper = window.LGXMBHelper;
  async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id); now = timer.at; timer.fn(); await flush();
    }
    now = end; await flush();
  }
  function replySetup(value = ready, index = calls.length - 1) {
    calls[index].onservicecallback(JSON.stringify({ returnValue: true, stdoutString: JSON.stringify(value), stderrString: '' }));
  }
  async function confirmed(value = ready) { const operation = helper.ensure(); replySetup(value); await operation; }
  async function heartbeat(state, age = 0, index = reads.length - 1) {
    const xhr = reads[index]; xhr.status = 200;
    xhr.responseText = JSON.stringify({ version: 1, updatedAt: now / 1000 - age, state });
    xhr.onload(); await flush();
  }
  return { helper, timers, calls, reads, events, flush, advance, replySetup, confirmed, heartbeat };
}

test('resume waits for the worker, deduplicates events and attempts recovery only once', async () => {
  const h = lifecycleSetup(); await h.confirmed();
  h.helper.resume(); h.helper.resume();
  assert.equal(h.reads.length, 1);
  await h.heartbeat('captured', 100);
  assert.equal(h.helper.getState().captureRecovering, true);
  await h.advance(9999); assert.equal(h.calls.length, 1);
  await h.advance(1); assert.equal(h.reads.length, 2);
  await h.heartbeat('captured', 110);
  assert.equal(h.calls.length, 2, 'one setup request after a second stale heartbeat');
  h.helper.resume(); assert.equal(h.calls.length, 2);
  h.replySetup(); await h.flush(); await h.heartbeat('captured', 110);
  await h.advance(60000);
  assert.equal(h.calls.length, 2, 'a still-stale worker does not cause a recovery loop');
});

test('a heartbeat refreshed during the resume grace avoids any setup request', async () => {
  const h = lifecycleSetup(); await h.confirmed();
  h.helper.resume(); await h.heartbeat('captured', 100);
  await h.advance(10000); await h.heartbeat('idle');
  assert.equal(h.calls.length, 1); assert.equal(h.helper.getState().captureHealth, 'running');
});

test('suspend cancels delayed recovery and ignores a late read after the next resume', async () => {
  const h = lifecycleSetup(); await h.confirmed();
  h.helper.resume();
  const xhr = h.reads[0], lateRead = xhr.onload;
  const lateTimer = [...h.timers.values()].find(timer => timer.delay === 10000).fn;
  h.helper.suspend(); assert.equal(xhr.aborted, true);
  h.helper.resume(); await h.heartbeat('idle');
  xhr.status = 200; xhr.responseText = JSON.stringify({version: 1, updatedAt: 0, state: 'stopped'});
  lateRead(); lateTimer(); await h.flush();
  assert.equal(h.helper.getState().captureHealth, 'running');
  assert.equal(h.calls.length, 1); assert.equal(h.reads.length, 2);
  h.helper.suspend(); await h.advance(60000); assert.equal(h.calls.length, 1);
});

test('manual Retry supersedes delayed resume recovery and shares an in-flight setup', async () => {
  const h = lifecycleSetup(); await h.confirmed();
  h.helper.resume(); await h.heartbeat('stopped');
  const retry = h.helper.retry(); assert.equal(h.helper.retry(), retry);
  assert.equal(h.helper.getState().captureRecovering, false);
  h.replySetup(); await retry; await h.advance(10000);
  assert.equal(h.calls.length, 2); assert.equal(h.reads.length, 1);
});

test('uncertain setup timeouts stay sticky across resume and status watching', async () => {
  const h = lifecycleSetup();
  const operation = h.helper.ensure(), rejected = assert.rejects(operation, error => error.code === 'TIMEOUT');
  await h.advance(45000); await rejected;
  h.helper.resume(); h.helper.watchCapture(true); await h.heartbeat('stopped');
  await h.advance(10000); await h.heartbeat('stopped');
  assert.equal(h.calls.length, 1); assert.equal(h.helper.getState().code, 'TIMEOUT');
  await assert.rejects(h.helper.ensure(), error => error.code === 'TIMEOUT');
});

test('a recovery RPC timeout is not retried after another suspend and resume', async () => {
  const h = lifecycleSetup(); await h.confirmed();
  h.helper.resume(); await h.heartbeat('stopped');
  await h.advance(10000); await h.heartbeat('stopped');
  assert.equal(h.calls.length, 2); await h.advance(45000);
  assert.equal(h.helper.getState().code, 'TIMEOUT');
  h.helper.suspend(); h.helper.resume(); await h.heartbeat('stopped'); await h.advance(10000);
  assert.equal(h.calls.length, 2);
});

test('watching capture updates health without native writes and stops when the menu closes', async () => {
  const h = lifecycleSetup(); await h.confirmed({ ...ready, captureRunning: false });
  h.helper.resume(); h.helper.watchCapture(true);
  await h.heartbeat('stopped');
  await h.advance(5000); await h.heartbeat('idle');
  assert.equal(h.helper.getState().captureHealth, 'running');
  assert.ok(h.events.some(event => event.health === 'running'));
  assert.equal(h.calls.length, 1);
  h.helper.watchCapture(false); await h.advance(15000); assert.equal(h.reads.length, 2);
});

test('waiting-for-app is distinct from an unreadable heartbeat and neither triggers recovery', async () => {
  for (const state of ['waiting_for_app', 'unrecognized']) {
    const h = lifecycleSetup(); await h.confirmed();
    h.helper.resume(); await h.heartbeat(state);
    await h.advance(10000); await h.heartbeat(state);
    assert.equal(h.helper.getState().captureHealth, state === 'waiting_for_app' ? 'waiting' : 'unknown');
    assert.equal(h.calls.length, 1);
  }
});

test('destroy aborts health reads and prevents timers or late callbacks from restarting work', async () => {
  const h = lifecycleSetup(); await h.confirmed();
  h.helper.resume(); h.helper.watchCapture(true);
  const read = h.reads[0], late = read.onload;
  h.helper.destroy(); read.status = 200; read.responseText = '{}'; late();
  h.helper.resume(); h.helper.watchCapture(true); await h.advance(60000);
  assert.equal(read.aborted, true); assert.equal(h.reads.length, 1); assert.equal(h.calls.length, 1);
  await assert.rejects(h.helper.retry());
});

const appSource = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
function panelState(state, mode = 'cached', focusedRetry = false) {
  const choice = {}, retry = { hidden: false }, status = { textContent: '' };
  const nodes = { helperStatus: status, retryHelper: retry, modalContent: { querySelector: () => choice } };
  const context = { window: { LGXMBHelper: {} }, LGXMBHelper: { getState: () => state },
    preferences: { previewMode: mode }, document: { activeElement: focusedRetry ? retry : choice },
    $: id => nodes[id], statusText: (node, text) => node.textContent = text,
    LGXMBMenuFocus: target => { context.document.activeElement = target; } };
  vm.runInNewContext(appSource.slice(appSource.indexOf('  function helperStatusMessage('),
    appSource.indexOf('  function watchHelperStatus(')) + ';updateHelperStatus();', context);
  return { message: status.textContent, retryHidden: retry.hidden, focus: context.document.activeElement, choice };
}

test('failed capture startup and unreadable status remain actionable in Input previews', () => {
  for (const captureRunning of [false, true]) {
    const panel = panelState({ phase: 'ready', ready: true, captureRunning, captureHealth: 'unknown' });
    assert.match(panel.message, captureRunning ? /status unavailable/i : /did not start/i);
    assert.equal(panel.retryHidden, false);
  }
});

test('fresh capture suppresses an old setup error and restores focus when Retry disappears', () => {
  const panel = panelState({ phase: 'failed', ready: false, captureRunning: false, captureHealth: 'running' }, 'cached', true);
  assert.equal(panel.message, ''); assert.equal(panel.retryHidden, true); assert.equal(panel.focus, panel.choice);
  assert.equal(panelState({phase: 'ready', ready: true, captureRunning: false, captureHealth: 'stopped'}, 'live').message, '');
});


test('a confirmed worker with an explicitly missing heartbeat is re-ensured once after grace', async () => {
  const h = lifecycleSetup(); await h.confirmed();
  function missing() { const xhr = h.reads.at(-1); xhr.status = 404; xhr.responseText = ''; xhr.onload(); }
  h.helper.resume(); missing(); await h.flush();
  assert.equal(h.helper.getState().captureHealth, 'missing');
  await h.advance(10000); missing(); await h.flush(); assert.equal(h.calls.length, 2);
  h.replySetup(); await h.flush();
  assert.equal(h.events.filter(event => event.type === 'lg-xmb-helper-recovered').length, 1);
  await h.heartbeat('idle'); await h.advance(60000); assert.equal(h.calls.length, 2);
});

test('recovery completion while suspended cannot refresh media and later heartbeat reads do not emit recovery', async () => {
  const h = lifecycleSetup(); await h.confirmed(); h.helper.resume(); await h.heartbeat('idle');
  const retry = h.helper.retry(); h.helper.suspend(); h.replySetup(); await retry; await h.flush();
  assert.equal(h.events.filter(event => event.type === 'lg-xmb-helper-recovered').length, 0);
  h.helper.resume(); await h.heartbeat('idle');
  assert.equal(h.events.filter(event => event.type === 'lg-xmb-helper-recovered').length, 0);
});
