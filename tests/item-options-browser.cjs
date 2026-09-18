// SPDX-License-Identifier: GPL-3.0-or-later
// Actual menu/controller/style; synthetic native replies and media/renderer.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const base=path.resolve(__dirname,'..'),out=path.join(base,'artifacts/item-options');
const checks=[],errors=[];
const state=p=>p.evaluate(()=>C5App.getState());
async function navigate(p,category,id){
 const route=await p.evaluate(({category,id})=>({current:C5Catalog.findIndex(c=>c.id===C5App.getState().category),target:C5Catalog.findIndex(c=>c.id===category)}),{category,id});
 for(let i=0;i<Math.abs(route.target-route.current);i++)await p.keyboard.press(route.target>route.current?'ArrowRight':'ArrowLeft');
 if(!id)return;
 const row=await p.evaluate(id=>{const list=C5Catalog.find(c=>c.id===C5App.getState().category).items;return {a:list.findIndex(i=>i.id===C5App.getState().item),b:list.findIndex(i=>i.id===id)};},id);
 assert.ok(row.b>=0,id);for(let i=0;i<Math.abs(row.b-row.a);i++)await p.keyboard.press(row.b>row.a?'ArrowDown':'ArrowUp');
 assert.equal((await state(p)).item,id);
}
async function load(p){
 // Source injection is isolated from managed-browser URL policy. A local
 // storage double supplies the otherwise opaque about:blank origin.
 await p.setContent('<!doctype html><html><body></body></html>');
 await p.evaluate(()=>{const data={};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data[k]||null,setItem:(k,v)=>{data[k]=String(v);},removeItem:k=>{delete data[k];}}});});
 let html=fs.readFileSync(path.join(base,'app/index.html'),'utf8').replace(/<script src="[^"]+"><\/script>/g,'').replace(/<link[^>]+rel="stylesheet"[^>]*>/g,'');
 await p.setContent(html);
 await p.addStyleTag({content:fs.readFileSync(path.join(base,'app/style.css'),'utf8')});
 await p.addStyleTag({content:fs.readFileSync(path.join(base,'app/item-options.css'),'utf8')});
 for(const name of ['icons.js','catalog.js','category-transition.js'])await p.addScriptTag({content:fs.readFileSync(path.join(base,'app',name),'utf8')});
 await p.addScriptTag({content:fs.readFileSync(path.join(base,'tests/fixtures/catalog-platform.js'),'utf8')});
 await p.evaluate(()=>{
  window.optionsHarness={calls:[],metaDelayed:false,metas:[],removes:[]};
  const infos={
   'org.test.one':{title:'Alpha Player',vendor:'Example Studio',version:'2.4.0'},
   'org.test.two':{title:'Beta Tools',vendor:'Example Studio',version:'1.0'},
   'cdp-30':{title:'Plex',version:'5.0'}
  };
  window.PalmSystem={identifier:'com.webos.app.home'};
  window.PalmServiceBridge=function(){this.cancel=()=>{this.cancelled=true;};this.call=(uri,json)=>{
   const data=JSON.parse(json),entry={uri,data,reply:this.onservicecallback};optionsHarness.calls.push(entry);
   if(uri.endsWith('/getAppInfo')){
    const info={id:data.id,type:'web',removable:true,systemApp:false,folderPath:(data.id==='cdp-30'?'/media/cryptofs':'/media/developer')+'/apps/usr/palm/applications/'+data.id,...infos[data.id]};
    if(optionsHarness.metaDelayed)optionsHarness.metas.push({entry,info});
    else queueMicrotask(()=>entry.reply(JSON.stringify({returnValue:true,appInfo:info})));
   }else if(uri.endsWith('/remove'))optionsHarness.removes.push(entry);
   else throw Error('Unexpected call '+uri);
  };};
 });
 for(const name of ['menu-sounds.js','app-manager.js','hold-gesture.js','menu-order.js','item-options.js','system-time.js','date-time-settings.js','app.js'])await p.addScriptTag({content:fs.readFileSync(path.join(base,'app',name),'utf8')});
 await p.waitForFunction(()=>window.C5App);
 await p.evaluate(()=>{
  catalogHarness.apps({preview:false,apps:[{id:'org.test.two',title:'Beta Tools'},{id:'org.test.one',title:'Alpha Player'},{id:'cdp-30',title:'Plex'}]});
  catalogHarness.labels({preview:false,inputs:[]});
 });
 await p.waitForFunction(()=>C5Catalog.find(c=>c.id==='apps').items.some(i=>i.id==='org.test.one'));
}
async function finishRemoval(p,success=true){await p.evaluate(success=>{const e=optionsHarness.removes[optionsHarness.removes.length-1];e.reply(JSON.stringify({id:e.data.id,statusValue:success?31:25,details:success?{}:{reason:'The app is locked.'}}));},success);await p.waitForTimeout(10);}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),args:['--no-sandbox']});
 try{
 for(const size of [{width:1280,height:720},{width:1920,height:1080}]){
 const context=await browser.newContext({viewport:size,bypassCSP:true});const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 try{
  await load(p);
  await p.keyboard.down('Enter');await p.waitForTimeout(180);assert.equal(await p.evaluate(()=>catalogHarness.launches.length),0);await p.keyboard.up('Enter');await p.waitForFunction(()=>catalogHarness.launches.length===1);checks.push(size.width+': short OK launches exactly on release');
  await navigate(p,'apps','org.test.one');
  const before=await p.evaluate(()=>catalogHarness.launches.length);
  await p.keyboard.down('Enter');await p.waitForTimeout(700);assert.equal((await state(p)).itemOptions.open,true);
  for(let i=0;i<4;i++)await p.keyboard.down('Enter');
  await p.keyboard.up('Enter');assert.equal(await p.evaluate(()=>catalogHarness.launches.length),before);
  await p.waitForFunction(()=>C5App.getState().itemOptions.removable);
  assert.equal(await p.locator('.item-options-button').count(),4);assert.equal(await p.locator('.item-options-shade').isVisible(),true);
  assert.equal(await p.evaluate(()=>document.activeElement.dataset.action),'start');
  await p.waitForTimeout(250);const box=await p.locator('.item-options-panel').boundingBox();assert.ok(Math.abs(box.x+box.width-size.width*.94)<2);assert.ok(Math.abs(box.height-size.height*.82)<2);
  await p.screenshot({path:path.join(out,'options-'+size.width+'.png')});checks.push(size.width+': hold opens right panel, consumes repeats/release, keeps target and fits viewport');
  await p.keyboard.press('ArrowDown');await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');assert.equal((await state(p)).itemOptions.view,'info');assert.match(await p.locator('.item-options-info').innerText(),/2.4.0/);assert.equal(await p.locator('.item-options-info img').count(),0);
  await p.keyboard.press('Escape');assert.equal((await state(p)).itemOptions.view,'main');
  for(let i=0;i<12;i++)await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.querySelector('.item-options-panel').contains(document.activeElement)),true);checks.push(size.width+': Information is real metadata; focus and Back stay within panel');
  await p.locator('[data-action=sort]').click();await p.locator('[data-action=sort-az]').click();
  assert.equal((await state(p)).item,'org.test.one');assert.deepEqual(await p.evaluate(()=>C5Catalog.find(c=>c.id==='apps').items.map(i=>i.title)),['Alpha Player','Beta Tools','Home Hub']);
  await p.keyboard.press('Escape');await navigate(p,'tv','com.webos.app.hdmi2');await p.keyboard.press('F2');await p.waitForFunction(()=>!C5App.getState().itemOptions.opening);assert.equal((await state(p)).itemOptions.removable,false);
  assert.equal(await p.locator('[data-action=delete]').getAttribute('aria-disabled'),'true');await p.locator('[data-action=delete]').evaluate(b=>b.click());assert.equal(await p.evaluate(()=>optionsHarness.removes.length),0);checks.push(size.width+': sorting remembers selected app; HDMI delete remains unavailable');
  await p.keyboard.press('Escape');await navigate(p,'network','org.webosbrew.hbchannel');await p.keyboard.press('F2');await p.waitForFunction(()=>!C5App.getState().itemOptions.opening);await p.waitForTimeout(30);assert.equal((await state(p)).itemOptions.removable,false);await p.keyboard.press('Escape');checks.push(size.width+': recovery Homebrew Channel is protected');
  await navigate(p,'apps','org.test.one');await p.keyboard.down('Enter');await p.keyboard.press('ArrowDown');await p.waitForTimeout(750);await p.keyboard.up('Enter');assert.equal((await state(p)).itemOptions.open,false);assert.equal(await p.evaluate(()=>catalogHarness.launches.length),before);checks.push(size.width+': navigation cancels a pending hold without launching either item');
  await navigate(p,'apps','org.test.one');await p.keyboard.down('Enter');await p.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await p.waitForTimeout(720);await p.keyboard.up('Enter');assert.equal((await state(p)).itemOptions.open,false);await p.evaluate(()=>window.dispatchEvent(new Event('pageshow')));checks.push(size.width+': pagehide cancels pending hold');
  await p.keyboard.press('F2');await p.waitForFunction(()=>!C5App.getState().itemOptions.opening);await p.waitForFunction(()=>C5App.getState().itemOptions.removable);await p.locator('[data-action=delete]').click();assert.equal(await p.evaluate(()=>document.activeElement.dataset.action),'cancel-delete');
  await p.keyboard.press('Enter');assert.equal((await state(p)).itemOptions.view,'main');assert.equal(await p.evaluate(()=>optionsHarness.removes.length),0);checks.push(size.width+': Cancel is the default deletion confirmation');
  await p.locator('[data-action=delete]').click();await p.locator('[data-action=confirm-delete]').click();await p.waitForFunction(()=>optionsHarness.removes.length===1);
  await p.evaluate(()=>{const e=optionsHarness.removes[0];e.reply(JSON.stringify({returnValue:true,subscribed:true}));e.reply(JSON.stringify({id:e.data.id,statusValue:21}));});
  assert.ok(await p.evaluate(()=>C5Catalog.find(c=>c.id==='apps').items.some(i=>i.id==='org.test.one')));
  await finishRemoval(p,false);assert.equal((await state(p)).itemOptions.open,true);assert.match(await p.locator('.item-options-status').innerText(),/locked/);assert.ok(await p.evaluate(()=>C5Catalog.find(c=>c.id==='apps').items.some(i=>i.id==='org.test.one')));checks.push(size.width+': acknowledgements do not remove items; failed uninstall retains app');
  await p.locator('[data-action=delete]').click();await p.locator('[data-action=confirm-delete]').click();await p.waitForFunction(()=>optionsHarness.removes.length===2);await finishRemoval(p,true);
  assert.equal((await state(p)).itemOptions.open,false);assert.equal(await p.evaluate(()=>C5Catalog.some(c=>c.items.some(i=>i.id==='org.test.one'))),false);assert.equal((await state(p)).item,'org.test.two');checks.push(size.width+': terminal success removes item and selects its neighbour');
  await navigate(p,'video','cdp-30');await p.keyboard.press('F2');await p.waitForFunction(()=>!C5App.getState().itemOptions.opening);await p.waitForFunction(()=>C5App.getState().itemOptions.removable);await p.locator('[data-action=delete]').click();await p.locator('[data-action=confirm-delete]').click();await p.waitForFunction(()=>optionsHarness.removes.length===3);await p.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await finishRemoval(p,true);assert.equal(await p.evaluate(()=>C5Catalog.some(c=>c.items.some(i=>i.id==='cdp-30'))),false);await p.evaluate(()=>window.dispatchEvent(new Event('pageshow')));checks.push(size.width+': background completion removes every duplicate Plex shortcut without reviving panel');
  await navigate(p,'apps','org.test.two');await p.waitForTimeout(450);const row=p.locator('#items>.rows:not(.parked) [data-item="org.test.two"]');const rect=await row.boundingBox();await p.mouse.move(rect.x+20,rect.y+rect.height/2);await p.mouse.down();await p.waitForTimeout(700);await p.mouse.up();assert.equal((await state(p)).itemOptions.open,true);await p.waitForTimeout(40);assert.equal((await state(p)).itemOptions.open,true);checks.push(size.width+': pointer hold consumes release click rather than starting app or dismissing menu');
  await p.keyboard.press('Escape');await p.waitForTimeout(250);await row.click({button:'right'});assert.equal((await state(p)).itemOptions.open,true);await p.keyboard.press('Escape');
  const ids=await p.locator('[id]').evaluateAll(nodes=>nodes.map(n=>n.id));assert.equal(new Set(ids).size,ids.length);checks.push(size.width+': right click support and unique accessibility IDs after reorder/delete');
  await p.emulateMedia({reducedMotion:'reduce'});await p.keyboard.press('F2');await p.waitForFunction(()=>!C5App.getState().itemOptions.opening);assert.equal(await p.locator('.item-options-panel').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');await p.keyboard.press('Escape');checks.push(size.width+': system reduced motion has no panel animation');
 }finally{await context.close();}
 }
 assert.deepEqual(errors,[]);
 const result={passed:checks.length,checks,browser:await browser.version(),testedOnTV:false,renderer:'test double',services:'synthetic PalmServiceBridge replies'};
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
