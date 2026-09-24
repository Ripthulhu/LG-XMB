// SPDX-License-Identifier: GPL-3.0-or-later
// Exercise individual rendering controls through the real menu, without TV access.
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');
const menu = require('./support/menu-navigation.cjs');
const app = path.resolve(__dirname, '../app');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg'};
(async () => {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(app, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(app + path.sep)) return response.writeHead(403).end();
      const bytes = await fs.readFile(file);
      response.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store'}).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(menu.launchOptions());
  try {
    for (const [width, height] of [[1920, 1080], [1280, 720]]) {
      const page = await browser.newPage({viewport: {width, height}}), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const state = () => page.evaluate(() => C5App.getState());
      const group = name => page.getByRole('group', {name, exact: true});
      async function open() {
        await menu.item(page, 'settings', 'appearance');
        await page.keyboard.press('Enter');
        await page.locator('#openAppearanceAdvanced').click();
      }
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.waitForFunction(() => window.C5App && C5App.getState().waveMode === 'webgl');
      await open();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'showWavesOnly');
      const initial = await state(), unchanged = initial.preferences;
      assert.equal(await group('Rendering quality').count(), 0);
      assert.equal(await group('Render resolution').locator('[aria-pressed=true]').getAttribute('data-choice'), '1.5');
      async function choose(name, label, expected) {
        const button = group(name).getByRole('button', {name: label, exact: true});
        await button.focus();
        const before = await page.locator('#modalContent').evaluate(node => node.scrollTop);
        await page.keyboard.press('Enter');
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.choice), String(expected));
        assert.equal(await page.locator('#modalContent').evaluate(node => node.scrollTop), before);
        return state();
      }
      for (const scale of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
        const value = await choose('Render resolution', scale * 100 + '%', scale);
        const render = value.waveDiagnostics.surface;
        assert.equal(render.requestedScale, scale);
        assert.equal(render.effectiveScale, scale);
        assert.equal(render.surfaceWidth, Math.floor(initial.waveDiagnostics.backingWidth * scale));
        assert.equal(render.surfaceHeight, Math.floor(initial.waveDiagnostics.backingHeight * scale));
        assert.equal(value.waveDiagnostics.backingWidth, initial.waveDiagnostics.backingWidth);
        assert.equal(value.waveDiagnostics.backingHeight, initial.waveDiagnostics.backingHeight);
        assert.equal(render.postWidth, initial.waveDiagnostics.backingWidth);
        assert.equal(render.postHeight, initial.waveDiagnostics.backingHeight);
        assert.equal(value.preferences.waveFrameRate, unchanged.waveFrameRate);
        assert.equal(value.preferences.waveDetail, unchanged.waveDetail);
      }
      for (const [label, detail, gridSize] of [['Low', 'coarse', 32], ['Medium', 'standard', 64], ['High', 'high', 128]]) {
        const value = await choose('Mesh detail', label, detail);
        assert.equal(value.waveDiagnostics.surface.grid, gridSize);
        assert.equal(value.waveDiagnostics.surface.vertices, gridSize * gridSize);
      }
      for (const count of [500, 1000, 2000, 4000]) {
        const value = await choose('Particle count', count.toLocaleString('en-US'), count);
        assert.equal(value.preferences.waveParticleCount, count);
        assert.equal(value.waveDiagnostics.renderQuality.particleCount, count);
        assert.ok(value.waveDiagnostics.surface.particleCount <= count);
      }
      for (const fps of [20, 30, 60]) {
        const value = await choose('Frame rate', fps + ' fps', fps);
        assert.equal(value.waveDiagnostics.targetFps, fps);
      }
      await choose('Render resolution', '50%', 0.5);
      await choose('Frame rate', '20 fps', 20);
      await choose('Mesh detail', 'Low', 'coarse');
      await choose('Particle count', '500', 500);
      const saved = (await state()).preferences;
      for (const key of ['theme', 'colour', 'waveSpeed', 'motion']) assert.equal(saved[key], unchanged[key]);
      await page.reload();
      await page.waitForFunction(() => window.C5App && C5App.getState().waveMode === 'webgl');
      await open();
      assert.deepEqual((await state()).preferences, saved);
      assert.equal((await state()).waveDiagnostics.surface.effectiveScale, 0.5);
      assert.equal((await state()).waveDiagnostics.surface.grid, 32);
      assert.equal((await state()).waveDiagnostics.targetFps, 20);
      await group('Render resolution').getByRole('button', {name: '200%', exact: true}).focus();
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.closest('section').getAttribute('aria-label')), 'Mesh detail');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(width + '×' + height + ': wave resolution, meshes, particle counts, frame caps, persistence and navigation passed');
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
