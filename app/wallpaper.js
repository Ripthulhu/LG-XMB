/* SPDX-License-Identifier: GPL-3.0-or-later */
// A local, optional image. Keep the previous background until its replacement loads.
(function (root) {
  'use strict';
  function Wallpaper(image, options) {
    options = options || {};
    this.image = image;
    this.createImage =
      options.createImage ||
      function () {
        return new Image();
      };
    this.onChange = options.onChange || function () {};
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
    this.active = false;
    this.enabled = false;
    this.loading = false;
    this.error = '';
    this.generation = 0;
    this.pending = null;
    this.cancelLoad = null;
    this.destroyed = false;
  }
  Wallpaper.prototype.setBrightness = function (gain) {
    if (typeof gain === 'number' && gain >= 0.3 && gain <= 1)
      this.image.style.opacity = String(gain);
  };
  Wallpaper.prototype.setEnabled = function (enabled, reload) {
    if (this.destroyed) return Promise.resolve(false);
    enabled = enabled === true;
    if (!reload && this.enabled === enabled) return this.pending || Promise.resolve(this.active);
    this.enabled = enabled;
    this.generation++;
    if (this.cancelLoad) this.cancelLoad();
    this.error = '';
    if (!enabled) {
      this.active = false;
      this.image.hidden = true;
      this.image.removeAttribute('src');
      this.onChange();
      return Promise.resolve(false);
    }
    var self = this,
      generation = this.generation,
      probe = this.createImage();
    this.loading = true;
    this.pending = new Promise(function (resolve) {
      var settled = false;
      function finish(success, cancelled) {
        if (settled) return;
        settled = true;
        self.clearTimer(timer);
        probe.onload = probe.onerror = null;
        self.cancelLoad = null;
        self.pending = null;
        self.loading = false;
        if (!cancelled && !self.destroyed && generation === self.generation) {
          if (success) {
            self.image.src = probe.src;
            self.image.hidden = false;
            self.active = true;
          } else {
            self.error = 'Wallpaper is missing or unreadable.';
          }
          self.onChange();
        }
        resolve(success && !cancelled);
      }
      var timer = self.setTimer(function () {
        finish(false);
      }, 8000);
      self.cancelLoad = function () {
        finish(false, true);
      };
      probe.onload = function () {
        finish(probe.naturalWidth > 0 && probe.naturalHeight > 0);
      };
      probe.onerror = function () {
        finish(false);
      };
      probe.src = 'user-wallpaper.jpg?v=' + Date.now() + '-' + generation;
    });
    this.onChange();
    return this.pending;
  };
  Wallpaper.prototype.reload = function () {
    return this.setEnabled(true, true);
  };
  Wallpaper.prototype.destroy = function () {
    if (this.destroyed) return;
    this.setEnabled(false);
    this.destroyed = true;
  };
  root.LGXMBWallpaper = Wallpaper;
  if (typeof module === 'object' && module.exports) module.exports = Wallpaper;
})(typeof window !== 'undefined' ? window : globalThis);
