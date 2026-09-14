// SPDX-License-Identifier: GPL-3.0-or-later
// Bundle the existing helper sources; never download or install anything on a TV.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const files = {
  'process-control.py': 'tv-helper/process_control.py',
  'thumbnail-cache.py': 'tv-helper/thumbnail_cache.py',
  'stop-helper.py': 'tv-helper/recovery/stop_thumbnail_helper.py'
};
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function stageHelper(project, app) {
  const manifest = fs.readFileSync(path.join(app, 'appinfo.json'));
  const controller = fs.readFileSync(path.join(project, files['process-control.py']), 'utf8');
  const pin = controller.match(/^PIN_APPINFO_SHA256 = '([a-f0-9]{64})'$/m);
  if (!pin || pin[1] !== digest(manifest)) throw new Error('App manifest does not match the helper pin.');
  const bundle = {schema: 1, appinfo: digest(manifest), files: {}};
  fs.mkdirSync(path.join(app, 'helper'), {recursive: true});
  for (const [name, source] of Object.entries(files)) {
    const bytes = fs.readFileSync(path.join(project, source));
    fs.writeFileSync(path.join(app, 'helper', name), bytes, {mode: 0o644});
    bundle.files['helper/' + name] = digest(bytes);
  }
  bundle.files['helper-startup.py'] = digest(fs.readFileSync(path.join(app, 'helper-startup.py')));
  fs.chmodSync(path.join(app, 'helper-startup.py'), 0o755);
  const bytes = Buffer.from(JSON.stringify(bundle, null, 2) + '\n');
  fs.writeFileSync(path.join(app, 'helper-bundle.json'), bytes);
  const setup = fs.readFileSync(path.join(project, 'tv-helper/setup.py'), 'utf8');
  if (setup.split('@BUNDLE_SHA256@').length !== 2) throw new Error('Expected one helper bundle pin placeholder.');
  fs.writeFileSync(path.join(app, 'helper-setup.py'), setup.replace('@BUNDLE_SHA256@', digest(bytes)));
  return bundle;
}
