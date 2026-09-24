// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const menu = require('./support/menu-navigation.cjs');

(async () => {
  const server = spawn(process.execPath, ['tools/preview.cjs'], {
    cwd: path.resolve(__dirname, '..'),
    env: {...process.env, OPENXMB_PREVIEW_PORT: '8798'},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '', browser;
  server.stdout.on('data', chunk => {log += chunk;});
  server.stderr.on('data', chunk => {log += chunk;});
  try {
    for (let i = 0; !log.includes('LG-XMB preview:'); i++) {
      if (server.exitCode !== null || i === 50) throw Error('Preview failed: ' + log);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch(menu.launchOptions());
    const errors = [], checks = [];
    for (const [width, height] of [[1920, 1080], [1280, 720]]) {
      const page = await browser.newPage({viewport: {width, height}});
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return /webgl/.test(type) ? null : original.call(this, type, ...args);
        };
      });
      await page.goto('http://127.0.0.1:8798/');
      await page.waitForFunction(() => window.C5App);
      await page.evaluate(() => {
        window.remoteTest = {reads: [], writes: [], cancelled: 0};
        const pending = (list, mode) => {
          let resolve, reject;
          const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
          promise.cancel = () => {remoteTest.cancelled++;};
          list.push({resolve, reject, mode});
          return promise;
        };
        window.LGXMBHomeButton = {
          get: () => pending(remoteTest.reads),
          set: mode => pending(remoteTest.writes, mode)
        };
      });
      const home = mode => page.locator('[data-remote-choice="Home button:' + mode + '"]');
      const back = mode => page.locator('[data-remote-choice="Back button:' + mode + '"]');
      const active = () => page.evaluate(() => document.activeElement.getAttribute('data-remote-choice'));
      const settle = async (kind, index, result, failure) => {
        await page.evaluate(({kind, index, result, failure}) => {
          const request = remoteTest[kind][index];
          if (failure) request.reject(new Error(failure));
          else request.resolve(result);
        }, {kind, index, result, failure});
        await page.waitForFunction(() => !C5RemoteSettings.getState().homeBusy);
      };
      await menu.item(page, 'settings', 'remote');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => remoteTest.reads.length === 1);
      assert.equal(await page.locator('#modalTitle').textContent(), 'Remote');
      assert.equal(await page.evaluate(() => remoteTest.writes.length), 0);
      assert.equal(await home('stock').isDisabled(), true);
      assert.equal(await active(), 'Back button:previous');
      await page.keyboard.press('ArrowUp');
      assert.equal(await active(), 'Back button:previous', 'Unavailable rows cannot trap focus');
      await settle('reads', 0, {mode: 'stock', available: true});
      assert.equal(await active(), 'Back button:previous', 'Late reads never steal focus');
      await page.keyboard.press('ArrowUp');
      assert.equal(await active(), 'Home button:stock');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => remoteTest.writes.length === 1);
      assert.equal(await home('stock').getAttribute('aria-pressed'), 'true');
      assert.equal(await home('xmb').getAttribute('aria-pressed'), 'false');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => remoteTest.writes.length), 1);
      assert.equal(await active(), 'Home button:xmb');
      await settle('writes', 0, {mode: 'xmb', available: true});
      assert.equal(await home('xmb').getAttribute('aria-pressed'), 'true');
      assert.equal(await active(), 'Home button:xmb');
      await home('stock').click();
      await page.waitForFunction(() => remoteTest.writes.length === 2);
      await settle('writes', 1, null, 'Could not confirm Home assignment.');
      assert.equal(await home('stock').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('[data-remote-retry]').isVisible(), true);
      await back('stay').click();
      assert.equal(await back('stay').getAttribute('aria-pressed'), 'true');
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.locator('[data-remote-retry]').evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => remoteTest.reads.length === 2);
      await settle('reads', 1, {mode: 'stock', available: true});
      assert.equal(await active(), 'Back button:stay');
      assert.equal(await page.evaluate(() => remoteTest.writes.length), 2, 'Retry reads; it never repeats a write');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => remoteTest.reads.length === 3);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => remoteTest.cancelled), 1);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => remoteTest.reads.length === 4);
      await page.evaluate(() => remoteTest.reads[2].resolve({mode: 'xmb', available: true}));
      assert.equal(await home('xmb').getAttribute('aria-pressed'), 'false', 'Closed-panel results are ignored');
      await settle('reads', 3, {mode: 'xmb', available: false, canRetry: false,
        reason: 'home_overlay_active', message: 'LG-XMB replaces LG Home. Restore LG Home to change this button.'});
      assert.equal(await home('stock').isDisabled(), true);
      assert.equal(await home('xmb').isDisabled(), true);
      assert.equal(await home('xmb').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-remote-retry]').isVisible(), false,
        'A Home replacement is not a temporary setup failure');
      assert.match(await page.locator('#modalContent').textContent(), /LG-XMB replaces LG Home/);
      await back('previous').click();
      assert.equal(await back('previous').getAttribute('aria-pressed'), 'true');
      await page.keyboard.press('ArrowUp');
      assert.equal(await active(), 'Back button:previous', 'Replacement status cannot trap remote focus');
      const fits = await back('previous').evaluate(node => {
        const box = node.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight && box.right <= innerWidth;
      });
      assert.ok(fits, 'Back choices remain reachable at ' + height);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => remoteTest.reads.length === 5);
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      assert.equal(await page.evaluate(() => remoteTest.cancelled), 2);
      assert.equal(await page.evaluate(() => C5App.getState().modal), null);
      await page.evaluate(() => remoteTest.reads[4].resolve({mode: 'xmb', available: true}));
      assert.equal(await page.evaluate(() => C5RemoteSettings.getState().home), null);
      checks.push(height + 'p: Remote focus, guarded writes, retry, stale replies, unavailable Home and working Back');
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({checks, errors, testedOnTV: false}, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
