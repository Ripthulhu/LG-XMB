// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/category-transition.js'), 'utf8');
function fixture() {
  const animations = [], timers = new Map(); let nextTimer = 1, updates = 0;
  class Element {
    constructor() { this.classes = new Set(); this.classList = {add:c=>this.classes.add(c), remove:c=>this.classes.delete(c)}; }
    cloneNode() { throw Error('No snapshots'); }
    getBoundingClientRect() { throw Error('No layout reads'); }
    querySelectorAll() { throw Error('No per-item traversal'); }
    animate(frames, options) {
      if (this.failAnimation) throw Error('Animation refused');
      const a = {target:this, frames, options, progress:0, cancelled:false,
        cancel() {this.cancelled=true; if(this.oncancel)this.oncancel();}};
      a.effect = {getComputedTiming:()=>({progress:a.progress})}; animations.push(a); return a;
    }
  }
  const root = {document:{hidden:false,timeline:{currentTime:1234}},innerWidth:1920,reduced:false,
    matchMedia(){return {matches:this.reduced};}, getComputedStyle(){throw Error('No style reads');},
    setTimeout(fn,delay){const id=nextTimer++;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}};
  vm.runInNewContext(source,{window:root});
  const list=new Element(),bar=new Element(),transition=new root.LGXMBCategoryTransition(list,bar);
  return {root,list,bar,transition,animations,timers,update:()=>updates++,updates:()=>updates};
}
test('category change commits immediately with only a short live-column reveal and one bar animation',()=>{
  for(const steps of [-4,-1,1,4]){
    const f=fixture();f.transition.change(steps,f.update,true);
    assert.equal(f.updates(),1);assert.equal(f.animations.length,2);
    assert.equal(f.animations[0].target,f.list);assert.equal(f.animations[1].target,f.bar);
    assert.equal(f.animations[0].frames[0].transform,`translateX(${Math.sign(steps)*26.88}px)`);
    assert.equal(f.animations[0].frames[0].opacity,0.5);assert.equal(f.animations[0].frames[1].opacity,1);
    assert.equal(f.animations[1].frames[0].transform,`translateX(${steps*10.6*1920/100}px)`);
    for(const a of f.animations){assert.equal(a.startTime,1234);assert.equal(a.options.duration,180);assert.equal(a.options.easing,f.root.LGXMBCategoryTransition.EASING);}
  }
});
test('reversals preserve in-flight bar position and never restart the column fade at zero',()=>{
  const f=fixture();f.transition.change(1,f.update,true);const old=f.animations[0].onfinish;
  f.animations.forEach(a=>a.progress=0.4);
  f.transition.change(-1,f.update,true);
  assert.equal(f.updates(),2);assert.equal(f.transition.animations.length,2);assert.equal(f.timers.size,1);
  assert.ok(f.animations.slice(0,2).every(a=>a.cancelled));
  assert.equal(f.animations[2].frames[0].opacity,0.7);
  assert.equal(f.transition.columnFrom,26.88*0.6);
  assert.ok(Math.abs(f.transition.barFrom-(-203.52+203.52*0.6))<1e-8);
  old();assert.equal(f.transition.animations.length,2);assert.equal(f.timers.size,1);
});
test('completion, watchdog and cancellation release only the two temporary group effects',()=>{
  for(const method of ['finish','watchdog','cancel']){
    const f=fixture();f.transition.change(1,f.update,true);
    if(method==='finish')f.animations[0].onfinish();else if(method==='watchdog')[...f.timers.values()][0].fn();else f.transition.cancel();
    assert.equal(f.transition.animations.length,0);assert.equal(f.timers.size,0);
    assert.equal(f.list.classes.size,0);assert.equal(f.bar.classes.size,0);
    assert.ok(f.animations.every(a=>a.cancelled));
  }
});
test('rapid repeats have bounded live effects and no scheduled render work',()=>{
  const f=fixture();
  for(let i=0;i<100;i++){
    f.transition.animations.forEach(a=>a.progress=0.3);
    f.transition.change(i%2?1:-1,f.update,true);
    assert.equal(f.transition.animations.length,2);assert.equal(f.timers.size,1);
    assert.ok(f.transition.opacityFrom>=0.5);
  }
  assert.equal(f.updates(),100);assert.equal(f.animations.filter(a=>!a.cancelled).length,2);
});
test('hidden, reduced-motion, disabled, missing API/timeline and invalid input all update immediately',()=>{
  for(const mode of ['hidden','system-reduced','disabled','no-api','no-timeline','invalid','bad-width']){
    const f=fixture();if(mode==='hidden')f.root.document.hidden=true;if(mode==='system-reduced')f.root.reduced=true;
    if(mode==='no-api')f.list.animate=undefined;if(mode==='no-timeline')delete f.root.document.timeline;
    if(mode==='bad-width')f.root.innerWidth=NaN;
    f.transition.change(mode==='invalid'?0:1,f.update,mode!=='disabled');
    assert.equal(f.updates(),1);assert.equal(f.animations.length,0);assert.equal(f.timers.size,0);
  }
});
test('optional animation refusals and rendering errors cannot leave a dimmed or displaced menu',()=>{
  for(const target of ['list','bar']){
    const f=fixture();f[target].failAnimation=true;f.transition.change(1,f.update,true);
    assert.equal(f.updates(),1);assert.equal(f.transition.animations.length,0);
    assert.equal(f.list.classes.size,0);assert.equal(f.bar.classes.size,0);assert.ok(f.animations.every(a=>a.cancelled));
    assert.throws(()=>f.transition.change(1,()=>{throw Error('render');},true),/render/);
    assert.equal(f.transition.animations.length,0);
  }
});
test('destroy is idempotent and permanently disables effects, not synchronous selection',()=>{
  const f=fixture();f.transition.change(1,f.update,true);f.transition.destroy();f.transition.destroy();f.transition.change(1,f.update,true);
  assert.equal(f.updates(),2);assert.equal(f.animations.length,2);assert.equal(f.timers.size,0);
  assert.throws(()=>f.transition.change(1,null,true),/synchronous/);
});
test('column travel is capped on very large viewports',()=>{
  const f=fixture();f.root.innerWidth=7680;f.transition.change(1,f.update,true);assert.equal(f.transition.columnFrom,28);
});
test('transition implementation never clones, queries layout/styles or animates individual children',()=>{
  assert.doesNotMatch(source,/cloneNode|getBoundingClientRect|getComputedStyle|querySelector|\.children|requestAnimationFrame|setInterval/);
  assert.doesNotMatch(source,/\.finished|filter:|color:|boxShadow:/);
});
