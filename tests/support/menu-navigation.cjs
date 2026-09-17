// SPDX-License-Identifier: GPL-3.0-or-later
// Exercise the real remote handler, without baking category positions into tests.
'use strict';
const assert = require('node:assert/strict');

async function category(page, id) {
  const route = await page.evaluate(id => ({
    ids: C5Catalog.map(entry => entry.id),
    current: C5App.getState().category,
    modal: C5App.getState().modal
  }), id);
  assert.equal(route.modal, null, 'Close the current panel before navigating categories');
  const target = route.ids.indexOf(id), current = route.ids.indexOf(route.current);
  assert.ok(target >= 0 && current >= 0, 'Unknown category: ' + id);
  for (let i = 0; i < Math.abs(target - current); i++) {
    await page.keyboard.press(target > current ? 'ArrowRight' : 'ArrowLeft');
  }
  assert.equal(await page.evaluate(() => C5App.getState().category), id);
}

async function item(page, categoryId, itemId) {
  await category(page, categoryId);
  const route = await page.evaluate(({categoryId, itemId}) => {
    const list = C5Catalog.find(entry => entry.id === categoryId).items;
    return {current: list.findIndex(entry => entry.id === C5App.getState().item),
      target: list.findIndex(entry => entry.id === itemId)};
  }, {categoryId, itemId});
  assert.ok(route.current >= 0 && route.target >= 0, 'Unknown item in ' + categoryId + ': ' + itemId);
  for (let i = 0; i < Math.abs(route.target - route.current); i++) {
    await page.keyboard.press(route.target > route.current ? 'ArrowDown' : 'ArrowUp');
  }
  assert.equal(await page.evaluate(() => C5App.getState().item), itemId);
}

function activeRows(page) { return page.locator('#items > .rows:not(.parked) > button'); }
function activeItem(page, id) {
  return page.locator('#items > .rows:not(.parked) > button[data-item=' + JSON.stringify(id) + ']');
}
function launchOptions() {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const channel = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
  return Object.assign({headless: true}, executablePath ? {executablePath} :
    channel === 'bundled' ? {} : {channel});
}
module.exports = {category, item, activeRows, activeItem, launchOptions};
