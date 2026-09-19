// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Categories=require('../app/app-categories.js'),Order=require('../app/menu-order.js');
function storage(data={}){return {data,getItem(k){return this.data[k]||null;},setItem(k,v){this.data[k]=v;}};}
function fixture(store=storage()){
 const a={id:'native.media',title:'Media Player'},b={...a};
 const cats=[{id:'settings',title:'Settings',icon:'settings',items:[{id:'clock',title:'Clock',action:'datetime'}]},
 {id:'photo',title:'Photo',icon:'image',items:[a]}, {id:'music',title:'Music',icon:'music',items:[b]},
 {id:'video',title:'Video',icon:'media',items:[]}, {id:'tv',title:'TV',icon:'live',items:[{id:'com.webos.app.hdmi1',title:'HDMI 1',action:'input'}]},
 {id:'apps',title:'Apps',icon:'apps',items:[]}, {id:'browser',title:'Browser',icon:'globe',items:[{id:'native.browser',title:'Browser'}]},
 {id:'network',title:'Network',icon:'network',items:[]}];
 const sel=cats.map(()=>0),order=new Order(cats,store),model=new Categories(cats,order,store);model.rebuild(sel);
 return {cats,sel,store,order,model,cat:id=>cats.find(c=>c.id===id),where:id=>cats.filter(c=>c.items.some(i=>i.id===id)).map(c=>c.id)};
}
const apps=[{id:'org.example.player',title:'A Player'},{id:'cdp-30',title:'Plex'}];

