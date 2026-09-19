/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  function DirectionalRepeat(options) {
    options = options || {};
    if (typeof options.onDirection !== 'function') throw new TypeError('onDirection is required');
    this.onDirection = options.onDirection;
    this.interval = Number.isFinite(options.interval) && options.interval > 0 ? options.interval : 100;
    this.now = options.now || function () { return root.performance ? root.performance.now() : Date.now(); };
    this.setTimer = options.setTimeout || root.setTimeout.bind(root);
    this.clearTimer = options.clearTimeout || root.clearTimeout.bind(root);
    this.key = null;
    this.lastAt = -Infinity;
    this.pending = null;
    this.timer = null;
    this.generation = 0;
  }
  DirectionalRepeat.prototype.clearPending = function () {
    this.generation++;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.pending = null;
  };
  DirectionalRepeat.prototype.deliver = function (event, stamp) {
    this.clearPending();
    this.key = event.key;
    this.lastAt = stamp;
    this.onDirection(event);
  };
  DirectionalRepeat.prototype.schedule = function (delay) {
    var self = this, generation = this.generation;
    this.timer = this.setTimer(function () {
      if (generation !== self.generation) return;
      self.timer = null;
      if (!self.pending) return;
      var stamp = self.now(), remaining = self.interval - (stamp - self.lastAt);
      // Timers may fire just before the requested deadline.
      if (remaining > 0) { self.schedule(remaining); return; }
      self.deliver(self.pending, stamp);
    }, delay);
  };
  DirectionalRepeat.prototype.handle = function (event) {
    if (!/^Arrow(Left|Right|Up|Down)$/.test(event.key)) return false;
    // A deferred event still needs its browser scrolling cancelled now.
    event.preventDefault();
    var stamp = this.now(), remaining = this.interval - (stamp - this.lastAt);
    if (event.key !== this.key || remaining <= 0) {
      this.deliver(event, stamp);
    } else {
      // Keep only the latest received event. Never create a repeat without
      // remote input, or replay a backlog after the browser has been busy.
      this.pending = event;
      if (this.timer === null) this.schedule(remaining);
    }
    return true;
  };
  DirectionalRepeat.prototype.keyup = function (event) {
    if (event.key !== this.key) return false;
    this.cancel();
    return true;
  };
  DirectionalRepeat.prototype.cancel = function () {
    this.clearPending();
    this.key = null;
    this.lastAt = -Infinity;
  };
  root.LGXMBDirectionalRepeat = DirectionalRepeat;
  if (typeof module === 'object' && module.exports) module.exports = DirectionalRepeat;
})(typeof window !== 'undefined' ? window : globalThis);
