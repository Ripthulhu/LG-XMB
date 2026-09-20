// Local font files are optional. No TV connection or installation.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const menu = require('./support/menu-navigation.cjs');
const app = path.resolve(__dirname, '../app');

(async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(app, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(app + path.sep)) return res.writeHead(403).end();
      const data = await fs.readFile(file);
      const types = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.ttf': 'font/ttf'
      };
      res
        .writeHead(200, {
          'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream'
        })
        .end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    const available = await fs.access(path.join(app, 'user-fonts/SCE-PS3-RD-R-LATIN2.TTF')).then(
      () => true,
      () => false
    );
    browser = await chromium.launch(menu.launchOptions());
    for (const withFont of available ? [false, true] : [false]) {
      for (const height of [1080, 720]) {
        const page = await browser.newPage({ viewport: { width: (height * 16) / 9, height } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (/font|OTS/i.test(message.text())) console.log(message.text());
        });
        await page.route('**/*', (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) return route.abort();
          if (!withFont && url.pathname.startsWith('/user-fonts/'))
            return route.fulfill({ status: 404, body: '' });
          return route.continue();
        });
        await page.addInitScript(() =>
          localStorage.setItem(
            'lg-xmb-preferences-v1',
            JSON.stringify({ screensaverDelay: 0, clockStyle: 'ps3' })
          )
        );
        await page.goto(origin);
        await page.waitForFunction(() => window.C5App);
        const loaded = await page.evaluate(async () => {
          const results = [];
          for (const weight of [300, 400, 700]) {
            results.push(
              await document.fonts.load(weight + ' 24px "XMB Rodin"', 'Appearance Sound 20/9').then(
                (faces) => faces.length > 0,
                () => false
              )
            );
          }
          return results;
        });
        assert.deepEqual(loaded, [withFont, withFont, withFont]);
        if (withFont) {
          const offsets = await page.evaluate(() => {
            return [300, 400, 700].map((weight) => {
              const probe = document.createElement('span');
              probe.style.cssText =
                'position:fixed;left:-1000px;display:inline-block;line-height:1.2;font-family:"XMB Rodin";font-size:40px;font-weight:' +
                weight;
              probe.textContent = 'H0129';
              const baseline = document.createElement('span');
              baseline.style.cssText =
                'display:inline-block;width:0;height:0;vertical-align:baseline';
              probe.appendChild(baseline);
              document.body.appendChild(probe);
              const context = document.createElement('canvas').getContext('2d');
              context.font = weight + ' 40px "XMB Rodin"';
              const ink = context.measureText('H0129');
              const rect = probe.getBoundingClientRect();
              const inkMiddle =
                baseline.getBoundingClientRect().top +
                (ink.actualBoundingBoxDescent - ink.actualBoundingBoxAscent) / 2;
              const offset = inkMiddle - (rect.top + rect.bottom) / 2;
              probe.remove();
              return offset;
            });
          });
          for (const offset of offsets)
            assert.ok(Math.abs(offset) < 1.5, 'Visible glyphs are off-centre: ' + offset);
        }
        await menu.item(page, 'settings', 'appearance');
        await page.keyboard.press('Enter');
        await page.locator('#modalBackdrop').waitFor({ state: 'visible' });
        const geometry = await page.locator('#modalBackdrop button:visible').evaluateAll((nodes) =>
          nodes.map((node) => ({
            label: node.textContent,
            width: node.clientWidth,
            scroll: node.scrollWidth,
            font: getComputedStyle(node).fontFamily
          }))
        );
        assert.ok(geometry.length > 0);
        for (const row of geometry) {
          assert.ok(row.font.includes('XMB Rodin'));
          assert.ok(row.scroll <= row.width + 1, row.label + ' overflows');
        }
        assert.equal(
          await page
            .locator('#time')
            .evaluate((node) => getComputedStyle(node).fontFamily.includes('XMB Rodin')),
          true
        );
        if (process.env.OPENXMB_SCREENSHOT_DIR) {
          await fs.mkdir(process.env.OPENXMB_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({
            path: path.join(
              process.env.OPENXMB_SCREENSHOT_DIR,
              `fonts-${withFont ? 'rodin' : 'system'}-${height}.png`
            )
          });
        }
        assert.deepEqual(errors, []);
        console.log(
          `${height}p: ${withFont ? 'Rodin loaded, all three weights' : 'missing fonts fall back'}, menu layout passed`
        );
        await page.close();
      }
    }
    if (!available) console.log('Local Rodin files absent; font rendering checks skipped.');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
