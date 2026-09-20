// SPDX-License-Identifier: GPL-3.0-or-later
// Colour is a vertical list. Every entry is reachable using Up/Down alone.
'use strict';
const {chromium} = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const {launchOptions} = require('./support/menu-navigation.cjs');
(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    for (const width of [1280, 1920]) {
      const page = await browser.newPage({viewport: {width, height: width * 9 / 16}});
      await page.setContent('<section id="modal" class="modal"><h2>Colour</h2><div id="modalContent"></div></section>');
      await page.addStyleTag({path: path.resolve('app/style.css')});
      for (const file of ['menu-focus.js', 'settings-ui.js', 'launcher-preferences.js', 'wave-color-settings.js']) {
        await page.addScriptTag({path: path.resolve('app', file)});
      }
      await page.evaluate(() => {
        const content = document.getElementById('modalContent');
        const ui = new LGXMBSettingsUI(content, {getPanel: () => 'colour', sound() {}, focus: LGXMBMenuFocus});
        window.colourChanges = [];
        LGXMBWaveColorSettings.open({content, ui, preferences: {colour: 'original'},
          onChange(value) { colourChanges.push(value); }});
        document.addEventListener('keydown', event => ui.key(event, document.getElementById('modal')));
        content.querySelector('button').focus();
      });
      const buttons = page.locator('#modalContent button');
      assert.equal(await buttons.count(), 13);
      const tops = await buttons.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
      assert.ok(tops.every((top, i) => !i || top > tops[i - 1]), 'Colours form one vertical list');
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), 'original');
      for (let colour = 1; colour <= 12; colour++) {
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), String(colour));
        const bounds = await page.evaluate(() => {
          const item = document.activeElement.getBoundingClientRect();
          const panel = document.getElementById('modal').getBoundingClientRect();
          return item.top >= panel.top && item.bottom <= panel.bottom;
        });
        assert.equal(bounds, true, 'Focused colour stays visible');
      }
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), '12');
      await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => colourChanges), [12]);
      for (let colour = 11; colour >= 0; colour--) {
        await page.keyboard.press('ArrowUp');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), colour ? String(colour) : 'original');
      }
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), '12');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), 'original');
      await page.close();
    }
    console.log('PASS: every colour is reachable vertically at 720p and 1080p; arrows clamp and Tab wraps');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
