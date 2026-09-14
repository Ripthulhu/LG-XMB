/* Bundled helper setup through the TV's existing Homebrew service.
 * SPDX-License-Identifier: GPL-3.0-or-later */
(function(root){
  'use strict';
  var URI='luna://org.webosbrew.hbchannel.service/exec';
  var COMMAND='if [ -x /usr/bin/python3 ]; then /usr/bin/python3 -I -B '+
    '/media/developer/apps/usr/palm/applications/org.local.openxmb.c5/helper-startup.py ensure; '+
    'else printf \'%s\\n\' \'{"returnValue":false,"errorCode":"python_missing"}\'; fi';
  var pending=null, confirmed=null, failure=null, phase='idle';
  var messages={
    EXEC_UNAVAILABLE:'Homebrew helper execution is unavailable. Check Homebrew Channel, then retry setup.',
    ROOT_REQUIRED:'Homebrew ran the helper without root privileges. Check its root status, then retry setup.',
    PYTHON_MISSING:'The TV has no usable Python 3 interpreter for the helper.',
    PYTHON_TOO_OLD:'The helper needs Python 3.7 or newer on the TV.',
    BUNDLE_INCOMPLETE:'The installed helper is incomplete. Reinstall the lg-xmb IPK.',
    BUNDLE_MISMATCH:'The installed app and helper do not match. Reinstall the lg-xmb IPK.',
    HELPER_PERMISSIONS:'The installed helper directory is writable by other users. Install a corrected lg-xmb IPK.',
    HELPER_OWNER:'The installed helper directory is not owned by root. Its ownership was not changed.',
    CONFIG_CONFLICT:'Old and new helper settings differ. Both were preserved; resolve the migration before continuing.',
    BUSY:'Helper setup is busy. Wait for it to finish before retrying.',
    SETUP_PENDING:'Another lg-xmb setup is still finishing. Open this menu again to check its progress.',
    WORKER_BUSY:'The worker lock is held without a verified reusable helper. No additional worker was started.',
    TIMEOUT:'Helper setup was not confirmed. It may still be running; no retry was sent.',
    SETUP_FAILED:'Helper setup failed. Existing settings were preserved. Check the helper files before retrying.'
  };
  function problem(code){var e=new Error(messages[code]||messages.SETUP_FAILED);e.code=code;return e;}
  function object(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
  function emit(){if(root.document&&typeof root.Event==='function')root.document.dispatchEvent(new root.Event('lg-xmb-helper-status'));}
  function parse(raw){
    var outer,value;
    try{
      if(typeof raw!=='string'||raw.length>65536)throw new Error();
      outer=JSON.parse(raw);
      if(!object(outer)||typeof outer.stdoutString!=='string'||outer.stdoutString.length>8192)throw new Error();
      value=JSON.parse(outer.stdoutString);
      if(!object(value))throw new Error();
    }catch(ignore){throw problem('EXEC_UNAVAILABLE');}
    if(value.returnValue===false){
      var codes={python_missing:'PYTHON_MISSING',python_too_old:'PYTHON_TOO_OLD',
        bundle_incomplete:'BUNDLE_INCOMPLETE',invalid_helper_bundle:'BUNDLE_MISMATCH',
        helper_bundle_mismatch:'BUNDLE_MISMATCH',untrusted_app_manifest:'BUNDLE_MISMATCH',
        helper_directory_writable:'HELPER_PERMISSIONS',helper_owner_mismatch:'HELPER_OWNER',
        legacy_config_conflict:'CONFIG_CONFLICT',helper_busy:'BUSY',
        setup_in_progress:'SETUP_PENDING',bundle_lock_busy:'SETUP_PENDING',worker_lock_busy:'WORKER_BUSY'};
      if(value.errorCode==='root_required'&&Number.isInteger(value.effectiveUid)&&value.effectiveUid>0)throw problem('ROOT_REQUIRED');
      var error=problem(codes[value.errorCode]||'SETUP_FAILED');
      if(value.logWritten===true)error.message+=' Log: /var/lib/webosbrew/lg-xmb-startup.log';
      throw error;
    }
    if(outer.returnValue!==true||[outer.errorCode,outer.returnCode,outer.exitCode].some(function(code){return code!==undefined&&code!==0&&code!=='0';})||
       (outer.error!==undefined&&outer.error!==null&&outer.error!=='')||outer.stderrString||
       value.returnValue!==true||value.ready!==true||typeof value.captureRunning!=='boolean')throw problem('EXEC_UNAVAILABLE');
    return {ready:true,captureRunning:value.captureRunning};
  }
  function ensure(){
    if(confirmed)return Promise.resolve(confirmed);
    if(pending)return pending;
    // A bounded lock wait can expire before another setup finishes. This is
    // not a sticky session failure; the next caller may recheck. Other errors,
    // including an uncertain RPC timeout, still require an explicit retry.
    if(failure&&failure.code!=='SETUP_PENDING')return Promise.reject(failure);
    if(!root.C5TV||!root.C5TV.isTV()||typeof root.PalmServiceBridge!=='function')return Promise.reject(problem('EXEC_UNAVAILABLE'));
    failure=null;phase='starting';emit();
    // Keep the bridge alive until it replies. There are no downloads, generic
    // caller-supplied commands, root exploits or restart loops. Setup does not
    // assign Home or enable new background restrictions.
    var operation=new Promise(function(resolve,reject){
      var bridge,timer,done=false;
      function finish(error,value){
        if(done)return;done=true;root.clearTimeout(timer);
        if(bridge){bridge.onservicecallback=function(){};try{bridge.cancel();}catch(ignore){}}
        if(error)reject(error);else resolve(value);
      }
      try{
        bridge=new root.PalmServiceBridge();
        bridge.onservicecallback=function(raw){try{finish(null,parse(raw));}catch(error){finish(error);}};
        timer=root.setTimeout(function(){finish(problem('TIMEOUT'));},45000);
        bridge.call(URI,JSON.stringify({command:COMMAND}));
      }catch(ignore){finish(problem('EXEC_UNAVAILABLE'));}
    });
    pending=operation.then(function(value){confirmed=value;phase='ready';pending=null;emit();return value;},function(error){failure=error;phase=error.code==='SETUP_PENDING'?'waiting':'failed';pending=null;emit();throw error;});
    return pending;
  }
  function status(){
    return {phase:phase,ready:!!confirmed,captureRunning:!!(confirmed&&confirmed.captureRunning),
      code:failure?failure.code:null,message:failure?failure.message:phase==='starting'?'Preparing TV helper…':
        confirmed?(confirmed.captureRunning?'TV helper ready. Cached pictures appear after an input is viewed.':'Home controls are ready, but the capture worker did not start.'):'TV helper has not started.'};
  }
  root.LGXMBHelper=Object.freeze({ensure:ensure,isReady:function(){return !!confirmed;},getState:status,
    retry:function(){if(pending)return pending;failure=null;confirmed=null;return ensure();}});
}(typeof window!=='undefined'?window:globalThis));
