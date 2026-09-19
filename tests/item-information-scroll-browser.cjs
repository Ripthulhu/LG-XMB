// SPDX-License-Identifier: GPL-3.0-or-later
// Real options layout and remote keys, with local app metadata.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchOptions } = require('./support/menu-navigation.cjs');

(async () => {
  const browser = await chromium.launch(launchOptions());
  const checks = [];
  try {
    for (const height of [720, 1080, 2160]) {
      for (const long of [false, true]) {
        const page = await browser.newPage({
          viewport: { width: Math.round((height * 16) / 9), height }
        });
        await page.setContent('<!doctype html><html><body></body></html>');
        for (const name of ['style.css', 'item-options.css'])
          await page.addStyleTag({ path: path.resolve(__dirname, '../app', name) });
        await page.addScriptTag({ path: path.resolve(__dirname, '../app/menu-focus.js') });
        await page.addScriptTag({
          path: process.env.ITEM_OPTIONS_SOURCE || path.resolve(__dirname, '../app/item-options.js')
        });
        await page.evaluate((long) => {
          const item = { id: 'cdp-30', title: 'Plex', type: 'web', description: 'Open Plex.' };
          const category = { id: 'apps', title: 'Apps', items: [item] };
          window.options = new LGXMBItemOptions({
            manager: {
              getAppInfo: () =>
                Promise.resolve({
                  info: {
                    title: 'Plex',
                    version: '5.2.1',
                    vendor: 'Plex',
                    type: 'web',
                    installation: 'store',
                    description: long
                      ? 'A longer application description with wrapping text. '.repeat(120) +
                        'Final line.'
                      : 'Open Plex.'
                  }
                })
            },
            sound: () => {},
            onOpen: () => {},
            onClose: () => {},
            getSort: () => 'default'
          });
          document.addEventListener('keydown', (e) => options.key(e));
          options.open(item, category);
        }, long);
        await page.waitForFunction(() => options.info);
        await page.locator('[data-action=info]').click();
        const metrics = () =>
          page.evaluate(() => {
            const scroll = options.element.querySelector('.item-options-scroll');
            const last = options.content.querySelector('dd:last-child').firstChild;
            const range = document.createRange();
            range.setStart(last, Math.max(0, last.length - 10));
            range.setEnd(last, last.length);
            return {
              top: scroll.scrollTop,
              max: scroll.scrollHeight - scroll.clientHeight,
              bottom: range.getBoundingClientRect().bottom,
              edge: scroll.getBoundingClientRect().bottom,
              view: options.view,
              open: options.opened
            };
          });
        const initial = await metrics();
        await page.keyboard.press('ArrowDown');
        if (initial.max > 0)
          assert.ok((await metrics()).top > initial.top, 'Down must scroll read-only information');
        // Held remote input must reach the end, even when the text spans many screens.
        await page.evaluate(() => {
          for (let n = 0; n < 240; n++)
            document.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'ArrowDown', repeat: true, bubbles: true })
            );
        });
        const end = await metrics();
        assert.ok(Math.abs(end.top - end.max) <= 1);
        assert.ok(end.bottom <= end.edge - 2, 'Final text line must clear the clipping edge');
        await page.keyboard.press('ArrowDown');
        assert.equal((await metrics()).top, end.top, 'End of text stays put');
        await page.evaluate(() => {
          for (let n = 0; n < 240; n++)
            document.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: true, bubbles: true })
            );
        });
        assert.equal((await metrics()).top, 0);
        // Mouse-wheel users use the same scroll area.
        await page.locator('.item-options-scroll').hover();
        await page.mouse.wheel(0, 5000);
        await page.waitForTimeout(80);
        if (initial.max > 0) assert.ok((await metrics()).top > 0);
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => options.view), 'main');
        await page.locator('[data-action=info]').click();
        assert.equal((await metrics()).top, 0, 'Reopening information starts at the top');
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => options.view), 'main', 'Back action still works');
        checks.push(
          `${height}p ${long ? 'long' : 'short'} information: remote, wheel, final line and back`
        );
        await page.close();
      }
    }
    console.log(JSON.stringify({ checks }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
