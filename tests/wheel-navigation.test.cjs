// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WheelNavigation = require('../app/wheel-navigation.js');

function fixture(options = {}) {
  let stamp = 0,
    nextId = 0;
  const frames = new Map(),
    delivered = [];
  const wheel = new WheelNavigation({
    pixelStep: 120,
    now: () => stamp,
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    ...options,
    onSteps(steps) {
      delivered.push({ steps, at: stamp });
      if (options.onSteps) options.onSteps(steps, wheel);
    }
  });
  function event(deltaY = 120, extra = {}) {
    return {
      deltaY,
      deltaX: 0,
      deltaMode: 0,
      prevented: 0,
      preventDefault() {
        this.prevented++;
      },
      ...extra
    };
  }
  function frame(at = stamp + 16) {
    stamp = at;
    const batch = [...frames];
    frames.clear();
    batch.forEach(([, callback]) => callback(stamp));
  }
  return {
    wheel,
    delivered,
    frames,
    event,
    frame,
    at(value) {
      stamp = value;
    }
  };
}

test('individual TV detents move immediately in either direction', () => {
  for (const direction of [-1, 1]) {
    const f = fixture();
    for (const at of [0, 140, 350, 500]) {
      f.at(at);
      const event = f.event(120 * direction);
      assert.equal(f.wheel.handle(event), true);
      assert.equal(event.prevented, 1);
      assert.deepEqual(f.delivered.at(-1), { steps: direction, at });
      f.frame(at + 16);
    }
    assert.equal(f.delivered.length, 4);
    assert.equal(f.frames.size, 0);
  }
});

test('240 and 360 pixel TV events retain coalesced detents without repeated callbacks', () => {
  for (const direction of [-1, 1]) {
    const f = fixture();
    f.wheel.handle(f.event(360 * direction));
    assert.deepEqual(f.delivered, [{ steps: 3 * direction, at: 0 }]);
    f.frame();
    f.at(40);
    f.wheel.handle(f.event(240 * direction));
    assert.deepEqual(f.delivered.at(-1), { steps: 2 * direction, at: 40 });
  }
});

test('rapid input keeps its distance with one batch per frame and no continued movement', () => {
  for (const direction of [-1, 1]) {
    const f = fixture();
    f.wheel.handle(f.event(120 * direction));
    for (const [at, delta] of [
      [4, 120],
      [8, 240],
      [13, 360]
    ]) {
      f.at(at);
      f.wheel.handle(f.event(delta * direction));
      assert.equal(f.frames.size, 1);
    }
    assert.equal(f.delivered.length, 1);
    f.frame(16);
    assert.deepEqual(f.delivered.at(-1), { steps: 6 * direction, at: 16 });
    f.at(29);
    f.wheel.handle(f.event(120 * direction));
    f.frame(32);
    assert.deepEqual(f.delivered.at(-1), { steps: direction, at: 32 });
    f.frame(48);
    assert.equal(f.frames.size, 0);
    f.frame(5000);
    assert.equal(f.delivered.length, 3);
    assert.equal(
      f.delivered.reduce((sum, item) => sum + item.steps, 0),
      8 * direction
    );
  }
});

test('fractional pixels accumulate until a complete step, with no standalone animation frame', () => {
  const f = fixture({ pixelStep: 100 });
  for (let index = 0; index < 100; index++) {
    f.at(index);
    const event = f.event(1);
    f.wheel.handle(event);
    assert.equal(event.prevented, 1);
    if (index < 99) {
      assert.equal(f.delivered.length, 0);
      assert.equal(f.frames.size, 0);
    }
  }
  assert.deepEqual(f.delivered, [{ steps: 1, at: 99 }]);
  f.frame();
  f.wheel.handle(f.event(25));
  f.wheel.handle(f.event(75));
  assert.equal(f.delivered.length, 2);
});

test('line and page deltas normalize independently of the configured pixel detent', () => {
  for (const [mode, delta, expected] of [
    [1, 3, 1],
    [1, -6, -2],
    [2, 1, 1],
    [2, -3, -3]
  ]) {
    const f = fixture({ pixelStep: 120 });
    f.wheel.handle(f.event(delta, { deltaMode: mode }));
    assert.equal(f.delivered[0].steps, expected);
  }
  const f = fixture();
  f.wheel.handle(f.event(1, { deltaMode: 1 }));
  f.wheel.handle(f.event(1, { deltaMode: 1 }));
  assert.equal(f.delivered.length, 0);
  f.wheel.handle(f.event(1, { deltaMode: 1 }));
  assert.equal(f.delivered[0].steps, 1);
});

test('reversal immediately replaces pending movement and fractional input', () => {
  for (const direction of [-1, 1]) {
    const f = fixture();
    f.wheel.handle(f.event(120 * direction));
    f.at(4);
    f.wheel.handle(f.event(300 * direction));
    const stale = [...f.frames.values()][0];
    f.at(8);
    f.wheel.handle(f.event(-120 * direction));
    assert.deepEqual(f.delivered, [
      { steps: direction, at: 0 },
      { steps: -direction, at: 8 }
    ]);
    stale();
    f.frame(16);
    assert.equal(f.delivered.length, 2);
    f.wheel.handle(f.event(-60 * direction));
    assert.equal(f.delivered.length, 2, 'Previous-direction remainder must be discarded');
    f.wheel.handle(f.event(-60 * direction));
    assert.equal(f.delivered.at(-1).steps, -direction);
  }
});

