/* lg-xmb web application, 2026. SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var DURATION = 180, DISTANCE = 10.6, EASING = 'cubic-bezier(.22,.8,.2,1)';

  // Move two containers, not copies of every item. The only listbox is updated
  // synchronously; old labels disappear rather than crossing the arriving text.
  function CategoryTransition(list, bar) {
    this.list = list;
    this.bar = bar || null;
    this.animations = [];
    this.travel = null;
    this.offset = 0;
    this.timer = null;
    this.generation = 0;
    this.destroyed = false;
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
    this.travel = null;
    this.offset = 0;
    this.list.classList.remove('items-arriving');
    if (this.bar) this.bar.classList.remove('categories-moving');
  };

  CategoryTransition.prototype.change = function (steps, update, enabled) {
    if (typeof update !== 'function') throw new TypeError('A synchronous list update is required');
    var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var timeline = root.document.timeline;
    var allowed = !this.destroyed && enabled && !reduced && !root.document.hidden &&
      Number.isInteger(steps) && steps !== 0 && Math.abs(steps) <= 64 &&
      typeof this.list.animate === 'function' && (!this.bar || typeof this.bar.animate === 'function') &&
      timeline && typeof timeline.currentTime === 'number';
    var residual = 0;
    if (allowed && this.travel) {
      try {
        // Computed animation progress includes easing. It needs no layout or
        // per-row style reads and keeps the bar continuous on rapid reversals.
        var progress = this.travel.effect.getComputedTiming().progress;
        if (typeof progress !== 'number' || !isFinite(progress)) progress = 0;
        residual = this.offset * (1 - Math.max(0, Math.min(1, progress)));
      } catch (ignore) { allowed = false; }
    }
    this.cancel();
    if (allowed) {
      this.list.classList.add('items-arriving');
      if (this.bar) this.bar.classList.add('categories-moving');
    }
    try { update(); } catch (error) { this.cancel(); throw error; }
    if (!allowed) return;
    var self = this, generation = this.generation;
    function finish() { if (self.generation === generation) self.cancel(); }
    try {
      this.offset = steps * DISTANCE + residual;
      var from = 'translateX(' + this.offset + 'vw)', to = 'translateX(0)';
      function animate(node, frames) {
        var animation = node.animate(frames, {duration:DURATION, easing:EASING, fill:'both'});
        self.animations.push(animation);
        return animation;
      }
      // Delay visibility slightly while the incoming column is far from its
      // anchor. Transform interpolation still spans the full shared timeline.
      var incoming = animate(this.list, [
        {transform:from, opacity:0},
        {offset:0.25, opacity:0},
        {transform:to, opacity:1}
      ]);
      this.travel = this.bar ? animate(this.bar, [{transform:from}, {transform:to}]) : incoming;
      var start = timeline.currentTime;
      this.animations.forEach(function (animation) { animation.startTime = start; });
      incoming.onfinish = finish;
      incoming.oncancel = finish;
      this.timer = root.setTimeout(finish, DURATION + 100);
    } catch (ignore) {
      // Refused animation support must not hide or delay the current selection.
      this.cancel();
    }
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
