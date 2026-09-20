/* SPDX-License-Identifier: GPL-3.0-or-later */
// Persisted settings and appearance configuration. Keep storage keys stable.
(function (root) {
  'use strict';
  var KEY = 'lg-xmb-preferences-v1',
    LEGACY_KEY = 'openxmb-c5-preferences-v1';
  var defaults = {
    theme: 'original',
    colour: 'original',
    background: 'theme',
    backgroundBrightness: 0,
    screensaverDelay: 120000,
    screensaverBrightness: 0.25,
    motion: 'full',
    sound: false,
    previewMode: 'cached',
    waveSpeed: 'normal',
    backBehavior: 'previous',
    waveSampling: 1.5,
    waveDetail: 'high',
    waveSoftness: 1.5,
    wavePostprocess: 'wave',
    waveSmoothing: 'strong',
    musicEnabled: false,
    musicVolume: 0.25,
    waveParticleCount: 2000,
    waveFrameRate: 60
  };
  var legacyColours = {
    midnight: '#738acf',
    ocean: '#4da6ab',
    ember: '#ac6c45',
    forest: '#579b7a',
    amber: '#c49a4a',
    rose: '#b86e8c',
    violet: '#9678ca',
    graphite: '#83939d'
  };
  // These are display dimming steps, independent of the calendar's day/night
  // changes. They are not recovered PS3 brightness constants.
  var backgroundGains = [1, 0.85, 0.7, 0.6, 0.45, 0.3];
  var colourOptions = [
    { value: 1, label: 'Grey', colour: '#c7c7c7' },
    { value: 2, label: 'Yellow', colour: '#d3ba1b' },
    { value: 3, label: 'Lime', colour: '#7bb31f' },
    { value: 4, label: 'Pink', colour: '#e37895' },
    { value: 5, label: 'Green', colour: '#168416' },
    { value: 6, label: 'Violet', colour: '#9663c8' },
    { value: 7, label: 'Turquoise', colour: '#05cbbc' },
    { value: 8, label: 'Blue', colour: '#116caf' },
    { value: 9, label: 'Purple', colour: '#b546c4' },
    { value: 10, label: 'Gold', colour: '#e2a90a' },
    { value: 11, label: 'Brown', colour: '#866026' },
    { value: 12, label: 'Red', colour: '#e1402c' }
  ];
  function fixedColour(value) {
    return Number.isInteger(value) && value >= 1 && value <= 12;
  }
  function rgb(hex) {
    return hex.match(/[a-f0-9]{2}/gi).map(function (value) {
      return parseInt(value, 16);
    });
  }
  function nearestColour(channels) {
    // Compare hue independently of brightness; old themes were deliberately
    // dark, whereas the fixed PS3 colours use their daytime backgrounds.
    function normalize(values) {
      var peak = Math.max.apply(Math, values);
      return values.map(function (value) {
        return peak ? value / peak : 0;
      });
    }
    var target = normalize(channels),
      nearest = 1,
      distance = Infinity;
    colourOptions.forEach(function (colour, index) {
      var error = normalize(rgb(colour.colour)).reduce(function (sum, value, channel) {
        return sum + Math.pow(value - target[channel], 2);
      }, 0);
      if (error < distance) {
        distance = error;
        nearest = index + 1;
      }
    });
    return nearest;
  }
  function migrateColour(saved) {
    if (saved.colour === 'original' || fixedColour(saved.colour)) return saved.colour;
    var colors = saved.waveColors;
    if (colors && (colors.mode === 'ps3' || colors.mode === 'monthly')) {
      var automatic =
        colors.dateMode === 'auto' ||
        (!colors.dateMode && colors.mode === 'ps3' && colors.clock !== 'fixed');
      return automatic ? 'original' : fixedColour(colors.month) ? colors.month : 1;
    }
    if (colors && colors.mode === 'rgb') {
      var channels = [colors.red, colors.green, colors.blue];
      if (
        channels.every(function (value) {
          return Number.isFinite(value) && value >= 0 && value <= 255;
        })
      )
        return nearestColour(channels);
    }
    if (saved.theme === 'seasonal') return 'original';
    if (Object.prototype.hasOwnProperty.call(legacyColours, saved.theme))
      return nearestColour(rgb(legacyColours[saved.theme]));
    return 'original';
  }
  function load(storage, reducedMotion, normalizeColors) {
    var preferences = Object.assign({}, defaults),
      saved;
    try {
      saved = JSON.parse(storage.getItem(KEY) || storage.getItem(LEGACY_KEY) || '{}');
      if (!saved || typeof saved !== 'object') saved = {};
      preferences.theme =
        saved.theme === 'classic' || (saved.theme !== 'original' && saved.waveParticles === false)
          ? 'classic'
          : 'original';
      preferences.colour = migrateColour(saved);
      preferences.background = saved.background === 'wallpaper' ? 'wallpaper' : 'theme';
      if (
        Number.isInteger(saved.backgroundBrightness) &&
        saved.backgroundBrightness >= -5 &&
        saved.backgroundBrightness <= 0
      )
        preferences.backgroundBrightness = saved.backgroundBrightness;
      else if (saved.waveBrightness === 'dim') preferences.backgroundBrightness = -5;
      else if (saved.waveBrightness === 'low') preferences.backgroundBrightness = -3;
      if ([0, 30000, 60000, 120000, 300000, 600000].indexOf(saved.screensaverDelay) !== -1)
        preferences.screensaverDelay = saved.screensaverDelay;
      if ([0, 0.1, 0.25, 0.5, 0.75, 1].indexOf(saved.screensaverBrightness) !== -1)
        preferences.screensaverBrightness = saved.screensaverBrightness;
      if (saved.motion === 'reduced' || saved.motion === 'full') preferences.motion = saved.motion;
      else if (typeof reducedMotion === 'function' ? reducedMotion() : reducedMotion)
        preferences.motion = 'reduced';
      preferences.sound = saved.sound === true;
      preferences.previewMode = saved.previewMode === 'live' ? 'live' : 'cached';
      if (['slow', 'normal', 'fast'].indexOf(saved.waveSpeed) !== -1)
        preferences.waveSpeed = saved.waveSpeed;
      if (['previous', 'stay', 'lg'].indexOf(saved.backBehavior) !== -1)
        preferences.backBehavior = saved.backBehavior;
    } catch (ignore) {}
    // Load quality settings separately from appearance and TV preferences.
    if (saved && typeof saved === 'object') {
      if ([30, 60].indexOf(saved.waveFrameRate) !== -1)
        preferences.waveFrameRate = saved.waveFrameRate;
      // 500 was Low until the densities became 1,000 / 2,000 / 4,000.
      if (saved.waveParticleCount === 500) preferences.waveParticleCount = 1000;
      else if ([1000, 2000, 4000].indexOf(saved.waveParticleCount) !== -1)
        preferences.waveParticleCount = saved.waveParticleCount;
      preferences.musicEnabled = saved.musicEnabled === true;
      if ([0.1, 0.25, 0.5, 0.75, 1].indexOf(saved.musicVolume) !== -1)
        preferences.musicVolume = saved.musicVolume;
      if ([1, 1.25, 1.5, 2].indexOf(saved.waveSampling) !== -1)
        preferences.waveSampling = saved.waveSampling;
      if (['standard', 'high'].indexOf(saved.waveDetail) !== -1)
        preferences.waveDetail = saved.waveDetail;
      // The former Soft amount is now the middle setting.
      if (saved.waveSoftness === 0.75) preferences.waveSoftness = 1.5;
      else if ([0, 1.5, 3].indexOf(saved.waveSoftness) !== -1)
        preferences.waveSoftness = saved.waveSoftness;
      if (saved.wavePostprocess === 'fxaa') preferences.wavePostprocess = 'wave';
      else if (['off', 'wave'].indexOf(saved.wavePostprocess) !== -1)
        preferences.wavePostprocess = saved.wavePostprocess;
      if (['gentle', 'normal', 'strong'].indexOf(saved.waveSmoothing) !== -1)
        preferences.waveSmoothing = saved.waveSmoothing;
    }
    // Keep the requested output at full HD; allocation limits are handled by the renderer.
    return preferences;
  }
  function save(storage, preferences) {
    storage.setItem(KEY, JSON.stringify(preferences));
  }
  function waveStyle(preferences) {
    return {
      speed: { slow: 0.5, normal: 1.5, fast: 2.25 }[preferences.waveSpeed],
      brightness: backgroundGains[-preferences.backgroundBrightness] || 1
    };
  }
  function backgroundTheme(preferences) {
    var automatic = preferences.colour === 'original',
      month = fixedColour(preferences.colour) ? preferences.colour : new Date().getMonth() + 1,
      fallback = rgb(colourOptions[month - 1].colour).map(function (value) {
        return Math.round(value * 0.16)
          .toString(16)
          .padStart(2, '0');
      });
    return {
      background: '#' + fallback.join(''),
      wave: '#ebf5ff',
      colors: {
        mode: 'ps3',
        dateMode: automatic ? 'auto' : 'fixed',
        timeMode: automatic ? 'auto' : 'day',
        month: fixedColour(preferences.colour) ? preferences.colour : 1
      }
    };
  }
  function waveQuality(preferences) {
    return {
      frameRate: preferences.waveFrameRate,
      sampling: preferences.waveSampling,
      detail: preferences.waveDetail,
      softness: preferences.waveSoftness,
      postprocess: preferences.wavePostprocess,
      strength: preferences.waveSmoothing,
      particles: preferences.theme !== 'classic',
      particleCount: preferences.waveParticleCount
    };
  }
  var api = {
    load: load,
    save: save,
    colourOptions: colourOptions,
    backgroundTheme: backgroundTheme,
    waveStyle: waveStyle,
    waveQuality: waveQuality
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGXMBPreferences = api;
})(typeof window !== 'undefined' ? window : globalThis);
