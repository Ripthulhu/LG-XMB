// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/category-transition.js'), 'utf8');
function fixture() {
  const animations = [], timers = new Map(); let timerId = 0, updates = 0;
  class Element {
    constructor() {
      this.classes = new Set();
      this.classList = {add:n=>this.classes.add(n), remove:n=>this.classes.delete(n)};
    }
    animate(frames, options) {
      if (this.refuse) throw Error('Animation refused');
      const a = {target:this, frames, options, progress:0, cancelled:false,
        cancel(){this.cancelled=true;if(this.oncancel)this.oncancel();}};
      a.effect = {getComputedTiming:()=>({progress:a.progress})};
      animations.push(a);return a;
    }
    cloneNode(){throw Error('Must not clone menu DOM');}
    getBoundingClientRect(){throw Error('Must not measure layout');}
    querySelector(){throw Error('Must not traverse row/icon elements');}
  }
  const root = {document:{hidden:false,timeline:{currentTime:1234}}, reduced:false,
    matchMedia(){return {matches:this.reduced};},
    getComputedStyle(){throw Error('Must not force style resolution');},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  vm.runInNewContext(source,{window:root});
  const list=new Element(),bar=new Element();
  return {root,list,bar,animations,timers,transition:new root.LGXMBCategoryTransition(list,bar),
    update(){updates++;},updates:()=>updates};
}
test('one synchronous selection, two container animations, identical transform timing in both directions',()=>{
  for(const direction of [-1,1]){
    const f=fixture();f.transition.change(direction,f.update,true);
    assert.equal(f.updates(),1);assert.equal(f.animations.length,2);
    const [list,bar]=f.animations;
    assert.equal(list.target,f.list);assert.equal(bar.target,f.bar);
    assert.equal(list.frames[0].transform,`translateX(${direction*10.6}vw)`);
    assert.equal(list.frames.at(-1).transform,'translateX(0)');
    assert.equal(list.frames[0].opacity,0);assert.equal(list.frames[1].opacity,0);assert.equal(list.frames.at(-1).opacity,1);
    assert.equal(bar.frames[0].transform,list.frames[0].transform);assert.equal(bar.frames[1].transform,list.frames.at(-1).transform);
    for(const a of f.animations){assert.equal(a.startTime,1234);assert.equal(a.options.duration,180);assert.equal(a.options.easing,f.root.LGXMBCategoryTransition.EASING);}
  }
});
test('transition code never clones, traverses descendants or measures computed style/layout',()=>{
  assert.doesNotMatch(source,/cloneNode|getComputedStyle|getBoundingClientRect|querySelector|insertBefore|\.children\b/);
  const f=fixture();f.transition.change(1,f.update,true);assert.equal(f.animations.length,2);
  for(const a of f.animations)for(const k of a.frames)assert.ok(Object.keys(k).every(n=>['transform','opacity','offset'].includes(n)));
});
test('partial reversal preserves bar displacement using eased progress, with no visual copy',()=>{
  const f=fixture();f.transition.change(1,f.update,true);const old=f.animations[0].onfinish;
  f.transition.travel.progress=0.6;f.transition.change(-1,f.update,true);
  assert.equal(f.updates(),2);assert.equal(f.timers.size,1);assert.equal(f.transition.animations.length,2);
  assert.ok(Math.abs(f.transition.offset-(-10.6+10.6*0.4))<1e-9);
  assert.ok(f.animations.slice(0,2).every(a=>a.cancelled));
  old();assert.equal(f.transition.animations.length,2);assert.equal(f.timers.size,1);
});
test('held repeat has bounded active animation/timer count and no queue',()=>{
  const f=fixture();
  for(let i=0;i<100;i++){
    if(f.transition.travel)f.transition.travel.progress=0.8;
    f.transition.change(i%3===0?-1:1,f.update,true);
    assert.equal(f.transition.animations.length,2);assert.equal(f.timers.size,1);
    assert.ok(f.animations.slice(0,-2).every(a=>a.cancelled));
  }
  assert.equal(f.updates(),100);
});
test('completion and watchdog release both layers and animation resources',()=>{
  for(const watchdog of [false,true]){
    const f=fixture();f.transition.change(1,f.update,true);
    if(watchdog)[...f.timers.values()][0].fn();else f.animations[0].onfinish();
    assert.equal(f.transition.animations.length,0);assert.equal(f.timers.size,0);
    assert.equal(f.list.classes.size,0);assert.equal(f.bar.classes.size,0);assert.equal(f.transition.offset,0);
  }
});
test('hidden, reduced motion, disabled, missing API/timeline and invalid steps remain immediate',()=>{
  for(const mode of ['hidden','system-reduced','disabled','no-api','no-bar-api','no-timeline','invalid']){
    const f=fixture();
    if(mode==='hidden')f.root.document.hidden=true;
    if(mode==='system-reduced')f.root.reduced=true;
    if(mode==='no-api')f.list.animate=undefined;
    if(mode==='no-bar-api')f.bar.animate=undefined;
    if(mode==='no-timeline')delete f.root.document.timeline;
    f.transition.change(mode==='invalid'?0:1,f.update,mode!=='disabled');
    assert.equal(f.updates(),1);assert.equal(f.animations.length,0);assert.equal(f.list.classes.size,0);
  }
});
test('refused animation and update exceptions never leave a hidden list',()=>{
  for(const target of ['list','bar']){
    const f=fixture();f[target].refuse=true;f.transition.change(1,f.update,true);
    assert.equal(f.updates(),1);assert.equal(f.transition.animations.length,0);
    assert.equal(f.list.classes.size,0);assert.equal(f.bar.classes.size,0);assert.equal(f.timers.size,0);
    assert.ok(f.animations.every(a=>a.cancelled));
  }
  const f=fixture();assert.throws(()=>f.transition.change(1,()=>{throw Error('render');},true),/render/);
  assert.equal(f.list.classes.size,0);assert.equal(f.bar.classes.size,0);
});
test('missing in-flight timing falls back safely instead of forcing a layout read',()=>{
  const f=fixture();f.transition.change(1,f.update,true);
  f.transition.travel.effect=null;f.transition.change(-1,f.update,true);
  assert.equal(f.updates(),2);assert.equal(f.transition.animations.length,0);assert.equal(f.list.classes.size,0);
});
test('null pending progress retains the exact start offset',()=>{
  const f=fixture();f.transition.change(1,f.update,true);f.transition.travel.progress=null;
  f.transition.change(-1,f.update,true);assert.equal(f.transition.offset,0);
});
test('pointer jumps use full spacing rather than a short unrelated slide',()=>{
  for(const steps of [-3,3]){
    const f=fixture();f.transition.change(steps,f.update,true);
    assert.equal(f.transition.offset,steps*10.6);
    assert.ok(f.animations.every(a=>a.startTime===1234&&a.options.duration===180));
  }
});
test('cancel and destroy are idempotent; no animation survives disposal',()=>{
  const f=fixture();f.transition.change(1,f.update,true);f.transition.cancel();f.transition.cancel();
  f.transition.destroy();f.transition.destroy();f.transition.change(1,f.update,true);
  assert.equal(f.updates(),2);assert.equal(f.animations.length,2);assert.equal(f.timers.size,0);
  assert.throws(()=>f.transition.change(1,null,true),/synchronous/);
});
