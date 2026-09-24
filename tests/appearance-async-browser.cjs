// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');
const {launchOptions} = require('./support/menu-navigation.cjs');
const app = path.resolve(__dirname, '../app');

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="modalContent"></div>');
    for (const name of ['settings-ui.js', 'appearance-settings.js'])
      await page.addScriptTag({path: path.join(app, name)});
    const result = await page.evaluate(async () => {
      const content = document.getElementById('modalContent');
      const preferences = {background: 'theme', backgroundBrightness: 0};
      let complete, saves = 0, applications = 0;
      const ui = new LGXMBSettingsUI(content, {getPanel: () => 'background', sound() {}});
      const appearance = new LGXMBAppearanceSettings({preferences, content, ui,
        wallpaper: {loading: false, error: '', reload: () => new Promise(resolve => {complete = resolve;})},
        applyPreferences: () => applications++, save: () => saves++});
      const selected = () => content.querySelector('.background-source [aria-pressed="true"]').dataset.choice;
      appearance.openBackground();
      content.querySelector('[data-choice="wallpaper"]').click();
      const pending = {background: preferences.background, selected: selected()};
      // Reopening destroys the original controls while the load is in flight.
      content.textContent = '';
      appearance.openBackground();
      const currentButton = content.querySelector('[data-choice="wallpaper"]');
      complete(true);
      await Promise.resolve();
      const reopened = {background: preferences.background, selected: selected(),
        retainedControl: content.querySelector('[data-choice="wallpaper"]') === currentButton};
      // Failed loads retain the current selection, and leaving the panel is safe.
      content.querySelector('[data-choice="theme"]').click();
      content.querySelector('[data-choice="wallpaper"]').click();
      complete(false);
      await Promise.resolve();
      const failed = {background: preferences.background, selected: selected()};
      content.querySelector('[data-choice="wallpaper"]').click();
      content.textContent = '';
      complete(true);
      await Promise.resolve();
      return {pending, reopened, failed, closed: {background: preferences.background,
        childCount: content.children.length}, saves, applications};
    });
    assert.deepEqual(result.pending, {background: 'theme', selected: 'theme'});
    assert.deepEqual(result.reopened, {background: 'wallpaper', selected: 'wallpaper', retainedControl: true});
    assert.deepEqual(result.failed, {background: 'theme', selected: 'theme'});
    assert.deepEqual(result.closed, {background: 'wallpaper', childCount: 0});
    assert.equal(result.saves, 3);
    assert.equal(result.applications, 3);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({checks: ['pending wallpaper preserves Theme',
      'reopened Background reflects completed load without rerendering',
      'failed load retains selection', 'completion after leaving panel is safe'], testedOnTV: false}, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
