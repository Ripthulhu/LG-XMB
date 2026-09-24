// SPDX-License-Identifier: GPL-3.0-or-later
// Real launcher CSS/DOM geometry, without starting the app or contacting a TV.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {launchOptions} = require('./support/menu-navigation.cjs');

const app = path.resolve(__dirname, '../app');
const screenshot = path.resolve(__dirname, '../qa/xmb-layout-1920.png');

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= 0.6,
    message + ': expected ' + expected.toFixed(2) + 'px, got ' + actual.toFixed(2) + 'px');
}

async function fixture(page) {
  await page.setContent('<!doctype html><html><body class="reduced-motion">' +
    '<div class="screen"><main aria-label="Layout regression fixture">' +
    '<nav id="categories" aria-label="Categories"></nav>' +
    '<section class="cross-content"><div id="items" role="listbox"></div></section>' +
    '</main></div></body></html>');
  await page.addStyleTag({path: path.join(app, 'style.css')});
  for (const file of ['icons.js', 'category-transition.js', 'launcher-view.js'])
    await page.addScriptTag({path: path.join(app, file)});
  await page.evaluate(() => {
    const labels = ['System Update', 'Game Settings', 'Video Settings', 'Music Settings',
      'Display Settings', 'Sound Settings', 'Security Settings', 'Remote Play Settings',
      'Network Settings', 'Accessory Settings', 'Date and Time', 'Power Save Settings'];
    const categories = [['Users', 'application'], ['Settings', 'settings'], ['Photos', 'image'],
      ['Music', 'music'], ['Video', 'media'], ['Network', 'network']].map(([title, icon], ci) => ({
      id: 'category-' + ci, title, icon,
      items: labels.map((title, i) => ({id: 'entry-' + ci + '-' + i, title, icon: 'settings'}))
    }));
    const selections = categories.map(() => 4);
    let selected = 1;
    const view = new LGXMBLauncherView({categories, selections,
      getCategory: () => selected, isBusy: () => false, canActivate: () => true,
      cancelHold() {}, activateItem() {}, selectCategory() {}});
    view.buildCategories();
    view.buildItems();
    view.render();
    window.layoutFixture = {view, categories, selections,
      get selected() { return selected; },
      select(ci) { selected = ci; view.activateCategory(); view.render(); },
      retained: Array.from(document.querySelectorAll('#categories > button, #items .rows, #items .item'))};
  });
}

async function geometry(page) {
  return page.evaluate(() => {
    const state = window.layoutFixture;
    function rect(element) {
      const r = element.getBoundingClientRect();
      return {left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        width: r.width, height: r.height, x: r.left + r.width / 2, y: r.top + r.height / 2};
    }
    const categories = Array.from(document.querySelectorAll('#categories > .category')).map((button, i) => {
      const face = button.querySelector(i === state.selected ? '.lit' : '.dim');
      return {id: 'c' + i, index: i, face: rect(face), icon: rect(face.querySelector('.category-icon'))};
    });
    const rows = Array.from(document.querySelectorAll('#items > .rows:not(.parked) > .item'))
      .map((button, i) => ({id: 'r' + state.selected + ':' + i,
        offset: i - state.selections[state.selected],
        visible: getComputedStyle(button).visibility === 'visible',
        ariaHidden: button.getAttribute('aria-hidden'), row: rect(button),
        icon: rect(button.querySelector('.item-icon')), label: rect(button.querySelector('.item-text'))}));
    return {width: innerWidth, height: innerHeight, selected: state.selected, categories, rows,
      objects: state.view.menuObjects(),
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight};
  });
}

