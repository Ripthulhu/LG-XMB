// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function checkCategoryTransitions(browser,checks,errors,loader){
  const load=loader||(page=>page.goto('http://127.0.0.1:8765/'));
  const dir=path.resolve(__dirname,'../qa');fs.mkdirSync(dir,{recursive:true});
  function capture(){
    for(const [name,instance] of [['C5Wave','menuWave'],['LGXMBCategoryTransition','menuTransition']]){
      let ctor;
      Object.defineProperty(window,name,{configurable:true,get:()=>ctor,set:Original=>{
        ctor=function(...args){return window[instance]=new Original(...args);};
        ctor.prototype=Original.prototype;Object.assign(ctor,Original);
      }});
    }
    window.menuPress=key=>{
      document.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
      document.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true,cancelable:true}));
    };
    window.menuSeek=time=>{
      if(menuTransition.timer!==null){clearTimeout(menuTransition.timer);menuTransition.timer=null;}
      menuTransition.animations.forEach(a=>{a.pause();a.currentTime=time;});
    };
  }
  async function create(width,init){
    const page=await browser.newPage({viewport:{width,height:width*9/16}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(capture);if(init)await page.addInitScript(init);
    await load(page,[capture,init].filter(Boolean));
    await page.waitForFunction(()=>window.C5App&&!['pending','compiling'].includes(C5App.getState().waveMode));
    await page.evaluate(()=>menuWave.setPaused(true));
    return page;
  }
  for(const width of [1280,1920]){
    const page=await create(width);
    try{
      await page.evaluate(()=>{
        menuPress('ArrowLeft');menuPress('ArrowDown');menuPress('ArrowDown');menuPress('ArrowDown');
        window.originalInputRows=[...document.querySelectorAll('#items .item')];
      });
      await page.waitForTimeout(200);
      const cost=await page.evaluate(()=>{
        const counts={styleReads:0,layoutReads:0,clones:0};
        const style=window.getComputedStyle,rect=Element.prototype.getBoundingClientRect,clone=Node.prototype.cloneNode;
        window.getComputedStyle=function(...a){counts.styleReads++;return style.apply(this,a);};
        Element.prototype.getBoundingClientRect=function(...a){counts.layoutReads++;return rect.apply(this,a);};
        Node.prototype.cloneNode=function(...a){counts.clones++;return clone.apply(this,a);};
        try{menuPress('ArrowRight');}finally{window.getComputedStyle=style;Element.prototype.getBoundingClientRect=rect;Node.prototype.cloneNode=clone;}
        return {...counts,category:C5App.getState().category,animations:menuTransition.animations.length,
          ghosts:document.querySelectorAll('.items-outgoing').length,listboxes:document.querySelectorAll('[role=listbox]').length};
      });
      assert.deepEqual(cost,{styleReads:0,layoutReads:0,clones:0,category:'watch',animations:2,ghosts:0,listboxes:1});
      const frames=await page.evaluate(()=>{
        const list=document.getElementById('items'),active=document.querySelector('.category.active');
        const timing=menuTransition.animations.map(a=>({start:a.startTime,...a.effect.getTiming()}));
        const frames=[];
        for(const time of [0,30,60,90,120,150,175]){
          menuSeek(time);
          frames.push({time,gap:list.getBoundingClientRect().left-active.getBoundingClientRect().left-innerWidth*.01,
            opacity:Number(getComputedStyle(list).opacity),x:new DOMMatrix(getComputedStyle(list).transform).m41});
        }
        return {timing,frames};
      });
      assert.ok(frames.timing.every(a=>a.start===frames.timing[0].start&&a.duration===180&&a.easing===frames.timing[0].easing));
      assert.equal(frames.frames[0].opacity,0);
      assert.ok(frames.frames.at(-1).opacity>.95);
      for(const f of frames.frames)assert.ok(Math.abs(f.gap)<.15,'column/category mismatch: '+JSON.stringify(f));
      const reversed=await page.evaluate(()=>{
        menuSeek(70);
        const nodes=[...document.querySelectorAll('.category')],positions=nodes.map(n=>n.getBoundingClientRect().left);
        menuPress('ArrowLeft');menuSeek(0);
        return {delta:nodes.map((n,i)=>n.getBoundingClientRect().left-positions[i]),item:C5App.getState().item,
          same:originalInputRows.every((row,i)=>row===document.querySelectorAll('#items .item')[i]),upper:document.querySelectorAll('#items .above-bar').length};
      });
      assert.ok(reversed.delta.every(x=>Math.abs(x)<.15),'bar jumps on reversal');
      assert.equal(reversed.same,true);assert.equal(reversed.upper,3);assert.equal(reversed.item,'com.webos.app.hdmi4');
      await page.evaluate(()=>{menuSeek(100);});
      await page.screenshot({path:path.join(dir,`menu-swipe-${width}.png`)});
      await page.evaluate(()=>menuTransition.cancel());
      await page.screenshot({path:path.join(dir,`home-rest-${width}.png`)});
      const labels=await page.evaluate(()=>{
        const input=C5Catalog[0].items[0],old=input.title;
        menuPress('ArrowRight');input.title='Updated HDMI label';menuPress('ArrowLeft');
        const text=document.querySelector('#items .item-text').textContent;
        const aria=document.querySelector('#items .item').getAttribute('aria-label');
        input.title=old;menuPress('ArrowRight');menuPress('ArrowLeft');
        return {text,aria};
      });
      assert.deepEqual(labels,{text:'Updated HDMI label',aria:'Updated HDMI label'});
      const discovery=await page.evaluate(()=>{
        document.querySelector('[aria-label=Apps]').click();
        const cat=C5Catalog.find(c=>c.id==='apps'),before=[...document.querySelectorAll('#items .item')];
        cat.items.push({id:'test.discovery',title:'Discovered app',icon:'apps',type:'APP',description:'Test',action:'app'});
        document.querySelector('[aria-label=Watch]').click();document.querySelector('[aria-label=Apps]').click();
        const after=[...document.querySelectorAll('#items .item')];
        const result={preserved:before.every((node,i)=>node===after[i]),added:after.length-before.length,
          last:after.at(-1).getAttribute('aria-label')};
        cat.items.pop();document.querySelector('[aria-label=Inputs]').click();return result;
      });
      assert.deepEqual(discovery,{preserved:true,added:1,last:'Discovered app'});
      const burst=await page.evaluate(()=>{
        for(let i=0;i<50;i++){
          menuPress(i%2?'ArrowLeft':'ArrowRight');
          if(menuTransition.animations.length!==2)throw Error('unbounded or missing transition');
        }
        const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);
        return {unique:new Set(ids).size===ids.length,ghosts:document.querySelectorAll('.items-outgoing').length};
      });
      assert.deepEqual(burst,{unique:true,ghosts:0});
      await page.evaluate(()=>menuPress('ArrowUp'));
      assert.equal(await page.evaluate(()=>menuTransition.animations.length),0);
      const jump=await page.evaluate(()=>{
        const target=document.querySelector('[aria-label=Settings]'),previous=target.getBoundingClientRect().left;
        target.click();menuSeek(0);
        return {delta:target.getBoundingClientRect().left-previous,
          gap:document.getElementById('items').getBoundingClientRect().left-target.getBoundingClientRect().left-innerWidth*.01};
      });
      assert.ok(Math.abs(jump.delta)<.15);assert.ok(Math.abs(jump.gap)<.15);
      // Detached cached rows cannot activate the currently selected category.
      const stale=await page.evaluate(()=>{originalInputRows[0].click();return C5App.getState().category;});
      assert.equal(stale,'settings');
      await page.evaluate(()=>menuPress('Enter'));
      assert.equal(await page.evaluate(()=>C5App.getState().modal),'appearance');
      assert.equal(await page.evaluate(()=>menuTransition.animations.length),0);
      await page.keyboard.press('Escape');
      await page.evaluate(()=>{menuPress('ArrowLeft');window.dispatchEvent(new Event('pagehide'));});
      assert.equal(await page.evaluate(()=>menuTransition.animations.length),0);
      const hidden=await page.evaluate(()=>C5App.getState().category);
      await page.evaluate(()=>menuPress('ArrowLeft'));assert.equal(await page.evaluate(()=>C5App.getState().category),hidden);
      await page.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));menuPress('ArrowLeft');window.dispatchEvent(new Event('resize'));});
      assert.equal(await page.evaluate(()=>menuTransition.animations.length),0);
      const idle=await page.evaluate(()=>{
        const selected=document.querySelector('#items .selected');
        return {rows:[...document.querySelectorAll('.item,.category')].map(n=>getComputedStyle(n).willChange),
          glow:getComputedStyle(selected,'::after').backgroundImage,marker:getComputedStyle(selected,'::before').boxShadow,
          items:getComputedStyle(document.getElementById('items')).willChange,
          bar:getComputedStyle(document.getElementById('categories')).willChange};
      });
      assert.ok(idle.rows.every(x=>x==='auto'));assert.equal(idle.items,'auto');assert.equal(idle.bar,'auto');
      assert.equal(idle.glow,'none');assert.equal(idle.marker,'none');
      checks.push(`${width}px: two container effects, zero explicit layout/style reads or clones per switch, cached rows/fresh HDMI labels, single listbox, shared 180ms alignment, rapid reversal and pointer jump continuity, immediate activation, lifecycle cleanup, no permanent row layers`);
    }finally{await page.close();}
  }
  for(const mode of ['reduced','system-reduced','no-animation-api','refused-animation']){
    const init=mode==='reduced'?()=>localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({motion:'reduced'})):
      mode==='system-reduced'?()=>{const match=window.matchMedia.bind(window);window.matchMedia=q=>q==='(prefers-reduced-motion: reduce)'?{matches:true,addEventListener(){},removeEventListener(){}}:match(q);}:
      mode==='no-animation-api'?()=>Element.prototype.animate=undefined:()=>Element.prototype.animate=function(){throw Error('refused');};
    const p=await create(1280,init);
    try{
      await p.evaluate(()=>menuPress('ArrowRight'));
      const result=await p.evaluate(()=>({category:C5App.getState().category,animations:menuTransition.animations.length,
        opacity:getComputedStyle(document.getElementById('items')).opacity,ghosts:document.querySelectorAll('.items-outgoing').length}));
      assert.deepEqual(result,{category:'library',animations:0,opacity:'1',ghosts:0});
      checks.push(mode+': immediate visible category, no stale effects');
    }finally{await p.close();}
  }
};
