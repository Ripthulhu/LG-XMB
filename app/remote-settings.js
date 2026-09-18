/* Back button setting view. SPDX-License-Identifier: GPL-3.0-or-later */
(function(){'use strict';
var generation=0,opened=false,errorMessage='',options=null;
function content(){return document.getElementById('modalContent');}
function element(tag,cls,text){var node=document.createElement(tag);node.className=cls;if(text)node.textContent=text;return node;}
function focusKey(){var node=document.activeElement;return node&&node.getAttribute('data-remote-choice');}
function group(label,choices,value,handler){
  var section=element('section','choice-group');section.setAttribute('role','group');section.setAttribute('aria-label',label);section.appendChild(element('h3','',label));var buttons=element('div','choice-options');section.appendChild(buttons);
  choices.forEach(function(choice){var button=element('button','option');button.type='button';button.setAttribute('data-remote-choice',label+':'+choice[0]);button.setAttribute('aria-pressed',String(value===choice[0]));var check=element('span','option-check',value===choice[0]?'✓':'');check.setAttribute('aria-hidden','true');button.appendChild(element('span','',choice[1]));button.appendChild(check);button.addEventListener('click',function(){handler(choice[0]);});buttons.appendChild(button);});content().appendChild(section);return section;
}
function render(key,initial){
  var root=content(),scroll=root.scrollTop;root.textContent='';
  if(errorMessage){var error=element('p','background-error',errorMessage);error.setAttribute('role','alert');root.appendChild(error);}
  var back=group('Back button',[['stay','Stay in Home'],['lg','Show exit prompt']],options.getBack(),function(value){
    errorMessage='';try{options.setBack(value);}catch(error){errorMessage=error.message||'Could not save the Back button setting.';}render('Back button:'+value,false);
  });
  back.appendChild(element('p','remote-note','Back closes an open panel first. From the main menu, it stays here or opens the TV exit prompt.'));
  var target=null;[].forEach.call(root.querySelectorAll('[data-remote-choice]'),function(button){if(button.getAttribute('data-remote-choice')===key)target=button;});
  if(!target&&initial)target=root.querySelector('[aria-pressed="true"]')||root.querySelector('button');
  if(target)target.focus();root.scrollTop=scroll;
}
window.C5RemoteSettings={open:function(callbacks){generation++;opened=true;errorMessage='';options=callbacks;render(null,true);},close:function(){generation++;opened=false;},getState:function(){return{back:options?options.getBack():null};}};
})();
