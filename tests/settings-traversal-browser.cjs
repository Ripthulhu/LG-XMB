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
    for (const name of ['menu-focus.js', 'settings-ui.js', 'launcher-preferences.js', 'wave-color-settings.js']) {
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

      content.textContent = '';
      const preferences = {colour: 'original'};
      LGXMBWaveColorSettings.open({content, ui, preferences,
        onChange(value) { preferences.colour = value; }});
      content.querySelector('button').focus();
      results.push(measure('colour vertical choices', ui.key, 'ArrowDown', 12));
      results[1].focused = document.activeElement.dataset.choice;
      results[1].count = content.querySelectorAll('button').length;
      document.activeElement.click();
      results[1].selected = preferences.colour;

      results.push(measure('colour bottom boundary', ui.key, 'ArrowDown'));
      results[2].focused = document.activeElement.dataset.choice;
      results.push(measure('Tab enumerates current visible controls', ui.key, 'Tab', 1));
      results[3].focused = document.activeElement.dataset.choice;
      content.textContent = '';
      ui.choiceGroup('Brightness', [[0, 'Normal'], [-1, '-1'], [-2, '-2']], 0, () => {});
      content.querySelector('button').focus();
      results.push(measure('background horizontal choices', ui.key, 'ArrowRight'));
      results[4].focused = document.activeElement.dataset.choice;
      return results;
    });
    console.log(JSON.stringify({measurements: results, testedOnTV: false}, null, 2));
    for (const result of [results[0], results[4]]) {
      assert.equal(result.scans, 0, result.name + ' should not scan the whole panel');
      checks.push(result.name);
    }
    assert.equal(results[0].focused, 'a');
    assert.equal(results[1].focused, '12');
    assert.equal(results[1].count, 13);
    assert.equal(results[1].selected, 12);
    assert.equal(results[1].scans, 12, 'Colour uses one shared traversal per vertical move');
    assert.equal(results[2].focused, '12');
    assert.equal(results[3].scans, 1);
    assert.equal(results[3].visited, 13);
    assert.equal(results[3].focused, 'original');
    assert.equal(results[4].focused, '0');
    assert.deepEqual(errors, []);
    checks.push('colour traversal visits every option', 'colour boundary clamps and Tab wraps');
    console.log(JSON.stringify({checks, errors}, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
