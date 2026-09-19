// SPDX-License-Identifier: GPL-3.0-or-later
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {includeAppFile} = require('../tools/package-files.cjs');
test('package staging excludes personal recordings, old audio folders and the runtime music path', () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lg-xmb-music-'));
  try {
    const app=path.join(temp,'app'),out=path.join(temp,'output');fs.mkdirSync(app);
    fs.mkdirSync(path.join(app,'audio'));fs.mkdirSync(path.join(app,'other'));
    fs.writeFileSync(path.join(app,'audio','README.md'),'obsolete bundled asset');
    fs.writeFileSync(path.join(app,'other','sound.MP3'),'personal recording');
    fs.writeFileSync(path.join(app,'background-music.js'),'keep code');
    fs.writeFileSync(path.join(app,'user-music.mp3'),'personal recording');
    fs.cpSync(app,out,{recursive:true,filter:source=>includeAppFile(app,source)});
    assert.deepEqual(fs.readdirSync(out).sort(),['background-music.js','other']);
    assert.equal(fs.readdirSync(path.join(out,'other')).length,0);
    assert.match(fs.readFileSync(path.join(__dirname,'../.gitignore'),'utf8'),/app\/user-music\.mp3/);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('package staging excludes the runtime music symlink without following it', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-xmb-music-link-'));
  try {
    const app = path.join(temp, 'app'), out = path.join(temp, 'output');
    fs.mkdirSync(app);
    try {
      fs.symlinkSync(path.join(temp, 'missing-track.mp3'), path.join(app, 'user-music.mp3'));
    } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') {
        t.skip('Windows account cannot create symlinks; run this check on Linux.');
        return;
      }
      throw error;
    }
    fs.cpSync(app, out, {recursive: true, filter: source => includeAppFile(app, source)});
    assert.deepEqual(fs.readdirSync(out), []);
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});
test('source app contains no bundled recording or track fingerprint',()=>{
  const root=path.join(__dirname,'../app');
  function inspect(dir){for(const name of fs.readdirSync(dir)){
    const f=path.join(dir,name),info=fs.lstatSync(f);if(info.isSymbolicLink())continue;
    if(info.isDirectory())inspect(f);else if(path.basename(f)!=='user-music.mp3')assert.ok(!/\.(mp3|ogg|wav|flac|m4a)$/i.test(name),f);
  }}
  inspect(root);
  assert.match(fs.readFileSync(path.join(root,'background-music.js'),'utf8'),/var TRACK = 'user-music\.mp3'/);
});