function checkGeometry(data, label) {
  const {width, height, selected, categories, rows} = data;
  const anchor = width / height <= 4 / 3 ? 26 : 29.5;
  const bar = categories[selected];
  near(bar.icon.x, width * anchor / 100, label + ' category anchor');
  near(bar.icon.y, height * 0.27, label + ' category center');
  const visible = rows.filter(row => row.visible);
  assert.ok(visible.filter(row => row.offset < 0).length >= 2, label + ' shows two upper rows');
  assert.ok(visible.filter(row => row.offset > 0).length >= 5, label + ' shows five lower rows');
  for (const row of rows) {
    assert.equal(row.ariaHidden, row.visible ? 'false' : 'true', label + ' row accessibility');
    if (!row.visible) continue;
    const center = 47 + row.offset * 7.5 + (row.offset < 0 ? -28.4 : row.offset > 0 ? 8.7 : 0);
    near(row.icon.x, width * anchor / 100, label + ' row ' + row.offset + ' icon anchor');
    near(row.icon.y, height * center / 100, label + ' row ' + row.offset + ' icon center');
    near(row.row.height, height * 0.065, label + ' row height');
    near(row.label.left, width * (anchor + 6) / 100, label + ' label start');
    for (const [part, bounds] of Object.entries({row: row.row, icon: row.icon, label: row.label})) {
      assert.ok(bounds.top >= -0.6 && bounds.bottom <= height + 0.6,
        label + ' row ' + row.offset + ' ' + part + ' stays inside the viewport');
      assert.ok(bounds.bottom < bar.face.top || bounds.top > bar.face.bottom,
        label + ' row ' + row.offset + ' ' + part + ' clears the category bar');
    }
  }
  assert.ok(data.scrollWidth <= width && data.scrollHeight <= height, label + ' has no page overflow');
  const expectedTargets = new Map(categories.map(category => [category.id, category.icon]));
  for (const row of visible) expectedTargets.set(row.id, row.icon);
  assert.deepEqual(data.objects.map(object => object.id).sort(), Array.from(expectedTargets.keys()).sort(),
    label + ' particle targets cover precisely the categories and visible rows');
  for (const object of data.objects) {
    const target = expectedTargets.get(object.id);
    near((object.x + 1) * width / 2, target.x, label + ' particle ' + object.id + ' x');
    near((1 - object.y) * height / 2, target.y, label + ' particle ' + object.id + ' y');
  }
  return {viewport: width + 'x' + height, anchor, upper: visible.filter(row => row.offset < 0).length,
    lower: visible.filter(row => row.offset > 0).length, particleTargets: data.objects.length};
}

async function checkNavigationWork(page) {
  return page.evaluate(() => {
    const fixture = window.layoutFixture, reads = [], restore = [];
    function wrap(object, property) {
      const original = object[property];
      object[property] = function () {
        reads.push(property);
        return original.apply(this, arguments);
      };
      restore.push(() => { object[property] = original; });
    }
    wrap(window, 'getComputedStyle');
    wrap(Element.prototype, 'getBoundingClientRect');
    wrap(Element.prototype, 'getClientRects');
    for (const prototype of [HTMLElement.prototype, Element.prototype]) {
      for (const property of ['offsetTop', 'offsetLeft', 'offsetWidth', 'offsetHeight',
        'clientTop', 'clientLeft', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight']) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
        if (!descriptor || !descriptor.get || !descriptor.configurable) continue;
        Object.defineProperty(prototype, property, {...descriptor, get() {
          reads.push(property);
          return descriptor.get.call(this);
        }});
        restore.push(() => Object.defineProperty(prototype, property, descriptor));
      }
    }
    const observer = new MutationObserver(() => {});
    observer.observe(document.getElementById('items'), {childList: true, subtree: true});
    try {
      for (const index of [5, 6, 5, 4]) {
        fixture.selections[fixture.selected] = index;
        fixture.view.render();
        fixture.view.menuObjects();
      }
      for (const ci of [2, 3, 2, 1]) {
        fixture.select(ci);
        fixture.view.menuObjects();
      }
      return {reads, childListMutations: observer.takeRecords().length,
        retained: fixture.retained.every((node, i) => node ===
          document.querySelectorAll('#categories > button, #items .rows, #items .item')[i])};
    } finally {
      observer.disconnect();
      restore.reverse().forEach(reset => reset());
    }
  });
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  const checks = [], errors = [];
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 720}});
    page.on('pageerror', error => errors.push(error.message));
    await fixture(page);
    for (const viewport of [{width: 1280, height: 720}, {width: 1920, height: 1080},
      {width: 1024, height: 768}, {width: 1920, height: 1080}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => { layoutFixture.view.refreshLayout(); layoutFixture.view.render(); });
      checks.push(checkGeometry(await geometry(page), viewport.width + 'x' + viewport.height));
      assert.equal(await page.evaluate(() => layoutFixture.retained.every((node, i) => node ===
        document.querySelectorAll('#categories > button, #items .rows, #items .item')[i])), true,
      'Refreshing viewport geometry retains every category, wrapper and row');
      const work = await checkNavigationWork(page);
      assert.deepEqual(work.reads, [], 'Navigation and particle targeting use cached geometry');
      assert.equal(work.childListMutations, 0, 'Navigation retains existing rows');
      assert.equal(work.retained, true, 'Navigation retains category and row identity');
      checkGeometry(await geometry(page), viewport.width + 'x' + viewport.height + ' after navigation');
    }
    fs.mkdirSync(path.dirname(screenshot), {recursive: true});
    await page.screenshot({path: screenshot});
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({testedOnTV: false, checks,
      navigationLayoutReads: 0, retainedRows: true, screenshot}, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
