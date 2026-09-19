// SPDX-License-Identifier: GPL-3.0-or-later
// Isolated menu test: current app/HTML/CSS, no TV calls or wave assets required.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/catalog');
const order=['settings','photo','music','video','tv','apps','browser','network'];
const results=[],errors=[];
const check=(name,fn)=>{fn();results.push(name);};
const state=page=>page.evaluate(()=>C5App.getState());
async function press(page,key,count=1){for(let i=0;i<count;i++)await page.keyboard.press(key);}
async function select(page,id){
  const current=(await state(page)).category,delta=order.indexOf(id)-order.indexOf(current);
  await press(page,delta<0?'ArrowLeft':'ArrowRight',Math.abs(delta));
  assert.equal((await state(page)).category,id);
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?
    {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox']});
  try{
    for(const [width,height] of [[1280,720],[1920,1080],[1024,768]]){
      const context=await browser.newContext({viewport:{width,height},bypassCSP:true});
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      const scripts=['icons.js','catalog.js','category-transition.js','catalog-platform.js','menu-focus.js','directional-repeat.js','menu-sounds.js','app-manager.js','hold-gesture.js','menu-order.js','app-categories.js','app-refresh.js','item-options.js','system-time.js','date-time-settings.js','launcher-preferences.js','settings-ui.js','appearance-settings.js','launcher-view.js','app.js'];
      let html=fs.readFileSync(path.join(root,'app/index.html'),'utf8').replace(/  <script src="[^"]+"><\/script>\n/g,'');
      // Load only local source strings. No server or network is needed. CSP is
      // bypassed for this harness's injected scripts, never changed in the app.
      html=html.replace(/<link[^>]+rel="stylesheet"[^>]*>/g,'');
      await page.setContent(html);
      await page.addStyleTag({content:fs.readFileSync(path.join(root,'app/style.css'),'utf8')});
      await page.addStyleTag({content:fs.readFileSync(path.join(root,'app/item-options.css'),'utf8')});
      for(const name of scripts){
        const file=name==='catalog-platform.js'?path.join(__dirname,'fixtures',name):path.join(root,'app',name);
        await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
      }
      await page.waitForFunction(()=>window.C5App);
      let pageState=await state(page);
      check(width+' starts at TV / Live TV',()=>{assert.equal(pageState.category,'tv');assert.equal(pageState.item,'com.webos.app.livetv');});
      const ids=await page.locator('#categories > button').evaluateAll(nodes=>nodes.map(n=>n.dataset.category));
      check(width+' category order',()=>assert.deepEqual(ids,order));
      await page.evaluate(()=>{
        catalogHarness.labels({preview:false,inputs:[{id:'com.webos.app.hdmi1',port:1,label:'PC'},
          {id:'com.webos.app.hdmi2',port:2,label:'Console'},
          {id:'com.webos.app.livetv',port:4,label:'Not an input'}]});
        catalogHarness.apps({preview:false,apps:[{id:'org.test.media',title:'A TV app'},
          {id:'org.test.media',title:'Duplicate'}, {id:'org.local.openxmb.c5',title:'Self'},
          {id:'com.webos.app.browser',title:'Duplicate browser'},
          {id:'org.webosbrew.hbchannel',title:'Duplicate Homebrew'},
          {id:'com.webos.app.discovery',title:'Duplicate store'},
          {id:'org.test.markup',title:'<img src=x onerror=alert(1)>'}]});
      });
      await page.waitForFunction(()=>C5Catalog.some(c=>c.items.some(i=>i.id==='org.test.media')));
      check(width+' input metadata does not rename Live TV',()=>assert.equal(pageState.item,'com.webos.app.livetv'));
      assert.equal(await page.locator('#detailTitle').textContent(),'Live TV');
      await press(page,'ArrowDown',3);await page.waitForTimeout(180);
      pageState=await state(page);
      check(width+' moved HDMI preview and labels',()=>{
        assert.equal(pageState.item,'com.webos.app.hdmi2');assert.equal(pageState.thumbnail.port,2);assert.equal(pageState.thumbnail.paused,false);
      });
      assert.equal(await page.locator('#detailTitle').textContent(),'Console');
      await press(page,'Enter');await page.waitForTimeout(25);
      assert.deepEqual(await page.evaluate(()=>catalogHarness.inputLaunches),['com.webos.app.hdmi2']);
      results.push(width+' HDMI uses physical input action');
      await press(page,'ArrowLeft');
      pageState=await state(page);check(width+' leaving TV stops preview immediately',()=>{assert.equal(pageState.category,'video');assert.equal(pageState.thumbnail.port,null);assert.equal(pageState.inputPreview.port,null);});
      await press(page,'ArrowRight');assert.equal((await state(page)).item,'com.webos.app.hdmi2');results.push(width+' TV selection retained');
      for(const id of order){
        await select(page,id);await page.waitForTimeout(430);
        const geometry=await page.locator('#categories > .active').evaluate(n=>{
          const b=n.getBoundingClientRect(),label=n.querySelector('.lit .category-label').getBoundingClientRect();
          return {center:b.x+b.width/2,width:b.width,labelLeft:label.left,labelRight:label.right};
        });
        check(width+' '+id+' anchored and label visible',()=>{
          assert.ok(Math.abs(geometry.center-width*(width/height<=4/3?.26:.31))<1);
          assert.ok(geometry.labelLeft>=0&&geometry.labelRight<=width);
        });
        const a11y=await page.evaluate(()=>{
          const list=document.getElementById('items'),target=document.getElementById(list.getAttribute('aria-activedescendant'));
          const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);
          return {active:document.querySelectorAll('#categories [aria-current="true"]').length,
            selected:target?.getAttribute('aria-selected'),parked:target?.parentElement.classList.contains('parked'),
            unique:new Set(ids).size===ids.length,label:list.getAttribute('aria-label')};
        });
        assert.equal(a11y.active,1);assert.equal(a11y.selected,'true');assert.equal(a11y.parked,false);assert.equal(a11y.unique,true);
      }
      await press(page,'ArrowRight',3);assert.equal((await state(page)).category,'network');
      await select(page,'settings');await press(page,'ArrowLeft',3);assert.equal((await state(page)).category,'settings');results.push(width+' endpoints clamp');
      await press(page,'Enter');assert.equal((await state(page)).modal,'appearance');await press(page,'Escape');assert.equal((await state(page)).modal,null);results.push(width+' settings still open and close');
      for(const [id,app] of [['photo','com.webos.app.lifeonscreen'],['music','com.webos.app.totalmusic'],
        ['video','com.webos.app.mediadiscovery'],['browser','com.webos.app.browser'],
        ['network','org.webosbrew.hbchannel']]){
        await select(page,id);await press(page,'Enter');await page.waitForTimeout(5);
        const target=await page.evaluate(()=>catalogHarness.launches[catalogHarness.launches.length-1]);
        check(width+' '+id+' launch target',()=>assert.equal(target,app));
      }
      await select(page,'network');await press(page,'ArrowDown');await press(page,'Enter');await page.waitForTimeout(5);
      assert.equal(await page.evaluate(()=>catalogHarness.launches[catalogHarness.launches.length-1]),'com.webos.app.discovery');
      results.push(width+' LG Apps launches from Network');await press(page,'ArrowUp');
      await select(page,'apps');await page.waitForTimeout(200);
      const installed=await page.locator('#items .rows:not(.parked) [data-item]').evaluateAll(nodes=>nodes.map(n=>n.dataset.item));
      check(width+' discovered apps deduplicated',()=>assert.deepEqual(installed,['com.webos.app.homeconnect','org.test.media','org.test.markup']));
      assert.equal(await page.locator('#items .rows:not(.parked) img').count(),0);
      await press(page,'ArrowDown');await press(page,'Enter');assert.equal(await page.evaluate(()=>catalogHarness.launches[catalogHarness.launches.length-1]),'org.test.media');results.push(width+' discovered app launch');
      await select(page,'network');await page.evaluate(()=>catalogHarness.failLaunch=true);await press(page,'Enter');await page.waitForTimeout(20);
      assert.equal((await state(page)).busy,false);assert.match(await page.locator('#toast').textContent(),/Could not open Homebrew Channel/);results.push(width+' launch failure recovers');
      await page.evaluate(()=>catalogHarness.failLaunch=false);await select(page,'tv');
      await page.evaluate(()=>{for(let i=0;i<60;i++)document.dispatchEvent(new KeyboardEvent('keydown',{key:i%2?'ArrowLeft':'ArrowRight',bubbles:true,cancelable:true}));});
      assert.equal((await state(page)).category,'tv');results.push(width+' rapid reversal retains selection');
      assert.equal(await page.evaluate(()=>catalogHarness.objects.filter(x=>x.id.startsWith('c')).length),8);
      await page.emulateMedia({reducedMotion:'reduce'});await select(page,'photo');
      assert.equal(await page.locator('#categories').evaluate(n=>n.classList.contains('categories-instant')),true);results.push(width+' reduced motion');
      await select(page,'tv');await page.waitForTimeout(250);
      // Live HDMI previews must follow the new TV placement as well.
      await select(page,'settings');await press(page,'ArrowDown',4);await press(page,'Enter');
      assert.equal((await state(page)).modal,'previews');
      await page.getByRole('button',{name:'Live',exact:true}).click();await press(page,'Escape');
      await select(page,'tv');assert.equal((await state(page)).inputPreview.port,2);
      await select(page,'video');assert.equal((await state(page)).inputPreview.port,null);
      results.push(width+' live preview starts and stops across categories');
      await select(page,'tv');
      await page.evaluate(()=>{
        window.savedInputRow=document.querySelector('#items .rows:not(.parked) [data-item="com.webos.app.hdmi2"]');
        document.dispatchEvent(new Event('webOSRelaunch'));
        catalogHarness.labels({preview:false,inputs:[{id:'com.webos.app.hdmi2',port:2,label:'Game console'}]});
      });
      await page.waitForTimeout(20);
      assert.equal(await page.evaluate(()=>window.savedInputRow===document.querySelector('#items .rows:not(.parked) [data-item="com.webos.app.hdmi2"]')),true);
      assert.equal(await page.locator('#detailTitle').textContent(),'Game console');
      assert.equal((await state(page)).item,'com.webos.app.hdmi2');
      results.push(width+' label refresh preserves selected row identity');
      await press(page,'ArrowUp',3);await page.waitForTimeout(250);
      if(width===1920)await page.screenshot({path:path.join(out,'tv-1080p.png')});
      await context.close();
    }
    check('no uncaught browser errors',()=>assert.deepEqual(errors,[]));
    const report={browser:browser.version(),platform:'Desktop Chromium; wave and native services are test doubles',passed:results.length,checks:results,errors};
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
