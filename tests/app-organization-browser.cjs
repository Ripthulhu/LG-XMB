// SPDX-License-Identifier: GPL-3.0-or-later
// Actual UI modules, isolated renderer/media and synthetic native service replies.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const base=path.resolve(__dirname,'..'),out=path.join(base,'artifacts/app-organization');
const checks=[],errors=[];checks.push=function(...x){console.log('PASS',...x);return Array.prototype.push.apply(this,x);};const state=p=>p.evaluate(()=>C5App.getState());
async function go(p,category,id){
 const r=await p.evaluate(c=>{const cs=C5Catalog;return [cs.findIndex(x=>x.id===C5App.getState().category),cs.findIndex(x=>x.id===c)];},category);
 for(let i=0;i<Math.abs(r[1]-r[0]);i++)await p.keyboard.press(r[1]>r[0]?'ArrowRight':'ArrowLeft');
 if(id){const a=await p.evaluate(id=>{const c=C5Catalog.find(x=>x.id===C5App.getState().category);return[c.items.findIndex(x=>x.id===C5App.getState().item),c.items.findIndex(x=>x.id===id)];},id);assert.ok(a[1]>=0,id);for(let i=0;i<Math.abs(a[1]-a[0]);i++)await p.keyboard.press(a[1]>a[0]?'ArrowDown':'ArrowUp');assert.equal((await state(p)).item,id);}
}
async function load(p,data={}){
 await p.setContent('<html><body></body></html>');await p.evaluate(data=>{
  window.testStorage={...data};window.failStorage=false;Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>testStorage[k]||null,setItem:(k,v)=>{if(failStorage)throw Error('Storage unavailable');testStorage[k]=String(v);},removeItem:k=>delete testStorage[k]}});
 },data);
 let html=fs.readFileSync(path.join(base,'app/index.html'),'utf8').replace(/<script src="[^"]+"><\/script>/g,'').replace(/<link[^>]+rel="stylesheet"[^>]*>/g,'');await p.setContent(html);
 for(const name of ['style.css','item-options.css','date-time-settings.css'])await p.addStyleTag({content:fs.readFileSync(path.join(base,'app',name),'utf8')});
 for(const name of ['icons.js','catalog.js','category-transition.js'])await p.addScriptTag({content:fs.readFileSync(path.join(base,'app',name),'utf8')});
 await p.addScriptTag({content:fs.readFileSync(path.join(base,'tests/fixtures/catalog-platform.js'),'utf8')});
 await p.evaluate(()=>{
  window.h={apps:[{id:'org.test.one',title:'Alpha Player'},{id:'org.test.two',title:'Beta Tools'},{id:'cdp-30',title:'Plex'}],reads:[],removes:[],meta:[],delay:false,fail:false};
  C5TV.listInputLabels=()=>Promise.resolve({preview:false,inputs:[{id:'com.webos.app.hdmi2',port:2,label:'Game console'}]});
  C5TV.listApps=()=>{let resolve,reject;const p=new Promise((a,b)=>{resolve=a;reject=b;});const r={resolve,reject,cancelled:false};h.reads.push(r);p.cancel=()=>{r.cancelled=true;reject(Error('Cancelled'));};if(!h.delay){if(h.fail)reject(Error('Permission denied'));else resolve({preview:false,apps:JSON.parse(JSON.stringify(h.apps))});}return p;};
  window.PalmSystem={identifier:'com.webos.app.home'};
  window.PalmServiceBridge=function(){this.cancel=()=>{};this.call=(uri,json)=>{
   const data=JSON.parse(json),r={uri,data,reply:this.onservicecallback};
   if(uri.endsWith('/getAppInfo')){h.meta.push(r);queueMicrotask(()=>r.reply(JSON.stringify({returnValue:true,appInfo:{id:data.id,title:h.apps.find(a=>a.id===data.id)?.title||data.id,version:'2.4.0',vendor:'Example',type:'web',removable:true,systemApp:false,folderPath:'/media/cryptofs/apps/usr/palm/applications/'+data.id}})));}
   else if(uri.endsWith('/remove'))h.removes.push(r);
   else if(uri.endsWith('/getSystemTime'))queueMicrotask(()=>r.reply(JSON.stringify({returnValue:true,utc:1789735378,timezone:'Europe/Amsterdam',offset:120,TZ:'Europe/Amsterdam',isManual:true})));
   else throw Error('Unexpected service '+uri);
  };};
 });
 for(const name of ['menu-sounds.js','app-manager.js','hold-gesture.js','menu-order.js','app-categories.js','app-refresh.js','item-options.js','system-time.js','date-time-settings.js'])await p.addScriptTag({content:fs.readFileSync(path.join(base,'app',name),'utf8')});
 // Keep production timing by default; expose the scheduler only to advance
 // selected race tests without spending 30 seconds on every permutation.
 await p.evaluate(()=>{const Native=LGXMBAppRefresh;window.LGXMBAppRefresh=function(o){return window.testRefresh=new Native(o);};});
 await p.addScriptTag({content:fs.readFileSync(path.join(base,'app/app.js'),'utf8')});
 await p.waitForFunction(()=>C5Catalog.some(c=>c.items.some(i=>i.id==='org.test.one')));
}
async function refresh(p){await p.evaluate(()=>{testRefresh.lastAttempt=-Infinity;testRefresh.refresh();});await p.waitForFunction(()=>!testRefresh.request&&!testRefresh.pending&&testRefresh.lastSuccess!==null);await p.waitForTimeout(550);}
const places=(p,id)=>p.evaluate(id=>C5Catalog.filter(c=>c.items.some(i=>i.id===id)).map(c=>c.id),id);
async function choose(p,ids){
 if(ids==='default')await p.locator('[data-action=category-default]').click();
 else {
  for(const b of await p.locator('[data-category-id]').all()){
   const id=await b.getAttribute('data-category-id');
   if((await b.getAttribute('aria-checked')==='true')!==ids.includes(id))await b.click();
  }
 }
 await p.locator('[data-action=category-apply]').click();
}


