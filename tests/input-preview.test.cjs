'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/input-preview.js'), 'utf8');

function setup({ isTV = true, hidden = false, defaultDocument = false, getInputStatus, defaultInputStatus } = {}) {
  let now = 0;
  let nextTimer = 0;
  let nativeCalls = 0;
  const timers = new Map();
  const videos = [];
  const sourceAssignments = [];
  const operations = [];
  const documentListeners = [];

  function setTimeout(fn, delay) {
    const id = ++nextTimer;
    timers.set(id, { fn, delay, at: now + delay });
    return id;
  }

  function clearTimeout(id) { timers.delete(id); }

  function advance(ms) {
    const until = now + ms;
    for (;;) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id);
      now = timer.at;
      timer.fn();
    }
    now = until;
  }

  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.nodeName = this.tagName;
      this.children = [];
      this.parentNode = null;
      this.attributes = new Map();
      this.listeners = new Map();
      this.className = '';
      this.dataset = {};
      this.style = {};
      this.hidden = false;
      this.textContent = '';
      this._src = '';
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, force) => {
          const include = force === undefined ? !this.classList.contains(name) : Boolean(force);
          this.classList[include ? 'add' : 'remove'](name);
          return include;
        }
      };
    }
    get firstChild() { return this.children[0] || null; }
    get lastChild() { return this.children.at(-1) || null; }
    get childNodes() { return this.children; }
    get parentElement() { return this.parentNode; }
    set src(value) {
      this._src = String(value);
      this.attributes.set('src', this._src);
      if (this.tagName === 'SOURCE') {
        const video = videos.at(-1);
        sourceAssignments.push({ src: this._src, muted: video?.muted, defaultMuted: video?.defaultMuted, volume: video?.volume });
      }
      operations.push([this.tagName, 'src', this._src]);
    }
    get src() { return this._src; }
    set innerHTML(value) {
      assert.equal(value, '', 'The fake DOM only supports clearing innerHTML');
      this.replaceChildren();
    }
    get innerHTML() { return ''; }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      this.children.push(child);
      child.parentNode = this;
      operations.push([child.tagName, 'attach']);
      return child;
    }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    removeChild(child) {
      assert.equal(child.parentNode, this);
      this.children.splice(this.children.indexOf(child), 1);
      child.parentNode = null;
      operations.push([child.tagName, 'detach']);
      return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    replaceChildren(...children) {
      [...this.children].forEach(child => this.removeChild(child));
      this.append(...children);
    }
    setAttribute(name, value) {
      if (name === 'src') this.src = value;
      else if (name === 'class') this.className = String(value);
      else this.attributes.set(name, String(value));
    }
    getAttribute(name) { return name === 'class' ? this.className : this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) {
      this.attributes.delete(name);
      if (name === 'src') this._src = '';
      operations.push([this.tagName, 'removeAttribute', name]);
    }
    matches(selector) {
      return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName.toLowerCase() === selector;
    }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    capture(type) {
      const listeners = [...(this.listeners.get(type) || [])];
      const propertyListener = this['on' + type];
      if (typeof propertyListener === 'function') listeners.push(propertyListener);
      return () => listeners.forEach(listener => listener.call(this, { type, target: this, currentTarget: this }));
    }
    dispatch(type) { this.capture(type)(); }
  }

  class Video extends Element {
    constructor() {
      super('video');
      this.readyState = 0;
      this.networkState = 0;
      this.paused = true;
      this.muted = false;
      this.defaultMuted = false;
      this.volume = 1;
      this.currentTime = 0;
      this.error = null;
      this.pauseCalls = 0;
      this.loadCalls = 0;
      this.loadSnapshots = [];
      this.playCalls = 0;
      this.playPromise = new Promise((resolve, reject) => {
        this.resolvePlay = resolve;
        this.rejectPlay = reject;
      });
      // Keep an intentionally rejected fake promise from masking a failed assertion.
      this.playPromise.catch(() => {});
    }
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
      operations.push(['VIDEO', 'pause']);
      if (this.onPause) this.onPause();
    }
    load() {
      this.loadCalls += 1;
      this.loadSnapshots.push({ src: this.src, sources: this.querySelectorAll('source').length });
      operations.push(['VIDEO', 'load']);
      if (this.onLoad) this.onLoad();
    }
    play() {
      this.playCalls += 1;
      this.paused = false;
      operations.push(['VIDEO', 'play']);
      return this.playPromise;
    }
  }

  const document = {
    hidden,
    get visibilityState() { return this.hidden ? 'hidden' : 'visible'; },
    createElement(tagName) {
      if (tagName.toLowerCase() === 'video') {
        const video = new Video();
        videos.push(video);
        return video;
      }
      return new Element(tagName);
    },
    addEventListener(...args) { documentListeners.push(args); },
    removeEventListener() {}
  };
  const slot = new Element('div');
  const media = new Element('div');
  media.className = 'input-preview-media';
  const placeholder = new Element('div');
  placeholder.className = 'input-preview-placeholder';
  slot.append(media, placeholder);
  function rejectNativeUse() { nativeCalls += 1; throw new Error('Native calls are forbidden in preview tests'); }
  const window = {
    document, setTimeout, clearTimeout,
    PalmServiceBridge: rejectNativeUse,
    webOS: { service: { request: rejectNativeUse } },
    addEventListener(...args) { documentListeners.push(args); },
    removeEventListener() {}
  };
  if (defaultInputStatus) window.C5TV = { getInputPreviewStatus: defaultInputStatus };
  vm.runInNewContext(source, { window, document, setTimeout, clearTimeout, Promise, console });
  assert.equal(typeof window.C5InputPreview, 'function');
  const options = { isTV: () => isTV, setTimeout, clearTimeout };
  if (!defaultDocument) options.document = document;
  if (getInputStatus) options.getInputStatus = getInputStatus;
  const preview = new window.C5InputPreview(slot, options);
  return { preview, slot, media, placeholder, document, videos, timers, advance, operations, sourceAssignments, documentListeners, nativeCalls: () => nativeCalls };
}

