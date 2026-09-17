// SPDX-License-Identifier: GPL-3.0-or-later
// Synthetic inputs, actual CPU interaction/particle code; no firmware or WebGL.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../app/ps3-native-core.js');
const Birth = require('../app/ps3-particle-birth.js');
const f = Math.fround;
const GAIN = 0.25;

function parameters() {
  const raw = new Uint8Array(2304), d = new DataView(raw.buffer);
  const put = (at, values) => values.forEach((v, i) => d.setFloat32(at + 4 * i, v));
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  put(0, [0, -0.01, 0]);
  put(16, [0.16, 0.16, 0.16]);
  put(0x700, identity);
  put(0x740, [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0.5, 0.5, 0, 1]);
  d.setUint32(0x784, 32); d.setUint32(0x788, 16);
  put(0x800, [-10000, -10000, -10000]);
  put(0x810, [10000, 10000, 10000]);
  put(0x840, identity);
  put(0x8a0, [3, 0.015, 0, 0.04]);
  put(0x8b0, [0.0088883, 0.0088883, 0.0088883]);
  return new Core.Parameters(raw);
}
function particles(menu = true, referenceWind = false) {
  const records = new Float32Array(12 * 24);
  for (let i = 0; i < 24; i++) {
    records.set([-0.6 + i / 40, -0.4 + (i % 8) / 10, i / 80, 0.2,
      0.02, 0.01, -0.005, 0.0005, 0, 0, 0, 1], i * 12);
  }
  const p = new Core.Particles(records, parameters());
  if (menu) p.interaction = new Core.Interaction(p, Birth);
  if (referenceWind) {
    // The existing raw sampler is the unattenuated reference. Bypass only the
    // new live-menu multiplier, while keeping the real interaction controller.
    p.sampleField = function (x, y, z) {
      const interaction = this.interaction;
      this.interaction = null;
      try { Core.Particles.prototype.sampleField.call(this, x, y, z); }
      finally { this.interaction = interaction; }
    };
  }
  return p;
}
function fill(p, xyz) {
  for (let i = 0; i < p.params.field.length; i += 3) p.params.field.set(xyz, i);
}
function sampled(p, x = 0, y = 0) {
  p.sampleField(x, y, 0);
  return Array.from(p.fieldSample);
}
function sameState(a, b) {
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(a.render, b.render);
  assert.deepEqual(a.rng, b.rng);
  assert.equal(a.count, b.count);
  assert.equal(a.retiredCount, b.retiredCount);
}

for (const sign of [-1, 1]) {
  test(`Saturated ${sign > 0 ? 'upward' : 'downward'} wind remains directional at 25% strength`, () => {
    const raw = particles(false), live = particles();
    fill(raw, [0, sign * 127, 0]); fill(live, [0, sign * 127, 0]);
    const before = sampled(raw), after = sampled(live);
    assert.equal(before[1], sign);
    assert.equal(after[1], sign * GAIN);
    assert.deepEqual(after, [before[0], f(before[1] * GAIN), before[2], before[3]]);
  });
}

test('Weak and bilinearly interpolated wind retains its signed shape', () => {
  const raw = particles(false), live = particles();
  for (let cell = 0; cell < 512; cell++) {
    const offset = cell * 3;
    raw.params.field[offset + 1] = (cell * 37 % 255) - 127;
  }
  live.params.field.set(raw.params.field);
  for (const x of [-1.4, -0.91, -0.125, 0.007, 0.58, 1.4]) {
    for (const y of [-1.4, -0.63, -0.031, 0.24, 0.89, 1.4]) {
      assert.equal(sampled(live, x, y)[1], f(sampled(raw, x, y)[1] * GAIN));
    }
  }
});

test('The first/last signed-byte steps are not lost to extra quantization', () => {
  const raw = particles(false), live = particles();
  for (let value = -127; value <= 127; value++) {
    fill(raw, [0, value, 0]); fill(live, [0, value, 0]);
    const before = sampled(raw)[1], after = sampled(live)[1];
    assert.equal(after, f(before * GAIN));
    if (value) assert.notEqual(after, 0);
  }
});

test('X/Z field contributions are not reduced', () => {
  const raw = particles(false), live = particles();
  fill(raw, [79, -63, -41]); fill(live, [79, -63, -41]);
  const before = sampled(raw), after = sampled(live);
  assert.equal(after[0], before[0]); assert.equal(after[2], before[2]);
  assert.equal(after[1], f(before[1] * GAIN));
});

test('Scale is applied in field space before the existing camera transform', () => {
  const raw = particles(false), live = particles();
  const m = [1, 0, 0, 0, 2, 3, -4, 0, 0, 0, 1, 0, 99, 98, 97, 1];
  raw.params.fieldToWorld.set(m); live.params.fieldToWorld.set(m);
  fill(raw, [0, 127, 0]); fill(live, [0, 127, 0]);
  assert.deepEqual(sampled(raw), [2, 3, -4, 0]);
  assert.deepEqual(sampled(live), [0.5, 0.75, -1, 0]);
  assert.deepEqual(Array.from(live.params.fieldToWorld), m, 'No cumulative matrix mutation');
});

