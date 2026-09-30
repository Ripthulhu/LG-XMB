// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const menu=require('./support/menu-navigation.cjs');
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
    window.menuAnimations=()=>[
      ...document.getElementById('categories').getAnimations({subtree:true}),
      ...[...document.querySelectorAll('#items>.rows')].flatMap(n=>n.getAnimations())
    ];
    window.finishMenuMotion=()=>menuAnimations().forEach(a=>a.finish());
  }
  async function create(width,init,deviceScaleFactor=1){
    const page=await browser.newPage({viewport:{width,height:Math.round(width*9/16)},deviceScaleFactor});
    page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(capture);if(init)await page.addInitScript(init);
    await load(page,[capture,init].filter(Boolean));
    await page.waitForFunction(()=>window.C5App&&!['pending','compiling'].includes(C5App.getState().waveMode));
    await page.evaluate(()=>menuWave.setPaused(true));return page;
  }
  function motion(time){
    if(Number.isFinite(time))menuAnimations().forEach(a=>{a.pause();a.currentTime=time;});
    const bar=document.getElementById('categories'),list=document.getElementById('items');
    const travel=bar.getAnimations().find(a=>a.transitionProperty==='transform');
    const x=n=>new DOMMatrix(getComputedStyle(n).transform).m41;
    return {width:innerWidth,barX:x(bar),travel:travel&&{duration:travel.effect.getTiming().duration,easing:travel.effect.getTiming().easing},
      plane:{transform:getComputedStyle(list).transform,opacity:getComputedStyle(list).opacity,
        willChange:getComputedStyle(list).willChange,effects:list.getAnimations().length},
      rows:[...list.children].map(n=>{
        const style=getComputedStyle(n),selected=n.querySelector('.selected');
        return {id:n.dataset.category,x:x(n),parked:n.classList.contains('parked'),departing:n.classList.contains('departing'),
          visibility:style.visibility,opacity:style.opacity,willChange:style.willChange,filter:style.filter,
          childVisibility:selected&&getComputedStyle(selected).visibility,
          pointerEvents:selected&&getComputedStyle(selected).pointerEvents,
          aria:n.getAttribute('aria-hidden'),ids:[...n.querySelectorAll('[id]')].map(item=>item.id),
          effects:n.getAnimations().map(a=>{
            const timing=a.effect.getTiming(),frames=a.effect.getKeyframes();
            return {property:a.transitionProperty||(frames.every(f=>'transform' in f&&!('opacity' in f))?'transform':'other'),
              duration:timing.duration,delay:timing.delay,easing:a.transitionProperty?timing.easing:frames[0].easing};
          })};
      })};
  }
  function near(actual,expected,message){assert.ok(Math.abs(actual-expected)<0.1,message+': '+actual+' vs '+expected);}
  function noGroupEffects(state){
    assert.deepEqual(state.plane,{transform:'none',opacity:'1',willChange:'auto',effects:0});
    state.rows.forEach(row=>{
      assert.equal(row.opacity,'1');assert.equal(row.visibility,'visible');
      assert.equal(row.willChange,'auto');assert.equal(row.filter,'none');assert.equal(row.departing,false);
    });
    assert.ok(state.rows.filter(row=>row.effects.length).length<=1,'only the incoming wrapper animates');
    const active=state.rows.filter(row=>!row.parked);assert.equal(active.length,1);assert.notEqual(active[0].aria,'true');
    state.rows.filter(row=>row.parked).forEach(row=>{
      near(row.x,state.width,'inactive lists remain off screen');
      assert.equal(row.effects.length,0);assert.equal(row.aria,'true');assert.equal(row.ids.length,0);
    });
  }
  function settled(state){
    noGroupEffects(state);
    state.rows.forEach(row=>{
      assert.equal(row.effects.length,0,'settled wrapper must have no animation');
      if(!row.parked)near(row.x,0,'active list anchor');
    });
  }
  for(const [width,dpr] of [[1280,1],[1920,1],[1366,1.25]]){
    const page=await create(width,null,dpr);
    try{
      await menu.item(page,'tv','com.webos.app.hdmi4');
      await page.evaluate(()=>{window.inputRows=[...document.querySelectorAll('#items>.rows:not(.parked)>.item')];});
      await page.waitForTimeout(450);
      // Category handoff must not change the faster vertical row transition.
      const vertical=await page.evaluate(()=>{
        menuPress('ArrowUp');const row=document.querySelector('#items>.rows:not(.parked)>.item');
        const animation=row.getAnimations().find(a=>a.transitionProperty==='transform');
        return animation&&{duration:animation.effect.getTiming().duration,easing:animation.effect.getTiming().easing};
      });
      assert.equal(vertical.duration,240);await page.waitForTimeout(450);
      await page.evaluate(()=>menuPress('ArrowDown'));await page.waitForTimeout(450);
      const resting=await page.evaluate(motion);settled(resting);
      const distance=width*0.106;
      await page.evaluate(()=>menuPress('ArrowRight'));
      const first=await page.evaluate(motion,0);noGroupEffects(first);
      assert.deepEqual(first.travel,{duration:400,easing:vertical.easing});
      assert.equal(await page.evaluate(()=>C5App.getState().category),'apps');
      near(first.rows.find(r=>r.id==='apps').x,distance,'Right enters from one category spacing');
      near(first.rows.find(r=>r.id==='tv').x,width,'outgoing list parks immediately');
      assert.deepEqual(first.rows.find(r=>r.id==='apps').effects,
        [{property:'transform',duration:400,delay:0,easing:vertical.easing}]);
      for(const time of [40,60,100,200,399]){
        const frame=await page.evaluate(motion,time);noGroupEffects(frame);
        const shift=frame.barX-resting.barX;
        near(frame.rows.find(r=>r.id==='apps').x,distance+shift,'incoming list follows the bar');
      }
      const hit=await page.evaluate(()=>{
        const old=document.querySelector('#items>.rows.parked[data-category="tv"] .selected'),bounds=old.getBoundingClientRect();
        const hit=document.elementsFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2).some(n=>n===old||old.contains(n));
        const before=C5App.getState();old.click();const after=C5App.getState();
        return {hit,unchanged:before.category===after.category&&before.item===after.item&&before.busy===after.busy&&before.modal===after.modal};
      });
      assert.equal(hit.hit,false,'parked rows must not receive pointer input');assert.equal(hit.unchanged,true,'programmatic inactive clicks must be ignored');
      const end=await page.evaluate(motion,400);noGroupEffects(end);
      near(end.rows.find(r=>r.id==='apps').x,0,'incoming endpoint');near(end.rows.find(r=>r.id==='tv').x,width,'outgoing remains parked');
      // The final sampled frame and settled icon must have identical edge pixels.
      const clip=await page.locator('#items>.rows:not(.parked) .selected .item-icon').boundingBox();
      const before=await page.screenshot({clip});
      const transform=await page.locator('#categories').evaluate(n=>n.style.transform);
      await page.evaluate(()=>finishMenuMotion());await page.waitForTimeout(450);
      settled(await page.evaluate(motion));
      assert.equal(await page.locator('#categories').evaluate(n=>n.style.transform),transform);
      const after=await page.screenshot({clip});
      const delta=await page.evaluate(async([first,second])=>{
        const load=data=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image);image.src='data:image/png;base64,'+data;});
        const images=[await load(first),await load(second)];
        if(images[0].width!==images[1].width||images[0].height!==images[1].height)return 255;
        const canvas=document.createElement('canvas');canvas.width=images[0].width;canvas.height=images[0].height;
        const context=canvas.getContext('2d'),pixels=images.map(image=>{context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);return context.getImageData(0,0,canvas.width,canvas.height).data;});
        let worst=0;for(let i=0;i<pixels[0].length;i++)worst=Math.max(worst,Math.abs(pixels[0][i]-pixels[1][i]));return worst;
      },[before.toString('base64'),after.toString('base64')]);
      assert.ok(delta<=2,'icon rasterization changes after settling: '+delta+' levels');

      await page.evaluate(()=>menuPress('ArrowLeft'));
      const left=await page.evaluate(motion,0);
      near(left.rows.find(r=>r.id==='tv').x,-distance,'Left enters from the left');
      const reversing=await page.evaluate(motion,60);
      await page.evaluate(()=>menuPress('ArrowRight'));
      const reversed=await page.evaluate(motion,0);noGroupEffects(reversed);
      near(reversed.barX,reversing.barX,'bar reversal preserves current position');
      near(reversed.rows.find(r=>r.id==='apps').x,distance,'reversed entry restarts from its new direction');
      near(reversed.rows.find(r=>r.id==='tv').x,width,'reversal parks the previous entry');
      await page.evaluate(()=>finishMenuMotion());await page.waitForTimeout(30);
      // A third category cancels prior entries and retains just one moving list.
      await page.evaluate(()=>menuPress('ArrowLeft'));await page.evaluate(motion,60);
      await page.evaluate(()=>menuPress('ArrowRight'));await page.evaluate(motion,60);
      await page.evaluate(()=>menuPress('ArrowRight'));
      const third=await page.evaluate(motion,0);noGroupEffects(third);
      const oldest=third.rows.find(r=>r.id==='tv');assert.equal(oldest.departing,false);near(oldest.x,width,'oldest entry remains parked');assert.equal(oldest.effects.length,0);
      await page.evaluate(()=>finishMenuMotion());await page.waitForTimeout(30);
      await menu.category(page,'tv');await page.waitForTimeout(450);
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#items>.rows:not(.parked)>.item')].every((n,i)=>n===inputRows[i])),true);
      assert.equal(await page.locator('#items>.rows:not(.parked) .above-bar[aria-hidden="false"]').count(),2);
      assert.equal(await page.evaluate(()=>C5App.getState().item),'com.webos.app.hdmi4');
      const verticalWork=await page.evaluate(()=>{
        const bar=document.getElementById('categories'),emblem=document.getElementById('detailEmblem');
        const icon=emblem.firstChild,observer=new MutationObserver(()=>{});
        observer.observe(bar,{attributes:true,childList:true,subtree:true});
        menuPress('ArrowUp');menuPress('ArrowDown');
        const writes=observer.takeRecords().length;observer.disconnect();
        return {writes,sameIcon:emblem.firstChild===icon,
          selected:document.querySelector('#items>.rows:not(.parked) [aria-selected="true"]').dataset.item,
          detail:C5App.getState().detailItem};
      });
      assert.equal(verticalWork.writes,0,'vertical navigation must not rewrite the horizontal bar');
      assert.equal(verticalWork.sameIcon,true,'HDMI rows share the existing detail SVG');
      assert.equal(verticalWork.selected,'com.webos.app.hdmi4');assert.equal(verticalWork.detail,'com.webos.app.hdmi4');
      const burst=await page.evaluate(()=>{
        for(let i=0;i<40;i++)menuPress(i%2?'ArrowLeft':'ArrowRight');
        return {travel:document.getElementById('categories').getAnimations().filter(a=>a.transitionProperty==='transform').length,
          ghosts:document.querySelectorAll('.items-outgoing').length,boxes:document.querySelectorAll('[role=listbox]').length,
          ids:[...document.querySelectorAll('[id]')].map(n=>n.id)};
      });
      assert.ok(burst.travel<=1);assert.equal(burst.ghosts,0);assert.equal(burst.boxes,1);
      assert.equal(new Set(burst.ids).size,burst.ids.length);noGroupEffects(await page.evaluate(motion));
      await page.waitForTimeout(450);settled(await page.evaluate(motion));
      // Far pointer jumps select immediately and still animate just one wrapper.
      await page.evaluate(()=>document.querySelector('[aria-label="Settings"]').click());
      assert.equal(await page.evaluate(()=>C5App.getState().category),'settings');
      const jump=await page.evaluate(motion,60);assert.equal(jump.travel.duration,400);noGroupEffects(jump);
      await page.screenshot({path:path.join(dir,`menu-css-${width}.png`)});
      await page.evaluate(()=>menuPress('Enter'));assert.equal(await page.evaluate(()=>C5App.getState().modal),'appearance');
      assert.equal(await page.locator('#categories').evaluate(n=>n.getAnimations().filter(a=>a.transitionProperty==='transform').length),0);
      settled(await page.evaluate(motion));
      await page.keyboard.press('Escape');
      await page.evaluate(()=>{menuPress('ArrowRight');window.dispatchEvent(new Event('pagehide'));});
      const hiddenCategory=await page.evaluate(()=>C5App.getState().category);settled(await page.evaluate(motion));
      await page.evaluate(()=>menuPress('ArrowRight'));assert.equal(await page.evaluate(()=>C5App.getState().category),hiddenCategory);
      await page.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));menuWave.setPaused(true);menuPress('ArrowRight');window.dispatchEvent(new Event('resize'));});
      assert.equal(await page.locator('#categories').evaluate(n=>n.getAnimations().filter(a=>a.transitionProperty==='transform').length),0);
      settled(await page.evaluate(motion));
      await page.evaluate(()=>menuPress('ArrowRight'));await page.waitForTimeout(450);
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.item,.category')].every(n=>getComputedStyle(n).willChange==='auto')),true);
      assert.ok(['none','normal'].includes(await page.locator('#items>.rows:not(.parked) .selected').evaluate(n=>getComputedStyle(n,'::after').content)));
      settled(await page.evaluate(motion));await page.screenshot({path:path.join(dir,`home-rest-${width}.png`)});
      checks.push(`${width}px DPR ${dpr}: opaque incoming category movement, unchanged vertical timing, directional reversal, one animated wrapper, inactive hit-testing, retained rows, identical settled pixels and lifecycle cleanup`);
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
      await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>C5App.getState().category),'apps');
      noGroupEffects(await page.evaluate(motion));
      if(mode==='reduced'||mode==='system-reduced'){
        assert.equal(await page.locator('#categories').evaluate(n=>n.getAnimations().length),0);settled(await page.evaluate(motion));
      }
      await page.waitForTimeout(450);settled(await page.evaluate(motion));
      checks.push(`${mode}: immediate selection, settled off-screen lists and no JavaScript animation dependency`);
    }finally{await page.close();}
  }
  assert.deepEqual(errors,[]);
};
