// SPDX-License-Identifier: GPL-3.0-or-later
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {includeAppFile} = require('../tools/package-files.cjs');

test('package staging excludes a personal wallpaper and preserves app images', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-xmb-wallpaper-'));
  try {
    const app = path.join(temp, 'app'), output = path.join(temp, 'output');
    fs.mkdirSync(app);
    fs.writeFileSync(path.join(app, 'user-wallpaper.jpg'), 'private image');
    fs.writeFileSync(path.join(app, 'icon.png'), 'app icon');
    fs.cpSync(app, output, {recursive: true, filter: source => includeAppFile(app, source)});
    assert.deepEqual(fs.readdirSync(output), ['icon.png']);
    assert.match(fs.readFileSync(path.join(__dirname, '../.gitignore'), 'utf8'), /^app\/user-wallpaper\.jpg$/m);
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
});

test('package staging excludes a dangling wallpaper alias', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-xmb-wallpaper-link-'));
  try {
    const app = path.join(temp, 'app'), output = path.join(temp, 'output');
    fs.mkdirSync(app);
    try {
      fs.symlinkSync(path.join(temp, 'private.jpg'), path.join(app, 'user-wallpaper.jpg'));
    } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') {
        t.skip('Windows account cannot create symlinks; run this check on Linux.');
        return;
      }
      throw error;
    }
    fs.cpSync(app, output, {recursive: true, filter: source => includeAppFile(app, source)});
    assert.deepEqual(fs.readdirSync(output), []);
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
});
