// SPDX-License-Identifier: GPL-3.0-or-later
// Real shader pixels in screen coordinates. No preview server or TV connection.
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
      window.orientationWave = new C5Wave(document.getElementById('wave'), {
        preserveDrawingBuffer: true, adaptive: false
      });
      orientationWave.setReducedMotion(true);
    });
    await page.waitForFunction(() => orientationWave.mode === 'webgl');
    await page.evaluate(() => {
      const wave = orientationWave;
      wave.setPaused(true);
      wave.renderer.configure({ sampling: 1, particles: false, postprocess: 'off' });
      // Isolate the background while retaining its real cache and compositor.
      wave.renderer.wavePass = () => {};
      const NativeDate = Date;
      window.orientationDate = fields => {
        const stamp = new NativeDate(...fields).getTime();
        Date.now = () => stamp;
      };
      window.renderBackground = (colors, background = [0.15, 0.25, 0.4]) => {
        const renderer = wave.renderer, gl = wave.gl;
        const palette = LGXMBWaveColors.resolve(colors, new NativeDate(Date.now()));
        renderer.draw(wave.canvas.width, wave.canvas.height, [0, 0, 0], 1, background, palette);
        const width = wave.canvas.width, height = wave.canvas.height;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        // WebGL readback starts at the bottom. Expose named screen corners.
        function patch(x, y) {
          const rgb = [0, 0, 0], size = 8;
          for (let row = y; row < y + size; row++) {
            for (let column = x; column < x + size; column++) {
              const offset = (row * width + column) * 4;
              for (let channel = 0; channel < 3; channel++) rgb[channel] += pixels[offset + channel] / (size * size);
            }
          }
          return rgb;
        }
        if (gl.getError() !== gl.NO_ERROR) throw Error('Background pixel readback failed');
        return {
          topLeft: patch(0, height - 8), topRight: patch(width - 8, height - 8),
          bottomLeft: patch(0, 0), bottomRight: patch(width - 8, 0)
        };
      };
      window.monthlySamples = fields => {
        orientationDate(fields);
        const renderer = wave.renderer, gl = wave.gl;
        renderer.monthlyPass({ auto: true, month: 1, period: 'auto' });
        gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.monthlyFbo);
        const floating = renderer.monthlyTarget.format === gl.RGBA16F;
        const samples = [[4, 2], [59, 2], [4, 29], [59, 29]].map(([x, y]) => {
          const pixel = floating ? new Float32Array(4) : new Uint8Array(4);
          gl.readPixels(x, y, 1, 1, gl.RGBA, floating ? gl.FLOAT : gl.UNSIGNED_BYTE, pixel);
          return Array.from(pixel).slice(0, 3).map(value => floating ? value * 255 : value);
        });
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (gl.getError() !== gl.NO_ERROR) throw Error('Monthly pixel readback failed');
        return samples;
      };
    });

    const original = await page.evaluate(() => {
      orientationDate([2026, 8, 20, 1, 46, 0]);
      return renderBackground({ mode: 'ps3', dateMode: 'auto', timeMode: 'auto' });
    });
    for (const side of ['Left', 'Right']) {
      const top = original['top' + side], bottom = original['bottom' + side];
      assert.ok(bottom[0] > top[0] + 30 && bottom[1] > top[1] + 20,
        'PS3 September night must glow at the bottom: ' + JSON.stringify(original));
      assert.ok(top[0] < 15 && top[1] < 5, 'The upper PS3 night background stays dark');
    }
    checks.push('PS3 original matches the emulator: dark top, warm bottom on 20 September at 01:46');

    // Independent NumPy reference from ps3-gradient-backgrounds, evaluated at
    // texel centres (4.5,2.5), (59.5,2.5), (4.5,29.5), (59.5,29.5) on 64x32.
    // Cover night, day and the December/January blend, including left/right.
    const references = [
      { date: [2026, 8, 20, 1, 46, 0], pixels: [
        [57.64488, 35.16204, 9.87651], [50.22862, 30.83266, 7.32906],
        [6.66918, 0.12679, 7.78272], [4.65016, 0.14748, 4.25449]
      ] },
      { date: [2026, 0, 1, 12, 0, 0], pixels: [
        [159.76846, 159.76846, 159.76846], [150.241, 150.241, 150.241],
        [134.85391, 134.85391, 134.85391], [118.07482, 118.07482, 118.07482]
      ] },
      { date: [2026, 11, 31, 0, 0, 0], pixels: [
        [63.86772, 63.86772, 63.86772], [62.76172, 62.76172, 62.76172],
        [6.83563, 6.83563, 6.83563], [6.52489, 6.52489, 6.52489]
      ] }
    ];
    for (const reference of references) {
      const actual = await page.evaluate(date => monthlySamples(date), reference.date);
      actual.forEach((pixel, index) => pixel.forEach((value, channel) => {
        assert.ok(Math.abs(value - reference.pixels[index][channel]) < 2,
          'Recovered month output must match the independent reference: ' + JSON.stringify({ date: reference.date, actual }));
      }));
    }
    checks.push('Night, day and year-end month blending match independent reference pixels on both axes');

    const rgb = await page.evaluate(() => renderBackground({
      mode: 'rgb', red: 180, green: 120, blue: 60, top: 0, bottom: 1
    }));
    for (const side of ['Left', 'Right']) {
      assert.ok(rgb['bottom' + side][0] > rgb['top' + side][0] + 100,
        'Custom RGB top/bottom controls must match screen positions');
    }
    checks.push('Custom RGB top/bottom controls keep their screen direction through compositing');

    const theme = await page.evaluate(() => renderBackground({ mode: 'theme' }, [0.4, 0.6, 0.8]));
    for (const side of ['Left', 'Right']) {
      assert.ok(theme['bottom' + side][2] > theme['top' + side][2] + 10,
        'Regular themes keep their existing lower-edge brightness');
    }
    checks.push('Regular themes preserve their existing shading direction');

    const preset = await page.evaluate(() => renderBackground({
      mode: 'monthly', month: 11, dateMode: 'fixed', timeMode: 'night'
    }));
    assert.ok(preset.topLeft[0] > preset.bottomLeft[0] + 70,
      'Monthly presets retain the upstream top-down gradient convention');
    checks.push('Monthly presets retain their upstream orientation independently of PS3 original');
    assert.deepEqual(errors, []);
    await page.evaluate(() => orientationWave.destroy());
    console.log(JSON.stringify({ checks, original, rgb, theme, preset, testedOnTV: false }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
