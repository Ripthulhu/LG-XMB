// SPDX-License-Identifier: GPL-3.0-or-later
// Run the local preview on port 8765. The host/TV clock is never changed.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{const NativeDate=Date;window.calendarNow=new NativeDate(2026,0,1,12).getTime();window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[window.calendarNow]));}static now(){return window.calendarNow;}};localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({motion:'reduced',waveSampling:1,waveColors:{mode:'ps3',dateMode:'auto',timeMode:'auto'}}));});
await page.goto('http://127.0.0.1:8765/');await page.waitForFunction(()=>C5App.getState().waveMode==='webgl');
await page.evaluate(()=>{const original=C5Wave.prototype.draw;C5Wave.prototype.draw=function(){window.calendarWave=this;return original.apply(this,arguments);};});
await page.waitForFunction(()=>window.calendarWave);
const snap=()=>page.evaluate(()=>{const w=calendarWave;return{key:w.renderer.monthlyKey,time:w.time,timer:!!w.clockTimer,palette:w.palette,wave:w.wave,background:w.background};});
await page.screenshot({path:'artifacts/calendar-noon.png'});
const first=await snap();assert.ok(first.timer);assert.equal(first.time,0);
await page.evaluate(()=>calendarNow=new Date(2026,7,1,0).getTime());await page.waitForTimeout(1200);await page.screenshot({path:'artifacts/calendar-night.png'});const night=await snap();assert.notEqual(first.key,night.key);assert.equal(night.time,first.time);
await page.evaluate(()=>calendarWave.setPaused(true));const asleep=await snap();assert.equal(asleep.timer,false);
await page.evaluate(()=>calendarNow=new Date(2026,11,31,19).getTime());await page.waitForTimeout(1200);assert.equal((await snap()).key,asleep.key);
await page.evaluate(()=>calendarWave.setPaused(false));assert.notEqual((await snap()).key,asleep.key);
await page.evaluate(()=>calendarWave.setTheme({colors:{mode:'ps3',dateMode:'fixed',month:3,timeMode:'auto'}}));const fixedMonth=JSON.parse((await snap()).key);assert.deepEqual(fixedMonth.layers,[2,3,14,15]);
await page.evaluate(()=>calendarNow=new Date(2027,0,1,12).getTime());await page.waitForTimeout(1200);const next=JSON.parse((await snap()).key);assert.deepEqual(next.layers,fixedMonth.layers);assert.notEqual(next.values._DayTime,fixedMonth.values._DayTime);
await page.evaluate(()=>calendarWave.setTheme({colors:{mode:'monthly',dateMode:'auto',timeMode:'auto'}}));const gradient=(await snap()).palette;
await page.evaluate(()=>calendarNow=new Date(2027,5,1,0).getTime());await page.waitForTimeout(1200);assert.notDeepEqual((await snap()).palette.start,gradient.start);
await page.evaluate(()=>calendarWave.setTheme({colors:{mode:'monthly',dateMode:'fixed',month:4,timeMode:'night'}}));assert.equal((await snap()).timer,false);
await page.evaluate(()=>calendarWave.setTheme({background:'#204060',wave:'#aabbcc',colors:{mode:'theme',themeClock:false}}));const plain=await snap();assert.equal(plain.timer,false);
await page.evaluate(()=>calendarWave.setTheme({background:'#204060',wave:'#aabbcc',colors:{mode:'theme',themeClock:true}}));const dim=await snap();assert.ok(dim.wave.every((v,i)=>v<plain.wave[i]));
await page.evaluate(()=>calendarNow=new Date(2027,5,1,12).getTime());await page.waitForTimeout(1200);assert.deepEqual((await snap()).wave,plain.wave);
await page.evaluate(()=>calendarWave.destroy());assert.equal((await page.evaluate(()=>calendarWave.clockTimer)),0);
assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:['frozen waves follow date and time','no calendar draws while paused','resume catches up immediately','fixed month follows time','monthly presets follow clock','fixed presets have no timer','regular themes opt in','destroy cancels timer'],errors,testedOnTV:false},null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
