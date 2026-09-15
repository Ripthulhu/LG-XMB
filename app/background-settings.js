/* Background activity settings view. SPDX-License-Identifier: GPL-3.0-or-later */
(function(){'use strict';
var generation=0,state=null,pending=null,pendingId=null,errorMessage='',opened=false,pageVisible=true,refreshTimer=null,readRequest=null,readGeneration=0,renderDirty=false;
function content(){return document.getElementById('modalContent');}
function active(token){return opened&&pageVisible&&token===generation&&!document.hidden;}
function stopRefresh(){clearTimeout(refreshTimer);refreshTimer=null;}
function scheduleRefresh(delay){stopRefresh();if(active(generation)&&!pending&&!readRequest)refreshTimer=setTimeout(function(){refreshTimer=null;refresh();},typeof delay==='number'?delay:5000);}
function element(tag,className,text){var node=document.createElement(tag);node.className=className;if(text)node.textContent=text;return node;}
function focusedId(){var active=document.activeElement;return active&&active.getAttribute('data-process-id');}
function focusRow(id,fallback){var rows=content().querySelectorAll('[data-process-id]'),target=null;[].forEach.call(rows,function(row){if(row.getAttribute('data-process-id')===id)target=row;});if(!target&&fallback)target=rows[0]||content().querySelector('button');if(target)target.focus();}
function render(focusId,initial,preserveScroll){
  var root=content(),scrollTop=root.scrollTop;root.textContent='';root.setAttribute('aria-busy',String(!!pending));
  if(errorMessage){var error=element('p','background-error',errorMessage);error.setAttribute('role','alert');root.appendChild(error);}
  if(!state){
    if(errorMessage){var retry=element('button','option background-retry','Try again');retry.type='button';retry.addEventListener('click',function(){load(generation);});root.appendChild(retry);retry.focus();}
    else{var loading=element('p','background-loading','Loading settings…');loading.setAttribute('role','status');root.appendChild(loading);}
    return;
  }
  ['apps','privacy'].forEach(function(group){
    var items=state.items.filter(function(item){return item.group===group;});if(!items.length)return;
    var section=element('section','background-group');section.appendChild(element('h3','background-heading',group==='apps'?'Apps':'Privacy'));
    items.forEach(function(item){
      // The helper's enabled flag means keep closed; the switch means Allow.
      var allowed=!item.enabled;
      var button=element('button','background-option');button.type='button';button.setAttribute('role','switch');button.setAttribute('aria-label',item.title+': allow background activity');button.setAttribute('aria-checked',String(allowed));button.setAttribute('aria-disabled',String(!item.supported||!!pending));button.setAttribute('data-process-id',item.id);
      var copy=element('span','background-option-copy');copy.appendChild(element('span','background-option-title',item.title));
      if(item.description){var description=element('span','background-option-description',item.description);description.id='background-description-'+state.items.indexOf(item);button.setAttribute('aria-describedby',description.id);copy.appendChild(description);}
      var status=pendingId===item.id?'Saving…':item.status; if(status)copy.appendChild(element('span','background-option-status',status));
      button.appendChild(copy);var control=element('span','background-option-control');control.setAttribute('aria-hidden','true');control.appendChild(element('span','background-option-value',item.enabled?'Keep closed':'Allow'));control.appendChild(element('span','background-switch'));button.appendChild(control);
      button.addEventListener('click',function(){if(!pending&&item.supported)save(item);});section.appendChild(button);
    });root.appendChild(section);
  });
  focusRow(focusId,initial);
  if(preserveScroll)root.scrollTop=scrollTop;
  renderDirty=false;
}
function refresh(){
  var token=generation;if(!active(token))return;
  if(pending||readRequest){scheduleRefresh();return;}
  var readToken=++readGeneration,request=C5ProcessControl.getState();readRequest=request;
  request.then(function(value){
    if(!active(token)||readToken!==readGeneration||pending)return;
    var initial=!state,changed=initial||renderDirty||JSON.stringify(state.items)!==JSON.stringify(value.items)||!!errorMessage;
    state=value;errorMessage='';
    if(changed)render(focusedId(),initial,!initial);
  }).catch(function(error){
    if(!active(token)||readToken!==readGeneration||pending)return;
    var message=error.message||'Could not refresh background settings. Please try again.';
    if(message!==errorMessage){errorMessage=message;render(focusedId(),!state,!!state);}
  }).then(function(){
    if(readRequest===request)readRequest=null;
    scheduleRefresh();
  });
}
function load(token){
  stopRefresh();errorMessage='';render(null,false);
  var settled=pending?pending.catch(function(){}):Promise.resolve();
  settled.then(function(){if(active(token))refresh();});
}
function save(item){
  var token=generation,enabled=!item.enabled;
  if(!active(token))return;
  stopRefresh();readGeneration++;errorMessage='';pendingId=item.id;
  var settled=readRequest?readRequest.catch(function(){}):Promise.resolve();
  pending=settled.then(function(latest){
    if(!active(token))return;
    if(latest)state=latest;
    return C5ProcessControl.setEnabled(item.id,enabled,state.revision);
  }).then(function(value){if(token!==generation||!value)return;state=value;}).catch(function(error){
    if(!active(token))return;
    errorMessage=error.message||'Could not save this setting. Please try again.';
    // A reply can be lost after the setting was saved. Read its actual value.
    return C5ProcessControl.getState().then(function(value){if(token===generation)state=value;}).catch(function(){if(token===generation)errorMessage='Could not confirm the current settings. Please try again.';});
  }).then(function(){
    pending=null;pendingId=null;if(token!==generation)return;
    if(active(token)){var focusId=focusedId();render(focusId,false,true);scheduleRefresh();}else renderDirty=true;
  });
  render(item.id,false,true);
}
window.C5BackgroundSettings={
  open:function(){generation++;opened=true;state=null;renderDirty=true;errorMessage='';load(generation);},
  close:function(){generation++;readGeneration++;opened=false;stopRefresh();content().removeAttribute('aria-busy');}
};
document.addEventListener('visibilitychange',function(){
  if(document.hidden){readGeneration++;stopRefresh();}
  else if(opened)scheduleRefresh(0);
});
window.addEventListener('pagehide',function(){pageVisible=false;readGeneration++;stopRefresh();});
window.addEventListener('pageshow',function(){pageVisible=true;if(opened)scheduleRefresh(0);});
window.addEventListener('beforeunload',function(){opened=false;readGeneration++;stopRefresh();});
})();