function begin(h, port = 1) {
  h.preview.select(port);
  h.advance(400);
  assert.equal(h.videos.length, 1);
  return h.videos[0];
}

function assertReleased(h, video, loadsBeforeRelease) {
  assert.ok(video.pauseCalls >= 1, 'release pauses the old video');
  assert.ok(video.loadCalls > loadsBeforeRelease, 'release reloads after removing the media source');
  assert.deepEqual(video.loadSnapshots.at(-1), { src: '', sources: 0 }, 'source removal precedes the release load');
  assert.equal(video.src, '');
  assert.equal(video.getAttribute('src'), null);
  assert.equal(video.querySelectorAll('source').length, 0);
  assert.equal(video.parentNode, null);
  assert.equal(h.media.querySelectorAll('video').includes(video), false);
}

async function settle() { await Promise.resolve(); await Promise.resolve(); }

function signalProvider({ rejectOnCancel = false } = {}) {
  const calls = [];
  function getInputStatus(port) {
    const call = { port, cancelCalls: 0 };
    call.promise = new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
    call.promise.cancel = () => {
      call.cancelCalls += 1;
      if (rejectOnCancel) call.reject(new Error('Signal request cancelled'));
    };
    calls.push(call);
    return call.promise;
  }
  return { getInputStatus, calls };
}

test('desktop selection shows its placeholder without timers, media or native calls', () => {
  const h = setup({ isTV: false, defaultDocument: true });
  h.preview.select(2);
  h.advance(30000);
  assert.equal(h.preview.getState().status, 'desktop');
  assert.equal(h.preview.getState().port, 2);
  assert.equal(h.preview.getState().video, null);
  assert.equal(h.timers.size, 0);
  assert.equal(h.videos.length, 0);
  assert.equal(h.nativeCalls(), 0);
  assert.equal(h.slot.hidden, false);
  assert.equal(h.placeholder.hidden, false);
});

test('invalid ports never create external media', () => {
  for (const port of [0, 5, -1, 1.5, NaN, Infinity, '1', 'HDMI_1', undefined, {}, []]) {
    const h = setup();
    h.preview.select(port);
    h.advance(30000);
    assert.equal(h.videos.length, 0, 'invalid port ' + String(port));
    assert.equal(h.timers.size, 0);
    assert.equal(h.nativeCalls(), 0);
    assert.equal(h.preview.getState().status, 'idle');
    assert.equal(h.preview.getState().port, null);
  }
});

