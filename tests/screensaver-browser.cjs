// SPDX-License-Identifier: GPL-3.0-or-later
// Real Appearance controls, input routing and compositing on an isolated preview.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const menu = require('./support/menu-navigation.cjs');

const app = path.resolve(__dirname, '../app');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg'
};

async function checkScreensaver(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const checks = [],
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = () => page.evaluate(() => C5App.getState());
  const choice = (group, label) =>
    page
      .getByRole('group', { name: group, exact: true })
      .getByRole('button', { name: label, exact: true });
  async function openPanel(id = 'openScreensaver') {
    if ((await state()).screensaver.active) await page.keyboard.press('Shift');
    while ((await state()).modal) await page.keyboard.press('Escape');
    await menu.item(page, 'settings', 'appearance');
    await page.keyboard.press('Enter');
    await page.locator('#' + id).click();
  }
  async function preview() {
    assert.equal((await state()).modal, 'screensaver');
    await page.locator('#previewScreensaver').evaluate((button) => {
      for (const type of ['pointerdown', 'pointerup'])
        button.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 9,
            button: 0,
            isPrimary: true
          })
        );
      button.click();
    });
    assert.equal((await state()).screensaver.active, true);
  }
  async function faded() {
    await page.waitForFunction(
      () =>
        document.body.classList.contains('screensaver-asleep') &&
        Number(getComputedStyle(document.getElementById('screen')).opacity) === 0
    );
  }
  async function awake() {
    await page.waitForFunction(
      () =>
        !C5App.getState().screensaver.active &&
        !document.body.classList.contains('screensaver-transition') &&
        Number(getComputedStyle(document.getElementById('screen')).opacity) === 1 &&
        Number(getComputedStyle(document.getElementById('screensaverDim')).opacity) === 0,
      null,
      { timeout: 1500 }
    );
  }
  async function noTemporaryLayers() {
    assert.deepEqual(
      await page
        .locator('#screen,#modalBackdrop,#screensaverDim,.item-options')
        .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).willChange)),
      ['auto', 'auto', 'auto', 'auto']
    );
  }
  async function screenshot(name) {
    if (!process.env.OPENXMB_SCREENSHOT_DIR) return;
    await fs.mkdir(process.env.OPENXMB_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.OPENXMB_SCREENSHOT_DIR, name) });
  }
  async function cornerPixel() {
    const png = await page.screenshot({ clip: { x: 5, y: 5, width: 2, height: 2 } });
    return page.evaluate(async (data) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    }, png.toString('base64'));
  }
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.C5App && C5App.getState().screensaver);
    assert.equal((await state()).screensaver.delayMs, 120000);
    assert.equal((await state()).screensaver.brightness, 0.25);
    await openPanel();
    assert.equal((await state()).modal, 'screensaver');
    for (const [group, labels] of [
      ['Start after', ['Off', '30 sec', '1 min', '2 min', '5 min', '10 min']],
      ['Background brightness', ['0%', '10%', '25%', '50%', '75%', '100%']]
    ]) {
      assert.deepEqual(
        await page
          .getByRole('group', { name: group, exact: true })
          .locator('button > span:first-child')
          .allTextContents(),
        labels
      );
    }
    await screenshot('screensaver-settings-1080.png');
    await page.keyboard.press('Escape');
    assert.equal((await state()).modal, 'appearance');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'openScreensaver');
    await page.keyboard.press('Enter');
    await choice('Start after', '5 min').click();
    await choice('Background brightness', '50%').click();
    assert.equal((await state()).screensaver.delayMs, 300000);
    assert.equal((await state()).screensaver.brightness, 0.5);
    await page.reload();
    await page.waitForFunction(() => window.C5App);
    assert.equal((await state()).screensaver.delayMs, 300000);
    assert.equal((await state()).screensaver.brightness, 0.5);
    checks.push(
      'Appearance exposes delay and brightness choices, keeps its return focus, and persists both settings'
    );

    await openPanel();
    await choice('Background brightness', '25%').click();
    await page.locator('#previewScreensaver').focus();
    await page.keyboard.press('Enter');
    assert.equal(
      (await state()).screensaver.active,
      true,
      'The OK release must not immediately dismiss its own preview'
    );
    await page.waitForTimeout(250);
    const mid = await page
      .locator('#screen')
      .evaluate((node) => Number(getComputedStyle(node).opacity));
    assert.ok(
      mid > 0 && mid < 1,
      'Screensaver entry must fade the menu instead of hiding it immediately'
    );
    await faded();
    const dimmed = await page.evaluate(() => ({
      dim: Number(getComputedStyle(document.getElementById('screensaverDim')).opacity),
      modal: Number(getComputedStyle(document.getElementById('modalBackdrop')).opacity),
      toast: Number(getComputedStyle(document.getElementById('toast')).opacity),
      waveFilter: getComputedStyle(document.getElementById('wave')).filter,
      screenVisibility: getComputedStyle(document.getElementById('screen')).visibility
    }));
    assert.ok(Math.abs(dimmed.dim - 0.75) < 0.005);
    assert.equal(dimmed.modal, 0);
    assert.equal(dimmed.toast, 0);
    assert.equal(
      dimmed.waveFilter,
      'none',
      'Dimming must not add a filter to the animated renderer'
    );
    assert.equal(
      dimmed.screenVisibility,
      'hidden',
      JSON.stringify(
        await page.evaluate(() => ({
          classes: document.body.className,
          state: C5App.getState().screensaver,
          visibility: getComputedStyle(document.getElementById('screen')).visibility,
          active: document.activeElement.id,
          inline: document.getElementById('screen').getAttribute('style'),
          rules: [...document.styleSheets]
            .flatMap((sheet) => [...sheet.cssRules])
            .filter((rule) => rule.cssText.includes('screensaver-asleep'))
            .map((rule) => rule.cssText)
        }))
      )
    );
    await noTemporaryLayers();
    await screenshot('screensaver-asleep-1080.png');
    await page.keyboard.press('Escape');
    await awake();
    await noTemporaryLayers();
    assert.equal(
      await page.locator('#screen').evaluate((node) => getComputedStyle(node).transitionDuration),
      '0s'
    );
    assert.equal(
      (await state()).modal,
      'screensaver',
      'The waking Back press must not close the hidden menu'
    );
    checks.push(
      'Keyboard preview fades all launcher UI; Back wakes without changing the menu, and temporary compositor layers are released'
    );

    await page.locator('#previewScreensaver').focus();
    await preview();
    await page.keyboard.down('Enter');
    await page.locator('#previewScreensaver').evaluate((button) => button.click());
    assert.equal(
      (await state()).screensaver.active,
      false,
      'A synthetic Magic Remote click during the held wake key must stay suppressed'
    );
    for (let index = 0; index < 5; index++) {
      await page.waitForTimeout(75);
      await page.keyboard.down('Enter');
    }
    await page.keyboard.up('Enter');
    await awake();
    assert.equal((await state()).screensaver.active, false);
    assert.equal((await state()).modal, 'screensaver');
    assert.equal((await state()).itemOptions.open, false);
    checks.push(
      'A held wake key and its release cannot activate the focused control or open a long-press menu'
    );

    await page.mouse.move(120, 120);
    await preview();
    await page.evaluate(() =>
      document.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: 120,
          clientY: 120,
          movementX: 0,
          movementY: 0
        })
      )
    );
    assert.equal(
      (await state()).screensaver.active,
      true,
      'Stationary cursor reports do not wake the screen'
    );
    await page.mouse.move(126, 120);
    await awake();
    assert.equal((await state()).modal, 'screensaver');
    checks.push(
      'A real cursor position change wakes quickly; repeated stationary coordinates do not'
    );

    const fifty = choice('Background brightness', '50%');
    const box = await fifty.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await preview();
    await faded();
    await page.mouse.down();
    await page.mouse.up();
    await awake();
    assert.equal(
      (await state()).screensaver.brightness,
      0.25,
      'The wake click must not change a hidden setting'
    );
    await page.mouse.down();
    await page.mouse.up();
    assert.equal(
      (await state()).screensaver.brightness,
      0.5,
      'The next deliberate click must work normally'
    );
    checks.push(
      'Pointer press, release and generated click wake once without clicking through; the next click works'
    );

    await preview();
    const wheel = await page.evaluate(async () => {
      const send = () => {
        const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
        document.getElementById('modalContent').dispatchEvent(event);
        return event.defaultPrevented;
      };
      const first = send(),
        second = send();
      await new Promise((resolve) => setTimeout(resolve, 260));
      return { first, second, nextGesture: send() };
    });
    assert.deepEqual(wheel, { first: true, second: true, nextGesture: false });
    await awake();
    checks.push(
      'A wheel burst wakes without scrolling the hidden panel, then ordinary panel scrolling resumes'
    );

    for (const event of ['webOSRelaunch', 'visibilitychange', 'pagehide']) {
      await openPanel();
      await preview();
      await page.evaluate((event) => {
        if (event === 'visibilitychange')
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        (event === 'pagehide' ? window : document).dispatchEvent(new Event(event));
      }, event);
      assert.equal(
        (await state()).screensaver.active,
        false,
        event + ' clears an active screensaver'
      );
      if (event !== 'webOSRelaunch') {
        assert.equal((await state()).screensaver.available, false);
        await page.evaluate((event) => {
          if (event === 'visibilitychange')
            Object.defineProperty(document, 'hidden', { configurable: true, value: false });
          (event === 'pagehide' ? window : document).dispatchEvent(
            new Event(event === 'pagehide' ? 'pageshow' : event)
          );
        }, event);
      }
      await awake();
      assert.equal((await state()).screensaver.available, true);
    }
    checks.push('Home, hiding and page suspension clear the screensaver; returning starts awake');

    const wallpaper = Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 8;
        const context = canvas.getContext('2d');
        context.fillStyle = '#80c0ff';
        context.fillRect(0, 0, 8, 8);
        return canvas.toDataURL('image/png').split(',')[1];
      }),
      'base64'
    );
    await page.route('**/user-wallpaper.jpg?*', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: wallpaper })
    );
    await openPanel('openBackground');
    await choice('Brightness', 'Normal').click();
    await page.locator('[data-choice="wallpaper"]').click();
    await page.waitForFunction(() => C5App.getState().wallpaper.active);
    while ((await state()).modal) await page.keyboard.press('Escape');
    const full = await cornerPixel();
    assert.deepEqual(full, [128, 192, 255]);
    await openPanel();
    const withMenu = await cornerPixel();
    for (const amount of [0, 10, 25, 50, 75, 100]) {
      await choice('Background brightness', amount + '%').click();
      await preview();
      await faded();
      const pixels = await cornerPixel();
      for (let channel = 0; channel < 3; channel++) {
        assert.ok(
          Math.abs(pixels[channel] - (full[channel] * amount) / 100) <= 2,
          amount + '% wallpaper brightness must match actual composited pixels: ' + pixels
        );
      }
      assert.equal((await state()).waveDiagnostics.paused, true);
      assert.equal(
        await page.locator('#wallpaper').evaluate((node) => getComputedStyle(node).opacity),
        '1'
      );
      await page.keyboard.press('Shift');
      await awake();
    }
    assert.deepEqual(await cornerPixel(), withMenu);
    checks.push(
      'All six dim levels affect real wallpaper pixels without changing its saved brightness or restarting waves'
    );

    await choice('Start after', 'Off').click();
    assert.equal((await state()).screensaver.delayMs, 0);
    await page.reload();
    await page.waitForFunction(() => window.C5App);
    assert.equal((await state()).screensaver.delayMs, 0);
    assert.equal((await state()).screensaver.active, false);
    checks.push('Off persists and a reload returns to an awake launcher');
    await page.setViewportSize({ width: 1280, height: 720 });
    await openPanel();
    await page.locator('#previewScreensaver').focus();
    assert.equal(
      await page.evaluate(() => {
        const box = document.activeElement.getBoundingClientRect();
        return (
          document.documentElement.scrollWidth <= innerWidth &&
          box.top >= 0 &&
          box.bottom <= innerHeight &&
          box.left >= 0 &&
          box.right <= innerWidth
        );
      }),
      true
    );
    await screenshot('screensaver-settings-720.png');
    checks.push(
      'The settings stay within the screen and the preview action remains reachable at 720p'
    );
    assert.deepEqual(errors, []);
    return { checks, errors, testedOnTV: false };
  } finally {
    await page.close();
  }
}

