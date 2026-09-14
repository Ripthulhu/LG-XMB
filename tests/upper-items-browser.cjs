// Real layout and pointer checks; no TV connection or native media.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  const errors=[],checks=[];
  try{
    for(const width of [1280,1920]){
      const page=await browser.newPage({viewport:{width,height:width*9/16}});
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({motion:'reduced'})));
      await page.goto(pathToFileURL(path.resolve(__dirname,'../app/index.html')).href);await page.waitForFunction(()=>window.C5App);
      await page.keyboard.press('ArrowLeft');
      for(let i=0;i<3;i++)await page.keyboard.press('ArrowDown');
      assert.equal((await page.evaluate(()=>C5App.getState())).item,'com.webos.app.hdmi4');
      const geometry=await page.evaluate(()=>{
        const bar=document.querySelector('.category.active .category-icon').getBoundingClientRect();
        const selected=document.querySelector('.item.selected .item-icon').getBoundingClientRect();
        return {bar:{top:bar.top,bottom:bar.bottom},selected:{top:selected.top},
          upper:Array.from(document.querySelectorAll('.item.above-bar')).filter(el=>el.getAttribute('aria-hidden')==='false').map(el=>{
            const rect=el.querySelector('.item-icon').getBoundingClientRect();
            const text=el.querySelector('.item-text'),label=text.getBoundingClientRect();
            return {top:rect.top,bottom:rect.bottom,left:rect.left,name:el.getAttribute('aria-label'),
              labelVisible:getComputedStyle(text).visibility,label:{left:label.left,right:label.right,top:label.top,bottom:label.bottom},text:text.textContent};
          })};
      });
      assert.equal(geometry.upper.length,3);
      assert.ok(geometry.selected.top>geometry.bar.bottom);
      for(const item of geometry.upper){assert.ok(item.top>=0);assert.ok(item.bottom<geometry.bar.top);assert.equal(item.labelVisible,'visible');assert.equal(item.text,item.name);assert.ok(item.name);
        assert.ok(item.label.right>item.label.left);assert.ok(item.label.top>=0&&item.label.bottom<geometry.bar.top);assert.ok(item.label.right<=width);}
      assert.ok(geometry.upper[0].top<geometry.upper[1].top&&geometry.upper[1].top<geometry.upper[2].top);
      // Above-bar options remain named and clickable, not decorative duplicates.
      await page.getByRole('option',{name:'HDMI 2',exact:true}).locator('.item-text').click();
      await page.waitForFunction(()=>!C5App.getState().busy);
      assert.equal((await page.evaluate(()=>C5App.getState())).item,'com.webos.app.hdmi2');
      await page.keyboard.press('ArrowUp');
      assert.equal(await page.locator('.item.above-bar[aria-hidden="false"]').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),false);
      checks.push(width+'px: upper icons with visible labels, separate category bar, label click and reverse scrolling');
      await page.close();
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({testedOnTV:false,checks},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
