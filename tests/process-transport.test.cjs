'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/process-transport.js'), 'utf8');
function setup(overrides = {}) {
  const calls = [], bridges = [], timers = new Map(); let next = 0;
  class PalmServiceBridge {
    constructor() { bridges.push(this); }
    call(uri, body) { calls.push({ uri, body: JSON.parse(body), bridge: this }); }
    cancel() { this.cancelled = true; }
  }
  const window = {
    C5TV: { isTV: () => true }, PalmServiceBridge, LGXMBHelper: {isReady: () => true},
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, ...overrides
  };
  vm.runInNewContext(source, { window, Promise });
  function raw(index, value) { calls[index].bridge.onservicecallback(typeof value === 'string' ? value : JSON.stringify(value)); }
  function reply(index, value = state(), outer = {}) {
    raw(index, { returnValue: true, stdoutString: JSON.stringify(value), stderrString: '', ...outer });
  }
  return { adapter: window.C5ProcessAdapter, window, calls, bridges, timers, raw, reply };
}
function state(extra = {}) {
  return { returnValue: true, available: true, revision: 3, items: [
    { id: 'home', title: 'LG Home', group: 'apps', description: '', enabled: true, supported: true, status: 'Closed' },
    { id: 'usage', title: 'Usage activity', group: 'privacy', description: '', enabled: false, supported: true, status: '' }
  ], ...extra };
}

test('desktop, missing native identity and hosted preview do not install a native adapter', () => {
  for (const C5TV of [undefined, { isTV: () => false }, { isTV() { throw Error('identity unavailable'); } }]) {
    const h = setup({ C5TV });
    assert.equal(h.adapter, undefined); assert.equal(h.bridges.length, 0); assert.equal(h.timers.size, 0);
  }
});

test('fixed get and set commands use only the existing exec service and bounded waits', async () => {
  const h = setup();
  const get = h.adapter.getState();
  assert.equal(h.calls[0].uri, 'luna://org.webosbrew.hbchannel.service/exec');
  assert.deepEqual(h.calls[0].body, { command: '/usr/bin/python3 -I -B /media/developer/apps/usr/palm/applications/org.local.openxmb.c5/helper/process_control.py get' });
  assert.equal([...h.timers.values()][0].delay, 8000);
  h.reply(0); assert.equal((await get).revision, 3);
  const set = h.adapter.setEnabled('usage', true, 3);
  assert.deepEqual(h.calls[1].body, { command: '/usr/bin/python3 -I -B /media/developer/apps/usr/palm/applications/org.local.openxmb.c5/helper/process_control.py set usage 1 3' });
  h.reply(1, state({ revision: 4 })); assert.equal((await set).revision, 4);
  assert.equal(h.timers.size, 0); assert.ok(h.bridges.every(b => b.cancelled));
  assert.equal(Object.keys(h.adapter).sort().join(','), 'getState,prepareLaunch,setEnabled');
});

test('The codes the helper actually raises get their own message, not the generic one', async () => {
  // Both reply paths used to map `revision_conflict`, which process_control.py
  // has never raised, so a real stale revision read as a plain service error.
  const h=setup();
  const stale=h.adapter.setEnabled('home',true,3);
  h.reply(0,{returnValue:false,errorCode:'stale_revision'});
  await assert.rejects(stale,e=>e.code==='CONFLICT'&&/refresh/i.test(e.message));
  const busy=h.adapter.setEnabled('home',true,3);
  h.reply(1,{returnValue:false,errorCode:'busy'});
  await assert.rejects(busy,e=>e.code==='BUSY'&&/another settings change/i.test(e.message));
});

test('all catalogue keys can use only their fixed spelling and boolean literal', async () => {
  const h = setup();
  for (const key of ['home', 'browser', 'search', 'hdmi1', 'hdmi2', 'hdmi3', 'hdmi4', 'livetv', 'usage', 'ads', 'voice']) {
    const i = h.calls.length, operation = h.adapter.setEnabled(key, false, Number.MAX_SAFE_INTEGER);
    assert.equal(h.calls[i].body.command, '/usr/bin/python3 -I -B /media/developer/apps/usr/palm/applications/org.local.openxmb.c5/helper/process_control.py set ' + key + ' 0 9007199254740991');
    h.reply(i); await operation;
  }
});

test('shell syntax, unknown keys, wrong booleans and unsafe revisions never reach native code', async () => {
  const h = setup();
  for (const key of ['home;reboot', 'home\nreboot', '$(id)', '`id`', '--help', 'home ', 'HOME', '__proto__', 'com.webos.app.home', null, {}, '']) {
    await assert.rejects(h.adapter.setEnabled(key, true, 0), e => e.code === 'INVALID_CHOICE');
  }
  for (const value of [0, 1, 'true', '0', null, {}]) await assert.rejects(h.adapter.setEnabled('home', value, 0));
  for (const revision of [-1, 0.5, '0', '0;id', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, {}]) {
    await assert.rejects(h.adapter.setEnabled('home', true, revision), e => e.code === 'INVALID_REVISION');
  }
  assert.equal(h.bridges.length, 0); assert.equal(h.timers.size, 0);
});

test('service and command failures are normalized without exposing raw stderr', async () => {
  for (const outer of [
    { returnValue: false, errorText: 'private path details' }, { returnValue: true, errorCode: -1 },
    { returnValue: true, returnCode: 1 }, { returnValue: true, exitCode: '2' },
    { returnValue: true, error: 'private command details' }, { stderrString: 'private stderr details' }
  ]) {
    const h = setup(), operation = h.adapter.getState(); h.reply(0, state(), outer);
    await assert.rejects(operation, e => e.code === 'SERVICE_ERROR' && !e.message.includes('private'));
    assert.equal(h.timers.size, 0); assert.equal(h.bridges[0].cancelled, true);
  }
});

