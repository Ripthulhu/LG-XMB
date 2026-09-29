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
          canvas.width = canvas.height = size + 12;
          const image = new Image();
          const padding = 6 * 48 / size;
          image.src = 'data:image/svg+xml;base64,' + btoa(svg
            .replace('viewBox="0 0 48 48"', 'viewBox="' + -padding + ' ' + -padding + ' ' + (48 + 2 * padding) + ' ' + (48 + 2 * padding) + '"')
            .replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg" width="' + canvas.width + '" height="' + canvas.height + '" style="color:rgba(255,255,255,.39)"'));
          await image.decode();
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let maximum = 0, outside = 0, filled = 0;
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const alpha = pixels[(y * canvas.width + x) * 4 + 3];
              maximum = Math.max(maximum, alpha);
              if (alpha) filled++;
              if (x < 6 || y < 6 || x >= size + 6 || y >= size + 6)
                outside = Math.max(outside, alpha);
            }
          }
          checks.push({name, size, maximum, outside, filled});
        }
      }
      return checks;
    }, icons);
    for (const check of checks) {
      const label = check.name + ' at ' + check.size + 'px';
      assert.ok(check.filled > 0, label + ' paints');
      assert.ok(check.maximum <= 100, label + ' has no brighter overlapping fills');
      assert.equal(check.outside, 0, label + ' fits its viewBox');
    }
    assert.equal(window.C5Icon('camera'), window.C5Icon('image'));
    assert.equal(window.C5Icon('game'), window.C5Icon('apps'));
    assert.equal(window.C5Icon('unknown'), window.C5Icon('application'));
    console.log('Checked ' + names.length + ' icons at three sizes: no clipping or bright joins.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
