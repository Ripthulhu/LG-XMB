/* Background activity control client. SPDX-License-Identifier: GPL-3.0-or-later */
(function(){'use strict';
var adapter=null,previewState=null,previewKey='openxmb-c5-background-preview-v1';
function unavailable(){return new Error('Background controls are unavailable. Please try again.');}
function checkedState(value){
  if(!value||value.available!==true||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.items))throw unavailable();
  var seen=Object.create(null),items=value.items.map(function(item){
    if(!item||typeof item.id!=='string'||!item.id||seen[item.id]||typeof item.title!=='string'||!item.title||['apps','privacy'].indexOf(item.group)===-1||typeof item.enabled!=='boolean'||typeof item.supported!=='boolean')throw unavailable();
    seen[item.id]=true;
    return{id:item.id,title:item.title,group:item.group,description:typeof item.description==='string'?item.description:'',enabled:item.enabled,status:typeof item.status==='string'?item.status:'',supported:item.supported};
  });
  return{available:true,revision:value.revision,items:items};
}
function isTV(){return !!(window.C5TV&&window.C5TV.isTV());}
function getAdapter(){return adapter||window.C5ProcessAdapter||null;}
function preview(){
  if(!previewState){
    var definitions=[
      ['home','LG Home','apps','Closes the original Home screen after you return here.',true],
      ['browser','Web Browser','apps','May take longer to open. Unsaved browsing state can be lost.',false],
      ['search','Search','apps','Search opens when needed. Check voice search and accessibility before keeping this on.',false],
      ['hdmi1','HDMI 1','apps','May slow input switching. An active live preview stays open.',false],
      ['hdmi2','HDMI 2','apps','May slow input switching. An active live preview stays open.',false],
      ['hdmi3','HDMI 3','apps','May slow input switching. Check connected devices and HDMI control.',false],
      ['hdmi4','HDMI 4','apps','May slow input switching. Check connected devices and HDMI control.',false],
      ['livetv','Live TV','apps','May take longer to open television channels.',false],
      ['ads','Advertising service','privacy','May affect LG promotions. Other apps retain their own advertising and privacy settings.',false],
      ['usage','Usage context and suggestions','privacy','May affect recommendations, recent viewing activity, alarms and reminders.',false],
      ['voice','LG voice commands','privacy','Stops LG voice recognition and command handling in Home. Voice search and dictation may be unavailable until Allow. This does not mute microphones.',false]
    ];
    previewState={available:true,revision:0,items:definitions.map(function(item){return{id:item[0],title:item[1],group:item[2],description:item[3],enabled:item[4],status:'',supported:true};})};
    try{var saved=JSON.parse(localStorage.getItem(previewKey)||'null');if(saved){previewState.revision=Number.isSafeInteger(saved.revision)&&saved.revision>=0?saved.revision:0;previewState.items.forEach(function(item){if(saved.enabled&&typeof saved.enabled[item.id]==='boolean')item.enabled=saved.enabled[item.id];});}}catch(ignore){}
  }
  return checkedState(previewState);
}
function call(method,args){
  var current=getAdapter();
  if(current&&typeof current[method]==='function')return Promise.resolve().then(function(){return current[method].apply(current,args);});
  if(isTV())return Promise.reject(unavailable());
  if(method==='getState')return Promise.resolve(preview());
  if(method==='prepareLaunch')return Promise.resolve({prepared:true,preview:true});
  var state=preview(),item=state.items.find(function(candidate){return candidate.id===args[0];});
  if(!item||!item.supported||state.revision!==args[2])return Promise.reject(new Error('Settings changed. Please try again.'));
  item.enabled=args[1];state.revision++;var saved={revision:state.revision,enabled:{}};state.items.forEach(function(candidate){saved.enabled[candidate.id]=candidate.enabled;});
  try{localStorage.setItem(previewKey,JSON.stringify(saved));}catch(error){return Promise.reject(new Error('This device could not save your preference.'));}
  previewState=state;return Promise.resolve(checkedState(state));
}
window.C5ProcessControl={
  useAdapter:function(value){adapter=value;},
  getState:function(){return call('getState',[]).then(checkedState);},
  setEnabled:function(id,enabled,revision){if(typeof id!=='string'||!id||typeof enabled!=='boolean'||!Number.isSafeInteger(revision)||revision<0)return Promise.reject(new Error('Invalid background setting.'));return call('setEnabled',[id,enabled,revision]).then(checkedState);},
  prepareLaunch:function(appId){if(typeof appId!=='string'||!appId)return Promise.reject(new Error('Invalid app.'));return call('prepareLaunch',[appId]);}
};
})();
