// SPDX-License-Identifier: GPL-3.0-or-later
// Tests the actual preference loader/menu callback and renderer setStyle method.
// No WebGL, private reference assets or TV services are required.
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../app/ps3-native-renderer.js'), 'utf8');
function required(source, expression) {
  const match = source.match(expression);
  assert.ok(match, 'Expected brightness implementation was not found');
  return match;
}
const gainExpression = required(app, /brightness:(\{[^}]+\})\[preferences\.waveBrightness\]/)[1];
const menuLine = required(app, /choiceGroup\('Brightness',[^\n]+\);/)[0];
const styleMethod = required(renderer, /C5Wave\.prototype\.setStyle = function \(o\) \{[\s\S]*?\n  \};/)[0];
function loadPreferences(value, legacy = false, raw = false) {
  const prefixEnd = app.indexOf('// Keep the canvas and spline surface');
  assert.ok(prefixEnd > 0);
  const storage = {};
  if (value !== undefined) storage[legacy ? 'openxmb-c5-preferences-v1' : 'lg-xmb-preferences-v1'] = raw ? value : JSON.stringify(value);
  const context = {window: {C5Catalog: [{id: 'tv', items: []}]}, document: {},
    matchMedia: () => ({matches: false}),
    localStorage: {getItem: key => storage[key] || null}};
  vm.runInNewContext(app.slice(0, prefixEnd) + 'globalThis.result=preferences;})();', context);
  return JSON.parse(JSON.stringify(context.result));
}
function gain(key) { return vm.runInNewContext('(' + gainExpression + ')[key]', {key}); }
function wave() {
  const context = {C5Wave: function () {}};
  vm.runInNewContext(styleMethod, context);
  const instance = Object.create(context.C5Wave.prototype);
  Object.assign(instance, {brightness: 1, speed: 1.5, draws: 0, time: 123,
    simulation: {}, renderer: {}, draw() { this.draws++; }});
  return instance;
}
for (const [stored, key, value] of [['low','low',0.6],['normal','normal',1],['high','normal',1],['dim','dim',0.3]]) {
  test('saved '+stored+' loads with gain '+value, () => {
    const p = loadPreferences({waveBrightness: stored});
    assert.equal(p.waveBrightness, key); assert.equal(gain(p.waveBrightness), value);
  });
}
test('new installation keeps former Normal as the default maximum', () => {
  assert.equal(loadPreferences().waveBrightness, 'normal'); assert.equal(gain('normal'), 1);
});
test('legacy preference key is migrated without altering other choices', () => {
  const p = loadPreferences({waveBrightness: 'high', waveSpeed: 'fast', sound: true, theme: 'ocean'}, true);
  assert.equal(p.waveBrightness, 'normal'); assert.equal(p.waveSpeed, 'fast');
  assert.equal(p.sound, true); assert.equal(p.theme, 'ocean');
});
test('invalid and corrupt brightness storage retains a valid default', () => {
  for (const input of [null, [], {waveBrightness: 99}, {waveBrightness: 'medium'}, {waveBrightness: '__proto__'}])
    assert.equal(loadPreferences(input).waveBrightness, 'normal');
  assert.equal(loadPreferences('{broken', false, true).waveBrightness, 'normal');
});
test('menu offers Low/Medium/High, applies each gain and saves stable keys', () => {
  let settings, handler, saves = 0, applied;
  const context = {preferences: loadPreferences(),
    choiceGroup(label, choices, selected, callback) { settings = {label, choices, selected}; handler = callback; },
    applyPreferences() { applied = gain(context.preferences.waveBrightness); }, save() { saves++; }};
  vm.runInNewContext(menuLine, context);
  assert.deepEqual(JSON.parse(JSON.stringify(settings.choices)), [['dim','Low'],['low','Medium'],['normal','High']]);
  assert.equal(settings.selected, 'normal');
  for (const [key, value] of [['dim',0.3],['low',0.6],['normal',1]]) {
    handler(key); assert.equal(applied, value);
    assert.equal(loadPreferences(context.preferences).waveBrightness, key);
  }
  assert.equal(saves, 3);
});
test('renderer accepts all three levels and leaves time/resources intact', () => {
  const w = wave(), before = [w.time,w.renderer,w.simulation];
  for (const value of [0.3,0.6,1]) { w.setStyle({brightness:value}); assert.equal(w.brightness,value); }
  assert.equal(w.draws,3); assert.deepEqual([w.time,w.renderer,w.simulation],before);
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
