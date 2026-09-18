/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  function Hold(options) {
    options = options || {};
    this.setTimer = options.setTimeout || root.setTimeout.bind(root);
    this.clearTimer = options.clearTimeout || root.clearTimeout.bind(root);
    this.delay = 650;
    this.state = null;
    this.generation = 0;
  }
  Hold.prototype.down = function (key, tap, held) {
    if (this.state) return false;
    var self = this, generation = ++this.generation;
    var s = this.state = {key: key, tap: tap, held: false, timer: null};
    s.timer = this.setTimer(function () {
      if (self.state !== s || self.generation !== generation) return;
      s.timer = null; s.held = true; held();
    }, this.delay);
    return true;
  };
  Hold.prototype.up = function (key) {
    var s = this.state;
    if (!s || s.key !== key) return false;
    this.cancel();
    if (!s.held) s.tap();
    return true;
  };
  Hold.prototype.cancel = function () {
    this.generation++;
    if (this.state && this.state.timer !== null) this.clearTimer(this.state.timer);
    this.state = null;
  };
  root.LGXMBHoldGesture = Hold;
  if (typeof module === 'object' && module.exports) module.exports = Hold;
})(typeof window !== 'undefined' ? window : globalThis);