test('each HDMI port uses one muted video and one external-service source', () => {
  for (const port of [1, 2, 3, 4]) {
    const h = setup();
    const video = begin(h, port);
    assert.equal(h.media.querySelectorAll('video').length, 1);
    assert.equal(video.querySelectorAll('source').length, 1);
    const input = video.querySelector('source');
    assert.equal(input.src, 'ext://hdmi:' + port);
    assert.equal(input.type || input.getAttribute('type'), 'service/webos-external');
    assert.deepEqual(h.sourceAssignments, [{ src: 'ext://hdmi:' + port, muted: true, defaultMuted: true, volume: 0 }]);
    assert.equal(video.muted, true);
    assert.equal(video.defaultMuted, true);
    assert.equal(video.volume, 0);
    assert.equal(h.nativeCalls(), 0);
    h.preview.destroy();
  }
});

test('rapid changes restart the debounce and open only the final port', () => {
  const h = setup();
  h.preview.select(1);
  h.advance(200);
  h.preview.select(2);
  h.advance(200);
  h.preview.select(4);
  h.advance(399);
  assert.equal(h.videos.length, 0);
  assert.equal(h.timers.size, 1);
  h.advance(1);
  assert.equal(h.videos.length, 1);
  assert.equal(h.videos[0].querySelector('source').src, 'ext://hdmi:4');
  assert.equal(h.preview.getState().port, 4);
});

test('same selection is idempotent during debounce and active playback', () => {
  const h = setup();
  h.preview.select(1);
  h.advance(250);
  h.preview.select(1);
  h.advance(150);
  assert.equal(h.videos.length, 1, 'same selection does not postpone the initial debounce');
  const video = h.videos[0];
  video.dispatch('playing');
  h.preview.select(1);
  h.advance(10000);
  assert.equal(h.videos.length, 1);
  assert.equal(video.pauseCalls, 0);
  assert.equal(h.preview.getState().status, 'playing');
});

test('a stale debounce callback cannot erase the current timer handle', () => {
  const h = setup();
  h.preview.select(1);
  const staleStart = [...h.timers.values()][0].fn;
  h.preview.select(2);
  staleStart();
  assert.equal(h.videos.length, 0);
  assert.equal(h.preview.getState().port, 2);
  h.preview.stop();
  assert.equal(h.timers.size, 0, 'stop still cancels the replacement selection timer');
});

test('changing ports hides immediately, releases after 400 ms, and replaces after 650 ms', () => {
  const h = setup();
  const first = begin(h);
  const oldLoadCount = first.loadCalls;
  h.preview.select(3);
  assert.equal(first.hidden, true);
  assert.equal(first.pauseCalls, 0);
  assert.equal(first.loadCalls, oldLoadCount);
  assert.equal(first.querySelectorAll('source').length, 1);
  assert.equal(first.parentNode, h.media);
  assert.equal(h.preview.getState().retiring, true);
  assert.equal(h.preview.getState().video, null);
  assert.equal(h.preview.getState().port, 3);
  assert.equal(h.timers.size, 2);
  h.advance(399);
  assert.equal(h.videos.length, 1);
  assert.equal(first.pauseCalls, 0);
  h.advance(1);
  assertReleased(h, first, oldLoadCount);
  assert.equal(h.preview.getState().retiring, false);
  assert.equal(h.media.querySelectorAll('video').length, 0);
  h.advance(249);
  assert.equal(h.videos.length, 1);
  h.advance(1);
  assert.equal(h.videos.length, 2);
  assert.equal(h.media.querySelectorAll('video').length, 1);
  assert.equal(h.videos[1].querySelector('source').src, 'ext://hdmi:3');
});

