// SPDX-License-Identifier: GPL-3.0-or-later
// Isolated layout regression. Forced fallback is not a Chromium 87 emulation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const menu = require('./support/menu-navigation.cjs');

function inlineStyles(html, app, transform) {
  let count = 0;
  const result = html.replace(/<link\b[^>]*>/gi, tag => {
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(tag)) return tag;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
    assert.ok(href && /^[\w-]+\.css$/.test(href[1]), 'Stylesheet must be an app-local CSS file');
    count++;
    return '<style>' + transform(fs.readFileSync(path.join(app, href[1]), 'utf8')) + '</style>';
  });
  assert.ok(count > 0, 'The layout fixture must load the actual app stylesheets');
  return result;
}

async function checkStaticFallback(browser, app, width) {
  const page = await browser.newPage({ viewport: { width, height: width * 9 / 16 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.webglRequests = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      if (/webgl/i.test(kind)) {
        window.webglRequests++;
        return null;
      }
      return getContext.call(this, kind, ...args);
    };
  });
  await page.goto(pathToFileURL(path.join(app, 'index.html')).href + '?preview=1');
  await page.waitForFunction(() => window.C5App && C5App.getState().waveMode === 'static');
  assert.ok(await page.evaluate(() => window.webglRequests > 0));
  assert.equal(await page.evaluate(() => C5TV.isTV()), false, 'No TV calls in the browser check');
  await menu.item(page, 'settings', 'appearance');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => C5App.getState().modal), 'appearance');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => C5App.getState().modal), null);
  await menu.category(page, 'tv');
  assert.deepEqual(errors, [], 'Navigation and settings must work without WebGL');
  await page.close();
}

async function main() {
  const app = path.resolve(__dirname, '../app');
  const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const css = fs.readFileSync(path.join(app, 'style.css'), 'utf8');
  const condition = '@supports not (aspect-ratio: 16 / 9)';
  assert.ok(css.includes(condition), 'The Chromium 87 fallback must be present');
  const layoutHtml = inlineStyles(html, app, value => value);
  const legacyHtml = inlineStyles(html, app, value => value.replace(condition, '@media all')
    .replace(/aspect-ratio\s*:\s*16\s*\/\s*9\s*;/g, ''));
  let browser;
  try {
    browser = await chromium.launch(menu.launchOptions());
    const results = [];
    for (const width of [1280, 1920]) {
      const height = width * 9 / 16;
      const shapes = [];
      for (const fallback of [false, true]) {
        const page = await browser.newPage({ viewport: { width, height } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(fallback ? legacyHtml : layoutHtml);
        await page.evaluate(() => {
          document.querySelector('.detail').classList.add('has-input-preview');
          document.getElementById('previewPanel').hidden = false;
        });
        const panel = await page.locator('#previewPanel').boundingBox();
        assert.ok(panel && panel.width > 0 && panel.height > 0, 'Preview must not collapse');
        assert.ok(Math.abs(panel.height - panel.width * 9 / 16) < 1, 'Preview must remain 16:9');
        for (const selector of ['#previewButton', '#thumbnailFallback']) {
          const box = await page.locator(selector).boundingBox();
          for (const key of ['x', 'y', 'width', 'height']) {
            assert.ok(Math.abs(box[key] - panel[key]) < 1, `${selector} must cover the preview`);
          }
        }
        await page.evaluate(() => {
          document.getElementById('inputPreview').hidden = false;
          const video = document.createElement('video');
          document.querySelector('.input-preview-media').appendChild(video);
        });
        const video = await page.locator('video').boundingBox();
        for (const key of ['x', 'y', 'width', 'height']) {
          assert.ok(Math.abs(video[key] - panel[key]) < 1, 'Live preview must fit the same rectangle');
        }
        await page.evaluate(() => { document.getElementById('previewPanel').hidden = true; });
        assert.equal(await page.locator('#previewPanel').boundingBox(), null, 'Hidden panel must stay hidden');
        assert.deepEqual(errors, []);
        shapes.push(panel);
        results.push({ width, height, mode: fallback ? 'forced fallback' : 'native CSS', passed: true });
        await page.close();
      }
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(shapes[0][key] - shapes[1][key]) < 1, 'Fallback must preserve layout');
      }
      await checkStaticFallback(browser, app, width);
      results.push({ width, height, mode: 'no WebGL: navigation and settings', passed: true });
    }
    console.log(JSON.stringify({ browser: await browser.version(), testedOnTV: false, cases: results }, null, 2));
  } finally {
    if (browser) await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
