// SPDX-License-Identifier: GPL-3.0-or-later
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { assetFor, download } = require('../tools/dev-tools.cjs');

const bytes = Buffer.from('fixture archive');
const asset = { name: 'fixture.tar.gz', url: 'https://example.invalid/fixture',
  sha256: createHash('sha256').update(bytes).digest('hex') };
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lg-xmb-tools-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('selects pinned archives for supported development hosts', () => {
  for (const [platform, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64'], ['win32', 'x64']]) {
    const result = assetFor(platform, arch);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.ok(result.url.endsWith(result.name));
    assert.ok(result.url.startsWith('https://github.com/webosbrew/ares-cli-rs/releases/download/v0.7.0/'));
  }
  assert.match(assetFor('win32', 'x64').name, /\.zip$/);
  assert.throws(() => assetFor('win32', 'arm64'), /No pinned/);
});

test('publishes only after checksum verification', async t => {
  const dir = await temporary(t);
  const output = await download(asset, dir, async () => new Response(bytes));
  assert.deepEqual(await fs.readFile(output), bytes);
  assert.deepEqual(await fs.readdir(dir), [asset.name]);
});

test('reuses a verified archive without network access', async t => {
  const dir = await temporary(t);
  await fs.writeFile(path.join(dir, asset.name), bytes);
  await download(asset, dir, () => { throw new Error('Network must not be called'); });
});

test('does not overwrite an unexpected existing archive', async t => {
  const dir = await temporary(t);
  const output = path.join(dir, asset.name);
  await fs.writeFile(output, 'keep me');
  await assert.rejects(download(asset, dir), /wrong checksum/);
  assert.equal(await fs.readFile(output, 'utf8'), 'keep me');
});

test('checksum failure leaves no archive or temporary files', async t => {
  const dir = await temporary(t);
  await assert.rejects(download(asset, dir, async () => new Response('wrong')), /checksum mismatch/);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('HTTP failure leaves no partial files', async t => {
  const dir = await temporary(t);
  await assert.rejects(download(asset, dir, async () => new Response('missing', { status: 404 })), /HTTP 404/);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('network failure leaves no partial files', async t => {
  const dir = await temporary(t);
  await assert.rejects(download(asset, dir, async () => { throw new Error('offline'); }), /offline/);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('rejects an oversized response before writing', async t => {
  const dir = await temporary(t);
  await assert.rejects(download(asset, dir, async () => new Response('x', {
    headers: { 'content-length': String(33 * 1024 * 1024) },
  })), /download limit/);
  assert.deepEqual(await fs.readdir(dir), []);
});
