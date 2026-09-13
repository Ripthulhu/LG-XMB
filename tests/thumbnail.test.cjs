'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/thumbnail.js'), 'utf8');

function setup({ isTV = true, hidden = false, defaults = false } = {}) {
  let time = 100000;
  let nextTimer = 0;
  const timers = new Map();
  const staging = [];
  const assignments = [];
  const document = { hidden };
  class Image {
    constructor(staged = true) {
      this.hidden = false;
      this._src = '';
      this.onload = null;
      this.onerror = null;
      this.staged = staged;
      if (staged) staging.push(this);
    }
    set src(value) {
      this._src = value;
      if (this.staged) {
        assignments.push(value);
        assert.equal(staging.filter(image => image.src).length, 1, 'at most one staging load may remain active');
      }
    }
    get src() { return this._src; }
    removeAttribute(name) { if (name === 'src') this._src = ''; }
    getAttribute(name) { return name === 'src' ? this._src || null : null; }
  }
  function setTimeout(fn, delay) {
    const id = ++nextTimer;
    timers.set(id, { fn, delay, at: time + delay });
    return id;
  }
  function clearTimeout(id) { timers.delete(id); }
  function advance(ms) {
    const end = time + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id);
      time = timer.at;
      timer.fn();
    }
    time = end;
  }
  const image = new Image(false);
  const fallback = { hidden: false, textContent: 'Static icon' };
  const forbidden = () => { throw new Error('Thumbnail loader cannot call a native or network API'); };
  const window = { document, Image, setTimeout, clearTimeout, fetch: forbidden, PalmServiceBridge: forbidden,
    webOS: { service: { request: forbidden } } };
  vm.runInNewContext(source, { window, Date, Number });
  const options = { isTV: () => isTV, now: () => time };
  if (!defaults) Object.assign(options, { document, createImage: () => new Image(), setTimeout, clearTimeout });
  const thumbnail = new window.C5Thumbnail(image, fallback, options);
  return { thumbnail, image, fallback, document, staging, assignments, timers, advance };
}

function assertFallback(h, status) {
  assert.equal(h.thumbnail.getState().status, status);
  assert.equal(h.image.getAttribute('src'), null);
  assert.equal(h.image.hidden, true);
  assert.equal(h.fallback.hidden, false);
  assert.equal(h.fallback.textContent, 'Static icon');
}

test('desktop selections never create an image or access a local file', () => {
  const h = setup({ isTV: false, defaults: true });
  h.thumbnail.select(2);
  h.thumbnail.refresh();
  h.advance(120000);
  assertFallback(h, 'desktop');
  assert.equal(h.thumbnail.getState().port, 2);
  assert.equal(h.staging.length, 0);
  assert.equal(h.assignments.length, 0);
  assert.equal(h.timers.size, 0);
});

test('only strict HDMI integers construct one of the four fixed app-relative paths', () => {
  const h = setup({ defaults: true });
  for (const port of [1, 2, 3, 4]) {
    h.thumbnail.select(port);
    assert.match(h.staging.at(-1).src, new RegExp('^thumbnails/hdmi' + port + '\\.png\\?t=\\d+$'));
  }
  const allocated = h.staging.length;
  for (const invalid of [null, undefined, 0, 5, -1, 1.5, NaN, Infinity, '1', 'HDMI_1', {}, '../private.png', 'file:///etc/passwd']) {
    h.thumbnail.select(invalid);
    assertFallback(h, 'idle');
    assert.equal(h.thumbnail.getState().port, null);
    assert.equal(h.staging.length, allocated);
    assert.equal(h.timers.size, 0);
  }
  assert.equal(new Set(h.assignments.map(url => url.split('?t=')[1])).size, 4, 'rapid selections use distinct numeric cachebusters');
});

