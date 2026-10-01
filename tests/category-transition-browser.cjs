// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const menu = require('./support/menu-navigation.cjs');

module.exports = async function checkCategoryTransitions(browser, checks, errors, loader) {
  const load = loader || (page => page.goto('http://127.0.0.1:8765/'));
  const dir = path.resolve(__dirname, '../qa');
  fs.mkdirSync(dir, {recursive: true});
  function capture() {
    let ctor;
    Object.defineProperty(window, 'C5Wave', {configurable: true, get: () => ctor, set: Original => {
      ctor = function (...args) { return window.menuWave = new Original(...args); };
      ctor.prototype = Original.prototype;
      Object.assign(ctor, Original);
    }});
    window.menuPress = key => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
      document.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles: true, cancelable: true}));
    };
    window.menuAnimations = () => ['categories', 'items'].flatMap(id =>
      document.getElementById(id).getAnimations({subtree: true}));
    window.finishMenuMotion = () => menuAnimations().forEach(animation => animation.finish());
  }
  async function create(width, init, deviceScaleFactor = 1) {
    const page = await browser.newPage({viewport: {width, height: Math.round(width * 9 / 16)}, deviceScaleFactor});
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(capture);
    if (init) await page.addInitScript(init);
    await load(page, [capture, init].filter(Boolean));
    await page.waitForFunction(() => window.C5App && !['pending', 'compiling'].includes(C5App.getState().waveMode));
    await page.evaluate(() => menuWave.setPaused(true));
    return page;
  }
  function motion(time) {
    if (Number.isFinite(time)) menuAnimations().forEach(animation => {
      animation.pause(); animation.currentTime = time;
    });
    const bar = document.getElementById('categories'), list = document.getElementById('items');
    const x = node => new DOMMatrix(getComputedStyle(node).transform).m41;
    const centre = node => { const box = node.getBoundingClientRect(); return box.x + box.width / 2; };
    const effects = node => node.getAnimations().map(animation => ({
      property: animation.transitionProperty || animation.animationName,
      duration: animation.effect.getTiming().duration,
      delay: animation.effect.getTiming().delay,
      easing: animation.effect.getTiming().easing
    }));
    return {width: innerWidth, barX: x(bar), listX: x(list), barEffects: effects(bar), listEffects: effects(list),
      rows: [...list.children].map((node, index) => ({
        id: node.dataset.category, x: x(node), worldX: x(list) + x(node),
        categoryX: x(bar) + index * LGXMBCategoryTransition.DISTANCE * innerWidth / 100,
        iconX: centre(node.querySelector('.selected .item-icon')),
        categoryIconX: centre(bar.children[index]),
        parked: node.classList.contains('parked'), opacity: Number(getComputedStyle(node).opacity),
        pointerEvents: getComputedStyle(node.querySelector('.selected')).pointerEvents,
        aria: node.getAttribute('aria-hidden'), ids: [...node.querySelectorAll('[id]')].map(item => item.id),
        effects: effects(node)
      }))};
  }
  const near = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 0.1, `${message}: ${actual} vs ${expected}`);
  function aligned(state, simple = false) {
    const active = state.rows.filter(row => !row.parked);
    assert.equal(active.length, 1);
    assert.notEqual(active[0].aria, 'true');
    if (simple) {
      near(state.listX, 0, 'Simple mode keeps the list still');
      near(active[0].worldX, 0, 'Simple mode keeps the active column anchored');
      assert.deepEqual(state.listEffects, []);
    } else {
      near(state.listX, state.barX, 'Both strips retain the same current position');
      assert.deepEqual(state.listEffects, state.barEffects, 'Both strips share native retarget/reversal timing');
      state.rows.forEach(row => {
        near(row.worldX, row.categoryX, 'Each retained list follows its category');
        near(row.iconX, row.categoryIconX, 'Actual selected artwork stays beneath its category');
      });
    }
    state.rows.forEach(row => {
      assert.ok(row.opacity >= 0 && row.opacity <= 1);
      row.effects.forEach(effect => assert.equal(effect.property, 'opacity', 'Rows only fade; their strip moves'));
      if (row.parked) {
        assert.equal(row.aria, 'true');
        assert.equal(row.ids.length, 0);
        assert.equal(row.pointerEvents, 'none', 'Departing and hidden rows cannot receive pointer input');
      }
    });
  }
  function settled(state, simple = false) {
    aligned(state, simple);
    assert.deepEqual(state.barEffects, []);
    assert.deepEqual(state.listEffects, []);
    state.rows.forEach(row => {
      assert.deepEqual(row.effects, []);
      near(row.opacity, row.parked ? 0 : 1, 'Settled column alpha');
      if (!row.parked) near(row.worldX, 0, 'Selected column rests at its anchor');
    });
  }
  async function finish(page) {
    await page.evaluate(() => finishMenuMotion());
    await page.waitForFunction(() => menuAnimations().length === 0, null, {timeout: 5000});
  }
  for (const [width, dpr] of [[1280, 1], [1920, 1], [1366, 1.25]]) {
    const page = await create(width, null, dpr);
    try {
      // Up/Down must arm CSS motion even before any horizontal input, and after cancellation.
      for (const key of ['ArrowDown', 'ArrowUp']) {
        if (key === 'ArrowUp') await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        const firstVertical = await page.evaluate(key => {
          const bar = document.getElementById('categories'), list = document.getElementById('items');
          const instantBefore = bar.classList.contains('categories-instant');
          const barTransform = bar.style.transform, listTransform = list.style.transform;
          menuPress(key);
          const selected = list.querySelector('.rows:not(.parked) .selected');
          const travel = selected.getAnimations().find(animation => animation.transitionProperty === 'transform');
          return {instantBefore, instantAfter: bar.classList.contains('categories-instant'),
            duration: travel && travel.effect.getTiming().duration,
            sameStrips: bar.style.transform === barTransform && list.style.transform === listTransform};
        }, key);
        assert.deepEqual(firstVertical, {instantBefore: true, instantAfter: false, duration: 400, sameStrips: true},
          'First vertical navigation after startup or resize enables row motion without moving the category strips');
        await finish(page);
      }
      await menu.item(page, 'tv', 'com.webos.app.hdmi4');
      await finish(page);
      await page.evaluate(() => {window.inputRows = [...document.querySelector('#items>.rows:not(.parked)').children];});
      const vertical = await page.evaluate(() => {
        menuPress('ArrowUp');
        const row = document.querySelector('#items>.rows:not(.parked)>.item');
        return row.getAnimations().find(animation => animation.transitionProperty === 'transform').effect.getTiming();
      });
      assert.equal(vertical.duration, 400);
      await finish(page);
      await page.evaluate(() => menuPress('ArrowDown'));
      await finish(page);
      settled(await page.evaluate(motion));

      await page.evaluate(() => menuPress('ArrowRight'));
      for (const time of [0, 40, 60, 100, 200, 320, 399]) {
        const frame = await page.evaluate(motion, time);
        aligned(frame);
        assert.deepEqual(frame.barEffects, [{property: 'transform', duration: 400, delay: 0, easing: vertical.easing}]);
        const incoming = frame.rows.find(row => row.id === 'apps'), outgoing = frame.rows.find(row => row.id === 'tv');
        near(incoming.opacity + outgoing.opacity, 1, 'Incoming and outgoing alpha use one curve');
        if (time === 0) {
          near(incoming.opacity, 0, 'Incoming starts transparent'); near(outgoing.opacity, 1, 'Outgoing starts opaque');
          for (const row of [incoming, outgoing]) assert.deepEqual(row.effects,
            [{property: 'opacity', duration: 320, delay: 0, easing: vertical.easing}], 'Column fades finish before movement');
        }
        if (time === 100) assert.ok(incoming.opacity > 0 && incoming.opacity < 1, 'Fade has an intermediate frame');
        if (time === 320) {
          assert.equal(incoming.opacity, 1, 'Incoming column is opaque before movement finishes');
          assert.equal(outgoing.opacity, 0, 'Outgoing column disappears while its track is still moving');
        }
      }
      const hit = await page.evaluate(() => {
        const old = document.querySelector('#items>.rows.parked[data-category="tv"] .selected'), bounds = old.getBoundingClientRect();
        const hit = document.elementsFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
          .some(node => node === old || old.contains(node));
        const before = C5App.getState(); old.click(); const after = C5App.getState();
        return {hit, unchanged: ['category', 'item', 'busy', 'modal'].every(key => before[key] === after[key])};
      });
      assert.deepEqual(hit, {hit: false, unchanged: true});
      await finish(page);
      settled(await page.evaluate(motion));

      // Native transitions shorten reversals; the list must inherit that same timing.
      await page.evaluate(() => menuPress('ArrowLeft'));
      const before = await page.evaluate(motion, 60);
      await page.evaluate(() => menuPress('ArrowRight'));
      const reverse = await page.evaluate(motion, 0);
      aligned(reverse);
      near(reverse.barX, before.barX, 'Reversal preserves the current position');
      assert.ok(reverse.barEffects[0].duration < 400, 'Exercise actual native reversal shortening');
      before.rows.forEach((row, index) => near(reverse.rows[index].opacity, row.opacity, 'Reversal preserves alpha'));
      reverse.rows.forEach(row => row.effects.forEach(effect =>
        assert.ok(effect.duration < reverse.barEffects[0].duration, 'Reversed fades finish before reversed movement')));
      for (const time of [40, 100, 200]) aligned(await page.evaluate(motion, time));
      await finish(page);

      // Repeats, including two inputs in one rendering interval, must not restart a one-slot entry.
      await page.evaluate(() => menuPress('ArrowRight'));
      aligned(await page.evaluate(motion, 60));
      await page.evaluate(() => menuPress('ArrowRight'));
      for (const time of [0, 40, 100, 200]) {
        const frame = await page.evaluate(motion, time);
        aligned(frame);
        if (time === 40) assert.ok(frame.rows.filter(row => row.opacity > 0.001).length >= 3,
          'Rapid scrolling retains multiple departing columns while they fade');
      }
      await finish(page);
      await page.evaluate(() => {menuPress('ArrowLeft'); menuPress('ArrowLeft');});
      for (const time of [0, 40, 100, 200]) aligned(await page.evaluate(motion, time));
      await finish(page);
      await page.evaluate(() => {menuPress('ArrowRight'); menuPress('ArrowLeft');});
      aligned(await page.evaluate(motion, 0));
      await finish(page);

      // Sample real rendering intervals after blocked main-thread work, without resetting animation clocks.
      const blocked = await page.evaluate(async () => {
        const samples = [], bar = document.getElementById('categories'), list = document.getElementById('items');
        for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft']) {
          await new Promise(requestAnimationFrame);
          menuPress(key);
          const until = performance.now() + 70;
          while (performance.now() < until) {} // Model TV work that delays the next render.
          await new Promise(requestAnimationFrame);
          const row = list.querySelector('.rows:not(.parked)'), index = [...list.children].indexOf(row);
          const x = node => new DOMMatrix(getComputedStyle(node).transform).m41;
          samples.push({bar: x(bar), list: x(list), row: x(row), index});
        }
        return samples;
      });
      blocked.forEach(frame => {
        near(frame.bar, frame.list, 'Blocked-frame strip alignment');
        near(frame.list + frame.row, frame.bar + frame.index * width * 0.106, 'Blocked-frame column alignment');
      });
      await finish(page);
      await menu.category(page, 'tv');
      await finish(page);
      assert.equal(await page.evaluate(() => [...document.querySelector('#items>.rows:not(.parked)').children]
        .every((node, index) => node === inputRows[index])), true);
      assert.equal(await page.evaluate(() => C5App.getState().item), 'com.webos.app.hdmi4');
      const writes = await page.evaluate(() => {
        const observer = new MutationObserver(() => {});
        for (const id of ['categories', 'items']) observer.observe(document.getElementById(id), {attributes: true});
        menuPress('ArrowUp'); menuPress('ArrowDown');
        const records = observer.takeRecords().filter(record => record.attributeName === 'style');
        observer.disconnect(); return records.length;
      });
      assert.equal(writes, 0, 'Vertical navigation must not rewrite either horizontal strip');
      await finish(page);
      await page.evaluate(() => document.querySelector('[aria-label="Settings"]').click());
      assert.equal(await page.evaluate(() => C5App.getState().category), 'settings');
      for (const time of [0, 60, 200]) aligned(await page.evaluate(motion, time));
      await page.screenshot({path: path.join(dir, `menu-css-${width}.png`)});
      await page.evaluate(() => menuPress('Enter'));
      assert.equal(await page.evaluate(() => C5App.getState().modal), 'appearance');
      settled(await page.evaluate(motion));
      await page.keyboard.press('Escape');
      await page.evaluate(() => {menuPress('ArrowRight'); window.dispatchEvent(new Event('pagehide'));});
      const hiddenCategory = await page.evaluate(() => C5App.getState().category);
      settled(await page.evaluate(motion));
      await page.evaluate(() => menuPress('ArrowRight'));
      assert.equal(await page.evaluate(() => C5App.getState().category), hiddenCategory);
      await page.evaluate(() => {
        window.dispatchEvent(new Event('pageshow')); menuWave.setPaused(true);
        menuPress('ArrowRight'); window.dispatchEvent(new Event('resize'));
      });
      settled(await page.evaluate(motion));
      await page.evaluate(() => menuPress('ArrowRight'));
      await finish(page);
      settled(await page.evaluate(motion));
      await page.screenshot({path: path.join(dir, `home-rest-${width}.png`)});
      checks.push(`${width}px DPR ${dpr}: shared category/list position through reversal, repeat, batched inputs, blocked frames and jumps; native fades, retained rows, inactive hit-testing and lifecycle cleanup`);
    } finally { await page.close(); }
  }
  for (const mode of ['reduced', 'simple', 'no-animation-api', 'refused-animation', 'system-reduced']) {
    const init = mode === 'reduced' ? () => localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify({motion: 'reduced'})) :
      mode === 'simple' ? () => localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify({menuAnimation: 'simple'})) :
      mode === 'no-animation-api' ? () => {Element.prototype.animate = undefined;} :
      mode === 'refused-animation' ? () => {Element.prototype.animate = () => {throw Error('Animation refused');};} :
      () => localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify({motion: 'full'}));
    const page = await create(1280, init);
    try {
      if (mode === 'system-reduced') await page.emulateMedia({reducedMotion: 'reduce'});
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => C5App.getState().category), 'apps');
      const state = await page.evaluate(motion);
      aligned(state, mode === 'simple');
      if (mode === 'reduced' || mode === 'system-reduced') settled(state);
      await finish(page);
      settled(await page.evaluate(motion), mode === 'simple');
      checks.push(`${mode}: immediate selection and correct settled columns without JavaScript animation`);
    } finally { await page.close(); }
  }
  assert.deepEqual(errors, []);
};
