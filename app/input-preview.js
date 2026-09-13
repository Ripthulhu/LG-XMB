/* OpenXMB C5 input preview. SPDX-License-Identifier: GPL-3.0-or-later
 * Native source syntax: Informatic's webOS input-embedding research,
 * https://gist.github.com/Informatic/1983f2e501444cf1cbd182e50820d6c1
 * One app-owned media element and one bounded read of its video status.
 * No capture, video-plane setters or permission changes.
 */
(function (root) {
  'use strict';

  function C5InputPreview(slot, options) {
    options = options || {};
    this.slot = slot;
    this.media = slot.querySelector('.input-preview-media');
    this.placeholder = slot.querySelector('.input-preview-placeholder');
    this.message = slot.querySelector('.input-preview-message') || this.placeholder;
    this.document = options.document || root.document;
    this.isTV = options.isTV || function () { return false; };
    this.getInputStatus = options.getInputStatus || (root.C5TV &&
      typeof root.C5TV.getInputPreviewStatus === 'function' ? function (port) {
        return root.C5TV.getInputPreviewStatus(port);
      } : null);
    this.setTimer = options.setTimeout || root.setTimeout.bind(root);
    this.clearTimer = options.clearTimeout || root.clearTimeout.bind(root);
    this.port = null;
    this.video = null;
    this.retiredVideo = null;
    this.retireTimer = null;
    this.retireGeneration = 0;
    this.status = 'idle';
    this.error = null;
    this.generation = 0;
    this.startTimer = null;
    this.loadTimer = null;
    this.signalTimer = null;
    this.signalRequest = null;
    this.listeners = [];
    this.destroyed = false;
    this.paint();
  }

  C5InputPreview.prototype.paint = function () {
    this.slot.hidden = this.status === 'idle';
    this.slot.setAttribute('data-status', this.status);
    this.placeholder.hidden = this.status === 'playing';
    this.message.textContent = this.status === 'unavailable' ? 'Preview unavailable' : '';
  };

  C5InputPreview.prototype.disposeVideo = function (video) {
    if (!video) return;
    try { video.pause(); } catch (ignore) {}
    try { video.removeAttribute('src'); } catch (ignore) {}
    while (video.firstChild) video.removeChild(video.firstChild);
    // webOS 3+ requires load() after removing sources to reset its pipeline.
    try { video.load(); } catch (ignore) {}
    if (video.parentNode) video.parentNode.removeChild(video);
  };

  C5InputPreview.prototype.flushRetired = function () {
    this.retireGeneration++;
    if (this.retireTimer !== null) this.clearTimer(this.retireTimer);
    this.retireTimer = null;
    var video = this.retiredVideo;
    this.retiredVideo = null;
    this.disposeVideo(video);
  };

  C5InputPreview.prototype.deferRetired = function () {
    if (this.retireTimer !== null) this.clearTimer(this.retireTimer);
    var self = this, generation = ++this.retireGeneration, video = this.retiredVideo;
    this.retireTimer = this.setTimer(function () {
      if (generation !== self.retireGeneration || video !== self.retiredVideo) return;
      self.flushRetired();
    }, 400);
  };

  C5InputPreview.prototype.release = function (defer) {
    // Invalidate callbacks before load() can synchronously raise an abort/error.
    this.generation++;
    if (this.startTimer !== null) this.clearTimer(this.startTimer);
    if (this.loadTimer !== null) this.clearTimer(this.loadTimer);
    if (this.signalTimer !== null) this.clearTimer(this.signalTimer);
    this.startTimer = this.loadTimer = this.signalTimer = null;
    var request = this.signalRequest;
    this.signalRequest = null;
    if (request && typeof request.cancel === 'function') {
      try { request.cancel(); } catch (ignore) {}
    }
    this.listeners.forEach(function (entry) {
      entry[0].removeEventListener(entry[1], entry[2]);
    });
    this.listeners = [];
    var video = this.video;
    this.video = null;
    if (video && defer) {
      // Hide now, but keep expensive native unload outside navigation animation.
      if (this.retiredVideo && this.retiredVideo !== video) this.flushRetired();
      video.hidden = true;
      this.retiredVideo = video;
    } else this.disposeVideo(video);
    if (defer && this.retiredVideo) this.deferRetired();
    else this.flushRetired();
  };

  C5InputPreview.prototype.stop = function () {
    this.release();
    this.port = null;
    this.error = null;
    this.status = 'idle';
    this.paint();
  };

  C5InputPreview.prototype.select = function (port) {
    if (this.destroyed) return;
    if (this.document.hidden) {
      this.stop();
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 4) port = null;
    // Re-renders must not retry failed inputs or continually reset the debounce.
    if (port !== null && this.port === port) return;
    this.release(true);
    this.port = port;
    this.error = null;
    if (port === null) { this.status = 'idle'; this.paint(); return; }
    this.status = this.isTV() ? 'waiting' : 'desktop';
    this.paint();
    if (this.status === 'desktop') return;
    var self = this, generation = this.generation;
    this.startTimer = this.setTimer(function () {
      if (generation !== self.generation || self.destroyed) return;
      self.startTimer = null;
      if (self.document.hidden || !self.isTV()) { self.stop(); return; }
      self.start(generation);
    }, this.retiredVideo ? 650 : 400);
  };

  C5InputPreview.prototype.start = function (generation) {
    // Even a delayed cleanup callback cannot leave two native inputs allocated.
    this.flushRetired();
    var self = this, video = this.document.createElement('video');
    this.video = video;
    this.status = 'loading';
    this.paint();
    function current() {
      return !self.destroyed && self.generation === generation && self.video === video;
    }
    function fail(reason) {
      if (!current()) return;
      self.release();
      self.status = 'unavailable';
      self.error = reason;
      self.paint();
    }
    function ready() {
      if (!current()) return;
      if (self.loadTimer !== null) self.clearTimer(self.loadTimer);
      self.loadTimer = null;
      self.status = 'playing';
      self.paint();
    }
    function listen(target, event, handler) {
      target.addEventListener(event, handler);
      self.listeners.push([target, event, handler]);
    }
    // Set silence before attaching a native source, including autoplay startup.
    video.defaultMuted = true;
    video.muted = true;
    video.volume = 0;
    video.autoplay = true;
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    var source = this.document.createElement('source');
    source.setAttribute('type', 'service/webos-external');
    source.setAttribute('src', 'ext://hdmi:' + this.port);
    listen(source, 'error', function () { fail('source-error'); });
    listen(video, 'error', function () {
      fail('media-error:' + (video.error && video.error.code || 'unknown'));
    });
    ['loadeddata', 'canplay', 'playing'].forEach(function (event) { listen(video, event, ready); });
    // Native HDMI may emit stalled while showing a picture; currentTime stays 0.
    // Neither is a failure signal. Initial loading has a bounded deadline.
    this.loadTimer = this.setTimer(function () {
      if (!current()) return;
      if (video.readyState >= 2) ready();
      else fail('load-timeout');
    }, 8000);
    // A disconnected HDMI can still emit playing/readyState 4. Check once after
    // startup settles; lack of permission/data is not evidence of no picture.
    if (this.getInputStatus) {
      this.signalTimer = this.setTimer(function () {
        if (!current()) return;
        self.signalTimer = null;
        try {
          var request = self.getInputStatus(self.port);
          if (!request || typeof request.then !== 'function') return;
          self.signalRequest = request;
          request.then(function (result) {
            if (!current() || self.signalRequest !== request) return;
            self.signalRequest = null;
            if (result && result.port === self.port && result.signal === false) fail('no-signal');
          }, function () {
            if (current() && self.signalRequest === request) self.signalRequest = null;
          });
        } catch (ignore) {
          self.signalRequest = null;
        }
      }, 8000);
    }
    try {
      video.appendChild(source);
      this.media.appendChild(video);
      var play = video.play();
      if (play && typeof play.catch === 'function') {
        play.catch(function (problem) {
          fail('play-rejected:' + (problem && problem.name || 'unknown'));
        });
      }
    } catch (problem) {
      fail('play-failed:' + (problem && problem.name || 'unknown'));
    }
  };

  C5InputPreview.prototype.getState = function () {
    var video = this.video;
    return {
      status: this.status,
      port: this.port,
      error: this.error,
      retiring: !!this.retiredVideo,
      video: video ? {
        readyState: video.readyState,
        networkState: video.networkState,
        paused: video.paused,
        muted: video.muted,
        currentTime: video.currentTime
      } : null
    };
  };

  C5InputPreview.prototype.destroy = function () {
    this.stop();
    this.destroyed = true;
  };

  root.C5InputPreview = C5InputPreview;
}(typeof window !== 'undefined' ? window : globalThis));
