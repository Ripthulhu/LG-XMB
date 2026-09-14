'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A loader argument lets an offline fixture supply the same local sources.
// CI uses normal navigation, including the packaged page's CSP and script order.
module.exports = async function checkPS3Wave(browser, checks, errors, loader) {
  const load = loader || (page => page.goto('http://127.0.0.1:8765/'));
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
      assert.deepEqual([diag.surface.surfaceWidth,diag.surface.surfaceHeight],[width,height]);
      assert.deepEqual(await page.evaluate(()=>[ps3TestWave.gl.drawingBufferWidth,ps3TestWave.gl.drawingBufferHeight]),[width,height]);
      assert.equal(await page.evaluate(()=>ps3TestWave.gl.getError()),0);
      await page.evaluate(()=>{ps3TestWave.setReducedMotion(true);ps3TestWave.time=14;ps3TestWave._draw();});
      const still=await page.locator('#wave').screenshot();
      await page.waitForTimeout(200);
      assert.deepEqual(await page.locator('#wave').screenshot(),still);
      await page.evaluate(()=>ps3TestWave._draw());
      assert.deepEqual(await page.locator('#wave').screenshot(),still,'A repaint must not advance smoothing');
      await page.evaluate(()=>ps3TestWave.setStyle({brightness:0.6,speed:0.5}));
      assert.notDeepEqual(await page.locator('#wave').screenshot(),still);
      await page.evaluate(()=>ps3TestWave.setStyle({brightness:1,speed:1.5}));
      assert.deepEqual(await page.locator('#wave').screenshot(),still,'Brightness changes preserve shape/time');
      await page.screenshot({path:path.join(dir,`ps3-waves-${width}.png`)});
      const before=await page.evaluate(()=>ps3TestWave.time);
      await page.evaluate(()=>ps3TestWave.setReducedMotion(false));await page.waitForTimeout(300);
      assert.ok(await page.evaluate(()=>ps3TestWave.time)>before);
      await page.evaluate(()=>ps3TestWave.setPaused(true));
      const paused=await page.locator('#wave').screenshot(),at=await page.evaluate(()=>ps3TestWave.time);
      await page.waitForTimeout(150);assert.deepEqual(await page.locator('#wave').screenshot(),paused);
      assert.equal(await page.evaluate(()=>ps3TestWave.time),at);
      await page.evaluate(()=>{ps3TestWave.setReducedMotion(true);ps3TestWave.setPaused(false);});
      assert.deepEqual(await page.locator('#wave').screenshot(),paused);
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
      checks.push(`PS3 surface at ${width}x${height}: real shaders, still/brightness retention, bounded surface, pause and hidden suspension`);
    } finally {await page.close();}
  }
  const tv=await create(1920,1080,()=>{
    Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/87.0.4280.88'});
    window.PalmSystem={identifier:'org.local.openxmb.c5'};
    window.PalmServiceBridge=function(){
      this.cancel=function(){};
      this.call=function(){const reply=this.onservicecallback;setTimeout(()=>reply(JSON.stringify({returnValue:false,errorText:'Test: no TV services'})),0);};
    };
  });
  try {
    assert.equal(await tv.evaluate(()=>C5TV.isTV()),true);
    await tv.evaluate(()=>{
      ps3TestWave.setReducedMotion(true);
      // Two completed slow scheduling windows used to reduce image quality.
      ps3TestWave._resetTiming();
      for(let now=100;now<=16000;now+=50)ps3TestWave._sampleTiming(now);
    });
    const diag=await tv.evaluate(()=>ps3TestWave.getDiagnostics());
    assert.equal(diag.pattern,'ps3');assert.equal(diag.adaptive,false);
    assert.deepEqual(diag.qualityChanges,[]);assert.ok(diag.scheduling.completedWindows>=2);
    assert.deepEqual([diag.backingWidth,diag.backingHeight,diag.surface.surfaceWidth,diag.surface.surfaceHeight],[1920,1080,1920,1080]);
    assert.deepEqual(await tv.evaluate(()=>[ps3TestWave.gl.drawingBufferWidth,ps3TestWave.gl.drawingBufferHeight]),[1920,1080]);
    assert.equal(await tv.evaluate(()=>ps3TestWave.gl.getError()),0);
    checks.push('TV-detected app keeps a true 1920x1080 canvas and surface despite slow scheduling windows');
  } finally {await tv.close();}
  const page=await create();
  try {
    await page.evaluate(()=>{ps3TestWave.setReducedMotion(true);window.loss=ps3TestWave.gl.getExtension('WEBGL_lose_context');});
    assert.equal(await page.evaluate(()=>!!loss),true);
    await page.evaluate(()=>loss.loseContext());await page.waitForFunction(()=>ps3TestWave.contextLost);
    assert.equal(await page.evaluate(()=>ps3TestWave.raf),0);
    await page.evaluate(()=>loss.restoreContext());
    await page.waitForFunction(()=>!ps3TestWave.contextLost&&ps3TestWave.mode==='webgl');
    assert.equal(await page.evaluate(()=>ps3TestWave.getDiagnostics().pattern),'ps3');
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
    assert.match(diag.patternFallback,/allocate spline surface/);
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
