// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Wallpaper = require('../app/wallpaper.js');

function fixture() {
  const probes = [], timers = new Map(), changes = [];
  let timerId = 0;
  const image = {hidden: true, style: {}, removeAttribute(name) {delete this[name];}};
  const wallpaper = new Wallpaper(image, {
    createImage() {const probe = {naturalWidth: 1920, naturalHeight: 1080}; probes.push(probe); return probe;},
    setTimer(fn) {timers.set(++timerId, fn); return timerId;},
    clearTimer(id) {timers.delete(id);},
    onChange() {changes.push({active: wallpaper.active, loading: wallpaper.loading, error: wallpaper.error});}
  });
  return {wallpaper, image, probes, timers, changes};
}

test('a wallpaper becomes active only after it loads, and ordinary settings do not reload it', async () => {
  const f = fixture(), loading = f.wallpaper.setEnabled(true);
  assert.equal(f.wallpaper.active, false);
  assert.equal(f.image.hidden, true);
  assert.equal(f.wallpaper.loading, true);
  assert.match(f.probes[0].src, /^user-wallpaper\.jpg\?v=/);
  f.probes[0].onload();
  assert.equal(await loading, true);
  assert.equal(f.image.hidden, false);
  assert.equal(f.wallpaper.active, true);
  assert.equal(await f.wallpaper.setEnabled(true), true);
  assert.equal(f.probes.length, 1);
  assert.equal(f.timers.size, 0);
});

test('missing, invalid and stalled images retain the wave background without retries', async () => {
  for (const failure of ['error', 'empty', 'timeout']) {
    const f = fixture(), loading = f.wallpaper.setEnabled(true);
    if (failure === 'error') f.probes[0].onerror();
    else if (failure === 'empty') {f.probes[0].naturalWidth = 0; f.probes[0].onload();}
    else [...f.timers.values()][0]();
    assert.equal(await loading, false);
    assert.equal(f.wallpaper.active, false);
    assert.equal(f.image.hidden, true);
    assert.equal(f.wallpaper.error, 'Wallpaper is missing or unreadable.');
    assert.equal(await f.wallpaper.setEnabled(true), false);
    assert.equal(f.probes.length, 1);
    assert.equal(f.timers.size, 0);
  }
});

test('switching to Theme cancels a pending load, including an already queued callback', async () => {
  const f = fixture(), loading = f.wallpaper.setEnabled(true), stale = f.probes[0].onload;
  await f.wallpaper.setEnabled(false);
  stale();
  assert.equal(await loading, false);
  assert.equal(f.wallpaper.active, false);
  assert.equal(f.image.hidden, true);
  assert.equal(f.image.src, undefined);
  assert.equal(f.timers.size, 0);
});

test('Reload preserves the old image until a valid replacement is ready', async () => {
  const f = fixture(), first = f.wallpaper.setEnabled(true);
  f.probes[0].onload(); await first;
  const oldSource = f.image.src, missing = f.wallpaper.reload();
  assert.equal(f.image.src, oldSource);
  f.probes[1].onerror(); await missing;
  assert.equal(f.wallpaper.active, true);
  assert.equal(f.image.src, oldSource);
  const replacement = f.wallpaper.reload();
  f.probes[2].onload(); await replacement;
  assert.notEqual(f.image.src, oldSource);
  assert.equal(f.wallpaper.error, '');
});

test('a later request cannot be overwritten by an older image completion', async () => {
  const f = fixture(), first = f.wallpaper.setEnabled(true), stale = f.probes[0].onload;
  const second = f.wallpaper.reload();
  stale(); f.probes[1].onload();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(f.image.src, f.probes[1].src);
});

test('brightness affects only the image and destruction cancels pending work', async () => {
  const f = fixture();
  f.wallpaper.setBrightness(0.6);
  assert.equal(f.image.style.opacity, '0.6');
  for (const value of [0, 2, NaN, '0.3', null]) f.wallpaper.setBrightness(value);
  assert.equal(f.image.style.opacity, '0.6');
  const loading = f.wallpaper.setEnabled(true), stale = f.probes[0].onload;
  f.wallpaper.destroy(); stale();
  assert.equal(await loading, false);
  assert.equal(await f.wallpaper.reload(), false);
  assert.equal(f.wallpaper.active, false);
  assert.equal(f.timers.size, 0);
});
