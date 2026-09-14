// SPDX-License-Identifier: GPL-3.0-or-later
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
    C5TV: { isTV: () => true }, PalmServiceBridge,
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

test('bundled helper setup exposes only fixed status/install commands and clear root failures', async () => {
  const h = setup(), helper = h.window.C5HelperAdapter;
  assert.deepEqual(Object.keys(helper).sort(), ['getState','install','stop']);
  assert.equal(h.calls.length,0,'loading the adapter never installs anything');
  for (const [method,action,timeout] of [['getState','status',10000],['install','install',65000]]) {
    const index = h.calls.length, result = helper[method]('ignored; reboot');
    assert.equal(h.calls[index].uri,'luna://org.webosbrew.hbchannel.service/exec');
    assert.ok(h.calls[index].body.command.includes('/helper-setup.py '+action+';'));
    assert.ok(!h.calls[index].body.command.includes('reboot'));
    assert.ok(h.calls[index].body.command.includes('helper_python_required'));
    assert.equal([...h.timers.values()][0].delay,timeout);
    h.reply(index,{returnValue:true,state:action==='install'?'starting':'missing'});
    assert.equal((await result).state,action==='install'?'starting':'missing');
  }
  const denied = helper.getState();
  h.reply(2,{returnValue:false,errorCode:'helper_root_required'});
  await assert.rejects(denied,error=>error.code==='helper_root_required'&&/root access/.test(error.message));
  assert.equal(h.calls.length,3);
});

test('helper setup timeout is not retried and late success is ignored', async () => {
  const h=setup(), result=h.window.C5HelperAdapter.install(), callback=h.bridges[0].onservicecallback;
  [...h.timers.values()][0].fn();
  await assert.rejects(result,error=>error.code==='TIMEOUT');
  callback(JSON.stringify({returnValue:true,stdoutString:'{"returnValue":true,"state":"running"}'}));
  assert.equal(h.calls.length,1); assert.equal(h.timers.size,0);
});

test('unavailable Homebrew setup stays an error even if stdout claims success', async () => {
  const h=setup(), result=h.window.C5HelperAdapter.getState();
  h.reply(0,{returnValue:true,state:'running'},{returnValue:false});
  await assert.rejects(result,error=>error.code==='helper_unavailable');
  assert.equal(h.calls.length,1);
});

test('desktop preview has no helper setup adapter', () => {
  const h=setup({C5TV:{isTV:()=>false}});
  assert.equal(h.window.C5HelperAdapter,undefined); assert.equal(h.calls.length,0);
});
