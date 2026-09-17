// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/category-transition.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../app/style.css'), 'utf8');
function fixture() {
  let updates = 0;
  const classes = new Set();
  const forbidden = () => { throw Error('No script animation, timer or layout reads'); };
  const bar = {style:{transform:'translateX(-10.6vw)'},classList:{
    add:c=>classes.add(c),toggle(c,on){if(on)classes.add(c);else classes.delete(c);}
  },animate:forbidden,getBoundingClientRect:forbidden};
  const root = {document:{hidden:false},reduced:false,
    matchMedia(){return {matches:this.reduced};},getComputedStyle:forbidden,
    setTimeout:forbidden,requestAnimationFrame:forbidden};
  vm.runInNewContext(source,{window:root});
  const transition = new root.LGXMBCategoryTransition(bar);
  return {root,bar,classes,transition,update:()=>updates++,updates:()=>updates};
}
test('initial layout is immediate and category changes update the CSS destination synchronously',()=>{
  for(const steps of [-4,-1,1,4]){
    const f=fixture();assert.equal(f.classes.has('categories-instant'),true);
    f.transition.change(steps,f.update,true);
    assert.equal(f.updates(),1);assert.equal(f.classes.size,0);
    assert.equal(f.bar.style.transform,'translateX(-10.6vw)','controller must not reset the resting transform');
  }
});
test('rapid reversals only update selection; no scripted progress, animation or timer is allocated',()=>{
  const f=fixture();for(let i=0;i<100;i++)f.transition.change(i%2?1:-1,f.update,true);
  assert.equal(f.updates(),100);assert.equal(f.classes.size,0);
  assert.deepEqual(Object.keys(f.transition).sort(),['bar','destroyed']);
});
test('lifecycle cancellation retains the final transform and disables interpolation',()=>{
  const f=fixture();f.transition.change(1,f.update,true);f.transition.cancel();f.transition.cancel();
  assert.equal(f.classes.has('categories-instant'),true);
  assert.equal(f.bar.style.transform,'translateX(-10.6vw)');
  f.transition.change(-1,f.update,true);assert.equal(f.classes.size,0);
});
test('hidden, system reduced motion, disabled and invalid steps remain immediate',()=>{
  for(const mode of ['hidden','system-reduced','disabled','zero','nan','fraction','large']){
    const f=fixture();f.root.document.hidden=mode==='hidden';f.root.reduced=mode==='system-reduced';
    const step={zero:0,nan:NaN,fraction:1.5,large:65}[mode];
    f.transition.change(step===undefined?1:step,f.update,mode!=='disabled');
    assert.equal(f.updates(),1);assert.equal(f.classes.has('categories-instant'),true);
  }
});
test('CSS navigation does not depend on the Web Animations API, document timeline or viewport measurements',()=>{
  const f=fixture();delete f.root.matchMedia;delete f.bar.animate;
  f.transition.change(1,f.update,true);assert.equal(f.updates(),1);assert.equal(f.classes.size,0);
});
test('render errors keep the final state usable and callbacks must be synchronous functions',()=>{
  const f=fixture();assert.throws(()=>f.transition.change(1,()=>{throw Error('render');},true),/render/);
  assert.equal(f.classes.has('categories-instant'),true);
  assert.throws(()=>f.transition.change(1,null,true),/synchronous/);
});
test('destroy is idempotent; an absent bar never prevents the selection update',()=>{
  const f=fixture();f.transition.destroy();f.transition.destroy();f.transition.change(1,f.update,true);
  assert.equal(f.updates(),1);assert.equal(f.classes.has('categories-instant'),true);
  const empty=new f.root.LGXMBCategoryTransition();empty.change(1,f.update,true);empty.destroy();assert.equal(f.updates(),2);
});
test('horizontal and vertical motion share the 400 ms CSS timing and icon scale transition',()=>{
  assert.match(css,/--navigation-duration:\.4s/);
  for(const selector of ['#categories','.item','.item-icon','.category .category-icon']){
    const blocks=css.replace(/\/\*[\s\S]*?\*\//g,'').split('}').filter(b=>b.slice(0,b.indexOf('{')).trim()===selector);
    assert.ok(blocks.some(b=>b.includes('transition:transform var(--navigation-duration) var(--ease)')),selector);
  }
  assert.doesNotMatch(css,/items-arriving|categories-moving|will-change:/);
});
test('transition code never touches the list or reads layout, clones rows, or schedules cleanup',()=>{
  assert.doesNotMatch(source,/cloneNode|getBoundingClientRect|getComputedStyle|querySelector|\.children|requestAnimationFrame|setTimeout|setInterval|\.animate\(|onfinish|oncancel|\.style\./);
  assert.doesNotMatch(source,/this\.list|willChange|opacityFrom|columnFrom/);
});

test('the easing tracks the PS3 position curve recovered from the 3.01 firmware',()=>{
  // Selector 5 with the 200 ms setting: p = (p + (1 - p) * k) once per 60 Hz frame.
  const k=0.22058835625648499,match=/--ease:cubic-bezier\(([^)]+)\);--navigation-duration:([\d.]+)s/.exec(css);
  assert.ok(match);const [x1,y1,x2,y2]=match[1].split(',').map(Number),frames=Number(match[2])*60;
  const console3=[0];for(let i=1;i<=frames;i++)console3.push(console3[i-1]+(1-console3[i-1])*k);
  assert.ok(Math.abs(console3[12]-0.9497)<0.001,'95% at 200 ms');
  function bezier(x){let lo=0,hi=1;for(let n=0;n<40;n++){const s=(lo+hi)/2,bx=3*(1-s)*(1-s)*s*x1+3*(1-s)*s*s*x2+s*s*s;if(bx<x)lo=s;else hi=s;}
    const s=(lo+hi)/2;return 3*(1-s)*(1-s)*s*y1+3*(1-s)*s*s*y2+s*s*s;}
  for(let i=1;i<frames;i++)assert.ok(Math.abs(bezier(i/frames)-console3[i])<0.006,'frame '+i);
});
