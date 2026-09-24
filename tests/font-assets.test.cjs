'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { includeAppFile } = require('../tools/package-files.cjs');
const app = path.resolve('app');

test('normal builds exclude personal fonts even when they exist locally', () => {
  for (const file of ['user-fonts', 'user-fonts/SCE-PS3-RD-R-LATIN2.TTF', 'media-fonts', 'media-fonts/SCE-PS3-RD-R-LATIN2.TTF']) {
    assert.equal(includeAppFile(app, path.join(app, file)), false);
  }
  assert.equal(includeAppFile(app, path.join(app, 'fonts.css')), true);
});

test('personal builds include only the three supported faces', () => {
  const include = (file) => includeAppFile(app, path.join(app, file), { personalFonts: true });
  assert.equal(include('user-fonts'), true);
  for (const weight of ['L', 'R', 'B']) {
    assert.equal(include(`user-fonts/SCE-PS3-RD-${weight}-LATIN2.TTF`), true);
  }
  for (const file of [
    'user-fonts/notes.txt',
    'user-fonts/other.ttf',
    'user-fonts/nested',
    'user-music.mp3'
  ]) {
    assert.equal(include(file), false);
  }
});


test('font sources use only the media folder, with system font fallback', () => {
  const fs = require('node:fs');
  const css = fs.readFileSync(path.join(app, 'fonts.css'), 'utf8');
  assert.doesNotMatch(css, /url\(['"]?user-fonts\//);
  for (const weight of ['L', 'R', 'B']) {
    assert.ok(css.includes('media-fonts/SCE-PS3-RD-' + weight + '-LATIN2.TTF'));
  }
  assert.ok(css.includes("'LG Smart UI', 'Segoe UI', Arial, sans-serif"));
});
