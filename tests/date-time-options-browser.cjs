// SPDX-License-Identifier: GPL-3.0-or-later
// Actual controller/panels; native calls and renderer are fixtures, not a TV.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const base=path.resolve(__dirname,'..'),checks=[],errors=[],out=path.join(base,'artifacts/time-options');
const state=p=>p.evaluate(()=>C5App.getState());
async function load(p){
 await p.setContent('<html><body></body></html>');
 await p.evaluate(()=>{const data={};Object.defineProperty(window,'localStorage',{value:{getItem:k=>data[k]||null,setItem:(k,v)=>data[k]=String(v),removeItem:k=>delete data[k]},configurable:true});});
 await p.setContent(fs.readFileSync(path.join(base,'app/index.html'),'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]*>/g,''));
 for(const f of ['style.css','item-options.css','date-time-settings.css'])await p.addStyleTag({content:fs.readFileSync(path.join(base,'app',f),'utf8')});
 for(const f of ['icons.js','catalog.js','category-transition.js'])await p.addScriptTag({content:fs.readFileSync(path.join(base,'app',f),'utf8')});
 await p.addScriptTag({content:fs.readFileSync(path.join(base,'tests/fixtures/catalog-platform.js'),'utf8')});
 await p.evaluate(()=>{
  window.timeTest={utc:1789735378,calls:[],delayReads:false,reads:[],delayWrites:false,writes:[],deny:false};
  window.PalmSystem={identifier:'com.webos.app.home'};
  window.PalmServiceBridge=function(){this.cancel=()=>{this.cancelled=true;};this.call=(uri,data)=>{
   const e={uri,data:JSON.parse(data),reply:this.onservicecallback};timeTest.calls.push(e);
   if(uri.endsWith('/getSystemTime')){const finish=()=>e.reply(JSON.stringify({returnValue:true,utc:timeTest.utc,timezone:'Europe/Amsterdam'}));if(timeTest.delayReads)timeTest.reads.push(finish);else queueMicrotask(finish);}
   else if(uri.endsWith('/setSystemTime')){const finish=()=>{if(timeTest.deny)e.reply(JSON.stringify({returnValue:false,errorText:'Permission denied'}));else{timeTest.utc=e.data.utc;e.reply(JSON.stringify({returnValue:true}));}};if(timeTest.delayWrites)timeTest.writes.push(finish);else queueMicrotask(finish);}
   else if(uri.endsWith('/getAppInfo')){queueMicrotask(()=>e.reply(JSON.stringify({returnValue:true,appInfo:{id:e.data.id,title:'Test app',type:'web',systemApp:false,removable:true,folderPath:'/media/developer/apps/usr/palm/applications/'+e.data.id}})));}
   else throw Error('Unexpected native call '+uri);
  };};
 });
 for(const f of ['menu-focus.js','directional-repeat.js','wheel-navigation.js','menu-sounds.js','app-manager.js','hold-gesture.js','menu-order.js','app-categories.js','app-refresh.js','item-options.js','system-time.js','date-time-settings.js','launcher-preferences.js','settings-ui.js','appearance-settings.js','launcher-view.js'])await p.addScriptTag({content:fs.readFileSync(path.join(base,'app',f),'utf8')});
 await p.evaluate(()=>{const C=LGXMBItemOptions;window.LGXMBItemOptions=function(o){return window.testOptions=new C(o);};});
 await p.addScriptTag({content:fs.readFileSync(path.join(base,'app/app.js'),'utf8')});
 await p.waitForFunction(()=>window.C5App);
 await p.evaluate(()=>{catalogHarness.apps({preview:false,apps:[{id:'org.test.one',title:'Test app'}]});catalogHarness.labels({preview:false,inputs:[]});});
}
async function navigate(p,category,id){
 const indices=await p.evaluate(category=>[C5Catalog.findIndex(c=>c.id===C5App.getState().category),C5Catalog.findIndex(c=>c.id===category)],category);
 assert.ok(indices[1]>=0);for(let n=0;n<Math.abs(indices[1]-indices[0]);n++)await p.keyboard.press(indices[1]>indices[0]?'ArrowRight':'ArrowLeft');
 const rows=await p.evaluate(id=>{const c=C5Catalog.find(c=>c.id===C5App.getState().category);return[c.items.findIndex(i=>i.id===C5App.getState().item),c.items.findIndex(i=>i.id===id)];},id);
 assert.ok(rows[1]>=0);for(let n=0;n<Math.abs(rows[1]-rows[0]);n++)await p.keyboard.press(rows[1]>rows[0]?'ArrowDown':'ArrowUp');
 assert.equal((await state(p)).item,id);
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox']});
 try{
 for(const width of [1280,1920]){
 const context=await browser.newContext({viewport:{width,height:width*9/16},bypassCSP:true});const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 try{
  await load(p);await navigate(p,'settings','datetime');await p.keyboard.press('Enter');
  await p.waitForFunction(()=>document.querySelector('#applyDateTime').getAttribute('aria-disabled')==='false');
  assert.equal((await state(p)).modal,'datetime');assert.equal(await p.locator('[data-field=hour]').textContent(),'14');assert.equal(await p.locator('[data-field=minute]').textContent(),'42');assert.match(await p.locator('.date-time-zone').textContent(),/Europe\/Amsterdam/);
  assert.equal(await p.evaluate(()=>timeTest.calls.filter(c=>c.uri.endsWith('/setSystemTime')).length),0);checks.push(width+': open reads TV timezone and time without writing');
  assert.equal(await p.evaluate(()=>document.activeElement.dataset.field),'day');
  await p.keyboard.press('ArrowUp');assert.equal(await p.locator('[data-field=day]').textContent(),'19');
  await p.keyboard.press('ArrowDown');await p.keyboard.press('ArrowRight');await p.keyboard.press('ArrowRight');
  for(const digit of '2028')await p.keyboard.press(digit);assert.equal(await p.locator('[data-field=year]').textContent(),'2028');
  for(const digit of '2026')await p.keyboard.press(digit);await p.keyboard.press('Enter');
  assert.equal(await p.evaluate(()=>document.activeElement.id),'applyDateTime');
  await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('.date-time-status').textContent==='TV date and time updated.');
  assert.deepEqual(await p.evaluate(()=>timeTest.calls.filter(c=>c.uri.endsWith('/setSystemTime')).map(c=>c.data)),[{utc:1789735378}]);
  assert.equal(await p.evaluate(()=>timeTest.calls.filter(c=>c.uri.endsWith('/getSystemTime')).length),2);checks.push(width+': remote editing, digit entry, explicit Apply, exact UTC seconds and read-back');
  await p.screenshot({path:path.join(out,'date-time-'+width+'.png')});
  await p.evaluate(()=>{timeTest.delayWrites=true;});await p.locator('#applyDateTime').evaluate(b=>{b.click();b.click();});
  assert.equal(await p.evaluate(()=>timeTest.writes.length),1);await p.keyboard.press('Escape');assert.equal((await state(p)).modal,null);
  await p.evaluate(()=>timeTest.writes.shift()());await p.waitForTimeout(20);assert.equal((await state(p)).modal,null);checks.push(width+': pending write is single-shot; closing does not undo it or reopen panel');
  await p.evaluate(()=>{timeTest.delayWrites=false;timeTest.deny=true;});await p.keyboard.press('Enter');await p.waitForFunction(()=>document.querySelector('#applyDateTime').getAttribute('aria-disabled')==='false');await p.locator('#applyDateTime').click();await p.waitForFunction(()=>document.querySelector('.date-time-status').textContent.includes('Permission denied'));assert.equal(await p.locator('#applyDateTime').getAttribute('aria-disabled'),'false');checks.push(width+': native denial is shown without privileged fallback');
  await p.keyboard.press('Escape');await p.evaluate(()=>{timeTest.delayReads=true;});await p.keyboard.press('Enter');await p.keyboard.press('Escape');await p.evaluate(()=>timeTest.reads.shift()());await p.waitForTimeout(20);assert.equal((await state(p)).modal,null);checks.push(width+': cancelled time read cannot update a closed panel');
  await p.evaluate(()=>{timeTest.delayReads=false;});await p.keyboard.press('Enter');await p.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal((await state(p)).modal,null);await p.evaluate(()=>window.dispatchEvent(new Event('pageshow')));checks.push(width+': standby/pagehide cancels editor and does not send a write');
  await p.evaluate(()=>{timeTest.delayReads=true;});await p.keyboard.press('Enter');
  const timeBounds=await p.locator('.date-time-fields').boundingBox();
  await p.evaluate(()=>timeTest.reads.shift()());
  assert.deepEqual(await p.locator('.date-time-fields').boundingBox(),timeBounds);
  assert.equal(await p.locator('.date-time-status').textContent(),'');
  await p.keyboard.press('Escape');await p.evaluate(()=>{timeTest.delayReads=false;});
  checks.push(width+': delayed clock data keeps field layout stable and footer quiet');
  await navigate(p,'apps','org.test.one');const launches=await p.evaluate(()=>catalogHarness.launches.length);
  await p.keyboard.down('Enter');await p.waitForTimeout(180);
  assert.equal((await state(p)).itemOptions.open,false);assert.equal(await p.locator('.item-options-button').count(),8);
  const pre=await p.evaluate(()=>{window.mainNodes=[...document.querySelectorAll('.item-options-actions>button')];return timeTest.calls.filter(c=>c.uri.endsWith('/getAppInfo')).length;});
  await p.waitForFunction(()=>C5App.getState().itemOptions.open);assert.equal((await state(p)).itemOptions.opening,false);await p.keyboard.up('Enter');
  assert.equal(await p.evaluate(()=>catalogHarness.launches.length),launches);assert.ok(await p.evaluate(()=>timeTest.calls.filter(c=>c.uri.endsWith('/getAppInfo')).length)<=pre+1);
  await p.waitForFunction(()=>!C5App.getState().itemOptions.opening&&C5App.getState().itemOptions.removable);
  assert.equal(await p.evaluate(()=>timeTest.calls.filter(c=>c.uri.endsWith('/getAppInfo')).length),pre+1);checks.push(width+': prewarm during hold; one metadata request after instant open');
  const style=await p.locator('.item-options-panel').evaluate(el=>{
    const s=getComputedStyle(el),settings=getComputedStyle(document.getElementById('modal'));
    const props=['backgroundColor','borderLeftColor','borderLeftWidth','width','height','marginRight','paddingLeft'];
    const pick=node=>Object.fromEntries(props.map(key=>[key,node[key]]));
    return {actual:pick(s),settings:pick(settings),shadow:s.boxShadow,contain:s.contain,will:s.willChange,transition:s.transitionProperty};
  });
  for(const key of ['width','height','marginRight','paddingLeft']){assert.ok(Math.abs(parseFloat(style.actual[key])-parseFloat(style.settings[key]))<.02,key+' matches settings');delete style.actual[key];delete style.settings[key];}
  assert.deepEqual(style.actual,style.settings);assert.equal(style.actual.backgroundColor,'rgba(0, 0, 0, 0)');assert.equal(style.shadow,'none');assert.match(style.contain,/paint|content/);assert.equal(style.transition,'none');assert.equal(style.will,'auto');
  const box=await p.locator('.item-options-panel').boundingBox();assert.ok(Math.abs(box.x+box.width-width*.94)<2);assert.ok(Math.abs(box.height-width*9/16*.82)<2);await p.screenshot({path:path.join(out,'options-'+width+'.png')});checks.push(width+': shared settings styling without animation');
  await p.keyboard.press('Escape');await p.waitForTimeout(280);await p.keyboard.press('F2');await p.waitForFunction(()=>!C5App.getState().itemOptions.opening);
  assert.equal(await p.evaluate(()=>[...document.querySelectorAll('.item-options-actions>button')].every((b,i)=>b===mainNodes[i])),true);checks.push(width+': action nodes reused on repeat opening');
  await p.keyboard.press('Escape');await p.keyboard.press('F2');await p.keyboard.press('Escape');await p.waitForTimeout(350);assert.equal((await state(p)).itemOptions.open,false);assert.equal(await p.locator('.item-options').getAttribute('aria-hidden'),'true');checks.push(width+': instant closing invalidates deferred metadata');
  await p.emulateMedia({reducedMotion:'reduce'});await p.keyboard.press('F2');assert.equal((await state(p)).itemOptions.opening,false);assert.equal(await p.locator('.item-options-panel').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');checks.push(width+': all modes open without a staged slide');
  await p.keyboard.press('Escape');await p.keyboard.press('Enter');await p.waitForFunction(n=>catalogHarness.launches.length===n+1,launches);checks.push(width+': short OK still launches once on release');
 }finally{await context.close();}
 }
 assert.deepEqual(errors,[]);const results={passed:checks.length,checks,errors,browser:await browser.version(),testedOnTV:false,renderer:'static test fixture',nativeCalls:'synthetic'};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
