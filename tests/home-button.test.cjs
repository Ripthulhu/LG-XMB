// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app/home-button.js', 'utf8');
const digest = 'a'.repeat(64);
function fixture(tv = true, environment = {}) {
  const calls = [], timers = new Map();
  let sequence = 0;
  const window = {
    C5TV: {isTV: () => tv},
    setTimeout(fn, delay) { timers.set(++sequence, {fn, delay}); return sequence; },
    clearTimeout(id) { timers.delete(id); },
    ...environment
  };
  window.PalmServiceBridge = class {
    call(uri, body) { calls.push({uri, ...JSON.parse(body), bridge: this}); }
    cancel() { this.cancelled = true; }
  };
  vm.runInNewContext(source, {window, Promise});
  function reply(index, value, envelope = {}) {
    calls[index].bridge.onservicecallback(JSON.stringify({returnValue:true,
      stdoutString: JSON.stringify(value), stderrString:'', ...envelope}));
  }
  const ready = (mode = 'stock') => ({returnValue:true, mode, available:true, revision:digest});
  return {api:window.LGXMBHomeButton, calls, timers, reply, ready};
}

test('opening Remote reads one fixed command without running capture setup', async () => {
  const h = fixture(), read = h.api.get();
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].command, /helper-startup\.py home-button get;/);
  assert.doesNotMatch(h.calls[0].command, /ensure|launch|capture|setDefaultApp/);
  h.reply(0, h.ready());
  assert.equal((await read).mode, 'stock');
  assert.equal(h.calls[0].bridge.cancelled, true);
  assert.equal(h.timers.size, 0);
});

test('setting requires a fresh snapshot and confirmed native reply', async () => {
  const h = fixture();
  await assert.rejects(h.api.set('xmb'), {code:'home_mapping_changed'});
  assert.equal(h.calls.length, 0);
  const read = h.api.get(); h.reply(0, h.ready()); await read;
  const write = h.api.set('xmb');
  assert.match(h.calls[1].command, new RegExp('home-button set xmb ' + digest + ';'));
  await assert.rejects(h.api.set('stock'), {code:'home_button_busy'});
  h.reply(1, h.ready('xmb'));
  assert.equal((await write).mode, 'xmb');
});

test('arbitrary targets and shell text cannot reach the command', async () => {
  for (const mode of ['com.other.home', 'stock;touch /tmp/bad', null, undefined]) {
    const h = fixture(), read = h.api.get(); h.reply(0, h.ready()); await read;
    await assert.rejects(h.api.set(mode));
    assert.equal(h.calls.length, 1);
  }
});

test('desktop and root failures leave remapping unavailable', async () => {
  const desktop = fixture(false);
  await assert.rejects(desktop.api.get()); assert.equal(desktop.calls.length, 0);
  const h = fixture(), read = h.api.get();
  h.reply(0, {returnValue:false, errorCode:'root_required'}, {returnValue:false});
  await assert.rejects(read, {code:'root_required'});
});

test('an active Home replacement returns a short unavailable state', async () => {
  const h = fixture(), read = h.api.get();
  h.reply(0, {returnValue:false, errorCode:'home_overlay_active'}, {returnValue:false});
  const state = await read;
  assert.equal(state.available, false);
  assert.equal(state.mode, 'xmb');
  assert.equal(state.reason, 'home_overlay_active');
  assert.equal(state.canRetry, false);
  assert.match(state.message, /Restore LG Home/);
  await assert.rejects(h.api.set('stock'));
  assert.equal(h.calls.length, 1);
});

test('both platform identities report a Home replacement without a privileged call', async () => {
  for (const name of ['PalmSystem', 'webOSSystem']) {
    for (const identifier of ['com.webos.app.home', 'com.webos.app.home 1234']) {
      const h = fixture(true, {[name]: {identifier}});
      const state = await h.api.get();
      assert.equal(state.mode, 'xmb');
      assert.equal(state.available, false);
      assert.equal(state.canRetry, false);
      assert.equal(state.reason, 'home_overlay_active');
      assert.match(state.message, /LG-XMB replaces LG Home/);
      await assert.rejects(h.api.set('stock'), {code:'home_overlay_active'});
      assert.equal(h.calls.length, 0);
      assert.equal(h.timers.size, 0);
    }
  }
});

