// Browser checks synthesize native-media events; no HDMI source or capture is opened.
const assert = require('node:assert/strict');
const menu = require('./support/menu-navigation.cjs');
module.exports = async function checkInputPreview(browser, checks, errors) {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  try {
    await page.addInitScript(() => {
      window.inputTest = {created: 0, maxAttached: 0, releases: [], launches: [], statusRequests: 0, thumbnails: []};
      // Missing local thumbnails exercise the real icon fallback without file requests.
      window.Image = function() {
        this.removeAttribute = () => {};
        Object.defineProperty(this, 'src', {set: src => {
          inputTest.thumbnails.push(src);
          setTimeout(() => { if (this.onerror) this.onerror(); }, 0);
        }});
      };
      const create = document.createElement.bind(document);
      document.createElement = function(name, ...args) {
        if (name === 'source') return create('span');
        const element = create(name, ...args);
        if (name === 'video') {
          inputTest.created++;
          Object.defineProperty(element, 'readyState', {get: () => 0});
          element.play = function() {
            inputTest.maxAttached = Math.max(inputTest.maxAttached, document.querySelectorAll('video').length);
            return Promise.resolve();
          };
          element.pause = function() { this._testPaused = true; };
          element.load = function() {
            inputTest.releases.push({paused: this._testPaused, children: this.children.length, src: this.getAttribute('src')});
          };
        }
        return element;
      };
    });
    const installBridge = () => page.evaluate(() => {
      window.C5TV = Object.assign({}, C5TV, {
        isTV: () => true,
        getInputPreviewStatus: port => {
          inputTest.statusRequests++;
          const request = Promise.resolve({port, signal: null});
          request.cancel = () => {};
          return request;
        },
        openInput: id => {
          inputTest.launches.push({id, attached: document.querySelectorAll('video').length});
          return new Promise((resolve, reject) => { inputTest.resolveLaunch = resolve; inputTest.rejectLaunch = reject; });
        }
      });
    });
    await page.goto('http://127.0.0.1:8765');
    await page.waitForFunction(() => window.C5App);
    await installBridge();
    const state = () => page.evaluate(() => C5App.getState());
    const loading = () => page.waitForFunction(() => C5App.getState().inputPreview.status === 'loading');
    const ready = () => page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('playing')));
    const home = () => page.evaluate(() => document.dispatchEvent(new Event('webOSRelaunch')));
    const visibility = hidden => page.evaluate(value => {
      Object.defineProperty(document, 'hidden', {configurable: true, value});
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    const assertIdle = async () => {
      assert.equal((await state()).inputPreview.status, 'idle');
      assert.equal(await page.locator('video').count(), 0);
    };
    const openPreviewSetting = async () => {
      await menu.item(page, 'settings', 'previews');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#modalTitle').innerText(), 'Input previews');
    };
    const setMode = async mode => {
      await openPreviewSetting();
      await page.getByRole('button', {name: mode === 'live' ? 'Live' : 'Cached', exact: true}).click();
      assert.equal((await state()).preferences.previewMode, mode);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lg-xmb-preferences-v1')).previewMode), mode);
      await page.keyboard.press('Escape');
    };
    const finishLaunch = async failed => {
      await page.evaluate(fail => fail ? inputTest.rejectLaunch(new Error('Test launch failure')) : inputTest.resolveLaunch({ok: true, preview: false}), failed);
      await page.waitForFunction(() => !C5App.getState().busy);
    };
    const reload = async () => {
      await page.reload(); await page.waitForFunction(() => window.C5App); await installBridge();
    };

    await menu.item(page, 'tv', 'com.webos.app.hdmi1');
    await page.waitForTimeout(450);
    assert.equal((await state()).preferences.previewMode, 'cached');
    await assertIdle();
    assert.equal(await page.locator('#previewPanel').isVisible(), true);
    assert.equal(await page.locator('#thumbnailFallback').isVisible(), true);
    assert.equal(await page.evaluate(() => inputTest.created), 0);
    assert.equal(await page.evaluate(() => inputTest.statusRequests), 0);
    assert.equal((await state()).thumbnail.status, 'missing');
    assert.ok(await page.evaluate(() => inputTest.thumbnails.every(src => /^thumbnails\/hdmi[1-4]\.png\?t=\d+$/.test(src))));
    checks.push('Cached is the default: selecting HDMI shows a local-still slot with a quiet fallback and no video or status requests');

    await page.locator('#previewButton').focus();
    await assertIdle();
    await page.keyboard.press('Enter');
    assert.equal((await state()).busy, true);
    assert.deepEqual(await page.evaluate(() => inputTest.launches), [{id: 'com.webos.app.hdmi1', attached: 0}]);
    await finishLaunch(false);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', repeat: true, bubbles: true, cancelable: true})));
    assert.equal(await page.evaluate(() => inputTest.launches.length), 1);
    await home(); await page.waitForTimeout(450); await assertIdle();
    assert.equal((await state()).preferences.previewMode, 'cached');
    checks.push('One OK opens fullscreen in Cached mode; focus alone does nothing, held OK cannot repeat, and Home returns to Cached');

    await page.locator('#previewButton').click();
    assert.equal((await state()).busy, true);
    assert.equal(await page.evaluate(() => inputTest.launches.length), 2);
    await finishLaunch(false); await home();
    await page.getByRole('option', {name: 'HDMI 2', exact: true}).click();
    assert.equal((await state()).busy, true);
    assert.equal(await page.evaluate(() => inputTest.launches.length), 3);
    assert.equal(await page.evaluate(() => inputTest.launches[2].id), 'com.webos.app.hdmi2');
    await finishLaunch(true); await page.waitForTimeout(450); await assertIdle();
    assert.equal(await page.evaluate(() => inputTest.created), 0);
    checks.push('One click on either the cached picture or an HDMI row opens fullscreen; failed launch returns to Cached without creating video');

    await setMode('live');
    checks.push('Settings Input previews offers Cached and Live, and saves the selected mode locally');
    const createdBeforeNavigation = await page.evaluate(() => inputTest.created);
    // Dispatch this rapid sequence in one browser task. Separate automation
    // round trips can outlast the 400 ms debounce on a busy rendering worker.
    const burst = await page.evaluate(() => {
      const press = key => {
        document.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
        document.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles: true, cancelable: true}));
      };
      const target = C5Catalog.findIndex(category => category.id === 'tv');
      for (let i = 0; i < C5Catalog.length; i++) {
        const current = C5Catalog.findIndex(category => category.id === C5App.getState().category);
        if (current === target) break;
        press(current < target ? 'ArrowRight' : 'ArrowLeft');
      }
      const entered = C5App.getState();
      press('ArrowDown');
      const moved = C5App.getState();
      press('ArrowRight');
      return {entered, moved, left: C5App.getState()};
    });
    assert.equal(burst.entered.category, 'tv');
    assert.equal(burst.entered.inputPreview.status, 'waiting');
    assert.equal(burst.moved.inputPreview.status, 'waiting');
    assert.equal(burst.moved.inputPreview.port, 3);
    assert.equal(burst.left.inputPreview.status, 'idle');
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => inputTest.created), createdBeforeNavigation);
    await assertIdle();
    await menu.category(page, 'tv'); await loading();
    assert.equal((await state()).inputPreview.port, 3);
    assert.deepEqual(await page.locator('video').evaluate(v => [v.defaultMuted, v.muted, v.volume]), [true, true, 0]);
    await ready();
    await page.locator('video').evaluate(v => v.dispatchEvent(new Event('stalled')));
    assert.equal((await state()).inputPreview.status, 'playing');
    assert.equal((await state()).inputPreview.video.currentTime, 0);
    checks.push('Only Live automatically starts the settled selected HDMI, muted; rapid navigation cancels allocation and native stalled/zero-time events stay usable');

    const beforeBack = await state();
    const backLaunches = await page.evaluate(() => inputTest.launches.length);
    await page.keyboard.press('Escape'); await page.keyboard.press('Backspace');
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 461, bubbles: true, cancelable: true})));
    assert.equal((await state()).item, beforeBack.item);
    assert.equal((await state()).inputPreview.status, 'playing');
    assert.equal(await page.evaluate(() => inputTest.launches.length), backLaunches);
    checks.push('Back on the main menu leaves selection and Live mode unchanged, including TV Back keycode 461');

    await page.keyboard.press('Enter');
    assert.equal((await state()).busy, true); await assertIdle();
    assert.equal(await page.evaluate(() => inputTest.launches.length), backLaunches + 1);
    assert.equal(await page.evaluate(() => inputTest.launches.at(-1).attached), 0);
    await finishLaunch(false); await assertIdle();
    await home(); await loading();
    assert.equal((await state()).preferences.previewMode, 'live');
    assert.equal((await state()).inputPreview.port, 3);
    await page.keyboard.press('Enter'); await assertIdle();
    await finishLaunch(true); await loading();
    assert.ok(await page.evaluate(() => inputTest.launches.every(x => x.attached === 0)));
    checks.push('One OK opens fullscreen in Live mode after immediate release; Home and failed launch restore the chosen Live preview');

    await ready();
    await visibility(true); await assertIdle();
    assert.equal((await state()).thumbnail.port, 3, 'hidden Home retains its still selection while suspending all loading');
    const hiddenImages = await page.evaluate(() => inputTest.thumbnails.length);
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => inputTest.thumbnails.length), hiddenImages);
    await visibility(false); await loading();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await assertIdle();
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow'))); await loading();
    await menu.category(page, 'settings');
    await page.waitForTimeout(450); await assertIdle();
    checks.push('Live playback releases on hidden/pagehide and returns only with the selected mode; category departure removes the native source');

    // Live mode may already have made its legitimate delayed signal check.
    // Cached must add no requests, rather than erase earlier Live requests.
    const statusBeforeCached = await page.evaluate(() => inputTest.statusRequests);
    await setMode('cached');
    await menu.item(page, 'tv', 'com.webos.app.hdmi1'); await page.waitForTimeout(450); await assertIdle();
    const createdBeforeCached = await page.evaluate(() => inputTest.created);
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown'); await home();
    await page.waitForTimeout(450); await assertIdle();
    assert.equal(await page.evaluate(() => inputTest.created), createdBeforeCached);
    assert.equal(await page.evaluate(() => inputTest.statusRequests), statusBeforeCached);
    assert.equal(await page.evaluate(() => inputTest.maxAttached), 1);
    assert.ok(await page.evaluate(() => inputTest.releases.every(r => r.paused && r.children === 0 && r.src === null)));
    await reload();
    assert.equal((await state()).preferences.previewMode, 'cached');
    await menu.item(page, 'tv', 'com.webos.app.hdmi1'); await page.waitForTimeout(450); await assertIdle();
    assert.equal(await page.evaluate(() => inputTest.created), 0);
    assert.equal(await page.evaluate(() => inputTest.statusRequests), 0);
    checks.push('Choosing Cached stops Live, saves the mode, and keeps navigation, Home return and reload free of media or status requests');

    await setMode('live'); await reload();
    assert.equal((await state()).preferences.previewMode, 'live');
    await menu.item(page, 'tv', 'com.webos.app.hdmi1'); await loading();
    await page.locator('video').evaluate(v => v.firstChild.dispatchEvent(new Event('error')));
    assert.equal((await state()).inputPreview.status, 'unavailable');
    assert.equal(await page.locator('video').count(), 0);
    assert.equal(await page.locator('.input-preview-message').innerText(), 'Preview unavailable');
    await page.keyboard.press('Enter');
    assert.equal((await state()).busy, true);
    assert.deepEqual(await page.evaluate(() => inputTest.launches), [{id: 'com.webos.app.hdmi1', attached: 0}]);
    await finishLaunch(false);
    checks.push('Live mode survives reload; an unavailable preview still permits fullscreen with one OK');

    for (const saved of [{inputPreviews: true}, {previewMode: true}, {previewMode: 'LIVE'}, {previewMode: 'invalid'}]) {
      await page.evaluate(value => localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify(value)), saved);
      await reload();
      assert.equal((await state()).preferences.previewMode, 'cached');
      await menu.item(page, 'tv', 'com.webos.app.hdmi1'); await page.waitForTimeout(450); await assertIdle();
      assert.equal('inputPreviews' in (await state()).preferences, false);
      assert.equal(await page.evaluate(() => inputTest.created), 0);
    }
    checks.push('Old inputPreviews=true and invalid new previewMode values safely fall back to Cached');
    assert.ok(requests.every(url => url.startsWith('http://127.0.0.1:8765/')));
    checks.push('Preview preference and lifecycle checks make no external requests');
  } finally {
    await page.close();
  }
};
