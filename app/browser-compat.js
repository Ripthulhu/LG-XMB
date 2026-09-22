// SPDX-License-Identifier: GPL-3.0-or-later
// CSS.supports('gap', ...) also succeeds on browsers with grid-only gap support.
// Measure once at startup, before the launcher creates its menus.
(function () {
  'use strict';
  var probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px;';
  for (var i = 0; i < 2; i++) {
    var child = document.createElement('div');
    child.style.cssText = 'height:1px;flex:none;';
    probe.appendChild(child);
  }
  document.body.appendChild(probe);
  document.documentElement.classList.toggle('no-flex-gap', probe.scrollHeight !== 3);
  probe.remove();
})();
