// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Screensaver = require('../app/screensaver.js');

function fixture(settings) {
  const timers = new Map(),
    changes = [];
  let now = 0,
    nextId = 0,
    timerCalls = 0;
  const saver = new Screensaver({
    now: () => now,
    setTimer(callback, delay) {
      timerCalls++;
      const id = ++nextId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onChange: (state) => changes.push(state)
  });
  if (settings) saver.configure(settings);
  return {
    saver,
    timers,
    changes,
    get timerCalls() {
      return timerCalls;
    },
    advance(ms) {
      const end = now + ms;
      while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (timer.at > end) break;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = end;
    },
    callback() {
      return [...timers.values()][0].callback;
    }
  };
}

test('the default starts after two idle minutes only while Home is available', () => {
  const f = fixture();
  assert.deepEqual(f.saver.getState(), {
    active: false,
    delayMs: 120000,
    brightness: 0.25,
    waveBrightness: 0.25,
    particleBrightness: 0.25,
    available: false
  });
  assert.equal(f.timers.size, 0);
  f.advance(240000);
  assert.equal(f.saver.getState().active, false);
  f.saver.setAvailable(true);
  f.advance(119999);
  assert.equal(f.saver.getState().active, false);
  f.advance(1);
  assert.equal(f.saver.getState().active, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.changes.length, 1);
  f.advance(240000);
  assert.equal(f.changes.length, 1);
});

test('continuous activity moves the deadline without creating a timer for each event', () => {
  const f = fixture({ delayMs: 1000 });
  f.saver.setAvailable(true);
  for (let i = 0; i < 500; i++) {
    f.advance(10);
    assert.equal(f.saver.activity(), false);
  }
  assert.ok(f.timerCalls <= 7, `${f.timerCalls} timers for 500 input events`);
  assert.equal(f.timers.size, 1);
  assert.equal(f.changes.length, 0);
  f.advance(999);
  assert.equal(f.saver.getState().active, false);
  f.advance(1);
  assert.equal(f.saver.getState().active, true);
});

test('activity wakes immediately and reports whether it woke the screensaver', () => {
  const f = fixture({ delayMs: 1000 });
  f.saver.setAvailable(true);
  f.advance(1000);
  assert.equal(f.saver.activity(), true);
  assert.equal(f.saver.getState().active, false);
  assert.equal(f.saver.activity(), false);
  assert.deepEqual(
    f.changes.map((state) => state.active),
    [true, false]
  );
  f.advance(999);
  assert.equal(f.saver.getState().active, false);
  f.advance(1);
  assert.equal(f.saver.getState().active, true);
});

test('leaving Home wakes and cancels its deadline, returning starts a fresh interval', () => {
  const f = fixture({ delayMs: 1000 });
  f.saver.setAvailable(true);
  f.advance(750);
  const stale = f.callback();
  f.saver.setAvailable(false);
  f.advance(10000);
  stale();
  assert.equal(f.saver.getState().active, false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.saver.preview(), false);
  f.saver.setAvailable(true);
  f.advance(500);
  f.saver.setAvailable(true);
  f.advance(500);
  assert.equal(f.saver.getState().active, true);
  f.saver.setAvailable(false);
  assert.equal(f.saver.getState().active, false);
  assert.deepEqual(
    f.changes.map((state) => state.active),
    [true, false]
  );
});

test('Off disables idle activation and wakes an active screensaver', () => {
  const f = fixture({ delayMs: 1000 });
  f.saver.setAvailable(true);
  const stale = f.callback();
  f.saver.configure({ delayMs: 0 });
  stale();
  f.advance(10000);
  f.saver.activity();
  assert.equal(f.saver.getState().active, false);
  assert.equal(f.timers.size, 0);
  f.saver.configure({ delayMs: 1000 });
  f.advance(1000);
  assert.equal(f.saver.getState().active, true);
  f.saver.configure({ delayMs: 0 });
  assert.equal(f.saver.getState().active, false);
  assert.deepEqual(
    f.changes.map((state) => state.active),
    [true, false]
  );
});

test('Preview works with the idle timer off and stays active until activity', () => {
  const f = fixture({ delayMs: 0 });
  assert.equal(f.saver.preview(), false);
  f.saver.setAvailable(true);
  assert.equal(f.saver.preview(), true);
  assert.equal(f.saver.preview(), true);
  f.advance(600000);
  assert.equal(f.saver.getState().active, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.changes.length, 1);
  assert.equal(f.saver.activity(), true);
  assert.equal(f.timers.size, 0);
});

test('a cancelled timer cannot activate early or replace the new deadline', () => {
  const f = fixture({ delayMs: 1000 });
  f.saver.setAvailable(true);
  const oldDelayCallback = f.callback();
  f.advance(500);
  f.saver.configure({ delayMs: 2000 });
  const current = f.callback();
  oldDelayCallback();
  assert.equal(f.callback(), current);
  assert.equal(f.saver.getState().active, false);
  f.advance(1999);
  assert.equal(f.saver.getState().active, false);
  f.advance(1);
  assert.equal(f.saver.getState().active, true);
  current();
  assert.equal(f.changes.length, 1);
});

test('Preview cancels the old deadline and wake activity schedules a new one', () => {
  const f = fixture({ delayMs: 1000 });
  f.saver.setAvailable(true);
  const stale = f.callback();
  f.advance(500);
  f.saver.preview();
  f.advance(500);
  f.saver.activity();
  stale();
  assert.equal(f.saver.getState().active, false);
  assert.equal(f.timers.size, 1);
  f.advance(1000);
  assert.equal(f.saver.getState().active, true);
});

test('configuration validates values and only notifies for visible changes', () => {
  const f = fixture({ delayMs: 1000 });
  for (const delayMs of [NaN, Infinity, -1, '1000', null]) f.saver.configure({ delayMs });
  for (const brightness of [NaN, Infinity, '0.5', null]) f.saver.configure({ brightness });
  assert.equal(f.saver.getState().delayMs, 1000);
  assert.equal(f.saver.getState().brightness, 0.25);
  f.saver.configure({ delayMs: 1000, brightness: 0.25 });
  f.saver.setAvailable(true);
  f.saver.configure({ delayMs: 1000 });
  assert.equal(f.changes.length, 0);
  assert.equal(f.timerCalls, 1);
  f.saver.preview();
  f.saver.configure({ brightness: 0.1 });
  assert.equal(f.saver.getState().active, true);
  assert.equal(f.changes.at(-1).brightness, 0.1);
  assert.equal(f.changes.length, 2);
  f.saver.configure({ brightness: 2 });
  assert.equal(f.saver.getState().brightness, 1);
  f.saver.configure({ brightness: -1 });
  assert.equal(f.saver.getState().brightness, 0);
  f.saver.configure({ delayMs: 2 ** 40 });
  assert.equal(f.saver.getState().delayMs, 2147483647);
  assert.equal(f.saver.getState().active, false);
});

test('destruction cancels pending callbacks and rejects later operations', () => {
  const f = fixture({ delayMs: 1000 });
  f.saver.setAvailable(true);
  const stale = f.callback();
  f.saver.preview();
  f.saver.destroy();
  f.saver.destroy();
  stale();
  f.saver.configure({ delayMs: 1, brightness: 1 });
  f.saver.setAvailable(true);
  assert.equal(f.saver.activity(), false);
  assert.equal(f.saver.preview(), false);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.saver.getState(), {
    active: false,
    delayMs: 1000,
    brightness: 0.25,
    waveBrightness: 0.25,
    particleBrightness: 0.25,
    available: false
  });
  assert.deepEqual(
    f.changes.map((state) => state.active),
    [true, false]
  );
});

test('independent dim levels preserve zero and do not restart idle timing', () => {
  const f = fixture({ delayMs: 1000 });
  f.saver.setAvailable(true);
  const timer = f.callback();
  f.saver.configure({ brightness: 0, waveBrightness: 0.1, particleBrightness: 1 });
  assert.equal(f.callback(), timer);
  f.advance(1000);
  assert.equal(f.changes.at(-1).brightness, 0);
  assert.equal(f.changes.at(-1).waveBrightness, 0.1);
  assert.equal(f.changes.at(-1).particleBrightness, 1);
  f.saver.configure({ waveBrightness: 0 });
  assert.equal(f.changes.at(-1).active, true);
  assert.equal(f.changes.at(-1).waveBrightness, 0);
  assert.equal(f.changes.at(-1).particleBrightness, 1);
  const count = f.changes.length;
  f.saver.configure({ waveBrightness: NaN, particleBrightness: '0.5' });
  assert.equal(f.changes.length, count);
  f.saver.activity();
  assert.equal(f.saver.getState().active, false);
  assert.equal(f.saver.getState().particleBrightness, 1);
});
