/* SPDX-License-Identifier: GPL-3.0-or-later */
// A single colour list; navigation uses the same controls as other settings.
(function (root) {
  'use strict';
  function open(options) {
    var content = options.content,
      ui = options.ui,
      preferences = options.preferences;
    content.classList.add('theme-options');
    [{ value: 'original', label: 'Original', colour: null }]
      .concat(root.LGXMBPreferences.colourOptions)
      .forEach(function (choice) {
        var button = ui.row(
          choice.label,
          choice.colour,
          preferences.colour === choice.value,
          function () {
            options.onChange(choice.value);
            ui.selectChoice(content, choice.value);
          }
        );
        button.setAttribute('data-choice', choice.value);
      });
  }
  root.LGXMBWaveColorSettings = Object.freeze({ open: open });
})(window);
