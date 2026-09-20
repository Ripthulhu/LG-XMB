// SPDX-License-Identifier: GPL-3.0-or-later
// Appearance controls and renderer integration. No native TV operations.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const menu = require('./support/menu-navigation.cjs');

module.exports = async function checkSettingsAppearance(browser, checks, errors, url = 'http://127.0.0.1:8765') {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
  page.on('pageerror', error => errors.push(error.message));
  const state = () => page.evaluate(() => C5App.getState());
  async function screenshot(name) {
    if (!process.env.OPENXMB_SCREENSHOT_DIR) return;
    await fs.mkdir(process.env.OPENXMB_SCREENSHOT_DIR, {recursive: true});
    await page.screenshot({path: path.join(process.env.OPENXMB_SCREENSHOT_DIR, name)});
  }
  async function open(id = 'appearance') {
    while ((await state()).modal) await page.keyboard.press('Escape');
    await menu.item(page, 'settings', id);
    await page.keyboard.press('Enter');
    assert.equal((await state()).modal, id);
  }
  async function panel(id) {
    await open();
    await page.locator('#' + id).click();
  }
  async function selected(group, label) {
    await page.getByRole('group', {name: group, exact: true})
      .getByRole('button', {name: label, exact: true}).click();
  }
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.C5App && C5App.getState().waveMode === 'webgl');
    const initial = await state();
    assert.equal(initial.preferences.theme, 'original');
    assert.equal(initial.preferences.colour, 'original');
    assert.equal(initial.waveDiagnostics.renderQuality.particles, true);
    await page.evaluate(() => {
      window.styleTransitions = [];
      const setStyle = C5Wave.prototype.setStyle;
      function geometry(wave) {
        const value = wave.getDiagnostics();
        return {quality: value.quality, targetFps: value.targetFps, adaptive: value.adaptive,
          width: wave.canvas.width, height: wave.canvas.height};
      }
      C5Wave.prototype.setStyle = function (style) {
        const before = geometry(this), result = setStyle.call(this, style);
        styleTransitions.push({before, after: geometry(this)});
        return result;
      };
    });
    await open();
    assert.deepEqual(await page.locator('#modalContent > button').allTextContents(),
      ['Theme', 'Colour', 'Background', 'Screensaver', 'Advanced']);
    assert.equal(await page.locator('#modalContent .choice-group').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'openTheme');
    await screenshot('appearance-menu-1080.png');
    for (const [id, type] of [['openTheme', 'theme'], ['openColour', 'colour'],
      ['openBackground', 'background'], ['openScreensaver', 'screensaver'],
      ['openAppearanceAdvanced', 'appearance-advanced']]) {
      await page.locator('#' + id).click();
      assert.equal((await state()).modal, type);
      assert.equal(await page.locator('#closeModal,.item-options-close,.modal-top').count(), 0);
      await page.keyboard.press('Escape');
      assert.equal((await state()).modal, 'appearance');
      assert.equal(await page.evaluate(() => document.activeElement.id), id);
    }
    checks.push('Appearance has five submenus and Back returns to the row that opened each one');

    await page.locator('#openTheme').click();
    assert.deepEqual(await page.locator('#modalContent button').allTextContents(), ['Original✓', 'Classic']);
    for (const [label, theme, particles] of [['Classic', 'classic', false], ['Original', 'original', true]]) {
      await page.getByRole('button', {name: label, exact: true}).click();
      assert.equal((await state()).preferences.theme, theme);
      assert.equal((await state()).waveDiagnostics.renderQuality.particles, particles);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), theme);
    }
    assert.equal(await page.locator('#toast').innerText(), '');
    checks.push('Original enables sparkles; Classic disables them without changing colour');

    await panel('openColour');
    assert.equal(await page.locator('#modalContent button').count(), 13);
    assert.deepEqual(await page.locator('#modalContent button').evaluateAll(nodes => nodes.map(node => node.dataset.choice)),
      ['original', ...Array.from({length: 12}, (_, i) => String(i + 1))]);
    assert.equal(await page.locator('#modalContent input,[aria-label="Time of day"],[aria-label="Month selection"]').count(), 0);
    for (const colour of [8, 5]) {
      await page.locator('[data-choice="' + colour + '"]').click();
      assert.equal((await state()).preferences.colour, colour);
      const background = await page.evaluate(() => LGXMBPreferences.backgroundTheme(C5App.getState().preferences));
      assert.deepEqual(background.colors, {mode: 'ps3', dateMode: 'fixed', timeMode: 'day', month: colour});
    }
    const white = await page.evaluate(() => ({
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb'),
      text: getComputedStyle(document.querySelector('#modalContent .option')).color,
      icon: getComputedStyle(document.querySelector('.category-icon')).color,
      border: getComputedStyle(document.getElementById('modal')).borderLeftColor
    }));
    assert.equal(white.accent, '255,255,255');
    for (const key of ['text', 'icon', 'border']) assert.match(white[key], /255, 255, 255/);
    await page.locator('[data-choice="original"]').click();
    const automatic = await page.evaluate(() => LGXMBPreferences.backgroundTheme(C5App.getState().preferences));
    assert.equal(automatic.colors.dateMode, 'auto');
    assert.equal(automatic.colors.timeMode, 'auto');
    await page.locator('[data-choice="8"]').click();
    await screenshot('appearance-colour-1080.png');
    checks.push('Colour offers Original and twelve fixed colours; fixed choices use daytime colour while text and icons remain white');

    await panel('openAppearanceAdvanced');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'showWavesOnly');
    assert.equal(await page.getByRole('group', {name: 'Particles', exact: true}).count(), 0);
    assert.equal(await page.getByRole('group', {name: 'Brightness', exact: true}).count(), 0);
    await selected('Speed', 'Fast');
    await selected('Animation', 'Off');
    assert.equal((await state()).waveDiagnostics.speed, 2.25);
    assert.equal((await state()).waveDiagnostics.reducedMotion, true);
    const transitions = await page.evaluate(() => styleTransitions);
    assert.ok(transitions.length >= 4);
    for (const transition of transitions) assert.deepEqual(transition.after, transition.before,
      'Appearance must preserve render allocation and frame cap');
    checks.push('Advanced retains animation and quality controls; appearance changes preserve the rendering allocation and frame cap');

    await panel('openTheme');
    await page.getByRole('button', {name: 'Classic', exact: true}).click();
    await panel('openBackground');
    const brightness = page.getByRole('group', {name: 'Brightness', exact: true});
    assert.deepEqual(await brightness.locator('button').evaluateAll(nodes => nodes.map(node => node.dataset.choice)),
      ['0', '-1', '-2', '-3', '-4', '-5']);
    const gains = [];
    for (const [offset, label] of [[0, 'Normal'], [-1, '-1'], [-2, '-2'], [-3, '-3'], [-4, '-4'], [-5, '-5']]) {
      await selected('Brightness', label);
      const value = await state();
      assert.equal(value.preferences.backgroundBrightness, offset);
      gains.push(value.waveDiagnostics.brightness);
    }
    assert.equal(gains[0], 1);
    assert.ok(gains.every((gain, i) => gain > 0 && (!i || gain < gains[i - 1])));
    const textBefore = await page.locator('#modalTitle').evaluate(node => getComputedStyle(node).color);
    checks.push('Background brightness offers Normal through -5 and decreases the rendered background at each step');

    let wallpaperAvailable = false;
    const fixture = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
      const context = canvas.getContext('2d'); context.fillStyle = '#80bfff'; context.fillRect(0, 0, 8, 8);
      return canvas.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await page.route('**/user-wallpaper.jpg?*', route => wallpaperAvailable
      ? route.fulfill({status: 200, contentType: 'image/png', body: fixture})
      : route.fulfill({status: 404, contentType: 'text/plain', body: 'Not found'}));
    await page.locator('[data-choice="wallpaper"]').click();
    await page.waitForFunction(() => !C5App.getState().wallpaper.loading && !!C5App.getState().wallpaper.error)
      .catch(async error => { console.error('Wallpaper state:', {state: (await state()).wallpaper, errors}); throw error; });
    assert.equal((await state()).preferences.background, 'theme');
    assert.equal((await state()).wallpaper.active, false);
    assert.equal((await state()).waveDiagnostics.paused, false);
    assert.equal(await page.locator('#wallpaper').isVisible(), false);
    assert.match(await page.locator('#wallpaperStatus').innerText(), /missing|unreadable/i);
    assert.equal(await page.locator('#toast').innerText(), '');
    wallpaperAvailable = true;
    await page.locator('#reloadWallpaper').click();
    await page.waitForFunction(() => C5App.getState().wallpaper.active);
    assert.equal((await state()).preferences.background, 'wallpaper');
    assert.equal((await state()).waveDiagnostics.paused, true);
    assert.equal(await page.locator('#wallpaper').isVisible(), true);
    assert.equal(await page.locator('#wallpaperStatus').innerText(), '');
    assert.equal(await page.locator('#wave').evaluate(node => getComputedStyle(node).visibility), 'hidden');
    assert.equal(Number(await page.locator('#wallpaper').evaluate(node => getComputedStyle(node).opacity)), gains.at(-1));
    assert.equal(await page.locator('#modalTitle').evaluate(node => getComputedStyle(node).color), textBefore);
    await selected('Brightness', 'Normal');
    assert.equal(Number(await page.locator('#wallpaper').evaluate(node => getComputedStyle(node).opacity)), 1);
    await selected('Brightness', '-2');
    await screenshot('appearance-wallpaper-1080.png');
    checks.push('Missing wallpaper keeps the theme quietly; a valid local image pauses waves and dims without dimming menu text');

    await page.reload();
    await page.waitForFunction(() => window.C5App && C5App.getState().wallpaper.active);
    const restored = await state();
    assert.equal(restored.preferences.theme, 'classic');
    assert.equal(restored.preferences.colour, 8);
    assert.equal(restored.preferences.background, 'wallpaper');
    assert.equal(restored.preferences.backgroundBrightness, -2);
    assert.equal(restored.preferences.waveSpeed, 'fast');
    assert.equal(restored.waveDiagnostics.reducedMotion, true);
    assert.equal(restored.waveDiagnostics.renderQuality.particles, false);
    assert.equal(restored.waveDiagnostics.paused, true);
    await panel('openAppearanceAdvanced');
    await page.locator('#showWavesOnly').click();
    await page.waitForFunction(() => C5App.getState().waveMode === 'webgl');
    assert.equal((await state()).waveOnly, true);
    assert.equal((await state()).modal, null);
    assert.equal((await state()).waveDiagnostics.paused, false);
    assert.equal(await page.locator('body').evaluate(node => node.classList.contains('wallpaper-active')), false);
    assert.equal(await page.locator('#wallpaper').isVisible(), false);
    assert.equal(await page.locator('#wave').evaluate(node => getComputedStyle(node).visibility), 'visible');
    await page.keyboard.press('Escape');
    assert.equal((await state()).waveOnly, false);
    assert.equal((await state()).preferences.background, 'wallpaper');
    assert.equal((await state()).waveDiagnostics.paused, true);
    assert.equal(await page.locator('body').evaluate(node => node.classList.contains('wallpaper-active')), true);
    assert.equal(await page.locator('#wallpaper').isVisible(), true);
    checks.push('Fullscreen waves temporarily replaces an active wallpaper, then Back restores the image and pauses waves again');
    await panel('openBackground');
    await page.locator('.background-source [data-choice="theme"]').click();
    await page.waitForFunction(() => C5App.getState().waveMode === 'webgl');
    assert.equal((await state()).wallpaper.active, false);
    assert.equal((await state()).waveDiagnostics.paused, false);
    checks.push('Theme, colour, wallpaper, brightness and advanced values survive reload; returning to Theme resumes waves');

    for (const id of ['sound', 'previews', 'remote']) {
      await open(id);
      const layout = await page.locator('#modal').evaluate(node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect();
        return {background: style.backgroundColor, shadow: style.boxShadow, radius: style.borderRadius,
          inView: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight};
      });
      assert.deepEqual(layout, {background: 'rgba(0, 0, 0, 0)', shadow: 'none', radius: '0px', inView: true});
    }
    await page.setViewportSize({width: 1280, height: 720});
    await panel('openBackground');
    await brightness.getByRole('button', {name: '-5', exact: true}).focus();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.evaluate(() => {
      const box = document.activeElement.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
    }), true);
    await screenshot('appearance-background-720.png');
    checks.push('Related menus remain unboxed and the six brightness options fit at 720p');

    await page.evaluate(() => localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify({
      theme: '__proto__', colour: 99, background: 'remote-url', backgroundBrightness: -99,
      waveSpeed: 'Infinity', motion: 'invalid'
    })));
    await page.reload(); await page.waitForFunction(() => window.C5App);
    const invalid = (await state()).preferences;
    assert.equal(invalid.theme, 'original'); assert.equal(invalid.colour, 'original');
    assert.equal(invalid.background, 'theme'); assert.equal(invalid.backgroundBrightness, 0);
    assert.equal(invalid.waveSpeed, 'normal');
    checks.push('Invalid stored appearance values return to supported defaults');

    for (const exit of ['Escape', 'Home', 'TV Back']) {
      await panel('openAppearanceAdvanced');
      await page.locator('#showWavesOnly').click();
      let value = await state();
      assert.equal(value.waveOnly, true); assert.equal(value.modal, null);
      assert.equal(await page.locator('#modalBackdrop').isVisible(), false);
      const item = value.item;
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#screen *')]
        .filter(node => getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length)
        .map(node => node.id || node.className)), []);
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
      assert.equal((await state()).item, item); assert.equal((await state()).busy, false);
      if (exit === 'Escape') await page.keyboard.press('Escape');
      else if (exit === 'Home') await page.evaluate(() => document.dispatchEvent(new Event('webOSRelaunch')));
      else await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Unidentified', keyCode: 461, bubbles: true, cancelable: true
      })));
      value = await state();
      assert.equal(value.waveOnly, false); assert.equal(value.modal, null); assert.equal(value.item, item);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'items');
    }
    checks.push('Fullscreen waves closes the nested panel completely; Back, TV Back and Home restore the launcher');

    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px;';
      document.body.appendChild(canvas);
      window.styleWave = new C5Wave(canvas, {adaptive: false}); styleWave.setReducedMotion(true);
    });
    await page.waitForFunction(() => styleWave.mode === 'webgl');
    const sums = await page.evaluate(() => {
      function sum(brightness) {
        styleWave.setStyle({brightness});
        const canvas = styleWave.canvas, pixels = new Uint8Array(canvas.width * canvas.height * 4);
        styleWave.gl.readPixels(0, 0, canvas.width, canvas.height, styleWave.gl.RGBA, styleWave.gl.UNSIGNED_BYTE, pixels);
        let total = 0; for (let i = 0; i < pixels.length; i += 4) total += pixels[i] + pixels[i + 1] + pixels[i + 2];
        return total;
      }
      const result = [sum(.3), sum(.6), sum(1)];
      styleWave.destroy(); styleWave.canvas.remove(); delete window.styleWave; return result;
    });
    assert.ok(sums[0] < sums[1] && sums[1] < sums[2], 'Brightness must change actual rendered pixels');
    checks.push('Background brightness changes actual wave pixels while reduced motion remains still');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
};
