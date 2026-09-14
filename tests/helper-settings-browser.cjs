// SPDX-License-Identifier: GPL-3.0-or-later
// Simulated setup results; no Homebrew commands or TV connections.
const assert = require('node:assert/strict');
module.exports = async function (browser, checks, errors) {
  const page = await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:8765');
    await page.waitForFunction(()=>window.C5App);
    await page.evaluate(()=>{
      window.setupTest={reads:0,writes:0,current:'missing',resolve:null};
      window.C5HelperAdapter={
        getState:()=>{setupTest.reads++;return Promise.resolve({state:setupTest.current});},
        install:()=>{setupTest.writes++;return new Promise(resolve=>{setupTest.resolve=resolve;});}
      };
    });
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    for(let i=0;i<3;i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'Set up TV features',exact:true}).click();
    await page.getByRole('button',{name:'Enable TV features',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>setupTest.writes),0,'opening settings is read-only');
    await page.getByRole('button',{name:'Enable TV features',exact:true}).click();
    await page.waitForFunction(()=>setupTest.writes===1);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>setupTest.writes),1,'repeat activation cannot start a second installer');
    await page.keyboard.press('Escape');
    assert.equal((await page.evaluate(()=>C5App.getState())).modal,null);
    await page.evaluate(()=>{setupTest.current='running';setupTest.resolve({state:'starting'});});
    await page.waitForTimeout(30);
    assert.equal((await page.evaluate(()=>C5App.getState())).modal,null,'a late setup result cannot reopen the panel');
    await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'Set up TV features',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('modalContent').textContent.includes('TV helper is running'));
    assert.equal(await page.evaluate(()=>setupTest.writes),1);
    const fit=await page.locator('#modal').evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;});
    assert.equal(fit,true);
    checks.push('TV integration installs only on an explicit action, prevents duplicate writes and preserves closed-panel focus through late replies');
    await page.evaluate(()=>{C5HelperAdapter.getState=()=>Promise.reject(new Error('Homebrew Channel is not running with root access.'));});
    await page.getByRole('button',{name:'Check status',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(),/root access/);
    assert.equal(await page.getByRole('button',{name:'Enable TV features',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>setupTest.writes),1);
    checks.push('Unavailable root access has an actionable error without an automatic install attempt');
  } finally { await page.close(); }
};

if (require.main === module) {
  (async () => {
    const {chromium} = require('playwright');
    const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
    try {
      const checks=[], errors=[];
      await module.exports(browser,checks,errors);
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({checks,testedOnTV:false}));
    } finally { await browser.close(); }
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
