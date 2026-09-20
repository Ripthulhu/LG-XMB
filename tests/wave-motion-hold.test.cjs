// SPDX-License-Identifier: GPL-3.0-or-later
// Exercise the real animation controller with a deterministic frame clock.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  let now = 1000,
    next = 0,
    draws = 0;
  const frames = new Map(),
    timers = new Map(),
    steps = [],
    listeners = {};
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const canvas = {
    width: 640,
    height: 360,
    style: {},
    getContext() {},
    setAttribute() {},
    removeAttribute() {},
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
    removeEventListener() {},
    getBoundingClientRect() {
      return { width: 640, height: 360 };
    }
  };
  const root = {
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(callback) {
      const id = ++next;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    setTimeout(callback) {
      const id = ++next;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../app/ps3-native-renderer.js'), 'utf8'),
    {
      window: root,
      document,
      performance: { now: () => now },
      Date,
      Float32Array
    }
  );
  const wave = new root.C5Wave(canvas);
  wave.cancel();
  wave.simulation = {
    advance(seconds) {
      steps.push(seconds);
    }
  };
  wave.initialize = function () {
    this.initialized = true;
    this.mode = 'webgl';
    this.renderer = {
      draw() {
        draws++;
        return false;
      },
      diagnostics() {
        return {};
      },
      configure() {},
      destroy() {}
    };
    this.resume();
  };
  wave.initialize();
  function frame(ms = 1000 / 60) {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
    assert.ok(frames.size <= 1, 'only one animation callback remains scheduled');
  }
  function run(count, ms) {
    for (let i = 0; i < count; i++) frame(ms);
  }
  return {
    wave,
    document,
    frame,
    run,
    frames,
    timers,
    steps,
    listeners,
    get draws() {
      return draws;
    },
    get now() {
      return now;
    }
  };
}

test('holding eases waves and particles to rest, then stops scheduling and drawing', () => {
  const t = setup();
  t.run(3);
  const quality = JSON.stringify(t.wave.ps3Quality),
    speed = t.wave.speed;
  const before = t.wave.time;
  t.wave.setMotionHeld(true);
  assert.equal(t.wave.motionGain, 1, 'the first held frame does not jump to zero');
  const gains = [];
  for (let i = 0; i < 14; i++) {
    t.frame();
    gains.push(t.wave.motionGain);
  }
  assert.ok(gains[0] > 0.95);
  assert.ok(gains[5] > 0.4 && gains[5] < 0.7, 'the middle of the ramp still moves');
  assert.ok(gains.every((gain, i) => !i || gain <= gains[i - 1]));
  assert.equal(gains.at(-1), 0);
  assert.ok(t.wave.time - before > 0.09 && t.wave.time - before < 0.13);
  assert.equal(t.frames.size, 0);
  assert.equal(t.wave.getDiagnostics().motionTransitioning, false);
  const draws = t.draws,
    time = t.wave.time,
    steps = t.steps.length;
  t.run(30);
  assert.equal(t.draws, draws, 'the last presented frame is retained');
  assert.equal(t.wave.time, time);
  assert.equal(t.steps.length, steps);
  assert.equal(JSON.stringify(t.wave.ps3Quality), quality);
  assert.equal(t.wave.speed, speed);
  assert.equal(t.wave.paused, false, 'a visual hold is separate from lifecycle pause');
});

test('release eases up after a long hold without advancing the hidden elapsed time', () => {
  const t = setup();
  t.run(2);
  t.wave.setMotionHeld(true);
  t.run(14);
  const time = t.wave.time;
  t.frame(60000);
  t.wave.setMotionHeld(false);
  assert.equal(t.wave.motionGain, 0);
  t.frame();
  assert.ok(t.steps.at(-1) > 0 && t.steps.at(-1) < 0.001);
  assert.ok(t.wave.time - time < 0.001, 'release does not catch up a minute of simulation');
  t.run(13);
  assert.equal(t.wave.motionGain, 1);
  assert.equal(t.wave.getDiagnostics().motionTransitioning, false);
  assert.equal(t.frames.size, 1);
});

test('reversals start from the current rate, including repeated requests', () => {
  const t = setup();
  t.run(2);
  t.wave.setMotionHeld(true);
  t.run(5);
  const slowing = t.wave.motionGain;
  t.wave.setMotionHeld(true);
  t.wave.setMotionHeld(false);
  assert.equal(t.wave.motionGain, slowing);
  t.run(4);
  const speeding = t.wave.motionGain;
  assert.ok(speeding > slowing && speeding < 1);
  t.wave.setMotionHeld(true);
  assert.equal(t.wave.motionGain, speeding);
  t.run(14);
  assert.equal(t.wave.motionGain, 0);
  assert.equal(t.frames.size, 0);
});

test('hidden and paused pages retain a hold, and resume cannot restart it', () => {
  const t = setup();
  t.run(2);
  t.wave.setMotionHeld(true);
  t.run(3);
  t.document.hidden = true;
  t.wave.visibility();
  assert.equal(t.frames.size, 0);
  assert.equal(t.wave.motionGain, 0);
  const time = t.wave.time;
  t.frame(60000);
  t.document.hidden = false;
  t.wave.visibility();
  assert.equal(t.frames.size, 0);
  assert.equal(t.wave.time, time);
  t.wave.setPaused(true);
  t.wave.setMotionHeld(false);
  assert.equal(t.frames.size, 0, 'releasing the hold cannot unpause a hidden page');
  t.wave.setPaused(false);
  t.frame();
  assert.ok(t.wave.motionGain > 0 && t.wave.motionGain < 0.05);
  assert.ok(t.wave.time - time < 0.001);
});

test('reduced motion and context restoration preserve the hold independently', () => {
  const t = setup();
  t.wave.setReducedMotion(true);
  t.wave.setMotionHeld(true);
  t.wave.setReducedMotion(false);
  assert.equal(t.frames.size, 0);
  assert.equal(t.wave.motionGain, 0);
  const time = t.wave.time;
  t.listeners.webglcontextlost({ preventDefault() {} });
  assert.equal(t.wave.contextLost, true);
  t.listeners.webglcontextrestored();
  t.run(2);
  assert.equal(t.wave.mode, 'webgl');
  assert.equal(t.frames.size, 0, 'a rebuilt context paints but does not restart held motion');
  assert.equal(t.wave.time, time);
  assert.equal(t.wave.motionHeld, true);
  t.wave.setMotionHeld(false);
  t.run(14);
  assert.equal(t.wave.motionGain, 1);
  t.wave.setReducedMotion(true);
  t.wave.setMotionHeld(true);
  t.wave.setMotionHeld(false);
  assert.equal(t.wave.reducedMotion, true);
  assert.equal(t.frames.size, 0, 'releasing a hold never enables saved reduced motion');
});

test('held backgrounds do not keep clock repaint timers alive', () => {
  const t = setup();
  t.wave.clockDriven = () => true;
  t.wave.setReducedMotion(true);
  assert.equal(t.timers.size, 1);
  t.wave.setMotionHeld(true);
  assert.equal(t.timers.size, 0);
  t.wave.draw();
  assert.equal(t.timers.size, 0);
  t.wave.setMotionHeld(false);
  assert.equal(t.timers.size, 1);
  t.wave.destroy();
  assert.equal(t.timers.size, 0);
  assert.equal(t.frames.size, 0);
});
