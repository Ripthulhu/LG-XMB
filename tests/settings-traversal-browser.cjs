// SPDX-License-Identifier: GPL-3.0-or-later
// Count full-panel DOM scans while exercising the real settings key handlers.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');
const {launchOptions} = require('./support/menu-navigation.cjs');
const app = path.resolve(__dirname, '../app');

(async () => {
  const browser = await chromium.launch(launchOptions());
  const checks = [];
  try {
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<section id="modal" class="modal"><h2>Settings</h2><div id="modalContent"></div></section>');
    await page.addStyleTag({path: path.join(app, 'style.css')});
    for (const name of ['menu-focus.js', 'settings-ui.js', 'wave-colors.js', 'wave-color-settings.js']) {
      await page.addScriptTag({path: path.join(app, name)});
    }
    const results = await page.evaluate(() => {
      const modal = document.getElementById('modal');
      const content = document.getElementById('modalContent');
      const query = modal.querySelectorAll;
      let scans = 0, visited = 0;
      modal.querySelectorAll = function (selector) {
        const result = query.call(this, selector);
        scans++;
        visited += result.length;
        return result;
      };
      function measure(name, handler, key, count = 60) {
        scans = visited = 0;
        for (let i = 0; i < count; i++) handler(new KeyboardEvent('keydown', {
          key: typeof key === 'function' ? key(i) : key, cancelable: true
        }), modal);
        return {name, keys: count, scans, visited};
      }
      const results = [];
      const ui = new LGXMBSettingsUI(content, {
        getPanel: () => 'appearance', sound() {}, focus: LGXMBMenuFocus
      });
      const choices = [['a', 'A'], ['b', 'B'], ['c', 'C']];
      for (let i = 0; i < 12; i++) ui.choiceGroup('Setting ' + i, choices, 'a', () => {});
      content.querySelector('button').focus();
      results.push(measure('settings horizontal choices', ui.key, 'ArrowRight'));
      results[0].focused = document.activeElement.dataset.choice;

      LGXMBWaveColorSettings.open(content, {mode: 'ps3', dateMode: 'fixed', month: 1}, () => {});
      const months = content.querySelector('[aria-label="Month"]');
      months.querySelector('button').focus();
      results.push(measure('month horizontal choices', LGXMBWaveColorSettings.key, 'ArrowRight'));
      results[1].focused = document.activeElement.dataset.value;

      LGXMBWaveColorSettings.open(content, {mode: 'rgb', red: 128}, () => {});
      const slider = document.getElementById('waveColor-red');
      slider.focus();
      results.push(measure('RGB slider adjustments', LGXMBWaveColorSettings.key,
        i => i % 2 ? 'ArrowLeft' : 'ArrowRight'));
      results[2].value = Number(slider.value);

      // Changing the visible sections must be reflected immediately. There is
      // no cached navigation list to retain hidden RGB controls or miss months.
      content.querySelector('[data-value="ps3"]').click();
      content.querySelector('[data-value="fixed"]').click();
      const time = content.querySelector('[aria-label="Time of day"]');
      time.querySelector('[data-value="auto"]').focus();
      LGXMBWaveColorSettings.key(new KeyboardEvent('keydown', {key: 'ArrowUp'}), modal);
      results.push({name: 'vertical navigation after visibility change',
        group: document.activeElement.closest('.color-group').getAttribute('aria-label')});
      results.push(measure('Tab enumerates current visible controls', LGXMBWaveColorSettings.key, 'Tab', 1));
      return results;
    });
    console.log(JSON.stringify({measurements: results, testedOnTV: false}, null, 2));
    for (const result of results.slice(0, 3)) {
      assert.equal(result.scans, 0, result.name + ' should not scan the whole panel');
      checks.push(result.name);
    }
    assert.equal(results[0].focused, 'a');
    assert.equal(results[1].focused, '1');
    assert.equal(results[2].value, 128);
    assert.equal(results[3].group, 'Month');
    assert.equal(results[4].scans, 1);
    assert.ok(results[4].visited > 0);
    assert.deepEqual(errors, []);
    checks.push('focus/slider values preserved', 'dynamic sections and Tab remain current');
    console.log(JSON.stringify({checks, errors}, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