test('rapid navigation resets retirement while retaining only one media pipeline', () => {
  const h = setup();
  const first = begin(h);
  first.dispatch('playing');
  const oldLoadCount = first.loadCalls;
  const createElement = h.document.createElement;
  h.document.createElement = tag => {
    if (tag === 'video') {
      assert.equal(first.parentNode, null, 'retired video is detached before replacement allocation');
      assert.equal(first.querySelectorAll('source').length, 0, 'old pipeline is reset before replacement allocation');
    }
    return createElement(tag);
  };
  h.preview.select(2);
  h.advance(200);
  h.preview.select(null);
  h.advance(200);
  h.preview.select(3);
  h.advance(399);
  assert.equal(h.videos.length, 1);
  assert.equal(h.media.querySelectorAll('video').length, 1);
  assert.equal(first.hidden, true);
  assert.equal(first.pauseCalls, 0, 'each new navigation extends the cleanup deadline');
  assert.equal(h.preview.getState().retiring, true);
  h.advance(1);
  assertReleased(h, first, oldLoadCount);
  assert.equal(h.preview.getState().retiring, false);
  h.advance(249);
  assert.equal(h.videos.length, 1);
  h.advance(1);
  assert.equal(h.videos.length, 2);
  assert.equal(h.media.querySelectorAll('video').length, 1);
  assert.equal(h.videos[1].querySelector('source').src, 'ext://hdmi:3');
});

test('repeated null navigation extends retirement without starting another video', () => {
  const h = setup();
  const first = begin(h);
  const oldLoadCount = first.loadCalls;
  h.preview.select(null);
  h.advance(250);
  h.preview.select(null);
  h.advance(399);
  assert.equal(first.pauseCalls, 0);
  assert.equal(h.preview.getState().retiring, true);
  assert.equal(h.preview.getState().status, 'idle');
  h.advance(1);
  assertReleased(h, first, oldLoadCount);
  assert.equal(h.preview.getState().retiring, false);
  h.advance(30000);
  assert.equal(h.videos.length, 1);
  assert.equal(h.timers.size, 0);
});

test('queued old cleanup cannot release a replacement or its later retirement', () => {
  const h = setup();
  const first = begin(h);
  h.preview.select(2);
  const oldCleanup = [...h.timers.values()].find(timer => timer.delay === 400).fn;
  h.advance(650);
  const second = h.videos[1];
  second.dispatch('playing');
  const playingState = JSON.stringify(h.preview.getState());
  const oldPauseCalls = first.pauseCalls;
  oldCleanup();
  assert.equal(JSON.stringify(h.preview.getState()), playingState);
  assert.equal(second.pauseCalls, 0);
  assert.equal(second.parentNode, h.media);
  assert.equal(first.pauseCalls, oldPauseCalls, 'old cleanup is not run twice');
  h.preview.select(3);
  oldCleanup();
  assert.equal(second.pauseCalls, 0, 'old callback cannot flush the newly retired video');
  assert.equal(h.preview.getState().retiring, true);
  assert.equal(h.timers.size, 2, 'old callback preserves both current navigation timer handles');
  h.preview.stop();
  assert.equal(h.timers.size, 0);
});

test('replacement startup flushes retirement when its cleanup callback is delayed', () => {
  const h = setup();
  const first = begin(h);
  const oldLoadCount = first.loadCalls;
  h.preview.select(2);
  const [cleanupId, cleanup] = [...h.timers.entries()].find(([, timer]) => timer.delay === 400);
  // Simulate an old cleanup task held in the browser queue past replacement startup.
  h.timers.delete(cleanupId);
  const createElement = h.document.createElement;
  h.document.createElement = tag => {
    if (tag === 'video') assertReleased(h, first, oldLoadCount);
    return createElement(tag);
  };
  h.advance(649);
  assert.equal(first.pauseCalls, 0);
  assert.equal(h.preview.getState().retiring, true);
  h.advance(1);
  assertReleased(h, first, oldLoadCount);
  assert.equal(h.preview.getState().retiring, false);
  assert.equal(h.videos.length, 2);
  const second = h.videos[1];
  second.dispatch('playing');
  const currentState = JSON.stringify(h.preview.getState());
  cleanup.fn();
  assert.equal(JSON.stringify(h.preview.getState()), currentState);
  assert.equal(second.parentNode, h.media);
  assert.equal(second.pauseCalls, 0);
  assert.equal(h.media.querySelectorAll('video').length, 1);
});

