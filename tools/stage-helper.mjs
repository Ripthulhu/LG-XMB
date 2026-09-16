// SPDX-License-Identifier: GPL-3.0-or-later
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const helperSources = Object.freeze({
  'thumbnail_cache.py': 'tv-helper/thumbnail_cache.py',
  'stop_thumbnail_helper.py': 'tv-helper/recovery/stop_thumbnail_helper.py'
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function stageHelper(projectDir, appDir) {
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
