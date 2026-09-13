/* Remote button settings client. SPDX-License-Identifier: GPL-3.0-or-later */
(function(){'use strict';
var previewKey='openxmb-c5-remote-preview-v1';
function unavailable(){return new Error('Remote button settings are unavailable. Please try again.');}
function state(value){if(!value||value.available!==true||!Number.isSafeInteger(value.revision)||value.revision<0||['custom','stock','other'].indexOf(value.home)===-1||typeof value.homeKeepClosed!=='boolean')throw unavailable();return{available:true,revision:value.revision,home:value.home,homeKeepClosed:value.homeKeepClosed};}
function isTV(){return !!(window.C5TV&&C5TV.isTV());}
function previewHome(){try{return localStorage.getItem(previewKey)==='stock'?'stock':'custom';}catch(ignore){return'custom';}}
function getState(){
  if(window.C5RemoteAdapter&&typeof C5RemoteAdapter.getState==='function')return Promise.resolve().then(function(){return C5RemoteAdapter.getState();}).then(state);
  if(isTV())return Promise.reject(unavailable());
  return C5ProcessControl.getState().then(function(value){var home=value.items.find(function(item){return item.id==='home';});return state({available:true,revision:value.revision,home:previewHome(),homeKeepClosed:!!(home&&home.enabled)});});
}
function setHome(home,revision){
  if(['custom','stock'].indexOf(home)===-1||!Number.isSafeInteger(revision)||revision<0)return Promise.reject(new Error('Choose a valid Home button setting.'));
  if(window.C5RemoteAdapter&&typeof C5RemoteAdapter.setHome==='function')return Promise.resolve().then(function(){return C5RemoteAdapter.setHome(home,revision);}).then(state);
  if(isTV())return Promise.reject(unavailable());
  return getState().then(function(current){
    if(current.revision!==revision)throw new Error('Settings changed. Please try again.');
    var change=home==='stock'&&current.homeKeepClosed?C5ProcessControl.setEnabled('home',false,revision):Promise.resolve();
    return change.then(function(){try{localStorage.setItem(previewKey,home);}catch(ignore){throw new Error('This device could not save your preference.');}return getState();});
  });
}
window.C5RemoteControl={getState:getState,setHome:setHome};
})();
