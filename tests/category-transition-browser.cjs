// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async function checkCategoryTransitions(browser, checks, errors, loader) {
  const load = loader || (page => page.goto('http://127.0.0.1:8765/'));
  const dir = path.resolve(__dirname, '../qa'); fs.mkdirSync(dir, {recursive:true});
  function capture() {
    for (const [name, instance] of [['C5Wave', 'menuWave'], ['LGXMBCategoryTransition', 'menuTransition']]) {
      let ctor;
      Object.defineProperty(window, name, {configurable:true, get:() => ctor, set:Original => {
        ctor = function (...args) { return window[instance] = new Original(...args); };
        ctor.prototype = Original.prototype;
      }});
    }
    window.menuPress = key => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles:true, cancelable:true}));
      document.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles:true, cancelable:true}));
    };
  }
  async function create(width, init) {
    const page = await browser.newPage({viewport:{width,height:width*9/16}});
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(capture); if (init) await page.addInitScript(init);
    await load(page, [capture, init].filter(Boolean));
    await page.waitForFunction(() => window.C5App && !['pending','compiling'].includes(C5App.getState().waveMode));
    // Keep the actual rendered wave frame, not a mock renderer. UI timings are
    // tested independently of continuous software-GPU work on the CI runner.
    await page.evaluate(() => menuWave.setPaused(true));
    return page;
  }
  async function seek(page, key) {
    return page.evaluate(key => {
      menuPress(key);
      const animations = menuTransition.animations;
      if (menuTransition.timer !== null) { clearTimeout(menuTransition.timer); menuTransition.timer = null; }
      animations.forEach(a => { a.pause(); a.currentTime = 100; });
      const list = document.getElementById('items'), ghost = menuTransition.ghost;
      const style = el => { const s = getComputedStyle(el); return {x:new DOMMatrix(s.transform).m41,opacity:Number(s.opacity)}; };
      return {category:C5App.getState().category, item:C5App.getState().item, animations:animations.length,
        current:style(list), old:ghost && style(ghost), ghostCount:document.querySelectorAll('.items-outgoing').length,
        listboxes:document.querySelectorAll('[role="listbox"]').length, upper:ghost ? ghost.querySelectorAll('.above-bar').length : 0};
    }, key);
  }
  for (const width of [1280,1920]) {
    const page = await create(width);
    try {
      await page.evaluate(() => { menuPress('ArrowLeft'); menuPress('ArrowDown'); menuPress('ArrowDown'); menuPress('ArrowDown'); });
      await page.waitForTimeout(200); // allow the pre-existing vertical row movement to settle
      let frame = await seek(page, 'ArrowRight');
      assert.equal(frame.category, 'watch'); assert.equal(frame.animations, 2); assert.equal(frame.upper, 3);
      assert.equal(frame.ghostCount, 1); assert.equal(frame.listboxes, 1);
      assert.ok(frame.current.x > 0 && frame.old.x < 0); assert.ok(frame.current.opacity > 0 && frame.current.opacity < 1);
      assert.ok(frame.old.opacity > 0 && frame.old.opacity < 1);
      const safe = await page.evaluate(() => {
        const ghost = menuTransition.ghost, selected = document.querySelector('#items .selected');
        const ids = [...document.querySelectorAll('[id]')].map(n => n.id);
        const after = getComputedStyle(selected, '::after'), before = getComputedStyle(selected, '::before');
        return {uniqueIds:new Set(ids).size === ids.length, hidden:ghost.getAttribute('aria-hidden'),
          disabled:[...ghost.querySelectorAll('button')].every(b => b.disabled && b.tabIndex === -1),
          pointer:getComputedStyle(ghost).pointerEvents, media:ghost.querySelectorAll('audio,video,img').length,
          glow:after.backgroundImage, glowContent:after.content, markerShadow:before.boxShadow,
          categoryShadow:getComputedStyle(document.querySelector('.category.active'),'::after').boxShadow,
          iconScale:new DOMMatrix(getComputedStyle(selected.querySelector('.item-icon')).transform).a};
      });
      assert.equal(safe.uniqueIds, true); assert.equal(safe.hidden, 'true'); assert.equal(safe.disabled, true);
      assert.equal(safe.pointer, 'none'); assert.equal(safe.media, 0); assert.equal(safe.glow, 'none');
      assert.ok(['none', 'normal'].includes(safe.glowContent)); assert.equal(safe.markerShadow, 'none'); assert.equal(safe.categoryShadow, 'none');
      assert.ok(safe.iconScale > 1);
      await page.screenshot({path:path.join(dir, `menu-swipe-${width}.png`)});
      await page.evaluate(() => menuTransition.animations[1].finish());
      await page.waitForFunction(() => !document.querySelector('.items-outgoing'));
      await page.screenshot({path:path.join(dir, `home-rest-${width}.png`)});
      frame = await seek(page, 'ArrowLeft');
      assert.equal(frame.category, 'inputs'); assert.equal(frame.item, 'com.webos.app.hdmi4');
      assert.ok(frame.current.x < 0 && frame.old.x > 0);
      const burst = await page.evaluate(() => {
        for (const key of ['ArrowRight','ArrowRight','ArrowLeft','ArrowRight','ArrowLeft']) menuPress(key);
        return {category:C5App.getState().category,ghosts:document.querySelectorAll('.items-outgoing').length};
      });
      assert.equal(burst.category, 'watch'); assert.equal(burst.ghosts, 1);
      await page.evaluate(() => menuPress('ArrowDown'));
      assert.equal(await page.locator('.items-outgoing').count(), 0);
      const modal = await page.evaluate(() => {
        document.querySelector('[aria-label="Settings"]').click(); menuPress('Enter');
        return {modal:C5App.getState().modal, ghosts:document.querySelectorAll('.items-outgoing').length};
      });
      assert.equal(modal.modal, 'appearance'); assert.equal(modal.ghosts, 0);
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        menuPress('ArrowLeft'); window.dispatchEvent(new Event('pagehide'));
      });
      assert.equal(await page.locator('.items-outgoing').count(), 0);
      const hiddenCategory = await page.evaluate(() => C5App.getState().category);
      await page.evaluate(() => menuPress('ArrowLeft'));
      assert.equal(await page.evaluate(() => C5App.getState().category), hiddenCategory);
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      await seek(page, 'ArrowLeft');
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      assert.equal(await page.locator('.items-outgoing').count(), 0);
      const glow = await page.locator('#items .selected').evaluate(el => getComputedStyle(el,'::after').content);
      assert.ok(['none','normal'].includes(glow));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      checks.push(`${width}px: directional column slide/crossfade, upper labels, safe outgoing copy, immediate input, reversals, modal/hidden/resize cleanup and no selection glow`);
    } finally { await page.close(); }
  }
  for (const mode of ['reduced','no-animation-api','refused-animation','system-reduced']) {
    const init = mode === 'reduced' ? () => localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify({motion:'reduced'})) :
      mode === 'no-animation-api' ? () => { Element.prototype.animate = undefined; } :
      mode === 'refused-animation' ? () => { Element.prototype.animate = () => {throw Error('Animation refused');}; } :
      () => localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify({motion:'full'}));
    const page = await create(1280, init);
    try {
      if (mode === 'system-reduced') await page.emulateMedia({reducedMotion:'reduce'});
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('.items-outgoing').count(), 0);
      assert.equal(await page.evaluate(() => C5App.getState().category), 'library');
      assert.equal(await page.locator('#items').evaluate(el => getComputedStyle(el).opacity), '1');
      checks.push(`${mode}: immediate usable category with no residual animation`);
    } finally {await page.close();}
  }
  assert.deepEqual(errors, []);
};
