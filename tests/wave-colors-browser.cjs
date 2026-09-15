// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function(browser,checks,errors,loader){
  const load=loader||((p)=>p.goto('http://127.0.0.1:8765/'));
  const capture=()=>{
    let C;Object.defineProperty(window,'C5Wave',{configurable:true,get:()=>C,set:Original=>{C=function(...args){const w=new Original(...args);window.colorTestWave=w;return w;};C.prototype=Original.prototype;}});
  };
  const output=path.resolve(__dirname,'../qa');fs.mkdirSync(output,{recursive:true});
  for(const [width,height] of [[1280,720],[1920,1080]]){
    const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',e=>errors.push(e.message));
    try{
      await page.addInitScript(capture);await load(page,[capture]);
      await page.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');
      await page.evaluate(()=>colorTestWave.setReducedMotion(true));
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      await page.getByRole('option',{name:'Waves',exact:true}).click();
      await page.getByRole('button',{name:'Wave colours',exact:true}).click();
      assert.equal(await page.locator('#modalTitle').textContent(),'Wave colours');
      await page.getByRole('button',{name:'Monthly presets',exact:true}).click();
      for(let month=1;month<=12;month++)for(const period of ['day','night']){
        await page.getByRole('button',{name:['January','February','March','April','May','June','July','August','September','October','November','December'][month-1],exact:true}).click();
        await page.getByRole('button',{name:period==='day'?'Day':'Night',exact:true}).click();
        const result=await page.evaluate(()=>{
          const w=colorTestWave,s=C5App.getState().preferences.waveColors,p=w.palette,gl=w.gl,px=new Uint8Array(4);
          gl.readPixels(2,2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
          return {state:s,error:gl.getError(),actual:[...px],expected:LGXMBWaveColors.sample(p,2.5/gl.drawingBufferWidth,1-2.5/gl.drawingBufferHeight).map(v=>Math.round(v*255))};
        });
        assert.equal(result.state.month,month);assert.equal(result.state.period,period);assert.equal(result.error,0);
        assert.ok(result.actual.slice(0,3).every((v,i)=>Math.abs(v-result.expected[i])<=3),JSON.stringify(result));
      }
      await page.getByRole('button',{name:'November',exact:true}).click();await page.getByRole('button',{name:'Day',exact:true}).click();
      await page.screenshot({path:path.join(output,`monthly-colours-${width}.png`)});
      await page.getByRole('button',{name:'Original (RGB Sliders)',exact:true}).click();
      const red=page.getByRole('slider',{name:'Red',exact:true});await red.focus();await page.keyboard.press('ArrowRight');
      assert.equal(await red.inputValue(),'38');
      await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Green');
      await page.keyboard.press('ArrowLeft');assert.equal(await page.getByRole('slider',{name:'Green',exact:true}).inputValue(),'88');
      assert.equal(await page.getByRole('button',{name:'January',exact:true}).isVisible(),false);
      const persisted=await page.evaluate(()=>JSON.parse(localStorage.getItem('lg-xmb-preferences-v1')).waveColors);
      assert.equal(persisted.red,38);assert.equal(persisted.green,88);
      if(!loader){
        await page.reload();await page.waitForFunction(()=>window.C5App&&C5App.getState().waveMode==='webgl');
        assert.deepEqual(await page.evaluate(()=>C5App.getState().preferences.waveColors),persisted);
        await page.evaluate(()=>colorTestWave.setReducedMotion(true));
        await page.getByRole('button',{name:'Settings',exact:true}).click();
        await page.getByRole('option',{name:'Waves',exact:true}).click();
        await page.getByRole('button',{name:'Wave colours',exact:true}).click();
      }
      await page.screenshot({path:path.join(output,`rgb-colours-${width}.png`)});
      await page.getByRole('button',{name:'Monthly presets',exact:true}).click();
      await page.getByRole('button',{name:'Original (RGB Sliders)',exact:true}).click();assert.equal(await red.inputValue(),'38');
      await page.getByRole('button',{name:'Current theme',exact:true}).click();assert.equal(await page.evaluate(()=>colorTestWave.palette),null);
      await page.keyboard.press('Escape');assert.equal(await page.locator('#modalTitle').textContent(),'Waves');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'openWaveColors');
      await page.keyboard.press('Escape');assert.equal(await page.locator('#modalBackdrop').isVisible(),false);
      // Keep the exact palette across suspended state, without advancing the wave.
      await page.evaluate(()=>{
        colorTestWave.setPaused(true);window.colorTime=colorTestWave.time;
        colorTestWave.setTheme({colors:{mode:'monthly',month:11,period:'night'}});
      });
      assert.equal(await page.evaluate(()=>colorTestWave.time),await page.evaluate(()=>colorTime));
      await page.evaluate(()=>colorTestWave.setPaused(false));
      assert.equal(await page.evaluate(()=>colorTestWave.gl.getError()),0);
      await page.locator('#wave').screenshot({path:path.join(output,`depth-particles-${width}.png`)});
      if(await page.evaluate(()=>!!colorTestWave.gl.getExtension('WEBGL_lose_context'))){
        const before=await page.evaluate(()=>({palette:colorTestWave.palette,frame:document.getElementById('wave').toDataURL()}));
        await page.evaluate(()=>{window.colorLose=colorTestWave.gl.getExtension('WEBGL_lose_context');colorLose.loseContext();});
        await page.waitForFunction(()=>colorTestWave.contextLost);
        await page.evaluate(()=>colorLose.restoreContext());
        await page.waitForFunction(()=>!colorTestWave.contextLost&&colorTestWave.mode==='webgl');
        assert.deepEqual(await page.evaluate(()=>colorTestWave.palette),before.palette);
        assert.equal(await page.evaluate(()=>document.getElementById('wave').toDataURL()),before.frame);
      }
      checks.push(`Colours ${width}: all 24 presets, GPU pixel samples, original RGB controls, saved values, D-pad focus, Back and suspended redraw`);
    }finally{await page.close();}
  }
  assert.deepEqual(errors,[]);
};
