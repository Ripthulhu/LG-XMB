// Real WebGL pixel checks in installed Edge; no TV or external requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true});
  const checks = [], errors = [];
  try {
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<canvas id="testWave" style="width:1280px;height:720px"></canvas>');
    // The native renderer's script chain, in the order index.html uses. The two
    // data files are the local reference pack; without them C5Wave reports a
    // static backdrop and this check cannot run.
    for (const module of ['wave-colors.js', 'ps3-native-data.js', 'ps3-background-data.js', 'ps3-background-clock.js',
      'ps3-particle-birth.js', 'ps3-native-core.js', 'ps3-native-shaders.js', 'ps3-native-renderer.js']) {
      await page.addScriptTag({path: path.resolve(__dirname, '../app/' + module)});
    }
    await page.evaluate(() => {
      // The app runs without preserveDrawingBuffer (it was half the C5's GPU
      // work). This check reads pixels back after presentation, which only
      // works with a preserved buffer, so it asks for one explicitly.
      window.waveTest = new C5Wave(document.getElementById('testWave'), {quality: '720p', adaptive: false, preserveDrawingBuffer: true});
      waveTest.setReducedMotion(true);
      window.pixelState = () => {
        const gl = waveTest.gl, canvas = waveTest.canvas;
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let hash = 2166136261, nonblack = 0;
        for (let i = 0; i < pixels.length; i++) {
          hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0;
          if (i % 4 !== 3 && pixels[i] !== 0) nonblack++;
        }
        return {width: canvas.width, height: canvas.height, hash, nonblack};
      };
    });
    await page.waitForFunction(() => waveTest.mode === 'webgl');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const context = await page.evaluate(() => waveTest.getDiagnostics());
    assert.equal(context.capabilities.contextAttributes.preserveDrawingBuffer, true, 'the test instance asked for a preserved buffer');
    assert.equal(context.quality, '720p');
    assert.equal(context.targetFps, 60);
    const painted = await page.evaluate(() => pixelState());
    assert.deepEqual([painted.width, painted.height], [1280, 720]);
    assert.ok(painted.nonblack > 0, 'the retained frame contains rendered colour after presentation');
    checks.push('Native WebGL 2 keeps a nonblack presented frame with 720p backing and a 60 fps target');

    await page.evaluate(() => {
      // Count repaints, not GL calls: one repaint is several draws on the wire.
      window.waveDraws = 0;
      const draw = waveTest.draw.bind(waveTest);
      waveTest.draw = (...args) => { waveDraws++; return draw(...args); };
      waveTest.setPaused(true);
      Object.defineProperty(document, 'hidden', {configurable: true, value: true});
      document.dispatchEvent(new Event('visibilitychange'));
      waveTest.canvas.style.width = '1000px'; waveTest.canvas.style.height = '600px';
      waveTest.resize();
      waveTest.canvas.style.width = '960px'; waveTest.canvas.style.height = '540px';
      waveTest.resize();
    });
    await page.waitForTimeout(60);
    const hidden = await page.evaluate(() => ({pixels: pixelState(), draws: waveDraws,
      resizePending: waveTest.resizePending, raf: waveTest.raf}));
    assert.deepEqual(hidden.pixels, painted, 'hidden transient sizes must not clear or replace the last frame');
    assert.equal(hidden.draws, 0);
    assert.equal(hidden.raf, 0);
    assert.equal(hidden.resizePending, true);
    checks.push('Hidden resize events preserve identical last-frame pixels without drawing or scheduling animation');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: false});
      document.dispatchEvent(new Event('visibilitychange'));
      waveTest.setPaused(false);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const resumed = await page.evaluate(() => ({pixels: pixelState(), draws: waveDraws,
      resizePending: waveTest.resizePending, raf: waveTest.raf}));
    assert.deepEqual([resumed.pixels.width, resumed.pixels.height], [960, 540]);
    assert.ok(resumed.pixels.nonblack > 0);
    assert.equal(resumed.draws, 1, 'only the latest deferred size is painted, once');
    assert.equal(resumed.raf, 0, 'reduced motion remains still');
    assert.equal(resumed.resizePending, false);
    checks.push('Resume applies the latest deferred geometry and repaints once, retaining reduced-motion behavior');

    await page.evaluate(() => { waveTest.resize(); waveTest.resize(); });
    const unchanged = await page.evaluate(() => ({pixels: pixelState(), draws: waveDraws}));
    assert.deepEqual(unchanged.pixels, resumed.pixels);
    assert.equal(unchanged.draws, resumed.draws);
    checks.push('Unchanged-size events neither clear the frame nor redraw it');

    // The production default: no preserved buffer.
    const production = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.style.width = '640px'; c.style.height = '360px'; document.body.appendChild(c);
      window.waveDefault = new C5Wave(c, {quality: '540p', adaptive: false});
      waveDefault.setReducedMotion(true);
      return new Promise(resolve => {
        const poll = () => waveDefault.mode === 'webgl' || waveDefault.mode === 'static' ? resolve(waveDefault.getDiagnostics()) : setTimeout(poll, 20);
        poll();
      });
    });
    assert.equal(production.mode, 'webgl');
    assert.equal(production.capabilities.contextAttributes.preserveDrawingBuffer, false, 'production requests no preserved buffer');
    checks.push('Default construction requests no preserved drawing buffer');
    assert.deepEqual(errors, []);
    await page.evaluate(() => { waveDefault.destroy(); waveTest.destroy(); });
    const result = {passed: checks.length, checks, browser: await browser.version(), testedOnTV: false,
      preserveDrawingBuffer: false, nativePerformanceAndPresentationVerified: false};
    const output = path.resolve(__dirname, '../qa/wave-retention-check.json');
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