test('a fresh gesture does not inherit an unfinished fraction or a stalled frame', () => {
  const f = fixture();
  f.wheel.handle(f.event(60));
  f.at(200);
  f.wheel.handle(f.event(60));
  assert.equal(f.delivered.length, 0);
  f.at(220);
  f.wheel.handle(f.event(60));
  f.at(225);
  f.wheel.handle(f.event(240));
  const stale = [...f.frames.values()][0];
  f.at(1000);
  f.wheel.handle(f.event(120));
  stale();
  f.frame(1016);
  assert.deepEqual(f.delivered, [
    { steps: 1, at: 220 },
    { steps: 1, at: 1000 }
  ]);
});

test('cancel clears pending work, fractional state and stale callbacks', () => {
  const f = fixture();
  f.wheel.handle(f.event(180));
  f.wheel.handle(f.event(120));
  const stale = [...f.frames.values()][0];
  f.wheel.cancel();
  assert.equal(f.frames.size, 0);
  f.at(10);
  f.wheel.handle(f.event(60));
  stale();
  assert.equal(f.delivered.length, 1);
  assert.equal(f.frames.size, 0);
  f.wheel.handle(f.event(60));
  assert.deepEqual(f.delivered.at(-1), { steps: 1, at: 10 });
});

test('a delayed frame cannot move selection after the gesture has expired', () => {
  const f = fixture();
  f.wheel.handle(f.event());
  f.at(10);
  f.wheel.handle(f.event(360));
  f.frame(500);
  assert.deepEqual(f.delivered, [{ steps: 1, at: 0 }]);
  assert.equal(f.frames.size, 0);
  f.at(501);
  f.wheel.handle(f.event());
  assert.deepEqual(f.delivered.at(-1), { steps: 1, at: 501 });
});

test('invalid, horizontal and browser zoom events remain untouched', () => {
  const f = fixture();
  f.wheel.handle(f.event());
  f.wheel.handle(f.event());
  for (const event of [
    f.event(0),
    f.event(NaN),
    f.event(Infinity),
    f.event('120'),
    f.event(120, { deltaX: Infinity }),
    f.event(120, { deltaX: 121 }),
    f.event(-120, { deltaX: -121 }),
    f.event(120, { deltaMode: 3 }),
    f.event(120, { ctrlKey: true })
  ]) {
    assert.equal(f.wheel.handle(event), false);
    assert.equal(event.prevented, 0);
  }
  assert.equal(f.wheel.handle(null), false);
  f.frame();
  assert.deepEqual(
    f.delivered.map((item) => item.steps),
    [1, 1],
    'Ignored events do not mutate pending input'
  );
});

test('pathological deltas and bursts have bounded work rather than a replay queue', () => {
  const f = fixture();
  f.wheel.handle(f.event(Number.MAX_VALUE));
  for (let n = 0; n < 1000; n++) f.wheel.handle(f.event(Number.MAX_VALUE));
  assert.deepEqual(
    f.delivered.map((item) => item.steps),
    [100]
  );
  assert.equal(f.frames.size, 1);
  f.frame();
  assert.deepEqual(
    f.delivered.map((item) => item.steps),
    [100, 100]
  );
  f.frame();
  assert.equal(f.frames.size, 0);
});

test('an onSteps callback can cancel immediately without scheduling work afterward', () => {
  let calls = 0;
  const f = fixture({
    onSteps(steps, wheel) {
      calls++;
      wheel.cancel();
    }
  });
  f.wheel.handle(f.event());
  assert.equal(calls, 1);
  assert.equal(f.frames.size, 0);
  f.frame();
  assert.equal(calls, 1);
});

test('reentrant input after cancellation belongs to the new gesture', () => {
  const calls = [];
  const f = fixture({
    onSteps(steps, wheel) {
      calls.push(steps);
      if (calls.length === 1) {
        wheel.cancel();
        wheel.handle({ deltaY: -120, preventDefault() {} });
      }
    }
  });
  f.wheel.handle(f.event());
  assert.deepEqual(calls, [1, -1]);
  assert.equal(f.frames.size, 1);
  f.frame();
  assert.deepEqual(calls, [1, -1]);
  assert.equal(f.frames.size, 0);
});

test('a batched callback can replace its next frame with a new gesture', () => {
  const calls = [];
  const f = fixture({
    onSteps(steps, wheel) {
      calls.push(steps);
      if (calls.length === 2) {
        wheel.cancel();
        wheel.handle({ deltaY: -120, preventDefault() {} });
      }
    }
  });
  f.wheel.handle(f.event());
  f.wheel.handle(f.event(240));
  f.frame();
  assert.deepEqual(calls, [1, 2, -1]);
  assert.equal(f.frames.size, 1);
  f.frame();
  assert.deepEqual(calls, [1, 2, -1]);
  assert.equal(f.frames.size, 0);
});
