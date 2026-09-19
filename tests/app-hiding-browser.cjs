// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const nav=require('./support/menu-navigation.cjs');
(async()=>{
 const browser=await chromium.launch(nav.launchOptions());
 try{
 for(const width of [1280,1920]){
  const page=await browser.newPage({viewport:{width,height:width*9/16}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/.test(kind)?null:get.call(this,kind,...args);};});
  const load=async()=>{await page.goto('http://127.0.0.1:8787/');await page.waitForFunction(()=>window.C5App);await page.evaluate(()=>{LGXMBAppManager.removeApp=()=>{throw Error('Hiding must not uninstall');};});};
  const option=action=>page.locator('.item-options.open [data-action="'+action+'"]');
  const visible=id=>page.evaluate(id=>C5Catalog.some(c=>c.items.some(i=>i.id===id)),id);
  await load();
  await nav.item(page,'photo','com.webos.app.mediadiscovery');
  await page.keyboard.down('Enter');await page.waitForTimeout(700);await page.keyboard.up('Enter');
  assert.equal(await page.evaluate(()=>C5App.getState().itemOptions.open),true);
  await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'hide');
  await page.keyboard.press('Enter');assert.equal(await visible('com.webos.app.mediadiscovery'),false);
  assert.equal(await page.evaluate(()=>C5App.getState().itemOptions.open),false);
  await nav.item(page,'photo','com.webos.app.lifeonscreen');await page.keyboard.press('F2');await option('hide').click();
  assert.equal(await page.evaluate(()=>C5Catalog.find(c=>c.id==='photo').items[0].action),'empty');
  await load();await nav.category(page,'photo');await page.keyboard.press('F2');
  assert.equal(await option('hide').getAttribute('aria-disabled'),'true');
  await option('hidden').click();assert.equal(await page.locator('[data-action=restore]').count(),2);
  await page.locator('[data-action=restore][data-app-id="com.webos.app.mediadiscovery"]').click();
  assert.equal(await page.locator('[data-action=restore]').count(),1);
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.appId),'com.webos.app.lifeonscreen');
  await page.keyboard.press('Enter');assert.match(await page.locator('.item-options-status').innerText(),/No hidden apps/);
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('item-options-panel')),true);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>C5App.getState().itemOptions.open),false);
  for(const id of ['com.webos.app.lifeonscreen','com.webos.app.mediadiscovery'])assert.equal(await visible(id),true);
  assert.deepEqual(await page.evaluate(()=>C5Catalog.filter(c=>c.items.some(i=>i.id==='com.webos.app.mediadiscovery')).map(c=>c.id)),['photo','music','video']);
  await nav.item(page,'tv','com.webos.app.livetv');await page.keyboard.press('F2');
  await page.evaluate(()=>{window.realStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='lg-xmb-hidden-apps-v1')throw Error('Storage full');return realStorageSet.call(this,k,v);};});
  await option('hide').click();assert.match(await page.locator('.item-options-status').innerText(),/Could not hide/);assert.equal(await visible('com.webos.app.livetv'),true);
  await page.evaluate(()=>{Storage.prototype.setItem=realStorageSet;});await page.keyboard.press('Escape');
  await nav.item(page,'tv','com.webos.app.hdmi1');await page.keyboard.press('F2');assert.equal(await option('hide').getAttribute('aria-disabled'),'true');
  await option('hidden').click();assert.match(await page.locator('.item-options-status').innerText(),/No hidden apps/);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>C5App.getState().itemOptions.view),'main');await page.keyboard.press('Escape');
  await load();assert.equal(await visible('com.webos.app.mediadiscovery'),true);assert.deepEqual(errors,[]);
  console.log(width+': hold/remote hide, global removal, restart persistence, all-hidden recovery, restore focus, storage failure and input protection passed');
  await page.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
