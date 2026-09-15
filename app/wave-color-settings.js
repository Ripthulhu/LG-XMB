/* lg-xmb colour controls. SPDX-License-Identifier: GPL-3.0-or-later */
(function(root){
  'use strict';
  function open(host,value,onChange){
    var state=root.LGXMBWaveColors.normalize(value),sections={};host.textContent='';
    function apply(){onChange(root.LGXMBWaveColors.normalize(state));}
    function section(label,key){
      var s=document.createElement('section');s.className='color-group';s.setAttribute('role','group');s.setAttribute('aria-label',label);
      var h=document.createElement('h3');h.textContent=label;s.appendChild(h);host.appendChild(s);sections[key]=s;return s;
    }
    function choices(label,key,values,columns){
      var s=section(label,key),box=document.createElement('div');box.className='color-choices';box.dataset.columns=String(columns||1);s.appendChild(box);
      values.forEach(function(pair){
        var b=document.createElement('button');b.className='option';b.textContent=pair[1];b.dataset.value=String(pair[0]);
        b.setAttribute('aria-pressed',String(state[key]===pair[0]));
        b.addEventListener('click',function(){state[key]=pair[0];Array.prototype.forEach.call(box.children,function(n){n.setAttribute('aria-pressed',String(n===b));});visibility();apply();});box.appendChild(b);
      });
    }
    function slider(label,key,min,max,step){
      var s=section(label,key),id='waveColor-'+key,l=document.createElement('label'),out=document.createElement('output'),input=document.createElement('input');
      l.htmlFor=id;l.textContent=label;input.id=id;input.type='range';input.min=min;input.max=max;input.step=step;input.value=state[key];input.setAttribute('aria-label',label);
      out.htmlFor=id;out.textContent=String(state[key]);l.appendChild(out);s.appendChild(l);s.appendChild(input);
      input.addEventListener('input',function(){state[key]=Number(input.value);out.textContent=input.value;apply();});
      // The visible label already names this group; avoid repeating the heading.
      s.querySelector('h3').hidden=true;
    }
    function visibility(){
      ['month','period'].forEach(function(key){if(sections[key])sections[key].hidden=state.mode!=='monthly';});
      ['red','green','blue','top','bottom'].forEach(function(key){if(sections[key])sections[key].hidden=state.mode!=='rgb';});
    }
    choices('Colour source','mode',[['theme','Current theme'],['monthly','Monthly presets'],['rgb','Original (RGB Sliders)']]);
    choices('Month','month',root.LGXMBWaveColors.months.map(function(m,i){return[i+1,m];}),4);
    choices('Day / Night','period',[['day','Day'],['night','Night']],2);
    slider('Red','red',0,255,1);slider('Green','green',0,255,1);slider('Blue','blue',0,255,1);
    slider('Top intensity','top',0,0.3,0.005);slider('Bottom intensity','bottom',0.2,1.2,0.005);
    var hint=document.createElement('p');hint.className='wave-quality-note';hint.textContent='Changes are saved immediately. Left / Right adjusts a slider; Up / Down moves between controls. Current theme restores your Appearance colours.';host.appendChild(hint);
    visibility();
  }
  function key(event,modal){
    var current=document.activeElement,group=current.closest('.color-group'),groups=Array.from(modal.querySelectorAll('.color-group')).filter(function(g){return !g.hidden;});
    var controls=Array.from(modal.querySelectorAll('button,input')).filter(function(el){return !el.hidden&&!el.closest('[hidden]');});
    function focus(el){if(el){el.focus();el.scrollIntoView({block:'nearest'});}}
    function toGroup(index){var g=groups[index];focus(g ? (g.querySelector('[aria-pressed="true"]') || g.querySelector('input,button')) : modal.querySelector('#closeModal'));}
    if(event.key==='Tab'){
      event.preventDefault();var index=controls.indexOf(current);focus(controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length]);return;
    }
    if(!/^Arrow/.test(event.key))return;
    event.preventDefault();
    if(!group){toGroup(event.key==='ArrowUp'?groups.length-1:0);return;}
    var vertical=event.key==='ArrowUp'||event.key==='ArrowDown',delta=event.key==='ArrowDown'||event.key==='ArrowRight'?1:-1;
    if(current.tagName==='INPUT'){
      if(vertical){toGroup(groups.indexOf(group)+delta);return;}
      if(delta>0)current.stepUp();else current.stepDown();current.dispatchEvent(new Event('input',{bubbles:true}));return;
    }
    var box=group.querySelector('.color-choices'),buttons=Array.from(box.children),i=buttons.indexOf(current),cols=Number(box.dataset.columns);
    if(vertical){
      if(cols>1&&buttons.length>cols&&i+delta*cols>=0&&i+delta*cols<buttons.length)focus(buttons[i+delta*cols]);
      else toGroup(groups.indexOf(group)+delta);
    }else focus(buttons[(i+delta+buttons.length)%buttons.length]);
  }
  root.LGXMBWaveColorSettings=Object.freeze({open:open,key:key});
}(window));
