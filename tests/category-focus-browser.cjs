// SPDX-License-Identifier: GPL-3.0-or-later
// Sample real CSS focus transitions without depending on wall-clock timing.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');
const {launchOptions} = require('./support/menu-navigation.cjs');
const focused = 1 / 0.7;
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 0.001, `${message}: ${actual} vs ${expected}`);

(async () => {
  const browser = await chromium.launch(launchOptions());
  const errors = [];
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 720}});
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><nav id="categories"></nav><div class="cross-content"><div id="items"></div></div>');
    await page.addStyleTag({path: path.resolve(__dirname, '../app/style.css')});
    for (const file of ['icons.js', 'category-transition.js', 'launcher-view.js'])
      await page.addScriptTag({path: path.resolve(__dirname, '../app', file)});
    await page.evaluate(() => {
      const bar = document.getElementById('categories');
      const categories = [['settings', 'settings'], ['photo', 'image'], ['music', 'music']]
        .map(([id, icon]) => ({id, title: id, icon,
        items: [{id: icon, title: icon, icon}]}));
      let selected = 0;
      const transition = new LGXMBCategoryTransition(bar);
      const view = new LGXMBLauncherView({categories, selections: [0, 0, 0],
        getCategory: () => selected, isBusy: () => false, canActivate: () => true,
        cancelHold() {}, selectCategory() {}, activateItem() {}});
      view.buildCategories(); view.buildItems(); view.render();
      const retained = [...bar.querySelectorAll('*')];
      window.selectCategory = (index, enabled = true) => transition.change(index - selected, () => {
        selected = index; view.activateCategory(); view.render();
      }, enabled);
      window.finishMotion = () => document.getAnimations().forEach(animation => animation.finish());
      window.sampleFocus = time => {
        // Flush the real stylesheet, then freeze every transition at the same time.
        if (Number.isFinite(time)) document.getAnimations().forEach(animation => {
          animation.pause(); animation.currentTime = time;
        });
        return {selected, retained: retained.every((node, i) => node === bar.querySelectorAll('*')[i]),
          icons: [...bar.children].map(button => {
            const anchor = button.getBoundingClientRect();
            const baseScale = parseFloat(getComputedStyle(button).getPropertyValue('--category-icon-scale'));
            return [...button.querySelectorAll('.category-icon')].map(icon => {
              const svg = icon.firstElementChild, box = svg.getBoundingClientRect();
              const wrapper = icon.getBoundingClientRect();
              const style = getComputedStyle(svg), matrix = new DOMMatrix(style.transform);
              const face = icon.parentNode;
              return {scale: matrix.a / baseScale, scaleY: matrix.d / baseScale, colour: style.color,
                wrapperScale: new DOMMatrix(getComputedStyle(icon).transform).a,
                opacity: Number(getComputedStyle(face).opacity),
                centreX: box.x + box.width / 2 - (wrapper.x + wrapper.width / 2),
                centreY: box.y + box.height / 2 - (wrapper.y + wrapper.height / 2),
                anchorX: box.x + box.width / 2 - (anchor.x + anchor.width / 2),
                anchorY: box.y + box.height / 2 - innerHeight * 0.27,
                faceEffects: face.getAnimations().map(animation => ({property: animation.transitionProperty,
                  duration: animation.effect.getTiming().duration})),
                effects: svg.getAnimations().map(animation => ({property: animation.transitionProperty,
                  duration: animation.effect.getTiming().duration}))};
            });
          })};
      };
    });
    function geometry(state) {
      assert.equal(state.retained, true, 'Navigation retains the painted faces and SVG nodes');
      state.icons.forEach(copies => {
        near(copies[0].scale, copies[1].scale, 'Dim and lit copies share the current focus scale');
        near(copies[0].opacity, 1, 'The dim base remains painted beneath the white overlay');
        assert.equal(copies[0].colour, 'rgba(255, 255, 255, 0.7)', 'Native idle icon brightness is 70%');
        assert.equal(copies[1].colour, 'rgb(255, 255, 255)', 'The overlay is prepainted white');
        copies.forEach(icon => {
          near(icon.scaleY, icon.scale, 'Uniform SVG zoom');
          near(icon.wrapperScale, 1, 'Brightness fades must not scale the icon wrapper');
          for (const key of ['centreX', 'centreY', 'anchorX', 'anchorY'])
            assert.ok(Math.abs(icon[key]) < 0.1, `${key} stays anchored: ${icon[key]}`);
        });
      });
    }
    function settled(state) {
      geometry(state);
      state.icons.forEach((copies, index) => {
        near(copies[1].opacity, index === state.selected ? 1 : 0, 'Settled white overlay alpha');
        copies.forEach(icon => near(icon.scale, index === state.selected ? focused : 1, 'Settled focus size'));
      });
    }
    const initial = await page.evaluate(() => sampleFocus());
    settled(initial);
    const start = await page.evaluate(() => {selectCategory(1); return sampleFocus(0);});
    geometry(start);
    near(start.icons[0][0].scale, focused, 'Outgoing icon starts at focused size');
    near(start.icons[1][0].scale, 1, 'Incoming icon starts at idle size');
    near(start.icons[0][1].opacity, 1, 'Outgoing icon starts at full brightness');
    near(start.icons[1][1].opacity, 0, 'Incoming icon starts at idle brightness');
    for (const copies of start.icons.slice(0, 2)) for (const icon of copies)
      assert.deepEqual(icon.effects, [{property: 'transform', duration: 400}]);
    for (const copies of start.icons.slice(0, 2))
      assert.deepEqual(copies[1].faceEffects, [{property: 'opacity', duration: 320}]);
    const middle = await page.evaluate(() => sampleFocus(200));
    geometry(middle);
    for (const copies of middle.icons.slice(0, 2)) for (const icon of copies)
      assert.ok(icon.scale > 1.001 && icon.scale < focused - 0.001,
        'Both incoming growth and outgoing shrinkage must have an intermediate frame');
    near(middle.icons[0][0].scale + middle.icons[1][0].scale, focused + 1,
      'Incoming and outgoing focus use the same curve');
    for (const copies of middle.icons.slice(0, 2))
      assert.ok(copies[1].opacity > 0 && copies[1].opacity < 1, 'Brightness fades have intermediate frames');
    near(middle.icons[0][1].opacity + middle.icons[1][1].opacity, 1,
      'Incoming and outgoing brightness use the same curve');
    await page.evaluate(() => finishMotion());
    settled(await page.evaluate(() => sampleFocus()));

    const reversal = await page.evaluate(() => {
      selectCategory(2);
      const before = sampleFocus(70);
      selectCategory(1);
      return {before, after: sampleFocus(0)};
    });
    geometry(reversal.before); geometry(reversal.after);
    reversal.before.icons.forEach((copies, index) => copies.forEach((icon, face) => {
      near(reversal.after.icons[index][face].scale, icon.scale, 'Reversal preserves current scale');
      near(reversal.after.icons[index][face].opacity, icon.opacity, 'Reversal preserves current brightness');
    }));
    await page.evaluate(() => finishMotion());
    settled(await page.evaluate(() => sampleFocus()));

    for (const mode of ['reduced-motion', 'simple-menu-animations', 'categories-instant', 'system-reduced']) {
      if (mode === 'system-reduced') await page.emulateMedia({reducedMotion: 'reduce'});
      const state = await page.evaluate(mode => {
        document.body.className = mode;
        selectCategory(2, mode !== 'categories-instant');
        return sampleFocus();
      }, mode);
      settled(state);
      state.icons.flat().forEach(icon => {
        assert.deepEqual(icon.effects, [], `${mode} settles size immediately`);
        assert.deepEqual(icon.faceEffects, [], `${mode} settles brightness immediately`);
      });
      await page.evaluate(() => {selectCategory(1, false); sampleFocus(); document.body.className = '';});
      if (mode === 'system-reduced') await page.emulateMedia({reducedMotion: 'no-preference'});
    }
    const final = await page.evaluate(() => sampleFocus());
    assert.deepEqual(final.icons.map(copies => copies.map(icon => icon.colour)),
      initial.icons.map(copies => copies.map(icon => icon.colour)), 'Prepainted face colours stay unchanged');
    await page.setViewportSize({width: 3840, height: 2160});
    const widths = await page.evaluate(() => {
      selectCategory(0, false); sampleFocus();
      return ['[data-category="settings"] .lit', '[data-category="photo"] .dim'].map(selector => {
        const svg = document.querySelector(selector + ' svg');
        return svg.getBBox().width * svg.getScreenCTM().a;
      });
    });
    for (const [index, expected] of [224, 134].entries())
      assert.ok(Math.abs(widths[index] - expected) < 0.2,
        `4K ${index ? 'idle Photo' : 'focused Settings'} silhouette width: ${widths[index]} vs ${expected}`);
    settled(await page.evaluate(() => sampleFocus()));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({checks: ['incoming/outgoing SVG zoom', '70%-100% brightness fades', 'paired painted faces',
      'anchored centres', 'continuous reversal', 'immediate reduced/simple/cancelled motion',
      'retained nodes', '4K Settings/Photo silhouette sizes'], testedOnTV: false}, null, 2));
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