test('Home identity matching is exact and only applies on the TV', async () => {
  for (const identifier of ['com.webos.app.home.other', 'org.local.openxmb.c5', undefined, null]) {
    const h = fixture(true, {PalmSystem:{identifier}}), read = h.api.get();
    assert.equal(h.calls.length, 1);
    h.reply(0, h.ready());
    assert.equal((await read).available, true);
  }
  const desktop = fixture(false, {PalmSystem:{identifier:'com.webos.app.home'}});
  await assert.rejects(desktop.api.get(), {code:'unavailable'});
  assert.equal(desktop.calls.length, 0);
});

test('a Home replacement invalidates a previously read mapping revision', async () => {
  const system = {identifier:'org.local.openxmb.c5'};
  const h = fixture(true, {PalmSystem:system}), read = h.api.get();
  h.reply(0, h.ready());
  await read;
  system.identifier = 'com.webos.app.home';
  assert.equal((await h.api.get()).available, false);
  system.identifier = 'org.local.openxmb.c5';
  await assert.rejects(h.api.set('stock'), {code:'home_mapping_changed'});
  assert.equal(h.calls.length, 1);
});

test('the captured Homebrew error reply preserves the replacement explanation', async () => {
  const h = fixture(), read = h.api.get();
  h.calls[0].bridge.onservicecallback(JSON.stringify({
    returnValue:false,
    errorText:'Command failed: ' + h.calls[0].command + '\n',
    stdoutString:'{"returnValue": false, "errorCode": "home_overlay_active"}\n',
    stdoutBytes:'eyJyZXR1cm5WYWx1ZSI6IGZhbHNlLCAiZXJyb3JDb2RlIjogImhvbWVfb3ZlcmxheV9hY3RpdmUifQo=',
    stderrString:'',
    stderrBytes:''
  }));
  const state = await read;
  assert.equal(state.reason, 'home_overlay_active');
  assert.equal(state.available, false);
  assert.equal(state.canRetry, false);
  assert.match(state.message, /LG-XMB replaces LG Home/);
  assert.equal(h.calls.length, 1);
});

test('timeout invalidates the write snapshot and never retries', async () => {
  const h = fixture(), read = h.api.get(); h.reply(0, h.ready()); await read;
  const write = h.api.set('xmb'), late = h.calls[1].bridge.onservicecallback;
  assert.equal([...h.timers.values()][0].delay, 18000);
  [...h.timers.values()][0].fn();
  await assert.rejects(write, {code:'timeout'});
  late(JSON.stringify({returnValue:true, stdoutString:JSON.stringify(h.ready('xmb'))}));
  await assert.rejects(h.api.set('xmb'), {code:'home_mapping_changed'});
  assert.equal(h.calls.length, 2);
  const retry = h.api.get(); h.reply(2, h.ready('xmb'));
  assert.equal((await retry).mode, 'xmb');
});

test('cancelled calls ignore late replies and cannot restore their snapshot', async () => {
  const h = fixture(), read = h.api.get(), late = h.calls[0].bridge.onservicecallback;
  read.cancel(); await assert.rejects(read, {code:'cancelled'});
  late(JSON.stringify({returnValue:true, stdoutString:JSON.stringify(h.ready())}));
  await assert.rejects(h.api.set('xmb'));
  assert.equal(h.calls.length, 1);
});

test('malformed envelopes and unconfirmed writes never report success', async () => {
  for (const envelope of [{returnValue:false}, {exitCode:2}, {stderrString:'private details'}, {error:'failed'}]) {
    const h = fixture(), read = h.api.get(); h.reply(0, h.ready(), envelope);
    await assert.rejects(read, error => !error.message.includes('private details'));
  }
  for (const patch of [{revision:'garbage'}, {available:false}, {mode:'unknown'}, {returnValue:null}]) {
    const h = fixture(), read = h.api.get(); h.reply(0, {...h.ready(), ...patch});
    await assert.rejects(read);
  }
  const h = fixture(), read = h.api.get(); h.reply(0, h.ready()); await read;
  const write = h.api.set('xmb'); h.reply(1, h.ready('stock'));
  await assert.rejects(write, {code:'home_mapping_not_confirmed'});
  await assert.rejects(h.api.set('xmb'), {code:'home_mapping_changed'});
});