test('outer and inner responses reject malformed, oversized or contradictory payloads', async () => {
  for (const raw of ['not json', 'null', '[]', '{}', 'x'.repeat(65537)]) {
    const h = setup(), operation = h.adapter.getState(); h.raw(0, raw); await assert.rejects(operation);
  }
  for (const outer of [{ stdoutString: 'not json' }, { stdoutString: '[]' },
    { stdoutString: 'x'.repeat(32769) }, { stderrString: 'x'.repeat(4097) }, { stderrString: 42 }]) {
    const h = setup(), operation = h.adapter.getState(); h.reply(0, state(), outer);
    await assert.rejects(operation, e => e.code === 'INVALID_REPLY');
  }
  for (const value of [state({ returnValue: false }), state({ returnValue: undefined }), state({ errorCode: -2 }), state({ returnCode: 1 }), state({ available: false }),
    state({ revision: -1 }), state({ revision: '3' }), state({ items: [{ ...state().items[0], id: 'surface-manager' }] }),
    state({ items: [state().items[0], state().items[0]] }), state({ items: [{ ...state().items[0], supported: 'true' }] }),
    state({ items: [{ ...state().items[0], title: 'x'.repeat(101) }] })]) {
    const h = setup(), operation = h.adapter.getState(); h.reply(0, value); await assert.rejects(operation);
  }
});

test('timed-out writes are not retried and late callbacks cannot satisfy a newer request', async () => {
  const h = setup(), first = h.adapter.setEnabled('browser', true, 3);
  const late = h.bridges[0].onservicecallback;
  [...h.timers.values()][0].fn(); await assert.rejects(first, e => e.code === 'TIMEOUT');
  const second = h.adapter.getState();
  late(JSON.stringify({ returnValue: true, stdoutString: JSON.stringify(state({ revision: 999 })), stderrString: '' }));
  assert.equal(h.calls.length, 2); assert.equal(h.timers.size, 1);
  h.reply(1, state({ revision: 4 })); assert.equal((await second).revision, 4);
  assert.equal(h.timers.size, 0); assert.ok(h.bridges.every(b => b.cancelled));
});

test('explicit cancellation releases its native bridge and ignores stale callbacks', async () => {
  const h = setup(), operation = h.adapter.getState(); const late = h.bridges[0].onservicecallback;
  operation.cancel(); operation.cancel(); await assert.rejects(operation, e => e.code === 'CANCELLED');
  late(JSON.stringify({ returnValue: true, stdoutString: JSON.stringify(state()), stderrString: '' }));
  assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0); assert.equal(h.bridges[0].cancelled, true);
});

test('manual launch preparation uses a one-second best-effort request and never sends arbitrary apps', async () => {
  const h = setup();
  const first = h.adapter.prepareLaunch('com.webos.app.browser');
  assert.equal(h.calls[0].body.command, '/usr/bin/python3 -I -B /media/developer/apps/usr/palm/applications/org.local.openxmb.c5/helper/process_control.py prepare com.webos.app.browser');
  assert.equal([...h.timers.values()][0].delay, 1000);
  h.reply(0, { returnValue: true, prepared: true }); assert.equal((await first).prepared, true);
  const second = h.adapter.prepareLaunch('com.webos.app.home');
  [...h.timers.values()][0].fn(); assert.equal((await second).prepared, false);
  const third = h.adapter.prepareLaunch('com.webos.app.hdmi3'); third.cancel(); assert.equal((await third).prepared, false);
  for (const appId of ['netflix', 'voiceconductor', 'voice', 'com.webos.app.home;id', '../home', null, {}, '']) {
    assert.equal((await h.adapter.prepareLaunch(appId)).reason, 'not_managed');
  }
  assert.equal(h.calls.length, 3); assert.equal(h.timers.size, 0);
});

test('HDMI 1 and 2 use fixed launch preparation while the voice daemon has no launch command', async () => {
  const h = setup();
  for (const appId of ['com.webos.app.hdmi1', 'com.webos.app.hdmi2']) {
    const index = h.calls.length, operation = h.adapter.prepareLaunch(appId);
    assert.equal(h.calls[index].body.command, '/usr/bin/python3 -I -B /media/developer/apps/usr/palm/applications/org.local.openxmb.c5/helper/process_control.py prepare ' + appId);
    h.reply(index, { returnValue: true, prepared: true }); assert.equal((await operation).prepared, true);
  }
  const voice = h.adapter.setEnabled('voice', true, 3);
  assert.equal(h.calls[2].body.command, '/usr/bin/python3 -I -B /media/developer/apps/usr/palm/applications/org.local.openxmb.c5/helper/process_control.py set voice 1 3');
  h.reply(2); await voice;
  for (const id of ['voice', 'voiceconductor.service', 'com.webos.service.voiceconductor']) {
    assert.equal((await h.adapter.prepareLaunch(id)).prepared, false);
  }
  assert.equal(h.calls.length, 3); assert.equal(h.timers.size, 0);
});

test('native bridge construction/call failure and changed identity fail cleanly', async () => {
  for (const PalmServiceBridge of [class { constructor() { throw Error('private native detail'); } },
    class { call() { throw Error('private native detail'); } cancel() {} }]) {
    const h = setup({ PalmServiceBridge });
    await assert.rejects(h.adapter.getState(), e => e.code === 'UNAVAILABLE' && !e.message.includes('private'));
    assert.equal(h.timers.size, 0);
  }
  const h = setup(); h.window.C5TV.isTV = () => false;
  await assert.rejects(h.adapter.getState(), e => e.code === 'UNAVAILABLE'); assert.equal(h.bridges.length, 0);
});
