// SPDX-License-Identifier: GPL-3.0-or-later
// Download only. No extraction, global installation or device access.
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const VERSION = 'v0.7.0';
// GitHub release asset digests, checked 2026-09-14:
// https://github.com/webosbrew/ares-cli-rs/releases/tag/v0.7.0
const ASSETS = Object.freeze({
  'linux-x64': ['linux-x86_64.tar.gz', 'be49153274939dba1ba180940144e3b1265911538a013c4c17342c6bc41fc5fc'],
  'linux-arm64': ['linux-aarch64.tar.gz', 'dd35c60939c0024a26eeb1268c13a6c539fd129c293080ebc2901bb29346fd99'],
  'darwin-x64': ['macos-x86_64.tar.gz', '1fe90d6577ffdd00f904260eb906d70a3ec2ff5e2b5846599961d9e85217b644'],
  'darwin-arm64': ['macos-aarch64.tar.gz', '9991cec27382a558885bef439437d2a0bdf9db6da38944ed463ada16fa8e4d22'],
  'win32-x64': ['windows-x86_64.zip', '289ebfe024244b4bdada59177e1d97434cb34e23ea5fd73afb4c21b305d801d9'],
});
const MAX_BYTES = 32 * 1024 * 1024;

function assetFor(platform = process.platform, arch = process.arch) {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) throw new Error(`No pinned webOS tools archive for ${platform}/${arch}.`);
  const name = `ares-cli-rs-${VERSION}-${asset[0]}`;
  return { name, sha256: asset[1],
    url: `https://github.com/webosbrew/ares-cli-rs/releases/download/${VERSION}/${name}` };
}

async function matches(file, sha256) {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.size > MAX_BYTES) return false;
    const bytes = await fs.readFile(file);
    return createHash('sha256').update(bytes).digest('hex') === sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function download(asset, directory, fetchImpl = fetch) {
  await fs.mkdir(directory, { recursive: true });
  const output = path.join(directory, asset.name);
  try {
    await fs.lstat(output);
    if (await matches(output, asset.sha256)) return output;
    throw new Error(`Existing archive has the wrong checksum: ${output}. Remove it after inspection.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const tempDir = await fs.mkdtemp(path.join(directory, '.download-'));
  const partial = path.join(tempDir, 'archive');
  let handle;
  try {
    const response = await fetchImpl(asset.url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}.`);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body.cancel();
      throw new Error('Tools archive exceeds the download limit.');
    }
    handle = await fs.open(partial, 'wx', 0o600);
    const hash = createHash('sha256');
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > MAX_BYTES) throw new Error('Tools archive exceeds the download limit.');
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    await handle.close();
    handle = null;
    if (hash.digest('hex') !== asset.sha256) throw new Error('Tools archive checksum mismatch.');
    // Publish without replacing a file created by another downloader.
    try { await fs.link(partial, output); }
    catch (error) {
      if (error.code !== 'EEXIST' || !await matches(output, asset.sha256)) throw error;
    }
    return output;
  } finally {
    if (handle) await handle.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function main(args = process.argv.slice(2)) {
  if (args.length) throw new Error('Usage: npm run tools:download (no arguments)');
  const file = await download(assetFor(), path.resolve(__dirname, '../.tools'));
  console.log(`Verified ${file}`);
  console.log('Extract this archive to use the tools. Nothing was installed globally.');
}

module.exports = { assetFor, download, matches };
if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
