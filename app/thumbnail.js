/* Cached HDMI stills only. SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';

  function C5Thumbnail(image, fallback, options) {
    options = options || {};
    this.image = image;
    this.fallback = fallback;
    this.document = options.document || root.document;
    this.isTV =
      options.isTV ||
      function () {
        return false;
      };
    this.createImage =
      options.createImage ||
      function () {
        return new root.Image();
      };
    this.setTimer = options.setTimeout || root.setTimeout.bind(root);
    this.clearTimer = options.clearTimeout || root.clearTimeout.bind(root);
    this.now = options.now || Date.now;
    this.port = null;
    this.status = 'idle';
    this.paused = false;
    this.destroyed = false;
    this.hasStill = false;
    this.generation = 0;
    this.stamp = -1;
    this.pending = null;
    this.loadTimer = null;
    this.refreshTimer = null;
    this.clearStill();
  }

  C5Thumbnail.prototype.clearStill = function () {
    this.image.removeAttribute('src');
    this.image.hidden = true;
    this.fallback.hidden = false;
    this.hasStill = false;
  };

  C5Thumbnail.prototype.clearPending = function () {
    if (this.loadTimer !== null) this.clearTimer(this.loadTimer);
    this.loadTimer = null;
    var pending = this.pending;
    this.pending = null;
    if (!pending) return;
    pending.onload = pending.onerror = null;
    pending.removeAttribute('src');
  };

  C5Thumbnail.prototype.cancel = function () {
    // Invalidate before resetting an Image, which can dispatch an error.
    this.generation++;
    if (this.refreshTimer !== null) this.clearTimer(this.refreshTimer);
    this.refreshTimer = null;
    this.clearPending();
  };

  C5Thumbnail.prototype.schedule = function () {
    if (this.destroyed || this.paused || this.port === null || this.document.hidden || !this.isTV())
      return;
    var self = this,
      generation = this.generation;
    this.refreshTimer = this.setTimer(function () {
      if (self.destroyed || generation !== self.generation) return;
      self.refreshTimer = null;
      self.refresh();
    }, 60000);
  };

  C5Thumbnail.prototype.select = function (port) {
    if (this.destroyed) return;
    if (!Number.isInteger(port) || port < 1 || port > 4) port = null;
    var changed = this.port !== port;
    if (changed || port === null) {
      this.cancel();
      this.clearStill();
      this.port = port;
      this.status = 'idle';
    }
    if (port === null) return;
    if (this.document.hidden) {
      this.cancel();
      this.status = this.hasStill ? 'ready' : 'idle';
      return;
    }
    if (!this.isTV()) {
      this.cancel();
      this.clearStill();
      this.status = 'desktop';
      return;
    }
    if (this.paused || (!changed && this.status !== 'idle')) return;
    this.refresh();
  };

  C5Thumbnail.prototype.refresh = function () {
    if (this.destroyed) return;
    this.cancel();
    if (this.port === null) {
      this.clearStill();
      this.status = 'idle';
      return;
    }
    if (this.document.hidden) {
      this.status = this.hasStill ? 'ready' : 'idle';
      return;
    }
    if (!this.isTV()) {
      this.clearStill();
      this.status = 'desktop';
      return;
    }
    if (this.paused) {
      this.status = this.hasStill ? 'ready' : 'idle';
      return;
    }
    var self = this,
      generation = this.generation;
    var timestamp = Math.floor(Number(this.now()));
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) timestamp = 0;
    this.stamp = Math.max(this.stamp + 1, timestamp);
    var src = 'thumbnails/hdmi' + this.port + '.png?t=' + this.stamp;
    var pending;
    this.status = 'loading';
    function finish(loaded) {
      if (self.destroyed || generation !== self.generation || self.pending !== pending) return;
      if (self.document.hidden) {
        self.cancel();
        self.status = self.hasStill ? 'ready' : 'idle';
        return;
      }
      self.clearPending();
      if (loaded) {
        self.image.src = src;
        self.image.hidden = false;
        self.fallback.hidden = true;
        self.hasStill = true;
        self.status = 'ready';
      } else {
        if (!self.hasStill) self.clearStill();
        self.status = self.hasStill ? 'ready' : 'missing';
      }
      self.schedule();
    }
    try {
      pending = this.createImage();
      this.pending = pending;
      pending.onload = function () {
        finish(true);
      };
      pending.onerror = function () {
        finish(false);
      };
      this.loadTimer = this.setTimer(function () {
        finish(false);
      }, 5000);
      pending.src = src;
    } catch (ignore) {
      // Missing files and unavailable image loaders have the same quiet fallback.
      if (generation === this.generation) {
        this.clearPending();
        if (!this.hasStill) this.clearStill();
        this.status = this.hasStill ? 'ready' : 'missing';
        this.schedule();
      }
    }
  };

  C5Thumbnail.prototype.setPaused = function (paused) {
    if (this.destroyed) return;
    paused = Boolean(paused);
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) {
      this.refresh();
      return;
    }
    this.cancel();
    this.status = this.hasStill ? 'ready' : 'idle';
  };

  C5Thumbnail.prototype.getState = function () {
    return { port: this.port, status: this.status };
  };

  C5Thumbnail.prototype.destroy = function () {
    this.destroyed = true;
    this.cancel();
    this.clearStill();
    this.port = null;
    this.status = 'idle';
  };

  root.C5Thumbnail = C5Thumbnail;
})(typeof window !== 'undefined' ? window : globalThis);
