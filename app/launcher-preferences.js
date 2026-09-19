/* SPDX-License-Identifier: GPL-3.0-or-later */
// Persisted settings and appearance configuration. Keep storage keys stable.
(function (root) {
  'use strict';
  var KEY = 'lg-xmb-preferences-v1',
    LEGACY_KEY = 'openxmb-c5-preferences-v1';
  var defaults = {
    theme: 'midnight',
    motion: 'full',
    sound: false,
    previewMode: 'cached',
    waveSpeed: 'normal',
    waveBrightness: 'normal',
    backBehavior: 'stay',
    waveMSAA: 0,
    waveSampling: 1.5,
    waveDetail: 'high',
    waveSoftness: 0.75,
    wavePostprocess: 'wave',
    waveSmoothing: 'strong',
    musicEnabled: false,
    musicVolume: 0.25,
    waveParticles: true,
    waveParticleCount: 2000,
    waveFrameRate: 60
  };
  var themes = {
    midnight: { name: 'Midnight', background: '#050911', wave: '#738acf', accent: '#a7baf3' },
    ocean: { name: 'Ocean', background: '#030e13', wave: '#4da6ab', accent: '#98dfdf' },
    ember: { name: 'Ember', background: '#130906', wave: '#ac6c45', accent: '#eebd96' },
    forest: { name: 'Forest', background: '#040f0b', wave: '#579b7a', accent: '#b0d6bb' },
    amber: { name: 'Amber', background: '#130f05', wave: '#c49a4a', accent: '#e0c998' },
    rose: { name: 'Rose', background: '#13080d', wave: '#b86e8c', accent: '#e6b2c7' },
    violet: { name: 'Violet', background: '#0d0816', wave: '#9678ca', accent: '#c8b5ec' },
    graphite: { name: 'Graphite', background: '#090b0d', wave: '#83939d', accent: '#ccd4d9' },
    seasonal: { name: 'Seasonal', background: '#080813', wave: '#2e2e73', accent: '#b3b3ea' }
  };
  // Monthly colours are adapted from OpenXMB config.json, shell.theme-month-colours.
  var monthColours = [
    '#f2e6a6',
    '#9e4540',
    '#4da640',
    '#f299cc',
    '#99cc59',
    '#b399e6',
    '#80d9f2',
    '#3373f2',
    '#2e2e73',
    '#994db3',
    '#cc8040',
    '#e64040'
  ];
  function load(storage, reducedMotion, normalizeColors) {
    // Preserve stored brightness keys; the old high gain is capped at normal.
    var preferences = Object.assign({}, defaults),
      saved;
    try {
      saved = JSON.parse(storage.getItem(KEY) || storage.getItem(LEGACY_KEY) || '{}');
      if (Object.prototype.hasOwnProperty.call(themes, saved.theme))
        preferences.theme = saved.theme;
      if (saved.motion === 'reduced' || saved.motion === 'full') preferences.motion = saved.motion;
      else if (typeof reducedMotion === 'function' ? reducedMotion() : reducedMotion)
        preferences.motion = 'reduced';
      preferences.sound = saved.sound === true;
      preferences.previewMode = saved.previewMode === 'live' ? 'live' : 'cached';
      if (['slow', 'normal', 'fast'].indexOf(saved.waveSpeed) !== -1)
        preferences.waveSpeed = saved.waveSpeed;
      if (['dim', 'low', 'normal'].indexOf(saved.waveBrightness) !== -1)
        preferences.waveBrightness = saved.waveBrightness;
      else if (saved.waveBrightness === 'high') preferences.waveBrightness = 'normal';
      if (saved.backBehavior === 'lg') preferences.backBehavior = 'lg';
    } catch (ignore) {}
    // Load quality settings separately from appearance and TV preferences.
    if (saved && typeof saved === 'object') {
      if ([0, 2, 4].indexOf(saved.waveMSAA) !== -1) preferences.waveMSAA = saved.waveMSAA;
      if ([30, 60].indexOf(saved.waveFrameRate) !== -1)
        preferences.waveFrameRate = saved.waveFrameRate;
      if (typeof saved.waveParticles === 'boolean') preferences.waveParticles = saved.waveParticles;
      // 500 was Low until the densities became 1,000 / 2,000 / 4,000.
      if (saved.waveParticleCount === 500) preferences.waveParticleCount = 1000;
      else if ([1000, 2000, 4000].indexOf(saved.waveParticleCount) !== -1)
        preferences.waveParticleCount = saved.waveParticleCount;
      preferences.musicEnabled = saved.musicEnabled === true;
      if ([0.1, 0.25, 0.5, 0.75, 1].indexOf(saved.musicVolume) !== -1)
        preferences.musicVolume = saved.musicVolume;
      if ([1, 1.25, 1.5, 2].indexOf(saved.waveSampling) !== -1)
        preferences.waveSampling = saved.waveSampling;
      if (['standard', 'high', 'fine'].indexOf(saved.waveDetail) !== -1)
        preferences.waveDetail = saved.waveDetail;
      if ([0, 0.75, 1.5].indexOf(saved.waveSoftness) !== -1)
        preferences.waveSoftness = saved.waveSoftness;
      if (['off', 'fxaa', 'wave'].indexOf(saved.wavePostprocess) !== -1)
        preferences.wavePostprocess = saved.wavePostprocess;
      if (['gentle', 'normal', 'strong'].indexOf(saved.waveSmoothing) !== -1)
        preferences.waveSmoothing = saved.waveSmoothing;
    }
    // Keep the requested output at full HD; allocation limits are handled by the renderer.
    preferences.waveColors = normalizeColors(saved && saved.waveColors);
    return preferences;
  }
  function save(storage, preferences) {
    storage.setItem(KEY, JSON.stringify(preferences));
  }
  function createThemes() {
    var result = {};
    Object.keys(themes).forEach(function (key) {
      result[key] = Object.assign({}, themes[key]);
    });
    return result;
  }
  function updateSeasonal(themes, date) {
    var colour = monthColours[date.getMonth()],
      rgb = colour.match(/[a-f0-9]{2}/gi).map(function (x) {
        return parseInt(x, 16);
      });
    themes.seasonal.wave = colour;
    themes.seasonal.background =
      '#' +
      rgb
        .map(function (v) {
          return Math.max(3, Math.round(v * 0.07))
            .toString(16)
            .padStart(2, '0');
        })
        .join('');
    themes.seasonal.accent =
      '#' +
      rgb
        .map(function (v) {
          return Math.round(v * 0.45 + 255 * 0.55)
            .toString(16)
            .padStart(2, '0');
        })
        .join('');
  }

  function waveStyle(preferences) {
    return {
      speed: { slow: 0.5, normal: 1.5, fast: 2.25 }[preferences.waveSpeed],
      brightness: { dim: 0.3, low: 0.6, normal: 1 }[preferences.waveBrightness]
    };
  }
  function waveQuality(preferences) {
    return {
      frameRate: preferences.waveFrameRate,
      msaa: preferences.waveMSAA,
      sampling: preferences.waveSampling,
      detail: preferences.waveDetail,
      softness: preferences.waveSoftness,
      postprocess: preferences.wavePostprocess,
      strength: preferences.waveSmoothing,
      particles: preferences.waveParticles,
      particleCount: preferences.waveParticleCount
    };
  }
  var api = {
    load: load,
    save: save,
    createThemes: createThemes,
    updateSeasonal: updateSeasonal,
    monthColours: monthColours,
    waveStyle: waveStyle,
    waveQuality: waveQuality
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGXMBPreferences = api;
})(typeof window !== 'undefined' ? window : globalThis);
