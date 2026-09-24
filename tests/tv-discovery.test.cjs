'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sources = ['tv-discovery.js', 'tv-bridge.js'].map(name => fs.readFileSync(path.join(__dirname, '../app', name), 'utf8'));

function setup(overrides = {}) {
  const calls = [], bridges = [], timers = new Map();
  let timerId = 0;
  class PalmServiceBridge {
    constructor() { this.cancelled = false; bridges.push(this); }
    call(uri, payload) {
      calls.push({ uri, payload: JSON.parse(payload), bridge: this });
    }
    cancel() { this.cancelled = true; }
  }
  const window = {
    location: { protocol: 'file:', search: '' },
    navigator: { userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/79' },
    PalmSystem: { identifier: 'org.local.openxmb.c5 42' },
    PalmServiceBridge,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...overrides
  };
  sources.forEach(source => vm.runInNewContext(source, { window, Promise }));
  function respond(index, value) {
    calls[index].bridge.onservicecallback(typeof value === 'string' ? value : JSON.stringify(value));
  }
  return { window, calls, bridges, timers, respond, tv: window.C5TV };
}
const denial = { returnValue: false, errorCode: -1, errorText: 'Denied method call' };
function wrapped(response, fields = {}) {
  return { returnValue: true, returnCode: 0, stdoutString: JSON.stringify(response), stderrString: '', ...fields };
}
function start(h) {
  const result = h.tv.listApps();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].uri, 'luna://org.webosbrew.hbchannel.service/exec');
  return result;
}

test('standalone app reads its catalog directly through one fixed root command', async () => {
  const h = setup(), result = start(h);
  assert.deepEqual(h.calls[0].payload, {
    command: 'if [ "$(id -u)" = "0" ]; then exec /usr/bin/luna-send -n 1 -w 4000 luna://com.webos.applicationManager/listApps \'{}\'; else printf \'%s\\n\' \'{"returnValue":false,"errorCode":"root_required"}\'; fi'
  });
  h.respond(0, wrapped({ returnValue: true, apps: [
    { id: 'plex.app', title: 'Plex\u0000', icon: '/media/app/icon.png', type: 'web', visible: true },
    { id: 'plex.app', title: 'Duplicate', visible: true },
    { id: 'netflix', icon: 'https://tracking.example/icon.png', visible: true },
    { id: 'hidden.app', visible: false }, { id: 'unsafe;id', visible: true }
  ] }));
  const response = await result;
  assert.equal(response.ok, true);
  assert.equal(response.preview, false);
  assert.equal(response.apps.length, 2);
  assert.equal(response.apps[0].title, 'Plex');
  assert.equal(response.apps[1].icon, '');
  assert.ok(h.bridges.every(bridge => bridge.cancelled));
  assert.equal(h.timers.size, 0);
});

test('Home identity reads native inventory without Homebrew or retries', async () => {
  for (const [method, uri, field] of [
    ['listApps', 'luna://com.webos.applicationManager/listApps', 'apps'],
    ['listInputs', 'luna://com.webos.service.eim/getAllInputStatus', 'devices']
  ]) {
    const h = setup({PalmSystem:{identifier:'com.webos.app.home 1'}});
    const result = h.window.LGXMBDiscovery[method]();
    assert.equal(h.calls[0].uri, uri);
    assert.deepEqual(h.calls[0].payload, {});
    h.respond(0, {returnValue:true, [field]:[]});
    assert.equal((await result)[field].length, 0);
    assert.equal(h.calls.length, 1);
    const failed = h.window.LGXMBDiscovery[method]();
    h.respond(1, denial);
    await assert.rejects(failed, error => error.code === 'SERVICE_ERROR');
    assert.equal(h.calls.length, 2);
  }
});

test('unrelated identities never send privileged inventory requests', async () => {
  for (const identifier of ['other.app 1', 'org.local.openxmb.c5.fake 1']) {
    const h = setup({PalmSystem:{identifier}});
    await assert.rejects(h.tv.listApps(), error => error.code === 'EXEC_UNAVAILABLE');
    await assert.rejects(h.window.LGXMBDiscovery.listInputs(), error => error.code === 'EXEC_UNAVAILABLE');
    assert.equal(h.calls.length, 0);
  }
});

test('webOSSystem standalone identity works and browser previews never call Homebrew', async () => {
  const h = setup({ PalmSystem: undefined, webOSSystem: { identifier: 'org.local.openxmb.c5 2' } });
  const result = start(h);
  h.respond(0, wrapped({ returnValue: true, apps: [] }));
  await result;
  for (const overrides of [
    { location: { protocol: 'http:', search: '' } },
    { location: { protocol: 'file:', search: '?preview=1' } },
    { PalmServiceBridge: undefined }, { navigator: { userAgent: 'Desktop Chrome' } }
  ]) {
    const preview = setup(overrides);
    assert.equal((await preview.tv.listApps()).preview, true);
    await assert.rejects(preview.window.LGXMBDiscovery.listApps());
    assert.equal(preview.calls.length, 0);
  }
});

