// SPDX-License-Identifier: GPL-3.0-or-later
// Compare Up and Down at identical points in the actual CSS row animation.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchOptions } = require('./support/menu-navigation.cjs');

(async () => {
  const browser = await chromium.launch(launchOptions());
  const checks = [],
    errors = [];
  try {
    for (const width of [1280, 1920]) {
      const height = (width * 9) / 16;
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(
        '<main class="screen"><div id="categories"></div>' +
          '<section class="cross-content"><div id="items"></div></section></main>'
      );
      await page.addStyleTag({ path: path.resolve(__dirname, '../app/style.css') });
      await page.addScriptTag({ content: 'window.C5Icon = () => "<svg></svg>";' });
      for (const file of ['category-transition.js', 'launcher-view.js'])
        await page.addScriptTag({ path: path.resolve(__dirname, '../app', file) });
      const result = await page.evaluate(() => {
        const categories = [
          {
            id: 'settings',
            title: 'Settings',
            icon: 'settings',
            items: Array.from({ length: 15 }, (_, i) => ({
              id: 'setting-' + i,
              title: 'Setting ' + i,
              icon: 'settings'
            }))
          }
        ];
        const selections = [7];
        const view = new LGXMBLauncherView({
          categories,
          selections,
          getCategory: () => 0,
          isBusy: () => false,
          canActivate: () => true,
          cancelHold() {},
          selectCategory() {},
          activateItem() {}
        });
        view.buildCategories();
        view.buildItems();
        view.render();
        const host = document.querySelector('#items');
        const rows = [...host.querySelectorAll('.item')];
        function flush() {
          return host.getBoundingClientRect().top;
        }
        function settle(index) {
          selections[0] = index;
          view.render();
          flush();
          document.getAnimations().forEach((animation) => animation.finish());
          flush();
        }
        function move(delta, samples) {
          selections[0] += delta;
          view.render();
          const anchor = flush(),
            selected = rows[selections[0]];
          const animations = document.getAnimations();
          animations.forEach((animation) => animation.pause());
          const points = samples.map((time) => {
            animations.forEach((animation) => {
              animation.currentTime = time;
            });
            return selected.getBoundingClientRect().top - anchor;
          });
          return {
            points,
            duration: selected
              .getAnimations()
              .find((a) => a.effect.target === selected && a.transitionProperty === 'transform')
              ?.effect.getTiming().duration
          };
        }
        const directions = [-1, 1].map((delta) => {
          settle(7);
          const single = move(delta, [0, 30, 60, 120, 240]);
          settle(7);
          const held = Array.from({ length: 4 }, () => move(delta, [0, 40, 80]));
          const reversed = move(-delta, [0, 40, 80]);
          settle(7);
          const geometry = rows.map((row, i) => ({
            offset: i - 7,
            top: row.getBoundingClientRect().top - flush()
          }));
          return { single, held, reversed, geometry };
        });
        document.body.classList.add('reduced-motion');
        settle(7);
        const reduced = [-1, 1].map((delta) => {
          settle(7);
          selections[0] += delta;
          view.render();
          return rows[selections[0]].getBoundingClientRect().top - flush();
        });
        return { directions, reduced };
      });
      const [up, down] = result.directions;
      function mirrored(a, b, label) {
        assert.equal(a.duration, b.duration, label + ': same animation duration');
        a.points.forEach((value, i) =>
          assert.ok(
            Math.abs(value + b.points[i]) < 0.2,
            label +
              ': selected row should travel the same distance in both directions: ' +
              JSON.stringify({ up: a.points, down: b.points })
          )
        );
      }
      mirrored(up.single, down.single, 'Single step');
      assert.ok(Math.abs(Math.abs(up.single.points[0]) - height * 0.075) < 0.2);
      up.held.forEach((step, i) => mirrored(step, down.held[i], 'Held step ' + i));
      mirrored(up.reversed, down.reversed, 'Direction reversal');
      for (const row of up.geometry) {
        const gap = row.offset < 0 ? -0.284 : row.offset > 0 ? 0.087 : 0;
        const expected = height * (row.offset * 0.075 + gap);
        assert.ok(Math.abs(row.top - expected) < 0.2, 'Rows settle around the category and selection gaps');
      }
      assert.ok(
        result.reduced.every((value) => Math.abs(value) < 0.2),
        'Reduced motion stays immediate'
      );
      checks.push({
        width,
        singleStepDistance: Math.abs(up.single.points[0]),
        heldSteps: up.held.length,
        matchingUpDownMotion: true
      });
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, errors, testedOnTV: false }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
