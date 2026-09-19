/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  function AppRefresh(options) {
    this.options = options;
    this.active = false;
    this.destroyed = false;
    this.timer = null;
    this.request = null;
    this.pending = null;
    this.generation = 0;
    this.nextRead = 0;
    this.lastAttempt = -Infinity;
    this.lastSuccess = null;
    this.reads = 0;
    this.updates = 0;
    this.error = null;
    this.now =
      options.now ||
      function () {
        return root.performance.now();
      };
    this.setTimer = options.setTimeout || root.setTimeout.bind(root);
    this.clearTimer = options.clearTimeout || root.clearTimeout.bind(root);
  }
  AppRefresh.prototype.schedule = function (delay) {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    if (!this.active || this.destroyed) return;
    var self = this;
    this.timer = this.setTimer(function () {
      self.timer = null;
      self.pump();
    }, delay);
  };
  AppRefresh.prototype.pump = function () {
    if (!this.active || this.destroyed) return;
    // No reconciliation while a key is held, a launch is pending, a dialog is
    // open, or rows are moving. A result can wait without changing selection.
    if (!this.options.canApply()) {
      this.schedule(500);
      return;
    }
    if (this.pending) {
      var snapshot = this.pending;
      this.pending = null;
      try {
        if (this.options.apply(snapshot)) this.updates++;
        this.error = null;
      } catch (error) {
        this.error = error.message || 'Could not refresh apps.';
      }
    }
    if (this.request) return;
    var now = this.now(),
      due = Math.max(this.nextRead, this.lastAttempt + 2000);
    if (now < due) {
      this.schedule(Math.max(1, due - now));
      return;
    }
    this.lastAttempt = now;
    this.reads++;
    var self = this,
      generation = this.generation,
      read;
    try {
      read = this.options.read();
      if (!read || typeof read.then !== 'function')
        throw new Error('App enumeration is unavailable.');
    } catch (error) {
      this.error = error.message;
      this.nextRead = this.now() + 30000;
      this.schedule(30000);
      return;
    }
    this.request = read;
    Promise.resolve(read)
      .then(function (result) {
        if (!self.active || generation !== self.generation || self.request !== read) return;
        if (result && result.preview === true) return;
        if (!result || !Array.isArray(result.apps) || result.apps.length > 1000)
          throw new Error('The TV did not return a complete application list.');
        self.pending = result.apps;
        self.lastSuccess = self.now();
        self.error = null;
      })
      .catch(function (error) {
        if (self.active && generation === self.generation && self.request === read)
          self.error = error.message || 'App enumeration failed.';
      })
      .then(function () {
        if (!self.active || generation !== self.generation || self.request !== read) return;
        self.request = null;
        self.nextRead = self.now() + 30000;
        self.schedule(self.pending ? 0 : 30000);
      });
  };
  AppRefresh.prototype.refresh = function () {
    if (!this.active || this.destroyed) return;
    this.nextRead = this.now();
    if (!this.request) this.schedule(0);
  };
  AppRefresh.prototype.resume = function () {
    if (this.destroyed) return;
    this.active = true;
    this.refresh();
  };
  AppRefresh.prototype.invalidate = function () {
    this.generation++;
    this.pending = null;
    var read = this.request;
    this.request = null;
    if (read && typeof read.cancel === 'function') {
      try {
        read.cancel();
      } catch (ignore) {}
    }
    this.refresh();
  };
  AppRefresh.prototype.pause = function () {
    this.active = false;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.invalidate();
  };
  AppRefresh.prototype.getState = function () {
    return {
      active: this.active,
      reading: !!this.request,
      pending: !!this.pending,
      reads: this.reads,
      updates: this.updates,
      lastSuccess: this.lastSuccess,
      error: this.error,
      intervalMs: 30000
    };
  };
  AppRefresh.prototype.destroy = function () {
    this.pause();
    this.destroyed = true;
  };
  root.LGXMBAppRefresh = AppRefresh;
  if (typeof module === 'object' && module.exports) module.exports = AppRefresh;
})(typeof window !== 'undefined' ? window : globalThis);
