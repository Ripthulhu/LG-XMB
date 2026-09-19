// SPDX-License-Identifier: GPL-3.0-or-later
// Actual focus and scroll geometry; no TV timing claim.
'use strict';
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ?
    {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {channel: 'msedge'})});
  const checks = [], errors = [];
  try {
    for (const width of [1280, 1920]) {
      for (const type of ['settings', 'options']) {
        const page = await browser.newPage({viewport: {width, height: width * 9 / 16}});
        page.on('pageerror', e => errors.push(e.message));
        const options = type === 'options';
        await page.setContent('<!doctype html><div class="modal-backdrop"><section class="modal' +
          (options ? ' item-options-panel' : '') + '"><h2>Appearance</h2><div ' +
          (options ? 'class="item-options-scroll"' : 'id="modalContent"') + '></div></section></div>');
        for (const file of ['style.css', 'item-options.css']) {
          await page.addStyleTag({content: fs.readFileSync(path.join(base, 'app', file), 'utf8')});
        }
        await page.addScriptTag({path: path.join(base, 'app/menu-focus.js')});
        const result = await page.evaluate(options => {
          const host = document.querySelector(options ? '.item-options-scroll' : '#modalContent');
          for (let i = 0; i < 16; i++) {
            const section = document.createElement('section');
            section.className = 'choice-group';
            const heading = document.createElement('h3'); heading.textContent = 'Setting ' + i;
            const choices = document.createElement('div'); choices.className = 'choice-options';
            for (let j = 0; j < 3; j++) {
              const button = document.createElement('button'); button.className = 'option';
              button.textContent = 'Choice ' + j; choices.appendChild(button);
            }
            section.append(heading, choices); host.appendChild(section);
          }
          const rows = [...host.querySelectorAll('.choice-group')];
          const buttons = rows.map(row => row.querySelector('button'));
          let focusCalls = 0, scrollCalls = 0;
          const focus = HTMLElement.prototype.focus, scroll = Element.prototype.scrollIntoView;
          HTMLElement.prototype.focus = function (...args) { focusCalls++; return focus.apply(this, args); };
          Element.prototype.scrollIntoView = function (...args) { scrollCalls++; return scroll.apply(this, args); };
          const measurements = [];
          function visit(button, direction) {
            const before = host.scrollTop;
            const changed = LGXMBMenuFocus(button);
            const bounds = button.getBoundingClientRect(), viewport = host.getBoundingClientRect();
            measurements.push({direction, changed, active: document.activeElement === button,
              jump: Math.abs(host.scrollTop - before), top: bounds.top - viewport.top,
              bottom: bounds.bottom - viewport.bottom, pageX: scrollX, pageY: scrollY});
          }
          buttons.forEach(button => visit(button, 'down'));
          buttons.slice(0, -1).reverse().forEach(button => visit(button, 'up'));
          const callsBeforeRepeat = [focusCalls, scrollCalls];
          const same = LGXMBMenuFocus(buttons[0]), missing = LGXMBMenuFocus(null);
          const noRepeatCalls = callsBeforeRepeat[0] === focusCalls && callsBeforeRepeat[1] === scrollCalls;
          const rowStep = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
          // Moving across a visible choice group must not shift its viewport.
          const beforeHorizontal = host.scrollTop;
          LGXMBMenuFocus(rows[0].querySelectorAll('button')[2]);
          const horizontalStable = host.scrollTop === beforeHorizontal;
          return {measurements, rowStep, same, missing, noRepeatCalls, horizontalStable};
        }, options);
        assert.equal(result.same, false);
        assert.equal(result.missing, false);
        assert.equal(result.noRepeatCalls, true, 'Repeating the focused control must not focus or scroll again');
        assert.equal(result.horizontalStable, true, 'Horizontal choices must keep the viewport in place');
        for (const m of result.measurements) {
          assert.ok(m.changed && m.active, 'Every requested row must receive focus');
          assert.ok(m.top >= -1 && m.bottom <= 1, 'The selected row must remain fully visible');
          assert.ok(m.jump <= result.rowStep + 2, 'Focus must reveal one row without recentering the list');
          assert.equal(m.pageX, 0); assert.equal(m.pageY, 0);
        }
        checks.push({width, type, rows: result.measurements.length, maxScrollStep:
          Math.max(...result.measurements.map(m => m.jump)), rowStep: result.rowStep});
        await page.close();
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({checks, errors, testedOnTV: false}, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
