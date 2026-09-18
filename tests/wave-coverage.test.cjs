// SPDX-License-Identifier: GPL-3.0-or-later
// Approved Wave Lab value, not an assertion about Sony's original material.
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const wave = fs.readFileSync(path.join(root, 'shaders/waveFragment.frag'), 'utf8').replace(/\r\n/g, '\n');
const shaders = require(path.join(root, 'app/ps3-native-shaders.js'));
const clean = wave.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
const match = /float\s+coverage\s*=\s*min\(1\.0-exp\(-light\*5\.0\),\s*([\d.]+)\)\s*\*\s*edge\s*;/.exec(clean);
const ceiling = match ? Number(match[1]) : NaN;
const base = light => 1 - Math.exp(-light * 5);
const coverage = (light, edge = 1) => Math.min(base(light), ceiling) * edge;

test('readable shader selects the approved ceiling before edge fading', () => {
  assert.ok(match, 'Cap coverage before multiplying by edge; not a final-frame clamp.');
  assert.equal(ceiling, .30);
});
test('the loaded JavaScript bundle includes exactly the readable shader', () => {
  assert.equal(shaders.waveFragment, wave);
});
test('the wave stage keeps its existing precision, texture count and uniforms', () => {
  assert.match(clean, /precision mediump float;/);
  assert.equal((clean.match(/\btexture\s*\(/g) || []).length, 1);
  assert.deepEqual([...clean.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map(m => m[1]),
    ['uFresnel', 'uWave', 'uBrightness', 'uMaterial']);
});
test('RGB and the coverage alpha use the same capped value; brightness stays independent', () => {
  assert.match(clean, /outColor=vec4\(uWave\*coverage\*uBrightness,coverage\);/);
  assert.doesNotMatch(clean, /uLabOverlap|overlapBlur|dFdx|dFdy/);
});
test('the low-intensity response is unchanged, rather than globally multiplied by 0.3', () => {
  const limit = -Math.log(1 - ceiling) / 5;
  for (let i = 0; i < 1000; i++) {
    const light = limit * i / 1000;
    assert.equal(coverage(light), base(light));
  }
  assert.notEqual(coverage(.02), .3 * base(.02));
});
test('bright sheets plateau at 0.30, with a continuous monotone response', () => {
  let previous = 0;
  for (let i = 0; i <= 10000; i++) {
    const value = coverage(i / 1000);
    assert.ok(value >= previous && value <= .30 && value >= 0);
    previous = value;
  }
  assert.equal(coverage(20), .30);
  const knee = -Math.log(.7) / 5;
  assert.ok(Math.abs(coverage(knee - 1e-10) - coverage(knee + 1e-10)) < 1e-8);
});
test('the edge envelope still attenuates bright sheets instead of being clipped away', () => {
  for (let i = 0; i <= 100; i++) {
    const edge = i / 100;
    assert.equal(coverage(10, edge), .3 * edge);
    assert.ok(coverage(10, edge) <= base(10) * edge);
  }
  assert.equal(coverage(10, 0), 0);
  assert.equal(coverage(10, .5), .15);
});
test('additive overlaps may exceed 0.3; this is not a final-image limiter', () => {
  assert.equal(coverage(10) * 2, .6);
  assert.ok(coverage(10) * 4 > 1);
});
test('current brightness multipliers preserve hue and do not change the coverage ceiling', () => {
  const tint = [.2, .4, .8], alpha = coverage(10);
  for (const brightness of [.3, .6, 1]) {
    const rgb = tint.map(c => c * alpha * brightness);
    assert.equal(rgb[1] / rgb[0], 2);
    assert.equal(rgb[2] / rgb[0], 4);
    assert.equal(alpha, .3);
  }
});
