'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/process-control.js'), 'utf8');
function setup(tv = false) {
  const storage = new Map();
  const localStorage = {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value)};
  const window = {C5TV: {isTV: () => tv}};
  vm.runInNewContext(source, {window, localStorage, Promise});
  return {client: window.C5ProcessControl, window, storage, localStorage};
}
const state = () => ({available: true, revision: 3, items: [{id: 'browser', title: 'Web Browser', group: 'apps', enabled: false, supported: true, description: 'May take longer to open.', status: ''}]});
test('Desktop background preview allows all activity by default and saves keep-closed choices locally', async () => {
  const h = setup(), before = await h.client.getState();
  assert.deepEqual(Array.from(before.items.filter(item => item.enabled), item => item.id), []);
  assert.equal(before.items.filter(item => item.group === 'privacy').length, 3);
  const after = await h.client.setEnabled('browser', true, before.revision);
  assert.equal(after.items.find(item => item.id === 'browser').enabled, true);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(h.storage.size, 1);
  await assert.rejects(h.client.setEnabled('search', true, before.revision), /changed/);
  assert.equal((await h.client.getState()).items.find(item => item.id === 'search').enabled, false);
});
test('Native TV never falls back to desktop settings when its adapter is unavailable', async () => {
  const h = setup(true);
  await assert.rejects(h.client.getState(), /unavailable/);
  await assert.rejects(h.client.setEnabled('home', false, 0), /unavailable/);
  assert.equal(h.storage.size, 0);
});
test('Background adapter receives exact requested values and state validation rejects malformed replies', async () => {
  const h = setup(true), calls = [];
  h.client.useAdapter({getState: () => state(), setEnabled: (...args) => { calls.push(args); const s = state(); s.revision++; s.items[0].enabled = true; return s; }, prepareLaunch: appId => ({prepared: true, appId})});
  assert.equal((await h.client.getState()).revision, 3);
  assert.equal((await h.client.setEnabled('browser', true, 3)).items[0].enabled, true);
  assert.deepEqual(calls, [['browser', true, 3]]);
  assert.equal((await h.client.prepareLaunch('com.webos.app.browser')).appId, 'com.webos.app.browser');
  await assert.rejects(h.client.setEnabled('browser', 'yes', 4), /Invalid/);
  assert.equal(calls.length, 1);
  h.client.useAdapter({getState: () => ({...state(), items: [state().items[0], state().items[0]]})});
  await assert.rejects(h.client.getState(), /unavailable/);
  h.client.useAdapter({getState: () => ({...state(), available: false})});
  await assert.rejects(h.client.getState(), /unavailable/);
});
test('Failed desktop persistence leaves the confirmed background state unchanged', async () => {
  const h = setup(); await h.client.getState();
  h.localStorage.setItem = () => { throw new Error('storage full'); };
  await assert.rejects(h.client.setEnabled('browser', true, 0), /could not save/);
  const after = await h.client.getState();
  assert.equal(after.revision, 0);
  assert.equal(after.items.find(item => item.id === 'browser').enabled, false);
});

test('Existing saved keep-closed flags retain their meaning when the switch presentation changes', async () => {
  const h = setup();
  const saved = JSON.stringify({revision: 12, enabled: {home: true, browser: false, usage: true}});
  h.storage.set('lg-xmb-background-preview-v1', saved);
  const restored = await h.client.getState();
  assert.equal(restored.revision, 12);
  assert.deepEqual(Array.from(restored.items.filter(item => item.enabled), item => item.id), ['home', 'usage']);
  assert.equal(h.storage.get('lg-xmb-background-preview-v1'), saved, 'Reading settings must not invert stored flags');
});
