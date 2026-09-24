// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/ps3-native-renderer.js'), 'utf8'), {window: root});

function fixture() {
  const calls = {wave: 0, clear: 0, composite: 0};
  const gl = new Proxy({}, {get(_, name) {
    return () => {
      if (name === 'clear') calls.clear++;
      if (name === 'drawArrays') calls.composite++;
    };
  }});
  const renderer = Object.assign(Object.create(root.LGXMBPS3Native.Renderer.prototype), {
    ready: true, gl, grid: 128, settings: root.LGXMBPS3Native.quality(),
    simulation: {wave: {revision: 1}, particles: {}},
    target: {width: 640, height: 360}, backdrop: {},
    uniforms: {composite: {}}, filterTunings: {normal: [0, 0, 0]}, drawCount: 0,
    updateGrid() {}, resize() {}, prepareAmbient() {}, backdropPass() {},
    band() {return [0, 1];}, wavePass() {calls.wave++;}
  });
  const wave = [0.3, 0.5, 0.7];
  const draw = (brightness = 1, idle, width = 640, height = 360) =>
    renderer.draw(width, height, wave, brightness, [0, 0, 0], null, idle);
  return {renderer, calls, wave, draw};
}

test('held brightness fades reuse the wave target and still compose every frame', () => {
  const {renderer, calls, draw} = fixture();
  draw();
  for (let frame = 1; frame <= 72; frame++) {
    draw(1 - frame / 144, {background: 1 - frame / 72, wave: frame / 72, particles: 1});
  }
  renderer.configure({softness: 3, postprocess: 'wave', strength: 'strong'});
  draw();
  assert.deepEqual(calls, {wave: 1, clear: 1, composite: 74});
  assert.equal(renderer.drawCount, 74);
});

test('wave geometry, each colour channel, mesh, projection and target invalidate once', () => {
  const {renderer, calls, wave, draw} = fixture();
  draw();
  let expected = 1;
  for (const change of [
    () => renderer.simulation.wave.revision++,
    () => wave[0] += 0.1,
    () => wave[1] += 0.1,
    () => wave[2] += 0.1,
    () => renderer.grid = 64,
    () => renderer.target = {width: 640, height: 360}
  ]) {
    change();
    draw();
    draw();
    assert.equal(calls.wave, ++expected);
    assert.equal(calls.clear, expected);
  }
  draw(1, undefined, 480, 360);
  draw(1, undefined, 480, 360);
  assert.equal(calls.wave, ++expected, 'aspect invalidates even if rounded target storage is unchanged');
  renderer.draw(480, 360, wave.slice(), 1, [0, 0, 0], null);
  assert.equal(calls.wave, expected, 'an equivalent new colour array preserves the target');
});

test('a failed wave pass cannot mark an unpainted target as retained', () => {
  const {renderer, calls, draw} = fixture();
  const paint = renderer.wavePass;
  renderer.wavePass = () => {throw new Error('draw failed');};
  assert.throws(() => draw(), /draw failed/);
  renderer.wavePass = paint;
  draw();
  draw();
  assert.equal(calls.wave, 1);
  assert.equal(calls.clear, 2);
});
