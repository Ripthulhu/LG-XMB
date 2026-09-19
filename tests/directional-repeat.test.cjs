// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const DirectionalRepeat = require('../app/directional-repeat.js');

function fixture() {
  let stamp = 0, nextId = 0;
  const timers = new Map(), delivered = [];
  const repeat = new DirectionalRepeat({
    onDirection(event) { delivered.push({event, at: stamp}); },
    now() { return stamp; },
    setTimeout(fn, delay) { const id = nextId++; timers.set(id, {fn, at: stamp + delay}); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  function advance(target) {
    while (true) {
      const entry = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry; timers.delete(id); stamp = timer.at; timer.fn();
    }
    stamp = target;
  }
  function event(key = 'ArrowDown', repeated = false) {
    return {key, repeat: repeated, prevented: 0, preventDefault() { this.prevented++; }};
  }
  return {repeat, timers, delivered, advance, event, jump(value) { stamp = value; }};
}

test('80 ms remote repeats produce an even 100 ms cadence', () => {
  const f = fixture();
  for (let at = 0; at <= 800; at += 80) { f.advance(at); f.repeat.handle(f.event('ArrowDown', at > 0)); }
  f.advance(1000);
  assert.deepEqual(f.delivered.map(d => d.at), [0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  assert.equal(f.timers.size, 0);
  f.advance(5000);
  assert.equal(f.delivered.length, 10, 'No synthetic repeats after input ends');
});

test('a held direction keeps one latest event and preserves its semantics', () => {
  const f = fixture(), initial = f.event(), pending = [];
  f.repeat.handle(initial);
  for (let at = 10; at < 100; at += 10) {
    f.advance(at); const e = f.event('ArrowDown', at < 90); e.keyCode = 40; pending.push(e); f.repeat.handle(e);
    assert.equal(f.timers.size, 1);
  }
  f.advance(100);
  assert.equal(f.delivered.length, 2);
  assert.equal(f.delivered[1].event, pending.at(-1));
  assert.equal(f.delivered[1].event.repeat, false, 'Remotes without repeat=true use the same gate');
  assert.equal(f.delivered[1].event.keyCode, 40);
  assert.equal(initial.prevented, 1);
  assert.ok(pending.every(e => e.prevented === 1), 'Prevent browser scrolling during the original dispatch');
});

test('explicit rapid taps are immediate and release drops the pending repeat', () => {
  const f = fixture();
  f.repeat.handle(f.event()); f.advance(25); f.repeat.handle(f.event());
  assert.equal(f.repeat.keyup({key: 'ArrowDown'}), true);
  f.advance(30); f.repeat.handle(f.event()); f.repeat.keyup({key: 'ArrowDown'});
  f.advance(40); f.repeat.handle(f.event()); f.repeat.keyup({key: 'ArrowDown'});
  f.advance(500);
  assert.deepEqual(f.delivered.map(d => d.at), [0, 30, 40]);
  assert.equal(f.timers.size, 0);
});

test('a direction change is immediate and cancels the previous pending direction', () => {
  const f = fixture();
  f.repeat.handle(f.event()); f.advance(50); f.repeat.handle(f.event());
  f.advance(60); f.repeat.handle(f.event('ArrowUp'));
  assert.equal(f.repeat.keyup({key: 'ArrowDown'}), false, 'An old key release must not cancel the new direction');
  f.advance(80); f.repeat.handle(f.event('ArrowUp'));
  f.advance(160);
  assert.deepEqual(f.delivered.map(d => [d.event.key, d.at]), [['ArrowDown', 0], ['ArrowUp', 60], ['ArrowUp', 160]]);
});

test('cancel clears held state and prevents stale timer callbacks after a lifecycle change', () => {
  const f = fixture();
  f.repeat.handle(f.event()); f.advance(20); f.repeat.handle(f.event());
  const stale = [...f.timers.values()][0].fn;
  f.repeat.cancel(); assert.equal(f.timers.size, 0);
  f.advance(30); f.repeat.handle(f.event());
  f.jump(100); stale();
  assert.deepEqual(f.delivered.map(d => d.at), [0, 30]);
});

test('late timers do not replay a backlog or duplicate a newer event', () => {
  const f = fixture();
  f.repeat.handle(f.event()); f.advance(40); f.repeat.handle(f.event());
  const stale = [...f.timers.values()][0].fn;
  f.jump(250); const latest = f.event(); f.repeat.handle(latest); stale();
  f.advance(1000);
  assert.deepEqual(f.delivered.map(d => d.at), [0, 250]);
  assert.equal(f.delivered[1].event, latest);
});

test('an early timer waits for the full repeat interval', () => {
  const f = fixture();
  f.repeat.handle(f.event()); f.advance(20); f.repeat.handle(f.event());
  const [id, timer] = [...f.timers][0]; f.timers.delete(id);
  f.jump(99.5); timer.fn();
  assert.equal(f.delivered.length, 1);
  assert.equal(f.timers.size, 1);
  f.advance(100);
  assert.deepEqual(f.delivered.map(d => d.at), [0, 100]);
});

test('non-direction keys stay with the caller and do not affect pending input', () => {
  const f = fixture(); f.repeat.handle(f.event()); f.advance(50); f.repeat.handle(f.event());
  const enter = f.event('Enter');
  assert.equal(f.repeat.handle(enter), false); assert.equal(enter.prevented, 0);
  f.advance(100);
  assert.deepEqual(f.delivered.map(d => d.at), [0, 100]);
});
