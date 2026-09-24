// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone local preview checks. Never installs on or connects to a TV.
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

async function checkClock(browser, url) {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    locale: 'en-GB',
    timezoneId: 'Europe/Amsterdam'
  });
  const checks = [],
    errors = [],
    externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === url) return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  const state = () => page.evaluate(() => C5App.getState());
  const choice = (label) =>
    page
      .getByRole('group', { name: 'Clock style', exact: true })
      .getByRole('button', { name: label, exact: true });
  async function screenshot(name) {
    if (!process.env.OPENXMB_SCREENSHOT_DIR) return;
    await fs.mkdir(process.env.OPENXMB_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.OPENXMB_SCREENSHOT_DIR, name) });
  }
  async function closePanels() {
    while ((await state()).modal) await page.keyboard.press('Escape');
  }
  async function openPanel(id = 'openClock') {
    await closePanels();
    await menu.item(page, 'settings', 'appearance');
    await page.keyboard.press('Enter');
    await page.locator('#' + id).click();
  }
  async function angles() {
    return page.locator('.clock-hour,.clock-minute').evaluateAll((nodes) =>
      nodes.map((node) => {
        const matrix = node.transform.baseVal.consolidate().matrix;
        return ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360;
      })
    );
  }
  async function expectHands(hour, minute) {
    const actual = await angles();
    for (const [index, expected] of [hour, minute].entries()) {
      const delta = Math.abs(actual[index] - expected);
      assert.ok(
        Math.min(delta, 360 - delta) < 0.01,
        'Clock hand ' +
          index +
          ' should point to ' +
          expected +
          ' degrees, received ' +
          actual[index]
      );
    }
  }
  async function expectCurrent() {
    assert.equal((await state()).preferences.clockStyle, 'current');
    assert.equal(await page.locator('.clock').getAttribute('data-style'), 'current');
    assert.equal(await page.locator('.clock-face').isVisible(), false);
    const current = await page.locator('.clock').evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        border: style.borderTopWidth,
        background: style.backgroundColor,
        shadow: style.boxShadow,
        timeBeforeDate:
          document.getElementById('time').getBoundingClientRect().right <=
          document.getElementById('date').getBoundingClientRect().left,
        expectedDate: new Date().toLocaleDateString('en-GB', {
          weekday: 'short',
          day: '2-digit',
          month: 'short'
        })
      };
    });
    assert.equal(current.border, '0px');
    assert.equal(current.background, 'rgba(0, 0, 0, 0)');
    assert.equal(current.shadow, 'none');
    assert.equal(current.timeBeforeDate, true);
    assert.equal(await page.locator('#date').textContent(), current.expectedDate);
  }
  async function expectPS3Layout() {
    const layout = await page.locator('.clock').evaluate((node) => {
      const box = node.getBoundingClientRect(),
        style = getComputedStyle(node);
      const date = node.querySelector('#date').getBoundingClientRect();
      const time = node.querySelector('#time').getBoundingClientRect();
      const face = node.querySelector('.clock-face').getBoundingClientRect();
      return {
        right: box.right,
        width: innerWidth,
        inView: [box, date, time, face].every(
          (rect) =>
            rect.left >= 0 &&
            rect.right <= innerWidth + 0.5 &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight
        ),
        dateBeforeTime: date.right <= time.left,
        timeBeforeFace: time.right <= face.left,
        aligned:
          Math.abs((date.top + date.bottom) / 2 - (time.top + time.bottom) / 2) < 1 &&
          Math.abs((face.top + face.bottom) / 2 - (time.top + time.bottom) / 2) < 1,
        hasBorder: parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle === 'solid',
        overflow: document.documentElement.scrollWidth > innerWidth,
        pointerEvents: style.pointerEvents
      };
    });
    assert.ok(Math.abs(layout.right - layout.width) < 0.5, 'PS3 bar reaches the right screen edge');
    for (const key of ['inView', 'dateBeforeTime', 'timeBeforeFace', 'aligned', 'hasBorder'])
      assert.equal(layout[key], true, key);
    assert.equal(layout.overflow, false);
    assert.equal(layout.pointerEvents, 'none');
    assert.equal(await page.locator('.clock-face').isVisible(), true);
    assert.equal(await page.locator('.clock-face circle').count(), 1);
    assert.equal(await page.locator('.clock-face').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('.clock button,.clock a,.clock [tabindex="0"]').count(), 0);
  }
  async function ready() {
    await page.waitForFunction(() => window.C5App && window.LGXMBClockView);
  }
  try {
    await page.clock.install({ time: new Date('2026-09-20T09:45:00+02:00') });
    await page.addInitScript(() => {
      // Keep time/layout assertions deterministic without disabling clock updates.
      if (!localStorage.getItem('lg-xmb-preferences-v1'))
        localStorage.setItem(
          'lg-xmb-preferences-v1',
          JSON.stringify({ motion: 'reduced', screensaverDelay: 0 })
        );
      window.clockTimeWrites = [];
      let timeAPI;
      Object.defineProperty(window, 'LGXMBSystemTime', {
        configurable: true,
        get: () => timeAPI,
        set: (api) => {
          timeAPI = Object.assign({}, api, {
            set: (utc) => {
              clockTimeWrites.push(utc);
              return Promise.reject(new Error('Clock appearance must not set TV time'));
            }
          });
        }
      });
    });
    await page.goto(url);
    await ready();
    assert.equal((await state()).preferences.clockStyle, 'ps3');
    await expectPS3Layout();
    checks.push('New settings default to the PS3 clock');
    await openPanel();
    await choice('Current').click();
    await closePanels();
    await expectCurrent();
    assert.equal(await page.locator('#time').textContent(), '09:45');
    await screenshot('clock-current-1080.png');
    checks.push(
      'Current remains available with its original time and date formatting'
    );

    await openPanel();
    assert.equal((await state()).modal, 'clock');
    assert.deepEqual(
      await page
        .getByRole('group', { name: 'Clock style', exact: true })
        .locator('button')
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.choice)),
      ['current', 'ps3']
    );
    assert.equal(await choice('Current').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), 'current');
    for (const [direction, value, label] of [
      ['ArrowRight', 'ps3', 'PS3'],
      ['ArrowLeft', 'current', 'Current'],
      ['ArrowRight', 'ps3', 'PS3']
    ]) {
      await page.keyboard.press(direction);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), value);
      await page.keyboard.press('Enter');
      assert.equal((await state()).preferences.clockStyle, value);
      assert.equal(await page.locator('.clock').getAttribute('data-style'), value);
      assert.equal(await choice(label).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), value);
    }
    await choice('Current').click();
    await expectCurrent();
    await choice('PS3').click();
    assert.equal(await page.locator('#date').textContent(), '20/9');
    assert.equal(await page.locator('#time').textContent(), '9:45');
    await expectHands(292.5, 270);
    assert.equal(await page.locator('#toast').textContent(), '');
    await screenshot('clock-settings-1080.png');
    await page.keyboard.press('Escape');
    assert.equal((await state()).modal, 'appearance');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'openClock');
    checks.push(
      'Clock choices apply immediately by pointer or remote; selection and Back focus stay on the correct controls'
    );

    await closePanels();
    for (const [width, height] of [
      [1920, 1080],
      [1280, 720]
    ]) {
      await page.setViewportSize({ width, height });
      await expectPS3Layout();
      await screenshot('clock-ps3-' + height + '.png');
      await openPanel();
      await choice('PS3').focus();
      assert.equal(
        await page.evaluate(() => {
          const box = document.activeElement.getBoundingClientRect();
          return (
            box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
          );
        }),
        true
      );
      await screenshot('clock-settings-' + height + '.png');
      await closePanels();
    }
    checks.push(
      'The PS3 bar reaches the right edge with date, time and analog face aligned and unclipped at 1080p and 720p'
    );
    assert.deepEqual(await page.evaluate(() => clockTimeWrites), []);

    await page.reload();
    await ready();
    assert.equal((await state()).preferences.clockStyle, 'ps3');
    assert.equal(await page.locator('.clock').getAttribute('data-style'), 'ps3');
    await openPanel();
    assert.equal(await choice('PS3').getAttribute('aria-pressed'), 'true');
    await choice('Current').click();
    await page.reload();
    await ready();
    await expectCurrent();
    await page.evaluate(() => {
      const key = 'lg-xmb-preferences-v1',
        preferences = JSON.parse(localStorage.getItem(key));
      preferences.clockStyle = '__proto__';
      localStorage.setItem(key, JSON.stringify(preferences));
    });
    await page.reload();
    await ready();
    assert.equal((await state()).preferences.clockStyle, 'ps3');
    await expectPS3Layout();
    checks.push(
      'Both styles survive reload; an unsupported stored style safely returns to PS3'
    );

    await openPanel();
    await choice('PS3').click();
    await closePanels();
    await page.clock.setSystemTime(new Date('2026-09-30T23:59:30+02:00'));
    await page.clock.fastForward(11000);
    assert.equal(await page.locator('#time').textContent(), '23:59');
    assert.equal(await page.locator('#date').textContent(), '30/9');
    await expectHands(359.5, 354);
    await page.clock.fastForward(30000);
    assert.equal(await page.locator('#time').textContent(), '0:00');
    assert.equal(await page.locator('#date').textContent(), '1/10');
    await expectHands(0, 0);
    await page.clock.fastForward(60000);
    assert.equal(await page.locator('#time').textContent(), '0:01');
    await expectHands(0.5, 6);
    checks.push(
      'The launcher timer advances digital time, analog hands and the date through midnight and a month rollover'
    );

    for (const label of ['Current', 'PS3']) {
      await openPanel();
      await choice(label).click();
      await openPanel('openScreensaver');
      const brightness = page.getByRole('group', { name: 'Background brightness', exact: true });
      await brightness.getByRole('button', { name: '25%', exact: true }).click();
      const next = brightness.getByRole('button', { name: '50%', exact: true });
      const box = await next.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.locator('#previewScreensaver').evaluate((button) => button.click());
      await page.clock.fastForward(1300);
      await page.waitForFunction(() => document.body.classList.contains('screensaver-asleep'));
      assert.equal((await state()).screensaver.active, true);
      assert.equal(await page.locator('.clock').isVisible(), false);
      assert.equal(
        await page.locator('#screen').evaluate((node) => getComputedStyle(node).opacity),
        '0'
      );
      await page.mouse.down();
      await page.mouse.up();
      await page.clock.fastForward(300);
      await page.waitForFunction(() => !document.body.classList.contains('screensaver-transition'));
      assert.equal((await state()).screensaver.active, false);
      assert.equal(
        (await state()).screensaver.brightness,
        0.25,
        'Wake click cannot change a hidden option'
      );
      assert.equal(await page.locator('.clock').isVisible(), true);
      assert.equal(
        await page.locator('#screen').evaluate((node) => getComputedStyle(node).opacity),
        '1'
      );
      await page.mouse.down();
      await page.mouse.up();
      assert.equal(
        (await state()).screensaver.brightness,
        0.5,
        'The next deliberate click still works'
      );
      assert.equal(
        await page.locator('.clock').getAttribute('data-style'),
        label === 'PS3' ? 'ps3' : 'current'
      );
    }
    checks.push(
      'Both clocks hide and restore with the screensaver; wake clicks are consumed once and the next click works'
    );
    assert.deepEqual(await page.evaluate(() => clockTimeWrites), []);
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(errors, []);
    checks.push(
      'Changing clock appearance never calls the TV time editor and all browser requests stay on the local preview'
    );
    return { checks, errors, testedOnTV: false };
  } finally {
    await page.close();
  }
}

