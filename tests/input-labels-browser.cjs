// Real app/bridge, synthetic PalmServiceBridge replies; no TV or external requests.
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const menu = require('./support/menu-navigation.cjs');

module.exports = async function checkInputLabels(browser, checks, errors) {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080},
    userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/87.0.4280.88 Safari/537.36'});
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(() => {
    // The UA activates TV detection; it does not emulate Chromium 87.
    localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify({motion: 'reduced'}));
    window.labelTest = {reads: [], launches: [], commands: [], images: 0, videos: 0, releases: 0};
    window.PalmSystem = {identifier: 'org.local.openxmb.c5'};
    window.PalmServiceBridge = function () {
      this.cancel = () => { if (this.read) this.read.cancelled = true; };
      this.call = (uri, json) => {
        const payload = JSON.parse(json), reply = this.onservicecallback;
        if (uri === 'luna://com.webos.service.eim/getAllInputStatus') {
          this.read = {reply, payload, cancelled: false};
          labelTest.reads.push(this.read);
          return;
        }
        let result = {returnValue: true};
        if (uri.endsWith('/listApps')) result.apps = [];
        else if (uri.endsWith('/getAppLoadStatus')) result.exist = true;
        else if (uri.endsWith('/launch')) labelTest.launches.push(payload.id);
        else if (uri.endsWith('/getStatus')) result.video = [];
        else if (uri.endsWith('/exec')) {
          labelTest.commands.push(payload.command);
          result = {returnValue: false};
        } else throw new Error('Unexpected native operation: ' + uri);
        queueMicrotask(() => reply(JSON.stringify(result)));
      };
    };
    window.Image = function () {
      this.removeAttribute = () => {};
      Object.defineProperty(this, 'src', {set: () => {
        labelTest.images++;
        queueMicrotask(() => { if (this.onerror) this.onerror(); });
      }});
    };
    const create = document.createElement.bind(document);
    document.createElement = function (name, ...args) {
      if (name === 'source') return create('span');
      const element = create(name, ...args);
      if (name === 'video') {
        labelTest.videos++;
        Object.defineProperty(element, 'readyState', {get: () => 4});
        element.play = () => { queueMicrotask(() => element.dispatchEvent(new Event('playing'))); return Promise.resolve(); };
        element.pause = () => {};
        element.load = () => { labelTest.releases++; };
      }
      return element;
    };
  });
  const count = () => page.evaluate(() => labelTest.reads.length);
  const home = () => page.evaluate(() => document.dispatchEvent(new Event('webOSRelaunch')));
  const reply = async (index, label, failure = false) => {
    await page.evaluate(({index, label, failure}) => {
      const devices = label === null ? [] : [{id: 'HDMI_2', port: 2,
        appId: 'com.webos.app.hdmi2', label, connected: false,
        icon: 'https://example.invalid/tracker.png', subList: [{labelName: 'Not the chosen name'}]}];
      labelTest.reads[index].reply(JSON.stringify(failure ? {returnValue: false, errorCode: -1} :
        {returnValue: true, devices}));
    }, {index, label, failure});
    // Flush both bridge normalization and the app's awaiting continuation.
    await page.evaluate(() => Promise.resolve());
  };
  // Navigation lets the detail panel follow a moment later; read it once it has.
  const title = async () => { await page.waitForFunction(() => !C5App.getState().detailPending); return page.locator('#detailTitle').textContent(); };
  const state = () => page.evaluate(() => C5App.getState());
  const hide = () => page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, value: true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const show = () => page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, value: false});
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
  });
  try {
    await page.goto(pathToFileURL(path.resolve(__dirname, '../app/index.html')).href);
    await page.waitForFunction(() => window.C5App && labelTest.reads.length === 1);
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    const setupCommands = await page.evaluate(() => labelTest.commands.slice());
    assert.equal(setupCommands.length, 1, 'one independent bundled-helper setup');
    assert.match(setupCommands[0], /helper-startup\.py ensure/);
    assert.equal((await state()).busy, false);
    await menu.item(page, 'tv', 'com.webos.app.hdmi2');
    assert.equal(await title(), 'HDMI 2');
    await reply(0, null, true);
    assert.equal(await title(), 'HDMI 2');
    assert.equal(await page.locator('#toast').textContent(), '');
    assert.deepEqual(await page.evaluate(() => labelTest.commands), setupCommands, 'denied label discovery adds no root fallback');
    checks.push('Denied input-label discovery leaves usable HDMI defaults without root fallback or an error toast');

    await home();
    const first = (await count()) - 1;
    await home();
    assert.equal(await count(), first + 1, 'duplicate Home events share one pending read');
    await page.evaluate(() => { labelTest.row = document.querySelector('#items > .rows:not(.parked) > [data-item="com.webos.app.hdmi2"]'); labelTest.focus = document.activeElement; });
    await reply(first, 'PS3 Konsola do gier');
    assert.equal(await title(), 'PS3 Konsola do gier');
    assert.equal(await page.locator('#detailType').textContent(), 'HDMI 2');
    assert.equal(await page.locator('#detailDescription').textContent(), 'Switch to HDMI 2.');
    assert.equal(await page.locator('#previewButton').getAttribute('aria-label'), 'Open PS3 Konsola do gier full-screen');
    assert.equal((await state()).item, 'com.webos.app.hdmi2');
    assert.equal(await menu.activeRows(page).count(), await page.evaluate(() =>
      C5Catalog.find(category => category.id === 'tv').items.length));
    const ports = await menu.activeRows(page).evaluateAll(rows => rows.filter(row =>
      /^com\.webos\.app\.hdmi[1-4]$/.test(row.dataset.item)).map(row => row.dataset.item));
    assert.deepEqual(ports, [1, 2, 3, 4].map(port => 'com.webos.app.hdmi' + port));
    assert.equal(await menu.activeItem(page, 'com.webos.app.livetv').getAttribute('aria-label'), 'Live TV');
    assert.equal(await menu.activeItem(page, 'com.webos.app.lgchannels').getAttribute('aria-label'), 'LG Channels');
    assert.equal(await page.evaluate(() => labelTest.row === document.querySelector('#items > .rows:not(.parked) > [data-item="com.webos.app.hdmi2"]') &&
      labelTest.focus === document.activeElement), true);
    await page.waitForFunction(() => document.getElementById('selectionLive').textContent.includes('PS3 Konsola do gier'));
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), storage);
    checks.push('Native labels update rows, selected details and accessibility text without changing focus, ports or saved preferences');

    await home();
    await reply((await count()) - 1, null);
    assert.equal(await title(), 'PS3 Konsola do gier', 'an omitted port retains its last successful name');
    await home();
    const stale = (await count()) - 1;
    await hide();
    assert.equal(await page.evaluate(index => labelTest.reads[index].cancelled, stale), true);
    await reply(stale, 'Obsolete name');
    assert.equal(await title(), 'PS3 Konsola do gier');
    await show();
    const current = (await count()) - 1;
    assert.equal(current, stale + 1);
    await reply(stale, 'Still obsolete');
    await home();
    assert.equal(await count(), current + 1, 'stale completion must not clear a newer pending read');
    await reply(current, 'Console 🎮');
    assert.equal(await title(), 'Console 🎮');
    await home();
    await reply((await count()) - 1, null, true);
    assert.equal(await title(), 'Console 🎮');
    checks.push('Foreground refresh retains good labels across partial/failed replies and ignores cancelled callbacks after returning');

    await home();
    const pending = (await count()) - 1;
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !C5App.getState().busy && labelTest.launches.length === 1);
    assert.deepEqual(await page.evaluate(() => labelTest.launches), ['com.webos.app.hdmi2']);
    await menu.category(page, 'settings');
    await page.keyboard.press('Enter');
    assert.equal((await state()).modal, 'appearance');
    await page.evaluate(() => { labelTest.dialogFocus = document.activeElement; });
    await reply(pending, 'New console');
    assert.equal((await state()).modal, 'appearance');
    assert.equal(await page.evaluate(() => labelTest.dialogFocus === document.activeElement), true);
    await page.keyboard.press('Escape');
    await menu.category(page, 'tv');
    assert.equal((await state()).item, 'com.webos.app.hdmi2');
    assert.equal(await title(), 'New console');
    checks.push('A pending label read never blocks a launch or steals dialog focus, and category selection survives the update');

    await home();
    await reply((await count()) - 1, '  ');
    assert.equal(await title(), 'HDMI 2');
    assert.equal(await page.locator('#detailType').textContent(), 'INPUT');
    await home();
    await reply((await count()) - 1, '<img src=x onerror=alert(1)>');
    assert.equal(await title(), '<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('#detailTitle img, .item-text img').count(), 0);
    checks.push('Cleared native names restore HDMI labels; markup is displayed literally and never loaded as an image');

    await menu.item(page, 'settings', 'previews');
    await page.keyboard.press('Enter');
    assert.equal((await state()).modal, 'previews');
    await page.getByRole('button', {name: 'Live', exact: true}).click();
    await page.keyboard.press('Escape');
    await menu.category(page, 'tv');
    await page.waitForFunction(() => C5App.getState().inputPreview.status === 'playing');
    await home();
    const before = await page.evaluate(() => ({videos: labelTest.videos, releases: labelTest.releases,
      images: labelTest.images}));
    await page.evaluate(() => { labelTest.video = document.querySelector('video'); });
    await reply((await count()) - 1, 'Living room PC');
    assert.equal(await title(), 'Living room PC');
    assert.equal((await state()).inputPreview.port, 2);
    assert.equal(await page.evaluate(() => labelTest.video === document.querySelector('video')), true);
    assert.deepEqual(await page.evaluate(() => ({videos: labelTest.videos, releases: labelTest.releases,
      images: labelTest.images})), before);
    await home();
    const afterLaunchRead = (await count()) - 1;
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !C5App.getState().busy && labelTest.launches.length === 2);
    assert.equal((await state()).inputPreview.status, 'idle');
    const stopped = await page.evaluate(() => ({videos: labelTest.videos, releases: labelTest.releases,
      images: labelTest.images}));
    await reply(afterLaunchRead, 'PC after launch');
    assert.equal(await title(), 'PC after launch');
    // The native launch reply can arrive before the platform hides Home.
    await page.waitForTimeout(700);
    assert.equal((await state()).inputPreview.status, 'idle');
    assert.deepEqual(await page.evaluate(() => ({videos: labelTest.videos, releases: labelTest.releases,
      images: labelTest.images})), stopped);
    checks.push('A late label update cannot restart an input preview between launch confirmation and page hide');
    const settled = await count();
    await page.waitForTimeout(300);
    assert.equal(await count(), settled, 'label reads have no background polling loop');
    assert.ok(requests.every(url => url.startsWith('file:')), 'no native icon URLs or network requests');
    assert.deepEqual(errors, []);
    checks.push('Renaming an active preview keeps its video element and HDMI port without image reloads or background polling');
  } finally {
    await page.close();
  }
};

if (require.main === module) {
  const fs = require('node:fs');
  const {chromium} = require('playwright');
  (async () => {
    const browser = await chromium.launch(menu.launchOptions());
    const checks = [], errors = [];
    try {
      await module.exports(browser, checks, errors);
      const result = {passed: checks.length, checks, browser: await browser.version(), testedOnTV: false};
      const output = path.resolve(__dirname, '../qa/input-labels-check.json');
      fs.mkdirSync(path.dirname(output), {recursive: true});
      fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(result, null, 2));
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
