/* Remote button settings view. SPDX-License-Identifier: GPL-3.0-or-later */
(function(){'use strict';
var generation=0,opened=false,state=null,pending=null,reading=null,errorMessage='',options=null;
function content(){return document.getElementById('modalContent');}
function active(token){return opened&&token===generation&&!document.hidden;}
function element(tag,cls,text){var node=document.createElement(tag);node.className=cls;if(text)node.textContent=text;return node;}
function focusKey(){var node=document.activeElement;return node&&node.getAttribute('data-remote-choice');}
function group(label,choices,value,disabled,handler){
  var section=element('section','choice-group');section.setAttribute('role','group');section.setAttribute('aria-label',label);section.appendChild(element('h3','',label));var buttons=element('div','choice-options');section.appendChild(buttons);
  choices.forEach(function(choice){var button=element('button','option');button.type='button';button.setAttribute('data-remote-choice',label+':'+choice[0]);button.setAttribute('aria-pressed',String(value===choice[0]));button.setAttribute('aria-disabled',String(disabled));button.appendChild(element('span','',choice[1]));var check=element('span','option-check',value===choice[0]?'✓':'');check.setAttribute('aria-hidden','true');button.appendChild(check);button.addEventListener('click',function(){if(!disabled)handler(choice[0]);});buttons.appendChild(button);});content().appendChild(section);return section;
}
function render(key,initial){
  var root=content(),scroll=root.scrollTop;root.textContent='';root.setAttribute('aria-busy',String(!!pending||!!reading));
  if(errorMessage){var error=element('p','background-error',errorMessage);error.setAttribute('role','alert');root.appendChild(error);}
  var home=group('Home button',[['custom','Our Home'],['stock','LG Home']],state?state.home:null,!state||!!pending||!!reading||state.home==='other',changeHome);
  var note=pending?'Saving…':!state?'Checking the TV’s current setting…':state.home==='other'?'Another app is assigned to the Home button.':'Choosing LG Home also allows it in Background activity. Other background choices stay as they are.';
  home.appendChild(element('p','remote-note',note));
  if(!state&&errorMessage){var retry=element('button','option','Try again');retry.type='button';retry.addEventListener('click',function(){load(generation);});root.appendChild(retry);}
  var back=group('Back button',[['stay','Stay in Home'],['lg','LG behavior']],options.getBack(),false,function(value){
    errorMessage='';try{options.setBack(value);}catch(error){errorMessage=error.message||'Could not save the Back button setting.';}render('Back button:'+value,false);
  });
  back.appendChild(element('p','remote-note','Panels close first. LG behavior uses the TV’s exit prompt from the main menu.'));
  var target=null;[].forEach.call(root.querySelectorAll('[data-remote-choice]'),function(button){if(button.getAttribute('data-remote-choice')===key)target=button;});
  if(!target&&initial)target=root.querySelector('[aria-pressed="true"]')||root.querySelector('button');
  if(target)target.focus();root.scrollTop=scroll;
}
function load(token){
  var settled=pending||reading;
  if(settled){settled.then(function(){if(active(token))load(token);});return;}
  if(!active(token))return;
  reading=C5RemoteControl.getState().then(function(value){if(!active(token))return;state=value;errorMessage='';}).catch(function(error){if(active(token))errorMessage=error.message||'Could not read the Home button setting.';}).then(function(){reading=null;if(active(token))render(focusKey(),true);});
  render(focusKey(),false);
}
function changeHome(home){
  if(!state||pending||reading||home===state.home)return;
  var token=generation;errorMessage='';
  pending=C5RemoteControl.setHome(home,state.revision).then(function(value){if(active(token))state=value;}).catch(function(error){
    if(!active(token))return;errorMessage=error.message||'Could not change the Home button setting.';
    if(document.hidden)return;
    return C5RemoteControl.getState().then(function(value){if(active(token))state=value;}).catch(function(){if(active(token))errorMessage='Could not confirm the current Home button setting. Please try again.';});
  }).then(function(){pending=null;if(active(token))render(focusKey(),false);});
  render('Home button:'+home,false);
}
window.C5RemoteSettings={open:function(callbacks){generation++;opened=true;state=null;errorMessage='';options=callbacks;render(null,true);load(generation);},close:function(){generation++;opened=false;content().removeAttribute('aria-busy');},getState:function(){return{home:state?state.home:null,homeKeepClosed:state?state.homeKeepClosed:null,revision:state?state.revision:null,pending:!!pending||!!reading};}};
document.addEventListener('visibilitychange',function(){if(opened&&!document.hidden)load(generation);});
})();