test('Raw reference replays remain unattenuated', () => {
  const p = particles(false);
  fill(p, [0, 127, 0]);
  for (let i = 0; i < 100; i++) assert.equal(sampled(p)[1], 1);
});

test('A fast above-bar row move is softened even though its byte field saturates', () => {
  const raw = particles(false), live = particles();
  // 8.4vh row travel plus the 25vh gap, expressed in Y-up NDC.
  const next = 0.668 * 0.22058835625648499;
  const cell = Birth.iconFieldWrite(raw.params.field, [-0.38, 0], [-0.38, next], 16 / 9);
  Birth.iconFieldWrite(live.params.field, [-0.38, 0], [-0.38, next], 16 / 9);
  const at = (cell[1] * 32 + cell[0]) * 3 + 1;
  assert.equal(raw.params.field[at], 127);
  // Merely multiplying writer gain by 0.25 would still hit the old cap.
  const early = new Int8Array(1536);
  Birth.iconFieldWrite(early, [-0.38, 0], [-0.38, next], 16 / 9, 11.3877, 0, GAIN);
  assert.equal(early[at], 127);
  const x = (cell[0] + 0.5) / 16 - 1, y = (cell[1] + 0.5) / 8 - 1;
  assert.equal(sampled(raw, x, y)[1], 1);
  assert.equal(sampled(live, x, y)[1], GAIN);
});

test('Field bytes, decay duration and animated object positions are unchanged', () => {
  const a = particles(true, true), b = particles();
  for (const p of [a, b]) {
    p.interaction.setObjects([{id: 'row', x: -0.38, y: 0}]);
    p.interaction.setObjects([{id: 'row', x: -0.38, y: 0.668}]);
  }
  let active = 0;
  for (let tick = 0; tick < 240; tick++) {
    a.interaction.step(); b.interaction.step();
    assert.deepEqual(b.params.field, a.params.field);
    assert.deepEqual(b.interaction.objects, a.interaction.objects);
    assert.equal(b.interaction.fieldLive, a.interaction.fieldLive);
    if (b.params.field.some(Boolean)) active++;
  }
  assert.ok(active > 30 && active < 240);
  assert.equal(b.interaction.fieldLive, false);
});

test('Velocity change from vertical wind is quartered, not total particle velocity', () => {
  const a = particles(false), b = particles();
  for (const p of [a, b]) {
    p.params.force.fill(0); p.params.drag.fill(0); p.params.brownian = 0;
    p.state[5] = 4; // Preserve legitimate pre-existing launch/drift speed.
    fill(p, [0, 127, 0]);
  }
  a.update(); b.update();
  const oldKick = a.state[5] - 4, newKick = b.state[5] - 4;
  assert.ok(oldKick > 0 && newKick > 0);
  assert.ok(Math.abs(newKick / oldKick - GAIN) < 0.00002);
  assert.ok(b.state[5] > 4, 'No velocity cap or blanket damping');
  assert.equal(b.state[4], a.state[4]); assert.equal(b.state[6], a.state[6]);
  assert.deepEqual(b.state.slice(7, 12), a.state.slice(7, 12));
});

test('No-input motion, aging, tumble and random streams are byte-identical', () => {
  const raw = particles(false), live = particles();
  for (let tick = 0; tick < 360; tick++) {
    raw.advance(1 / 60, false); live.advance(1 / 60, false);
    sameState(raw, live);
  }
});

test('Horizontal input rotation and perturbation are unchanged', () => {
  const a = particles(true, true), b = particles();
  for (const p of [a, b]) p.interaction.setObjects([{id: 'category', x: -0.38, y: 0.348}]);
  for (let tick = 0; tick < 240; tick++) {
    if (tick < 60 && tick % 6 === 0) {
      const direction = tick % 12 ? 0 : 1;
      for (const p of [a, b]) {
        p.interaction.direction(direction);
        p.interaction.setObjects([{id: 'category', x: direction ? -0.168 : -0.38, y: 0.348}]);
      }
    }
    a.advance(1 / 60, false); b.advance(1 / 60, false);
    sameState(a, b);
    assert.deepEqual(b.params.rotation, a.params.rotation);
    assert.equal(b.params.brownian, a.params.brownian);
  }
});

test('30fps batching and 60fps stepping produce the same input response', () => {
  const a = particles(), b = particles();
  for (const p of [a, b]) p.interaction.setObjects([{id: 'row', x: -0.38, y: -0.4}]);
  for (let frame = 0; frame < 120; frame++) {
    if (frame % 8 === 0) {
      for (const p of [a, b]) {
        p.interaction.direction(frame % 16 ? 2 : 3);
        p.interaction.setObjects([{id: 'row', x: -0.38, y: frame % 16 ? -0.4 : 0.268}]);
      }
    }
    a.advance(1 / 30, false);
    b.advance(1 / 60, false); b.advance(1 / 60, false);
    sameState(a, b);
    assert.deepEqual(a.params.field, b.params.field);
  }
});

test('No movement or history-only objects do not produce a new impulse', () => {
  const p = particles();
  for (let tick = 0; tick < 60; tick++) {
    p.interaction.setObjects([{id: 'row', x: -0.38, y: 0.2}]);
    p.advance(1 / 60, false);
  }
  assert.equal(p.interaction.writes, 0);
  assert.ok(p.params.field.every(v => v === 0));
});
