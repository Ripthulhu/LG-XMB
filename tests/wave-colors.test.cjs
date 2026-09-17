// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/wave-colors.js'),'utf8'),{window:root});const api=root.LGXMBWaveColors;
const plain=v=>JSON.parse(JSON.stringify(v));
test('existing themes remain the default, independently of new colour settings',()=>{
  assert.equal(api.normalize().mode,'theme');assert.equal(api.resolve(null),null);assert.equal(api.resolve({mode:'invalid'}),null);
});
test('all 24 monthly entries have bounded colours and a normalized directional range',()=>{
  assert.equal(api.months.length,12);
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
  assert.deepEqual(plain(api.sample(p,0,0)),[131/255,86/255,32/255]);
  const end=api.sample(p,1,1);assert.ok(end.every((v,i)=>Math.abs(v-[18,20,17][i]/255)<1e-12));
});
test('Original RGB uses the reference top/bottom multipliers, including the blue factor',()=>{
  const p=api.resolve({mode:'rgb'});assert.deepEqual(plain(p.start),[37/255*.09,89/255*.09,179/255*.09*1.2]);
  assert.deepEqual(plain(p.end),[37/255*.62,89/255*.62,179/255*.62]);
});
test('invalid RGB channels, months and intensity values cannot reach uniforms',()=>{
  const n=api.normalize({mode:'rgb',red:'255',green:Infinity,blue:-1,month:13,period:'midday',top:NaN,bottom:99});
  assert.deepEqual(plain(n),{mode:'rgb',clock:'auto',month:1,period:'day',red:37,green:89,blue:179,top:.09,bottom:.62});
});
test('resolved colours are independent objects and cannot mutate the preset table',()=>{
  const a=api.resolve({mode:'monthly',month:1}),b=api.resolve({mode:'monthly',month:1});a.start[0]=0;assert.equal(b.start[0],197/255);
});
test('changing colour uniforms requires no new GPU objects and theme mode clears the override',()=>{
  const calls=[],gl={getUniformLocation:(_,n)=>n,uniform1i:(...v)=>calls.push(v),uniform2f:(...v)=>calls.push(v),uniform3fv:(...v)=>calls.push(v)};
  const u=api.locations(gl,{});api.upload(gl,u,api.resolve({mode:'monthly',month:2}));api.upload(gl,u,null);
  assert.deepEqual(calls.at(-1),['uColorEnabled',0]);assert.ok(calls.some(c=>c[0]==='uColorStart'));
});
test('particle depth field stays static-buffer based, with fan-out and soft focus rather than audio analysis',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../app/ps3-particles.js'),'utf8');
  assert.match(source,/perspective=2\.6/);assert.match(source,/mix\(0\.46,1\.65,across\)/);assert.match(source,/vDefocus/);
  assert.doesNotMatch(source,/AudioContext|AnalyserNode|getByteFrequencyData|requestAnimationFrame/);
});
