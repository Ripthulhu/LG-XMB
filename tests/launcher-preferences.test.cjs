// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const preferences = require('../app/launcher-preferences.js');
const colors = value => value || {source: 'theme'};

test('storage and media-query failures preserve a usable preference snapshot', () => {
  const inaccessible = {getItem() {throw new Error('Storage denied');}};
  assert.equal(preferences.load(inaccessible, false, colors).waveFrameRate, 60);
  const empty = {getItem: () => null};
  const unavailableMotion = () => {throw new Error('Media query unavailable');};
  assert.equal(preferences.load(empty, unavailableMotion, colors).motion, 'full');
  const savedMotion = {getItem: () => JSON.stringify({motion: 'reduced', sound: true})};
  const restored = preferences.load(savedMotion, unavailableMotion, colors);
  assert.equal(restored.motion, 'reduced');
  assert.equal(restored.sound, true);
});

test('legacy settings migrate in memory, then save under the current key', () => {
  const stored = {'openxmb-c5-preferences-v1': JSON.stringify({waveParticleCount: 500, waveBrightness: 'high'})};
  const storage = {getItem: key => stored[key], setItem: (key, value) => {stored[key] = value;}};
  const loaded = preferences.load(storage, true, colors);
  assert.equal(loaded.waveParticleCount, 1000);
  assert.equal(loaded.waveBrightness, 'normal');
  assert.equal(loaded.motion, 'reduced');
  assert.equal(stored['lg-xmb-preferences-v1'], undefined);
  preferences.save(storage, loaded);
  assert.deepEqual(JSON.parse(stored['lg-xmb-preferences-v1']), loaded);
});

test('failed save is reported to the caller without a fallback write', () => {
  let writes = 0;
  const storage = {setItem() {writes++; throw new Error('Quota exceeded');}};
  assert.throws(() => preferences.save(storage, {sound: true}), /Quota exceeded/);
  assert.equal(writes, 1);
});

test('independent launchers do not share settings or mutable seasonal colours', () => {
  const storage = {getItem: () => null};
  const one = preferences.load(storage, false, colors);
  const two = preferences.load(storage, false, colors);
  one.waveColors.source = 'ps3'; one.theme = 'ember';
  assert.equal(two.waveColors.source, 'theme');
  assert.equal(two.theme, 'midnight');
  const first = preferences.createThemes(), second = preferences.createThemes();
  preferences.updateSeasonal(first, new Date(2026, 0, 15));
  assert.notEqual(first.seasonal.wave, second.seasonal.wave);
  assert.equal(first.seasonal.wave, '#f2e6a6');
});

test('renderer options are a fresh projection of the saved quality settings', () => {
  const restored = preferences.load({getItem: () => JSON.stringify({waveMSAA: 4, waveSampling: 2, waveParticles: false})}, false, colors);
  const quality = preferences.waveQuality(restored);
  assert.equal(quality.msaa, 4);
  assert.equal(quality.sampling, 2);
  assert.equal(quality.particles, false);
  quality.msaa = 0;
  assert.equal(restored.waveMSAA, 4);
});
