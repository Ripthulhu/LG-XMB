// SPDX-License-Identifier: GPL-3.0-or-later
// Run the preview server with OPENXMB_PREVIEW_PORT=8787.
// Focused input workload regression. Run preview on port 8787.
const {chromium}=require('playwright');
const fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(k,...a){return /webgl/.test(k)?null:get.call(this,k,...a);};});
 const results=[];
 for(const scenario of ['edge-repeat','edge-unflagged','options-repeat','hold-ok']){
  await page.goto('http://127.0.0.1:8787/');await page.waitForFunction(()=>window.C5App);
  results.push(await page.evaluate(async scenario=>{
   const counts={mutations:0,previewStops:0,focus:0},times=[];let openedAt=0;
   const stop=C5InputPreview.prototype.stop;C5InputPreview.prototype.stop=function(){counts.previewStops++;return stop.apply(this,arguments);};
   const focus=HTMLElement.prototype.focus;HTMLElement.prototype.focus=function(){counts.focus++;return focus.apply(this,arguments);};
   const open=LGXMBItemOptions.prototype.open;LGXMBItemOptions.prototype.open=function(){openedAt=performance.now();return open.apply(this,arguments);};
   const send=(type,key,repeat)=>{const t=performance.now();document.dispatchEvent(new KeyboardEvent(type,{key,keyCode:key==='Enter'?13:0,repeat,bubbles:true,cancelable:true}));times.push(performance.now()-t);};
   if(scenario==='options-repeat')send('keydown','F2',false);
   await new Promise(r=>setTimeout(r,200));
   const obs=new MutationObserver(ms=>counts.mutations+=ms.length);obs.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
   const start=performance.now();const key=scenario==='hold-ok'?'Enter':scenario==='options-repeat'?'ArrowDown':'ArrowUp';
   send('keydown',key,false);
   for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,10));send('keydown',key,scenario!=='edge-unflagged');}
   send('keyup',key,false);await new Promise(r=>setTimeout(r,200));obs.disconnect();times.sort((a,b)=>a-b);
   return {scenario,counts,handlerP95:times[Math.floor(times.length*.95)],openDelay:openedAt?openedAt-start:null,state:C5App.getState().itemOptions};
  },scenario));
 }
 for(const r of results){
 if(r.scenario.startsWith('edge-')){assert.equal(r.counts.mutations,0);assert.equal(r.counts.previewStops,0);}
 if(r.scenario==='options-repeat')assert.ok(r.counts.focus<=16,'Held direction floods modal focus');
 if(r.scenario==='hold-ok'){assert.equal(r.state.open,true);assert.equal(r.counts.focus,1);}
}
await page.goto('http://127.0.0.1:8787/');await page.waitForFunction(()=>window.C5App);
await page.keyboard.down('Enter');await page.waitForTimeout(200);
assert.equal(await page.locator('.item-options').evaluate(e=>getComputedStyle(e).visibility),'hidden');
assert.ok(await page.locator('.item-options-panel').evaluate(e=>e.getBoundingClientRect().width)>0);
await page.keyboard.up('Enter');
await page.goto('http://127.0.0.1:8787/');await page.waitForFunction(()=>window.C5App);
const initial=await page.evaluate(()=>C5App.getState().item);
await page.keyboard.press('ArrowDown');const one=await page.evaluate(()=>C5App.getState().item);
await page.keyboard.press('ArrowDown');const two=await page.evaluate(()=>C5App.getState().item);
assert.notEqual(initial,one);assert.notEqual(one,two);
await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>C5App.getState().item),one);
console.log(JSON.stringify({results,rapidTaps:true,preparedHidden:true,testedOnTV:false},null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
