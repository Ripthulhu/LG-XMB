// SPDX-License-Identifier: GPL-3.0-or-later
// Compare a retained category switch with a complete catalog reconciliation.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');
const {launchOptions} = require('./support/menu-navigation.cjs');

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    async function run(fullBuild) {
      const page = await browser.newPage();
      try {
        await page.setContent('<div id="categories"></div><div id="items"></div>');
        await page.addStyleTag({path: path.resolve(__dirname, '../app/style.css')});
        await page.addScriptTag({content: 'window.C5Icon = () => "<svg></svg>";'});
        for (const name of ['category-transition.js', 'launcher-view.js'])
          await page.addScriptTag({path: path.resolve(__dirname, '../app', name)});
        return await page.evaluate(fullBuild => {
          const sizes = [6, 80, 80, 80, 80, 400];
          let selected = 0, reads = sizes.map(() => 0);
          const categories = sizes.map((size, ci) => ({id: 'c' + ci, title: 'Category ' + ci,
            icon: 'application', items: Array.from({length: size}, (_, i) => ({
              get id() { reads[ci]++; return 'c' + ci + '-app-' + i; },
              title: 'App ' + i, icon: 'application'
            }))}));
          const selections = sizes.map(() => 0);
          const view = new LGXMBLauncherView({categories, selections,
            getCategory: () => selected, isBusy: () => false,
            canActivate: () => true, cancelHold() {}, selectCategory() {}, activateItem() {}});
          view.buildCategories(); view.buildItems(); view.render();
          const snapshots = [], work = [];
          function snapshot() {
            snapshots.push({html: document.body.innerHTML, objects: view.menuObjects()});
          }
          function switchTo(index) {
            reads.fill(0);
            selected = index;
            if (fullBuild) view.buildItems();
            else view.activateCategory();
            view.render();
            work.push(reads.slice());
            snapshot();
          }
          for (const index of [1, 2, 3, 2, 0, 5, 0]) switchTo(index);
          selections[0] = 4; view.render(); snapshot();
          switchTo(3); switchTo(0);
          // A label can change while its list is parked.
          categories[3].items[0].title = 'Renamed input';
          switchTo(3);
          // Reordering and membership still take the complete reconciliation path.
          categories[3].items.reverse();
          categories[3].items.pop();
          view.buildItems(); view.render(); snapshot();
          switchTo(0); switchTo(3);
          // Repeated activation must not touch the retained DOM.
          const observer = new MutationObserver(() => {});
          observer.observe(document.body, {subtree: true, attributes: true, childList: true});
          if (!fullBuild) view.activateCategory();
          const redundantMutations = observer.takeRecords().length;
          observer.disconnect();
          return {snapshots, work, redundantMutations, rows: sizes.reduce((a, b) => a + b)};
        }, fullBuild);
      } finally { await page.close(); }
    }
    const before = await run(true), after = await run(false);
    assert.deepEqual(after.snapshots, before.snapshots,
      'Category switching must preserve rows, labels, selection, accessibility and particle targets');
    assert.ok(before.work.every(reads => reads.reduce((a, b) => a + b) >= before.rows - 1));
    assert.ok(after.work.every(reads => reads.every(value => value === 0)),
      'A category switch must not re-read app membership');
    assert.equal(after.redundantMutations, 0);
    console.log(JSON.stringify({rows: before.rows, switches: before.work.length,
      membershipReadsBefore: before.work[0].reduce((a, b) => a + b),
      membershipReadsAfter: after.work[0].reduce((a, b) => a + b),
      matchingSnapshots: after.snapshots.length, testedOnTV: false}, null, 2));
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
