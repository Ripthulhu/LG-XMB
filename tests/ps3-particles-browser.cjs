// Real shader and UI checks; no native TV commands. Optional loader for offline QA.
'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
// Compare a digest, not the data URL: an inequality prints a hash instead of
// half a megabyte of base64, and identity is just as exact.
const digest=s=>createHash('sha256').update(s).digest('hex');
const path=require('node:path');
const fs=require('node:fs');
module.exports=async function checkParticles(browser,checks,errors,loader){
  for(const width of [1280,1920]){
    const height=width*9/16,page=await browser.newPage({viewport:{width,height}});
    page.on('pageerror',error=>errors.push(error.message));
    const load=()=>loader?loader(page,{motion:'reduced'}):page.goto('http://127.0.0.1:8765/');
    try{
      if(!loader)await page.addInitScript(()=>{if(!localStorage.getItem('lg-xmb-preferences-v1'))localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({motion:'reduced'}));});
      await load();await page.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');
      const state=()=>page.evaluate(()=>C5App.getState());
      let d=(await state()).waveDiagnostics;assert.equal(d.surface.particleCount,2000);assert.equal(d.surface.particlesFallback,null);
      const still=async()=>digest(await page.evaluate(()=>document.getElementById('wave').toDataURL()));
      const withParticles=await still();await page.waitForTimeout(120);assert.equal(await still(),withParticles,'Animation Off freezes both layers');
      await page.getByRole('button',{name:'Settings',exact:true}).click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
      const group=name=>page.getByRole('group',{name,exact:true});
      await group('Particles').getByRole('button',{name:'Off',exact:true}).click();
      const without=await still();assert.notEqual(without,withParticles);
      assert.equal((await state()).waveDiagnostics.surface.particleCount,0);
      await group('Particles').getByRole('button',{name:'On',exact:true}).click();assert.equal(await still(),withParticles,'On reproduces the same frozen seeds');
      for(const [label,count] of [['Low',500],['Normal',2000],['High',4000]]){
        await group('Particle density').getByRole('button',{name:label,exact:true}).click();assert.equal((await state()).waveDiagnostics.surface.particleCount,count);
      }
      await group('Particles').getByRole('button',{name:'Off',exact:true}).focus();await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.closest('.choice-group').getAttribute('aria-label')),'Particle density');
      assert.ok(await page.evaluate(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth;}));
      assert.equal((await state()).preferences.waveParticles,false);
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lg-xmb-preferences-v1')).waveParticleCount),4000);
      if(!loader){await page.reload();await page.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');assert.equal((await state()).preferences.waveParticles,false);assert.equal((await state()).preferences.waveParticleCount,4000);}
      // Isolate layer lifetime from the UI using the real C5Wave clock and shader.
      await page.evaluate(()=>{
        window.particleCanvas=document.createElement('canvas');particleCanvas.style.cssText='width:320px;height:180px';document.body.appendChild(particleCanvas);
        window.particleWave=new C5Wave(particleCanvas,{adaptive:false});particleWave.setQuality({particles:true,particleCount:2000});particleWave.setReducedMotion(true);
      });
      await page.waitForFunction(()=>particleWave.mode==='webgl');
      const particleStill=async()=>digest(await page.evaluate(()=>particleCanvas.toDataURL()));
      const frozen=await particleStill();
      await page.evaluate(()=>{particleWave.setPaused(true);particleWave.setQuality({particleCount:500});});
      assert.equal(await page.evaluate(()=>particleWave.getDiagnostics().surface.particleCount),2000);
      assert.equal(await particleStill(),frozen);
      await page.evaluate(()=>particleWave.setPaused(false));assert.equal(await page.evaluate(()=>particleWave.getDiagnostics().surface.particleCount),500);
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));particleWave.setQuality({particleCount:2000});});
      assert.equal(await page.evaluate(()=>particleWave.getDiagnostics().surface.particleCount),500);
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
      assert.equal(await particleStill(),frozen,'Hidden settings do not move the shared particle clock');
      const extension=await page.evaluate(()=>!!particleWave.gl.getExtension('WEBGL_lose_context'));
      if(extension){
        await page.evaluate(()=>{window.particleLose=particleWave.gl.getExtension('WEBGL_lose_context');particleLose.loseContext();});
        await page.waitForFunction(()=>particleWave.contextLost);await page.evaluate(()=>particleLose.restoreContext());
        await page.waitForFunction(()=>!particleWave.contextLost&&particleWave.mode==='webgl');
        assert.equal(await particleStill(),frozen,'Context recreation restores deterministic particle seeds');
      }
      await page.evaluate(()=>particleWave.setReducedMotion(false));await page.waitForFunction(()=>particleWave.time>14.05);await page.evaluate(()=>particleWave.setReducedMotion(true));
      assert.notEqual(await particleStill(),frozen,'Particles and spline advance in motion');
      await page.evaluate(()=>{particleWave.destroy();particleCanvas.remove();});
      // Optional layer refused: count is zero, spline still renders, one attempt.
      await page.evaluate(()=>{
        window.savedParticleCreate=LGXMBPS3Particles;window.particleAttempts=0;
        window.LGXMBPS3Particles={create:()=>{particleAttempts++;throw new Error('test refusal');}};
        window.refusedCanvas=document.createElement('canvas');refusedCanvas.style.cssText='width:320px;height:180px';document.body.appendChild(refusedCanvas);
        window.refusedWave=new C5Wave(refusedCanvas,{adaptive:false});refusedWave.setQuality({particles:true});refusedWave.setReducedMotion(true);
      });
      await page.waitForFunction(()=>refusedWave.mode==='webgl');
      assert.equal(await page.evaluate(()=>refusedWave.getDiagnostics().surface.particleCount),0);
      assert.match(await page.evaluate(()=>refusedWave.getDiagnostics().surface.particlesFallback),/test refusal/);
      await page.evaluate(()=>{refusedWave.setStyle({brightness:1.5});refusedWave.setQuality({particleCount:500});});
      assert.equal(await page.evaluate(()=>particleAttempts),1);await page.evaluate(()=>{refusedWave.destroy();refusedCanvas.remove();window.LGXMBPS3Particles=savedParticleCreate;});
      // Keep a real settings capture and unobstructed background for review.
      if((await state()).modal!=='motion'){await page.getByRole('button',{name:'Settings',exact:true}).click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');}
      await group('Particles').getByRole('button',{name:'On',exact:true}).click();await group('Particle density').getByRole('button',{name:'Normal',exact:true}).click();
      fs.mkdirSync(path.resolve(__dirname,'../qa'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../qa/particles-settings-'+width+'.png')});
      await page.keyboard.press('Escape');await page.screenshot({path:path.resolve(__dirname,'../qa/particles-'+width+'.png')});
      checks.push('Particles '+width+': actual sprites, saved On/Off/density, remote scrolling, frozen/hidden/paused/context restoration and optional failure');
    }finally{await page.close();}
  }
  assert.deepEqual(errors,[]);
};
