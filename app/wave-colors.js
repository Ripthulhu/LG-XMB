/*
 * Monthly gradient data and interpolation adapted from linkev/PlayStation-3-XMB
 * at 1ec453a9dddec5448d615116ff428349f42d454e. Copyright (c) 2025 Mart.
 * SPDX-License-Identifier: MIT. See licenses/PS3-XMB-MIT.txt.
 */
(function (root) {
  'use strict';
  // [angle in degrees, start RGB, end RGB]; upstream uses top-down UVs.
  var DAY = [
    [90.25, [197, 197, 197], [201, 201, 201]],
    [67, [203, 158, 13], [219, 214, 41]],
    [106, [142, 190, 40], [104, 168, 22]],
    [136.75, [216, 182, 182], [231, 66, 117]],
    [1.5, [19, 108, 19], [24, 156, 24]],
    [148.75, [198, 120, 238], [103, 77, 161]],
    [26.5, [0, 167, 146], [10, 240, 239]],
    [62.5, [0, 0, 95], [33, 217, 255]],
    [148.5, [146, 44, 155], [217, 98, 236]],
    [128.5, [227, 151, 15], [224, 187, 2]],
    [90, [115, 68, 20], [154, 118, 47]],
    [170.5, [236, 68, 45], [214, 63, 43]]
  ];
  var NIGHT = [
    [89.75, [181, 181, 181], [0, 0, 0]],
    [93.75, [198, 188, 128], [0, 0, 0]],
    [90.25, [152, 170, 113], [0, 0, 0]],
    [90.25, [212, 174, 182], [10, 8, 8]],
    [116, [48, 118, 48], [11, 3, 11]],
    [91, [209, 163, 225], [0, 0, 0]],
    [109.75, [16, 129, 124], [17, 0, 0]],
    [69.5, [20, 159, 176], [0, 0, 31]],
    [51, [116, 0, 153], [12, 0, 11]],
    [89.75, [216, 142, 0], [0, 0, 0]],
    [90, [131, 86, 32], [18, 20, 17]],
    [118.25, [157, 59, 44], [0, 0, 3]]
  ];
  function normalize(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      mode: ['theme', 'monthly', 'ps3'].indexOf(value.mode) >= 0 ? value.mode : 'theme',
      clock: value.clock === 'fixed' ? 'fixed' : 'auto',
      dateMode:
        ['auto', 'fixed'].indexOf(value.dateMode) >= 0
          ? value.dateMode
          : value.mode === 'monthly' || value.clock === 'fixed'
            ? 'fixed'
            : 'auto',
      timeMode:
        ['auto', 'day', 'night'].indexOf(value.timeMode) >= 0
          ? value.timeMode
          : value.mode === 'monthly' || value.clock === 'fixed'
            ? value.period === 'night'
              ? 'night'
              : 'day'
            : 'auto',
      month:
        Number.isInteger(value.month) && value.month >= 1 && value.month <= 12 ? value.month : 1,
      period: value.period === 'night' ? 'night' : 'day'
    };
  }
  function resolve(value, date) {
    var s = normalize(value);
    if (s.mode === 'theme') return null;
    // The PS3's own monthly background: the recovered back_colours0 program
    // over the 24 month_bg textures, driven by the clock or pinned to a month.
    // The wave over it is near white, like the console, rather than tinted.
    if (s.mode === 'ps3')
      return {
        monthly: { auto: s.dateMode === 'auto', month: s.month, period: s.timeMode },
        tint: [0.92, 0.96, 1]
      };
    var clock = root.LGXMBPS3BackgroundClock,
      live = date || new Date();
    var coord = clock.coordinates(live, s.dateMode === 'auto', s.month, s.timeMode);
    var index = Math.floor(coord.month) % 12,
      next = (index + 1) % 12,
      weight = coord.month - Math.floor(coord.month);
    weight = weight * weight * (3 - 2 * weight);
    var day = clock.uniforms(coord, clock.retained).values._NightDayBlend;
    // Preset gradients share the clock, but are not the PS3 texture shader.
    if (s.timeMode === 'day') day = 1;
    else if (s.timeMode === 'night') day = 0;
    function blend(a, b, t) {
      return a + (b - a) * t;
    }
    function gradient(layer) {
      var a = layer[index],
        b = layer[next],
        delta = ((b[0] - a[0] + 540) % 360) - 180;
      return [
        a[0] + delta * weight,
        a[1].map(function (v, i) {
          return blend(v, b[1][i], weight) / 255;
        }),
        a[2].map(function (v, i) {
          return blend(v, b[2][i], weight) / 255;
        })
      ];
    }
    var night = gradient(NIGHT),
      light = gradient(DAY),
      angle = night[0] + (((light[0] - night[0] + 540) % 360) - 180) * day,
      start = night[1].map(function (v, i) {
        return blend(v, light[1][i], day);
      }),
      end = night[2].map(function (v, i) {
        return blend(v, light[2][i], day);
      }),
      tint = start.map(function (v, i) {
        return Math.max(v, end[i]);
      });
    var rad = (angle * Math.PI) / 180,
      dir = [Math.cos(rad), Math.sin(rad)];
    var min = Math.min(0, dir[0], dir[1], dir[0] + dir[1]),
      max = Math.max(0, dir[0], dir[1], dir[0] + dir[1]);
    return {
      start: start,
      end: end,
      dir: dir,
      range: [min, Math.max(1e-6, max - min)],
      tint: tint
    };
  }
  // Recreate the option texture's horizontal alpha falloff in CSS. The tint
  // follows the recovered menu clock, not the wallpaper's gradient colours.
  function menuGradient(value, date) {
    var settings = normalize(value);
    var rgb = root.LGXMBPS3BackgroundClock.menuColour(
      date || new Date(),
      settings.dateMode === 'auto',
      settings.month,
      settings.timeMode
    )
      .map(function (v) {
        return Math.round(v * 255);
      })
      .join(',');
    var stops = [
      [0, 0.204],
      [3, 0.612],
      [6, 0.769],
      [12, 0.808],
      [28, 0.682],
      [47, 0.463],
      [56, 0.286],
      [65, 0.09],
      [75, 0.016],
      [84, 0.004],
      [100, 0]
    ];
    return (
      'linear-gradient(90deg,' +
      stops
        .map(function (stop) {
          return 'rgba(' + rgb + ',' + stop[1] + ') ' + stop[0] + '%';
        })
        .join(',') +
      ')'
    );
  }
  root.LGXMBWaveColors = Object.freeze({
    normalize: normalize,
    resolve: resolve,
    menuGradient: menuGradient
  });
})(window);
