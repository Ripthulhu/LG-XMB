// SPDX-License-Identifier: GPL-3.0-or-later
// Real launcher, panels and CSS. Native services and WebGL are not exercised.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const menu = require('./support/menu-navigation.cjs');

(async () => {
  const browser = await chromium.launch(menu.launchOptions());
  const checks = [],
    errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem(
        'lg-xmb-preferences-v1',
        JSON.stringify({
          previewMode: 'cached',
          motion: 'full',
          sound: false,
          musicEnabled: false
        })
      );
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return /webgl/.test(kind) ? null : get.call(this, kind, ...args);
      };
      const probe = (window.wheelProbe = { renders: [], sounds: [] });
      function intercept(name, wrap) {
        Object.defineProperty(window, name, {
          configurable: true,
          set(value) {
            Object.defineProperty(window, name, {
              configurable: true,
              writable: true,
              value: wrap(value)
            });
          }
        });
      }
      intercept('C5TV', (api) =>
        Object.assign({}, api, {
          isTV: () => true,
          listApps: () =>
            Promise.resolve({
              preview: false,
              apps: Array.from({ length: 18 }, (_, index) => ({
                id: 'org.wheel.app' + index,
                title: 'Wheel app ' + String(index).padStart(2, '0')
              }))
            })
        })
      );
      intercept('LGXMBAppManager', (api) =>
        Object.assign({}, api, {
          getAppInfo: (id) =>
            Promise.resolve({
              info: {
                id,
                title: 'Wheel test application',
                version: '1.0',
                vendor: 'Test fixture',
                type: 'web',
                installation: 'developer',
                removable: true,
                description: 'Long application information for native scrolling. '.repeat(40)
              }
            })
        })
      );
      intercept(
        'LGXMBLauncherView',
        (Constructor) =>
          function (options) {
            const view = new Constructor(options),
              render = view.render;
            view.render = function (...args) {
              probe.renders.push({
                at: performance.now(),
                item: options.selections[options.getCategory()]
              });
              return render.apply(view, args);
            };
            return view;
          }
      );
      intercept('LGXMBMenuSounds', (Constructor) => {
        const play = Constructor.prototype.play;
        Constructor.prototype.play = function (kind) {
          probe.sounds.push(kind);
          return play.call(this, kind);
        };
        return Constructor;
      });
      probe.clear = () => {
        probe.renders = [];
        probe.sounds = [];
      };
      probe.snapshot = () => {
        const state = C5App.getState();
        const category = C5Catalog.find((entry) => entry.id === state.category);
        const selected = document.querySelector('#items > .rows:not(.parked) > .selected');
        return {
          category: state.category,
          item: state.item,
          index: category.items.findIndex((item) => item.id === state.item),
          modal: state.modal,
          options: state.itemOptions.open,
          renders: probe.renders.length,
          sounds: probe.sounds.length,
          focus: document.activeElement.id || document.activeElement.dataset.action || '',
          duration: selected ? getComputedStyle(selected).transitionDuration : ''
        };
      };
      probe.wheel = (delta) => {
        const event = new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true });
        document.querySelector('#items').dispatchEvent(event);
        return event.defaultPrevented;
      };
      probe.key = (type, key, repeat = false) =>
        document.dispatchEvent(
          new KeyboardEvent(type, {
            key,
            repeat,
            bubbles: true,
            cancelable: true
          })
        );
      probe.frames = () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../app/index.html')).href);
    await page.waitForFunction(
      () => window.C5App && C5Catalog.find((c) => c.id === 'apps').items.length >= 18
    );

    async function start(index = 6) {
      await menu.item(page, 'apps', 'org.wheel.app' + index);
      await page.evaluate(() => wheelProbe.frames());
      await page.evaluate(() => wheelProbe.clear());
      return page.evaluate(() => wheelProbe.snapshot());
    }
    let before = await start();
    for (const delta of [120, -120]) {
      const immediate = await page.evaluate((delta) => {
        const prevented = wheelProbe.wheel(delta);
        return { ...wheelProbe.snapshot(), prevented };
      }, delta);
      assert.equal(
        immediate.index,
        before.index + Math.sign(delta),
        'A slow notch moves in the input event'
      );
      assert.equal(immediate.prevented, true);
      assert.match(immediate.duration, /0\.09s/, 'Wheel rows use a short transition');
      await page.waitForTimeout(260);
      const later = await page.evaluate(() => wheelProbe.snapshot());
      assert.equal(later.index, immediate.index, 'An isolated notch leaves no movement behind');
      before = immediate;
    }
    checks.push('slow up/down notches move immediately without drift');

    before = await start();
    const burst = await page.evaluate(async () => {
      wheelProbe.wheel(120);
      wheelProbe.wheel(120);
      wheelProbe.wheel(120);
      const immediate = wheelProbe.snapshot();
      await wheelProbe.frames();
      return { immediate, after: wheelProbe.snapshot() };
    });
    assert.equal(burst.immediate.index, before.index + 1);
    assert.equal(burst.after.index, before.index + 3, 'Rapid notches retain their full distance');
    assert.equal(burst.after.renders, 2, 'Only the immediate and next-frame targets are rendered');
    assert.equal(
      burst.after.sounds,
      2,
      'Batching does not play sounds for skipped intermediate rows'
    );
    await page.waitForTimeout(300);
    assert.equal((await page.evaluate(() => wheelProbe.snapshot())).index, burst.after.index);
    checks.push('rapid same-frame notches batch once and stop when the wheel stops');

    before = await start();
    const coalesced = await page.evaluate(() => {
      wheelProbe.wheel(360);
      return wheelProbe.snapshot();
    });
    assert.equal(coalesced.index, before.index + 3);
    assert.equal(coalesced.renders, 1);
    checks.push('a coalesced three-notch event moves three rows with one render');

    before = await start();
    const reversal = await page.evaluate(async () => {
      wheelProbe.wheel(120);
      wheelProbe.wheel(120);
      wheelProbe.wheel(-120);
      const immediate = wheelProbe.snapshot();
      await wheelProbe.frames();
      return { immediate, after: wheelProbe.snapshot() };
    });
    assert.equal(reversal.immediate.index, before.index);
    assert.deepEqual(
      reversal.after,
      reversal.immediate,
      'Reversing discards pending movement in the old direction'
    );
    checks.push('reversal takes effect immediately and cancels the old queued direction');

    for (const delta of [-120, 120]) {
      await start(delta < 0 ? 0 : 17);
      await page.evaluate((delta) => wheelProbe.wheel(delta * 100), delta);
      await page.evaluate(() => wheelProbe.frames());
      await page.evaluate(() => wheelProbe.clear());
      const edge = await page.evaluate(async (delta) => {
        const before = wheelProbe.snapshot();
        for (let i = 0; i < 12; i++) wheelProbe.wheel(delta);
        await wheelProbe.frames();
        return { before, after: wheelProbe.snapshot() };
      }, delta);
      assert.equal(edge.after.index, edge.before.index);
      assert.equal(edge.after.renders, 0);
      assert.equal(edge.after.sounds, 0);
    }
    checks.push('list boundaries do not trigger repeated renders or sounds');

    for (const action of ['keyboard', 'category', 'options', 'blur', 'hidden']) {
      await start();
      const cancelled = await page.evaluate(async (action) => {
        wheelProbe.wheel(120);
        wheelProbe.wheel(120);
        if (action === 'keyboard') {
          wheelProbe.key('keydown', 'ArrowUp');
          wheelProbe.key('keyup', 'ArrowUp');
        }
        if (action === 'category') document.querySelector('[data-category="settings"]').click();
        if (action === 'options') {
          wheelProbe.key('keydown', 'F2');
          wheelProbe.key('keyup', 'F2');
        }
        if (action === 'blur') window.dispatchEvent(new Event('blur'));
        if (action === 'hidden') {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        }
        const immediate = wheelProbe.snapshot();
        await wheelProbe.frames();
        return { immediate, after: wheelProbe.snapshot() };
      }, action);
      assert.equal(
        cancelled.after.item,
        cancelled.immediate.item,
        action + ' cancels pending wheel steps'
      );
      assert.equal(cancelled.after.category, cancelled.immediate.category);
      assert.equal(cancelled.after.renders, cancelled.immediate.renders);
      if (action === 'keyboard')
        assert.match(cancelled.after.duration, /0\.24s/, 'Keys restore normal row motion');
      if (action === 'options') await page.keyboard.press('Escape');
      if (action === 'hidden')
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: false });
          document.dispatchEvent(new Event('visibilitychange'));
        });
    }
    checks.push('keyboard, category, options, blur and hiding cancel pending wheel movement');

    await menu.item(page, 'settings', 'appearance');
    const opened = await page.evaluate(async () => {
      wheelProbe.wheel(120);
      wheelProbe.wheel(120);
      document.querySelector('#items > .rows:not(.parked) > .selected').click();
      const immediate = wheelProbe.snapshot();
      await wheelProbe.frames();
      return { immediate, after: wheelProbe.snapshot() };
    });
    assert.equal(opened.immediate.modal, 'sound');
    assert.equal(opened.after.item, 'sound');
    assert.equal(opened.after.renders, opened.immediate.renders);
    await page.keyboard.press('Escape');
    checks.push('opening a settings panel cancels the queued launcher step');

    await start(2);
    const held = await page.evaluate(async () => {
      const started = performance.now();
      wheelProbe.key('keydown', 'ArrowDown');
      for (let i = 0; i < 7; i++) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        wheelProbe.key('keydown', 'ArrowDown', true);
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
      wheelProbe.key('keyup', 'ArrowDown');
      return wheelProbe.renders.map((entry) => entry.at - started);
    });
    assert.ok(
      held.length >= 3 && held.length <= 4,
      'Held keyboard input keeps its 100 ms cadence: ' + held
    );
    assert.ok(held.slice(1).every((at, index) => at - held[index] >= 95));
    checks.push('held keyboard navigation keeps the existing 100 ms interval');

    async function nativeScroll(selector, amount) {
      const panel = page.locator(selector);
      await panel.evaluate((element) => {
        element.scrollTop = 0;
      });
      const before = await page.evaluate(() => wheelProbe.snapshot());
      const box = await panel.boundingBox();
      await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6);
      await page.mouse.wheel(0, amount);
      await page.waitForFunction(
        (selector) => document.querySelector(selector).scrollTop > 0,
        selector
      );
      const after = await page.evaluate(() => wheelProbe.snapshot());
      assert.equal(after.item, before.item, 'Native panel scroll must not move the launcher');
      assert.equal(
        after.focus,
        before.focus,
        'Native panel scroll must not change focused controls'
      );
      assert.equal(after.renders, before.renders);
    }
    await menu.item(page, 'settings', 'appearance');
    await page.keyboard.press('Enter');
    const panelWheel = await page.evaluate(async () => {
      wheelProbe.key('keydown', 'ArrowDown');
      wheelProbe.key('keydown', 'ArrowDown', true);
      const before = wheelProbe.snapshot();
      const event = new WheelEvent('wheel', {
        deltaY: 120,
        bubbles: true,
        cancelable: true
      });
      document.querySelector('#modalContent').dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 160));
      const after = wheelProbe.snapshot();
      wheelProbe.key('keyup', 'ArrowDown');
      return { before, after, prevented: event.defaultPrevented };
    });
    assert.equal(panelWheel.prevented, false, 'Panel wheel events keep the browser default action');
    assert.equal(
      panelWheel.after.focus,
      panelWheel.before.focus,
      'Wheel input cancels queued keyboard focus movement'
    );
    assert.equal(panelWheel.after.renders, panelWheel.before.renders);
    checks.push('wheel scrolling inside a panel cancels pending keyboard repeats');
    await nativeScroll('#modalContent', 560);
    await page.keyboard.press('Escape');
    await start();
    await page.keyboard.press('F2');
    await page.locator('[data-action="info"]').click();
    await page.waitForFunction(() =>
      document.querySelector('.item-options-info').textContent.includes('Long application')
    );
    await nativeScroll('.item-options-scroll', 760);
    checks.push('settings and long application information keep native wheel scrolling and focus');

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await menu.item(page, 'settings', 'appearance');
    await page.keyboard.press('Enter');
    await page.locator('[aria-label="Animation"] [data-choice="reduced"]').click();
    await page.keyboard.press('Escape');
    const reduced = await page.evaluate(() => {
      wheelProbe.wheel(120);
      return wheelProbe.snapshot();
    });
    assert.ok(reduced.duration.split(',').every((value) => Number.parseFloat(value) === 0));
    assert.equal(reduced.item, 'sound');
    checks.push('the saved reduced-motion setting still overrides wheel transitions');

    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({ checks, heldIntervals: held, errors, testedOnTV: false }, null, 2)
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
