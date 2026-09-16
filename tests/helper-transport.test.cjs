'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/process-transport.js'),'utf8');
function setup(){
  const calls=[];let ready=false,resolveSetup,rejectSetup,ensureCalls=0;
  const setupPromise=new Promise((resolve,reject)=>{resolveSetup=()=>{ready=true;resolve();};rejectSetup=reject;});
  const window={C5TV:{isTV:()=>true},setTimeout,clearTimeout,
    LGXMBHelper:{isReady:()=>ready,ensure:()=>{ensureCalls++;return setupPromise;}},
    PalmServiceBridge:class{call(uri,body){calls.push({uri,body:JSON.parse(body),bridge:this});}cancel(){}}
  };
  vm.runInNewContext(source,{window,Promise});
  return {calls,adapter:window.C5ProcessAdapter,resolveSetup,rejectSetup,
    ensureCalls:()=>ensureCalls,reply(i,value,outer={}){calls[i].bridge.onservicecallback(JSON.stringify({returnValue:true,stdoutString:JSON.stringify(value),stderrString:'',...outer}));}};
}
test('Controller reads wait for packaged helper setup; normal launch preparation does not',async()=>{
  const h=setup(),read=h.adapter.getState();
  assert.equal(h.calls.length,0);
  assert.equal((await h.adapter.prepareLaunch('com.webos.app.hdmi1')).prepared,false);
  h.resolveSetup();await Promise.resolve();assert.equal(h.calls.length,1);
  assert.match(h.calls[0].body.command,/\/helper\/process_control.py get$/);
  h.reply(0,{returnValue:true,available:true,revision:0,items:[]});
  assert.equal((await read).revision,0);
});
test('cancelling while setup runs never sends a queued write',async()=>{
  const h=setup(),write=h.adapter.setEnabled('home',true,0);write.cancel();
  await assert.rejects(write,e=>e.code==='CANCELLED');
  h.resolveSetup();await Promise.resolve();assert.equal(h.calls.length,0);
});
test('setup failure propagates without sending a controller command',async()=>{
  const h=setup(),read=h.adapter.getState();
  h.rejectSetup(Object.assign(new Error('Bundled helper missing'),{code:'BUNDLE_INCOMPLETE'}));
  await assert.rejects(read,e=>e.code==='BUNDLE_INCOMPLETE');assert.equal(h.calls.length,0);
});
test('failed outer exec keeps a recognized helper error but can never grant success',async()=>{
  const h=setup();h.resolveSetup();
  const read=h.adapter.getState();
  h.reply(0,{returnValue:false,errorCode:'untrusted_app_manifest'},{returnValue:false,error:'Command failed'});
  await assert.rejects(read,e=>e.code==='HELPER_MISMATCH');
  const second=h.adapter.getState();
  h.reply(1,{returnValue:true,available:true,revision:0,items:[]},{returnValue:false,error:'Command failed'});
  await assert.rejects(second,e=>e.code==='SERVICE_ERROR');
});
