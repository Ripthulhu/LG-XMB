// SPDX-License-Identifier: GPL-3.0-or-later
// Real DOM/CSS/options controller; isolated from native services and WebGL.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = path.resolve(__dirname, '..');
const out = path.join(base, 'artifacts/item-options-style');
const checks = [], errors = [], traces = [];
async function load(page) {
  await page.setContent('<!doctype html><html><body><div class="screen" id="screen"><header>Clock</header><nav id="categories">Menu</nav><section class="cross-content">Items</section></div><div class="modal-backdrop" id="referenceBackdrop"><section class="modal" id="referencePanel"><div class="modal-top"><button id="referenceClose">×</button></div><h2 id="referenceTitle">Date &amp; time</h2><p class="modal-intro" id="referenceCaption">Set the TV clock manually.</p><div id="modalContent"><button class="option" id="referenceAction">Apply date &amp; time</button></div></section></div></body></html>');
  for (const name of ['style.css', 'item-options.css']) await page.addStyleTag({content:fs.readFileSync(path.join(base, 'app', name), 'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(base, 'app/item-options.js'), 'utf8')});
  await page.evaluate(() => {
    window.styleCalls = {metadata:0, removal:0, starts:0, sorts:0};
    window.styleItem = {id:'org.test.player', title:'Media player', type:'APP', description:'A test application.'};
    window.styleCategory = {id:'apps', title:'Apps', items:[styleItem, {id:'org.test.second'}]};
    window.styleOptions = new LGXMBItemOptions({
      manager:{getAppInfo:() => {styleCalls.metadata++; performance.mark('style-metadata'); return Promise.resolve({info:{title:'Media player', version:'1.2.3', removable:true}});},
        removeApp:() => {styleCalls.removal++; throw Error('This style test must not uninstall anything');}},
      sound:() => {},
      onOpen:() => {document.body.classList.add('item-options-visible'); document.getElementById('screen').setAttribute('aria-hidden','true');},
      onClose:() => {document.body.classList.remove('item-options-visible'); document.getElementById('screen').removeAttribute('aria-hidden');},
      onStart:() => {styleCalls.starts++;}, onSort:() => {styleCalls.sorts++;}, getSort:() => 'default', onDeleted:() => {}
    });
    for (const event of ['transitionstart','transitionend']) styleOptions.panel.addEventListener(event, e => {
      if (e.target === styleOptions.panel && e.propertyName === 'transform') performance.mark('style-' + event);
    });
    window.styleRead = (node, props, pseudo) => {
      const s=getComputedStyle(node, pseudo); return Object.fromEntries(props.map(p => [p,s[p]]));
    };
  });
}
async function reference(page) {
  return page.evaluate(() => {
    const panel=document.getElementById('referencePanel'), button=document.getElementById('referenceAction');
    button.focus();
    const rect=panel.getBoundingClientRect();
    return {box:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
      panel:styleRead(panel,['backgroundColor','backgroundImage','borderLeftColor','borderLeftWidth','paddingLeft','marginRight']),
      title:styleRead(document.getElementById('referenceTitle'),['fontSize','fontWeight','lineHeight','letterSpacing','marginBottom','color']),
      caption:styleRead(document.getElementById('referenceCaption'),['fontSize','lineHeight','color','marginBottom']),
      shade:styleRead(document.getElementById('referenceBackdrop'),['backgroundImage']),
      button:styleRead(button,['fontSize','lineHeight','color','backgroundImage','paddingLeft','paddingTop','borderLeftWidth']),
      marker:styleRead(button,['backgroundColor','width','top','height','opacity'],'::before'),
      close:styleRead(document.getElementById('referenceClose'),['fontSize','lineHeight','color','paddingLeft'])};
  });
}
async function actual(page) {
  return page.evaluate(() => {
    const panel=styleOptions.panel, button=styleOptions.actions.querySelector('[data-action=start]');
    const rect=panel.getBoundingClientRect();
    return {box:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
      panel:styleRead(panel,['backgroundColor','backgroundImage','borderLeftColor','borderLeftWidth','paddingLeft','marginRight']),
      title:styleRead(styleOptions.title,['fontSize','fontWeight','lineHeight','letterSpacing','marginBottom','color']),
      caption:styleRead(styleOptions.caption,['fontSize','lineHeight','color','marginBottom']),
      shade:styleRead(styleOptions.element.querySelector('.item-options-shade'),['backgroundImage']),
      button:styleRead(button,['fontSize','lineHeight','color','backgroundImage','paddingLeft','paddingTop','borderLeftWidth']),
      marker:styleRead(button,['backgroundColor','width','top','height','opacity'],'::before'),
      close:styleRead(styleOptions.backButton,['fontSize','lineHeight','color','paddingLeft'])};
  });
}
async function collectTrace(cdp) {
  const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  const {stream}=await complete; let raw='';
  for (;;) { const part=await cdp.send('IO.read',{handle:stream}); raw+=part.data; if(part.eof)break; }
  await cdp.send('IO.close',{handle:stream});
  return JSON.parse(raw);
}
(async () => {
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox']});
  try {
    for (const [width,height] of [[1280,720],[1920,1080],[1024,768]]) {
      const page=await browser.newPage({viewport:{width,height}}); page.on('pageerror',e=>errors.push(e.message));
      try {
        await load(page);
        await page.evaluate(() => {
          window.savedInfoReader=styleOptions.manager.getAppInfo;
          styleOptions.manager.getAppInfo=()=>new Promise(resolve=>{window.resolveFooterInfo=resolve;});
          styleOptions.prepare(styleItem,styleCategory);styleOptions.open(styleItem,styleCategory);
        });
        await page.waitForFunction(()=>!!window.resolveFooterInfo);
        const footerBefore=await page.locator('.item-options-panel').boundingBox();
        assert.equal(await page.locator('.item-options-status').textContent(),'');
        await page.evaluate(()=>resolveFooterInfo({info:{removable:false,removalReason:'System, launcher and recovery apps cannot be deleted here.'}}));
        await page.waitForFunction(()=>!!styleOptions.info);
        assert.equal(await page.locator('.item-options-status').textContent(),'');
        assert.deepEqual(await page.locator('.item-options-panel').boundingBox(),footerBefore);
        await page.locator('[data-action=delete]').evaluate(b=>b.click());
        assert.match(await page.locator('.item-options-status').textContent(),/cannot be deleted/);
        await page.evaluate(()=>{styleOptions.close('back');styleOptions.manager.getAppInfo=savedInfoReader;});
        checks.push(`${width}: delayed metadata leaves footer and panel stable; selecting unavailable Delete explains why`);
        for (const [theme,bg] of [['midnight','5,9,17'],['ember','19,9,6']]) {
          await page.evaluate(bg => {
            document.documentElement.style.setProperty('--background-rgb',bg);
            document.getElementById('referenceBackdrop').hidden=false;
          },bg);
          const expected=await reference(page);
          await page.evaluate(() => {document.getElementById('referenceBackdrop').hidden=true;styleOptions.prepare(styleItem,styleCategory);styleOptions.open(styleItem,styleCategory);});
          await page.waitForFunction(() => !styleOptions.opening && styleOptions.info);
          const got=await actual(page);
          for (const field of Object.keys(expected)) assert.deepEqual(got[field],expected[field],`${width} ${theme}: ${field}`);
          checks.push(`${width} ${theme}: panel/heading/action/focus/divider/backdrop match settings`);
          await page.locator('[data-action=sort]').click();
          assert.equal(await page.locator('[data-action=sort-default]').getAttribute('aria-pressed'),'true');
          assert.equal(await page.locator('[data-action=sort-default]').evaluate(el=>el.classList.contains('option')),true);
          await page.evaluate(()=>styleOptions.back());
          await page.locator('[data-action=delete]').click();
          assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'cancel-delete');
          await page.evaluate(()=>styleOptions.back());
          await page.locator('[data-action=info]').click();
          assert.match(await page.locator('.item-options-info').textContent(),/1\.2\.3/);
          assert.equal(await page.locator('.item-options-scroll').evaluate(el=>getComputedStyle(el).overflowY),'auto');
          await page.evaluate(()=>styleOptions.back());
          checks.push(`${width} ${theme}: sort, information and Cancel-first confirmation keep shared styling`);
          await page.evaluate(()=>styleOptions.close('back'));await page.waitForTimeout(270);
          const parked=await page.locator('.item-options-panel').boundingBox();assert.equal(parked,null);
          assert.equal(await page.evaluate(()=>styleCalls.removal),0);
          checks.push(`${width} ${theme}: panel releases its hidden surfaces; no uninstall`);
        }
        const closingEvent=await page.evaluate(() => {
          const before=styleCalls.metadata;
          styleOptions.open(styleItem,styleCategory);
          styleOptions.panel.dispatchEvent(new TransitionEvent('transitionend',{propertyName:'transform'}));
          return {opening:styleOptions.opening,shown:styleOptions.element.classList.contains('shown'),reads:styleCalls.metadata-before};
        });
        assert.deepEqual(closingEvent,{opening:false,shown:false,reads:0});
        await page.waitForFunction(()=>!styleOptions.opening&&styleOptions.info);
        await page.evaluate(()=>styleOptions.close('lifecycle'));
        checks.push(`${width}: a stale transition event has no effect on instant open`);
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.evaluate(()=>styleOptions.open(styleItem,styleCategory));
        assert.equal(await page.evaluate(()=>styleOptions.opening),false);
        assert.equal(await page.locator('.item-options-panel').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
        await page.evaluate(()=>styleOptions.close('lifecycle'));await page.emulateMedia({reducedMotion:'no-preference'});
        checks.push(`${width}: reduced motion and instant lifecycle close preserved`);
        if(width!==1024) {
          const cdp=await page.context().newCDPSession(page);
          await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing',transferMode:'ReturnAsStream'});
          await page.evaluate(()=>{performance.clearMarks();styleOptions.prepare(styleItem,styleCategory);styleOptions.open(styleItem,styleCategory);});
          await page.waitForFunction(()=>!styleOptions.opening&&styleOptions.info);
          const trace=await collectTrace(cdp), events=trace.traceEvents;
          const start=events.find(e=>e.name==='style-transitionstart'),end=events.find(e=>e.name==='style-transitionend');
          assert.equal(start,undefined,'no opening transition is scheduled');
          assert.equal(end,undefined,'no closing transition is scheduled');
          assert.equal(await page.locator('.item-options-panel').evaluate(e=>getComputedStyle(e).transform),'none');
          traces.push({viewport:`${width}x${height}`,slideMs:0,scope:'instant DOM panel; no WebGL or TV'});
          checks.push(`${width}: no transition marks or transform on instant panel`);
          await cdp.detach();
        }
      } finally {await page.close();}
    }
    assert.deepEqual(errors,[]);
    const result={passed:checks.length,checks,traces,errors,browser:await browser.version(),testedOnTV:false,nativeCalls:'synthetic',renderer:'not used'};
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
