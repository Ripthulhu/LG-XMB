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
  return {helper:window.LGXMBHelper,calls,timers,reply};
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
  assert.match(h.helper.getState().message,/capture worker did not start/);
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
