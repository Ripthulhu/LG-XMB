// SPDX-License-Identifier: GPL-3.0-or-later
// Real launcher and WebGL lifecycle; the native HDMI element is simulated.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const menu = require('./support/menu-navigation.cjs');

(async () => {
  const browser = await chromium.launch(menu.launchOptions());
  const checks = [],
    errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        'lg-xmb-preferences-v1',
        JSON.stringify({
          previewMode: 'live',
          motion: 'full',
          waveParticles: false
        })
      );
      const create = document.createElement.bind(document);
      document.createElement = function (name, ...args) {
        if (name === 'source') return create('span');
        const element = create(name, ...args);
        if (name === 'video') {
          Object.defineProperty(element, 'readyState', { get: () => 4 });
          element.play = () => {
            setTimeout(() => element.dispatchEvent(new Event('playing')), 0);
            return Promise.resolve();
          };
          element.pause = element.load = () => {};
        }
        return element;
      };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../app/index.html')).href);
    await page.waitForFunction(() => window.C5App && C5App.getState().waveMode === 'webgl');
    const saved = await page.evaluate(() => localStorage.getItem('lg-xmb-preferences-v1'));
    await menu.item(page, 'tv', 'com.webos.app.hdmi1');
    assert.equal(
      await page.evaluate(() => C5App.getState().waveDiagnostics.motionHeld),
      false,
      'Desktop preview must not stop animation'
    );
    await menu.item(page, 'tv', 'com.webos.app.livetv');
    await page.evaluate(() => {
      window.C5TV = Object.assign({}, C5TV, { isTV: () => true });
    });
    async function live() {
      await menu.item(page, 'tv', 'com.webos.app.livetv');
      await menu.item(page, 'tv', 'com.webos.app.hdmi1');
      await page.waitForFunction(() => C5App.getState().inputPreview.status === 'playing');
      assert.equal(await page.evaluate(() => C5App.getState().waveDiagnostics.motionHeld), true);
    }
    async function advancing(expected) {
      if (expected) await page.waitForFunction(() => !C5App.getState().waveDiagnostics.motionHeld);
      const before = await page.evaluate(() => C5App.getState().waveDiagnostics.time);
      await page.waitForTimeout(180);
      const after = await page.evaluate(() => C5App.getState().waveDiagnostics.time);
      assert.equal(after > before, expected);
    }
    await live();
    await advancing(false);
    const capture = { clip: { x: 0, y: 620, width: 128, height: 80 } };
    const frame = await page.screenshot(capture);
    await page.waitForTimeout(180);
    assert.deepEqual(
      await page.screenshot(capture),
      frame,
      'Live preview keeps the presented background frame'
    );
    checks.push('native preview pauses animation and retains the rendered frame');

    await page.evaluate(() => document.dispatchEvent(new Event('webOSRelaunch')));
    await advancing(false);
    checks.push('Home while previewing does not briefly resume background rendering');

    await page.keyboard.press('F2');
    await advancing(true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => C5App.getState().inputPreview.status === 'playing');
    await advancing(false);
    checks.push('opening a menu resumes waves; closing it pauses for the returning live preview');

    await menu.item(page, 'settings', 'appearance');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Show waves full screen', exact: true }).click();
    const fullscreen = await page.evaluate(() => C5App.getState());
    assert.equal(fullscreen.item, 'appearance');
    assert.equal(fullscreen.waveOnly, true);
    assert.equal(fullscreen.inputPreview.status, 'idle');
    await page.waitForTimeout(650);
    assert.equal(
      await page.locator('#inputPreview video').count(),
      0,
      'Fullscreen waves must not allocate a hidden HDMI preview'
    );
    await advancing(true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => C5App.getState().waveOnly), false);
    await live();
    await advancing(false);
    checks.push('fullscreen waves keep animating and returning to HDMI restores the live preview');

    await page.evaluate(() =>
      document.querySelector('#inputPreview video').dispatchEvent(new Event('error'))
    );
    assert.equal(await page.evaluate(() => C5App.getState().inputPreview.status), 'unavailable');
    await advancing(true);
    checks.push('a failed preview releases the animation pause');

    await live();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = await page.evaluate(() => C5App.getState());
    assert.equal(hidden.inputPreview.status, 'idle');
    assert.equal(hidden.waveDiagnostics.paused, true);
    await advancing(false);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => C5App.getState().inputPreview.status === 'playing');
    await advancing(false);
    await menu.item(page, 'tv', 'com.webos.app.livetv');
    await advancing(true);
    checks.push('hidden-page teardown stays paused and leaving HDMI restores animation');
    assert.equal(await page.evaluate(() => localStorage.getItem('lg-xmb-preferences-v1')), saved);
    assert.equal(await page.evaluate(() => C5App.getState().preferences.motion), 'full');
    checks.push('preview activity never changes saved animation or quality settings');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, errors, nativeHDMISimulated: true }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
