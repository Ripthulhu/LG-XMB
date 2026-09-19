// SPDX-License-Identifier: GPL-3.0-or-later
// Run the preview server with OPENXMB_PREVIEW_PORT=8787.
'use strict';
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const navigation = require('./support/menu-navigation.cjs');

(async () => {
  const browser = await chromium.launch(navigation.launchOptions());
  const checks = [], errors = [], cadences = [];
  try {
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
    page.on('pageerror', error => errors.push(error.message));
    // Check menu behavior without treating desktop WebGL timing as TV performance.
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return /webgl/.test(kind) ? null : get.call(this, kind, ...args);
      };
    });
    async function settings() {
      await page.goto('http://127.0.0.1:8787/');
      await page.waitForFunction(() => window.C5App);
      await navigation.item(page, 'settings', 'appearance');
    }
    await settings();
    const timing = await page.evaluate(() => {
      const duration = element => parseFloat(getComputedStyle(element).transitionDuration) * 1000;
      const row = document.querySelector('#items>.rows:not(.parked)>.item');
      return {row: duration(row), icon: duration(row.querySelector('.item-icon')),
        category: duration(document.querySelector('#categories'))};
    });
    assert.deepEqual(timing, {row: 240, icon: 240, category: 400});
    checks.push('Rows and icons use 240 ms; the category bar keeps 400 ms');

    const taps = await page.evaluate(() => {
      const selected = () => C5App.getState().item;
      const press = key => {
        for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, {
          key, bubbles: true, cancelable: true
        }));
        return selected();
      };
      return [press('ArrowDown'), press('ArrowDown'), press('ArrowUp'), press('ArrowDown')];
    });
    assert.deepEqual(taps, ['sound', 'previews', 'sound', 'previews']);
    await page.waitForTimeout(280);
    const settled = await page.evaluate(() => {
      const row = document.querySelector('#items>.rows:not(.parked)>.selected');
      return {id: row.dataset.item, y: new DOMMatrix(getComputedStyle(row).transform).m42};
    });
    assert.equal(settled.id, 'previews');
    assert.ok(Math.abs(settled.y) < 0.01, 'Rapid reversals must settle on the selected row');
    checks.push('Rapid taps and reversals select immediately and settle on the correct row');

    for (const flagged of [false, true]) {
      await settings();
      const held = await page.evaluate(async flagged => {
        const expected = C5Catalog.find(c => c.id === 'settings').items.map(item => item.id);
        const send = (type, repeated) => document.dispatchEvent(new KeyboardEvent(type, {
          key: 'ArrowDown', repeat: repeated, bubbles: true, cancelable: true
        }));
        const immediate = [], times = [], start = performance.now();
        for (let step = 1; step < expected.length; step++) {
          if (step > 1) await new Promise(resolve => setTimeout(resolve, 80));
          send('keydown', flagged && step > 1);
          immediate.push(C5App.getState().item); times.push(performance.now() - start);
        }
        send('keyup', false);
        await new Promise(resolve => setTimeout(resolve, 150));
        return {immediate, expected: expected.slice(1), settled: C5App.getState().item, times};
      }, flagged);
      assert.deepEqual(held.immediate, held.expected, 'Every 80 ms main-list press should apply immediately');
      assert.equal(held.settled, held.expected.at(-1), 'Release must not leave queued movement');
      cadences.push({repeatFlag: flagged, moves: held.immediate.length, times: held.times});
    }
    checks.push('Every 80 ms main-list input applies immediately, with and without repeat flags');

    await settings();
    await page.keyboard.press('Enter');
    const modal = await page.evaluate(async () => {
      const times = [], start = performance.now();
      const content = document.querySelector('#modalContent');
      const focused = () => times.push(performance.now() - start);
      content.addEventListener('focusin', focused);
      const send = type => document.dispatchEvent(new KeyboardEvent(type, {
        key: 'ArrowDown', repeat: true, bubbles: true, cancelable: true
      }));
      for (let n = 0; n < 8; n++) {
        if (n) await new Promise(resolve => setTimeout(resolve, 80));
        send('keydown');
      }
      await new Promise(resolve => setTimeout(resolve, 140));
      send('keyup'); content.removeEventListener('focusin', focused);
      return times;
    });
    const gaps = modal.slice(1).map((time, index) => time - modal[index]);
    assert.ok(modal.length >= 6 && modal.length <= 8, 'Settings panel input should still coalesce');
    assert.ok(gaps.every(gap => gap >= 95), 'Settings panels must keep the 100 ms repeat interval: ' + gaps);
    checks.push('Settings panels retain the 100 ms repeat interval');

    await page.evaluate(() => localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify({motion: 'reduced'})));
    await settings();
    const reduced = await page.evaluate(() => {
      const row = document.querySelector('#items>.rows:not(.parked)>.item');
      return [row, row.querySelector('.item-icon'), document.querySelector('#categories')]
        .map(element => getComputedStyle(element).transitionDuration);
    });
    assert.deepEqual(reduced, ['0s', '0s', '0s']);
    checks.push('Reduced motion disables both vertical and category transitions');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({checks, cadences, errors, testedOnTV: false}, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
