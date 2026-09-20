/* SPDX-License-Identifier: GPL-3.0-or-later */
// Appearance choices are separate from rendering quality and hardware allocation.
(function (root) {
  'use strict';
  function AppearanceSettings(options) {
    var preferences = options.preferences,
      wave = options.wave,
      ui = options.ui;
    var save = options.save,
      applyPreferences = options.applyPreferences,
      openModal = options.openPanel,
      setWaveOnly = options.setWaveOnly;
    function open() {
      [
        ['Theme', 'theme', 'openTheme'],
        ['Colour', 'colour', 'openColour'],
        ['Background', 'background', 'openBackground'],
        ['Screensaver', 'screensaver', 'openScreensaver'],
        ['Clock', 'clock', 'openClock'],
        ['Advanced', 'appearance-advanced', 'openAppearanceAdvanced']
      ].forEach(function (entry) {
        ui.row(entry[0], null, false, function () {
          openModal(entry[1]);
        }).id = entry[2];
      });
    }
    function openAdvanced() {
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
      function qualityChoice(label, choices, key) {
        ui.choiceGroup(label, choices, preferences[key], function (value) {
          preferences[key] = value;
          wave.setQuality(LGXMBPreferences.waveQuality(preferences));
          save();
        });
      }
      qualityChoice(
        'Frame rate',
        [
          [60, '60 fps'],
          [30, '30 fps']
        ],
        'waveFrameRate'
      );
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
          ['high', 'Original']
        ],
        'waveDetail'
      );
      qualityChoice(
        'Edge softness',
        [
          [0, 'Sharp'],
          [1.5, 'Subtle'],
          [3, 'Soft']
        ],
        'waveSoftness'
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
          ['wave', 'FXAA']
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
    function openClock() {
      ui.choiceGroup(
        'Clock style',
        [
          ['current', 'Current'],
          ['ps3', 'PS3']
        ],
        preferences.clockStyle,
        function (value) {
          preferences.clockStyle = value;
          applyPreferences();
          save();
        }
      );
    }
    function openTheme() {
      var content = options.content;
      [
        ['original', 'Original'],
        ['classic', 'Classic']
      ].forEach(function (choice) {
        var button = ui.row(choice[1], null, preferences.theme === choice[0], function () {
          preferences.theme = choice[0];
          applyPreferences();
          save();
          ui.selectChoice(content, choice[0]);
        });
        button.setAttribute('data-choice', choice[0]);
      });
    }
    function openColour() {
      LGXMBWaveColorSettings.open({
        content: options.content,
        ui: ui,
        preferences: preferences,
        onChange: function (value) {
          preferences.colour = value;
          applyPreferences();
          save();
        }
      });
    }
    function updateBackgroundStatus() {
      var status = options.content.querySelector('#wallpaperStatus');
      if (!status) return;
      var wallpaper = options.wallpaper;
      status.textContent = wallpaper.loading ? 'Loading wallpaper…' : wallpaper.error;
    }
    function openBackground() {
      var content = options.content,
        source = document.createElement('div');
      source.className = 'background-source';
      content.appendChild(source);
      function selectBackground(value) {
        if (value === 'theme') {
          preferences.background = value;
          applyPreferences();
          save();
          ui.selectChoice(source, value);
          return;
        }
        options.wallpaper.reload().then(function (loaded) {
          if (!loaded) return;
          preferences.background = 'wallpaper';
          applyPreferences();
          save();
          ui.selectChoice(source, 'wallpaper');
        });
      }
      [
        ['theme', 'Theme'],
        ['wallpaper', 'Wallpaper']
      ].forEach(function (choice) {
        var button = ui.row(
          choice[1],
          null,
          preferences.background === choice[0],
          function () {
            selectBackground(choice[0]);
          },
          source
        );
        button.setAttribute('data-choice', choice[0]);
      });
      ui.row('Reload wallpaper', null, false, function () {
        selectBackground('wallpaper');
      }).id = 'reloadWallpaper';
      var status = document.createElement('p');
      status.id = 'wallpaperStatus';
      status.className = 'wallpaper-status';
      status.setAttribute('role', 'status');
      content.appendChild(status);
      ui.choiceGroup(
        'Brightness',
        [
          [0, 'Normal'],
          [-1, '-1'],
          [-2, '-2'],
          [-3, '-3'],
          [-4, '-4'],
          [-5, '-5']
        ],
        preferences.backgroundBrightness,
        function (value) {
          preferences.backgroundBrightness = value;
          applyPreferences();
          save();
        }
      );
      updateBackgroundStatus();
    }
    function openScreensaver() {
      function preferenceChoice(label, choices, key) {
        ui.choiceGroup(label, choices, preferences[key], function (value) {
          preferences[key] = value;
          applyPreferences();
          save();
        });
      }
      preferenceChoice(
        'Start after',
        [
          [0, 'Off'],
          [30000, '30 sec'],
          [60000, '1 min'],
          [120000, '2 min'],
          [300000, '5 min'],
          [600000, '10 min']
        ],
        'screensaverDelay'
      );
      preferenceChoice(
        'Background brightness',
        [
          [0, '0%'],
          [0.1, '10%'],
          [0.25, '25%'],
          [0.5, '50%'],
          [0.75, '75%'],
          [1, '100%']
        ],
        'screensaverBrightness'
      );
      ui.row('Preview screensaver', null, false, function () {
        options.previewScreensaver();
      }).id = 'previewScreensaver';
    }
    return {
      open: open,
      openTheme: openTheme,
      openColour: openColour,
      openBackground: openBackground,
      openScreensaver: openScreensaver,
      openClock: openClock,
      openAdvanced: openAdvanced,
      updateBackgroundStatus: updateBackgroundStatus
    };
  }
  root.LGXMBAppearanceSettings = AppearanceSettings;
})(window);
