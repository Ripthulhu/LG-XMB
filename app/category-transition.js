/* lg-xmb web application, 2026. SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var DURATION = 180, DISTANCE = 10.6, EASING = 'cubic-bezier(.22,.8,.2,1)';
  var COLUMN_DISTANCE = 1.4, MAX_COLUMN_PIXELS = 28, INITIAL_OPACITY = 0.5;

  function progress(animation) {
    if (!animation) return 1;
    try {
      // Read the animation clock, not layout or resolved styles. Progress already
      // includes easing and also works when a test pauses/seeks the animation.
      var value = animation.effect.getComputedTiming().progress;
      if (typeof value === 'number' && isFinite(value)) return Math.max(0, Math.min(1, value));
    } catch (ignore) {}
    return 1;
  }

  function CategoryTransition(list, bar) {
    this.list = list;
    this.bar = bar || null;
    this.animations = [];
    this.timer = null;
    this.generation = 0;
    this.destroyed = false;
    this.barFrom = 0;
    this.columnFrom = 0;
    this.opacityFrom = 1;
  }

  CategoryTransition.prototype.cancel = function () {
    this.generation++;
    if (this.timer !== null) root.clearTimeout(this.timer);
    this.timer = null;
    this.animations.forEach(function (animation) {
      animation.onfinish = null;
      animation.oncancel = null;
      try { animation.cancel(); } catch (ignore) {}
    });
    this.animations = [];
    this.list.classList.remove('items-arriving');
    if (this.bar) this.bar.classList.remove('categories-moving');
    this.barFrom = 0;
    this.columnFrom = 0;
    this.opacityFrom = 1;
  };

  CategoryTransition.prototype.change = function (steps, update, enabled) {
    if (typeof update !== 'function') throw new TypeError('A synchronous list update is required');
    var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var timeline = root.document.timeline, width = root.innerWidth;
    var allowed = !this.destroyed && enabled && !reduced && !root.document.hidden &&
      Number.isInteger(steps) && steps !== 0 && Math.abs(steps) <= 64 &&
      typeof width === 'number' && isFinite(width) && width > 0 &&
      typeof this.list.animate === 'function' && (!this.bar || typeof this.bar.animate === 'function') &&
      timeline && typeof timeline.currentTime === 'number';
    var continuing = this.animations.length > 0;
    var columnProgress = progress(this.animations[0]);
    var barProgress = progress(this.animations[1]);
    var columnFrom = continuing ? this.columnFrom * (1 - columnProgress) :
      Math.sign(steps) * Math.min(MAX_COLUMN_PIXELS, width * COLUMN_DISTANCE / 100);
    var opacityFrom = continuing ? this.opacityFrom + (1 - this.opacityFrom) * columnProgress : INITIAL_OPACITY;
    // The child category positions change synchronously by a known vw spacing.
    // Retain the current in-flight parent offset when reversing or skipping tabs.
    var barFrom = steps * DISTANCE * width / 100 + this.barFrom * (1 - barProgress);
    this.cancel();
    if (allowed) this.list.classList.add('items-arriving');
    try { update(); } catch (error) { this.cancel(); throw error; }
    if (!allowed) return;
    this.columnFrom = columnFrom; this.opacityFrom = opacityFrom; this.barFrom = barFrom;
    var self = this, generation = this.generation;
    function finish() { if (self.generation === generation) self.cancel(); }
    try {
      // One live list: old content is replaced immediately, never cloned into an
      // overlapping outgoing layer. Repeated keys do not restart the fade at zero.
      var incoming = this.list.animate([
        {transform:'translateX(' + columnFrom + 'px)', opacity:opacityFrom},
        {transform:'translateX(0)', opacity:1}
      ], {duration:DURATION, easing:EASING, fill:'both'});
      this.animations.push(incoming);
      if (this.bar) {
        this.bar.classList.add('categories-moving');
        this.animations.push(this.bar.animate([
          {transform:'translateX(' + barFrom + 'px)'}, {transform:'translateX(0)'}
        ], {duration:DURATION, easing:EASING, fill:'both'}));
      }
      var start = timeline.currentTime;
      this.animations.forEach(function (animation) { animation.startTime = start; });
      incoming.onfinish = finish;
      incoming.oncancel = finish;
      this.timer = root.setTimeout(finish, DURATION + 100);
    } catch (ignore) { this.cancel(); }
  };

  CategoryTransition.prototype.destroy = function () {
    this.destroyed = true;
    this.cancel();
  };
  CategoryTransition.DURATION = DURATION;
  CategoryTransition.DISTANCE = DISTANCE;
  CategoryTransition.EASING = EASING;
  root.LGXMBCategoryTransition = CategoryTransition;
  if (typeof module === 'object' && module.exports) module.exports = CategoryTransition;
})(typeof window !== 'undefined' ? window : globalThis);