test('hiding removes every shared shortcut and restoring preserves locations',()=>{
 const f=fixture(),item=f.cat('photo').items[0];f.model.hide(item,f.sel);
 assert.deepEqual(f.where(item.id),[]);assert.equal(f.cat('photo').items[0].action,'empty');
 assert.deepEqual(f.model.hiddenApps(),[{id:item.id,title:item.title}]);
 f.model.reconcile([{id:item.id,title:item.title}],f.sel);assert.deepEqual(f.where(item.id),[]);
 f.model.restore(item.id,f.sel);assert.deepEqual(f.where(item.id),['photo','music']);assert.deepEqual(f.model.hiddenApps(),[]);
 assert.equal(f.order.removed.size,0);
});
test('hidden apps survive restart and inventory refresh while keeping assignments and recent sorting',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);const item=f.cat('apps').items[0];
 f.model.assign(item,['video','music'],f.sel);f.order.record(item.id);f.order.set(f.cat('music'),'recent',item.id);
 f.model.hide(f.cat('video').items[0],f.sel);
 const g=fixture(f.store);g.model.reconcile(apps,g.sel);assert.deepEqual(g.where(item.id),[]);
 g.model.restore(item.id,g.sel);assert.deepEqual(g.where(item.id),['music','video']);assert.equal(g.cat('music').items[0].id,item.id);
});
test('hide and restore preserve default order and reuse surviving app rows',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);const original=f.cat('apps').items.slice();
 f.model.hide(original[0],f.sel);assert.strictEqual(f.cat('apps').items[0],original[1]);
 f.model.restore(original[0].id,f.sel);assert.deepEqual(f.cat('apps').items,original);assert.strictEqual(f.cat('apps').items[0],original[0]);
});
test('refused visibility saves leave lists, hidden choices and selections untouched',()=>{
 const f=fixture(),item=f.cat('photo').items[0],save=f.store.setItem;
 f.store.setItem=()=>{throw Error('storage full');};const selections=f.sel.slice();
 assert.throws(()=>f.model.hide(item,f.sel),/storage full/);assert.deepEqual(f.where(item.id),['photo','music']);assert.deepEqual(f.sel,selections);
 f.store.setItem=save;f.model.hide(item,f.sel);f.store.setItem=()=>{throw Error('storage full');};
 assert.throws(()=>f.model.restore(item.id,f.sel),/storage full/);assert.deepEqual(f.where(item.id),[]);assert.equal(f.model.hiddenApps().length,1);
});
test('inputs, launcher settings and empty rows cannot be hidden; native apps can',()=>{
 const f=fixture();for(const item of [f.cat('settings').items[0],f.cat('tv').items[0],f.cat('apps').items[0],{id:'com.webos.app.home'},null])assert.equal(f.model.canHide(item),false);
 assert.equal(f.model.canHide(f.cat('photo').items[0]),true);assert.throws(()=>f.model.hide(f.cat('settings').items[0],f.sel));
});
test('hidden list remains restorable before discovery, ignores malformed entries and renders safe titles',()=>{
 const f=fixture(storage({'lg-xmb-hidden-apps-v1':JSON.stringify({'org.test.app':'Saved app','../bad':'Bad','com.webos.app.home':'Home','native.media':'\u202eMedia'})}));
 assert.deepEqual(f.model.hiddenApps(),[{id:'native.media',title:'Media'},{id:'org.test.app',title:'Saved app'}]);
 f.model.restore('org.test.app',f.sel);f.model.reconcile([{id:'org.test.app',title:'Installed app'}],f.sel);assert.deepEqual(f.where('org.test.app'),['apps']);
});
test('unassigned apps go to Apps regardless of app name; no Plex catalogue rule',()=>{const f=fixture();assert.equal(f.model.reconcile(apps,f.sel),true);assert.deepEqual(f.where('cdp-30'),['apps']);const source=fs.readFileSync(path.join(__dirname,'../app/catalog.js'),'utf8');assert.doesNotMatch(source,/cdp-30|Plex/);});
test('choosing Video moves rather than duplicates an app and follows its selection',()=>{const f=fixture();f.model.reconcile(apps,f.sel);const item=f.cat('apps').items[0];let ci=f.model.assign(item,'video',f.sel);assert.equal(f.cats[ci].id,'video');assert.equal(f.cats[ci].items[f.sel[ci]].id,item.id);assert.deepEqual(f.where(item.id),['video']);});
test('assignment survives process restart and subsequent install snapshot',()=>{const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],'music',f.sel);const fresh=fixture(f.store);fresh.model.reconcile(apps,fresh.sel);assert.deepEqual(fresh.where(apps[0].id),['music']);});
test('shared native shortcuts collapse to one explicit category, Default restores both',()=>{const f=fixture();f.model.assign(f.cat('photo').items[0],'video',f.sel);assert.deepEqual(f.where('native.media'),['video']);f.model.assign(f.cat('video').items[0],'default',f.sel);assert.deepEqual(f.where('native.media'),['photo','music']);assert.equal(f.model.get('native.media'),'default');assert.notEqual(f.cat('photo').items[0],f.cat('music').items[0]);});
test('Default for a discovered app restores Apps',()=>{const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],'tv',f.sel);f.model.assign(f.cat('tv').items.find(i=>i.id===apps[0].id),'default',f.sel);assert.deepEqual(f.where(apps[0].id),['apps']);});
test('settings, inputs, empty placeholders and Home identities cannot be assigned',()=>{const f=fixture();for(const item of [f.cat('settings').items[0],f.cat('tv').items[0],f.cat('apps').items[0],{id:'com.webos.app.home'},{id:'org.local.openxmb.c5'},null])assert.equal(f.model.canAssign(item),false);assert.throws(()=>f.model.assign({id:'native.browser'},'settings',f.sel));assert.equal(f.model.choices().length,7);});
test('refused storage leaves category and assignment unchanged',()=>{const f=fixture();f.model.reconcile(apps,f.sel);f.store.setItem=()=>{throw Error('disk full');};assert.throws(()=>f.model.assign(f.cat('apps').items[0],'video',f.sel),/disk full/);assert.deepEqual(f.where(apps[0].id),['apps']);assert.equal(f.model.get(apps[0].id),'default');});
test('unknown and dangerous saved destinations do not affect the catalog',()=>{const f=fixture(storage({'lg-xmb-app-categories-v1':'{"org.example.player":"settings","native.browser":"bogus","../bad":"video","com.webos.app.home":"apps","__proto__":"video"}'}));assert.equal(Object.keys(f.model.assignments).length,0);});
test('malformed or oversized storage falls back to default placements',()=>{for(const raw of ['["video"]','{broken','x'.repeat(262145)])assert.equal(Object.keys(fixture(storage({'lg-xmb-app-categories-v1':raw})).model.assignments).length,0);});
test('unchanged complete snapshot retains row identities, arrays, selections and has no change',()=>{const f=fixture();f.model.reconcile(apps,f.sel);const arrays=f.cats.map(c=>c.items),item=f.cat('apps').items[1];f.sel[5]=1;assert.equal(f.model.reconcile(apps.slice().reverse(),f.sel),false);assert.deepEqual(f.cats.map(c=>c.items),arrays);
 assert.equal(f.cat('apps').items[f.sel[5]],item);assert.equal(f.model.reconcile(apps,f.sel),false);assert.equal(f.cat('apps').items[1],item);
});
test('metadata update retains object but reports a changed render and sanitizes control chars',()=>{const f=fixture();f.model.reconcile(apps,f.sel);const item=f.cat('apps').items[0];assert.equal(f.model.reconcile([{id:item.id,title:'New\u0000 title'},apps[1]],f.sel),true);assert.equal(f.cat('apps').items[0],item);assert.equal(item.title,'New title');});
test('reconcile removes externally uninstalled apps from assigned categories',()=>{const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],'video',f.sel);f.model.reconcile([apps[1]],f.sel);assert.deepEqual(f.where(apps[0].id),[]);assert.equal(f.cat('video').items[0].action,'empty');assert.deepEqual(f.model.get(apps[0].id),['video']);f.model.reconcile(apps,f.sel);assert.deepEqual(f.where(apps[0].id),['video']);});
test('own deletion ignores stale positive snapshot until absent; reinstall retains category',()=>{const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],'video',f.sel);f.model.deleted(apps[0].id,f.sel);f.model.reconcile(apps,f.sel);assert.deepEqual(f.where(apps[0].id),[]);f.model.reconcile([],f.sel);f.model.reconcile(apps,f.sel);assert.deepEqual(f.where(apps[0].id),['video']);assert.equal(f.order.removed.has(apps[0].id),false);});
test('persisted deletion is cleared by a fresh startup inventory showing a reinstalled app',()=>{const f=fixture();f.model.reconcile(apps,f.sel);f.model.deleted(apps[0].id,f.sel);const g=fixture(f.store);g.model.reconcile(apps,g.sel);assert.deepEqual(g.where(apps[0].id),['apps']);});
test('native anchors are not removed by incomplete third-party visibility metadata',()=>{const f=fixture();f.model.reconcile([],f.sel);assert.deepEqual(f.where('native.media'),['photo','music']);assert.deepEqual(f.where('com.webos.app.hdmi1'),['tv']);});
test('invalid snapshots throw before removing existing entries',()=>{const f=fixture();f.model.reconcile(apps,f.sel);for(const value of [null,{},Array(1001).fill(apps[0])])assert.throws(()=>f.model.reconcile(value,f.sel));assert.equal(f.cat('apps').items.length,2);});
test('duplicate IDs and self apps are filtered without guessing by title',()=>{const f=fixture();f.model.reconcile([...apps,apps[0],{id:'com.webos.app.home',title:'Home'},{id:'../../file',title:'Bad'},null],f.sel);assert.equal(f.cat('apps').items.length,2);});
test('title data remains literal text, not markup or a category heuristic',()=>{const f=fixture();f.model.reconcile([{id:'org.example.x',title:'<img src=x> Netflix Music Photos'}],f.sel);assert.equal(f.cat('apps').items[0].title,'<img src=x> Netflix Music Photos');});
test('sorting preferences still apply after move and snapshot update',()=>{const f=fixture();f.model.reconcile(apps,f.sel);f.order.set(f.cat('music'),'za','native.media');f.model.assign(f.cat('apps').items[1],'music',f.sel);assert.deepEqual(f.cat('music').items.map(i=>i.title),['Plex','Media Player']);assert.equal(f.cat('music').items[f.sel[2]].id,'cdp-30');});
test('a removed selected item chooses its neighbor and empty categories stay usable',()=>{const f=fixture();f.model.reconcile(apps,f.sel);f.sel[5]=1;f.model.reconcile([apps[0]],f.sel);assert.equal(f.cat('apps').items[f.sel[5]].id,apps[0].id);f.model.reconcile([],f.sel);assert.equal(f.cat('apps').items[f.sel[5]].action,'empty');});
test('options code has no frame staging, animation hooks or parked layer CSS',()=>{const root=path.join(__dirname,'../app'),js=fs.readFileSync(path.join(root,'item-options.js'),'utf8'),css=fs.readFileSync(path.join(root,'item-options.css'),'utf8');assert.doesNotMatch(js,/requestAnimationFrame|transitionend|finishOpening|finishClosing/);assert.doesNotMatch(css,/will-change\s*:|translate3d|opacity\s*:|backdrop-filter|box-shadow/);assert.match(css,/\.item-options\{[^}]*display:none/);assert.match(css,/transition:none/);});

