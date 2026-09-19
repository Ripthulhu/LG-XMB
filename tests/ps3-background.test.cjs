// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const clock=require('../app/ps3-background-clock.js');
const root={LGXMBPS3BackgroundClock:require('../app/ps3-background-clock.js')};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/wave-colors.js'),'utf8'),{window:root,Date});const colors=root.LGXMBWaveColors;
const pack=path.join(__dirname,'../app/ps3-background-data.js');
test('clock reproduces the uniforms retained in the RPCS3 dump for August 1st at noon',()=>{
  const u=clock.uniforms(clock.calendar(8,1,12,0,0),null,1);
  assert.deepEqual(u.layers,[7,8,19,20]);
  assert.deepEqual(u.values,{_DayTime:1200,_NightTime:0,_MonthTime:0,_NightDayBlend:1,_NightBrightness:0.5,_Alpha:1});
});
test('night blend is off between dusk and dawn and full at midday, December wraps to January',()=>{
  assert.equal(clock.uniforms(clock.calendar(3,10,2,0,0)).values._NightDayBlend,0);
  assert.equal(clock.uniforms(clock.calendar(3,10,13,0,0)).values._NightDayBlend,1);
  assert.deepEqual(clock.uniforms(clock.calendar(12,31,12,0,0)).layers,[11,0,23,12]);
  assert.throws(()=>clock.calendar(13,1,0));assert.throws(()=>clock.calendar(2,30,0));
});
test('the ps3 colour source resolves to a monthly request with a near-white wave and no gradient endpoints',()=>{
  const auto=colors.resolve({mode:'ps3'}),fixed=colors.resolve({mode:'ps3',clock:'fixed',month:8,period:'night'});
  const plain=v=>JSON.parse(JSON.stringify(v));
  assert.deepEqual(plain(auto.monthly),{auto:true,month:1,period:'auto'});assert.equal(auto.start,undefined);
  assert.deepEqual(plain(fixed.monthly),{auto:false,month:8,period:'night'});
  assert.ok(auto.tint.every(v=>v>=0.9&&v<=1));
  assert.equal(colors.normalize({mode:'ps3',clock:'sideways'}).clock,'auto');
});
test('the local texture pack, when present, is the 24 month_bg layers',{skip:fs.existsSync(pack)?false:'no local pack'},()=>{
  const g={};vm.runInNewContext(fs.readFileSync(pack,'utf8'),{window:g,atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array,Object});
  const t=g.LGXMBPS3MonthlyTextures;assert.equal(t.rgba.length,64*32*4*24);
  for(let i=3;i<t.rgba.length;i+=4)assert.equal(t.rgba[i],255);
});

test('month and time controls are independent and preserve legacy fixed presets',()=>{
 const date=new Date(2026,8,19,21,30);
 const live=clock.fromLocalDate(date),fixed=clock.coordinates(date,false,2,'auto');
 assert.equal(fixed.month,1);assert.equal(fixed.day,live.day);
 assert.equal(clock.coordinates(date,true,2,'day').month,live.month);
 assert.equal(clock.coordinates(date,true,2,'day').day,0.5);
 assert.equal(colors.normalize({mode:'monthly',clock:'auto',month:8,period:'night'}).dateMode,'fixed');
 assert.equal(colors.normalize({mode:'monthly',clock:'auto',month:8,period:'night'}).timeMode,'night');
 assert.equal(colors.normalize({mode:'ps3',clock:'auto',period:'day'}).timeMode,'auto');
});
test('calendar handles month/year boundaries and the recovered leap-day convention',()=>{
 const end=clock.fromLocalDate(new Date(2026,11,31,23,59,59));
 assert.deepEqual(clock.uniforms(end).layers,[11,0,23,12]);
 assert.equal(clock.fromLocalDate(new Date(2027,0,1,0)).month,0);
 assert.equal(clock.calendar(2,29,12).month,clock.calendar(2,28,12).month);
 for(let month=1;month<=12;month++)for(const hour of [0,5,12,19,23]){
   const u=clock.uniforms(clock.calendar(month,15,hour),clock.retained);
   assert.ok(Object.values(u.values).every(Number.isFinite));
 }
});
test('automatic preset gradients change across dates and hours; fixed presets do not',()=>{
 const a=new Date(2026,0,1,12),b=new Date(2026,7,1,0);
 const auto={mode:'monthly',dateMode:'auto',timeMode:'auto'};
 assert.notDeepEqual(colors.resolve(auto,a).start,colors.resolve(auto,b).start);
 const fixed={mode:'monthly',dateMode:'fixed',timeMode:'day',month:3};
 assert.deepEqual(colors.resolve(fixed,a).start,colors.resolve(fixed,b).start);
});
