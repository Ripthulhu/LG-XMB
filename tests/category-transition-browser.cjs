// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function checkCategoryTransitions(browser,checks,errors,loader){
  const load=loader||(page=>page.goto('http://127.0.0.1:8765/'));
  const dir=path.resolve(__dirname,'../qa');fs.mkdirSync(dir,{recursive:true});
  function capture(){
    for(const [name,instance] of [['C5Wave','menuWave'],['LGXMBCategoryTransition','menuTransition']]){
      let ctor;Object.defineProperty(window,name,{configurable:true,get:()=>ctor,set:Original=>{
        ctor=function(...args){return window[instance]=new Original(...args);};ctor.prototype=Original.prototype;Object.assign(ctor,Original);
      }});
    }
    window.menuPress=key=>{
      document.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
      document.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true,cancelable:true}));
    };
  }
  async function create(width,init){
    const page=await browser.newPage({viewport:{width,height:width*9/16}});
    page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(capture);if(init)await page.addInitScript(init);
    await load(page,[capture,init].filter(Boolean));
    await page.waitForFunction(()=>window.C5App&&!['pending','compiling'].includes(C5App.getState().waveMode));
    await page.evaluate(()=>menuWave.setPaused(true));return page;
  }
  function pause(time){
    if(menuTransition.timer!==null){clearTimeout(menuTransition.timer);menuTransition.timer=null;}
    menuTransition.animations.forEach(a=>{a.pause();a.currentTime=time;});
  }
  for(const width of [1280,1920]){
    const page=await create(width);
    try{
      await page.evaluate(()=>{
        menuPress('ArrowLeft');menuPress('ArrowDown');menuPress('ArrowDown');menuPress('ArrowDown');
        window.inputRows=[...document.querySelectorAll('#items>.item')];
      });
      await page.waitForTimeout(200);
      await page.evaluate(()=>menuPress('ArrowRight'));await page.evaluate(pause,0);
      const frame=await page.evaluate(()=>({
        state:C5App.getState().category,effects:menuTransition.animations.map(a=>({target:a.effect.target.id,start:a.startTime,
          duration:a.effect.getTiming().duration,easing:a.effect.getTiming().easing,frames:a.effect.getKeyframes()})),
        x:new DOMMatrix(getComputedStyle(document.getElementById('items')).transform).m41,
        opacity:Number(getComputedStyle(document.getElementById('items')).opacity),
        ghosts:document.querySelectorAll('.items-outgoing').length,listboxes:document.querySelectorAll('[role=listbox]').length,
        ids:[...document.querySelectorAll('[id]')].map(n=>n.id)
      }));
      assert.equal(frame.state,'watch');assert.equal(frame.effects.length,2);
      assert.deepEqual(frame.effects.map(a=>a.target),['items','categories']);
      assert.ok(frame.effects.every(a=>a.duration===180&&a.start===frame.effects[0].start&&a.easing===frame.effects[0].easing));
      assert.ok(frame.x>0&&frame.x<=28);assert.equal(frame.opacity,0.5);
      assert.equal(frame.ghosts,0);assert.equal(frame.listboxes,1);assert.equal(new Set(frame.ids).size,frame.ids.length);
      for(const effect of frame.effects)for(const f of effect.frames)assert.ok(!('color' in f)&&!('filter' in f));
      await page.evaluate(pause,65);
      const reversal=await page.evaluate(()=>{
        const nodes=[...document.querySelectorAll('.category')],before=nodes.map(n=>n.getBoundingClientRect().left);
        const opacity=Number(getComputedStyle(document.getElementById('items')).opacity);
        menuPress('ArrowLeft');menuTransition.animations.forEach(a=>{a.pause();a.currentTime=0;});
        return {deltas:nodes.map((n,i)=>n.getBoundingClientRect().left-before[i]),beforeOpacity:opacity,
          afterOpacity:Number(getComputedStyle(document.getElementById('items')).opacity),
          reused:[...document.querySelectorAll('#items>.item')].every((n,i)=>n===inputRows[i]),
          upper:document.querySelectorAll('#items .above-bar').length,item:C5App.getState().item};
      });
      assert.ok(reversal.deltas.every(d=>Math.abs(d)<0.2),'bar reversal must retain its rendered position');
      assert.ok(Math.abs(reversal.beforeOpacity-reversal.afterOpacity)<0.01,'a repeat must not flash the column back to low opacity');
      assert.equal(reversal.reused,true);assert.equal(reversal.upper,3);assert.equal(reversal.item,'com.webos.app.hdmi4');
      await page.evaluate(()=>menuTransition.cancel());
      await page.evaluate(()=>menuPress('ArrowRight'));await page.evaluate(pause,60);
      await page.screenshot({path:path.join(dir,`menu-swipe-${width}.png`)});
      const burst=await page.evaluate(()=>{
        for(let i=0;i<40;i++)menuPress(i%2?'ArrowRight':'ArrowLeft');
        return {effects:menuTransition.animations.length,ghosts:document.querySelectorAll('.items-outgoing').length,
          column:menuTransition.columnFrom,opacity:menuTransition.opacityFrom};
      });
      assert.equal(burst.effects,2);assert.equal(burst.ghosts,0);assert.ok(Math.abs(burst.column)<=28&&burst.opacity>=0.5);
      await page.evaluate(()=>menuPress('ArrowDown'));
      assert.equal(await page.evaluate(()=>menuTransition.animations.length),0);
      // Pointer jumps retain the bar's start position but never fling a whole text column across the screen.
      const jump=await page.evaluate(()=>{
        const target=document.querySelector('[aria-label="Settings"]'),before=target.getBoundingClientRect().left;
        target.click();menuTransition.animations.forEach(a=>{a.pause();a.currentTime=0;});
        return {delta:target.getBoundingClientRect().left-before,column:menuTransition.columnFrom};
      });
      assert.ok(Math.abs(jump.delta)<0.2);assert.ok(Math.abs(jump.column)<=28);
      await page.evaluate(()=>menuPress('Enter'));assert.equal(await page.evaluate(()=>C5App.getState().modal),'appearance');
      assert.equal(await page.evaluate(()=>menuTransition.animations.length),0);
      await page.keyboard.press('Escape');
      await page.evaluate(()=>{menuPress('ArrowLeft');window.dispatchEvent(new Event('pagehide'));});
      const hiddenCategory=await page.evaluate(()=>C5App.getState().category);
      assert.equal(await page.evaluate(()=>menuTransition.animations.length),0);
      await page.evaluate(()=>menuPress('ArrowLeft'));assert.equal(await page.evaluate(()=>C5App.getState().category),hiddenCategory);
      await page.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));menuWave.setPaused(true);menuPress('ArrowLeft');window.dispatchEvent(new Event('resize'));});
      assert.equal(await page.evaluate(()=>menuTransition.animations.length),0);
      await page.evaluate(()=>{menuPress('ArrowRight');menuTransition.animations[0].finish();});
      await page.waitForFunction(()=>menuTransition.animations.length===0);
      const clean=await page.evaluate(()=>({
        column:getComputedStyle(document.getElementById('items')).willChange,bar:getComputedStyle(document.getElementById('categories')).willChange,
        rows:[...document.querySelectorAll('.item,.category')].every(n=>getComputedStyle(n).willChange==='auto'),
        glow:getComputedStyle(document.querySelector('#items .selected'),'::after').content,
        width:document.documentElement.scrollWidth<=innerWidth,opacity:getComputedStyle(document.getElementById('items')).opacity
      }));
      assert.equal(clean.column,'auto');assert.equal(clean.bar,'auto');assert.equal(clean.rows,true);assert.equal(clean.opacity,'1');
      assert.ok(['none','normal'].includes(clean.glow));assert.equal(clean.width,true);
      await page.screenshot({path:path.join(dir,`home-rest-${width}.png`)});
      checks.push(`${width}px: two group effects only, bounded short reveal, shared timing, continuous reversal, reused row identity, upper labels, no ghosts/colour tween/permanent layer hints; activation, hidden/resize/reduced cleanup`);
    }finally{await page.close();}
  }
  for(const mode of ['reduced','no-animation-api','refused-animation','system-reduced']){
    const init=mode==='reduced'?()=>localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({motion:'reduced'})):
      mode==='no-animation-api'?()=>{Element.prototype.animate=undefined;}:
      mode==='refused-animation'?()=>{Element.prototype.animate=()=>{throw Error('Animation refused');};}:
      ()=>localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({motion:'full'}));
    const page=await create(1280,init);
    try{
      if(mode==='system-reduced')await page.emulateMedia({reducedMotion:'reduce'});
      await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>C5App.getState().category),'library');
      assert.equal(await page.evaluate(()=>menuTransition.animations.length),0);
      assert.equal(await page.locator('#items').evaluate(n=>getComputedStyle(n).opacity),'1');
      checks.push(`${mode}: immediate usable category without a leftover effect`);
    }finally{await page.close();}
  }
  assert.deepEqual(errors,[]);
};
