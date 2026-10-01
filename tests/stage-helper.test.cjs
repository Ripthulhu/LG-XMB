'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function fixtureProject(directory, sources) {
  const root=path.resolve(__dirname,'..');
  for(const name of ['appinfo.json','helper-startup.py']){
    fs.mkdirSync(path.join(directory,'app'),{recursive:true});
    fs.copyFileSync(path.join(root,'app',name),path.join(directory,'app',name));
  }
  for(const [name,relative] of Object.entries(sources)){
    const target=path.join(directory,relative);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,name.endsWith('.py') && fs.existsSync(path.join(root,relative)) ?
      fs.readFileSync(path.join(root,relative)) : Buffer.from(name));
  }
  const build={schema:1,protocol:1,architecture:'arm-linux-gnueabi',sources:{},files:{}};
  for(const relative of ['tv-helper/native/home-hook.c','tv-helper/native/CMakeLists.txt',
    'tv-helper/native/dependencies.json','tools/build-home-hook.sh']){
    const target=path.join(directory,relative);
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,relative);
    build.sources[relative]=hash(relative);
  }
  build.buildId=hash(Object.keys(build.sources).sort().map(name=>`${name} ${build.sources[name]}\n`).join(''));
  for(const name of ['ezinject','lgxmb-home-hook.so'])
    build.files[name]=hash(fs.readFileSync(path.join(directory,sources[name])));
  fs.writeFileSync(path.join(directory,sources['build.json']),JSON.stringify(build));
}
test('helper inventory rejects missing entry points and noncanonical paths',async()=>{
  const {validateHelperSources,helperSources}=await import('../tools/stage-helper.mjs');
  assert.doesNotThrow(()=>validateHelperSources(helperSources));
  for(const name of Object.keys(helperSources)){
    const incomplete={...helperSources};delete incomplete[name];
    assert.throws(()=>validateHelperSources(incomplete),/entry points/);
  }
  for(const source of ['tv-helper/../outside.py','tv-helper/..\\..\\outside.py','tv-helper//capture.py','C:/capture.py'])
    assert.throws(()=>validateHelperSources({...helperSources,'extra.py':source}),/Invalid helper source/);
  assert.throws(()=>validateHelperSources({...helperSources,ezinject:'tv-helper/native/other/ezinject'}),/Invalid helper source/);
  assert.throws(()=>validateHelperSources({...helperSources,'foreign.so':'tv-helper/native/prebuilt/foreign.so'}),/Invalid helper source/);
});
test('package staging includes each helper and binds it to the exact manifest',async()=>{
  const {stageHelper,helperSources}=await import('../tools/stage-helper.mjs');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lg-xmb-stage-')),root=path.join(temp,'source'),stage=path.join(temp,'stage');
  try{
    fixtureProject(root,helperSources);fs.mkdirSync(stage);
    fs.copyFileSync(path.join(root,'app','appinfo.json'),path.join(stage,'appinfo.json'));
    const bundle=stageHelper(root,stage);
    assert.equal(bundle.appinfoSha256,hash(fs.readFileSync(path.join(stage,'appinfo.json'))));
    assert.deepEqual(fs.readdirSync(path.join(stage,'helper')).sort(),['bundle.json',...Object.keys(helperSources)].sort());
    for(const [name,source] of Object.entries(helperSources)){
      const payload=fs.readFileSync(path.join(stage,'helper',name));
      assert.deepEqual(payload,fs.readFileSync(path.join(root,source)));assert.equal(bundle.files[name],hash(payload));
    }
    const startup=fs.readFileSync(path.join(stage,'helper-startup.py'),'utf8');
    assert.ok(startup.includes('BUNDLE_SHA256 = "'+hash(fs.readFileSync(path.join(stage,'helper','bundle.json')))+'"'));
    assert.equal(startup.includes('@BUNDLE_SHA256@'),false);
    fs.appendFileSync(path.join(stage,'appinfo.json'),' ');
    assert.throws(()=>stageHelper(root,stage),/reviewed helper pin/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('native staging rejects stale sources and modified binaries',async()=>{
  const {validateNativeBuild,helperSources}=await import('../tools/stage-helper.mjs');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lg-xmb-native-'));
  try{
    fixtureProject(temp,helperSources);assert.doesNotThrow(()=>validateNativeBuild(temp));
    for(const [relative,message] of [['tv-helper/native/home-hook.c',/stale/],
      [helperSources.ezinject,/differs from its build/],[helperSources['lgxmb-home-hook.so'],/differs from its build/]]){
      const filename=path.join(temp,relative),original=fs.readFileSync(filename);
      fs.appendFileSync(filename,'changed');assert.throws(()=>validateNativeBuild(temp),message);
      fs.writeFileSync(filename,original);
    }
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
