// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../app/wave.js'),'utf8');

function setup() {
  const document = {hidden:false}, draws = [], pending = new Map();
  let id = 0, now = 0;
  const root = {
    requestAnimationFrame(callback) { pending.set(++id,callback); return id; },
    cancelAnimationFrame(frame) { pending.delete(frame); }
  };
  new Function('window','document',source)(root,document);
  const wave = Object.assign(Object.create(root.C5Wave.prototype),{
    mode:'webgl', initialized:true, time:14, speed:1.5, lastFrame:0, nextFrame:0,
    raf:0, initRaf:0, compileRaf:0,
    _sampleTiming() {}, _resetTiming() {}, _draw() { draws.push(now); }
  });
  wave._tickBound = wave._tick.bind(wave);
  return {wave,document,draws,pending,step(time) {
    now=time; pending.delete(wave.raf); wave._tick(time);
    assert.ok(pending.size<=1,'At most one animation callback may be pending');
  }};
}

test('a late WebGL frame retains the original 30 Hz phase', () => {
  const h=setup();
  [1000,1017,1040,1050,1067,1084,1100].forEach(h.step);
  assert.deepEqual(h.draws,[1040,1067,1100]);
  assert.ok(Math.abs(h.wave.nextFrame-(1000+4*1000/30))<1e-9);
  assert.ok(Math.abs(h.wave.time-(14+0.1*0.70*1.5))<1e-9,'Use actual elapsed animation time');
});

test('a long stall skips missed deadlines instead of drawing a catch-up burst', () => {
  const h=setup();
  h.step(1000);h.step(2040);
  assert.deepEqual(h.draws,[2040]);
  assert.ok(h.wave.nextFrame>2040&&h.wave.nextFrame<=2040+1000/30);
  assert.ok(Math.abs(h.wave.time-(14+0.1*0.70*1.5))<1e-9,'Retain the existing long-gap clock clamp');
  h.step(2041);assert.equal(h.draws.length,1);
  h.step(2067);assert.deepEqual(h.draws,[2040,2067]);
});

test('cancellation resets the phase and suspended callbacks do no work', () => {
  for (const reason of ['paused','reducedMotion','contextLost','destroyed','hidden']) {
    const h=setup();h.step(1000);h.step(1040);
    h.wave._cancel();
    assert.equal(h.wave.lastFrame,0);assert.equal(h.wave.nextFrame,0);assert.equal(h.pending.size,0);
    if(reason==='hidden')h.document.hidden=true;else h.wave[reason]=true;
    h.step(5000);assert.deepEqual(h.draws,[1040]);assert.equal(h.pending.size,0);
    if(reason==='hidden')h.document.hidden=false;else h.wave[reason]=false;
    h.step(6000);assert.deepEqual(h.draws,[1040]);
    h.step(6034);assert.deepEqual(h.draws,[1040,6034]);
  }
});

test('small callback jitter does not accumulate into an ever-slower animation', () => {
  const h=setup();h.step(1000);
  for(let frame=1;frame<=600;frame++)h.step(1000+frame*1000/60+(frame%2?0:1));
  assert.equal(h.draws.length,300);
  assert.ok(h.draws.every((time,i)=>!i||time-h.draws[i-1]>30));
});
