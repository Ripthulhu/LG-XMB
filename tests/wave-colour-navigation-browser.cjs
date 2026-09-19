// SPDX-License-Identifier: GPL-3.0-or-later
const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});try{
 for(const width of [1280,1920]){const p=await b.newPage({viewport:{width,height:width*9/16}});
 await p.setContent('<div id="modal"><div id="content"></div></div>');
 await p.addStyleTag({content:fs.readFileSync('app/style.css','utf8')});
 for(const f of ['menu-focus.js','wave-colors.js','wave-color-settings.js'])await p.addScriptTag({content:fs.readFileSync('app/'+f,'utf8')});
 await p.evaluate(()=>{LGXMBWaveColorSettings.open(document.querySelector('#content'),{mode:'ps3',dateMode:'auto',timeMode:'night'},()=>{});document.addEventListener('keydown',e=>LGXMBWaveColorSettings.key(e,document.querySelector('#modal')));});
 const group=p.getByRole('group',{name:'Time of day',exact:true});
 const boxes=await group.locator('button').evaluateAll(bs=>bs.map(b=>b.getBoundingClientRect().y));assert.ok(boxes[0]<boxes[1]&&boxes[1]<boxes[2]);
 await p.getByRole('group',{name:'Month selection',exact:true}).getByRole('button',{name:'Automatic',exact:true}).focus();
 await p.keyboard.press('ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'auto');
 await p.keyboard.press('ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'day');
 await p.keyboard.press('ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'night');
 await p.keyboard.press('ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'night');
 await p.keyboard.press('ArrowUp');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'day');
 await p.keyboard.press('ArrowUp');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'auto');
 await p.keyboard.press('ArrowUp');assert.equal(await p.evaluate(()=>document.activeElement.closest('[role=group]').getAttribute('aria-label')),'Month selection');
 await p.close();
 }console.log('PASS: vertical time choices and bottom boundary at 720p and 1080p');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
