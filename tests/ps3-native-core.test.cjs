'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../app/ps3-native-core.js');
const Shaders = require('../app/ps3-native-shaders.js');
const fixtures = process.env.PS3_FIXTURES || path.join(__dirname, '../private-data/fixtures');
const packPath = path.join(__dirname, '../app/ps3-native-data.js');
let reference;
if (fs.existsSync(packPath)) {
  const sandbox = { atob, Uint8Array, Float32Array, DataView };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(packPath, 'utf8'), sandbox, { timeout: 3000 });
  reference = sandbox.LGXMBPS3Reference;
}
const captured = reference && fs.existsSync(path.join(fixtures, 'wave/output.bin'));
function beFloats(name) {
  const b = fs.readFileSync(path.join(fixtures, name));
  const a = new Float32Array(b.length / 4);
  for (let i = 0; i < a.length; i++) a[i] = b.readFloatBE(i * 4);
  return a;
}
function difference(a, b) {
  assert.equal(a.length, b.length);
  let maximum = 0;
  for (let i = 0; i < a.length; i++) {
    assert.ok(Number.isFinite(a[i]), `non-finite component ${i}`);
    maximum = Math.max(maximum, Math.abs(a[i] - b[i]));
  }
  return maximum;
}
function particleState() {
  return new Core.Particles(reference.particles, new Core.Parameters(reference.particleParams));
}
function waveState() { return new Core.Wave(reference.wave, reference.settings); }

for (const [name, source] of Object.entries(Shaders)) {
  test(`${name}: native GLSL ES 3.00, no legacy shader constructs`, () => {
    assert.ok(source.startsWith('#version 300 es\n'));
    assert.doesNotMatch(source, /\b(attribute|varying|gl_FragColor|texture2D)\b/);
    if (name.endsWith('Fragment')) assert.match(source, /layout\(location\s*=\s*0\)\s*out\s+vec4/);
  });
}
test('known SPU reciprocal estimate differs from ideal division', () => {
  assert.equal(Core.reciprocal(1), Math.fround(0.9998779296875));
  assert.notEqual(Core.reciprocal(1), 1);
  assert.throws(() => Core.reciprocal(0), /normal/);
  assert.throws(() => Core.reciprocal(Infinity), /normal/);
});
test('lifetime envelope has original fade-in and fade-out endpoints', () => {
  assert.equal(Core.fade(0), 0);
  assert.ok(Math.abs(Core.fade(.02) - 1) < 1e-6);
  assert.ok(Math.abs(Core.fade(.5) - 1) < 1e-6);
  assert.ok(Core.fade(.97) > .49 && Core.fade(.97) < .51);
});
test('renderer requests no WebGL 1 context and has no runtime readback path', () => {
  const s = fs.readFileSync(path.join(__dirname, '../app/ps3-native-renderer.js'), 'utf8');
  assert.match(s, /getContext\('webgl2'/);
  assert.doesNotMatch(s, /getContext\('(webgl|experimental-webgl)'/);
  assert.doesNotMatch(s, /\b(readPixels|getBufferSubData)\s*\(/); // gl.finish not renderer.finish
});
// Numerical comparisons below need the private capture pack. A source-only
// checkout explicitly skips them rather than treating synthetic data as captured.
test('captured wave interpolation', { skip: !captured }, () => {
  const error = difference(waveState().output, beFloats('wave/output.bin'));
  assert.ok(error < 2e-6, `maximum difference ${error}`);
});
test('captured FFD lattice with the observed pipeline phase', { skip: !captured }, () => {
  const wave = waveState(); wave.generateLattice();
  const expected = beFloats('wave/lattice_transfer.bin').subarray(0, 2156);
  assert.ok(difference(wave.lattice, expected) < 5e-6);
});
test('captured particle update, retirement order and three RNG streams', { skip: !captured }, () => {
  const particles = particleState(); particles.update();
  assert.ok(difference(particles.state, beFloats('particles/state_after.bin')) < 2e-5);
  assert.equal(particles.retiredCount, 9);
  const free = fs.readFileSync(path.join(fixtures, 'particles/dead_indices.bin'));
  const expected = Array.from({ length: 9 }, (_, i) => free.readUInt32BE((23 + i) * 4));
  assert.deepEqual(Array.from(particles.retired.subarray(0, 9)), expected);
  assert.deepEqual(Array.from(particles.rng), [0xfd42a287, 0x082dd79f, 0x5a430668]);
});
test('captured quaternion half truncation and compacted count', { skip: !captured }, () => {
  const particles = particleState();
  particles.state.set(beFloats('particles/state_after.bin')); particles.pack();
  const expected = fs.readFileSync(path.join(fixtures, 'particles/render_records.bin'));
  assert.equal(particles.count, 2016);
  // Repack the captured post-update state, isolating the packing rule from
  // small differences in our reconstructed quaternion arithmetic.
  for (let i = 0; i < particles.count; i++) {
    for (let k = 0; k < 4; k++) {
      const stored = expected.readUInt16BE(i * 32 + 16 + k * 2);
      assert.equal(Core.halfTruncate(particles.render[i * 8 + 4 + k]), stored);
    }
  }
});
test('60 Hz simulation is independent of a 30 Hz draw clock', { skip: !captured }, () => {
  const a = waveState(), b = waveState();
  for (let i = 0; i < 60; i++) a.advance(1 / 60);
  for (let i = 0; i < 30; i++) b.advance(1 / 30);
  assert.equal(a.ticks, b.ticks);
  assert.equal(difference(a.p, b.p), 0);
  assert.ok(difference(a.output, b.output) < 2e-5);
});
test('wave scheduling retains strict greater-than-one boundary', { skip: !captured }, () => {
  const wave = waveState(); wave.fraction = 0;
  assert.equal(wave.advance(1 / 60), 0);
  assert.equal(wave.advance(1 / 60), 1);
  assert.throws(() => wave.advance(-1), /interval/);
  assert.throws(() => wave.advance(Infinity), /interval/);
});
test('clock reset starts a bounded, explicitly adapted field crossfade', { skip: !captured }, () => {
  const wave = waveState(); wave.clock = 10; const old = wave.lattice.slice();
  wave.tick(); wave.generateLattice();
  assert.equal(wave.clock, 0); assert.equal(wave.clockWraps, 1);
  assert.equal(wave.transitionTicks, 60); assert.equal(difference(wave.lattice, old), 0);
  for (let i = 0; i < 60; i++) wave.advance(1 / 60);
  assert.ok(wave.controls.every(Number.isFinite));
});
test('state and scratch buffers are retained over animation', { skip: !captured }, () => {
  const wave = waveState(), particles = particleState();
  const p = wave.p, c = wave.controls, l = wave.lattice, state = particles.state, render = particles.render;
  for (let i = 0; i < 120; i++) { wave.advance(1 / 60); particles.advance(1 / 60, true); }
  assert.equal(wave.p, p); assert.equal(wave.controls, c); assert.equal(wave.lattice, l);
  assert.equal(particles.state, state); assert.equal(particles.render, render);
  assert.ok(wave.controls.every(Number.isFinite)); assert.ok(particles.state.every(Number.isFinite));
  assert.ok(particles.recycled > 0);
});
