/* Numerical measurements against the local capture; not a TV benchmark. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const Core = require(path.join(root, 'app/ps3-native-core.js'));
const sandbox = { atob, Uint8Array, Float32Array, DataView };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(root, 'app/ps3-native-data.js'), 'utf8'), sandbox, { timeout: 3000 });
const reference = sandbox.LGXMBPS3Reference;
const fixtureRoot = process.env.PS3_FIXTURES || path.join(root, 'private-data/fixtures');
function read(name) {
  const bytes = fs.readFileSync(path.join(fixtureRoot, name));
  const floats = new Float32Array(bytes.length / 4);
  for (let i = 0; i < floats.length; i++) floats[i] = bytes.readFloatBE(i * 4);
  return floats;
}
function maxError(actual, expected) {
  assert.equal(actual.length, expected.length);
  let result = 0;
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Number.isFinite(actual[i]));
    result = Math.max(result, Math.abs(actual[i] - expected[i]));
  }
  return result;
}
const wave = new Core.Wave(reference.wave, reference.settings);
const particles = new Core.Particles(reference.particles, new Core.Parameters(reference.particleParams));
const interpolation = maxError(wave.output, read('wave/output.bin'));
wave.generateLattice();
const lattice = maxError(wave.lattice, read('wave/lattice_transfer.bin').subarray(0, 2156));
particles.update();
const particle = maxError(particles.state, read('particles/state_after.bin'));
const result = {
  capture: reference.capture,
  interpolationMaxError: interpolation,
  latticeMaxError: lattice,
  particleStateMaxError: particle,
  retiredParticles: particles.retiredCount,
  survivingParticles: particles.pack(),
  randomState: Array.from(particles.rng, n => n.toString(16).padStart(8, '0')),
  scope: 'Numerical CPU comparisons, not a complete screenshot or hardware comparison.'
};
assert.ok(interpolation < 2e-6 && lattice < 5e-6 && particle < 2e-5);
assert.equal(particles.retiredCount, 9);
assert.deepEqual(result.randomState, ['fd42a287', '082dd79f', '5a430668']);
if (process.argv.includes('--long-run')) {
  const w = new Core.Wave(reference.wave, reference.settings);
  const p = new Core.Particles(reference.particles, new Core.Parameters(reference.particleParams));
  const start = performance.now();
  for (let i = 0; i < 6000; i++) {
    w.advance(1 / 60); p.advance(1 / 60, true);
    assert.ok(w.controls.every(Number.isFinite));
    assert.ok(p.state.every(Number.isFinite));
  }
  result.longRun = { simulatedSeconds: 100, updates: 6000, finite: true,
    recycledParticles: p.recycled, elapsedMsOnThisNodeHost: performance.now() - start,
    performanceScope: 'This Node host only, no TV or GPU timing.' };
}
const outIndex = process.argv.indexOf('--out');
if (outIndex >= 0) {
  if (!process.argv[outIndex + 1]) throw new Error('--out needs a path');
  const output = path.resolve(process.argv[outIndex + 1]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
