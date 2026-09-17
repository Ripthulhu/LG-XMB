// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Core = require('../app/ps3-native-core.js'), Birth = require('../app/ps3-particle-birth.js');
const pack = path.join(__dirname, '../app/ps3-native-data.js'), captured = fs.existsSync(pack);
function reference() {
  const sandbox = {atob, Uint8Array, Float32Array, DataView}; sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(pack, 'utf8'), sandbox); return sandbox.LGXMBPS3Reference;
}
// The response needs no capture: a stand-in parameter block is enough.
function standIn() {
  return {params: {brownian: Math.fround(0.24), rotation: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]), field: new Int8Array(1536)}};
}
const rows = selected => { const out = []; for (let i = Math.max(0, selected - 3); i <= Math.min(7, selected + 3); i++) {
  const offset = i - selected; out.push({id: 'r' + i, x: 31 / 50 - 1, y: 1 - (52 + offset * 8.4 - (offset < 0 ? 25 : 0) + 3.25) / 50}); } return out; };

test('a vertical menu step blows a local wind that decays to nothing', () => {
  const particles = standIn(), interaction = new Core.Interaction(particles, Birth);
  interaction.setObjects(rows(0)); interaction.step();
  assert.equal(particles.params.field.some(v => v !== 0), false, 'a first sighting only starts a history');
  interaction.setObjects(rows(1)); interaction.step();
  const written = Array.from(particles.params.field).filter(v => v !== 0);
  assert.ok(written.length > 0 && written.length <= 8);
  // Rows move up when the selection moves down; icon wind is Y only in the capture.
  for (let cell = 0; cell < 512; cell++) { assert.equal(particles.params.field[cell * 3], 0); assert.ok(particles.params.field[cell * 3 + 1] >= 0); }
  for (let i = 0; i < 200; i++) interaction.step();
  assert.equal(particles.params.field.some(v => v !== 0), false);
  assert.equal(interaction.moving, false); assert.equal(interaction.fieldLive, false);
});

test('a horizontal press raises the jitter briefly and only repeated presses turn the cloud', () => {
  const particles = standIn(), interaction = new Core.Interaction(particles, Birth), identity = Array.from(particles.params.rotation);
  interaction.direction(1); interaction.step(); interaction.step(); interaction.step();
  assert.ok(particles.params.brownian > 0.27, 'gain rises');
  assert.deepEqual(Array.from(particles.params.rotation), identity, 'one press stays under the small-angle threshold');
  for (let i = 0; i < 6; i++) { interaction.direction(1); interaction.step(); }
  assert.notDeepEqual(Array.from(particles.params.rotation), identity);
  assert.ok(Math.abs(particles.params.rotation[0] - 1) < 1e-6 && Math.abs(particles.params.rotation[5] - 1) < 1e-12, 'a turn about Y, and a tiny one');
  for (let i = 0; i < 1500; i++) interaction.step();
  assert.deepEqual(Array.from(particles.params.rotation), identity);
  assert.ok(Math.abs(particles.params.brownian - 0.24) < 0.002);
  const vertical = new Core.Interaction(standIn(), Birth); vertical.direction(3); vertical.step(); vertical.step();
  assert.ok(Math.abs(vertical.particles.params.brownian - 0.24) < 1e-6, 'd-pad Y scale is zero in the capture');
});

test('births land on the visible sheet and never overfill the pool', {skip: !captured}, () => {
  const ref = reference(), wave = new Core.Wave(ref.wave, ref.settings);
  const particles = new Core.Particles(ref.particles, new Core.Parameters(ref.particleParams));
  particles.emitter = new Core.Emitter(wave, particles, ref.basis, ref.viewProjection, Birth);
  wave.advance(1 / 60);
  const clip = new Float32Array(4), vp = ref.viewProjection;
  for (const [x, y] of [[0, 0], [64, 64], [127, 127], [-1, 130]]) {
    wave.meshPoint(x, y, ref.basis, clip); const w = particles.emitter.sample(x, y);
    for (let c = 0; c < 4; c++) assert.ok(Math.abs(w[0] * vp[c] + w[1] * vp[4 + c] + w[2] * vp[8 + c] + vp[12 + c] - clip[c]) < 1e-4);
  }
  for (let frame = 0; frame < 900; frame++) { wave.advance(1 / 60); particles.advance(1 / 60, true); }
  const e = particles.emitter; let alive = 0;
  for (let i = 0; i < particles.capacity; i++) if (particles.state[i * 12 + 3] !== Core.DEAD) alive++;
  assert.ok(e.births > 1000, 'the moving sheet keeps emitting');
  assert.equal(alive + e.free.length, particles.capacity, 'every slot is either alive or on the free list, once');
  assert.equal(new Set(e.free).size, e.free.length);
  assert.ok(e.free.every(i => particles.state[i * 12 + 3] === Core.DEAD));
  assert.ok(particles.state.every(Number.isFinite));
  // A slower frame runs two updates against one sheet movement and still emits.
  const before = e.births; for (let frame = 0; frame < 300; frame++) { wave.advance(1 / 30); particles.advance(1 / 30, true); }
  assert.ok(e.births > before + 200);
});
