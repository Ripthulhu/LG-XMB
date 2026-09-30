// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/clock-view.js'), 'utf8'), context);

function clock() {
  function element() {
    const attributes = {};
    return {textContent: '', getAttribute: key => attributes[key],
      setAttribute: (key, value) => {attributes[key] = value;}};
  }
  const children = Object.fromEntries(['#time', '#date', '.clock-hour', '.clock-minute']
    .map(selector => [selector, element()]));
  const root = Object.assign(element(), {querySelector: selector => children[selector]});
  return new context.window.LGXMBClockView(root);
}

test('both clock styles format midnight, noon and the year boundary without changing the hands', () => {
  for (const style of ['current', 'ps3']) {
    const view = clock();
    for (const [now, time24, time12, dates] of [
      [new Date(2026, 11, 31, 23, 59), '23:59', '11:59 PM', ['31/12/2026', '12/31/2026', '2026-12-31']],
      [new Date(2027, 0, 1, 0, 34), style === 'ps3' ? '0:34' : '00:34', '12:34 AM', ['01/01/2027', '01/01/2027', '2027-01-01']],
      [new Date(2027, 0, 1, 12, 5), '12:05', '12:05 PM', ['01/01/2027', '01/01/2027', '2027-01-01']]
    ]) {
      for (const [timeFormat, expected] of [['24h', time24], ['12h', time12]]) {
        for (const [index, dateFormat] of ['dmy', 'mdy', 'ymd'].entries()) {
          view.update(now, style, timeFormat, dateFormat);
          assert.equal(view.time.textContent, expected);
          assert.equal(view.date.textContent, dates[index]);
          assert.equal(view.time.dateTime, now.toISOString());
          if (style === 'ps3') {
            assert.equal(view.hour.getAttribute('transform'),
              `rotate(${(now.getHours() % 12) * 30 + now.getMinutes() / 2} 16 16)`);
            assert.equal(view.minute.getAttribute('transform'), `rotate(${now.getMinutes() * 6} 16 16)`);
          }
        }
      }
    }
  }
});

test('omitted formats retain each clock style and invalid dates leave it unchanged', () => {
  const now = new Date(2026, 8, 20, 9, 45), view = clock();
  for (const style of ['current', 'ps3']) {
    view.update(now, style);
    assert.equal(view.time.textContent, style === 'ps3' ? '9:45' : '09:45');
    const date = style === 'ps3' ? '20/9'
      : now.toLocaleDateString('en-GB', {weekday: 'short', day: '2-digit', month: 'short'});
    assert.equal(view.date.textContent, date);
    view.update(new Date(NaN), style, '12h', 'ymd');
    assert.equal(view.date.textContent, date);
    assert.equal(view.time.textContent, style === 'ps3' ? '9:45' : '09:45');
  }
});