async function captureReferencePreviews(browser, url) {
  if (!process.env.OPENXMB_SCREENSHOT_DIR) return [];
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    timezoneId: 'Europe/Amsterdam',
    locale: 'en-GB'
  });
  const paths = [],
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === url ? route.continue() : route.abort()
  );
  try {
    await page.clock.setFixedTime(new Date('2026-09-20T17:30:00+02:00'));
    await page.addInitScript(() =>
      localStorage.setItem(
        'lg-xmb-preferences-v1',
        JSON.stringify({
          colour: 8,
          clockStyle: 'current',
          motion: 'reduced',
          screensaverDelay: 0
        })
      )
    );
    await page.goto(url);
    await page.waitForFunction(() => window.C5App && C5App.getState().waveMode === 'webgl');
    const initial = await page.evaluate(() => C5App.getState());
    await fs.mkdir(process.env.OPENXMB_SCREENSHOT_DIR, { recursive: true });
    for (const [label, style] of [
      ['Current', 'current'],
      ['PS3', 'ps3']
    ]) {
      await menu.item(page, 'settings', 'appearance');
      await page.keyboard.press('Enter');
      await page.locator('#openClock').click();
      await page
        .getByRole('group', { name: 'Clock style', exact: true })
        .getByRole('button', { name: label, exact: true })
        .click();
      while (await page.evaluate(() => C5App.getState().modal)) await page.keyboard.press('Escape');
      await menu.item(page, initial.category, initial.item);
      await page.waitForFunction(() => !C5App.getState().detailPending);
      for (const [width, height] of [
        [1920, 1080],
        [1280, 720]
      ]) {
        await page.setViewportSize({ width, height });
        const target = path.resolve(
          process.env.OPENXMB_SCREENSHOT_DIR,
          'clock-reference-' + style + '-' + height + '.png'
        );
        await page.screenshot({ path: target });
        paths.push(target);
      }
    }
    assert.deepEqual(errors, []);
    return paths;
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
    const result = await checkClock(browser, url);
    const referenceScreenshots = await captureReferencePreviews(browser, url);
    if (referenceScreenshots.length) result.referenceScreenshots = referenceScreenshots;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
