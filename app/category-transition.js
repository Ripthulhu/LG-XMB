/* lg-xmb web application, 2026. SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';

  function CategoryTransition(bar) {
    this.bar = bar || null;
    this.destroyed = false;
    this.cancel();
  }

  CategoryTransition.prototype.cancel = function () {
    // Disable CSS transitions for lifecycle/resize changes, not by clearing the
    // final transform. The next enabled navigation restores normal interpolation.
    if (this.bar) this.bar.classList.add('categories-instant');
  };

  CategoryTransition.prototype.change = function (steps, update, enabled) {
    if (typeof update !== 'function') throw new TypeError('A synchronous list update is required');
    var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var allowed =
      !this.destroyed &&
      enabled &&
      !reduced &&
      !root.document.hidden &&
      Number.isInteger(steps) &&
      steps !== 0 &&
      Math.abs(steps) <= 64;
    if (this.bar) this.bar.classList.toggle('categories-instant', !allowed);
    // Like vertical navigation, update the destination and let CSS retarget its
    // current transform. Never move/fade the list or reset it after a timer.
    try {
      update();
    } catch (error) {
      this.cancel();
      throw error;
    }
  };

  CategoryTransition.prototype.destroy = function () {
    this.destroyed = true;
    this.cancel();
  };
  CategoryTransition.DISTANCE = 10.6;
  root.LGXMBCategoryTransition = CategoryTransition;
  if (typeof module === 'object' && module.exports) module.exports = CategoryTransition;
})(typeof window !== 'undefined' ? window : globalThis);