async function multiChecks(ctx,width){
 const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));
 try{
  const seed={'lg-xmb-app-categories-v1':JSON.stringify({'cdp-30':'video','org.test.one':['music','apps']})};
  await load(p,seed);assert.deepEqual(await places(p,'cdp-30'),['video']);assert.deepEqual(await places(p,'org.test.one'),['music','apps']);
  checks.push(width+': legacy scalar and new multi-category preferences coexist');
  await go(p,'video','cdp-30');await p.keyboard.press('F2');await p.locator('[data-action=category]').click();
  assert.equal(await p.locator('[role=checkbox]').count(),7);assert.equal(await p.locator('[data-action=category-video]').getAttribute('aria-checked'),'true');
  await p.evaluate(()=>{window.pickNode=document.querySelector('[data-action=category-music]');window.pickMutations=0;window.pickObserver=new MutationObserver(xs=>{pickMutations+=xs.filter(x=>x.type==='childList').length;});pickObserver.observe(document.querySelector('.item-options-actions'),{childList:true,subtree:true});});
  await p.locator('[data-action=category-music]').focus();await p.keyboard.press('Enter');
  assert.equal(await p.locator('[data-action=category-music]').getAttribute('aria-checked'),'true');assert.equal((await state(p)).itemOptions.open,true);
  assert.deepEqual(await places(p,'cdp-30'),['video']);assert.equal(await p.evaluate(()=>JSON.parse(testStorage['lg-xmb-app-categories-v1'])['cdp-30']),'video');
  assert.equal(await p.evaluate(()=>document.activeElement===pickNode),true);assert.equal(await p.evaluate(()=>pickMutations),0);await p.evaluate(()=>pickObserver.disconnect());
  checks.push(width+': OK checks Music in place; no immediate save, move, close or focus loss');
  await p.keyboard.press('Space');assert.equal(await p.locator('[data-action=category-music]').getAttribute('aria-checked'),'false');
  await p.keyboard.down('Space');await p.keyboard.down('Space');await p.keyboard.up('Space');assert.equal(await p.locator('[data-action=category-music]').getAttribute('aria-checked'),'true');
  checks.push(width+': Space toggles once; held-key repeats do not flip checkboxes repeatedly');
  await p.screenshot({path:path.join(out,'multi-categories-'+width+'.png')});
  await p.locator('[data-action=category-apply]').click();assert.deepEqual(await places(p,'cdp-30'),['music','video']);assert.equal((await state(p)).category,'video');assert.equal((await state(p)).item,'cdp-30');
  assert.equal(await p.evaluate(()=>document.activeElement.id),'items');
  assert.equal(await p.locator('#items .rows[data-category=music] [data-item="cdp-30"]').count(),1);assert.equal(await p.locator('#items .rows[data-category=video] [data-item="cdp-30"]').count(),1);
  assert.equal(await p.evaluate(()=>document.querySelector('.rows[data-category=music] [data-item="cdp-30"]')!==document.querySelector('.rows[data-category=video] [data-item="cdp-30"]')),true);
  checks.push(width+': Apply creates two independent shortcuts, stays in Video and restores list focus');
  const saved=await p.evaluate(()=>({...testStorage}));assert.deepEqual(JSON.parse(saved['lg-xmb-app-categories-v1'])['cdp-30'],['music','video']);
  await p.evaluate(()=>{window.sharedRows=Array.from(document.querySelectorAll('#items [data-item="cdp-30"]'));window.rowMutations=0;window.rowObserver=new MutationObserver(xs=>rowMutations+=xs.length);rowObserver.observe(document.querySelector('#items'),{childList:true,subtree:true,attributes:true,characterData:true});});
  await p.waitForTimeout(600);await p.evaluate(()=>rowMutations=0);await refresh(p);
  assert.equal(await p.evaluate(()=>rowMutations),0);assert.equal(await p.evaluate(()=>sharedRows.every(n=>n.isConnected)),true);await p.evaluate(()=>rowObserver.disconnect());
  checks.push(width+': unchanged app refresh retains both row elements with zero menu mutations');
  for(const cat of ['music','video']){await go(p,cat,'cdp-30');await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>catalogHarness.launches.at(-1)),'cdp-30');}
  checks.push(width+': either shortcut launches the same native Plex app');
  await p.keyboard.press('F2');await p.locator('[data-action=info]').click();assert.match(await p.locator('.item-options-info').innerText(),/Categories\s+Music, Video/);await p.keyboard.press('Escape');await p.keyboard.press('Escape');
  checks.push(width+': Information lists every assigned category');
  await p.keyboard.press('F2');await p.locator('[data-action=category]').click();await p.locator('[data-action=category-music]').click();await p.locator('[data-action=category-cancel]').click();await p.keyboard.press('Escape');assert.deepEqual(await places(p,'cdp-30'),['music','video']);
  for(const action of ['back','close','hide']){
   await p.keyboard.press('F2');await p.locator('[data-action=category]').click();await p.locator('[data-action=category-photo]').click();
   if(action==='back'){await p.keyboard.press('ArrowLeft');await p.keyboard.press('Escape');}
   else if(action==='close'){await p.locator('.item-options-shade').click({position:{x:10,y:10}});}
   else{await p.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await p.evaluate(()=>window.dispatchEvent(new Event('pageshow')));}
   assert.deepEqual(await places(p,'cdp-30'),['music','video']);
  }
  checks.push(width+': Cancel, Back, click-away and lifecycle hide discard uncommitted memberships');
  await p.keyboard.press('F2');await p.locator('[data-action=category]').click();await p.locator('[data-action=category-music]').click();await p.locator('[data-action=category-video]').click();
  assert.equal(await p.locator('[data-action=category-apply]').getAttribute('aria-disabled'),'true');await p.locator('[data-action=category-apply]').focus();await p.keyboard.press('Enter');assert.equal((await state(p)).itemOptions.open,true);assert.match(await p.locator('.item-options-status').innerText(),/at least one/);assert.deepEqual(await places(p,'cdp-30'),['music','video']);
  await p.locator('[data-action=category-default]').click();assert.deepEqual(await p.locator('[aria-checked=true]').evaluateAll(xs=>xs.map(x=>x.dataset.categoryId)),['apps']);assert.deepEqual(await places(p,'cdp-30'),['music','video']);await p.keyboard.press('Escape');await p.keyboard.press('Escape');
  checks.push(width+': empty selection cannot hide an app; Default stages Apps and is cancellable');
  await p.keyboard.press('F2');await p.locator('[data-action=category]').click();await p.locator('[data-action=category-video]').click();await p.locator('[data-action=category-apply]').click();assert.deepEqual(await places(p,'cdp-30'),['music']);assert.equal((await state(p)).category,'music');
  checks.push(width+': removing the current location follows the first retained location');
  await p.keyboard.press('F2');await p.locator('[data-action=category]').click();await choose(p,['music','video']);
  await p.evaluate(()=>h.apps=h.apps.map(a=>a.id==='cdp-30'?{...a,title:'Plex renamed'}:a));await refresh(p);
  assert.deepEqual(await p.locator('#items [data-item="cdp-30"] .item-text').allTextContents(),['Plex renamed','Plex renamed']);checks.push(width+': refreshed title reaches both shortcuts');
  // The scheduler queues a reply while the category picker contains a draft.
  await p.waitForTimeout(600);await p.evaluate(()=>{h.delay=true;testRefresh.lastAttempt=-Infinity;testRefresh.refresh();});await p.waitForFunction(()=>!!testRefresh.request);
  await p.keyboard.press('F2');await p.locator('[data-action=category]').click();await p.locator('[data-action=category-photo]').click();
  await p.evaluate(()=>h.reads.at(-1).resolve({apps:h.apps.concat([{id:'org.test.whileediting',title:'Installed while choosing'}])}));await p.waitForTimeout(550);
  assert.deepEqual(await places(p,'org.test.whileediting'),[]);assert.equal(await p.locator('[data-action=category-photo]').getAttribute('aria-checked'),'true');
  await p.keyboard.press('Escape');await p.keyboard.press('Escape');await p.waitForFunction(()=>C5Catalog.some(c=>c.items.some(i=>i.id==='org.test.whileediting')));await p.evaluate(()=>h.delay=false);assert.deepEqual(await places(p,'cdp-30'),['music','video']);
  checks.push(width+': delayed installation refresh does not replace the draft or selected app');
  await p.keyboard.press('F2');await p.waitForFunction(()=>C5App.getState().itemOptions.removable);await p.locator('[data-action=delete]').click();assert.equal(await p.evaluate(()=>document.activeElement.dataset.action),'cancel-delete');await p.locator('[data-action=confirm-delete]').click();await p.waitForFunction(()=>h.removes.length>0);assert.equal(await p.evaluate(()=>h.removes.length),1);
  await p.evaluate(()=>{const r=h.removes.at(-1);r.reply(JSON.stringify({id:r.data.id,statusValue:31}));});await p.waitForFunction(()=>!C5App.getState().itemOptions.open);assert.deepEqual(await places(p,'cdp-30'),[]);assert.equal(await p.locator('#items [data-item="cdp-30"]').count(),0);
  await refresh(p);assert.deepEqual(await places(p,'cdp-30'),[]);await p.evaluate(()=>h.apps=h.apps.filter(a=>a.id!=='cdp-30'));await refresh(p);await p.evaluate(()=>h.apps.push({id:'cdp-30',title:'Plex reinstalled'}));await refresh(p);assert.deepEqual(await places(p,'cdp-30'),['music','video']);
  checks.push(width+': one uninstall removes every shortcut; stale replies stay suppressed; reinstall restores both');
  const ids=await p.locator('[id]').evaluateAll(xs=>xs.map(x=>x.id));assert.equal(new Set(ids).size,ids.length);
  const fresh=await ctx.newPage();await load(fresh,saved);assert.deepEqual(await places(fresh,'cdp-30'),['music','video']);await fresh.close();
  checks.push(width+': saved choices survive a fresh Home instance without duplicate element IDs');
 }finally{await p.close();}
}

