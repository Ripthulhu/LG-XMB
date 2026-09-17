// Local rendering and preference checks. No native TV operations.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function checkSettingsAppearance(browser, checks, errors) {
  const page = await browser.newPage({viewport:{width:1920,height:1080}});
  page.on('pageerror', error => errors.push(error.message));
  async function open(id) {
    if (await page.evaluate(() => C5App.getState().modal)) await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    const delta = await page.evaluate(target => {
      const ids = C5Catalog.find(category => category.id === 'settings').items.map(item => item.id);
      return ids.indexOf(target) - ids.indexOf(C5App.getState().item);
    },id);
    for (let i=0;i<Math.abs(delta);i++) await page.keyboard.press(delta>0?'ArrowDown':'ArrowUp');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!C5App.getState().modal);
  }
  try {
    await page.goto('http://127.0.0.1:8765');
    await page.waitForFunction(() => window.C5App && C5App.getState().waveMode === 'webgl');
    const defaultWave = await page.evaluate(() => C5App.getState().waveDiagnostics);
    assert.equal(defaultWave.speed,1.5); assert.equal(defaultWave.brightness,1);
    await page.evaluate(() => {
      // Adaptive quality may change between UI actions on a software renderer.
      // Check each settings call synchronously, without disabling adaptation.
      window.styleTransitions = [];
      const setStyle = C5Wave.prototype.setStyle;
      function geometry(wave) {
        const state = wave.getDiagnostics();
        return {quality:state.quality,targetFps:state.targetFps,adaptive:state.adaptive,
          width:wave.canvas.width,height:wave.canvas.height};
      }
      C5Wave.prototype.setStyle = function(style) {
        const before = geometry(this);
        const result = setStyle.call(this,style);
        window.styleTransitions.push({before,after:geometry(this)});
        return result;
      };
    });
    await open('appearance');
    assert.equal(await page.locator('.theme-options .option').count(),9);
    await page.getByRole('button',{name:'Forest',exact:true}).click();
    assert.equal(await page.evaluate(() => C5App.getState().preferences.theme),'forest');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()),'Forest✓');
    assert.equal(await page.locator('#toast').innerText(),'');
    const forest = await page.evaluate(() => ({
      background:getComputedStyle(document.documentElement).getPropertyValue('--background-rgb'),
      tint:getComputedStyle(document.getElementById('modalBackdrop')).backgroundImage,
      border:getComputedStyle(document.getElementById('modal')).borderLeftColor,
      accent:getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb'),
      text:getComputedStyle(document.querySelector('.option')).color,
      icon:getComputedStyle(document.querySelector('.category-icon')).color,
      detail:getComputedStyle(document.getElementById('detailDescription')).color
    }));
    assert.equal(forest.background,'4,15,11'); assert.match(forest.tint,/4, 15, 11/); assert.match(forest.border,/255, 255, 255/);
    assert.equal(forest.accent,'255,255,255'); assert.match(forest.text,/255, 255, 255/);
    assert.match(forest.icon,/255, 255, 255/); assert.match(forest.detail,/255, 255, 255/);
    await page.screenshot({path:path.join(__dirname,'../qa/settings-forest-1080.png')});
    await page.getByRole('button',{name:'Rose',exact:true}).click();
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background-rgb')),'19,8,13');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb')),'255,255,255');
    assert.match(await page.locator('#modal').evaluate(el => getComputedStyle(el).borderLeftColor),/255, 255, 255/);
    checks.push('Nine themes colour only the background and waves; text, icons and dividers remain white, selected focus is preserved and no theme toast appears');

    await open('motion');
    assert.equal(await page.locator('#modalTitle').innerText(),'Waves');
    await page.getByRole('group',{name:'Animation',exact:true}).getByRole('button',{name:'On',exact:true}).focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.closest('[role="group"]').getAttribute('aria-label')),'Speed');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => C5App.getState().preferences.waveSpeed),'fast');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()),'Fast✓');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => C5App.getState().preferences.waveBrightness),'high');
    await page.getByRole('group',{name:'Animation',exact:true}).getByRole('button',{name:'Off',exact:true}).click();
    const custom = await page.evaluate(() => C5App.getState().waveDiagnostics);
    assert.equal(custom.speed,2.25); assert.equal(custom.brightness,1.5); assert.equal(custom.reducedMotion,true);
    assert.equal(custom.targetFps,defaultWave.targetFps);
    assert.equal(custom.adaptive,defaultWave.adaptive);
    const transitions = await page.evaluate(() => window.styleTransitions);
    assert.ok(transitions.length >= 2, 'UI settings must exercise the renderer');
    for (const transition of transitions) {
      assert.deepEqual(transition.after,transition.before,'A style change must preserve quality, backing size and frame cap');
    }
    await page.screenshot({path:path.join(__dirname,'../qa/settings-waves-rose-1080.png')});
    await page.reload(); await page.waitForFunction(() => window.C5App && C5App.getState().waveMode === 'webgl');
    const restored = await page.evaluate(() => C5App.getState());
    assert.equal(restored.preferences.theme,'rose'); assert.equal(restored.preferences.waveSpeed,'fast');
    assert.equal(restored.preferences.waveBrightness,'high'); assert.equal(restored.waveDiagnostics.reducedMotion,true);
    checks.push('Wave animation, speed and brightness use remote-friendly grouped controls, persist validated values and preserve the renderer quality/frame cap');

    for (const id of ['sound','previews','about']) {
      await open(id);
      const layout = await page.evaluate(() => {
        const modal=document.getElementById('modal'),style=getComputedStyle(modal),rect=modal.getBoundingClientRect();
        return {background:style.backgroundColor,shadow:style.boxShadow,radius:style.borderRadius,tint:getComputedStyle(document.getElementById('modalBackdrop')).backgroundImage,
          inView:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight};
      });
      assert.equal(layout.background,'rgba(0, 0, 0, 0)'); assert.equal(layout.shadow,'none'); assert.equal(layout.radius,'0px');
      assert.match(layout.tint,/19, 8, 13/); assert.equal(layout.inView,true);
      if(id==='background') {
        await page.locator('[data-process-id="voice"]').focus();
        const fit=await page.evaluate(() => {
          const row=document.querySelector('[data-process-id="voice"]'),content=document.getElementById('modalContent').getBoundingClientRect(),copy=row.querySelector('.background-option-copy').getBoundingClientRect(),control=row.querySelector('.background-option-control').getBoundingClientRect();
          return copy.right<=control.left&&control.right<=content.right;
        });
        assert.equal(fit,true,'Long privacy descriptions fit alongside their switches');
        await page.screenshot({path:path.join(__dirname,'../qa/settings-privacy-rose-1080.png')});
      }
    }
    await page.setViewportSize({width:1280,height:720}); await open('motion');
    await page.getByRole('group',{name:'Brightness',exact:true}).getByRole('button',{name:'High',exact:true}).focus();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    const focused = await page.evaluate(() => {const r=document.activeElement.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});
    assert.equal(focused,true);
    await page.screenshot({path:path.join(__dirname,'../qa/settings-waves-rose-720.png')});
    checks.push('All submenus retain white text and dividers over themed backgrounds; long privacy text and 720p controls stay within the unboxed layout');

    await page.evaluate(() => localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify({theme:'__proto__',waveSpeed:'Infinity',waveBrightness:99,motion:'invalid'})));
    await page.reload(); await page.waitForFunction(() => window.C5App);
    const invalid = await page.evaluate(() => C5App.getState().preferences);
    assert.equal(invalid.theme,'midnight'); assert.equal(invalid.waveSpeed,'normal'); assert.equal(invalid.waveBrightness,'normal');
    checks.push('Invalid stored theme and wave values fall back to the existing default appearance');

    await open('motion');
    await page.getByRole('button',{name:'Show waves full screen',exact:true}).click();
    let only = await page.evaluate(() => ({state:C5App.getState(),screen:getComputedStyle(document.getElementById('screen')).visibility,
      wave:getComputedStyle(document.getElementById('wave')).visibility,toast:document.getElementById('toast').textContent}));
    assert.equal(only.state.waveOnly,true); assert.equal(only.state.modal,null); assert.equal(only.screen,'hidden'); assert.equal(only.wave,'visible');
    assert.match(only.toast,/Back/);
    // Every piece of the menu, not just its container: rows set their own visibility.
    const showing = await page.evaluate(() => [...document.querySelectorAll('#screen *')].filter(n => getComputedStyle(n).visibility !== 'hidden' && n.getClientRects().length).map(n => n.className || n.id || n.tagName).slice(0,5));
    assert.deepEqual(showing,[]);
    const hiddenItem = only.state.item;
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    only = await page.evaluate(() => C5App.getState());
    assert.equal(only.waveOnly,true); assert.equal(only.item,hiddenItem,'the hidden menu ignores the remote'); assert.equal(only.busy,false);
    await page.keyboard.press('Escape');
    only = await page.evaluate(() => ({state:C5App.getState(),screen:getComputedStyle(document.getElementById('screen')).visibility,focus:document.activeElement.id}));
    assert.equal(only.state.waveOnly,false); assert.equal(only.screen,'visible'); assert.equal(only.focus,'items'); assert.equal(only.state.item,hiddenItem);
    await open('motion');
    await page.getByRole('button',{name:'Show waves full screen',exact:true}).click();
    await page.evaluate(() => document.dispatchEvent(new Event('webOSRelaunch')));
    assert.equal(await page.evaluate(() => C5App.getState().waveOnly),false);
    await open('motion');
    await page.getByRole('button',{name:'Show waves full screen',exact:true}).click();
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown',{key:'Unidentified',keyCode:461,bubbles:true,cancelable:true})));
    assert.equal(await page.evaluate(() => C5App.getState().waveOnly),false);
    checks.push('Waves full screen hides the menu, ignores the remote, and Back, TV keycode 461 or Home brings the menu back where it was');

    await page.evaluate(() => {
      const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;left:0;top:0;width:320px;height:180px;';document.body.appendChild(canvas);
      window.styleWave=new C5Wave(canvas,{adaptive:false});styleWave.setReducedMotion(true);
    });
    await page.waitForFunction(() => styleWave.mode==='webgl');
    const sums=await page.evaluate(() => {
      function sum(brightness) {
        styleWave.setStyle({brightness});const canvas=styleWave.canvas;
        const pixels=new Uint8Array(canvas.width*canvas.height*4);
        styleWave.gl.readPixels(0,0,canvas.width,canvas.height,styleWave.gl.RGBA,styleWave.gl.UNSIGNED_BYTE,pixels);
        let total=0;for(let i=0;i<pixels.length;i+=4)total+=pixels[i]+pixels[i+1]+pixels[i+2];return total;
      }
      const result=[sum(.6),sum(1),sum(1.5)];styleWave.destroy();styleWave.canvas.remove();delete window.styleWave;return result;
    });
    assert.ok(sums[0]<sums[1]&&sums[1]<sums[2],'brightness changes actual rendered pixels');
    checks.push('Wave brightness changes actual pixels while reduced motion remains still');
  } finally { await page.close(); }
};