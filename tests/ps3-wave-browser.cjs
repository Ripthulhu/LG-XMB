'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

// A loader argument lets an offline fixture supply the same local sources.
// CI uses normal navigation, including the packaged page's CSP and script order.
module.exports = async function checkPS3Wave(browser, checks, errors, loader) {
  const load = loader || (page => page.goto('http://127.0.0.1:8765/'));
  // Compare renderer pixels independently of clock/text overlays and keep diffs bounded.
  const waveImage = async page => createHash('sha256').update(await page.evaluate(()=>document.getElementById('wave').toDataURL())).digest('hex');
  async function create(width=1280,height=720,init) {
    const page=await browser.newPage({viewport:{width,height}});
    page.on('pageerror',error=>errors.push(error.message));
    const capture=() => {
      let constructor;
      Object.defineProperty(window,'C5Wave',{configurable:true,get:()=>constructor,set:original=>{
        constructor=function(canvas,options){const wave=new original(canvas,options);window.ps3TestWave=wave;return wave;};
        constructor.prototype=original.prototype;
      }});
    };
    await page.addInitScript(capture);
    if(init)await page.addInitScript(init);
    // The offline loader executes init scripts explicitly rather than navigating.
    await load(page,[capture,init].filter(Boolean));
    await page.waitForFunction(()=>window.C5App&&!['pending','compiling'].includes(C5App.getState().waveMode));
    return page;
  }
  const dir=path.resolve(__dirname,'../qa');fs.mkdirSync(dir,{recursive:true});
  for (const [width,height] of [[1280,720],[1920,1080]]) {
    const page=await create(width,height);
    try {
      let diag=await page.evaluate(()=>ps3TestWave.getDiagnostics());
      assert.equal(diag.pattern,'ps3');assert.equal(diag.mode,'webgl');assert.equal(diag.error,null);
      assert.equal(diag.targetFps,30);assert.equal(diag.surface.floatTextures,false);
      assert.equal(diag.quality,'1080p');assert.equal(diag.adaptive,false);
      assert.deepEqual([diag.backingWidth,diag.backingHeight],[width,height]);
      assert.equal(diag.surface.surfaceWidth,width*1.5);assert.equal(diag.surface.virtualHeight,height*1.5);assert.ok(diag.surface.surfaceHeight<height*1.5);
      assert.deepEqual(await page.evaluate(()=>[ps3TestWave.gl.drawingBufferWidth,ps3TestWave.gl.drawingBufferHeight]),[width,height]);
      // Feed sustained scheduling gaps without waiting for a slow machine: these
      // must not silently turn the full-HD request back into a 720p/540p buffer.
      await page.evaluate(()=>{
        ps3TestWave._resetTiming();
        for(let now=1000;now<=31000;now+=50)ps3TestWave._sampleTiming(now);
        ps3TestWave._resetTiming();
      });
      diag=await page.evaluate(()=>ps3TestWave.getDiagnostics());
      assert.equal(diag.quality,'1080p');assert.deepEqual(diag.qualityChanges,[]);
      assert.deepEqual([diag.backingWidth,diag.backingHeight],[width,height]);
      assert.equal(diag.surface.surfaceWidth,width*1.5);assert.equal(diag.surface.virtualHeight,height*1.5);assert.ok(diag.surface.surfaceHeight<height*1.5);
      assert.equal(await page.evaluate(()=>ps3TestWave.gl.getError()),0);
      await page.evaluate(()=>{ps3TestWave.setReducedMotion(true);ps3TestWave.time=14;ps3TestWave._draw();});
      const still=await waveImage(page);
      await page.waitForTimeout(200);
      assert.equal(await waveImage(page),still);
      await page.evaluate(()=>ps3TestWave._draw());
      assert.equal(await waveImage(page),still,'A repaint must not advance smoothing');
      await page.evaluate(()=>ps3TestWave.setStyle({brightness:0.6,speed:0.5}));
      assert.notEqual(await waveImage(page),still);
      await page.evaluate(()=>ps3TestWave.setStyle({brightness:1,speed:1.5}));
      assert.equal(await waveImage(page),still,'Brightness changes preserve shape/time');
      await page.screenshot({path:path.join(dir,`ps3-waves-${width}.png`)});
      const before=await page.evaluate(()=>ps3TestWave.time);
      await page.evaluate(()=>ps3TestWave.setReducedMotion(false));
      // Observe resumed animation instead of assuming CI can draw within 300 ms.
      await page.waitForFunction(previous=>ps3TestWave.time>previous,before,{timeout:10000});
      assert.ok(await page.evaluate(()=>ps3TestWave.time)>before);
      await page.evaluate(()=>ps3TestWave.setPaused(true));
      const paused=await waveImage(page),at=await page.evaluate(()=>ps3TestWave.time);
      await page.waitForTimeout(150);assert.equal(await waveImage(page),paused);
      assert.equal(await page.evaluate(()=>ps3TestWave.time),at);
      await page.evaluate(()=>{ps3TestWave.setReducedMotion(true);ps3TestWave.setPaused(false);});
      assert.equal(await waveImage(page),paused);
      await page.evaluate(()=>{
        window.testHidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>testHidden});
        testHidden=true;document.dispatchEvent(new Event('visibilitychange'));
      });
      const hiddenAt=await page.evaluate(()=>ps3TestWave.time);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>ps3TestWave.time),hiddenAt);
      assert.equal(await page.evaluate(()=>ps3TestWave.raf),0);
      await page.evaluate(()=>{testHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
      assert.equal(await page.evaluate(()=>ps3TestWave.time),hiddenAt);
      assert.equal(await page.evaluate(()=>ps3TestWave.gl.getError()),0);
      checks.push(`PS3 surface at ${width}x${height}: full-resolution shaders without adaptive drops, still/brightness retention, pause and hidden suspension`);
    } finally {await page.close();}
  }
  const page=await create(1920,1080);
  try {
    await page.evaluate(()=>{ps3TestWave.setReducedMotion(true);window.loss=ps3TestWave.gl.getExtension('WEBGL_lose_context');});
    assert.equal(await page.evaluate(()=>!!loss),true);
    await page.evaluate(()=>loss.loseContext());await page.waitForFunction(()=>ps3TestWave.contextLost);
    assert.equal(await page.evaluate(()=>ps3TestWave.raf),0);
    await page.evaluate(()=>loss.restoreContext());
    await page.waitForFunction(()=>!ps3TestWave.contextLost&&ps3TestWave.mode==='webgl');
    assert.equal(await page.evaluate(()=>ps3TestWave.getDiagnostics().pattern),'ps3');
    assert.deepEqual(await page.evaluate(()=>{const d=ps3TestWave.getDiagnostics();return [d.backingWidth,d.backingHeight,d.surface.surfaceWidth,d.surface.virtualHeight];}),[1920,1080,2880,1620]);
    assert.equal(await page.evaluate(()=>ps3TestWave.gl.getError()),0);
    await page.evaluate(()=>ps3TestWave.destroy());
    assert.equal(await page.evaluate(()=>ps3TestWave.raf||ps3TestWave.compileRaf||ps3TestWave.initRaf),0);
    assert.equal(await page.evaluate(()=>ps3TestWave.ps3Surface),null);
    checks.push('PS3 WebGL context loss rebuilds resources; destroy cancels work and releases the mesh');
  } finally {await page.close();}
  const refused=await create(1280,720,()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      const gl=original.call(this,type,...args);
      if(gl&&/webgl/.test(type))gl.createFramebuffer=()=>null;
      return gl;
    };
  });
  try {
    const diag=await refused.evaluate(()=>ps3TestWave.getDiagnostics());
    assert.equal(diag.mode,'webgl');assert.equal(diag.pattern,'classic');assert.equal(diag.error,null);
    assert.match(diag.patternFallback,/Spline framebuffer unavailable/);
    assert.equal(await refused.locator('#items').isVisible(),true);
    checks.push('A refused spline allocation falls back to original WebGL waves without breaking Home');
  } finally {await refused.close();}
  const noGL=await create(1280,720,()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:original.call(this,type,...args);};
  });
  try {
    assert.equal(await noGL.evaluate(()=>ps3TestWave.getDiagnostics().mode),'canvas2d');
    assert.equal(await noGL.locator('#items').isVisible(),true);
    checks.push('WebGL refusal retains the Canvas2D fallback and usable menu');
  } finally {await noGL.close();}
  assert.deepEqual(errors,[]);
};