(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
 try{for(const [width,height] of [[1920,1080],[1280,720],[1024,768]].filter(x=>!process.env.TEST_WIDTH||String(x[0])===process.env.TEST_WIDTH)){
 const ctx=await browser.newContext({viewport:{width,height},bypassCSP:true});const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));
 try{
  await load(p);assert.deepEqual(await places(p,'cdp-30'),['apps']);checks.push(width+': Plex discovered in Apps, no curated duplicate');
  await go(p,'apps','org.test.one');const launches=await p.evaluate(()=>catalogHarness.launches.length);
  await p.keyboard.down('Enter');await p.waitForTimeout(680);assert.equal((await state(p)).itemOptions.open,true);assert.equal((await state(p)).itemOptions.opening,false);await p.keyboard.up('Enter');assert.equal(await p.evaluate(()=>catalogHarness.launches.length),launches);
  const style=await p.locator('.item-options-panel').evaluate(e=>{const s=getComputedStyle(e);return {duration:s.transitionDuration,animation:s.animationName,transform:s.transform,will:s.willChange,bg:s.backgroundColor};});
  assert.deepEqual(style,{duration:'0s',animation:'none',transform:'none',will:'auto',bg:'rgba(0, 0, 0, 0)'});assert.equal(await p.evaluate(()=>document.activeElement.dataset.action),'start');assert.equal(await p.locator('.item-options-panel').evaluate(e=>e.getAnimations().length),0);checks.push(width+': long hold opens immediately with no slide, layers hint, or accidental launch');
  await p.screenshot({path:path.join(out,'options-'+width+'.png')});
  await p.locator('[data-action=category]').focus();await p.keyboard.press('ArrowRight');assert.equal((await state(p)).itemOptions.view,'category');assert.equal(await p.locator('.item-options-actions button').count(),10);
  const box=await p.locator('.item-options-panel').boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height);await p.screenshot({path:path.join(out,'categories-'+width+'.png')});
  await choose(p,['video']);assert.equal((await state(p)).category,'video');assert.equal((await state(p)).item,'org.test.one');assert.equal((await state(p)).modal,null);assert.deepEqual(await places(p,'org.test.one'),['video']);assert.equal(await p.evaluate(()=>document.activeElement.id),'items');assert.equal(await p.locator('.item-options').isVisible(),false);checks.push(width+': category picker moves app once, follows it and restores focus; close instant');
  const saved=await p.evaluate(()=>({...testStorage}));assert.deepEqual(JSON.parse(saved['lg-xmb-app-categories-v1'])['org.test.one'],['video']);
  await p.keyboard.press('F2');await p.locator('[data-action=category]').click();await choose(p,'default');assert.deepEqual(await places(p,'org.test.one'),['apps']);checks.push(width+': Default location reverses assignment');
  await p.keyboard.press('F2');await p.locator('[data-action=category]').click();await p.evaluate(()=>window.failStorage=true);await choose(p,['photo']);assert.match(await p.locator('.item-options-status').innerText(),/Storage unavailable/);assert.deepEqual(await places(p,'org.test.one'),['apps']);await p.evaluate(()=>window.failStorage=false);await p.keyboard.press('Escape');await p.keyboard.press('Escape');checks.push(width+': storage failure does not move app');
  await go(p,'tv','com.webos.app.hdmi2');await p.keyboard.press('F2');assert.equal(await p.locator('[data-action=category]').getAttribute('aria-disabled'),'true');assert.equal(await p.locator('[data-action=delete]').getAttribute('aria-disabled'),'true');await p.keyboard.press('Escape');assert.equal(await p.locator('#detailTitle').innerText(),'Game console');checks.push(width+': HDMI assignment/deletion unavailable; physical input label retained');
  await go(p,'apps','org.test.one');await p.waitForTimeout(550);
  await p.evaluate(()=>{window.nodeBefore=document.querySelector('#items .rows:not(.parked) [data-item="org.test.one"]');window.mutations=0;window.mo=new MutationObserver(x=>mutations+=x.length);mo.observe(document.querySelector('#items'),{subtree:true,childList:true,attributes:true,characterData:true});});
  await refresh(p);assert.equal(await p.evaluate(()=>nodeBefore===document.querySelector('#items .rows:not(.parked) [data-item="org.test.one"]')),true);assert.equal(await p.evaluate(()=>mutations),0);await p.evaluate(()=>mo.disconnect());checks.push(width+': unchanged refresh performs no row DOM mutations');
  await p.evaluate(()=>window.dispatchEvent(new Event('pagehide')));const calls=await p.evaluate(()=>h.reads.length);await p.evaluate(()=>h.apps.push({id:'org.test.installed',title:'Fresh installation'}));await p.waitForTimeout(50);assert.equal(await p.evaluate(()=>h.reads.length),calls);await p.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await p.waitForFunction(()=>C5Catalog.some(c=>c.items.some(i=>i.id==='org.test.installed')));assert.equal((await state(p)).item,'org.test.one');checks.push(width+': installing away from Home appears on return without reload or selection jump');
  await p.evaluate(()=>{h.apps.push({id:'org.test.second',title:'Another installation'});document.dispatchEvent(new Event('webOSRelaunch'));});await p.waitForFunction(()=>C5Catalog.some(c=>c.items.some(i=>i.id==='org.test.second')));checks.push(width+': Home relaunch refreshes installed apps');
  await p.evaluate(()=>{h.delay=true;testRefresh.lastAttempt=-Infinity;testRefresh.refresh();});await p.waitForFunction(()=>h.reads.at(-1)&&!!testRefresh.request);await p.keyboard.press('F2');await p.evaluate(()=>h.reads.at(-1).resolve({apps:h.apps.concat([{id:'org.test.delayed',title:'Deferred'}])}));await p.waitForTimeout(550);assert.deepEqual(await places(p,'org.test.delayed'),[]);assert.equal((await state(p)).itemOptions.item,'org.test.one');await p.keyboard.press('Escape');await p.waitForFunction(()=>C5Catalog.some(c=>c.items.some(i=>i.id==='org.test.delayed')));await p.evaluate(()=>h.delay=false);checks.push(width+': in-flight reply waits for options close; target never changes under panel');
  await p.evaluate(()=>h.fail=true);await refresh(p);assert.deepEqual(await places(p,'org.test.one'),['apps']);assert.match((await state(p)).appRefresh.error,/Permission denied/);await p.evaluate(()=>h.fail=false);checks.push(width+': failed enumeration preserves catalog');
  await p.keyboard.press('F2');await p.locator('[data-action=category]').click();await choose(p,['music']);await p.keyboard.press('F2');await p.waitForFunction(()=>C5App.getState().itemOptions.removable);await p.locator('[data-action=delete]').click();assert.equal(await p.evaluate(()=>document.activeElement.dataset.action),'cancel-delete');await p.locator('[data-action=confirm-delete]').click();await p.waitForFunction(()=>h.removes.length>0);await p.evaluate(()=>{let r=h.removes.at(-1);r.reply(JSON.stringify({id:r.data.id,statusValue:31}));});await p.waitForFunction(()=>!C5App.getState().itemOptions.open);assert.deepEqual(await places(p,'org.test.one'),[]);await refresh(p);assert.deepEqual(await places(p,'org.test.one'),[]);checks.push(width+': uninstall confirmation still protected, removes assigned app, ignores stale positive inventory');
  await p.evaluate(()=>h.apps=h.apps.filter(i=>i.id!=='org.test.one'));await refresh(p);await p.evaluate(()=>h.apps.push({id:'org.test.one',title:'Reinstalled Player'}));await refresh(p);assert.deepEqual(await places(p,'org.test.one'),['music']);checks.push(width+': reinstall restores user category');
  await go(p,'apps','org.test.two');await p.waitForTimeout(500);await p.locator('#items>.rows:not(.parked) [data-item="org.test.two"]').click({button:'right'});assert.equal((await state(p)).itemOptions.open,true);await p.locator('[data-action=refresh]').click();assert.equal((await state(p)).itemOptions.open,false);checks.push(width+': right-click and explicit Refresh apps remain available');
  const ids=await p.locator('[id]').evaluateAll(n=>n.map(x=>x.id));assert.equal(new Set(ids).size,ids.length);assert.ok(await p.evaluate(()=>document.getElementById(document.getElementById('items').getAttribute('aria-activedescendant'))));checks.push(width+': accessibility IDs/focus remain valid after moving and reinstalling');
  if(width===1920){
   // Fast-forward the poll deadline in this integration check. Unit tests
   // separately exercise the exact 30-second interval with a controlled clock.
   await p.evaluate(()=>{h.apps.push({id:'org.test.poll',title:'Installed while Home visible'});testRefresh.nextRead=0;testRefresh.lastAttempt=-Infinity;testRefresh.pump();});await p.waitForFunction(()=>C5Catalog.some(c=>c.items.some(i=>i.id==='org.test.poll')));checks.push('1920: visible periodic refresh discovers new app (deadline accelerated)');
   const p2=await ctx.newPage();p2.setDefaultTimeout(10000);p2.on('pageerror',e=>errors.push(e.message));await load(p2,saved);assert.deepEqual(await places(p2,'org.test.one'),['video']);await p2.close();checks.push('1920: saved assignment restored in a fresh UI instance');
  }
  await multiChecks(ctx,width);
 }catch(error){console.error('FAIL',error);console.error('STATE',await state(p).catch(()=>null));throw error;}finally{await ctx.close();}
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results'+(process.env.TEST_WIDTH?'-'+process.env.TEST_WIDTH:'')+'.json'),JSON.stringify({passed:checks.length,checks,browser:await browser.version(),nativeServices:'test doubles',renderer:'test double',testedOnTV:false},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
