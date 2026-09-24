// SPDX-License-Identifier: GPL-3.0-or-later
// Actual launcher lifecycle with deterministic time and local TV-service doubles.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchOptions } = require('./support/menu-navigation.cjs');
const app = path.resolve(__dirname, '../app');

(async () => {
  const browser = await chromium.launch(launchOptions());
  const errors = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      bypassCSP: true
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-09-24T12:00:00Z') });
    const html = fs
      .readFileSync(path.join(app, 'index.html'), 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
      .replace(/<link[^>]+rel="stylesheet"[^>]*>/g, '');
    await page.setContent(html);
    await page.addStyleTag({ path: path.join(app, 'style.css') });
    for (const file of ['icons', 'input-discovery', 'catalog', 'category-transition'])
      await page.addScriptTag({ path: path.join(app, file + '.js') });
    await page.addScriptTag({ path: path.join(__dirname, 'fixtures/catalog-platform.js') });
    for (const file of [
      'menu-focus',
      'directional-repeat',
      'wheel-navigation',
      'menu-sounds',
      'app-manager',
      'hold-gesture',
      'menu-order',
      'app-categories',
      'app-refresh',
      'item-options',
      'system-time',
      'date-time-settings',
      'launcher-preferences',
      'settings-ui',
      'appearance-settings',
      'launcher-view',
      'clock-view'
    ])
      await page.addScriptTag({ path: path.join(app, file + '.js') });
    await page.evaluate(() => {
      window.lifecycleProbe = { hidden: true, updates: 0, intervals: new Set() };
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => lifecycleProbe.hidden
      });
      const originalUpdate = LGXMBClockView.prototype.update;
      LGXMBClockView.prototype.update = function (...args) {
        lifecycleProbe.updates++;
        return originalUpdate.apply(this, args);
      };
      const set = window.setInterval,
        clear = window.clearInterval;
      window.setInterval = (callback, delay, ...args) => {
        const id = set(callback, delay, ...args);
        if (delay === 10000) lifecycleProbe.intervals.add(id);
        return id;
      };
      window.clearInterval = (id) => {
        lifecycleProbe.intervals.delete(id);
        clear(id);
      };
      window.visibility = (hidden) => {
        lifecycleProbe.hidden = hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      };
    });
    await page.addScriptTag({ path: path.join(app, 'app.js') });
    const snapshot = () =>
      page.evaluate(() => ({
        updates: lifecycleProbe.updates,
        intervals: lifecycleProbe.intervals.size,
        refresh: C5App.getState().appRefresh,
        detailPending: C5App.getState().detailPending
      }));
    const hiddenStart = await snapshot();
    assert.equal(hiddenStart.intervals, 0, 'Hidden startup does not start a clock interval');
    await page.clock.runFor(60000);
    assert.equal(
      (await snapshot()).updates,
      hiddenStart.updates,
      'No hidden clock or gradient refreshes'
    );
    assert.equal(await page.evaluate(() => C5App.getState().appRefresh.reads), 0);

    await page.evaluate(() => {
      visibility(false);
      window.dispatchEvent(new Event('pageshow'));
    });
    await page.clock.runFor(1);
    const awake = await snapshot();
    assert.equal(awake.intervals, 1, 'Duplicate wake events share one clock interval');
    await page.clock.runFor(30000);
    assert.equal((await snapshot()).updates, awake.updates + 3);

    await page.evaluate(() => {
      document.querySelector('[data-category="settings"]').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
    });
    assert.equal((await snapshot()).detailPending, true);
    await page.evaluate(() => {
      visibility(true);
      window.dispatchEvent(new Event('pagehide'));
    });
    const asleep = await snapshot();
    assert.equal(asleep.intervals, 0);
    assert.equal(asleep.detailPending, false, 'Suspend cancels delayed detail repaint');
    await page.clock.runFor(60000);
    assert.equal((await snapshot()).updates, asleep.updates);

    await page.evaluate(() => visibility(false));
    const returned = await snapshot();
    assert.equal(returned.intervals, 1);
    assert.equal(returned.updates, asleep.updates + 1, 'Return updates time immediately');
    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
    assert.equal((await snapshot()).intervals, 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          hiddenClockWakeups: 0,
          duplicateWakeIntervals: 1,
          deferredDetailCancelled: true,
          immediateClockOnReturn: true,
          errors
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
