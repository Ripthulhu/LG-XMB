// SPDX-License-Identifier: GPL-3.0-or-later
// Synthetic audio playback, loop and UI checks. TV media/launch calls are inert fixtures.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkBackgroundMusic(browser, checks, errors, loader) {
  const load = loader || (page => page.goto('http://127.0.0.1:8765/'));
  const dir = path.resolve(__dirname, '../qa'); fs.mkdirSync(dir, {recursive:true});
  const setup = () => {
    // These checks exercise music, not the already separate real-shader suite.
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return /webgl/.test(kind) ? null : context.call(this, kind, ...args);
    };
    window.musicTest = {audioCreated:0, videoCreated:0, overlaps:0, launches:[], originalAudio:null};
    const create = document.createElement.bind(document);
    document.createElement = function (name, ...args) {
      const element = create(name === 'source' ? 'span' : name, ...args);
      if (name === 'audio') musicTest.audioCreated++;
      if (name === 'video') {
        musicTest.videoCreated++;
        if (document.querySelector('audio')) musicTest.overlaps++;
        element.play = () => Promise.resolve();
        element.pause = () => {};
        element.load = () => {};
      }
      return element;
    };
  };
  async function create(width) {
    const page = await browser.newPage({viewport:{width,height:width===1280?720:1080}});
    page.on('pageerror', error => errors.push(error.message));
    if (!loader) await page.route('**/user-music.mp3', route => route.fulfill({
      status:200, contentType:'audio/wav', body:require('./music-fixture.cjs')()
    }));
    await page.addInitScript(setup);
    await load(page, [setup]);
    await page.waitForFunction(() => window.C5App);
    return page;
  }
  const state = page => page.evaluate(() => C5App.getState());
  const playing = page => page.waitForFunction(() => C5App.getState().music.phase === 'playing', null, {timeout:15000});
  async function category(page, title) {
    for (let i=0;i<8;i++) {
      const at=await page.evaluate(title=>({current:C5Catalog.findIndex(c=>c.id===C5App.getState().category),target:C5Catalog.findIndex(c=>c.title===title)}),title);
      assert.ok(at.target>=0);if(at.current===at.target)return;
      await page.keyboard.press(at.current<at.target?'ArrowRight':'ArrowLeft');
    }
    assert.fail('Category not reached: '+title);
  }
  async function settings(page, item) {
    await category(page, 'Settings');
    for (let i=0;i<15;i++) {
      const at=await page.evaluate(title=>{const items=C5Catalog.find(c=>c.id==='settings').items;return {current:items.findIndex(x=>x.id===C5App.getState().item),target:items.findIndex(x=>x.title===title)};},item);
      assert.ok(at.target>=0);if(at.current===at.target)break;
      await page.keyboard.press(at.current<at.target?'ArrowDown':'ArrowUp');
    }
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#modalTitle').innerText(),item);
  }
  async function reload(page) {
    if (loader) await load(page, [setup], true);
    else await page.reload();
    await page.waitForFunction(() => window.C5App);
  }
  const musicSwitch = (page, value) => page.getByRole('group', {name:'Background music',exact:true}).getByRole('button', {name:value,exact:true});
  for (const width of [1280,1920]) {
    const page = await create(width);
    try {
      assert.equal((await state(page)).music.phase, 'off');
      assert.equal(await page.locator('audio').count(), 0);
      await settings(page, 'Background music');
      await musicSwitch(page, 'On').click(); await playing(page);
      assert.equal(await page.locator('audio').count(), 1);
      assert.equal(await page.locator('audio').evaluate(a=>a.loop), true);
      await page.waitForFunction(() => document.querySelector('audio').duration > 380);
      if (!loader) assert.match(await page.locator('audio').evaluate(a=>a.currentSrc), /\/user-music\.mp3$/);
      await page.getByRole('button', {name:'50%',exact:true}).click();
      assert.equal(await page.locator('audio').evaluate(a=>a.volume), 0.5);
      assert.equal((await state(page)).preferences.musicVolume, 0.5);
      await page.screenshot({path:path.join(dir, `music-settings-${width}.png`)});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      // Real decoding/looping: seek near the actual end instead of waiting six minutes.
      await page.locator('audio').evaluate(a=>{a.currentTime=a.duration-0.3;});
      await page.waitForFunction(() => {const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime<2;}, null, {timeout:15000});
      assert.equal((await state(page)).music.phase, 'playing');
      await page.evaluate(() => {musicTest.originalAudio=document.querySelector('audio');});
      await page.keyboard.press('Escape');
      await category(page,'Watch');
      assert.equal(await page.evaluate(()=>document.querySelector('audio')===musicTest.originalAudio), true);
      await settings(page, 'Waves'); await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>document.querySelector('audio')===musicTest.originalAudio), true);
      // Release on hide, resume once, and retain the in-session playback position.
      const position=await page.locator('audio').evaluate(a=>{a.currentTime=30;return a.currentTime;});
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
      assert.equal(await page.locator('audio').count(),0);assert.equal((await state(page)).music.phase,'suspended');
      assert.deepEqual(await page.evaluate(()=>[musicTest.originalAudio.paused,musicTest.originalAudio.getAttribute('src')]),[true,null]);
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await playing(page);
      await page.waitForFunction(at=>document.querySelector('audio').currentTime>=at, position);
      // Saved choices survive a reload; an ordinary user gesture may satisfy autoplay.
      await reload(page); await settings(page,'Background music');
      await page.waitForFunction(()=>['playing','blocked'].includes(C5App.getState().music.phase));
      if ((await state(page)).music.phase==='blocked') await page.getByRole('button',{name:'Retry playback',exact:true}).click();
      await playing(page);assert.equal((await state(page)).preferences.musicEnabled,true);
      assert.equal(await page.locator('audio').evaluate(a=>a.volume),0.5);
      await musicSwitch(page,'Off').click();assert.equal(await page.locator('audio').count(),0);
      const created=await page.evaluate(()=>musicTest.audioCreated);
      await page.getByRole('button',{name:'10%',exact:true}).click();
      assert.equal(await page.evaluate(()=>musicTest.audioCreated),created);
      await reload(page);assert.equal((await state(page)).music.phase,'off');
      assert.equal((await state(page)).preferences.musicVolume,0.1);assert.equal(await page.locator('audio').count(),0);
      checks.push(`Music ${width}: synthetic audio decoding/loop, one player, live volume, saved On/Off, stable navigation and hidden release/resume`);
    } finally {await page.close();}
  }
  const page=await create(1920);
  try {
    await settings(page,'Background music');await musicSwitch(page,'On').click();await playing(page);
    await page.keyboard.press('Escape');
    await page.evaluate(()=>{
      C5TV=Object.assign({},C5TV,{isTV:()=>true,
        getInputPreviewStatus:port=>Object.assign(Promise.resolve({port,signal:null}),{cancel(){}}),
        launch:id=>{musicTest.launches.push({id,audio:document.querySelectorAll('audio').length});return new Promise((yes,no)=>{musicTest.resolve=yes;musicTest.reject=no;});}
      });
    });
    await settings(page,'Input previews');await page.getByRole('button',{name:'Live',exact:true}).click();await page.keyboard.press('Escape');
    await category(page,'Inputs');
    await page.waitForFunction(()=>C5App.getState().inputPreview.status==='loading');
    assert.equal((await state(page)).music.phase,'preview');assert.equal(await page.locator('audio').count(),0);
    assert.equal(await page.evaluate(()=>musicTest.overlaps),0);
    await category(page,'Watch');await playing(page);
    await page.keyboard.press('Enter');assert.equal((await state(page)).music.phase,'suspended');
    assert.equal(await page.locator('audio').count(),0);
    await page.waitForFunction(()=>musicTest.launches.length===1);
    assert.equal(await page.evaluate(()=>musicTest.launches[0].audio),0);
    await page.evaluate(()=>musicTest.resolve({ok:true,preview:false}));
    await page.waitForFunction(()=>!C5App.getState().busy);
    assert.equal(await page.locator('audio').count(),0);
    await page.evaluate(()=>document.dispatchEvent(new Event('webOSRelaunch')));await playing(page);
    await page.keyboard.press('Enter');await page.waitForFunction(()=>musicTest.launches.length===2);
    await page.evaluate(()=>musicTest.reject(new Error('Fixture launch failure')));await playing(page);
    checks.push('Music yields to live HDMI and launches before their media allocation; successful launches stay silent until Home returns, failed launches resume');
  } finally {await page.close();}
  const retryPage=await create(1280);
  try {
    await settings(retryPage,'Background music');
    await retryPage.evaluate(()=>{
      const play=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){return this.tagName==='AUDIO'?Promise.reject(new DOMException('Fixture autoplay denial','NotAllowedError')):play.call(this);};
      musicTest.restorePlay=()=>{HTMLMediaElement.prototype.play=play;};
    });
    await musicSwitch(retryPage,'On').click();
    await retryPage.waitForFunction(()=>C5App.getState().music.phase==='blocked');
    assert.equal(await retryPage.locator('audio').count(),0);
    await retryPage.keyboard.press('ArrowDown');
    await retryPage.keyboard.press('ArrowDown');
    assert.equal(await retryPage.evaluate(()=>document.activeElement.id),'retryMusic');
    await retryPage.evaluate(()=>musicTest.restorePlay());
    await retryPage.keyboard.press('Enter');await playing(retryPage);
    await retryPage.evaluate(()=>localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({musicEnabled:'true',musicVolume:2,waveSampling:2})));
    await reload(retryPage);
    assert.equal((await state(retryPage)).music.phase,'off');
    assert.equal((await state(retryPage)).preferences.musicVolume,0.25);
    assert.equal((await state(retryPage)).preferences.waveSampling,2);
    assert.equal(await retryPage.locator('audio').count(),0);
    checks.push('Autoplay denial exposes a remote-reachable retry without a timer loop; invalid music preferences fall back independently of saved wave settings');
  } finally {await retryPage.close();}
  if (!loader) {
    const missing=await create(1280);
    try {
      await missing.unroute('**/user-music.mp3');
      await missing.route('**/user-music.mp3',route=>route.fulfill({status:404,body:'Not found'}));
      await settings(missing,'Background music');
      assert.equal(await missing.locator('#musicFilePath').innerText(),'/var/lib/lg-xmb/music/background.mp3');
      await musicSwitch(missing,'On').click();
      await missing.waitForFunction(()=>C5App.getState().music.phase==='unavailable');
      assert.equal(await missing.locator('audio').count(),0);
      const created=await missing.evaluate(()=>musicTest.audioCreated);await missing.waitForTimeout(300);
      assert.equal(await missing.evaluate(()=>musicTest.audioCreated),created,'No polling for a missing user file');
      await missing.unroute('**/user-music.mp3');
      await missing.route('**/user-music.mp3',route=>route.fulfill({status:200,contentType:'audio/wav',body:require('./music-fixture.cjs')()}));
      await missing.getByRole('button',{name:'Retry playback',exact:true}).click();await playing(missing);
      checks.push('Missing user music is nonfatal, shows its persistent path, makes no automatic retries and can be reloaded after copying a file');
    } finally {await missing.close();}
  }
  assert.deepEqual(errors,[]);
};

if (require.main === module) {
  (async()=>{
    const {chromium}=require('playwright');
    const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
    const checks=[],errors=[];
    try {await module.exports(browser,checks,errors);console.log(JSON.stringify({checks,testedOnTV:false},null,2));}
    finally {await browser.close();}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
