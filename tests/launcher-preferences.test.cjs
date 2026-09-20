// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const preferences = require('../app/launcher-preferences.js');
const colors = value => value || {source: 'theme'};

test('Back defaults to the previous app while explicit saved choices survive updates', () => {
  assert.equal(preferences.load({getItem: () => null}, false, colors).backBehavior, 'previous');
  for (const backBehavior of ['previous', 'stay', 'lg']) {
    const storage = {getItem: () => JSON.stringify({backBehavior})};
    assert.equal(preferences.load(storage, false, colors).backBehavior, backBehavior);
  }
});

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
  assert.equal('msaa' in quality, false);
  assert.equal(quality.sampling, 2);
  assert.equal(quality.particles, false);
  quality.sampling = 1;
  assert.equal(restored.waveSampling, 2);
  assert.equal('waveMSAA' in restored, false);
});

test('retired wave settings migrate to the simplified controls and survive saving', () => {
  for (const filter of ['fxaa', 'wave', 'off']) {
    const loaded = preferences.load({getItem: () => JSON.stringify({waveMSAA: 4,
      waveDetail: 'fine', waveSoftness: 0.75, wavePostprocess: filter})}, false, colors);
    assert.equal(loaded.waveDetail, 'high');
    assert.equal(loaded.waveSoftness, 1.5);
    assert.equal(loaded.wavePostprocess, filter === 'off' ? 'off' : 'wave');
    assert.equal('waveMSAA' in loaded, false);
    let saved;
    preferences.save({setItem: (_, value) => {saved = value;}}, loaded);
    assert.deepEqual(preferences.load({getItem: () => saved}, false, colors), loaded);
  }
  for (const amount of [0, 1.5, 3]) {
    const loaded = preferences.load({getItem: () => JSON.stringify({waveSoftness: amount})}, false, colors);
    assert.equal(loaded.waveSoftness, amount);
  }
});

test('appearance controls expose only the supported mesh, softness and FXAA choices', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const state = preferences.load({getItem: () => null}, false, colors);
  const groups = {}, rendered = [], context = {window: {}, LGXMBPreferences: preferences};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../app/appearance-settings.js'), 'utf8'), context);
  new context.window.LGXMBAppearanceSettings({preferences: state, themes: {},
    ui: {row: () => ({}), choiceGroup: (name, choices, selected, set) => {groups[name] = {choices, selected, set};}},
    wave: {setQuality: value => rendered.push(value)}, save() {}, applyPreferences() {}
  }).open();
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.equal(groups.MSAA, undefined);
  assert.deepEqual(plain(groups['Mesh detail'].choices), [['standard', 'Reduced'], ['high', 'Original']]);
  assert.deepEqual(plain(groups['Edge softness'].choices), [[0, 'Sharp'], [1.5, 'Subtle'], [3, 'Soft']]);
  assert.deepEqual(plain(groups['Post-process antialiasing'].choices), [['off', 'Off'], ['wave', 'FXAA']]);
  groups['Edge softness'].set(3); groups['Post-process antialiasing'].set('wave');
  assert.equal(rendered.at(-1).softness, 3);
  assert.equal(rendered.at(-1).postprocess, 'wave');
  assert.equal('msaa' in rendered.at(-1), false);
});