test('stop, destroy and hidden selection immediately flush retirement and prevent queued starts', () => {
  for (const operation of ['stop', 'destroy', 'hide']) {
    const h = setup();
    const first = begin(h);
    const oldLoadCount = first.loadCalls;
    h.preview.select(2);
    h.advance(200);
    const staleCallbacks = [...h.timers.values()].map(timer => timer.fn);
    if (operation === 'hide') {
      h.document.hidden = true;
      h.preview.select(3);
    } else h.preview[operation]();
    assertReleased(h, first, oldLoadCount);
    assert.equal(h.preview.getState().retiring, false);
    assert.equal(h.preview.getState().status, 'idle');
    assert.equal(h.preview.getState().port, null);
    assert.equal(h.timers.size, 0);
    staleCallbacks.forEach(callback => callback());
    h.advance(30000);
    assert.equal(h.videos.length, 1);
    assert.equal(h.media.querySelectorAll('video').length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test('navigation invalidates media and signal callbacks before deferred cleanup begins', async () => {
  const provider = signalProvider();
  const h = setup({ getInputStatus: provider.getInputStatus });
  const first = begin(h);
  first.dispatch('playing');
  h.advance(8000);
  const request = provider.calls[0];
  const staleError = first.capture('error');
  const stalePlaying = first.capture('playing');
  h.preview.select(2);
  const retiringState = JSON.stringify(h.preview.getState());
  assert.equal(request.cancelCalls, 1, 'pending status reads are canceled during navigation');
  assert.equal(first.pauseCalls, 0, 'native teardown has not started');
  staleError();
  stalePlaying();
  first.rejectPlay(new Error('Late playback rejection'));
  request.resolve({ port: 1, signal: false });
  await settle();
  assert.equal(JSON.stringify(h.preview.getState()), retiringState);
  assert.equal(first.pauseCalls, 0);
  assert.equal(h.timers.size, 2);
  h.preview.stop();
});

test('old event callbacks and rejected play promises cannot fail a new selection', async () => {
  const h = setup();
  const first = begin(h);
  const staleError = first.capture('error');
  const stalePlaying = first.capture('playing');
  const staleSourceError = first.querySelector('source').capture('error');
  const staleDeadline = [...h.timers.values()].find(timer => timer.delay === 8000)?.fn;
  h.preview.select(2);
  h.advance(650);
  const second = h.videos[1];
  second.dispatch('playing');
  const currentState = JSON.stringify(h.preview.getState());
  staleError();
  stalePlaying();
  staleSourceError();
  if (staleDeadline) staleDeadline();
  first.rejectPlay(new Error('obsolete playback denial'));
  await settle();
  assert.equal(JSON.stringify(h.preview.getState()), currentState);
  assert.equal(second.pauseCalls, 0);
  assert.equal(second.parentNode, h.media);
});

test('cleanup invalidates callbacks and timers before pause can emit an event', () => {
  const h = setup();
  const first = begin(h);
  const staleError = first.capture('error');
  const staleDeadline = [...h.timers.values()].find(timer => timer.delay === 8000);
  assert.ok(staleDeadline, 'loading is bounded by a deadline');
  first.onPause = () => {
    assert.equal([...h.timers.values()].includes(staleDeadline), false, 'old loading timer is canceled before cleanup');
    staleError();
    staleDeadline.fn();
  };
  h.preview.select(4);
  assert.equal(h.preview.getState().port, 4);
  assert.notEqual(h.preview.getState().status, 'unavailable');
  assert.equal(first.pauseCalls, 0);
  h.advance(650);
  assert.equal(h.videos.length, 2);
  assert.equal(h.videos[1].querySelector('source').src, 'ext://hdmi:4');
});

test('video errors, source errors and rejected play release failed media without retrying', async () => {
  for (const failure of ['video', 'source', 'play']) {
    const h = setup();
    const video = begin(h);
    const oldLoadCount = video.loadCalls;
    if (failure === 'video') {
      video.error = { code: 4, message: 'External media unavailable' };
      video.dispatch('error');
    } else if (failure === 'source') video.querySelector('source').dispatch('error');
    else {
      assert.ok(video.playCalls > 0, 'controller requests playback');
      video.rejectPlay(new Error('Playback denied'));
      await settle();
    }
    assert.equal(h.preview.getState().status, 'unavailable', failure);
    assert.equal(h.preview.getState().port, 1);
    assert.equal(h.preview.getState().video, null);
    assert.equal(typeof h.preview.getState().error, 'string');
    assert.ok(h.preview.getState().error.length > 0);
    assertReleased(h, video, oldLoadCount);
    assert.equal(h.timers.size, 0);
    h.preview.select(1);
    h.advance(30000);
    assert.equal(h.videos.length, 1, 'same failed port does not retry');
    assert.equal(h.preview.getState().status, 'unavailable');
    h.preview.stop();
    h.preview.select(1);
    h.advance(400);
    assert.equal(h.videos.length, 2, 'explicit stop permits a later fresh selection');
  }
});

test('loading deadline is eight seconds after allocation and releases the media', () => {
  const h = setup();
  const video = begin(h);
  const oldLoadCount = video.loadCalls;
  h.advance(7999);
  assert.equal(h.preview.getState().status, 'loading');
  h.advance(1);
  assert.equal(h.preview.getState().status, 'unavailable');
  assert.equal(h.preview.getState().video, null);
  assertReleased(h, video, oldLoadCount);
  assert.equal(h.timers.size, 0);
});

test('readiness events cancel the loading deadline even when media counters stay at zero', () => {
  for (const event of ['loadeddata', 'canplay', 'playing']) {
    const h = setup();
    const video = begin(h);
    video.readyState = 0;
    video.currentTime = 0;
    video.dispatch(event);
    h.advance(30000);
    assert.notEqual(h.preview.getState().status, 'unavailable', event);
    assert.equal(video.pauseCalls, 0);
    assert.equal(video.parentNode, h.media);
    assert.equal(h.timers.size, 0);
    if (event === 'playing') assert.equal(h.preview.getState().status, 'playing');
  }
});

test('the loading deadline accepts available frame data when readiness events are absent', () => {
  const h = setup();
  const video = begin(h);
  video.readyState = 2;
  h.advance(8000);
  assert.equal(h.preview.getState().status, 'playing');
  assert.equal(h.timers.size, 0);
  assert.equal(video.pauseCalls, 0);
  assert.equal(video.parentNode, h.media);
});

test('waiting and stalled events do not fail or release an external live stream', () => {
  const h = setup();
  const video = begin(h);
  for (const event of ['waiting', 'stalled']) {
    video.dispatch(event);
    assert.notEqual(h.preview.getState().status, 'unavailable');
    assert.equal(video.pauseCalls, 0);
  }
  video.dispatch('playing');
  video.dispatch('stalled');
  video.dispatch('waiting');
  h.advance(30000);
  assert.notEqual(h.preview.getState().status, 'unavailable');
  assert.equal(video.parentNode, h.media);
  assert.equal(video.pauseCalls, 0);
  const state = h.preview.getState();
  assert.equal(state.port, 1);
  assert.equal(state.video.readyState, 0);
  assert.equal(state.video.networkState, 0);
  assert.equal(state.video.currentTime, 0);
  assert.equal(state.video.paused, false);
  assert.equal(state.video.muted, true);
});

test('hidden documents do not allocate media, including when hidden during debounce', () => {
  for (const hiddenInitially of [true, false]) {
    const h = setup({ hidden: hiddenInitially });
    h.preview.select(2);
    h.document.hidden = true;
    h.advance(30000);
    assert.equal(h.videos.length, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.documentListeners.length, 0, 'the app owns lifecycle event listeners');
  }
});

test('null selection defers active cleanup while stop always clears it immediately', () => {
  for (const active of [false, true]) {
    for (const navigation of [false, true]) {
      const h = setup();
      h.preview.select(1);
      if (active) h.advance(400);
      const video = h.videos[0];
      const oldLoadCount = video?.loadCalls;
      const staleCallbacks = [...h.timers.values()].map(timer => timer.fn);
      if (navigation) h.preview.select(null);
      else h.preview.stop();
      assert.equal(h.preview.getState().status, 'idle');
      assert.equal(h.preview.getState().port, null);
      assert.equal(h.preview.getState().video, null);
      assert.equal(h.preview.getState().error, null);
      assert.equal(h.preview.getState().retiring, active && navigation);
      assert.equal(h.timers.size, active && navigation ? 1 : 0);
      if (active && navigation) {
        assert.equal(video.hidden, true);
        assert.equal(video.pauseCalls, 0);
        assert.equal(video.parentNode, h.media);
      } else if (video) assertReleased(h, video, oldLoadCount);
      staleCallbacks.forEach(callback => callback());
      h.advance(30000);
      if (video) assertReleased(h, video, oldLoadCount);
      assert.equal(h.preview.getState().retiring, false);
      assert.equal(h.timers.size, 0);
      assert.equal(h.videos.length, active ? 1 : 0);
      assert.equal(h.preview.getState().status, 'idle');
    }
  }
});

test('destroy releases media and permanently prevents future selection', async () => {
  const h = setup();
  const video = begin(h);
  const oldLoadCount = video.loadCalls;
  const stalePlaying = video.capture('playing');
  h.preview.destroy();
  assertReleased(h, video, oldLoadCount);
  h.preview.select(2);
  h.preview.stop();
  h.preview.destroy();
  stalePlaying();
  video.rejectPlay(new Error('late failure after destruction'));
  await settle();
  h.advance(30000);
  assert.equal(h.videos.length, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.preview.getState().status, 'idle');
  assert.equal(h.preview.getState().port, null);
  assert.equal(h.preview.getState().video, null);
});

test('the signal check waits eight seconds after allocation, survives playing, and runs once', async () => {
  const provider = signalProvider();
  const h = setup({ getInputStatus: provider.getInputStatus });
  const video = begin(h, 3);
  video.readyState = 4;
  video.dispatch('playing');
  assert.equal(h.timers.size, 1, 'playing leaves exactly one signal grace timer');
  h.advance(7999);
  assert.equal(provider.calls.length, 0);
  h.advance(1);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].port, 3);
  assert.equal(h.timers.size, 0);
  provider.calls[0].resolve({ port: 3, signal: true });
  await settle();
  video.dispatch('loadeddata');
  video.dispatch('canplay');
  video.dispatch('playing');
  h.preview.select(3);
  h.advance(120000);
  assert.equal(provider.calls.length, 1, 'ready events and rerenders do not cause polling');
  assert.equal(video.pauseCalls, 0);
  assert.equal(h.preview.getState().status, 'playing');
});

test('the controller can use the default TV input status provider', async () => {
  const provider = signalProvider();
  const h = setup({ defaultInputStatus: provider.getInputStatus });
  const video = begin(h, 4);
  video.dispatch('playing');
  h.advance(8000);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].port, 4);
  provider.calls[0].resolve({ port: 4, signal: true });
  await settle();
  assert.equal(h.preview.getState().status, 'playing');
  assert.equal(h.nativeCalls(), 0);
});