test('native inventory response validation rejects malformed data without retry', async () => {
  for (const response of [
    '{}', 'null', '[]', 'not-json', '{"returnValue":"false"}',
    { returnValue: true, errorCode: -1 }, { returnValue: true, apps: {} },
    { returnValue: true, apps: new Array(1001).fill(null) }, ' '.repeat(2 * 1024 * 1024 + 1)
  ]) {
    const h = setup({PalmSystem:{identifier:'com.webos.app.home 1'}});
    const result = h.tv.listApps();
    h.respond(0, response);
    await assert.rejects(result, error => error.code === 'INVALID_RESPONSE');
    assert.equal(h.calls.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('cancellation releases the active discovery bridge and ignores late replies', async () => {
  for (const identifier of ['org.local.openxmb.c5 1', 'com.webos.app.home 1']) {
    const h = setup({PalmSystem:{identifier}});
    const result = h.tv.listApps(), late = h.bridges[0].onservicecallback;
    result.cancel();
    result.cancel();
    await assert.rejects(result, error => error.code === 'CANCELLED');
    late(JSON.stringify(wrapped({ returnValue: true, apps: [] })));
    assert.equal(h.bridges[0].cancelled, true);
    assert.equal(h.timers.size, 0);
    assert.equal(h.calls.length, 1);
  }
});

test('both transports time out once and cancel their bridge', async () => {
  for (const [identifier, delay] of [['org.local.openxmb.c5 1',6500], ['com.webos.app.home 1',5000]]) {
    const h = setup({PalmSystem:{identifier}});
    const result = h.tv.listApps(), timeout = [...h.timers.values()][0];
    assert.equal(timeout.delay, delay);
    timeout.fn();
    await assert.rejects(result, error => error.code === 'TIMEOUT');
    assert.equal(h.bridges[0].cancelled, true);
    assert.equal(h.timers.size, 0);
    assert.equal(h.calls.length, 1);
  }
});

test('root access and execution errors are explicit rather than an empty catalog', async () => {
  for (const [response, code] of [
    [wrapped({ returnValue: false, errorCode: 'root_required' }), 'ROOT_REQUIRED'],
    [wrapped({ returnValue: false, errorCode: -1 }), 'SERVICE_ERROR'],
    [{ returnValue: false, errorText: 'Service not found' }, 'EXEC_UNAVAILABLE'],
    [wrapped({ returnValue: true, apps: [] }, { returnCode: 1 }), 'EXEC_UNAVAILABLE'],
    [wrapped({ returnValue: true, apps: [] }, { stderrString: 'not allowed' }), 'EXEC_UNAVAILABLE'],
    [wrapped({ returnValue: true, apps: [] }, { errorCode: 2 }), 'EXEC_UNAVAILABLE'],
    [wrapped({ returnValue: true, apps: [] }, { error: 'failed' }), 'EXEC_UNAVAILABLE']
  ]) {
    const h = setup(), result = start(h);
    h.respond(0, response);
    await assert.rejects(result, error => error.code === code);
    assert.equal(h.timers.size, 0);
    assert.equal(h.calls.length, 1);
  }
});

test('root discovery enforces bounded valid envelopes and catalog shape', async () => {
  for (const response of [
    'not-json', 'null', '[]', ' '.repeat(2 * 1024 * 1024 + 1),
    wrapped(null), wrapped([]), wrapped({}),
    wrapped({ returnValue: true, apps: {} }),
    wrapped({ returnValue: true, apps: new Array(1001).fill(null) }),
    wrapped({ returnValue: true, apps: [], errorCode: -1 }),
    wrapped({ returnValue: true, apps: [] }, { stdoutString: {} }),
    wrapped({ returnValue: true, apps: [] }, { stdoutString: 'broken' })
  ]) {
    const h = setup(), result = start(h);
    h.respond(0, response);
    await assert.rejects(result, error => error.code === 'INVALID_RESPONSE');
    assert.equal(h.timers.size, 0);
  }
});

test('input discovery uses only its fixed EIM read and preserves device metadata', async () => {
  const h = setup();
  const result = h.window.LGXMBDiscovery.listInputs();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].uri, 'luna://org.webosbrew.hbchannel.service/exec');
  assert.equal(h.calls[0].payload.command,
    'if [ "$(id -u)" = "0" ]; then exec /usr/bin/luna-send -n 1 -w 4000 luna://com.webos.service.eim/getAllInputStatus \'{}\'; else printf \'%s\\n\' \'{"returnValue":false,"errorCode":"root_required"}\'; fi');
  h.respond(0, wrapped({ returnValue: true, devices: [
    { id: 'HDMI_1', appId: 'com.webos.app.hdmi1', label: 'Console', connected: true },
    { id: 'AV_1', appId: 'com.webos.app.externalinput.av1', connected: false }
  ] }));
  const response = await result;
  assert.equal(response.devices.length, 2);
  assert.equal(response.devices[0].connected, true);
  assert.equal(response.devices[1].appId, 'com.webos.app.externalinput.av1');
  assert.equal(h.timers.size, 0);
});

test('input discovery bounds its array and rejects application lists in its place', async () => {
  for (const response of [
    { returnValue: true, apps: [] },
    { returnValue: true, devices: {} },
    { returnValue: true, devices: new Array(129).fill(null) }
  ]) {
    const h = setup();
    const result = h.window.LGXMBDiscovery.listInputs();
    h.respond(0, wrapped(response));
    await assert.rejects(result, error => error.code === 'INVALID_RESPONSE');
    assert.equal(h.timers.size, 0);
  }
});
