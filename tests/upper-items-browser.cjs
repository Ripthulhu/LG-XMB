// Real layout and pointer checks; no TV connection or native media.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const menu=require('./support/menu-navigation.cjs');
module.exports=async function checkUpperItems(browser,checks,errors){
    for(const width of [1280,1920]){
      const page=await browser.newPage({viewport:{width,height:width*9/16}});
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({motion:'reduced'})));
      await page.goto(pathToFileURL(path.resolve(__dirname,'../app/index.html')).href);await page.waitForFunction(()=>window.C5App);
      await menu.item(page,'tv','com.webos.app.hdmi4');
      assert.equal((await page.evaluate(()=>C5App.getState())).item,'com.webos.app.hdmi4');
      const geometry=await page.evaluate(()=>{
        const bar=document.querySelector('.category.active .lit .category-icon').getBoundingClientRect();
        const selected=document.querySelector('.rows:not(.parked) .item.selected .item-icon').getBoundingClientRect();
        return {bar:{top:bar.top,bottom:bar.bottom},selected:{top:selected.top},
          upper:Array.from(document.querySelectorAll('.rows:not(.parked) .item.above-bar')).filter(el=>el.getAttribute('aria-hidden')==='false').map(el=>{
            const rect=el.querySelector('.item-icon').getBoundingClientRect();
            return {top:rect.top,bottom:rect.bottom,left:rect.left,name:el.getAttribute('aria-label'),
              labelVisible:getComputedStyle(el.querySelector('.item-text')).visibility,
              label:el.querySelector('.item-text').textContent,
              labelTop:el.querySelector('.item-text').getBoundingClientRect().top,
              labelBottom:el.querySelector('.item-text').getBoundingClientRect().bottom};
          })};
      });
      assert.equal(geometry.upper.length,2);
      assert.ok(geometry.selected.top>geometry.bar.bottom);
      for(const item of geometry.upper){assert.ok(item.top>=0);assert.ok(item.bottom<geometry.bar.top);assert.equal(item.labelVisible,'visible');assert.equal(item.label,item.name);
        assert.ok(item.labelTop>=0);assert.ok(item.labelBottom<geometry.bar.top);}
      assert.ok(geometry.upper[0].top<geometry.upper[1].top);
      fs.mkdirSync(path.resolve(__dirname,'../qa'),{recursive:true});
      await page.screenshot({path:path.resolve(__dirname,'../qa/upper-labels-'+width+'.png')});
      // Above-bar options remain named and clickable, not decorative duplicates.
      await page.getByRole('option',{name:'HDMI 2',exact:true}).locator('.item-text').click();
      await page.waitForFunction(()=>!C5App.getState().busy);
      assert.equal((await page.evaluate(()=>C5App.getState())).item,'com.webos.app.hdmi2');
      await menu.item(page,'tv','com.webos.app.livetv');
      assert.equal(await page.locator('#items > .rows:not(.parked) .item.above-bar[aria-hidden="false"]').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false);
      // Long native input names use the existing ellipsis, not hidden text.
      await page.evaluate(()=>{C5Catalog.find(c=>c.id==='tv').items.find(i=>i.id==='com.webos.app.hdmi1').title='Console and receiver with a very long custom HDMI input name';});
      await menu.category(page,'apps');await menu.item(page,'tv','com.webos.app.hdmi2');
      const longLabel=menu.activeItem(page,'com.webos.app.hdmi1').locator('.item-text');
      assert.equal(await longLabel.isVisible(),true);
      assert.equal(await longLabel.evaluate(el=>getComputedStyle(el).textOverflow),'ellipsis');
      assert.equal(await longLabel.evaluate(el=>el.scrollWidth>el.clientWidth),true);
      const bounds=await longLabel.boundingBox();
      assert.ok(bounds.x+bounds.width<=width);
      await longLabel.click();await page.waitForFunction(()=>!C5App.getState().busy);
      assert.equal((await page.evaluate(()=>C5App.getState())).item,'com.webos.app.hdmi1');
      checks.push(width+'px: upper icons and text, clickable labels, long-name ellipsis and reverse scrolling');
      await page.close();
    }
    assert.deepEqual(errors,[]);
};
if(require.main===module){
  (async()=>{
    const browser=await chromium.launch(menu.launchOptions()),checks=[],errors=[];
    try{await module.exports(browser,checks,errors);console.log(JSON.stringify({testedOnTV:false,checks},null,2));}
    finally{await browser.close();}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
