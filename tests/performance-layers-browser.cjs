// SPDX-License-Identifier: GPL-3.0-or-later
// Real DOM/layer-tree checks. No TV, native uninstall or renderer timing claim.
'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const base=path.resolve(__dirname,'..'), out=path.join(base,'artifacts/performance-layers');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?
  {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),args:['--no-sandbox']});
 const checks=[],errors=[],measurements=[];
 try{
 for(const width of [1280,1920]){
  const page=await browser.newPage({viewport:{width,height:width*9/16}});page.on('pageerror',e=>errors.push(e.message));
  const cdp=await page.context().newCDPSession(page);let layers=[];cdp.on('LayerTree.layerTreeDidChange',e=>{layers=e.layers||[];});await cdp.send('LayerTree.enable');
  await page.setContent('<!doctype html><div class="screen"><header><span id="time">12:00</span></header><div id="categories"><button class="category active"><span class="face lit"><span class="category-label">Apps</span></span></button></div><div class="cross-content"><div id="items"><span class="item-text">Player</span></div><div class="detail"><h1>Player</h1><p>Installed app</p></div></div></div>');
  for(const f of ['style.css','item-options.css'])await page.addStyleTag({content:fs.readFileSync(path.join(base,'app',f),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(base,'app/item-options.js'),'utf8')});
  await page.evaluate(()=>{
   window.calls=0;window.item={id:'org.test.player',title:'Player',type:'APP'};window.category={id:'apps',title:'Apps',items:[item]};
   window.options=new LGXMBItemOptions({manager:{getAppInfo(){calls++;return Promise.resolve({info:{title:'Player',removable:false}});}},sound(){},
    onOpen(){document.body.classList.add('item-options-visible');document.querySelector('.screen').setAttribute('aria-hidden','true');},
    onClose(){document.body.classList.remove('item-options-visible');document.querySelector('.screen').removeAttribute('aria-hidden');},
    getSort:()=> 'default',onStart(){},onSort(){},onDeleted(){}});
  });
  const ids=await cdp.send('DOM.getDocument');const nodes={};
  for(const key of ['panel','shade']){
   const q=await cdp.send('DOM.querySelector',{nodeId:ids.root.nodeId,selector:'.item-options-'+key});
   nodes[key]=(await cdp.send('DOM.describeNode',{nodeId:q.nodeId})).node.backendNodeId;
  }
  async function closed(){
   await page.waitForFunction(()=>document.querySelector('.item-options').hidden);
   await page.waitForTimeout(60);
   assert.equal(await page.locator('.item-options-panel').boundingBox(),null);
   assert.equal(await page.locator('.item-options-shade').boundingBox(),null);
   const owned=layers.filter(l=>l.backendNodeId===nodes.panel||l.backendNodeId===nodes.shade);
   assert.equal(owned.length,0,'closed menu has no panel/shade entry in Chromium layer tree');
   return owned.length;
  }
  await closed();checks.push(width+': initially closed menu has no bounds or dedicated panel/shade layers');
  await page.evaluate(()=>options.prepare(item,category));await closed();assert.equal(await page.evaluate(()=>calls),0);
  checks.push(width+': preparing during hold builds no visible/retained GPU layer or metadata request');
  for(let cycle=0;cycle<3;cycle++){
   await page.evaluate(()=>options.open(item,category));await page.waitForFunction(()=>!options.opening);
   const style=await page.locator('.item-options-panel').evaluate(el=>({will:getComputedStyle(el).willChange,transform:getComputedStyle(el).transitionProperty}));
   assert.deepEqual(style,{will:'auto',transform:'none'});
   const text=await page.evaluate(()=>{
    const nodes=[...document.querySelectorAll('.category-label,.item-text,.detail h1,.detail p,#time,.item-options-heading,.item-options-button')];
    return nodes.filter(n=>n.getClientRects().length).map(n=>{let p=n,bad=[];while(p){if(getComputedStyle(p).opacity!=='1')bad.push(p.className||p.id);p=p.parentElement;}return {text:n.textContent,bad};});
   });
   assert.ok(text.length>=7);assert.deepEqual(text.filter(t=>t.bad.length),[],'text and its ancestors have no opacity layers');
   await page.evaluate(()=>options.close('back'));await closed();
  }
  checks.push(width+': three open/close cycles release layers, avoid all menu motion and avoid text opacity');
  await page.evaluate(()=>{options.open(item,category);options.close('lifecycle');});await closed();
  assert.equal(await page.evaluate(()=>options.opening),false);checks.push(width+': instant lifecycle close drops layers without queued opening frames');
  await page.evaluate(()=>options.open(item,category));await page.waitForFunction(()=>!options.opening);
  await page.evaluate(()=>options.close('back'));await page.waitForTimeout(20);await page.evaluate(()=>options.open(item,category));
  await page.waitForFunction(()=>!options.opening);await page.waitForTimeout(300);
  assert.equal(await page.locator('.item-options').evaluate(e=>e.hidden),false);checks.push(width+': stale closing deadline cannot hide a reopened panel');
  await page.evaluate(()=>options.close('lifecycle'));await closed();
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{options.open(item,category);options.close('back');});await closed();
  checks.push(width+': reduced-motion close releases layers immediately');
  measurements.push({width,height:width*9/16,closedPanelLayers:0,closedShadeLayers:0,cycles:3});
  await page.close();
 }
 assert.deepEqual(errors,[]);fs.mkdirSync(out,{recursive:true});
 const result={passed:checks.length,checks,measurements,browser:await browser.version(),errors,testedOnTV:false,scope:'isolated actual options controller/CSS; static underlying UI'};
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
