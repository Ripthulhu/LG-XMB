/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  function focus(control) {
    if (!control || typeof control.focus !== 'function' || control === root.document.activeElement) return false;
    // Browser focus scrolling centres an off-screen row. Keep the surrounding
    // rows in place and scroll only far enough to reveal the new selection.
    control.focus({preventScroll: true});
    control.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'auto'});
    return true;
  }
  root.LGXMBMenuFocus = focus;
  if (typeof module !== 'undefined' && module.exports) module.exports = focus;
})(typeof window !== 'undefined' ? window : globalThis);
