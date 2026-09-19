/* SPDX-License-Identifier: GPL-3.0-or-later */
// Theme and wave controls. Hardware allocation remains the renderer's concern.
(function (root) {
  'use strict';
  function AppearanceSettings(options) {
    var preferences = options.preferences,
      themes = options.themes,
      wave = options.wave,
      ui = options.ui;
    var save = options.save,
      applyPreferences = options.applyPreferences,
      openModal = options.openPanel,
      setWaveOnly = options.setWaveOnly;
    function open() {
      var colorButton = ui.row('Wave colours', null, false, function () {
        openModal('wave-colors');
      });
      colorButton.id = 'openWaveColors';
      ui.row('Show waves full screen', null, false, function () {
        setWaveOnly(true);
      }).id = 'showWavesOnly';
      ui.choiceGroup(
        'Animation',
        [
          ['full', 'On'],
          ['reduced', 'Off']
        ],
        preferences.motion,
        function (value) {
          preferences.motion = value;
          applyPreferences();
          save();
        }
      );
      ui.choiceGroup(
        'Speed',
        [
          ['slow', 'Slow'],
          ['normal', 'Normal'],
          ['fast', 'Fast']
        ],
        preferences.waveSpeed,
        function (value) {
          preferences.waveSpeed = value;
          applyPreferences();
          save();
        }
      );
      ui.choiceGroup(
        'Brightness',
        [
          ['dim', 'Low'],
          ['low', 'Medium'],
          ['normal', 'High']
        ],
        preferences.waveBrightness,
        function (value) {
          preferences.waveBrightness = value;
          applyPreferences();
          save();
        }
      );
      function qualityChoice(label, choices, key) {
        ui.choiceGroup(label, choices, preferences[key], function (value) {
          preferences[key] = value;
          wave.setQuality(LGXMBPreferences.waveQuality(preferences));
          save();
        });
      }
      // An unsupported level is never rounded up, so offering one the driver cannot
      // allocate renders with no MSAA at all and reads as a broken setting. The C5
      // reports 4x only, so 2x is withheld there instead of silently doing nothing.
      function msaaChoices() {
        var surface = wave.getDiagnostics().surface,
          supported = surface ? surface.msaaSupported : null;
        var choices = [[0, 'Off']];
        [2, 4].forEach(function (n) {
          if (!supported || supported.indexOf(n) !== -1) choices.push([n, n + '×']);
        });
        if (
          preferences.waveMSAA &&
          !choices.some(function (choice) {
            return choice[0] === preferences.waveMSAA;
          })
        ) {
          // Match what the renderer was already doing with an unsupported request.
          preferences.waveMSAA = 0;
          save();
        }
        return choices;
      }
      qualityChoice(
        'Frame rate',
        [
          [60, '60 fps'],
          [30, '30 fps']
        ],
        'waveFrameRate'
      );
      qualityChoice('MSAA', msaaChoices(), 'waveMSAA');
      qualityChoice(
        'Supersampling',
        [
          [1, 'Off'],
          [1.25, '1.25×'],
          [1.5, '1.5×'],
          [2, '2×']
        ],
        'waveSampling'
      );
      qualityChoice(
        'Mesh detail',
        [
          ['standard', 'Reduced'],
          ['high', 'Original'],
          ['fine', 'Original (legacy)']
        ],
        'waveDetail'
      );
      qualityChoice(
        'Edge softness',
        [
          [0, 'Sharp'],
          [0.75, 'Subtle'],
          [1.5, 'Soft']
        ],
        'waveSoftness'
      );
      qualityChoice(
        'Particles',
        [
          [true, 'On'],
          [false, 'Off']
        ],
        'waveParticles'
      );
      // The emitter has a 4,096-slot pool; density limits the live population.
      qualityChoice(
        'Particle density',
        [
          [1000, 'Low'],
          [2000, 'Medium'],
          [4000, 'High']
        ],
        'waveParticleCount'
      );
      qualityChoice(
        'Post-process antialiasing',
        [
          ['off', 'Off'],
          ['fxaa', 'FXAA'],
          ['wave', 'Wave FXAA']
        ],
        'wavePostprocess'
      );
      qualityChoice(
        'Smoothing strength',
        [
          ['gentle', 'Gentle'],
          ['normal', 'Normal'],
          ['strong', 'Strong']
        ],
        'waveSmoothing'
      );
    }
    function openTheme() {
      var content = options.content;
      content.classList.add('theme-options');
      Object.keys(themes).forEach(function (key) {
        var colour =
          key === 'seasonal'
            ? LGXMBPreferences.monthColours[new Date().getMonth()]
            : themes[key].wave;
        var button = ui.row(themes[key].name, colour, preferences.theme === key, function () {
          preferences.theme = key;
          applyPreferences();
          save();
          ui.selectChoice(content, key);
        });
        button.setAttribute('data-choice', key);
      });
    }
    return { open: open, openTheme: openTheme };
  }
  root.LGXMBAppearanceSettings = AppearanceSettings;
})(window);
