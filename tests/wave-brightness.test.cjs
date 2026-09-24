// SPDX-License-Identifier: GPL-3.0-or-later
// Tests the actual preference loader/menu callback and renderer setStyle method.
// No WebGL, private reference assets or TV services are required.
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const preferencesAPI = require('../app/launcher-preferences.js');
const colourContext = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/wave-colors.js'), 'utf8'), colourContext);
const waveColors = colourContext.window.LGXMBWaveColors;
const appearance = fs.readFileSync(path.join(__dirname, '../app/appearance-settings.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../app/ps3-native-renderer.js'), 'utf8');
function required(source, expression) {
  const match = source.match(expression);
  assert.ok(match, 'Expected brightness implementation was not found');
  return match;
}
const styleMethod = required(renderer, /C5Wave\.prototype\.setStyle = function \(o\) \{[\s\S]*?\n  \};/)[0];
function loadPreferences(value, legacy = false, raw = false) {
  const storage = {};
  if (value !== undefined) storage[legacy ? 'openxmb-c5-preferences-v1' : 'lg-xmb-preferences-v1'] = raw ? value : JSON.stringify(value);
  return preferencesAPI.load({getItem: key => storage[key] || null}, false, waveColors.normalize);
}
function gain(offset) { return preferencesAPI.waveStyle({backgroundBrightness: offset}).brightness; }
function wave() {
  const context = {C5Wave: function () {}};
  vm.runInNewContext(styleMethod, context);
  const instance = Object.create(context.C5Wave.prototype);
  Object.assign(instance, {brightness: 1, speed: 1.5, draws: 0, time: 123,
    simulation: {}, renderer: {}, draw() { this.draws++; }});
  return instance;
}
for (const [stored, offset, value] of [['low',-3,0.6],['normal',0,1],['high',0,1],['dim',-5,0.3]]) {
  test('saved '+stored+' loads with gain '+value, () => {
    const p = loadPreferences({waveBrightness: stored});
    assert.equal(p.backgroundBrightness, offset); assert.equal(gain(p.backgroundBrightness), value);
  });
}
test('new installation keeps former Normal as the default maximum', () => {
  assert.equal(loadPreferences().backgroundBrightness, 0); assert.equal(gain(0), 1);
});
test('legacy preference key is migrated without altering other choices', () => {
  const p = loadPreferences({waveBrightness: 'high', waveSpeed: 'fast', sound: true, theme: 'ocean'}, true);
  assert.equal(p.backgroundBrightness, 0); assert.equal(p.waveSpeed, 'fast');
  assert.equal(p.sound, true); assert.equal(p.colour, 7);
});
test('invalid and corrupt brightness storage retains a valid default', () => {
  for (const input of [null, [], {waveBrightness: 99}, {waveBrightness: 'medium'}, {waveBrightness: '__proto__'}])
    assert.equal(loadPreferences(input).backgroundBrightness, 0);
  assert.equal(loadPreferences('{broken', false, true).backgroundBrightness, 0);
});
test('Background offers Normal through -5, applies each gain and saves stable values', () => {
  let settings, handler, saves = 0, applied;
  const preferences = loadPreferences();
  const element = () => ({appendChild() {}, setAttribute() {}, querySelector() { return null; }});
  const context = {window: {}, LGXMBPreferences: preferencesAPI, document: {createElement: element}};
  vm.runInNewContext(appearance, context);
  const panel = new context.window.LGXMBAppearanceSettings({
    preferences, content: element(),
    ui: {row: element, choiceGroup(label, choices, selected, callback) {
      if (label === 'Brightness') { settings = {label, choices, selected}; handler = callback; }
    }},
    wave: {},
    applyPreferences() { applied = gain(preferences.backgroundBrightness); }, save() { saves++; }
  });
  panel.openBackground();
  assert.deepEqual(JSON.parse(JSON.stringify(settings.choices)), [[0,'Normal'],[-1,'-1'],[-2,'-2'],[-3,'-3'],[-4,'-4'],[-5,'-5']]);
  assert.equal(settings.selected, 0);
  for (const [offset, value] of [[0,1],[-1,.85],[-2,.7],[-3,.6],[-4,.45],[-5,.3]]) {
    handler(offset); assert.equal(applied, value);
    assert.equal(loadPreferences(preferences).backgroundBrightness, offset);
  }
  assert.equal(saves, 6);
});

test('renderer accepts all six levels and leaves time/resources intact', () => {
  const w = wave(), before = [w.time,w.renderer,w.simulation];
  for (const value of [0.3,0.45,0.6,0.7,0.85,1]) { w.setStyle({brightness:value}); assert.equal(w.brightness,value); }
  assert.equal(w.draws,6); assert.deepEqual([w.time,w.renderer,w.simulation],before);
});
test('unchanged brightness causes no repaint', () => {
  const w = wave(); w.setStyle({brightness:1}); assert.equal(w.draws,0);
  w.setStyle({brightness:0.3}); w.setStyle({brightness:0.3}); assert.equal(w.draws,1);
});
test('retired overbright level and malformed renderer inputs are rejected', () => {
  const w = wave();
  for (const value of [1.5,2,-1,0,NaN,Infinity,'0.3',null]) w.setStyle({brightness:value});
  assert.equal(w.brightness,1); assert.equal(w.draws,0);
});
test('speed handling and destroyed guard are unchanged', () => {
  const w = wave(); w.setStyle({speed:2.25,brightness:0.6});
  assert.equal(w.speed,2.25); assert.equal(w.brightness,0.6);
  w.destroyed=true; w.setStyle({speed:0.5,brightness:0.3});
  assert.equal(w.speed,2.25); assert.equal(w.brightness,0.6); assert.equal(w.draws,1);
});

test('one display gain dims the composed background and both sparkle passes', () => {
  const draw = required(renderer, /Renderer\.prototype\.draw = function \(w, h, wave, brightness, background, palette, idle\) \{[\s\S]*?\n  \};/)[0];
  const context = {Renderer: function () {}, IDLE_BRIGHTNESS: {background: 1, wave: 1, particles: 1}};
  vm.runInNewContext(draw, context);
  for (const brightness of [1, .85, .7, .6, .45, .3]) {
    const calls = [];
    const gl = new Proxy({}, {get(_, name) {
      return (...args) => {if (name === 'uniform1f') calls.push([name, ...args]);};
    }});
    const instance = Object.create(context.Renderer.prototype);
    Object.assign(instance, {
      ready: true, gl, changed: false, settings: {particles: true, particleCount: 1000},
      simulation: {wave: {revision: 0}, particles: {count: 0, revision: 0, render: new Float32Array()}},
      filterTunings: {}, uniforms: {composite: {uBrightness: 'display-gain'}},
      target: {}, backdrop: {}, drawCount: 0, uploadedBytes: 0,
      updateGrid() {}, resize() {}, prepareAmbient() {}, backdropPass() {},
      band: () => [0, 1], wavePass: (_, __, gain) => calls.push(['wave', gain]),
      particlePass: (_, __, ___, gain) => calls.push(['particle', gain])
    });
    instance.draw(1920, 1080, [1, 1, 1], brightness, [0, 0, 0], null);
    assert.deepEqual(calls.filter(c => c[0] === 'wave'), [['wave', 1]]);
    assert.deepEqual(calls.filter(c => c[1] === 'display-gain'), [['uniform1f', 'display-gain', brightness]]);
    assert.deepEqual(calls.filter(c => c[0] === 'particle'), [['particle', brightness], ['particle', brightness]]);
  }
});
