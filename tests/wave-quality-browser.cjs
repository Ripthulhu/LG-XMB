// Renderer quality and remote-control regression checks; no TV writes.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {createHash} = require('node:crypto');
module.exports = async function checkWaveQuality(browser, checks, errors) {
  const page = await browser.newPage({viewport:{width:1920,height:1080}});
  page.on('pageerror',error=>errors.push(error.message));
  const state = () => page.evaluate(()=>C5App.getState());
  // Read canvas pixels, not a screenshot containing the changing dialog focus.
  const waveImage = async () => createHash('sha256').update(await page.evaluate(()=>document.getElementById('wave').toDataURL())).digest('hex');
  const group = name => page.getByRole('group',{name,exact:true});
  async function open() {
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    assert.equal((await state()).modal,'motion');
  }
  try {
    // Old preferences gain only the new defaults; do not reset unrelated choices.
    await page.addInitScript(()=>{
      if(!localStorage.getItem('lg-xmb-preferences-v1'))localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({
        theme:'rose',motion:'reduced',sound:false,previewMode:'live',waveSpeed:'slow',waveBrightness:'low',backBehavior:'lg'
      }));
    });
    await page.goto('http://127.0.0.1:8765/');
    await page.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');
    let before=await state();
    assert.equal(before.preferences.waveSampling,1.5);assert.equal(before.preferences.waveDetail,'high');assert.equal(before.preferences.waveSoftness,0.75);
    assert.equal(before.preferences.theme,'rose');assert.equal(before.preferences.previewMode,'live');assert.equal(before.preferences.backBehavior,'lg');
    await open();
    assert.equal(await page.locator('.choice-group').count(),6);
    assert.equal(await group('Antialiasing').getByRole('button',{name:'1.5×',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await group('Mesh detail').getByRole('button',{name:'High',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await group('Edge softness').getByRole('button',{name:'Subtle',exact:true}).getAttribute('aria-pressed'),'true');
    for(const [label,sampling] of [['Off',1],['1.25×',1.25],['1.5×',1.5],['2×',2]]) {
      await group('Antialiasing').getByRole('button',{name:label,exact:true}).click();
      const d=(await state()).waveDiagnostics;
      assert.deepEqual([d.backingWidth,d.backingHeight],[1920,1080]);
      assert.deepEqual([d.surface.surfaceWidth,d.surface.surfaceHeight],[1920*sampling,1080*sampling]);
      assert.equal(d.surface.effectiveScale,sampling);assert.equal(d.reducedMotion,true);assert.equal(d.adaptive,false);
      assert.equal(await group('Antialiasing').getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'true');
      assert.equal(await group('Antialiasing').locator('[aria-pressed="true"]').count(),1);
    }
    await group('Antialiasing').getByRole('button',{name:'1.5×',exact:true}).click();
    for(const [label,vertices] of [['Standard',129*49],['High',257*97],['Fine',385*129]]) {
      await group('Mesh detail').getByRole('button',{name:label,exact:true}).click();
      assert.equal((await state()).waveDiagnostics.surface.vertices,vertices);
    }
    await group('Mesh detail').getByRole('button',{name:'High',exact:true}).click();
    const still=await waveImage();
    await group('Edge softness').getByRole('button',{name:'Sharp',exact:true}).click();
    assert.notEqual(await waveImage(),still);
    await group('Edge softness').getByRole('button',{name:'Subtle',exact:true}).click();
    assert.equal(await waveImage(),still,'Softness changes do not advance a frozen spline');
    await page.screenshot({path:path.resolve(__dirname,'../qa/ps3-waves-quality-1080.png')});
    // D-pad navigation selects new rows and keeps numeric-valued choices accessible.
    await group('Antialiasing').getByRole('button',{name:'1.5×',exact:true}).focus();
    await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    assert.equal((await state()).preferences.waveSampling,2);
    await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    assert.equal((await state()).preferences.waveDetail,'fine');
    await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
    assert.equal((await state()).preferences.waveSoftness,1.5);
    await page.setViewportSize({width:1280,height:720});
    await group('Edge softness').getByRole('button',{name:'Soft',exact:true}).focus();
    assert.equal(await page.evaluate(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth;}),true);
    await page.screenshot({path:path.resolve(__dirname,'../qa/ps3-waves-quality-720.png')});
    await page.reload();await page.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');
    let restored=await state();
    assert.equal(restored.preferences.waveSampling,2);assert.equal(restored.preferences.waveDetail,'fine');assert.equal(restored.preferences.waveSoftness,1.5);
    assert.equal(restored.preferences.theme,'rose');assert.equal(restored.preferences.motion,'reduced');assert.equal(restored.preferences.previewMode,'live');
    await page.evaluate(()=>localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({waveSampling:100,waveDetail:'__proto__',waveSoftness:'1.5',motion:'reduced'})));
    await page.reload();await page.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');
    restored=await state();assert.equal(restored.preferences.waveSampling,1.5);assert.equal(restored.preferences.waveDetail,'high');assert.equal(restored.preferences.waveSoftness,0.75);
    checks.push('Quality presets change actual surface/mesh, retain 1080p output and frozen frames, survive reload, reject invalid values and fit remote navigation at 720p/1080p');
  } finally {await page.close();}
  // Test a real texture failure without lying about what setting was applied.
  const limited=await browser.newPage({viewport:{width:1920,height:1080}});
  limited.on('pageerror',error=>errors.push(error.message));
  await limited.addInitScript(()=>{
    localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({motion:'reduced'}));
    const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      const gl=getContext.call(this,type,...args);if(!gl||!/webgl/.test(type))return gl;
      const image=gl.texImage2D.bind(gl),getError=gl.getError.bind(gl);let failed=false;
      gl.texImage2D=function(...a){if(a[3]>2400){failed=true;return;}return image(...a);};
      gl.getError=function(){if(failed){failed=false;return gl.OUT_OF_MEMORY;}return getError();};return gl;
    };
  });
  try {
    await limited.goto('http://127.0.0.1:8765/');
    await limited.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');
    const d=await limited.evaluate(()=>C5App.getState().waveDiagnostics);
    assert.equal(d.pattern,'ps3');assert.equal(d.surface.requestedScale,1.5);assert.equal(d.surface.effectiveScale,1.25);
    await limited.getByRole('button',{name:'Settings',exact:true}).click();await limited.keyboard.press('ArrowDown');await limited.keyboard.press('Enter');
    assert.match(await limited.locator('#waveRenderStatus').innerText(),/2400 × 1350.*1.25× applied/);
    checks.push('Refused supersampling falls back to 1.25× and the Waves menu reports the applied dimensions without rewriting the preference');
  } finally {await limited.close();}
  assert.deepEqual(errors,[]);
};