test('multiple choices are canonicalized, deduplicated and saved together',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);const item=f.cat('apps').items[0];
 f.model.assign(item,['video','music','video','apps'],f.sel,'apps');
 assert.deepEqual(f.where(item.id),['music','video','apps']);
 assert.deepEqual(f.model.get(item.id),['music','video','apps']);
 assert.deepEqual(JSON.parse(f.store.getItem('lg-xmb-app-categories-v1'))[item.id],['music','video','apps']);
 for(const c of f.cats)assert.ok(c.items.filter(i=>i.id===item.id).length<=1);
});
test('old strings and new arrays load together, without startup storage writes',()=>{
 const raw=JSON.stringify({'cdp-30':'video','org.example.player':['music','photo','music']});
 const store=storage({'lg-xmb-app-categories-v1':raw});store.setItem=()=>{throw Error('must not write');};
 const f=fixture(store);f.model.reconcile(apps,f.sel);
 assert.deepEqual(f.where('cdp-30'),['video']);assert.deepEqual(f.where(apps[0].id),['photo','music']);
 assert.deepEqual(f.model.get('cdp-30'),['video']);assert.equal(store.getItem('lg-xmb-app-categories-v1'),raw);
});
test('all seven destinations work; settings never becomes a destination',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);const ids=f.model.choices().map(c=>c.id);
 f.model.assign(f.cat('apps').items[0],ids,f.sel);
 assert.deepEqual(f.where(apps[0].id),ids);assert.equal(f.cat('settings').items.length,1);
});
test('copies of one app have independent row identities stable across unchanged snapshots',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],['music','video','apps'],f.sel);
 const all=['music','video','apps'].map(c=>f.cat(c).items.find(i=>i.id===apps[0].id));
 assert.equal(new Set(all).size,3);const arrays=f.cats.map(c=>c.items);
 for(let n=0;n<10;n++)assert.equal(f.model.reconcile(apps,f.sel),false);
 arrays.forEach((a,ci)=>assert.equal(f.cats[ci].items,a));
 assert.deepEqual(['music','video','apps'].map(c=>f.cat(c).items.find(i=>i.id===apps[0].id)),all);
});
test('updating the installed title updates every copy in place',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],['music','video'],f.sel);
 const copies=['music','video'].map(c=>f.cat(c).items.find(i=>i.id===apps[0].id));
 assert.equal(f.model.reconcile([{...apps[0],title:'Renamed Player'},apps[1]],f.sel),true);
 copies.forEach((row,i)=>{assert.equal(row.title,'Renamed Player');assert.equal(f.cat(['music','video'][i]).items.find(x=>x.id===row.id),row);});
 assert.equal(f.model.reconcile([{...apps[0],title:'Renamed Player'},apps[1]],f.sel),false);
});
test('removing a single membership leaves the other copies and selections untouched',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],['music','video','apps'],f.sel,'music');
 const row=f.cat('music').items.find(i=>i.id===apps[0].id);f.sel[5]=f.cat('apps').items.findIndex(i=>i.id==='cdp-30');
 const ci=f.model.assign(row,['music','apps'],f.sel,'music');
 assert.equal(ci,2);assert.equal(f.cat('music').items[f.sel[2]],row);assert.equal(f.cat('apps').items[f.sel[5]].id,'cdp-30');
 assert.deepEqual(f.where(row.id),['music','apps']);assert.equal(f.cat('video').items[0].action,'empty');
});
test('selection stays in retained current category or follows first remaining category',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);const item=f.cat('apps').items[0];
 assert.equal(f.cats[f.model.assign(item,['video','music','apps'],f.sel,'apps')].id,'apps');
 assert.equal(f.cats[f.model.assign(item,['video','music'],f.sel,'apps')].id,'music');
 assert.equal(f.cats[f.model.assign(item,['video','music'],f.sel,'video')].id,'video');
});
test('empty, unknown, oversized and mixed-invalid assignments are rejected before writes',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);const item=f.cat('apps').items[0],before=JSON.stringify(f.store.data),sels=f.sel.slice();
 for(const input of [[],null,{},['video','settings'],['video','bogus'],[42],Array(8).fill('apps')])assert.throws(()=>f.model.assign(item,input,f.sel));
 assert.equal(JSON.stringify(f.store.data),before);assert.deepEqual(f.where(item.id),['apps']);assert.deepEqual(f.sel,sels);
});
test('corrupt saved arrays fall back to defaults without hiding apps',()=>{
 for(const val of [[],['unknown'],['video','settings'],[null],Array(8).fill('apps')]){
  const f=fixture(storage({'lg-xmb-app-categories-v1':JSON.stringify({[apps[0].id]:val})}));f.model.reconcile(apps,f.sel);
  assert.deepEqual(f.where(apps[0].id),['apps']);assert.equal(f.model.get(apps[0].id),'default');
 }
});
test('getters and diagnostic snapshots cannot mutate saved memberships',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],['music','video'],f.sel);
 f.model.get(apps[0].id).push('network');f.model.locations(apps[0].id).pop();f.model.snapshot()[apps[0].id].pop();
 assert.deepEqual(f.model.get(apps[0].id),['music','video']);
});
test('a multi-category save failure leaves every row and selected item in place',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],['music','video'],f.sel);
 const before=f.cats.map(c=>c.items),sels=f.sel.slice();f.store.setItem=()=>{throw Error('quota');};
 assert.throws(()=>f.model.assign(f.cat('video').items[0],['apps','network'],f.sel),/quota/);
 assert.deepEqual(f.where(apps[0].id),['music','video']);before.forEach((rows,ci)=>assert.equal(f.cats[ci].items,rows));assert.deepEqual(f.sel,sels);
});
test('default locations are independent of overrides and restore all native shortcuts',()=>{
 const f=fixture();const origPhoto=f.cat('photo').items[0],origMusic=f.cat('music').items[0];
 f.model.assign(origPhoto,['video','apps'],f.sel);assert.deepEqual(f.model.defaultLocations('native.media'),['photo','music']);
 f.model.assign(f.cat('video').items[0],'default',f.sel);assert.deepEqual(f.where('native.media'),['photo','music']);
 assert.equal(f.cat('photo').items[0],origPhoto);assert.equal(f.cat('music').items[0],origMusic);
});
test('sorting and remembered selections remain independent between shared categories',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],['music','video'],f.sel);
 f.model.assign(f.cat('apps').items[0],['music','video'],f.sel);f.order.set(f.cat('music'),'za');f.order.set(f.cat('video'),'az');
 f.model.rebuild(f.sel);assert.deepEqual(f.cat('music').items.map(i=>i.title),['Plex','Media Player','A Player']);assert.deepEqual(f.cat('video').items.map(i=>i.title),['A Player','Plex']);
});
test('uninstall clears all copies and reinstall restores every saved destination',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],['music','video','network'],f.sel);
 f.model.deleted(apps[0].id,f.sel);f.model.reconcile(apps,f.sel);assert.deepEqual(f.where(apps[0].id),[]);
 f.model.reconcile([apps[1]],f.sel);f.model.reconcile(apps,f.sel);assert.deepEqual(f.where(apps[0].id),['music','video','network']);
 const fresh=fixture(f.store);fresh.model.reconcile(apps,fresh.sel);assert.deepEqual(fresh.where(apps[0].id),['music','video','network']);
});
test('external uninstall clears all discovered copies and reinstalls preserve membership',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],['music','video'],f.sel);
 f.model.reconcile([],f.sel);assert.deepEqual(f.where(apps[0].id),[]);assert.deepEqual(f.model.get(apps[0].id),['music','video']);
 f.model.reconcile(apps,f.sel);assert.deepEqual(f.where(apps[0].id),['music','video']);
});
test('newly installed unassigned apps still appear only in Apps',()=>{
 const f=fixture();f.model.reconcile(apps,f.sel);f.model.assign(f.cat('apps').items[0],['music','video'],f.sel);
 f.model.reconcile([...apps,{id:'fresh.app',title:'Fresh App'}],f.sel);assert.deepEqual(f.where('fresh.app'),['apps']);
 assert.deepEqual(f.where(apps[0].id),['music','video']);
});

test('native defaults outside assignable destinations are reported and restored correctly',()=>{
 const f=fixture(),native={id:'com.palm.app.settings',title:'TV Settings'};
 f.model.base[0].push(native);f.model.rebuild(f.sel);
 assert.deepEqual(f.model.defaultLocations(native.id),['settings']);
 f.model.assign(native,['apps'],f.sel);assert.deepEqual(f.where(native.id),['apps']);
 f.model.assign(f.cat('apps').items.find(i=>i.id===native.id),'default',f.sel);assert.deepEqual(f.where(native.id),['settings']);
});
