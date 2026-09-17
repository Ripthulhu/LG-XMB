// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const menu = require('./support/menu-navigation.cjs');

function fixture(order = ['settings', 'tv', 'apps']) {
  const catalog = order.map(id => ({id, items: (id === 'tv' ?
    ['fixture.inserted', 'com.webos.app.livetv', 'com.webos.app.lgchannels',
      'com.webos.app.hdmi1', 'com.webos.app.hdmi2'] : ['first', 'second']).map(id => ({id}))}));
  const selected = new Map(order.map(id => [id, 0]));
  let ci = order.indexOf('tv'), modal = null;
  const keys = [], context = {C5Catalog: catalog};
  context.C5App = {getState: () => ({category: catalog[ci].id,
    item: catalog[ci].items[selected.get(catalog[ci].id)].id, modal})};
  vm.createContext(context);
  return {keys, setModal: value => {modal = value;}, state: context.C5App.getState,
    page: {evaluate: async (fn, arg) => {context.arg = arg; return vm.runInContext('(' + fn.toString() + ')(arg)', context);},
      keyboard: {press: async key => {
        keys.push(key);
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
          ci = Math.max(0, Math.min(catalog.length - 1, ci + (key === 'ArrowRight' ? 1 : -1)));
        } else {
          const cat = catalog[ci], i = selected.get(cat.id);
          selected.set(cat.id, Math.max(0, Math.min(cat.items.length - 1, i + (key === 'ArrowDown' ? 1 : -1))));
        }
      }}}};
}

test('category navigation reads the current order and uses only directional keys', async () => {
  const f = fixture(['apps', 'tv', 'settings']);
  await menu.category(f.page, 'settings');
  assert.deepEqual(f.keys, ['ArrowRight']);
  await menu.category(f.page, 'apps');
  assert.deepEqual(f.keys, ['ArrowRight', 'ArrowLeft', 'ArrowLeft']);
});
test('HDMI selection tolerates TV entries before the first HDMI row', async () => {
  const f = fixture();
  await menu.item(f.page, 'tv', 'com.webos.app.hdmi2');
  assert.equal(f.state().item, 'com.webos.app.hdmi2');
  assert.deepEqual(f.keys, Array(4).fill('ArrowDown'));
});
test('returning to a category keeps its remembered selection', async () => {
  const f = fixture();
  await menu.item(f.page, 'tv', 'com.webos.app.hdmi2');
  await menu.item(f.page, 'settings', 'second');
  await menu.category(f.page, 'tv');
  assert.equal(f.state().item, 'com.webos.app.hdmi2');
  assert.equal(f.keys.includes('Enter'), false);
});
test('selecting the current item sends no navigation or launch', async () => {
  const f = fixture();
  await menu.item(f.page, 'tv', 'fixture.inserted');
  assert.deepEqual(f.keys, []);
});
test('unknown categories and items fail instead of walking to a bound', async () => {
  const f = fixture();
  await assert.rejects(menu.category(f.page, 'inputs'), /Unknown category/);
  await assert.rejects(menu.item(f.page, 'tv', 'missing'), /Unknown item/);
  assert.deepEqual(f.keys, []);
});
test('an open modal refuses category navigation', async () => {
  const f = fixture(); f.setModal('appearance');
  await assert.rejects(menu.category(f.page, 'settings'), /Close the current panel/);
  assert.deepEqual(f.keys, []);
});
