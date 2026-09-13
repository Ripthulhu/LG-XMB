// Synthetic remote settings checks; no real mapping or TV exit calls.
const assert=require('node:assert/strict');
const path=require('node:path');
module.exports=async function checkRemoteSettings(browser,checks,errors){
  async function create(inject){const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',error=>errors.push(error.message));if(inject)await page.addInitScript(inject);await page.goto('http://127.0.0.1:8765');await page.waitForFunction(()=>window.C5App);return page;}
  async function open(page){await page.getByRole('button',{name:'Settings',exact:true}).click();for(let i=0;i<12&&await page.evaluate(()=>C5App.getState().item!=='remote');i++)await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForFunction(()=>C5App.getState().modal==='remote'&&C5App.getState().remote&&!C5App.getState().remote.pending);}
  const page=await create(()=>{
    window.remoteTest={gets:0,writes:[],backs:0,state:{available:true,revision:4,home:'custom',homeKeepClosed:true}};
    window.C5RemoteAdapter={getState:()=>{remoteTest.gets++;return Promise.resolve({...remoteTest.state});},setHome:(home,revision)=>new Promise((resolve,reject)=>remoteTest.writes.push({home,revision,resolve,reject}))};
  });
  try{
    await page.evaluate(()=>{window.C5TV=Object.assign({},C5TV,{platformBack:()=>{remoteTest.backs++;return Promise.resolve({ok:true,preview:false});}});});
    assert.equal(await page.evaluate(()=>C5App.getState().preferences.backBehavior),'stay');
    await open(page);assert.equal(await page.evaluate(()=>remoteTest.writes.length),0);
    const home=()=>page.getByRole('group',{name:'Home button',exact:true});
    const back=()=>page.getByRole('group',{name:'Back button',exact:true});
    assert.equal(await home().getByRole('button',{name:'Our Home',exact:true}).getAttribute('aria-pressed'),'true');
    await home().getByRole('button',{name:'LG Home',exact:true}).click();await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>remoteTest.writes.length),1);
    assert.equal(await home().getByRole('button',{name:'Our Home',exact:true}).getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>{remoteTest.state={available:true,revision:5,home:'stock',homeKeepClosed:false};remoteTest.writes[0].resolve({...remoteTest.state});});
    await page.waitForFunction(()=>!C5App.getState().remote.pending);
    assert.equal(await home().getByRole('button',{name:'LG Home',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>C5App.getState().remote.homeKeepClosed),false);
    await home().getByRole('button',{name:'Our Home',exact:true}).click();
    await page.evaluate(()=>remoteTest.writes[1].reject(new Error('The TV did not confirm the change.')));
    await page.waitForFunction(()=>!C5App.getState().remote.pending);
    assert.equal(await home().getByRole('button',{name:'LG Home',exact:true}).getAttribute('aria-pressed'),'true');
    assert.match(await page.locator('.background-error').innerText(),/did not confirm/);
    assert.equal(await page.evaluate(()=>remoteTest.gets),2);
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-remote-choice')),'Home button:custom');
    checks.push('Remote Home settings read actual mapping without startup writes, serialize changes, keep old selection until confirmed and re-read failures without retrying writes');
    await back().getByRole('button',{name:'LG behavior',exact:true}).click();
    assert.equal(await page.evaluate(()=>C5App.getState().preferences.backBehavior),'lg');
    await page.screenshot({path:path.join(__dirname,'../qa/settings-remote-1080.png')});
    await page.keyboard.down('Escape');assert.equal(await page.evaluate(()=>C5App.getState().modal),null);assert.equal(await page.evaluate(()=>remoteTest.backs),0);
    await page.keyboard.down('Escape');assert.equal(await page.evaluate(()=>remoteTest.backs),0);await page.keyboard.up('Escape');
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>remoteTest.backs),1);
    await page.reload();await page.waitForFunction(()=>window.C5App);
    assert.equal(await page.evaluate(()=>C5App.getState().preferences.backBehavior),'lg');
    await open(page);
    await page.evaluate(()=>{window.realSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('Storage unavailable');};});
    await back().getByRole('button',{name:'Stay in Home',exact:true}).click();
    assert.equal(await page.evaluate(()=>C5App.getState().preferences.backBehavior),'lg');
    assert.match(await page.locator('.background-error').innerText(),/could not save/);
    await page.evaluate(()=>{Storage.prototype.setItem=window.realSetItem;delete window.realSetItem;});
    await back().getByRole('button',{name:'Stay in Home',exact:true}).click();
    assert.equal(await page.evaluate(()=>C5App.getState().preferences.backBehavior),'stay');
    checks.push('Back defaults to staying in Home; LG behavior is local and persistent, closes panels first, ignores held Back, and preserves the saved choice on storage failure');
    await page.keyboard.press('Escape');await page.evaluate(()=>{remoteTest.state={available:true,revision:6,home:'other',homeKeepClosed:false};});await open(page);
    await home().getByRole('button',{name:'Our Home',exact:true}).click({force:true});
    assert.equal(await page.evaluate(()=>remoteTest.writes.length),0);
    assert.match(await page.locator('#modalContent').innerText(),/Another app is assigned/);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('modal')).borderLeftColor),'rgba(255, 255, 255, 0.16)');
    checks.push('A foreign Home mapping is shown read-only and the Remote panel retains the white XMB styling');
  }finally{await page.close();}
  const preview=await create();
  try{
    const result=await preview.evaluate(async()=>{
      let process=await C5ProcessControl.getState();process=await C5ProcessControl.setEnabled('usage',true,process.revision);
      const before=await C5RemoteControl.getState();const stock=await C5RemoteControl.setHome('stock',before.revision);
      const after=await C5ProcessControl.getState();const custom=await C5RemoteControl.setHome('custom',stock.revision);
      return{before,stock,custom,home:after.items.find(item=>item.id==='home'),usage:after.items.find(item=>item.id==='usage')};
    });
    assert.equal(result.before.home,'custom');assert.equal(result.stock.home,'stock');assert.equal(result.stock.homeKeepClosed,false);
    assert.equal(result.home.enabled,false);assert.equal(result.usage.enabled,true);assert.equal(result.custom.homeKeepClosed,false);
    await preview.evaluate(()=>localStorage.setItem('openxmb-c5-preferences-v1',JSON.stringify({backBehavior:'not-a-choice'})));await preview.reload();await preview.waitForFunction(()=>window.C5App);
    assert.equal(await preview.evaluate(()=>C5App.getState().preferences.backBehavior),'stay');
    checks.push('Desktop Home mapping simulation allows LG Home without changing other background choices; returning to custom does not silently re-enable closing and invalid Back preferences default safely');
  }finally{await preview.close();}
};
