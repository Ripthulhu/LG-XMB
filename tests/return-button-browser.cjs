// SPDX-License-Identifier: GPL-3.0-or-later
// Real remote/menu handling with synthetic return requests; no TV connection.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const menu = require('./support/menu-navigation.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const port = Number(process.env.OPENXMB_RETURN_TEST_PORT || 8793);
  const url = 'http://127.0.0.1:' + port + '/';
  const checks = [], errors = [];
  const server = spawn(process.execPath, ['tools/preview.cjs'], {
    cwd: root, env: {...process.env, OPENXMB_PREVIEW_PORT: String(port)},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let browser, serverLog = '';
  server.stdout.on('data', chunk => { serverLog += chunk; });
  server.stderr.on('data', chunk => { serverLog += chunk; });
  server.on('error', error => { serverLog += error.message; });
  try {
    for (let i = 0; !serverLog.includes('LG-XMB preview:'); i++) {
      if (server.exitCode !== null || i === 50) throw Error('Preview server failed: ' + serverLog);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch(menu.launchOptions());
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      // These are input/lifecycle checks; WebGL performance is tested separately.
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return /webgl/.test(type) ? null : getContext.call(this, type, ...args);
      };
    });
    async function load() {
      await page.goto(url);
      await page.waitForFunction(() => window.C5App);
      await page.evaluate(() => {
        window.returnTest = {requests: [], exits: 0, toastMessages: []};
        window.C5TV = Object.assign({}, C5TV, {
          returnToPrevious: isCurrent => new Promise((resolve, reject) => {
            returnTest.requests.push({isCurrent, resolve, reject});
          }),
          platformBack: async () => {
            returnTest.exits++;
            return {ok: true, preview: false};
          }
        });
        new MutationObserver(() => returnTest.toastMessages.push(document.getElementById('toast').textContent))
          .observe(document.getElementById('toast'), {childList: true, subtree: true, characterData: true});
      });
    }
    const state = () => page.evaluate(() => C5App.getState());
    const requests = () => page.evaluate(() => returnTest.requests.length);
    const home = () => page.evaluate(() => document.dispatchEvent(new Event('webOSRelaunch')));
    async function finish(index, result = {ok: true, preview: false, returned: true, id: 'com.webos.app.hdmi1'}, failure) {
      await page.evaluate(async ({index, result, failure}) => {
        const request = returnTest.requests[index];
        if (failure) request.reject(new Error(failure));
        else request.resolve(result);
        await Promise.resolve();
        await Promise.resolve();
      }, {index, result, failure});
    }
    async function backSetting(value) {
      await menu.item(page, 'settings', 'remote');
      await page.keyboard.press('Enter');
      assert.equal((await state()).modal, 'remote');
      await page.locator('[data-remote-choice="Back button:' + value + '"]').click();
      assert.equal((await state()).preferences.backBehavior, value);
      await page.keyboard.press('Escape');
      assert.equal((await state()).modal, null);
    }

    await load();
    assert.equal((await state()).preferences.backBehavior, 'previous');
    await page.keyboard.press('Escape');
    assert.equal(await requests(), 1);
    assert.equal((await state()).busy, true);
    assert.equal(await page.evaluate(() => returnTest.requests[0].isCurrent()), true);
    await page.keyboard.press('Backspace');
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', repeat: true, bubbles: true, cancelable: true
    })));
    assert.equal(await requests(), 1, 'Return cannot overlap or repeat while pending');
    await finish(0);
    assert.equal((await state()).busy, false);
    assert.equal(await page.locator('#toast').textContent(), '');
    checks.push('Idle Return uses the previous app/input by default, with one pending request and no opening toast');

    await home();
    await menu.item(page, 'settings', 'appearance');
    await page.keyboard.press('Enter');
    assert.equal((await state()).modal, 'appearance');
    await page.keyboard.press('Escape');
    assert.equal((await state()).modal, null);
    assert.equal(await requests(), 1, 'Back closes settings without returning to another app');
    await page.keyboard.press('Enter');
    await page.locator('#showWavesOnly').click();
    assert.equal((await state()).waveOnly, true);
    await page.keyboard.press('Escape');
    assert.equal((await state()).waveOnly, false);
    assert.equal(await requests(), 1, 'Back leaves full-screen waves before returning to another app');
    await menu.item(page, 'tv', 'com.webos.app.hdmi1');
    await page.keyboard.press('F2');
    assert.equal((await state()).itemOptions.open, true);
    await page.keyboard.press('Escape');
    assert.equal((await state()).itemOptions.open, false);
    assert.equal(await requests(), 1, 'Back closes item options before returning to another app');
    checks.push('Settings, item options and full-screen waves consume Back first');

    await backSetting('stay');
    await load();
    assert.equal((await state()).preferences.backBehavior, 'stay');
    await page.keyboard.press('Escape');
    assert.equal(await requests(), 0);
    assert.equal(await page.evaluate(() => returnTest.exits), 0);
    await backSetting('lg');
    await load();
    assert.equal((await state()).preferences.backBehavior, 'lg');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => returnTest.exits), 1);
    assert.equal(await requests(), 0);
    await backSetting('previous');
    await load();
    assert.equal((await state()).preferences.backBehavior, 'previous');
    checks.push('Stay in Home, exit prompt and previous-app choices persist after reload');

    await page.keyboard.press('Escape');
    await home();
    assert.equal((await state()).busy, false);
    assert.equal(await page.evaluate(() => returnTest.requests[0].isCurrent()), false,
      'Home invalidates the guard before a pending lookup may launch');
    await page.keyboard.press('Escape');
    assert.equal(await requests(), 2);
    await finish(0, undefined, 'Obsolete return failure');
    assert.equal((await state()).busy, true, 'An obsolete completion cannot clear the newer return');
    assert.equal(await page.locator('#items').getAttribute('aria-busy'), 'true');
    assert.equal(await page.evaluate(() => returnTest.toastMessages.some(text => /Obsolete/.test(text))), false);
    await finish(1);
    await home();
    checks.push('Home cancels a pending return; stale results cannot launch or interfere with a new request');

    await page.keyboard.press('Escape');
    await finish(2, {ok: true, preview: false, returned: false});
    assert.equal((await state()).busy, false, 'An empty history leaves Home usable');
    assert.equal(await page.locator('#items').getAttribute('aria-busy'), null);
    await page.keyboard.press('Escape');
    assert.equal(await requests(), 4, 'Another Return works after an empty history');
    await finish(3, undefined, 'Return unavailable');
    assert.equal((await state()).busy, false);
    assert.match(await page.locator('#toast').textContent(), /Return unavailable/);
    await home();
    assert.equal(await page.locator('#toast').textContent(), '');
    checks.push('Empty history and request failures leave Home usable and allow a fresh attempt');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.keyboard.press('Escape');
    assert.equal(await requests(), 4, 'Hidden Home cannot return away from the active app');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: false});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.keyboard.press('Escape');
    assert.equal(await requests(), 5);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(() => returnTest.requests[4].isCurrent()), false);
    await finish(4, undefined, 'Hidden return failure');
    assert.equal(await page.locator('#toast').textContent(), '');
    checks.push('Hidden pages ignore Return and invalidate any pending request');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({checks, errors, browser: await browser.version(), testedOnTV: false}, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