async function checkWakeRecovery(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const checks = [],
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const appearance = menu.activeItem(page, 'appearance');
  async function sleep() {
    await page.clock.fastForward(30010);
    await page.clock.fastForward(1300);
    assert.equal(await page.evaluate(() => C5App.getState().screensaver.active), true);
    assert.equal(
      await page.evaluate(() => document.body.classList.contains('screensaver-asleep')),
      true
    );
  }
  async function key(type, code = 'Enter', repeat = false) {
    await page.evaluate(
      ({ type, code, repeat }) =>
        document.dispatchEvent(
          new KeyboardEvent(type, {
            key: 'Enter',
            keyCode: 13,
            code,
            repeat,
            bubbles: true,
            cancelable: true
          })
        ),
      { type, code, repeat }
    );
  }
  async function opened(message) {
    assert.equal(await page.evaluate(() => C5App.getState().modal), 'appearance', message);
    await page.keyboard.press('Escape');
  }
  try {
    await page.clock.install();
    await page.addInitScript(() =>
      localStorage.setItem(
        'lg-xmb-preferences-v1',
        JSON.stringify({ screensaverDelay: 30000, motion: 'reduced' })
      )
    );
    await page.goto(url);
    await page.waitForFunction(() => window.C5App);
    await menu.item(page, 'settings', 'appearance');

    for (const releaseCode of ['', 'Unidentified']) {
      await sleep();
      await key('keydown');
      await key('keyup', releaseCode);
      await page.clock.fastForward(400);
      await appearance.evaluate((button) => button.click());
      await opened('A remote release with code ' + JSON.stringify(releaseCode) + ' frees clicks');
    }
    checks.push(
      'Remote releases with missing or unidentified key codes still finish the wake gesture'
    );

    await sleep();
    await key('keydown');
    await appearance.evaluate((button) => {
      for (const type of ['pointerdown', 'pointerup'])
        button.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 99,
            button: 0,
            isPrimary: true,
            bubbles: true,
            cancelable: true
          })
        );
      button.click();
    });
    await key('keyup');
    assert.equal(
      await page.evaluate(() => C5App.getState().modal),
      null,
      'A paired Enter and pointer wake gesture must not click through'
    );
    await page.clock.fastForward(250);
    await appearance.click();
    await opened('The next pointer gesture works after a paired key and pointer wake');
    checks.push('Paired key and pointer wake events are consumed once; the next click works');

    await sleep();
    await key('keydown');
    for (let index = 0; index < 3; index++) {
      await page.clock.fastForward(1500);
      await key('keydown', 'Enter', true);
    }
    await page.clock.fastForward(1500);
    await appearance.evaluate((button) => button.click());
    assert.equal(
      await page.evaluate(() => C5App.getState().modal),
      null,
      'Continued key repeats must keep a held wake gesture suppressed beyond the safety timeout'
    );
    await key('keyup');
    await page.clock.fastForward(400);
    await appearance.evaluate((button) => button.click());
    await opened('Releasing a long held wake key frees the next click');
    checks.push('Continued wake key repeats extend suppression until the key is released');

    await sleep();
    await key('keydown');
    await page.clock.fastForward(250);
    await appearance.click();
    await opened(
      'A fresh pointer press must recover immediately when the wake key release is lost'
    );
    checks.push('A fresh pointer click works after a lost wake key release');

    await sleep();
    await page.evaluate(() =>
      document.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 99,
          button: 0,
          isPrimary: true,
          bubbles: true,
          cancelable: true
        })
      )
    );
    await page.clock.fastForward(250);
    await appearance.click();
    await opened(
      'A fresh pointer press must recover when a different wake pointer release is lost'
    );
    checks.push('A fresh pointer click works after a lost wake pointer release');

    await page.mouse.move(40, 40);
    await sleep();
    await page.mouse.move(60, 40);
    await appearance.click();
    await opened('Cursor movement must restore ordinary menu clicks');
    checks.push('Waking by moving the cursor leaves menu items clickable');

    await sleep();
    await key('keydown');
    await key('keydown');
    await key('keyup');
    await opened('A fresh nonrepeating OK press must recover when the wake key release is lost');
    checks.push('A fresh OK press works after a lost wake key release');

    for (const wake of ['key', 'pointer']) {
      await sleep();
      if (wake === 'key') await key('keydown');
      else
        await page.evaluate(() =>
          document.dispatchEvent(
            new PointerEvent('pointerdown', {
              pointerId: 99,
              button: 0,
              isPrimary: true,
              bubbles: true,
              cancelable: true
            })
          )
        );
      await page.clock.fastForward(2500);
      await appearance.evaluate((button) => button.click());
      await opened('Click-only remote input must recover after a lost ' + wake + ' release');
    }
    checks.push('Click-only remotes recover after a lost key or pointer release');

    assert.deepEqual(errors, []);
    return checks;
  } finally {
    await page.close();
  }
}

