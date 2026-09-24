// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const preferences = require('../app/launcher-preferences.js');

function fixture(colour = 'original') {
  let now = new Date(2026, 0, 1, 12).getTime(), id = 0;
  const timers = new Map(), frames = new Map();
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  function element() {
    return {style: {}, attrs: {}, setAttribute(k, v) {this.attrs[k] = v;},
      removeAttribute(k) {delete this.attrs[k];}, addEventListener() {}, removeEventListener() {}};
  }
  const canvas = element(), ambient = element(), parent = {
    children: [canvas, ambient],
    insertBefore(node, before) {this.children.splice(this.children.indexOf(before), 0, node); node.parentNode = this;},
    removeChild(node) {this.children.splice(this.children.indexOf(node), 1); node.parentNode = null;}
  };
  canvas.parentNode = parent;
  canvas.getContext = () => null;
  const context = {Date: ClockDate, console, document: {
    hidden: false, createElement: element, addEventListener() {}, removeEventListener() {}
  }, addEventListener() {}, removeEventListener() {},
  requestAnimationFrame(fn) {frames.set(++id, fn); return id;},
  cancelAnimationFrame(key) {frames.delete(key);},
  setTimeout(fn, delay) {timers.set(++id, {fn, delay}); return id;},
  clearTimeout(key) {timers.delete(key);}};
  context.window = context;
  vm.createContext(context);
  for (const name of ['ps3-background-clock', 'wave-colors', 'ps3-native-renderer'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/' + name + '.js'), 'utf8'), context);
  const wave = new context.C5Wave(canvas);
  wave.setTheme(preferences.backgroundTheme({colour}));
  wave.cancel();
  wave.initialize();
  return {wave, canvas, ambient, parent, timers, frames, context,
    advance(date) {now = date.getTime();},
    frame(ms = 1000 / 60) {now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now));},
    tick() {const [key, timer] = [...timers][0]; timers.delete(key); timer.fn();}};
}

function channels(css) {
  return [...css.matchAll(/rgb\(([^)]+)\)/g)].flatMap(match => match[1].split(',').map(Number));
}

test('unavailable WebGL displays the selected colour above a hidden failed canvas', () => {
  const f = fixture(12);
  assert.equal(f.wave.mode, 'static');
  assert.equal(f.canvas.style.visibility, 'hidden');
  assert.equal(f.canvas.attrs['data-static-background'], 'true');
  assert.equal(f.parent.children[0], f.wave.staticBackground);
  assert.equal(f.parent.children[1], f.canvas);
  assert.equal(f.parent.children[2], f.ambient);
  const red = channels(f.wave.staticBackground.style.background);
  assert.ok(red[0] > red[1] && red[0] > red[2]);
  f.wave.setTheme(preferences.backgroundTheme({colour: 7}));
  const cyan = channels(f.wave.staticBackground.style.background);
  assert.ok(cyan[1] > cyan[0] && cyan[2] > cyan[0]);
  assert.equal(f.parent.children.length, 3);
});

test('every background brightness choice updates static colour without a renderer', () => {
  const f = fixture(4), full = channels(f.wave.staticBackground.style.background);
  for (const gain of [1, .85, .7, .6, .45, .3]) {
    f.wave.setStyle({brightness: gain});
    channels(f.wave.staticBackground.style.background).forEach((value, index) => {
      assert.ok(Math.abs(value - full[index] * gain) <= 1);
    });
  }
  assert.equal(f.wave.renderer, null);
  assert.equal(f.timers.size, 0);
  assert.equal(f.frames.size, 0);
});

test('static Original follows the calendar once a minute and pauses while hidden or covered', () => {
  const f = fixture(), day = f.wave.staticBackground.style.background;
  assert.equal([...f.timers.values()][0].delay, 60000);
  f.advance(new Date(2026, 0, 1, 0)); f.tick();
  assert.notEqual(f.wave.staticBackground.style.background, day);
  f.wave.setPaused(true); assert.equal(f.timers.size, 0);
  f.advance(new Date(2026, 0, 1, 12));
  f.wave.setPaused(false); assert.equal(f.wave.staticBackground.style.background, day);
  assert.equal(f.timers.size, 1);
  f.context.document.hidden = true; f.wave.visibility();
  assert.equal(f.timers.size, 0);
  f.context.document.hidden = false; f.wave.visibility();
  assert.equal(f.timers.size, 1);
  f.wave.setMotionHeld(true); assert.equal(f.timers.size, 0);
  f.wave.setMotionHeld(false); assert.equal(f.timers.size, 1);
  assert.equal(f.frames.size, 0);
});

test('fixed colours remain unchanged across dates and allocate no clock timer', () => {
  const f = fixture(8), first = f.wave.staticBackground.style.background;
  f.advance(new Date(2026, 11, 31, 0)); f.wave.draw();
  assert.equal(f.wave.staticBackground.style.background, first);
  assert.equal(f.timers.size, 0);
});

test('static theme-clock backgrounds update their day/night gain on scheduled and resumed draws', () => {
  const f = fixture(8);
  f.wave.setTheme({background: '#6090c0', wave: '#90c0f0', colors: {mode: 'theme', themeClock: true}});
  const day = channels(f.wave.staticBackground.style.background);
  assert.equal(f.timers.size, 1);
  f.advance(new Date(2026, 0, 1, 0));
  f.tick();
  const night = channels(f.wave.staticBackground.style.background);
  assert.ok(night.every((value, index) => value < day[index]));
  f.wave.setPaused(true);
  f.advance(new Date(2026, 0, 1, 12));
  f.wave.setPaused(false);
  assert.deepEqual(channels(f.wave.staticBackground.style.background), day);
});

test('restoration cleanup and destruction remove only the fallback layer', () => {
  const f = fixture();
  f.wave.clearStatic();
  assert.deepEqual(f.parent.children, [f.canvas, f.ambient]);
  assert.equal(f.canvas.style.visibility, '');
  assert.equal(f.canvas.attrs['data-static-background'], undefined);
  f.wave.draw(); assert.equal(f.parent.children.length, 3);
  f.wave.destroy(); f.wave.destroy();
  assert.deepEqual(f.parent.children, [f.canvas, f.ambient]);
  assert.equal(f.timers.size, 0);
});

test('static fallback fades only its background channel, then stops repainting', () => {
  const f = fixture(4), full = channels(f.wave.staticBackground.style.background);
  f.wave.setStyle({brightness: 0.6});
  f.wave.setIdleBrightness({background: 0.2, wave: 0, particles: 0}, 1200);
  assert.equal(f.frames.size, 1);
  for (let i = 0; i < 80; i++) f.frame();
  const dim = f.wave.staticBackground.style.background;
  channels(dim).forEach((value, i) => assert.ok(Math.abs(value - full[i] * 0.6 * 0.2) <= 1));
  assert.equal(f.frames.size, 0);
  assert.equal(f.wave.time, 0);
  f.wave.setIdleBrightness({wave: 1, particles: 1});
  assert.equal(f.wave.staticBackground.style.background, dim);
  f.wave.setIdleBrightness({background: 0});
  assert.ok(channels(f.wave.staticBackground.style.background).every(value => value === 0));
});
