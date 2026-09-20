/* SPDX-License-Identifier: GPL-3.0-or-later */
// Idle timing only. The launcher handles input and CSS handles the fades.
(function (root) {
  'use strict';
  function Screensaver(options) {
    options = options || {};
    this.now =
      options.now ||
      function () {
        return typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      };
    this.setTimer =
      options.setTimer ||
      function (callback, delay) {
        return setTimeout(callback, delay);
      };
    this.clearTimer =
      options.clearTimer ||
      function (timer) {
        clearTimeout(timer);
      };
    this.onChange = options.onChange || function () {};
    this.delayMs = 120000;
    this.brightness = 0.25;
    this.available = false;
    this.active = false;
    this.lastActivity = this.now();
    this.timer = null;
    this.generation = 0;
    this.destroyed = false;
  }
  Screensaver.prototype.getState = function () {
    return {
      active: this.active,
      delayMs: this.delayMs,
      brightness: this.brightness,
      available: this.available
    };
  };
  Screensaver.prototype.cancelTimer = function () {
    this.generation++;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  };
  Screensaver.prototype.arm = function (remaining) {
    if (this.destroyed || !this.available || this.active || !this.delayMs || this.timer !== null)
      return;
    var self = this,
      generation = ++this.generation;
    this.timer = this.setTimer(function () {
      if (self.destroyed || generation !== self.generation) return;
      self.generation++;
      self.timer = null;
      var remaining = self.lastActivity + self.delayMs - self.now();
      if (remaining > 0) self.arm(remaining);
      else {
        self.active = true;
        self.onChange(self.getState());
      }
    }, remaining);
  };
  Screensaver.prototype.configure = function (settings) {
    if (this.destroyed) return;
    settings = settings || {};
    var wasActive = this.active,
      oldBrightness = this.brightness,
      delay = settings.delayMs;
    if (typeof delay === 'number' && isFinite(delay) && delay >= 0) {
      // Browser timers cannot safely represent a longer interval.
      delay = Math.min(2147483647, Math.floor(delay));
      if (delay !== this.delayMs) {
        this.cancelTimer();
        this.delayMs = delay;
        this.lastActivity = this.now();
        this.active = false;
        this.arm(delay);
      }
    }
    if (typeof settings.brightness === 'number' && isFinite(settings.brightness))
      this.brightness = Math.max(0, Math.min(1, settings.brightness));
    if (wasActive !== this.active || oldBrightness !== this.brightness)
      this.onChange(this.getState());
  };
  Screensaver.prototype.setAvailable = function (available) {
    if (this.destroyed || this.available === (available === true)) return;
    this.available = available === true;
    this.cancelTimer();
    this.lastActivity = this.now();
    var wasActive = this.active;
    this.active = false;
    this.arm(this.delayMs);
    if (wasActive) this.onChange(this.getState());
  };
  Screensaver.prototype.activity = function () {
    if (this.destroyed) return false;
    var wasActive = this.active;
    this.active = false;
    this.lastActivity = this.now();
    // Pointer events only move the deadline. Re-arm when the current timer expires.
    this.arm(this.delayMs);
    if (wasActive) this.onChange(this.getState());
    return wasActive;
  };
  Screensaver.prototype.preview = function () {
    if (this.destroyed || !this.available) return false;
    this.cancelTimer();
    if (!this.active) {
      this.active = true;
      this.onChange(this.getState());
    }
    return true;
  };
  Screensaver.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelTimer();
    this.available = false;
    var wasActive = this.active;
    this.active = false;
    if (wasActive) this.onChange(this.getState());
  };
  root.LGXMBScreensaver = Screensaver;
  if (typeof module === 'object' && module.exports) module.exports = Screensaver;
})(typeof window !== 'undefined' ? window : globalThis);
