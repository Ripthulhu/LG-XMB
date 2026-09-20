// SPDX-License-Identifier: GPL-3.0-or-later
// Exercise the real launcher handler and selection updates on both axes.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const navigation = require('./support/menu-navigation.cjs');

(async () => {
  const browser = await chromium.launch(navigation.launchOptions());
  const errors = [],
    cadences = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      // Keep this a navigation test, independent of desktop WebGL throughput.
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return /webgl/.test(kind) ? null : getContext.call(this, kind, ...args);
      };
      localStorage.clear();
      // The real Settings list is short. Extend only its data so neither the
      // current cadence nor the faster regression can run into a boundary.
      let catalog;
      Object.defineProperty(window, 'C5Catalog', {
        get: () => catalog,
        set: (value) => {
          catalog = value;
          const settings = value.find((category) => category.id === 'settings');
          for (let index = settings.items.length; index < 30; index++) {
            settings.items.push({
              id: 'repeat-setting-' + index,
              title: 'Setting ' + index,
              icon: 'settings',
              action: 'appearance'
            });
          }
        }
      });
    });
    const appRoot = process.env.LGXMB_TEST_APP_DIR || path.resolve(__dirname, '../app');
    const appURL = pathToFileURL(path.join(appRoot, 'index.html')).href;
    for (const flagged of [true, false]) {
      const group = [];
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        await page.goto(appURL);
        await page.waitForFunction(() => window.C5App);
        const vertical = key === 'ArrowUp' || key === 'ArrowDown';
        if (vertical) {
          await navigation.item(page, 'settings', 'repeat-setting-12');
        } else {
          const target = await page.evaluate(
            (index) => C5Catalog[index].id,
            key === 'ArrowLeft' ? 5 : 2
          );
          await navigation.category(page, target);
        }
        const result = await page.evaluate(
          async ({ key, flagged, vertical }) => {
            const position = () => {
              const state = C5App.getState();
              const category = C5Catalog.findIndex((entry) => entry.id === state.category);
              return vertical
                ? C5Catalog[category].items.findIndex((entry) => entry.id === state.item)
                : category;
            };
            const initial = position(),
              count = vertical ? C5Catalog[0].items.length : C5Catalog.length,
              moves = [],
              start = performance.now();
            let previous = initial;
            const observe = new MutationObserver(() => {
              const next = position();
              if (next === previous) return;
              previous = next;
              moves.push({ at: performance.now() - start, position: next });
            });
            observe.observe(document.querySelector(vertical ? '#items' : '#categories'), {
              subtree: true,
              attributes: true,
              childList: true
            });
            const send = (type, repeat) =>
              document.dispatchEvent(
                new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true })
              );
            const until = async (deadline) => {
              const remaining = start + deadline - performance.now();
              if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
            };
            // Identical input on all four directions, including remotes which
            // omit KeyboardEvent.repeat. The final event queues a move at 400 ms.
            for (let index = 0; index < 9; index++) {
              await until(index * 40);
              send('keydown', flagged && index > 0);
            }
            await until(350);
            send('keyup', false);
            const released = position();
            await until(530);
            observe.disconnect();
            return { initial, count, moves, released, final: position() };
          },
          { key, flagged, vertical }
        );
        const delta = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
        const gaps = result.moves.slice(1).map((move, index) => move.at - result.moves[index].at);
        assert.equal(result.moves.length, 4, key + ' must deliver four moves in the same hold');
        assert.deepEqual(
          result.moves.map((move) => move.position),
          result.moves.map((_, index) => result.initial + (index + 1) * delta),
          key + ' must move exactly one selection per repeat'
        );
        assert.ok(
          result.moves.every((move) => move.position > 0 && move.position < result.count - 1),
          'The hold must stay clear of list and category boundaries'
        );
        assert.ok(
          gaps.every((gap) => gap >= 95 && gap < 130),
          key + ' must use the same 100 ms cadence: ' + JSON.stringify(gaps)
        );
        assert.equal(
          result.final,
          result.released,
          key + ' must cancel its queued repeat on release'
        );
        const cadence = { key, repeatFlag: flagged, moves: result.moves.length, gaps };
        cadences.push(cadence);
        group.push(cadence);
      }
      const averages = group.map((entry) => entry.gaps.reduce((sum, gap) => sum + gap, 0) / 3);
      assert.ok(
        Math.max(...averages) - Math.min(...averages) < 15,
        'Vertical and horizontal holds must have the same cadence'
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          checks: [
            'matching launcher cadence in all directions with and without repeat flags',
            'one selection per repeat, away from boundaries',
            'release cancels pending movement'
          ],
          cadences,
          errors,
          testedOnTV: false
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