test('a loaded staged image becomes the current visible still and schedules one refresh', () => {
  const h = setup();
  h.thumbnail.select(1);
  assertFallback(h, 'loading');
  const staged = h.staging[0];
  const src = staged.src;
  staged.onload();
  assert.equal(h.thumbnail.getState().status, 'ready');
  assert.equal(h.image.src, src);
  assert.equal(h.image.hidden, false);
  assert.equal(h.fallback.hidden, true);
  assert.equal(staged.src, '');
  assert.equal(staged.onload, null);
  assert.equal(staged.onerror, null);
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [60000]);
  h.thumbnail.select(1);
  assert.equal(h.staging.length, 1, 'same selected port does not reload');
});

test('missing files and five-second timeouts retain a quiet icon and retry no sooner than a minute', () => {
  for (const failure of ['error', 'timeout']) {
    const h = setup();
    h.thumbnail.select(1);
    if (failure === 'error') h.staging[0].onerror();
    else {
      h.advance(4999);
      assert.equal(h.thumbnail.getState().status, 'loading');
      h.advance(1);
    }
    assertFallback(h, 'missing');
    assert.equal(h.staging[0].src, '');
    assert.equal(h.timers.size, 1);
    h.thumbnail.select(1);
    h.advance(59999);
    assert.equal(h.staging.length, 1);
    h.advance(1);
    assert.equal(h.staging.length, 2);
    assert.equal(h.thumbnail.getState().status, 'loading');
    assert.equal(h.timers.size, 1, 'only the new load deadline remains');
  }
});

test('refresh keeps the current still through failed updates and runs at most once per minute', () => {
  const h = setup();
  h.thumbnail.select(3);
  h.staging[0].onload();
  const oldSrc = h.image.src;
  h.advance(59999);
  assert.equal(h.staging.length, 1);
  h.advance(1);
  assert.equal(h.staging.length, 2);
  assert.equal(h.image.src, oldSrc);
  assert.equal(h.image.hidden, false);
  assert.notEqual(h.staging[1].src, oldSrc);
  h.staging[1].onerror();
  assert.equal(h.thumbnail.getState().status, 'ready');
  assert.equal(h.image.src, oldSrc);
  assert.equal(h.image.hidden, false);
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [60000]);
});

test('port changes clear the old still immediately and ignore obsolete loads and timers', () => {
  const h = setup();
  h.thumbnail.select(1);
  h.staging[0].onload();
  const oldRefresh = [...h.timers.values()][0].fn;
  h.thumbnail.refresh();
  const oldLoad = h.staging[1].onload;
  const oldError = h.staging[1].onerror;
  const oldDeadline = [...h.timers.values()][0].fn;
  h.thumbnail.select(2);
  assertFallback(h, 'loading');
  assert.equal(h.thumbnail.getState().port, 2);
  const currentSrc = h.staging[2].src;
  oldLoad(); oldError(); oldDeadline(); oldRefresh();
  assertFallback(h, 'loading');
  assert.equal(h.staging.length, 3);
  assert.equal(h.timers.size, 1);
  h.staging[2].onload();
  assert.equal(h.image.src, currentSrc);
  oldLoad();
  assert.equal(h.image.src, currentSrc);
});

test('pausing cancels loading and refresh timers while retaining the displayed still', () => {
  const h = setup();
  h.thumbnail.select(2);
  h.staging[0].onload();
  const oldSrc = h.image.src;
  h.thumbnail.refresh();
  const staleLoad = h.staging[1].onload;
  h.thumbnail.setPaused(true);
  assert.equal(h.thumbnail.getState().status, 'ready');
  assert.equal(h.image.src, oldSrc);
  assert.equal(h.image.hidden, false);
  assert.equal(h.staging[1].src, '');
  assert.equal(h.timers.size, 0);
  staleLoad();
  h.thumbnail.refresh();
  h.advance(120000);
  assert.equal(h.staging.length, 2);
  assert.equal(h.image.src, oldSrc);
  h.thumbnail.setPaused(false);
  assert.equal(h.staging.length, 3);
  assert.equal(h.thumbnail.getState().status, 'loading');
  assert.equal(h.image.src, oldSrc);
});

