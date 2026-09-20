/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var MAX_STEPS = 100,
    IDLE_GAP = 200;

  function WheelNavigation(options) {
    options = options || {};
    if (typeof options.onSteps !== 'function') throw new TypeError('onSteps is required');
    this.onSteps = options.onSteps;
    this.pixelStep =
      Number.isFinite(options.pixelStep) && options.pixelStep > 0 ? options.pixelStep : 100;
    this.now =
      options.now ||
      function () {
        return root.performance ? root.performance.now() : Date.now();
      };
    this.requestFrame = options.requestAnimationFrame || root.requestAnimationFrame.bind(root);
    this.cancelFrame = options.cancelAnimationFrame || root.cancelAnimationFrame.bind(root);
    this.frame = null;
    this.pending = 0;
    this.remainder = 0;
    this.direction = 0;
    this.lastAt = -Infinity;
    this.generation = 0;
  }

  WheelNavigation.prototype.cancel = function () {
    this.generation++;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.pending = 0;
    this.remainder = 0;
    this.direction = 0;
    this.lastAt = -Infinity;
  };

  WheelNavigation.prototype.schedule = function () {
    var self = this,
      generation = this.generation;
    this.frame = this.requestFrame(function () {
      if (generation !== self.generation) return;
      if (self.now() - self.lastAt >= IDLE_GAP) {
        self.cancel();
        return;
      }
      self.frame = null;
      var steps = self.pending;
      self.pending = 0;
      if (!steps) return;
      // Start the next batch before calling out: a callback may cancel or
      // dispatch new input, and must not leave an old frame behind afterward.
      self.schedule();
      self.onSteps(steps * self.direction);
    });
  };

  WheelNavigation.prototype.handle = function (event) {
    if (!event || event.ctrlKey) return false;
    var y = event.deltaY,
      x = event.deltaX === undefined ? 0 : event.deltaX,
      mode = event.deltaMode === undefined ? 0 : event.deltaMode;
    if (
      !Number.isFinite(y) ||
      !Number.isFinite(x) ||
      y === 0 ||
      Math.abs(x) > Math.abs(y) ||
      (mode !== 0 && mode !== 1 && mode !== 2)
    )
      return false;
    event.preventDefault();
    var stamp = this.now(),
      direction = y > 0 ? 1 : -1;
    if (direction !== this.direction || stamp - this.lastAt >= IDLE_GAP) this.cancel();
    this.direction = direction;
    this.lastAt = stamp;
    // Pixel wheels use the caller's detent size. Browser line events commonly
    // represent three lines per detent; a page event advances one item.
    var divisor = mode === 1 ? 3 : mode === 2 ? 1 : this.pixelStep,
      distance = Math.min(MAX_STEPS, Math.abs(y) / divisor) + this.remainder,
      steps = Math.min(MAX_STEPS, Math.floor(distance + 1e-9));
    this.remainder = Math.max(0, distance - steps);
    if (!steps) return true;
    if (this.frame !== null) {
      this.pending = Math.min(MAX_STEPS, this.pending + steps);
    } else {
      // Slow detents respond immediately. A rapid spin keeps its distance but
      // sends one combined selection change per display frame.
      this.schedule();
      this.onSteps(steps * direction);
    }
    return true;
  };

  root.LGXMBWheelNavigation = WheelNavigation;
  if (typeof module === 'object' && module.exports) module.exports = WheelNavigation;
})(typeof window !== 'undefined' ? window : globalThis);
