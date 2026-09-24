// SPDX-License-Identifier: GPL-3.0-or-later
// Verify focus eligibility and traversal work with actual browser focus semantics.
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
    await page.setContent('<section id="modal"><div id="modalContent"></div></section>');
    for (const name of ['menu-focus.js', 'settings-ui.js'])
      await page.addScriptTag({path: path.join(app, name)});
    const result = await page.evaluate(() => {
      const panel = document.getElementById('modal');
      const content = document.getElementById('modalContent');
      let sounds = 0, panelScans = 0, groupQueries = 0;
      const ui = new LGXMBSettingsUI(content, {
        getPanel: () => 'test', focus: LGXMBMenuFocus, sound: () => sounds++
      });
      const before = ui.row('Before', null, false, () => {});
      const group = ui.choiceGroup('Choices', [['a', 'A'], ['b', 'B'], ['c', 'C']], 'a', () => {});
      const [a, b, c] = group.querySelectorAll('button');
      const after = ui.row('After', null, false, () => {});
      const steps = [];
      function key(key, shiftKey = false) {
        const event = new KeyboardEvent('keydown', {key, shiftKey, cancelable: true});
        ui.key(event, panel);
        steps.push({focus: document.activeElement.textContent, prevented: event.defaultPrevented});
      }

      // The selected option is hidden, but the row still has available choices.
      a.hidden = true;
      before.focus();
      key('ArrowDown');
      key('ArrowDown');
      key('ArrowUp');
      // A hidden ancestor must also exclude a selected option.
      a.hidden = false;
      const wrapper = document.createElement('span');
      a.replaceWith(wrapper);
      wrapper.appendChild(a);
      wrapper.hidden = true;
      before.focus();
      key('ArrowDown');
      // Disabled controls stay excluded, and the current selected visible choice wins.
      wrapper.hidden = false;
      a.disabled = true;
      before.focus();
      key('ArrowDown');
      a.disabled = false;
      before.focus();
      key('ArrowDown');
      // Eligibility changes take effect immediately, without waiting for an observer.
      group.hidden = true;
      before.focus();
      key('ArrowDown');
      group.hidden = false;
      key('ArrowUp');
      key('ArrowRight');
      key('ArrowLeft');
      after.focus();
      const soundsBeforeBoundary = sounds;
      key('ArrowDown');
      const silentBoundary = sounds === soundsBeforeBoundary;
      key('Tab');
      key('Tab', true);

      const panelQuery = panel.querySelectorAll;
      panel.querySelectorAll = function (...args) {
        panelScans++;
        return panelQuery.apply(this, args);
      };
      const groupQuery = group.querySelector;
      group.querySelector = function (...args) {
        groupQueries++;
        return groupQuery.apply(this, args);
      };
      before.focus();
      for (let i = 0; i < 120; i++)
        ui.key(new KeyboardEvent('keydown', {
          key: i % 2 ? 'ArrowUp' : 'ArrowDown', cancelable: true
        }), panel);
      return {steps, silentBoundary, panelScans, groupQueries, finalFocus: document.activeElement.textContent};
    });
    assert.deepEqual(result.steps.map(step => step.focus), [
      'B', 'After', 'B', 'B', 'B', 'A✓', 'After', 'A✓', 'B', 'A✓', 'After', 'Before', 'After'
    ]);
    assert.ok(result.steps.every(step => step.prevented));
    assert.equal(result.silentBoundary, true);
    assert.equal(result.panelScans, 120, 'Each vertical key needs only one current control list');
    assert.equal(result.groupQueries, 0, 'Use eligible controls already found by the panel traversal');
    assert.equal(result.finalFocus, 'Before');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({checks: ['hidden selected choices', 'hidden ancestors',
      'disabled choices', 'immediate eligibility changes', 'horizontal choice navigation',
      'silent boundaries', 'Tab wrap'], measurement: {keys: 120,
      panelScans: result.panelScans, targetRowQueries: result.groupQueries}, testedOnTV: false}, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
