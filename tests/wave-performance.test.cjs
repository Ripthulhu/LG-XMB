// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const preferences = require('../app/launcher-preferences.js');
const load = saved => preferences.load({getItem: () => JSON.stringify(saved || {})}, false);
const source = fs.readFileSync(path.join(__dirname, '../app/ps3-native-renderer.js'), 'utf8');
const root = {};
vm.runInNewContext(source, {window: root});
const {Renderer, quality} = root.LGXMBPS3Native;

test('granular wave controls preserve defaults and every supported setting round-trips', () => {
  const current = load();
  assert.deepEqual([current.waveFrameRate, current.waveSampling, current.waveDetail,
    current.waveParticleCount], [60, 1.5, 'high', 2000]);
  const choices = {waveFrameRate: [20, 30, 60], waveSampling: [0.5, 0.75, 1, 1.25, 1.5, 2],
    waveDetail: ['coarse', 'standard', 'high'], waveParticleCount: [500, 1000, 2000, 4000]};
  for (const [key, values] of Object.entries(choices)) for (const value of values) {
    const saved = {...current, [key]: value, theme: 'classic', colour: 9, waveSpeed: 'fast'};
    const restored = load(saved);
    assert.deepEqual(restored, saved);
    assert.deepEqual(load(JSON.parse(JSON.stringify(restored))), restored);
    const requested = preferences.waveQuality(restored);
    assert.deepEqual(JSON.parse(JSON.stringify(quality(requested))), requested);
  }
});

test('unsupported resolution and frame caps do not replace saved valid settings', () => {
  for (const sampling of [-1, 0, 0.25, 0.6, 4, '0.5', null]) {
    assert.equal(load({waveSampling: sampling}).waveSampling, 1.5);
    assert.equal(quality({sampling}, quality({sampling: 0.75})).sampling, 0.75);
  }
  for (const frameRate of [0, 10, 24, 120, '20', null]) {
    assert.equal(load({waveFrameRate: frameRate}).waveFrameRate, 60);
    assert.equal(quality({frameRate}, quality({frameRate: 20})).frameRate, 20);
  }
});

function allocation(sampling, refuse = () => false) {
  const requested = [], released = [];
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    settings: quality({sampling}), maxDimension: 8192, allocations: 0,
    gl: {isContextLost: () => false},
    allocate(width, height) {
      requested.push([width, height]);
      if (refuse(width, height)) throw new Error('Allocation refused');
      return {width, height};
    },
    releaseTarget(target) {if (target) released.push(target);}
  });
  return {renderer, requested, released};
}

test('wave resolution allocates the requested target, keeps aspect and reuses unchanged storage', () => {
  for (const sampling of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    const {renderer, requested} = allocation(sampling);
    renderer.resize(1920, 1080);
    assert.deepEqual(requested, [[1920 * sampling, 1080 * sampling]]);
    assert.equal(renderer.effectiveScale, sampling);
    assert.equal(renderer.samplingFallback, null);
    renderer.resize(1920, 1080);
    assert.equal(requested.length, 1);
  }
});

test('allocation failures retry only smaller targets and preserve the last valid target on failure', () => {
  for (const [sampling, expected] of [
    [2, [[3840, 2160], [1920, 1080], [1440, 810], [960, 540]]],
    [0.75, [[1440, 810], [960, 540]]]
  ]) {
    const {renderer, requested} = allocation(sampling, width => width > 960);
    renderer.resize(1920, 1080);
    assert.deepEqual(requested, expected);
    assert.equal(renderer.effectiveScale, 0.5);
    assert.equal(renderer.samplingFallback, 'Render-target limit');
  }
  const {renderer, requested, released} = allocation(0.5, () => true);
  const previous = {width: 320, height: 180};
  renderer.target = previous;
  assert.throws(() => renderer.resize(1920, 1080), /unavailable/);
  assert.deepEqual(requested, [[960, 540]]);
  assert.equal(renderer.target, previous);
  assert.equal(released.length, 0);
});

test('all mesh settings generate valid indices including their edge guards', () => {
  for (const [detail, grid] of [['coarse', 32], ['standard', 64], ['high', 128]]) {
    let indices;
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      settings: quality({detail}),
      gl: {bindVertexArray() {}, bindBuffer() {}, bufferData(_, data) {indices = data;}}
    });
    renderer.updateGrid();
    assert.equal(renderer.grid, grid);
    assert.equal(indices.length, (grid - 1) ** 2 * 6 + (grid - 1) * 12);
    assert.ok([...indices].every(index => index >= 0 && index < grid * grid + grid * 2));
    assert.equal(Math.max(...indices), grid * grid + grid * 2 - 1);
  }
});

test('20, 30 and 60 fps draw at regular intervals without changing elapsed wave motion', () => {
  for (const frameRate of [20, 30, 60]) {
    const draws = [], steps = [];
    let now = 1000;
    const wave = Object.assign(Object.create(root.C5Wave.prototype), {
      ps3Quality: quality({frameRate}), lastFrame: now, motionGain: 1, motionElapsed: 220,
      mode: 'webgl', reducedMotion: false, motionHeld: false, speed: 1.5, time: 0,
      allowed: () => true, advanceIdleBrightness() {}, scheduleFrame() {},
      simulation: {advance(seconds) {steps.push(seconds);}},
      draw() {draws.push(now);}
    });
    for (let frame = 1; frame <= 120; frame++) {
      now = 1000 + frame * 1000 / 60;
      wave.tick(now);
    }
    assert.equal(draws.length, frameRate * 2);
    assert.ok(Math.abs(steps.reduce((sum, seconds) => sum + seconds, 0) - 2) < 1e-9);
    for (let i = 1; i < draws.length; i++) assert.ok(Math.abs(draws[i] - draws[i-1] - 1000 / frameRate) < 1e-9);
  }
});
