// SPDX-License-Identifier: GPL-3.0-or-later
// Real WebGL state and pixels. Command counts are not GPU timing measurements.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchOptions } = require('./support/menu-navigation.cjs');

async function main() {
  const browser = await chromium.launch(launchOptions());
  const checks = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<style>body{margin:0}canvas{width:640px;height:360px}</style><canvas id="wave"></canvas>');
    for (const name of ['wave-colors', 'ps3-native-data', 'ps3-background-data',
      'ps3-background-clock', 'ps3-particle-birth', 'ps3-native-core',
      'ps3-native-shaders', 'ps3-native-renderer']) {
      await page.addScriptTag({ path: path.resolve(__dirname, '../app/' + name + '.js') });
    }
    await page.evaluate(() => {
      Date.now = () => new Date(2026, 8, 20, 12, 0, 0).getTime();
      window.testWave = new C5Wave(document.getElementById('wave'), {
        preserveDrawingBuffer: true, adaptive: false
      });
      testWave.setReducedMotion(true);
      // This setter also works before the renderer has been created.
      testWave.setQuality({ particles: true, particleCount: 2000 });
      window.frameState = () => {
        testWave.draw();
        const gl = testWave.gl, canvas = testWave.canvas;
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let hash = 2166136261, nonblack = 0;
        for (let i = 0; i < pixels.length; i++) {
          hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0;
          if (i % 4 !== 3 && pixels[i]) nonblack++;
        }
        return { hash, nonblack, error: gl.getError(), particles: testWave.renderer.lastCount };
      };
    });
    await page.waitForFunction(() => testWave.mode === 'webgl');
    const original = await page.evaluate(() => frameState());
    assert.equal(original.error, 0);
    assert.ok(original.nonblack > 0);
    assert.ok(original.particles > 0);

    const measured = await page.evaluate(() => {
      const renderer = testWave.renderer, gl = testWave.gl, calls = {};
      for (const name of ['uniform1i', 'uniform1f', 'uniform2f', 'uniform2fv',
        'uniform3fv', 'uniform4fv', 'uniform1fv']) {
        const original = gl[name].bind(gl);
        gl[name] = function () {
          calls[name] = (calls[name] || 0) + 1;
          return original(...arguments);
        };
      }
      window.configurations = 0;
      const configure = renderer.configure.bind(renderer);
      renderer.configure = function () { configurations++; return configure(...arguments); };
      testWave.draw();
      const uniforms = Object.values(calls).reduce((a, b) => a + b, 0);
      for (let i = 0; i < 20; i++) testWave.draw();
      return { uniforms, calls: { ...calls }, configurations, frame: frameState() };
    });
    assert.equal(measured.uniforms, 30, 'stable frame uploads only dynamic particle values');
    assert.equal(measured.calls.uniform4fv, 4 * 21, 'two wave basis uploads and two particle projections per frame');
    assert.equal(measured.configurations, 0, 'drawing does not normalize unchanged quality settings');
    assert.deepEqual(measured.frame, original);
    checks.push('Repeated draws preserve pixels with 30 uniform uploads per frame and no quality normalization');

    const changed = await page.evaluate(() => {
      testWave.setPaused(true);
      testWave.setQuality({ sampling: 1.25, softness: 3, postprocess: 'wave', strength: 'strong' });
      testWave.setQuality({ sampling: 1.25, softness: 3, postprocess: 'wave', strength: 'strong' });
      const state = { configurations, settings: { ...testWave.renderer.settings } };
      testWave.setPaused(false);
      state.filtered = frameState();
      testWave.setQuality({ sampling: 1, softness: 1.5, postprocess: 'off', strength: 'normal' });
      state.restored = frameState();
      return state;
    });
    assert.equal(changed.configurations, 1, 'paused settings update once; identical settings are inert');
    assert.equal(changed.settings.sampling, 1.25);
    assert.equal(changed.settings.postprocess, 'wave');
    assert.equal(changed.filtered.error, 0);
    assert.notEqual(changed.filtered.hash, original.hash, 'quality change reaches the renderer');
    assert.deepEqual(changed.restored, original);
    checks.push('Settings set before initialization or while paused apply on resume without changing restored pixels');

    const resized = await page.evaluate(() => {
      testWave.canvas.style.width = '480px';
      testWave.canvas.style.height = '360px';
      testWave.resize();
      const smaller = frameState();
      testWave.canvas.style.width = '640px';
      testWave.resize();
      return { smaller, restored: frameState() };
    });
    assert.equal(resized.smaller.error, 0);
    assert.notEqual(resized.smaller.hash, original.hash);
    assert.deepEqual(resized.restored, original);
    checks.push('Aspect and size changes update projection while retaining the particle material');

    const transitioned = await page.evaluate(() => {
      const theme = { background: '#08101c', wave: '#518aab' };
      testWave.setTheme({ ...theme, colors: { mode: 'ps3', dateMode: 'manual', month: 8, timeMode: 'night' } });
      const monthly = frameState();
      testWave.setQuality({ particles: false });
      const disabled = frameState();
      testWave.setQuality({ particles: true });
      testWave.setTheme(theme);
      return { monthly, disabled, restored: frameState() };
    });
    assert.equal(transitioned.monthly.error, 0);
    assert.equal(transitioned.disabled.particles, 0);
    assert.deepEqual(transitioned.restored, original);
    checks.push('Colour-source and particle toggles keep the same restored frame');

    await page.evaluate(() => {
      window.oldRenderer = testWave.renderer;
      window.lossExtension = testWave.gl.getExtension('WEBGL_lose_context');
      if (!lossExtension) throw new Error('Context-loss test extension unavailable');
      lossExtension.loseContext();
    });
    await page.waitForFunction(() => testWave.contextLost);
    await page.evaluate(() => lossExtension.restoreContext());
    await page.waitForFunction(() => !testWave.contextLost && testWave.mode === 'webgl' && testWave.renderer !== oldRenderer);
    const restored = await page.evaluate(() => frameState());
    assert.deepEqual(restored, original, 'new programs receive their immutable material again');
    checks.push('Context restoration rebuilds materials and reproduces the same frame');
    assert.deepEqual(errors, []);
    await page.evaluate(() => testWave.destroy());
    console.log(JSON.stringify({ passed: checks.length, checks, browser: await browser.version(),
      steadyFrameUniformUploads: measured.uniforms, testedOnTV: false }, null, 2));
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
