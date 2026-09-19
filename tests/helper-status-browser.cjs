// SPDX-License-Identifier: GPL-3.0-or-later
// Real Settings and page lifecycle with local helper/service fixtures. No TV access.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const menu = require('./support/menu-navigation.cjs');

(async () => {
  const browser = await chromium.launch(menu.launchOptions());
  const errors = [];
  try {
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}, userAgent: 'webOS SmartTV'});
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify({motion: 'reduced', sound: false, musicEnabled: false}));
      window.PalmSystem = {identifier: 'org.local.openxmb.c5'};
      window.helperFixture = {calls: 0, reads: 0, heartbeat: null};
      window.PalmServiceBridge = class {
        call(uri) {
          let result = {returnValue: false, errorText: 'Unavailable in fixture'};
          if (uri === 'luna://org.webosbrew.hbchannel.service/exec') {
            helperFixture.calls++;
            result = {returnValue: true, stderrString: '', stdoutString: JSON.stringify({
              returnValue: true, ready: true, captureRunning: helperFixture.calls > 1
            })};
          } else if (uri.endsWith('/listApps')) result = {returnValue: true, apps: []};
          setTimeout(() => { if (this.onservicecallback) this.onservicecallback(JSON.stringify(result)); }, 0);
        }
        cancel() { this.onservicecallback = null; }
      };
      const NativeXHR = XMLHttpRequest;
      window.XMLHttpRequest = function () {
        const xhr = new NativeXHR(), open = xhr.open.bind(xhr), send = xhr.send.bind(xhr);
        let heartbeat = false;
        xhr.open = function (method, url, ...args) {
          heartbeat = /^thumbnails\/status.json/.test(url);
          if (!heartbeat) open(method, url, ...args);
        };
        xhr.send = function (...args) {
          if (!heartbeat) return send(...args);
          helperFixture.reads++;
          setTimeout(() => {
            if (!helperFixture.heartbeat) { if (xhr.onerror) xhr.onerror(); return; }
            Object.defineProperty(xhr, 'status', {value: 200});
            Object.defineProperty(xhr, 'responseText', {value: JSON.stringify({
              version: 1, state: helperFixture.heartbeat, updatedAt: Date.now() / 1000
            })});
            if (xhr.onload) xhr.onload();
          }, 0);
        };
        return xhr;
      };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../app/index.html')).href);
    await page.waitForFunction(() => window.C5App && LGXMBHelper.getState().phase === 'ready');
    await menu.item(page, 'settings', 'previews');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('retryHelper').hidden);
    assert.match(await page.locator('#helperStatus').textContent(), /did not start/i);
    assert.equal(await page.evaluate(() => helperFixture.calls), 1);

    await page.locator('#retryHelper').click();
    await page.waitForFunction(() => LGXMBHelper.getState().phase === 'ready' && helperFixture.calls === 2);
    await page.waitForFunction(() => !document.getElementById('retryHelper').hidden);
    assert.match(await page.locator('#helperStatus').textContent(), /status unavailable/i);
    await page.locator('#retryHelper').focus();
    await page.evaluate(() => { helperFixture.heartbeat = 'idle'; });
    await page.waitForFunction(() => LGXMBHelper.getState().captureHealth === 'running', null, {timeout: 8000});
    assert.equal(await page.locator('#helperStatus').textContent(), '');
    assert.equal(await page.locator('#retryHelper').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-choice')), 'cached');

    await page.evaluate(() => {
      window.testHidden = true;
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => testHidden});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const before = await page.evaluate(() => helperFixture.reads);
    await page.waitForTimeout(5200);
    assert.equal(await page.evaluate(() => helperFixture.reads), before, 'hidden Home stops health polling');
    await page.evaluate(() => {
      testHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
    });
    await page.waitForFunction(count => helperFixture.reads > count, before);
    assert.equal(await page.evaluate(() => helperFixture.reads), before + 1, 'duplicate resume events share one health read');
    assert.equal(await page.evaluate(() => helperFixture.calls), 2, 'healthy resume does not run setup again');
    await page.keyboard.press('Escape');
    const closedReads = await page.evaluate(() => helperFixture.reads);
    await page.waitForTimeout(5200);
    assert.equal(await page.evaluate(() => helperFixture.reads), closedReads, 'closing Settings stops its polling');
    await page.close();
    const desktop = await browser.newPage();
    desktop.on('pageerror', error => errors.push(error.message));
    await desktop.addInitScript(() => {
      window.desktopCalls = 0;
      window.PalmSystem = {identifier: 'desktop-fixture'};
      window.PalmServiceBridge = class {call() { desktopCalls++; } cancel() {}};
      localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify({motion: 'reduced', sound: false}));
    });
    await desktop.goto(pathToFileURL(path.resolve(__dirname, '../app/index.html')).href);
    await desktop.waitForFunction(() => window.C5App);
    await menu.item(desktop, 'settings', 'previews'); await desktop.keyboard.press('Enter');
    assert.equal(await desktop.locator('#helperStatus').count(), 0);
    assert.equal(await desktop.evaluate(() => desktopCalls), 0, 'desktop preview sends no native helper calls');
    assert.deepEqual(errors, []);
    console.log('Helper Settings: failed start, manual Retry, recovery refresh, focus, suspend and duplicate resume passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