test('explicit no-signal releases even a ready video that reported playing', async () => {
  const provider = signalProvider();
  const h = setup({ getInputStatus: provider.getInputStatus });
  const video = begin(h, 2);
  const oldLoadCount = video.loadCalls;
  video.readyState = 4;
  video.dispatch('playing');
  const stalePlaying = video.capture('playing');
  h.advance(8000);
  provider.calls[0].resolve({ port: 2, signal: false });
  await settle();
  assert.equal(h.preview.getState().status, 'unavailable');
  assert.equal(h.preview.getState().port, 2);
  assert.equal(h.preview.getState().error, 'no-signal');
  assert.equal(h.preview.getState().video, null);
  assertReleased(h, video, oldLoadCount);
  assert.equal(h.timers.size, 0);
  stalePlaying();
  h.preview.select(2);
  h.advance(120000);
  assert.equal(h.preview.getState().status, 'unavailable');
  assert.equal(h.videos.length, 1);
  assert.equal(provider.calls.length, 1, 'a failed same-port selection does not retry the signal check');
});

test('positive, unknown, rejected and mismatched signal results preserve playback without polling', async () => {
  for (const result of [{ port: 1, signal: true }, { port: 1, signal: null }, { port: 2, signal: false }, new Error('Signal status unavailable')]) {
    const provider = signalProvider();
    const h = setup({ getInputStatus: provider.getInputStatus });
    const video = begin(h);
    video.dispatch('playing');
    const stateBefore = JSON.stringify(h.preview.getState());
    h.advance(8000);
    if (result instanceof Error) provider.calls[0].reject(result);
    else provider.calls[0].resolve(result);
    await settle();
    h.advance(120000);
    assert.equal(JSON.stringify(h.preview.getState()), stateBefore);
    assert.equal(video.pauseCalls, 0);
    assert.equal(video.parentNode, h.media);
    assert.equal(provider.calls.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('a synchronous signal provider failure leaves playback alone and is not retried', () => {
  let calls = 0;
  const h = setup({ getInputStatus() { calls += 1; throw new Error('Provider unavailable'); } });
  const video = begin(h);
  video.dispatch('playing');
  h.advance(120000);
  assert.equal(calls, 1);
  assert.equal(h.preview.getState().status, 'playing');
  assert.equal(video.parentNode, h.media);
  assert.equal(video.pauseCalls, 0);
  assert.equal(h.timers.size, 0);
});

test('late no-signal responses cannot affect another port or a new generation of the same port', async () => {
  for (const returnToOriginalPort of [false, true]) {
    const provider = signalProvider();
    const h = setup({ getInputStatus: provider.getInputStatus });
    begin(h).dispatch('playing');
    h.advance(8000);
    const oldRequest = provider.calls[0];
    h.preview.select(2);
    h.advance(650);
    if (returnToOriginalPort) {
      h.preview.select(1);
      h.advance(650);
    }
    const currentVideo = h.videos.at(-1);
    currentVideo.dispatch('playing');
    const currentState = JSON.stringify(h.preview.getState());
    assert.equal(oldRequest.cancelCalls, 1);
    oldRequest.resolve({ port: 1, signal: false });
    await settle();
    assert.equal(JSON.stringify(h.preview.getState()), currentState);
    assert.equal(currentVideo.pauseCalls, 0);
    assert.equal(currentVideo.parentNode, h.media);
    assert.equal(h.timers.size, 1, 'old completion preserves the current grace timer');
    h.preview.stop();
    assert.equal(h.timers.size, 0);
  }
});

test('stop cancels a pending signal request and handles its late rejection', async () => {
  const provider = signalProvider({ rejectOnCancel: true });
  const h = setup({ getInputStatus: provider.getInputStatus });
  begin(h).dispatch('playing');
  h.advance(8000);
  const request = provider.calls[0];
  h.preview.stop();
  assert.equal(request.cancelCalls, 1);
  h.preview.select(2);
  h.advance(400);
  const currentVideo = h.videos[1];
  currentVideo.dispatch('playing');
  await settle();
  assert.equal(h.preview.getState().status, 'playing');
  assert.equal(h.preview.getState().port, 2);
  assert.equal(h.preview.getState().error, null);
  assert.equal(currentVideo.pauseCalls, 0);
  h.preview.stop();
  assert.equal(request.cancelCalls, 1, 'released requests are not canceled repeatedly');
  assert.equal(h.timers.size, 0);
});

test('hiding the app and stopping releases its pending check before a late response', async () => {
  const provider = signalProvider();
  const h = setup({ getInputStatus: provider.getInputStatus });
  const video = begin(h);
  video.dispatch('playing');
  h.advance(8000);
  const request = provider.calls[0];
  h.document.hidden = true;
  h.preview.stop();
  request.resolve({ port: 1, signal: false });
  await settle();
  h.advance(120000);
  assert.equal(request.cancelCalls, 1);
  assert.equal(h.preview.getState().status, 'idle');
  assert.equal(h.preview.getState().error, null);
  assert.equal(h.preview.getState().port, null);
  assert.equal(video.parentNode, null);
  assert.equal(provider.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

test('destroy cancels a scheduled or pending signal check and ignores stale callbacks', async () => {
  for (const requestStarted of [false, true]) {
    const provider = signalProvider({ rejectOnCancel: true });
    const h = setup({ getInputStatus: provider.getInputStatus });
    const video = begin(h);
    video.dispatch('playing');
    const staleSignalTimer = [...h.timers.values()][0].fn;
    if (requestStarted) h.advance(8000);
    const oldLoadCount = video.loadCalls;
    h.preview.destroy();
    assertReleased(h, video, oldLoadCount);
    assert.equal(h.timers.size, 0);
    staleSignalTimer();
    h.preview.select(3);
    await settle();
    h.advance(120000);
    assert.equal(provider.calls.length, requestStarted ? 1 : 0);
    if (requestStarted) assert.equal(provider.calls[0].cancelCalls, 1);
    assert.equal(h.preview.getState().status, 'idle');
    assert.equal(h.preview.getState().port, null);
    assert.equal(h.preview.getState().error, null);
    assert.equal(h.videos.length, 1);
    assert.equal(h.timers.size, 0);
  }
});
