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
  assert.equal(loaded.waveParticleCount, 500);
  assert.equal(loaded.backgroundBrightness, 0);
  assert.equal('waveBrightness' in loaded, false);
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

test('Original uses the calendar while every fixed colour stays at daytime', () => {
  const base = preferences.load({getItem: () => null}, false, colors);
  assert.deepEqual(preferences.backgroundTheme(base).colors,
    {mode: 'ps3', dateMode: 'auto', timeMode: 'auto', month: 1});
  assert.equal(preferences.colourOptions.length, 12);
  for (const option of preferences.colourOptions) {
    assert.match(option.colour, /^#[a-f\d]{6}$/);
    assert.ok(option.label);
    const state = preferences.load({getItem: () => JSON.stringify({colour: option.value})}, false, colors);
    assert.deepEqual(preferences.backgroundTheme(state).colors,
      {mode: 'ps3', dateMode: 'fixed', timeMode: 'day', month: option.value});
  }
});

test('legacy seasonal, pinned months and custom colours migrate without competing settings', () => {
  const cases = [
    [{theme: 'seasonal'}, 'original'],
    [{waveColors: {mode: 'ps3', dateMode: 'auto', timeMode: 'night'}}, 'original'],
    [{waveColors: {mode: 'ps3', clock: 'auto'}}, 'original'],
    [{waveColors: {mode: 'ps3', clock: 'fixed', month: 9}}, 9],
    [{waveColors: {mode: 'monthly', month: 4}}, 4],
    [{waveColors: {mode: 'monthly', dateMode: 'auto'}}, 'original'],
    [{waveColors: {mode: 'ps3', dateMode: 'fixed', month: 12, timeMode: 'auto'}}, 12],
    [{waveColors: {mode: 'rgb', red: 224, green: 64, blue: 44}}, 12],
    [{theme: 'graphite'}, 1]
  ];
  for (const [saved, expected] of cases) {
    const state = preferences.load({getItem: () => JSON.stringify(saved)}, false, colors);
    assert.equal(state.colour, expected, JSON.stringify(saved));
    assert.equal('waveColors' in state, false);
    assert.equal('waveParticles' in state, false);
    assert.equal('waveBrightness' in state, false);
    assert.deepEqual(preferences.load({getItem: () => JSON.stringify(state)}, false, colors), state);
  }
});

test('Original and Classic consistently control sparkles, including old particle preferences', () => {
  for (const [saved, expected] of [
    [{waveParticles: false}, 'classic'],
    [{waveParticles: true}, 'original'],
    [{theme: 'original', waveParticles: false}, 'original'],
    [{theme: 'classic', waveParticles: true}, 'classic']
  ]) {
    const state = preferences.load({getItem: () => JSON.stringify(saved)}, false, colors);
    assert.equal(state.theme, expected);
    assert.equal(preferences.waveQuality(state).particles, expected === 'original');
  }
});

test('background selection and six dimming levels are bounded and round-trip', () => {
  const gains = [];
  for (let offset = 0; offset >= -5; offset--) {
    const state = preferences.load({getItem: () => JSON.stringify({background: 'wallpaper', backgroundBrightness: offset})}, false, colors);
    assert.equal(state.background, 'wallpaper');
    assert.equal(state.backgroundBrightness, offset);
    gains.push(preferences.waveStyle(state).brightness);
    assert.deepEqual(preferences.load({getItem: () => JSON.stringify(state)}, false, colors), state);
  }
  assert.deepEqual(gains, [1, .85, .7, .6, .45, .3]);
  for (const value of [-6, 1, -1.5, '-2', null]) {
    const state = preferences.load({getItem: () => JSON.stringify({background: 'remote', backgroundBrightness: value})}, false, colors);
    assert.equal(state.backgroundBrightness, 0);
    assert.equal(state.background, 'theme');
  }
  for (const [waveBrightness, gain] of [['dim', .3], ['low', .6], ['normal', 1], ['high', 1]]) {
    const state = preferences.load({getItem: () => JSON.stringify({waveBrightness})}, false, colors);
    assert.equal(preferences.waveStyle(state).brightness, gain);
  }
});

test('screensaver defaults to two minutes and a quarter brightness for each layer', () => {
  const state = preferences.load({getItem: () => null}, false, colors);
  assert.equal(state.screensaverDelay, 120000);
  assert.equal(state.screensaverBrightness, 0.25);
  assert.equal(state.screensaverWaveBrightness, 0.25);
  assert.equal(state.screensaverParticleBrightness, 0.25);
});

test('every screensaver delay and brightness choice survives saving, including zero', () => {
  for (const screensaverDelay of [0, 30000, 60000, 120000, 300000, 600000]) {
    for (const screensaverBrightness of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      const state = preferences.load({getItem: () => JSON.stringify({
        screensaverDelay, screensaverBrightness, backgroundBrightness: -3
      })}, false, colors);
      assert.equal(state.screensaverDelay, screensaverDelay);
      assert.equal(state.screensaverBrightness, screensaverBrightness);
      assert.equal(state.screensaverWaveBrightness, screensaverBrightness);
      assert.equal(state.screensaverParticleBrightness, screensaverBrightness);
      assert.equal(preferences.waveStyle(state).brightness, 0.6);
      let saved;
      preferences.save({setItem: (_, value) => {saved = value;}}, state);
      assert.deepEqual(preferences.load({getItem: () => saved}, false, colors), state);
    }
  }
});

test('screensaver layer brightness stays independent and round-trips, including zero', () => {
  for (const screensaverWaveBrightness of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
    for (const screensaverParticleBrightness of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      const state = preferences.load({getItem: () => JSON.stringify({
        screensaverBrightness: 0.1, screensaverWaveBrightness, screensaverParticleBrightness
      })}, false, colors);
      assert.equal(state.screensaverBrightness, 0.1);
      assert.equal(state.screensaverWaveBrightness, screensaverWaveBrightness);
      assert.equal(state.screensaverParticleBrightness, screensaverParticleBrightness);
      let saved;
      preferences.save({setItem: (_, value) => {saved = value;}}, state);
      assert.deepEqual(preferences.load({getItem: () => saved}, false, colors), state);
    }
  }
});

test('a missing screensaver layer inherits legacy brightness without overriding saved layers', () => {
  const state = preferences.load({getItem: () => JSON.stringify({
    screensaverBrightness: 0, screensaverParticleBrightness: 1
  })}, false, colors);
  assert.equal(state.screensaverBrightness, 0);
  assert.equal(state.screensaverWaveBrightness, 0);
  assert.equal(state.screensaverParticleBrightness, 1);
});

test('unsupported or coerced screensaver values fall back to their defaults', () => {
  const invalidDelays = [-1, 1, 29999, 30000.5, 600001, '0', '120000', null, false, true, [], {}];
  const invalidBrightness = [-1, 0.2, 1.1, '0', '0.25', null, false, true, [], {}];
  for (const screensaverDelay of invalidDelays) {
    const state = preferences.load({getItem: () => JSON.stringify({screensaverDelay})}, false, colors);
    assert.equal(state.screensaverDelay, 120000, JSON.stringify(screensaverDelay));
  }
  for (const key of ['screensaverBrightness', 'screensaverWaveBrightness', 'screensaverParticleBrightness']) {
    for (const brightness of invalidBrightness) {
      const state = preferences.load({getItem: () => JSON.stringify({[key]: brightness})}, false, colors);
      assert.equal(state[key], 0.25, `${key}: ${JSON.stringify(brightness)}`);
    }
  }
});

test('clock style defaults to PS3 and preserves supported saved choices', () => {
  assert.equal(preferences.load({getItem: () => null}, false, colors).clockStyle, 'ps3');
  for (const clockStyle of ['current', 'ps3']) {
    const state = preferences.load({getItem: () => JSON.stringify({clockStyle})}, false, colors);
    assert.equal(state.clockStyle, clockStyle);
    let saved;
    preferences.save({setItem: (_, value) => {saved = value;}}, state);
    assert.equal(JSON.parse(saved).clockStyle, clockStyle);
    assert.deepEqual(preferences.load({getItem: () => saved}, false, colors), state);
  }
  for (const clockStyle of ['PS3', 'analog', '', 0, null, false, true, [], {}]) {
    const state = preferences.load({getItem: () => JSON.stringify({clockStyle})}, false, colors);
    assert.equal(state.clockStyle, 'ps3', JSON.stringify(clockStyle));
  }
});

test('Appearance opens a Clock panel whose style choices apply and save immediately', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const state = preferences.load({getItem: () => null}, false, colors);
  const rows = [], groups = {}, panels = [], changes = [], context = {window: {}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../app/appearance-settings.js'), 'utf8'), context);
  const appearance = new context.window.LGXMBAppearanceSettings({preferences: state,
    ui: {
      row: (label, detail, selected, open) => {
        const row = {label, open}; rows.push(row); return row;
      },
      choiceGroup: (label, choices, selected, set) => {groups[label] = {choices, selected, set};}
    },
    openPanel: panel => panels.push(panel),
    applyPreferences: () => changes.push(['apply', state.clockStyle]),
    save: () => changes.push(['save', state.clockStyle])
  });
  appearance.open();
  const clockIndex = rows.findIndex(row => row.label === 'Clock');
  assert.ok(clockIndex >= 0);
  assert.equal(rows[clockIndex].id, 'openClock');
  assert.equal(rows[clockIndex + 1].label, 'Advanced');
  rows[clockIndex].open();
  assert.deepEqual(panels, ['clock']);
  appearance.openClock();
  const group = groups['Clock style'];
  assert.deepEqual(JSON.parse(JSON.stringify(group.choices)), [['current', 'Current'], ['ps3', 'PS3']]);
  assert.equal(group.selected, 'ps3');
  group.set('current');
  assert.equal(state.clockStyle, 'current');
  assert.deepEqual(changes, [['apply', 'current'], ['save', 'current']]);
  appearance.openClock();
  assert.equal(groups['Clock style'].selected, 'current');
});

test('independent launchers do not share settings or derived colour state', () => {
  const storage = {getItem: () => null};
  const one = preferences.load(storage, false, colors);
  const two = preferences.load(storage, false, colors);
  one.colour = 4; one.theme = 'classic';
  assert.equal(two.colour, 'original');
  assert.equal(two.theme, 'original');
  const first = preferences.backgroundTheme(two), second = preferences.backgroundTheme(two);
  first.colors.timeMode = 'night';
  assert.equal(second.colors.timeMode, 'auto');
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
  }).openAdvanced();
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.equal(groups.MSAA, undefined);
  assert.deepEqual(plain(groups['Mesh detail'].choices), [['coarse', 'Low'], ['standard', 'Medium'], ['high', 'High']]);
  assert.deepEqual(plain(groups['Edge softness'].choices), [[0, 'Sharp'], [1.5, 'Subtle'], [3, 'Soft']]);
  assert.deepEqual(plain(groups['Post-process antialiasing'].choices), [['off', 'Off'], ['wave', 'FXAA']]);
  groups['Edge softness'].set(3); groups['Post-process antialiasing'].set('wave');
  assert.equal(rendered.at(-1).softness, 3);
  assert.equal(rendered.at(-1).postprocess, 'wave');
  assert.equal('msaa' in rendered.at(-1), false);
});
