// SPDX-License-Identifier: GPL-3.0-or-later
// Run the preview server with OPENXMB_PREVIEW_PORT=8787.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});const checks=[];try{
for(const width of [1280,1920]){
 const page=await browser.newPage({viewport:{width,height:width*9/16}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(k,...a){return /webgl/.test(k)?null:get.call(this,k,...a);};});
 await page.goto('http://127.0.0.1:8787/');await page.waitForFunction(()=>window.C5App);assert.equal(await page.evaluate(()=>C5Catalog[0].items.some(i=>i.id==='motion')),false);
 async function open(id){
 const ci=await page.evaluate(()=>C5Catalog.findIndex(c=>c.id===C5App.getState().category));for(let n=0;n<ci;n++)await page.keyboard.press('ArrowLeft');
 const ix=await page.evaluate(id=>{const c=C5Catalog[0];return[c.items.findIndex(i=>i.id===C5App.getState().item),c.items.findIndex(i=>i.id===id)];},id);assert.ok(ix[1]>=0);
 for(let n=0;n<Math.abs(ix[1]-ix[0]);n++)await page.keyboard.press(ix[1]>ix[0]?'ArrowDown':'ArrowUp');
 await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>C5App.getState().modal),id);
 }
 for(const id of ['appearance','sound','previews','remote','datetime','about']){
  const colour=await page.locator('#time').evaluate(e=>getComputedStyle(e).color);await open(id);
  assert.equal(await page.locator('#time').evaluate(e=>getComputedStyle(e).color),colour);
  assert.equal(await page.locator('.screen').getAttribute('aria-hidden'),'true');
  // Same value does not replace choice nodes, steal focus or reset scrolling.
  if(['remote','previews'].includes(id)){
   assert.ok(await page.locator('#modalContent').evaluate(root=>{const buttons=[...root.querySelectorAll('button')],chosen=buttons.find(b=>b.getAttribute('aria-pressed')!=='true');chosen.focus();chosen.click();return buttons.every(b=>root.contains(b))&&document.activeElement===chosen;}));
  }
  if(id==='sound'){
   const before=await page.locator('.menu-action-slot').boundingBox();await page.locator('#retryMusic').evaluate(b=>b.hidden=!b.hidden);const after=await page.locator('.menu-action-slot').boundingBox();assert.deepEqual(after,before);
  }
  if(id==='appearance'){
   assert.equal(await page.evaluate(()=>document.activeElement.id),'openTheme');
   await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>C5App.getState().modal),'theme');
   await page.locator('[data-choice=ocean]').click();assert.equal(await page.evaluate(()=>C5App.getState().preferences.theme),'ocean');
   await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'openTheme');
   await page.keyboard.press('ArrowDown');
   assert.equal(await page.evaluate(()=>document.activeElement.id),'openWaveColors');
   await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.id),'showWavesOnly');
   await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.closest('.choice-group').getAttribute('aria-label')),'Animation');
   await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.id),'showWavesOnly');
   await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.id),'openWaveColors');

   await page.locator('#openWaveColors').click();assert.equal(await page.evaluate(()=>C5App.getState().modal),'wave-colors');
   await page.locator('[data-value=ps3]').click();
   await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.dataset.value),'theme');
   await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.value),'ps3');
   await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.value),'monthly');
   await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.value),'rgb');
   await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.value),'auto');
   await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>document.activeElement.dataset.value),'rgb');
   await page.locator('[data-value=rgb]').click();
   const result=await page.locator('#waveColor-red').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();let inputs=0;el.addEventListener('input',()=>inputs++);LGXMBWaveColorSettings.key({key:'ArrowRight',preventDefault(){}},document.querySelector('#modal'));return inputs;});assert.equal(result,0);await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>C5App.getState().modal),null);checks.push(width+': '+id);
 }
 assert.deepEqual(errors,[]);await page.close();
}
console.log(JSON.stringify({checks,errors:[],testedOnTV:false},null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
