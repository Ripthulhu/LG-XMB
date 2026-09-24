// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const AppRefresh = require('../app/app-refresh.js');

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function fixture(hidden) {
  const document = { hidden };
  const timers = new Map(), calls = [], applied = [];
  let time = 0, sequence = 0, safetyChecks = 0;
  const refresh = new AppRefresh({
    document,
    now: () => time,
    setTimeout(fn, delay) {
      const id = ++sequence;
      timers.set(id, { fn, at: time + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    canApply() {
      safetyChecks++;
      return !document.hidden;
    },
    read() {
      let resolve;
      const request = new Promise(done => { resolve = done; });
      calls.push({ resolve });
      return request;
    },
    apply(apps) { applied.push(apps); return true; }
  });
  async function advance(ms) {
    await flush();
    const end = time + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      time = next[1].at;
      next[1].fn();
      await flush();
    }
    time = end;
    await flush();
  }
  return { document, timers, calls, applied, refresh, advance, safetyChecks: () => safetyChecks };
}

test('starting hidden schedules no inventory reads or safety polling until visible', async () => {
  const h = fixture(true);
  h.refresh.resume();
  await h.advance(120000);
  assert.equal(h.safetyChecks(), 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.refresh.getState().active, false);

  h.document.hidden = false;
  h.refresh.resume();
  await h.advance(0);
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve({ apps: [{ id: 'visible.app' }] });
  await h.advance(0);
  assert.deepEqual(h.applied, [[{ id: 'visible.app' }]]);
  h.refresh.destroy();
});

test('a read finishing while hidden cannot start safety polling or survive the next resume', async () => {
  const h = fixture(false);
  h.refresh.resume();
  await h.advance(0);
  assert.equal(h.calls.length, 1);
  const initialChecks = h.safetyChecks();
  // Visibility may change before the owner receives its suspension event.
  h.document.hidden = true;
  h.calls[0].resolve({ apps: [{ id: 'old.app' }] });
  await h.advance(120000);
  assert.equal(h.applied.length, 0);
  assert.equal(h.safetyChecks(), initialChecks);
  assert.equal(h.timers.size, 0);
  assert.equal(h.refresh.getState().pending, false);

  h.document.hidden = false;
  h.refresh.resume();
  await h.advance(0);
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({ apps: [{ id: 'new.app' }] });
  await h.advance(0);
  assert.deepEqual(h.applied, [[{ id: 'new.app' }]]);
  h.refresh.destroy();
});
