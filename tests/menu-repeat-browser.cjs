// SPDX-License-Identifier: GPL-3.0-or-later
// Run the preview server with OPENXMB_PREVIEW_PORT=8787.
'use strict';
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const navigation = require('./support/menu-navigation.cjs');

(async () => {
  const browser = await chromium.launch(navigation.launchOptions());
  const checks = [], errors = [], cadences = [];
  try {
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
    page.on('pageerror', error => errors.push(error.message));
    // This checks the actual menu event path, not desktop WebGL performance.
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return /webgl/.test(kind) ? null : get.call(this, kind, ...args);
      };
    });
    async function appearance() {
      await page.goto('http://127.0.0.1:8787/');
      await page.waitForFunction(() => window.C5App);
      await navigation.item(page, 'settings', 'appearance');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => C5App.getState().modal), 'appearance');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'openTheme');
    }
    for (const flagged of [true, false]) {
      await appearance();
      const moves = await page.evaluate(async flagged => {
        const moves = [], start = performance.now();
        const focused = () => moves.push(performance.now() - start);
        document.querySelector('#modalContent').addEventListener('focusin', focused);
        const send = (type, repeat) => document.dispatchEvent(new KeyboardEvent(type, {
          key: 'ArrowDown', repeat, bubbles: true, cancelable: true
        }));
        for (let n = 0; n < 9; n++) {
          if (n) await new Promise(resolve => setTimeout(resolve, 80));
          send('keydown', flagged && n > 0);
        }
        await new Promise(resolve => setTimeout(resolve, 140));
        send('keyup', false);
        document.querySelector('#modalContent').removeEventListener('focusin', focused);
        return moves;
      }, flagged);
      const gaps = moves.slice(1).map((time, i) => time - moves[i]).sort((a, b) => a - b);
      assert.ok(moves.length >= 7 && moves.length <= 9, 'Held input should coalesce instead of dropping every other event: ' + moves);
      assert.ok(gaps[Math.floor(gaps.length / 2)] < 140, 'Median cadence should remain near 100 ms, not 160 ms: ' + gaps);
      assert.ok(gaps.every(gap => gap >= 95), 'Held input must respect the repeat interval: ' + gaps);
      cadences.push({repeatFlag: flagged, moves: moves.length, medianInterval: gaps[Math.floor(gaps.length / 2)]});
    }
    checks.push('80 ms held input with and without the repeat flag');

    await appearance();
    const taps = await page.evaluate(() => {
      const send = (type, key) => document.dispatchEvent(new KeyboardEvent(type, {key, bubbles: true, cancelable: true}));
      send('keydown', 'ArrowDown'); send('keyup', 'ArrowDown');
      const first = document.activeElement.id;
      send('keydown', 'ArrowDown'); send('keyup', 'ArrowDown');
      const second = document.activeElement.id;
      send('keydown', 'ArrowUp');
      const reversed = document.activeElement.id;
      send('keyup', 'ArrowUp');
      return {first, second, reversed};
    });
    assert.deepEqual(taps, {first: 'openWaveColors', second: 'showWavesOnly', reversed: 'openWaveColors'});
    checks.push('rapid explicit taps and reversal move immediately');

    for (const action of ['keyup', 'blur', 'reverse', 'back', 'submenu']) {
      await appearance();
      const state = await page.evaluate(async action => {
        const send = (type, key) => document.dispatchEvent(new KeyboardEvent(type, {key, bubbles: true, cancelable: true}));
        const snapshot = () => ({modal: C5App.getState().modal, item: C5App.getState().item,
          focus: document.activeElement.id || document.activeElement.dataset.value || document.activeElement.textContent});
        send('keydown', 'ArrowDown');
        send('keydown', 'ArrowDown'); // Pending move into Show waves full screen.
        if (action === 'keyup') send('keyup', 'ArrowDown');
        else if (action === 'blur') window.dispatchEvent(new Event('blur'));
        else if (action === 'reverse') send('keydown', 'ArrowUp');
        else if (action === 'back') send('keydown', 'Escape');
        else document.querySelector('#openWaveColors').click();
        const immediate = snapshot();
        await new Promise(resolve => setTimeout(resolve, 150));
        const later = snapshot();
        send('keyup', 'ArrowDown'); send('keyup', 'ArrowUp');
        return {immediate, later};
      }, action);
      assert.deepEqual(state.later, state.immediate, action + ' must cancel the queued direction');
      if (action === 'reverse') assert.equal(state.immediate.focus, 'openTheme');
      if (action === 'back') assert.equal(state.immediate.modal, null);
      if (action === 'submenu') assert.equal(state.immediate.modal, 'wave-colors');
      checks.push('pending direction cancelled by ' + action);
    }

    await appearance();
    const boundary = await page.evaluate(() => {
      const group = [...document.querySelectorAll('#modalContent .choice-group')].at(-1);
      const button = [...group.querySelectorAll('button')].find(b => b.getAttribute('aria-pressed') !== 'true');
      button.focus(); return button.textContent;
    });
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), boundary);
    checks.push('bottom-row unselected option keeps horizontal position');

    await page.keyboard.press('Escape');
    await page.keyboard.press('F2');
    const actions = page.locator('.item-options-actions button');
    await actions.first().focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), await actions.first().getAttribute('data-action'));
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), await actions.last().getAttribute('data-action'));
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), await actions.last().getAttribute('data-action'));
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), await actions.first().getAttribute('data-action'));
    checks.push('options arrows clamp at ends and Tab wraps');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({checks, cadences, errors, testedOnTV: false}, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
