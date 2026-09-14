'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('package staging includes each helper and binds it to the exact manifest',async()=>{
  const {stageHelper,helperSources}=await import('../tools/stage-helper.mjs');
  const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'lg-xmb-stage-'));
  try{
    for(const name of ['appinfo.json','helper-startup.py'])fs.copyFileSync(path.join(root,'app',name),path.join(temp,name));
    const bundle=stageHelper(root,temp);
    assert.equal(bundle.appinfoSha256,hash(fs.readFileSync(path.join(temp,'appinfo.json'))));
    assert.deepEqual(fs.readdirSync(path.join(temp,'helper')).sort(),['bundle.json',...Object.keys(helperSources)].sort());
    for(const [name,source] of Object.entries(helperSources)){
      const payload=fs.readFileSync(path.join(temp,'helper',name));
      assert.deepEqual(payload,fs.readFileSync(path.join(root,source)));assert.equal(bundle.files[name],hash(payload));
    }
    const template=fs.readFileSync(path.join(root,'app/helper-startup.py'),'utf8');
    const bundleBytes=fs.readFileSync(path.join(temp,'helper/bundle.json'));
    assert.equal(bundle.startupSha256,hash(template));
    assert.equal(fs.readFileSync(path.join(temp,'helper-startup.py'),'utf8'),
      template.replace('\nBUNDLE_SHA256 = "@BUNDLE_SHA256@"','\nBUNDLE_SHA256 = "'+hash(bundleBytes)+'"'));
    fs.appendFileSync(path.join(temp,'appinfo.json'),' ');
    assert.throws(()=>stageHelper(root,temp),/reviewed helper pin/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
