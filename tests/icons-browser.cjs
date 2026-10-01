// SPDX-License-Identifier: GPL-3.0-or-later
// Check painted edges, including strokes, and translucent joins at menu sizes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {chromium} = require('playwright');
const {launchOptions} = require('./support/menu-navigation.cjs');
const source = fs.readFileSync(path.resolve(__dirname, '../app/icons.js'), 'utf8');
const window = {};
vm.runInNewContext(source, {window});
const names = [...source.matchAll(/^    (\w+):/gm)].map(match => match[1]);
assert.ok(names.length > 0, 'Found icon definitions to check');
const icons = Object.fromEntries(names.map(name => [name, window.C5Icon(name)]));
const choices = require('../app/icons.js').choices;
assert.equal(new Set(choices.map(choice => choice.id)).size, choices.length);
for (const choice of choices) {
  assert.ok(icons[choice.id], choice.id + ' uses defined artwork');
  assert.ok(choice.title, choice.id + ' has a picker label');
  assert.ok(!icons[choice.id].includes('settings-symbol'), choice.id + ' has no wrench badge');
  assert.ok(!['motion', 'info', 'remote'].includes(choice.id), choice.id + ' is a shortcut symbol');
}
const newIcons = ['disc', 'mediasearch', 'headset', 'display', 'handheld', 'pc', 'streamer', 'console'];
for (const name of newIcons) assert.ok(choices.some(choice => choice.id === name));

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({acceptDownloads: false});
    const checks = await page.evaluate(async icons => {
      const checks = [];
      for (const [name, svg] of Object.entries(icons)) {
        for (const size of [48, 72, 144]) {
          const canvas = document.createElement('canvas');
          // Overscan catches artwork that the normal viewBox would silently clip.
          const border = 12;
          canvas.width = canvas.height = size + 2 * border;
          const image = new Image();
          const padding = border * 48 / size;
          image.src = 'data:image/svg+xml;base64,' + btoa(svg
            .replace('viewBox="0 0 48 48"', 'viewBox="' + -padding + ' ' + -padding + ' ' + (48 + 2 * padding) + ' ' + (48 + 2 * padding) + '"')
            .replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg" width="' + canvas.width + '" height="' + canvas.height + '" style="color:rgba(255,255,255,.39)"'));
          await image.decode();
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let maximum = 0, outside = 0, filled = 0;
          let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
          let frameLeft = canvas.width, frameRight = 0, frameTop = canvas.height, frameBottom = 0;
          const rightOverhang = name === 'live' ? Math.ceil(3.1 * size / 48) : 0;
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const alpha = pixels[(y * canvas.width + x) * 4 + 3];
              maximum = Math.max(maximum, alpha);
              if (alpha) filled++;
              if (alpha > 10) {
                left = Math.min(left, x); top = Math.min(top, y);
                right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
                // The TV's screen, not its upper-right signal, sits on the
                // menu anchor. These cuts cross the frame beyond the arcs.
                if (name === 'live' && y === border + Math.round(size / 2)) {
                  frameLeft = Math.min(frameLeft, x); frameRight = Math.max(frameRight, x + 1);
                }
                if (name === 'live' && x === border + Math.round(size / 4)) {
                  frameTop = Math.min(frameTop, y); frameBottom = Math.max(frameBottom, y + 1);
                }
              }
              if (x < border || y < border || x >= size + border + rightOverhang || y >= size + border)
                outside = Math.max(outside, alpha);
            }
          }
          checks.push({name, size, maximum, outside, filled,
            width: (right - left) * 48 / size,
            height: (bottom - top) * 48 / size,
            centerX: ((left + right) / 2 - border) * 48 / size,
            centerY: ((top + bottom) / 2 - border) * 48 / size,
            frameX: ((frameLeft + frameRight) / 2 - border) * 48 / size,
            frameY: ((frameTop + frameBottom) / 2 - border) * 48 / size});
        }
      }
      return checks;
    }, icons);
    for (const check of checks) {
      const label = check.name + ' at ' + check.size + 'px';
      assert.ok(check.filled > 0, label + ' paints');
      assert.ok(check.maximum <= 100, label + ' has no brighter overlapping fills');
      assert.equal(check.outside, 0, label + ' stays within its artwork bounds');
      if (check.name === 'live') {
        assert.ok(Math.abs(check.frameX - 24) <= 0.6, label + ' centers the TV screen horizontally');
        // The native frame sits slightly below its texture centre.
        assert.ok(Math.abs(check.frameY - 24.6) <= 0.6, label + ' retains the native TV screen height');
        assert.ok(check.width >= 43, label + ' retains the broadcast arcs');
      }
      if (newIcons.includes(check.name) || check.name === 'network') {
        assert.ok(Math.max(check.width, check.height) >= 39, label + ' matches the XMB icon scale');
        assert.ok(Math.max(check.width, check.height) <= 44, label + ' leaves room around its silhouette');
        assert.ok(Math.abs(check.centerX - 24) <= 1, label + ' is horizontally centered');
        assert.ok(Math.abs(check.centerY - 24) <= 1, label + ' is vertically centered');
      }
    }
    assert.equal(window.C5Icon('camera'), window.C5Icon('image'));
    assert.equal(window.C5Icon('game'), window.C5Icon('apps'));
    assert.equal(window.C5Icon('unknown'), window.C5Icon('application'));
    console.log('Checked ' + names.length + ' icons at three sizes: no clipping or bright joins.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
