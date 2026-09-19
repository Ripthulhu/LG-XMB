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
        b.addEventListener('click',function(){if(state[key]===pair[0])return;state[key]=pair[0];Array.prototype.forEach.call(box.children,function(n){n.setAttribute('aria-pressed',String(n===b));});visibility();apply();});box.appendChild(b);
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
      var calendar=state.mode==='monthly'||state.mode==='ps3';
      sections.month.hidden=!calendar||state.dateMode==='auto';
      sections.dateMode.hidden=!calendar;sections.timeMode.hidden=!calendar;sections.themeClock.hidden=state.mode!=='theme';
      ['red','green','blue','top','bottom'].forEach(function(key){if(sections[key])sections[key].hidden=state.mode!=='rgb';});
    }
    choices('Colour source','mode',[['theme','Current theme'],['ps3','PS3 original'],['monthly','Monthly presets'],['rgb','Custom RGB']]);
    choices('Day / night','themeClock',[[false,'Off'],[true,'Automatic']],2);
    choices('Month selection','dateMode',[['auto','Automatic'],['fixed','Fixed month']],2);
    choices('Month','month',root.LGXMBWaveColors.months.map(function(m,i){return[i+1,m];}),4);
    choices('Time of day','timeMode',[['auto','Automatic'],['day','Day'],['night','Night']]);
    slider('Red','red',0,255,1);slider('Green','green',0,255,1);slider('Blue','blue',0,255,1);
    slider('Top intensity','top',0,0.3,0.005);slider('Bottom intensity','bottom',0.2,1.2,0.005);
    visibility();
  }
  function key(event,modal){
    var current=document.activeElement,group=current.closest('.color-group'),groups=Array.from(modal.querySelectorAll('.color-group')).filter(function(g){return !g.hidden;});
    var controls=Array.from(modal.querySelectorAll('button,input')).filter(function(el){return !el.hidden&&!el.closest('[hidden]');});
    function focus(el){root.LGXMBMenuFocus(el);}
    function toGroup(index,delta){if(index<0||index>=groups.length)return;var g=groups[index],box=g&&g.querySelector('.color-choices');var edge=box&&Number(box.dataset.columns)===1?box.children[delta<0?box.children.length-1:0]:null;focus(g ? (edge || g.querySelector('[aria-pressed="true"]') || g.querySelector('input,button')) : null);}
    if(event.key==='Tab'){
      event.preventDefault();var index=controls.indexOf(current);focus(controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length]);return;
    }
    if(!/^Arrow/.test(event.key))return;
    event.preventDefault();
    if(!group){toGroup(event.key==='ArrowUp'?groups.length-1:0,event.key==='ArrowUp'?-1:1);return;}
    var vertical=event.key==='ArrowUp'||event.key==='ArrowDown',delta=event.key==='ArrowDown'||event.key==='ArrowRight'?1:-1;
    if(current.tagName==='INPUT'){
      if(vertical){toGroup(groups.indexOf(group)+delta,delta);return;}
      var previous=current.value;if(delta>0)current.stepUp();else current.stepDown();if(current.value===previous)return;current.dispatchEvent(new Event('input',{bubbles:true}));return;
    }
    var box=group.querySelector('.color-choices'),buttons=Array.from(box.children),i=buttons.indexOf(current),cols=Number(box.dataset.columns);
    if(vertical){
      if(buttons.length>cols&&i+delta*cols>=0&&i+delta*cols<buttons.length)focus(buttons[i+delta*cols]);
      else toGroup(groups.indexOf(group)+delta,delta);
    }else if(cols>1)focus(buttons[(i+delta+buttons.length)%buttons.length]);
  }
  root.LGXMBWaveColorSettings=Object.freeze({open:open,key:key});
}(window));
