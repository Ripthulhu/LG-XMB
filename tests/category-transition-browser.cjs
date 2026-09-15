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
  async function create(width,init,deviceScaleFactor=1){
    const page=await browser.newPage({viewport:{width,height:Math.round(width*9/16)},deviceScaleFactor});
    page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(capture);if(init)await page.addInitScript(init);
    await load(page,[capture,init].filter(Boolean));
    await page.waitForFunction(()=>window.C5App&&!['pending','compiling'].includes(C5App.getState().waveMode));
    await page.evaluate(()=>menuWave.setPaused(true));return page;
  }
  function seekBar(time){
    const bar=document.getElementById('categories');
    const animations=bar.getAnimations({subtree:true});
    animations.forEach(a=>{a.pause();a.currentTime=time;});
    const travel=animations.find(a=>a.effect.target===bar&&a.transitionProperty==='transform');
    return {count:animations.length,travel:travel&&{duration:travel.effect.getTiming().duration,
      easing:travel.effect.getTiming().easing},x:new DOMMatrix(getComputedStyle(bar).transform).m41};
  }
  function column(){
    const list=document.getElementById('items');
    return {transform:getComputedStyle(list).transform,opacity:getComputedStyle(list).opacity,
      willChange:getComputedStyle(list).willChange,effects:list.getAnimations().length,
      x:[...list.querySelectorAll('.item-icon')].map(n=>n.getBoundingClientRect().left)};
  }
  for(const [width,dpr] of [[1280,1],[1920,1],[1366,1.25]]){
    const page=await create(width,null,dpr);
    try{
      await page.evaluate(()=>{
        menuPress('ArrowLeft');menuPress('ArrowDown');menuPress('ArrowDown');menuPress('ArrowDown');
        window.inputRows=[...document.querySelectorAll('#items>.item')];
      });
      await page.waitForTimeout(200);
      // Up/down is the reference: measure its actual CSS transform timing.
      const vertical=await page.evaluate(()=>{
        menuPress('ArrowUp');const row=document.querySelector('#items>.item');
        const animation=row.getAnimations().find(a=>a.transitionProperty==='transform');
        return animation&&{duration:animation.effect.getTiming().duration,easing:animation.effect.getTiming().easing};
      });
      assert.equal(vertical.duration,160);await page.waitForTimeout(200);
      await page.evaluate(()=>menuPress('ArrowDown'));await page.waitForTimeout(200);
      await page.evaluate(()=>menuPress('ArrowRight'));
      const frame=await page.evaluate(seekBar,0);assert.deepEqual(frame.travel,vertical);
      assert.equal(await page.evaluate(()=>C5App.getState().category),'watch');
      const initial=await page.evaluate(column);
      assert.equal(initial.transform,'none');assert.equal(initial.opacity,'1');assert.equal(initial.effects,0);
      for(const time of [40,80,159,160]){
        await page.evaluate(seekBar,time);
        assert.deepEqual(await page.evaluate(column),initial,'the entire vertical column must stay anchored');
      }
      // The final sampled frame and normal rest must have the same icon pixels,
      // not just approximately equal CSS boxes (the reported one-pixel snap).
      const clip=await page.locator('#items .selected .item-icon').boundingBox();
      const before=await page.screenshot({clip});
      const transform=await page.locator('#categories').evaluate(n=>n.style.transform);
      await page.evaluate(()=>document.getElementById('categories').getAnimations({subtree:true}).forEach(a=>a.finish()));
      await page.waitForTimeout(200);
      assert.deepEqual(await page.evaluate(column),initial);
      assert.equal(await page.locator('#categories').evaluate(n=>n.style.transform),transform);
      assert.deepEqual(await page.screenshot({clip}),before,'icon rasterization changes after settling');

      await page.evaluate(()=>menuPress('ArrowLeft'));await page.evaluate(seekBar,60);
      const reversal=await page.evaluate(()=>{
        const bar=document.getElementById('categories');
        const before=new DOMMatrix(getComputedStyle(bar).transform).m41;
        menuPress('ArrowRight');
        bar.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=0;});
        return new DOMMatrix(getComputedStyle(bar).transform).m41-before;
      });
      assert.ok(Math.abs(reversal)<0.05,'CSS reversal must start at the current horizontal position');
      await page.evaluate(()=>document.getElementById('categories').getAnimations({subtree:true}).forEach(a=>a.finish()));
      await page.waitForTimeout(30);
      await page.evaluate(()=>menuPress('ArrowLeft'));await page.waitForTimeout(200);
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#items>.item')].every((n,i)=>n===inputRows[i])),true);
      assert.equal(await page.locator('#items .above-bar').count(),3);
      assert.equal(await page.evaluate(()=>C5App.getState().item),'com.webos.app.hdmi4');
      const verticalWork=await page.evaluate(()=>{
        const bar=document.getElementById('categories'),emblem=document.getElementById('detailEmblem');
        const icon=emblem.firstChild,observer=new MutationObserver(()=>{});
        observer.observe(bar,{attributes:true,childList:true,subtree:true});
        menuPress('ArrowUp');menuPress('ArrowDown');
        const writes=observer.takeRecords().length;observer.disconnect();
        return {writes,sameIcon:emblem.firstChild===icon,
          selected:document.querySelector('#items [aria-selected="true"]').id,
          detail:C5App.getState().detailItem};
      });
      assert.equal(verticalWork.writes,0,'vertical navigation must not rewrite the horizontal bar');
      assert.equal(verticalWork.sameIcon,true,'HDMI rows share the existing detail SVG');
      assert.equal(verticalWork.selected,'item-3');
      assert.equal(verticalWork.detail,'com.webos.app.hdmi4');
      const burst=await page.evaluate(()=>{
        for(let i=0;i<40;i++)menuPress(i%2?'ArrowLeft':'ArrowRight');
        const bar=document.getElementById('categories');
        return {travel:bar.getAnimations().filter(a=>a.transitionProperty==='transform').length,
          list:document.getElementById('items').getAnimations().length,
          ghosts:document.querySelectorAll('.items-outgoing').length,
          boxes:document.querySelectorAll('[role=listbox]').length,
          ids:[...document.querySelectorAll('[id]')].map(n=>n.id)};
      });
      assert.ok(burst.travel<=1);assert.equal(burst.list,0);assert.equal(burst.ghosts,0);assert.equal(burst.boxes,1);
      assert.equal(new Set(burst.ids).size,burst.ids.length);
      await page.waitForTimeout(200);
      // A far pointer jump is still one position transition and selection is immediate.
      await page.evaluate(()=>document.querySelector('[aria-label="Settings"]').click());
      assert.equal(await page.evaluate(()=>C5App.getState().category),'settings');
      const jump=await page.evaluate(seekBar,60);assert.equal(jump.travel.duration,160);
      await page.screenshot({path:path.join(dir,`menu-css-${width}.png`)});
      await page.evaluate(()=>menuPress('Enter'));assert.equal(await page.evaluate(()=>C5App.getState().modal),'appearance');
      assert.equal(await page.locator('#categories').evaluate(n=>n.getAnimations().filter(a=>a.transitionProperty==='transform').length),0);
      await page.keyboard.press('Escape');
      await page.evaluate(()=>{menuPress('ArrowLeft');window.dispatchEvent(new Event('pagehide'));});
      const hiddenCategory=await page.evaluate(()=>C5App.getState().category);
      await page.evaluate(()=>menuPress('ArrowLeft'));assert.equal(await page.evaluate(()=>C5App.getState().category),hiddenCategory);
      await page.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));menuWave.setPaused(true);menuPress('ArrowLeft');window.dispatchEvent(new Event('resize'));});
      assert.equal(await page.locator('#categories').evaluate(n=>n.getAnimations().filter(a=>a.transitionProperty==='transform').length),0);
      await page.evaluate(()=>menuPress('ArrowRight'));await page.waitForTimeout(220);
      assert.equal(await page.locator('#items').evaluate(n=>getComputedStyle(n).willChange),'auto');
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.item,.category')].every(n=>getComputedStyle(n).willChange==='auto')),true);
      assert.ok(['none','normal'].includes(await page.locator('#items .selected').evaluate(n=>getComputedStyle(n,'::after').content)));
      await page.screenshot({path:path.join(dir,`home-rest-${width}.png`)});
      checks.push(`${width}px DPR ${dpr}: matching up/down CSS timing, stationary unfaded column, identical settled icon pixels, native reversal, one bar-position transition, reused rows/upper labels, immediate activation and hidden/resize cleanup`);
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
      assert.equal(await page.locator('#items').evaluate(n=>n.getAnimations().length),0);
      assert.equal(await page.locator('#items').evaluate(n=>getComputedStyle(n).opacity),'1');
      if(mode==='reduced'||mode==='system-reduced')assert.equal(await page.locator('#categories').evaluate(n=>n.getAnimations().length),0);
      await page.waitForTimeout(200);
      checks.push(`${mode}: usable immediate selection, no column effects or JavaScript animation dependency`);
    }finally{await page.close();}
  }
  assert.deepEqual(errors,[]);
};
