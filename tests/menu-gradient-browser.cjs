// SPDX-License-Identifier: GPL-3.0-or-later
// Local only: check the actual menu and clock timer without connecting to a TV.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const menu = require('./support/menu-navigation.cjs');
const app = path.resolve(__dirname, '../app');

(async () => {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(app, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(app + path.sep)) return response.writeHead(403).end();
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
      response.writeHead(200, {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream'
      });
      response.end(await fs.readFile(file));
    } catch {
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch(menu.launchOptions());
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const height of [1080, 720]) {
      const page = await browser.newPage({ viewport: { width: (height * 16) / 9, height } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
      );
      await page.clock.install({ time: new Date(2026, 8, 15, 12) });
      await page.addInitScript(() =>
        localStorage.setItem(
          'lg-xmb-preferences-v1',
          JSON.stringify({ colour: 'original', screensaverDelay: 0 })
        )
      );
      await page.goto(origin);
      await page.waitForFunction(() => window.C5App);
      await page.locator('#items > .rows:not(.parked) > button').first().click({ button: 'right' });
      await page.locator('.item-options-panel').waitFor({ state: 'visible' });
      await page.evaluate(() => {
        window.gradientFocus = document.activeElement;
      });
      const shade = () =>
        page.locator('.item-options-shade').evaluate((node) => ({
          background: getComputedStyle(node, '::before').backgroundImage,
          mask: getComputedStyle(node, '::before').webkitMaskImage
        }));
      const day = await shade();
      assert.notEqual(day.mask, 'none');
      await page.clock.setSystemTime(new Date(2026, 8, 15, 0));
      await page.clock.runFor(10001);
      const night = await shade();
      assert.notEqual(day.background, night.background);
      assert.ok(night.background.includes('77, 77, 82'));
      await page.clock.setSystemTime(new Date(2026, 1, 15, 12));
      await page.clock.runFor(10001);
      assert.notEqual(night.background, (await shade()).background);
      assert.equal(
        await page.evaluate(() => window.gradientFocus === document.activeElement),
        true
      );
      await page.clock.setSystemTime(new Date(2026, 8, 20, 23, 30));
      await page.clock.runFor(10001);
      if (process.env.OPENXMB_SCREENSHOT_DIR) {
        await fs.mkdir(process.env.OPENXMB_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(process.env.OPENXMB_SCREENSHOT_DIR, 'menu-gradient-' + height + '.png')
        });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Menu gradient follows time and season at 1080p and 720p; focus is preserved.');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
