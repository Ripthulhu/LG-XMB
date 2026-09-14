// Synthetic launch/media checks: no TV calls, native HDMI or thumbnail file reads.
const assert = require('node:assert/strict');

module.exports = async function checkLaunchReturn(browser, checks, errors) {
  async function createPage(mode = 'cached') {
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(previewMode => {
      localStorage.setItem('lg-xmb-preferences-v1', JSON.stringify({previewMode}));
      window.returnTest = {launches: [], thumbnails: 0, videos: 0, releases: 0,
        detailMutations: 0, toastMessages: [], waveCancels: 0, waveResumes: 0};
      window.Image = function() {
        this.removeAttribute = () => {};
        Object.defineProperty(this, 'src', {set: () => {
          returnTest.thumbnails++;
          setTimeout(() => { if (this.onerror) this.onerror(); }, 0);
        }});
      };
      const create = document.createElement.bind(document);
      document.createElement = function(name, ...args) {
        if (name === 'source') return create('span');
        const element = create(name, ...args);
        if (name === 'video') {
          returnTest.videos++;
          Object.defineProperty(element, 'readyState', {get: () => 0});
          element.play = () => Promise.resolve();
          element.pause = () => {};
          element.load = () => { returnTest.releases++; };
        }
        return element;
      };
    }, mode);
    await page.goto('http://127.0.0.1:8765');
    await page.waitForFunction(() => window.C5App && !['pending', 'compiling'].includes(C5App.getState().waveMode));
    await page.evaluate(() => {
      const launch = id => new Promise((resolve, reject) => returnTest.launches.push({id, resolve, reject}));
      window.C5TV = Object.assign({}, C5TV, {
        isTV: () => true, launch, openInput: launch,
        exitToStockHome: () => launch('com.webos.app.home'),
        getInputPreviewStatus: port => {
          const request = Promise.resolve({port, signal: null});
          request.cancel = () => {};
          return request;
        }
      });
      const observer = new MutationObserver(records => { returnTest.detailMutations += records.length; });
      ['detailType', 'detailTitle', 'detailDescription', 'detailEmblem'].forEach(id => {
        observer.observe(document.getElementById(id), {childList: true, subtree: true, characterData: true});
      });
      new MutationObserver(() => returnTest.toastMessages.push(document.getElementById('toast').textContent))
        .observe(document.getElementById('toast'), {childList: true, subtree: true, characterData: true});
      ['_cancel', '_resume'].forEach(method => {
        const original = C5Wave.prototype[method];
        C5Wave.prototype[method] = function(...args) {
          returnTest[method === '_cancel' ? 'waveCancels' : 'waveResumes']++;
          return original.apply(this, args);
        };
      });
    });
    return page;
  }

  const state = page => page.evaluate(() => C5App.getState());
  const home = page => page.evaluate(() => document.dispatchEvent(new Event('webOSRelaunch')));
  const complete = (page, index, failure) => page.evaluate(async ({index, failure}) => {
    const request = returnTest.launches[index];
    if (failure) request.reject(new Error(failure));
    else request.resolve({ok: true, preview: false});
    await Promise.resolve();
    await Promise.resolve();
  }, {index, failure});
  const snapshot = page => page.evaluate(() => ({
    busy: C5App.getState().busy,
    item: C5App.getState().item,
    title: document.getElementById('detailTitle').textContent,
    toast: document.getElementById('toast').textContent,
    toastVisible: document.getElementById('toast').classList.contains('show'),
    detailMutations: returnTest.detailMutations,
    thumbnails: returnTest.thumbnails,
    videos: returnTest.videos
  }));

  for (const interruption of ['hidden', 'pagehide', 'Home']) {
    const page = await createPage();
    try {
      for (const staleFailure of [null, 'Obsolete A failure']) {
        await home(page);
        const a = await page.evaluate(() => returnTest.launches.length);
        await page.keyboard.press('Enter');
        assert.equal((await state(page)).busy, true);
        await page.evaluate(kind => {
          if (kind === 'hidden') {
            Object.defineProperty(document, 'hidden', {configurable: true, value: true});
            document.dispatchEvent(new Event('visibilitychange'));
            Object.defineProperty(document, 'hidden', {configurable: true, value: false});
            document.dispatchEvent(new Event('visibilitychange'));
          } else if (kind === 'pagehide') {
            window.dispatchEvent(new Event('pagehide'));
            window.dispatchEvent(new Event('pageshow'));
          } else document.dispatchEvent(new Event('webOSRelaunch'));
        }, interruption);
        assert.equal((await state(page)).busy, false, interruption + ' invalidates the old launch');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        const b = a + 1;
        assert.equal(await page.evaluate(() => returnTest.launches.length), b + 1);
        assert.equal((await state(page)).busy, true);
        const beforeOldCompletion = await snapshot(page);
        await complete(page, a, staleFailure);
        assert.deepEqual(await snapshot(page), beforeOldCompletion, 'obsolete completion must not alter the current launch or detail');
        assert.equal(await page.locator('#items').getAttribute('aria-busy'), 'true');
        // Capture the transient toast before automation round trips can outlast
        // its normal 4.2-second lifetime on a busy software-rendering worker.
        const failureState = await page.evaluate(async index => {
          returnTest.launches[index].reject(new Error('Current B failure'));
          await Promise.resolve();
          await Promise.resolve();
          const toast = document.getElementById('toast');
          const result = {busy: C5App.getState().busy, text: toast.textContent,
            visible: toast.classList.contains('show'),
            obsoleteMessages: returnTest.toastMessages.some(text => /Obsolete A|Opening /.test(text))};
          Object.defineProperty(document, 'hidden', {configurable: true, value: true});
          document.dispatchEvent(new Event('visibilitychange'));
          result.afterHide = {text: toast.textContent, visible: toast.classList.contains('show')};
          return result;
        }, b);
        assert.equal(failureState.busy, false);
        assert.match(failureState.text, /Current B failure/);
        assert.equal(failureState.visible, true);
        assert.equal(failureState.obsoleteMessages, false);
        assert.deepEqual(failureState.afterHide, {text: '', visible: false}, 'hiding clears the existing fresh error immediately without a Home event');
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', {configurable: true, value: false});
          document.dispatchEvent(new Event('visibilitychange'));
        });
      }
      checks.push(interruption + ' invalidates earlier launches: late success/error cannot clear a newer launch, and fresh failures remain visible');
    } finally { await page.close(); }
  }

  const successPage = await createPage();
  try {
    await successPage.keyboard.press('Enter');
    await complete(successPage, 0, null);
    await successPage.waitForFunction(() => !C5App.getState().busy);
    assert.equal(await successPage.locator('#toast').innerText(), '');
    assert.equal(await successPage.locator('#toast').evaluate(el => el.classList.contains('show')), false);
    await home(successPage);
    assert.equal(await successPage.locator('#toast').innerText(), '');
    assert.equal(await successPage.evaluate(() => returnTest.toastMessages.some(text => /Opening /.test(text))), false);
    checks.push('Successful TV launches show no Opening toast before or after returning Home');
  } finally { await successPage.close(); }

  const stillPage = await createPage();
  try {
    const picture = await stillPage.evaluate(() => {
      window.Image = function () { return document.createElement('img'); };
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 9;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#d9ad79'; ctx.fillRect(0, 0, 16, 9);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    let failRefresh = false;
    await stillPage.route('**/thumbnails/hdmi*.png?*', async route => {
      if (failRefresh) await route.abort();
      else await route.fulfill({contentType: 'image/png', body: Buffer.from(picture, 'base64')});
    });
    await stillPage.getByRole('button', {name: 'Inputs', exact: true}).click();
    await stillPage.waitForFunction(() => C5App.getState().thumbnail.status === 'ready' && document.getElementById('inputThumbnail').naturalWidth === 16);
    const src = await stillPage.locator('#inputThumbnail').getAttribute('src');
    failRefresh = true;
    await stillPage.keyboard.press('Enter');
    assert.equal((await state(stillPage)).busy, true);
    assert.equal(await stillPage.locator('#previewPanel').isVisible(), true, 'launch keeps the outgoing preview panel in place');
    assert.equal(await stillPage.locator('#inputThumbnail').getAttribute('src'), src);
    await stillPage.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: true});
      document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide'));
    });
    assert.equal(await stillPage.locator('#inputThumbnail').getAttribute('src'), src);
    assert.equal(await stillPage.locator('#inputThumbnail').evaluate(el => el.hidden), false);
    await stillPage.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: false});
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('webOSRelaunch'));
    });
    await stillPage.waitForFunction(() => C5App.getState().thumbnail.status === 'ready');
    assert.equal(await stillPage.locator('#inputThumbnail').getAttribute('src'), src, 'failed refresh retains the last successful picture');
    assert.equal(await stillPage.locator('#inputThumbnail').isVisible(), true);
    assert.equal(await stillPage.locator('#toast').innerText(), '');
    await stillPage.keyboard.press('ArrowDown');
    assert.equal((await state(stillPage)).item, 'com.webos.app.hdmi2');
    assert.equal(await stillPage.locator('#inputThumbnail').getAttribute('src'), null, 'another input never inherits the previous input picture');
    checks.push('Cached HDMI picture and panel survive launch/hide/Home without clearing; failed refresh retains the still and changing ports clears it');
  } finally { await stillPage.close(); }

  for (const mode of ['cached', 'live']) {
    const page = await createPage(mode);
    try {
      for (let i = 0; i < 8 && (await state(page)).category !== 'inputs'; i++) await page.keyboard.press('ArrowLeft');
      assert.equal((await state(page)).category, 'inputs');
      if (mode === 'live') {
        await page.waitForFunction(() => C5App.getState().inputPreview.status === 'loading');
        await page.evaluate(() => document.querySelector('video').dispatchEvent(new Event('playing')));
      } else await page.waitForFunction(() => C5App.getState().thumbnail.status === 'missing');
      const previewDecoration = await page.locator('#previewButton').evaluate(button => ({
        text: button.textContent.trim(),
        visibleChildren: [...button.children].filter(child => child.getClientRects().length > 0).length,
        backgroundImage: getComputedStyle(button).backgroundImage,
        before: getComputedStyle(button, '::before').content,
        after: getComputedStyle(button, '::after').content
      }));
      assert.equal(previewDecoration.text, '');
      assert.equal(previewDecoration.visibleChildren, 0, 'the full-screen target has no visible play icon');
      assert.equal(previewDecoration.backgroundImage, 'none');
      assert.ok(['none', 'normal', '""'].includes(previewDecoration.before));
      assert.ok(['none', 'normal', '""'].includes(previewDecoration.after));
      await page.waitForTimeout(300);
      const beforeBurst = await snapshot(page);
      const burst = await page.evaluate(async () => {
        const before = {thumbnails: returnTest.thumbnails, videos: returnTest.videos,
          releases: returnTest.releases, detailMutations: returnTest.detailMutations,
          waveCancels: returnTest.waveCancels, waveResumes: returnTest.waveResumes};
        const video = document.querySelector('video');
        for (let i = 0; i < 3; i++) {
          document.dispatchEvent(new Event('webOSRelaunch'));
          window.dispatchEvent(new Event('pageshow'));
          document.dispatchEvent(new Event('visibilitychange'));
        }
        await Promise.resolve();
        return {thumbnailLoads: returnTest.thumbnails - before.thumbnails,
          videosCreated: returnTest.videos - before.videos,
          releases: returnTest.releases - before.releases,
          detailMutations: returnTest.detailMutations - before.detailMutations,
          waveCancels: returnTest.waveCancels - before.waveCancels,
          waveResumes: returnTest.waveResumes - before.waveResumes,
          sameVideo: document.querySelector('video') === video};
      });
      assert.equal((await state(page)).preferences.previewMode, mode);
      assert.equal((await state(page)).item, beforeBurst.item);
      assert.equal(burst.detailMutations, 0, 'unchanged detail content is not rewritten');
      assert.ok(burst.thumbnailLoads <= (mode === 'cached' ? 1 : 0), 'a return burst performs at most one eligible still refresh');
      assert.equal(burst.videosCreated, 0);
      assert.equal(burst.releases, 0);
      assert.equal(burst.sameVideo, true);
      assert.equal(burst.waveCancels, 0, 'redundant visible events do not reset the running wave');
      assert.equal(burst.waveResumes, 0, 'redundant visible events do not redraw/restart the running wave');
      if (mode === 'live') assert.equal((await state(page)).inputPreview.status, 'playing');
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {configurable: true, value: true});
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pagehide'));
      });
      assert.equal(await page.locator('video').count(), 0);
      const beforeReturn = await snapshot(page);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {configurable: true, value: false});
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pageshow'));
        document.dispatchEvent(new Event('webOSRelaunch'));
        window.dispatchEvent(new Event('pageshow'));
        document.dispatchEvent(new Event('webOSRelaunch'));
      });
      if (mode === 'live') await page.waitForFunction(() => C5App.getState().inputPreview.status === 'loading');
      else await page.waitForFunction(() => C5App.getState().thumbnail.status === 'missing');
      const afterReturn = await snapshot(page);
      assert.equal((await state(page)).preferences.previewMode, mode);
      assert.equal(afterReturn.item, beforeReturn.item);
      assert.equal(afterReturn.detailMutations, beforeReturn.detailMutations);
      assert.equal(afterReturn.videos - beforeReturn.videos, mode === 'live' ? 1 : 0);
      assert.ok(afterReturn.thumbnails - beforeReturn.thumbnails <= (mode === 'cached' ? 1 : 0));
      checks.push((mode === 'cached' ? 'Cached' : 'Live') + ' stays icon-free and survives hidden/Home return; repeated return events avoid redundant detail, image, video and wave work');
    } finally { await page.close(); }
  }
};
