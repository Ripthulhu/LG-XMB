// SPDX-License-Identifier: GPL-3.0-or-later
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('stages all helper sources and pins their exact bytes without editing app sources', async () => {
  const {stageHelper, digest} = await import('../tools/helper-bundle.mjs');
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-xmb-bundle-'));
  try {
    for (const name of ['appinfo.json','helper-startup.py']) fs.copyFileSync(path.join(root,'app',name),path.join(app,name));
    const bundle = stageHelper(root,app);
    for (const [name,hash] of Object.entries(bundle.files)) assert.equal(digest(fs.readFileSync(path.join(app,name))),hash);
    assert.equal(bundle.appinfo,digest(fs.readFileSync(path.join(root,'app/appinfo.json'))));
    assert.equal(Object.keys(bundle.files).length,4);
    assert.equal(fs.statSync(path.join(app,'helper-startup.py')).mode & 0o777,0o755);
    const pin = digest(fs.readFileSync(path.join(app,'helper-bundle.json')));
    const setup = fs.readFileSync(path.join(app,'helper-setup.py'),'utf8');
    assert.ok(setup.includes("BUNDLE_SHA256 = '"+pin+"'"));
    assert.ok(!setup.includes('@BUNDLE_SHA256@'));
    assert.ok(fs.readFileSync(path.join(root,'tv-helper/setup.py'),'utf8').includes('@BUNDLE_SHA256@'));
    fs.appendFileSync(path.join(app,'appinfo.json'),' ');
    assert.throws(()=>stageHelper(root,app),/manifest does not match/);
  } finally { fs.rmSync(app,{recursive:true,force:true}); }
});