async function checkIdleLaunch(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [],
    checks = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    // Advance the real idle controller without making this check wait several minutes.
    await page.clock.install();
    await page.addInitScript(() =>
      localStorage.setItem(
        'lg-xmb-preferences-v1',
        JSON.stringify({
          screensaverDelay: 30000,
          screensaverBrightness: 0.25,
          motion: 'reduced'
        })
      )
    );
    await page.goto(url);
    await page.waitForFunction(() => window.C5App);
    await page.evaluate(() => {
      window.screensaverLaunches = [];
      window.C5TV = {
        ...C5TV,
        launch: async (id) => {
          screensaverLaunches.push(id);
          return { preview: true };
        }
      };
    });
    await menu.item(page, 'browser', 'com.webos.app.browser');
    await page.clock.fastForward(30010);
    assert.equal(await page.evaluate(() => C5App.getState().screensaver.active), true);
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await menu.activeItem(page, 'com.webos.app.browser').evaluate((button) => button.click());
    assert.deepEqual(await page.evaluate(() => screensaverLaunches), []);
    await page.clock.fastForward(1000);
    await page.keyboard.up('Enter');
    assert.deepEqual(await page.evaluate(() => screensaverLaunches), []);
    assert.equal(await page.evaluate(() => C5App.getState().itemOptions.open), false);
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => screensaverLaunches), ['com.webos.app.browser']);
    checks.push(
      'The real idle deadline activates the screensaver; a held OK wakes without launching, and the next OK launches normally'
    );

    await page.mouse.move(150, 150);
    await page.clock.fastForward(20000);
    await page.mouse.move(170, 150);
    await page.clock.fastForward(20000);
    assert.equal(await page.evaluate(() => C5App.getState().screensaver.active), false);
    await page.clock.fastForward(10010);
    assert.equal(await page.evaluate(() => C5App.getState().screensaver.active), true);
    const category = await page.evaluate(() => C5App.getState().category);
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down('ArrowLeft');
    await page.clock.fastForward(1000);
    await page.keyboard.up('ArrowLeft');
    assert.equal(await page.evaluate(() => C5App.getState().category), category);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => C5App.getState().category), 'apps');
    checks.push(
      'Cursor movement restarts the idle deadline; a held direction wakes without scrolling and the next direction works'
    );

    await menu.item(page, 'browser', 'com.webos.app.browser');
    await page.keyboard.press('F2');
    assert.equal(await page.evaluate(() => C5App.getState().itemOptions.open), true);
    const focus = await page.evaluate(() => document.activeElement.textContent);
    await page.clock.fastForward(30010);
    await page.waitForFunction(() => document.body.classList.contains('screensaver-asleep'));
    assert.equal(
      await page.locator('.item-options').evaluate((node) => getComputedStyle(node).opacity),
      '0'
    );
    assert.equal(
      await page.locator('.item-options').evaluate((node) => getComputedStyle(node).visibility),
      'hidden'
    );
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), focus);
    assert.equal(await page.evaluate(() => C5App.getState().itemOptions.open), true);
    checks.push(
      'An open long-press menu fades with the launcher and its focused action survives the wake gesture'
    );
    assert.deepEqual(errors, []);
    return checks;
  } finally {
    await page.close();
  }
}

(async () => {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const target = path.resolve(app, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!target.startsWith(app + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const data = await fs.readFile(target);
      response
        .writeHead(200, {
          'Content-Type': types[path.extname(target)] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        })
        .end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch(menu.launchOptions());
    const url = 'http://127.0.0.1:' + server.address().port;
    const recoveryChecks = await checkWakeRecovery(browser, url);
    const result = await checkScreensaver(browser, url);
    result.checks.push(...recoveryChecks);
    result.checks.push(...(await checkIdleLaunch(browser, url)));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
