// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = path.resolve(__dirname, '../app');
function load() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(app, 'catalog.js'), 'utf8'), {window});
  vm.runInNewContext(fs.readFileSync(path.join(app, 'icons.js'), 'utf8'), {window});
  return window;
}
const plain = value => JSON.parse(JSON.stringify(value));
const ids = ['settings','photo','music','video','tv','apps','browser','network'];
test('eight useful categories in the requested XMB order', () => {
  const cats = load().C5Catalog;
  assert.deepEqual(plain(cats.map(c => c.id)), ids);
  assert.deepEqual(plain(cats.map(c => c.title)),
    ['Settings','Photo','Music','Video','TV','Apps','Browser','Network']);
});
test('categories are populated, unique and use distinct existing icons', () => {
  const {C5Catalog: cats, C5Icon} = load();
  const icons = new Set();
  for (const c of cats) {
    assert.ok(c.items.length > 0, c.id);
    assert.equal(new Set(c.items.map(i => i.id)).size, c.items.length, c.id);
    icons.add(C5Icon(c.icon));
    for (const i of c.items) {
      assert.ok(i.id && i.title && i.description && i.type && i.icon);
      assert.match(i.id, /^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*$/);
    }
  }
  assert.equal(icons.size, 8);
});
test('TV starts with Live TV and retains all four physical inputs', () => {
  const tv = load().C5Catalog.find(c => c.id === 'tv');
  assert.equal(tv.items[0].id, 'com.webos.app.livetv');
  assert.equal(tv.items[1].id, 'com.webos.app.lgchannels');
  assert.deepEqual(plain(tv.items.filter(i => i.action === 'input').map(i => i.id)),
    [1,2,3,4].map(n => 'com.webos.app.hdmi' + n));
});
test('existing local settings and native TV settings remain accessible', () => {
  const s = load().C5Catalog[0];
  assert.deepEqual(plain(s.items.map(i => i.id)),
    ['appearance','sound','previews','remote','datetime','com.palm.app.settings']);
  assert.equal(s.items.find(i => i.id === 'sound').title, 'Sound');
});
test('media categories reuse native apps without undocumented deep links', () => {
  const cats = load().C5Catalog;
  for (const id of ['photo','music','video']) {
    const p = cats.find(c => c.id === id).items.find(i => i.id === 'com.webos.app.mediadiscovery');
    assert.ok(p);
    assert.equal(p.action, undefined);
    assert.equal(p.params, undefined);
    assert.match(p.description, /photos, music, and videos/);
  }
  assert.equal(cats.find(c => c.id === 'photo').items[0].id, 'com.webos.app.lifeonscreen');
  assert.equal(cats.find(c => c.id === 'music').items[0].id, 'com.webos.app.totalmusic');
});
test('media shortcuts never share mutable item objects', () => {
  const cats = load().C5Catalog;
  const photo = cats.find(c => c.id === 'photo').items[1];
  const video = cats.find(c => c.id === 'video').items[0];
  photo.title = 'Changed';
  assert.equal(video.title, 'Media Player');
});
test('Browser stays separate and Network contains both original stores', () => {
  const cats=load().C5Catalog;
  assert.equal(cats.find(c=>c.id==='browser').items[0].id,'com.webos.app.browser');
  assert.deepEqual(plain(cats.find(c=>c.id==='network').items.map(i=>i.id)),
    ['org.webosbrew.hbchannel','com.webos.app.discovery']);
  assert.equal(cats.some(c=>['users','friends','homebrew','store'].includes(c.id)),false);
});
test('Apps has a usable native shortcut and no duplicated store/browser shortcuts', () => {
  const items = load().C5Catalog.find(c => c.id === 'apps').items;
  assert.deepEqual(plain(items.map(i => i.id)), ['com.webos.app.homeconnect']);
});
test('startup and input routing do not depend on the old category positions', () => {
  const code = fs.readFileSync(path.join(app,'app.js'), 'utf8');
  assert.match(code, /selectedCategory=Math\.max\(0,categories\.findIndex/);
  assert.doesNotMatch(code, /category\.id==='inputs'|categories\[selectedCategory\]\.id==='inputs'/);
  const begin = code.indexOf('function currentPort()');
  const end = code.indexOf('\nfunction ', begin + 1);
  const ctx = {currentItem: () => ({action:'input',id:'com.webos.app.hdmi3'})};
  vm.runInNewContext(code.slice(begin,end), ctx);
  assert.equal(ctx.currentPort(), 3);
  ctx.currentItem = () => ({id:'com.webos.app.livetv'});
  assert.equal(ctx.currentPort(), null);
  ctx.currentItem = () => ({action:'input',id:'com.webos.app.hdmi9'});
  assert.equal(ctx.currentPort(), null);
  ctx.currentItem = () => ({id:'com.webos.app.hdmi1'});
  assert.equal(ctx.currentPort(), null);
});
