// SPDX-License-Identifier: GPL-3.0-or-later
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Build and package verification share this inventory. Runtime filenames come
// from the independently pinned bundle manifest, never a second hand-kept list.
export const helperSources = Object.freeze(JSON.parse(
  fs.readFileSync(new URL('../tv-helper/bundle-sources.json', import.meta.url), 'utf8')
));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const nativeFiles = ['ezinject', 'lgxmb-home-hook.so', 'build.json'];
const nativeSources = ['tv-helper/native/home-hook.c', 'tv-helper/native/CMakeLists.txt',
  'tv-helper/native/dependencies.json', 'tools/build-home-hook.sh'];

export function validateNativeBuild(projectDir) {
  const directory = path.join(projectDir, 'tv-helper/native/prebuilt');
  const build = JSON.parse(fs.readFileSync(path.join(directory, 'build.json'), 'utf8'));
  if (build.schema !== 1 || build.protocol !== 1 || build.architecture !== 'arm-linux-gnueabi' ||
      JSON.stringify(Object.keys(build.sources || {}).sort()) !== JSON.stringify([...nativeSources].sort()) ||
      JSON.stringify(Object.keys(build.files || {}).sort()) !== JSON.stringify(nativeFiles.slice(0, 2).sort()))
    throw new Error('Invalid native Home build metadata. Rebuild the Home hook.');
  for (const source of nativeSources)
    if (sha256(fs.readFileSync(path.join(projectDir, source))) !== build.sources[source])
      throw new Error(`Native Home build is stale: ${source}. Rebuild the Home hook.`);
  const identity = Object.keys(build.sources).sort().map(name => `${name} ${build.sources[name]}\n`).join('');
  if (build.buildId !== sha256(identity)) throw new Error('Native Home build ID does not match its sources.');
  for (const name of nativeFiles.slice(0, 2)) {
    const bytes = fs.readFileSync(path.join(directory, name));
    if (!bytes.length || bytes.length > 16 * 1024 * 1024 || sha256(bytes) !== build.files[name])
      throw new Error(`Native Home payload differs from its build: ${name}`);
  }
}

export function validateHelperSources(sources) {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources) ||
      !['thumbnail_cache.py', 'stop_thumbnail_helper.py', 'home_button.py', 'home_hook.py', ...nativeFiles]
        .every(name => Object.hasOwn(sources, name)))
    throw new Error('Helper inventory must include the capture, recovery and Home button entry points.');
  for (const [name, relative] of Object.entries(sources)) {
    const valid = nativeFiles.includes(name) ? relative === `tv-helper/native/prebuilt/${name}` :
      /^[a-z][a-z0-9_]*\.py$/.test(name) && typeof relative === 'string' &&
      /^tv-helper\/(?:[a-z][a-z0-9_-]*\/)*[a-z][a-z0-9_]*\.py$/.test(relative);
    if (!valid)
      throw new Error(`Invalid helper source entry: ${name}`);
  }
}

export function stageHelper(projectDir, appDir) {
  validateHelperSources(helperSources);
  validateNativeBuild(projectDir);
  const appinfo = fs.readFileSync(path.join(appDir, 'appinfo.json'));
  const manifest = {schema: 1, appinfoSha256: sha256(appinfo), files: {}};
  const destination = path.join(appDir, 'helper');
  fs.mkdirSync(destination, {recursive: true, mode: 0o755});
  for (const [name, relative] of Object.entries(helperSources)) {
    const source = path.join(projectDir, relative);
    if (!fs.lstatSync(source).isFile()) throw new Error(`Expected a regular helper source: ${relative}`);
    const bytes = fs.readFileSync(source);
    if (name === 'thumbnail_cache.py') {
      const pin = /^PIN_APPINFO_SHA256 = '([0-9a-f]{64})'$/m.exec(bytes.toString('utf8'));
      if (!pin || pin[1] !== manifest.appinfoSha256) throw new Error('App manifest does not match the reviewed helper pin.');
    }
    fs.writeFileSync(path.join(destination, name), bytes, {mode: 0o644});
    manifest.files[name] = sha256(bytes);
  }
  const bundle = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(destination, 'bundle.json'), bundle, {mode: 0o644});
  const template = fs.readFileSync(path.join(projectDir, 'app', 'helper-startup.py'), 'utf8');
  if (template.split('@BUNDLE_SHA256@').length !== 2) throw new Error('Expected one bootstrap bundle pin.');
  fs.writeFileSync(path.join(appDir, 'helper-startup.py'), template.replace('@BUNDLE_SHA256@', sha256(bundle)), {mode: 0o755});
  fs.chmodSync(path.join(appDir, 'helper-startup.py'), 0o755);
  return manifest;
}