test('changing a paused selection removes the previous HDMI image without loading another', () => {
  const h = setup();
  h.thumbnail.select(1);
  h.staging[0].onload();
  h.thumbnail.setPaused(true);
  h.thumbnail.select(4);
  assertFallback(h, 'idle');
  assert.equal(h.thumbnail.getState().port, 4);
  assert.equal(h.staging.length, 1);
  assert.equal(h.timers.size, 0);
  h.thumbnail.setPaused(false);
  assert.match(h.staging[1].src, /\/hdmi4\.png\?t=\d+$/);
});

test('hidden documents suppress initial loads and clear pending or scheduled work', () => {
  const initial = setup({ hidden: true });
  initial.thumbnail.select(1);
  assertFallback(initial, 'idle');
  assert.equal(initial.staging.length, 0);
  assert.equal(initial.timers.size, 0);
  initial.document.hidden = false;
  initial.thumbnail.select(1);
  assert.equal(initial.staging.length, 1);
  initial.document.hidden = true;
  initial.staging[0].onload();
  assertFallback(initial, 'idle');
  assert.equal(initial.timers.size, 0);

  const h = setup();
  h.thumbnail.select(2);
  h.staging[0].onload();
  h.document.hidden = true;
  h.advance(60000);
  assert.equal(h.thumbnail.getState().status, 'ready');
  assert.equal(h.image.hidden, false);
  const oldSrc = h.image.src;
  assert.equal(h.staging.length, 1);
  assert.equal(h.timers.size, 0);
  h.document.hidden = false;
  h.thumbnail.refresh();
  assert.equal(h.staging.length, 2);
  const staleLoad = h.staging[1].onload;
  h.document.hidden = true;
  h.thumbnail.select(2);
  staleLoad();
  assert.equal(h.thumbnail.getState().status, 'ready');
  assert.equal(h.image.src, oldSrc);
  assert.equal(h.image.hidden, false);
  assert.equal(h.timers.size, 0);
});

test('suspending and returning keeps the last picture visible without hidden work or a blank refresh', () => {
  const h = setup();
  h.thumbnail.select(1);
  h.staging[0].onload();
  const src = h.image.src;
  h.thumbnail.refresh();
  const staleLoad = h.staging[1].onload;
  h.document.hidden = true;
  h.thumbnail.setPaused(true);
  h.thumbnail.select(1);
  staleLoad();
  h.advance(120000);
  assert.equal(h.image.src, src);
  assert.equal(h.image.hidden, false);
  assert.equal(h.staging.length, 2);
  assert.equal(h.timers.size, 0);
  h.document.hidden = false;
  h.thumbnail.select(1);
  h.thumbnail.setPaused(false);
  assert.equal(h.image.src, src);
  assert.equal(h.image.hidden, false);
  assert.equal(h.thumbnail.getState().status, 'loading');
  assert.equal(h.staging.length, 3);
  h.staging[2].onerror();
  assert.equal(h.image.src, src);
  assert.equal(h.image.hidden, false);
  h.thumbnail.select(2);
  assertFallback(h, 'loading');
});

test('destroy clears displayed and staged images permanently and ignores queued work', () => {
  for (const ready of [false, true]) {
    const h = setup();
    h.thumbnail.select(1);
    const staleLoad = h.staging[0].onload;
    if (ready) h.staging[0].onload();
    const staleTimer = [...h.timers.values()][0].fn;
    h.thumbnail.destroy();
    assertFallback(h, 'idle');
    assert.equal(h.thumbnail.getState().port, null);
    assert.equal(h.staging[0].src, '');
    assert.equal(h.timers.size, 0);
    staleLoad(); staleTimer();
    h.thumbnail.select(2);
    h.thumbnail.refresh();
    h.thumbnail.setPaused(false);
    h.thumbnail.destroy();
    h.advance(120000);
    assertFallback(h, 'idle');
    assert.equal(h.staging.length, 1);
    assert.equal(h.timers.size, 0);
  }
});
