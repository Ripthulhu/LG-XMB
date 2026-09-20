// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = { LGXMBPS3BackgroundClock: require('../app/ps3-background-clock.js') };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/wave-colors.js'), 'utf8'), {
  window: root
});
const gradient = root.LGXMBWaveColors.menuGradient;
const auto = { mode: 'ps3', dateMode: 'auto', timeMode: 'auto' };
const date = (month, hour) => new Date(2026, month - 1, 15, hour);

test('automatic menus follow both season and time of day', () => {
  assert.notEqual(gradient(auto, date(9, 12)), gradient(auto, date(9, 0)));
  assert.notEqual(gradient(auto, date(2, 12)), gradient(auto, date(9, 12)));
});

test('manual colours remain fixed through date and time changes', () => {
  const fixed = { mode: 'ps3', dateMode: 'fixed', timeMode: 'day', month: 9 };
  assert.equal(gradient(fixed, date(2, 0)), gradient(fixed, date(9, 12)));
});

const colour = root.LGXMBPS3BackgroundClock.menuColour;
function near(actual, expected) {
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6));
}
test('the recovered late-night colour is silver in every season', () => {
  for (let month = 1; month <= 12; month++) {
    near(colour(date(month, 23)), [0.3, 0.3, 0.32]);
    near(colour(date(month, 0)), [0.3, 0.3, 0.32]);
  }
});
test('daytime uses the separate menu palette, with linear month blending', () => {
  near(colour(new Date(2026, 8, 1, 12)), [0.64, 0.39, 0.78]);
  near(colour(new Date(2026, 8, 16, 12)), [0.69, 0.535, 0.57]);
});
test('hourly blending uses the recovered weights and interpolates between hours', () => {
  const day = [0.64, 0.39, 0.78],
    silver = [0.3, 0.3, 0.32];
  for (const [h, minute, weight] of [
    [6, 0, 0],
    [18, 0, 0.1],
    [20, 0, 0.5],
    [21, 30, 0.8],
    [23, 30, 1]
  ]) {
    near(
      colour(new Date(2026, 8, 1, h, minute)),
      day.map((v, i) => v * (1 - weight) + silver[i] * weight)
    );
  }
});
test('calendar wraps December and preserves the firmware leap-day rule', () => {
  near(colour(new Date(2026, 11, 1, 12)), [0.7, 0.29, 0.28]);
  near(colour(new Date(2024, 1, 29, 12)), colour(new Date(2024, 1, 28, 12)));
});
test('the gradient fades right rather than becoming opaque on the right', () => {
  const value = gradient(auto, date(9, 23));
  assert.match(value, /^linear-gradient\(90deg,rgba\(77,77,82,/);
  assert.match(value, /,0\) 100%\)$/);
});
