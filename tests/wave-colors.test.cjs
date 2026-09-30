// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root={LGXMBPS3BackgroundClock:require('../app/ps3-background-clock.js')};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/wave-colors.js'),'utf8'),{window:root,Date});const api=root.LGXMBWaveColors;
const plain=v=>JSON.parse(JSON.stringify(v));
test('existing themes remain the default, independently of new colour settings',()=>{
  assert.equal(api.normalize().mode,'theme');assert.equal(api.resolve(null),null);assert.equal(api.resolve({mode:'invalid'}),null);
});
test('all 24 monthly entries have bounded colours and a normalized directional range',()=>{
  for(let month=1;month<=12;month++)for(const period of ['day','night']){
    const p=api.resolve({mode:'monthly',month,period});
    for(const a of [p.start,p.end,p.tint])assert.ok(a.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
    assert.ok(Math.abs(Math.hypot(...p.dir)-1)<1e-12);assert.ok(p.range[1]>0);
    const dots=[[0,0],[1,0],[0,1],[1,1]].map(c=>c[0]*p.dir[0]+c[1]*p.dir[1]);
    assert.ok(Math.abs(Math.min(...dots)-p.range[0])<1e-12);
    assert.ok(Math.abs(Math.max(...dots)-p.range[0]-p.range[1])<1e-12);
  }
});
test('upstream January and November presets keep their exact colour values and orientation',()=>{
  assert.deepEqual(plain(api.resolve({mode:'monthly',month:1,period:'day'}).start),[197/255,197/255,197/255]);
  const p=api.resolve({mode:'monthly',month:11,period:'night'});
  assert.deepEqual(plain(p.start),[131/255,86/255,32/255]);
  assert.deepEqual(plain(p.end),[18/255,20/255,17/255]);
  assert.ok(Math.abs(p.dir[0])<1e-12);assert.equal(p.dir[1],1);
});
test('invalid month and period values cannot reach uniforms',()=>{
  const n=api.normalize({mode:'ps3',month:13,period:'midday'});
  assert.deepEqual(plain(n),{mode:'ps3',clock:'auto',dateMode:'auto',timeMode:'auto',month:1,period:'day'});
});
test('resolved colours are independent objects and cannot mutate the preset table',()=>{
  const a=api.resolve({mode:'monthly',month:1}),b=api.resolve({mode:'monthly',month:1});a.start[0]=0;assert.equal(b.start[0],197/255);
});
