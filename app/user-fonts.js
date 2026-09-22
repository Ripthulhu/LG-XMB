// SPDX-License-Identifier: GPL-3.0-or-later
// Retry after helper setup: CSS may have requested fonts before the link existed.
(function (root) {
  'use strict';
  var pending = null, loaded = {};
  function reload() {
    if (!root.FontFace || !document.fonts) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.all([['L', 300], ['R', 400], ['B', 700]].map(function (entry) {
      if (loaded[entry[0]]) return null;
      var face = new FontFace('XMB Media Rodin',
        'url("media-fonts/SCE-PS3-RD-' + entry[0] + '-LATIN2.TTF?setup=' + Date.now() + '")',
        { weight: String(entry[1]), style: 'normal', display: 'swap',
          ascentOverride: '100%', descentOverride: '22%', lineGapOverride: '0%' });
      return face.load().then(function () {
        document.fonts.add(face);
        loaded[entry[0]] = true;
      }, function () { /* Missing files leave the system or personal-build font in place. */ });
    })).then(function () { pending = null; });
    return pending;
  }
  root.LGXMBUserFonts = Object.freeze({ reload: reload });
})(window);
