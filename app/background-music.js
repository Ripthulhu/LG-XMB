/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (global) {
  'use strict';

  // One streamed audio element, not a decoded, whole-track Web Audio buffer.
  // webOS shares native media resources: release it before a video or app launch.
  // Prepared by helper setup; the recording stays outside the installed app.
  var TRACK = 'user-music.mp3';
  var VOLUMES = [0.1, 0.25, 0.5, 0.75, 1];

  function BackgroundMusic(options) {
    options = options || {};
    this.document = options.document || global.document;
    this.setTimer = options.setTimeout || global.setTimeout.bind(global);
    this.clearTimer = options.clearTimeout || global.clearTimeout.bind(global);
    this.onChange = options.onChange || function () {};
    this.enabled = options.enabled === true;
    this.volume = VOLUMES.indexOf(options.volume) !== -1 ? options.volume : 0.25;
    this.active = false;
    this.preview = false;
    this.audio = null;
    this.listeners = [];
    this.generation = 0;
    this.position = 0;
    this.pending = false;
    this.failed = false;
    this.blocked = false;
    this.destroyed = false;
    this.timer = null;
    this.retryTimer = null;
    this.retries = 0;
    this.contextAllowed = false;
    this.failure = null;
    this.phase = this.enabled ? 'suspended' : 'off';
  }

  BackgroundMusic.prototype.getState = function () {
    return {
      enabled: this.enabled,
      volume: this.volume,
      phase: this.phase,
      failure: this.failure,
      generation: this.generation
    };
  };
  BackgroundMusic.prototype.report = function (phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.onChange(this.getState());
  };
  BackgroundMusic.prototype.allowed = function () {
    return !this.destroyed && this.enabled && this.active && !this.preview && !this.document.hidden;
  };
  BackgroundMusic.prototype.cancelTimer = function () {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  };
  BackgroundMusic.prototype.release = function (remember) {
    this.generation++;
    this.pending = false;
    this.cancelTimer();
    if (this.retryTimer !== null) this.clearTimer(this.retryTimer);
    this.retryTimer = null;
    var audio = this.audio;
    this.audio = null;
    this.listeners.forEach(function (entry) {
      entry[0].removeEventListener(entry[1], entry[2]);
    });
    this.listeners = [];
    if (!audio) return;
    if (remember && Number.isFinite(audio.currentTime) && audio.currentTime > 0)
      this.position = audio.currentTime;
    // Invalidate events/promises before load() can raise an abort or media error.
    try {
      audio.pause();
    } catch (ignore) {}
    try {
      audio.removeAttribute('src');
      audio.load();
    } catch (ignore) {}
    if (audio.parentNode) audio.parentNode.removeChild(audio);
  };
  BackgroundMusic.prototype.sync = function () {
    if (this.destroyed) return;
    if (!this.allowed()) {
      this.release(true);
      this.report(
        !this.enabled ? 'off' : !this.active || this.document.hidden ? 'suspended' : 'preview'
      );
      return;
    }
    if (this.retryTimer !== null) return;
    if (this.failed) {
      this.report('unavailable');
      return;
    }
    if (this.blocked) {
      this.report('blocked');
      return;
    }
    if (!this.audio) this.start();
  };
  BackgroundMusic.prototype.start = function () {
    if (!this.allowed() || this.audio || this.pending) return;
    var self = this,
      audio;
    try {
      audio = this.document.createElement('audio');
    } catch (ignore) {
      this.failed = true;
      this.report('unavailable');
      return;
    }
    this.audio = audio;
    var generation = ++this.generation;
    function current() {
      return !self.destroyed && self.audio === audio && self.generation === generation;
    }
    function listen(event, callback) {
      audio.addEventListener(event, callback);
      self.listeners.push([audio, event, callback]);
    }
    listen('loadedmetadata', function () {
      if (!current() || !self.allowed()) return;
      if (self.position > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
        try {
          audio.currentTime = self.position % audio.duration;
        } catch (ignore) {}
      }
    });
    listen('playing', function () {
      if (!current()) return;
      if (!self.allowed()) {
        self.sync();
        return;
      }
      self.cancelTimer();
      self.pending = false;
      self.blocked = false;
      self.report('playing');
    });
    listen('error', function () {
      if (current()) self.fail('media', audio.error);
    });
    // If native resource arbitration stops us, wait for explicit retry rather
    // than repeatedly fighting another player for audio focus.
    listen('pause', function () {
      if (current() && self.allowed() && !self.pending) {
        self.failure = { kind: 'interrupted' };
        self.release(true);
        self.blocked = true;
        self.report('blocked');
      }
    });
    try {
      audio.loop = true;
      audio.autoplay = false;
      audio.preload = 'none';
      audio.volume = this.volume;
      audio.hidden = true;
      audio.setAttribute('aria-hidden', 'true');
      audio.tabIndex = -1;
      this.document.body.appendChild(audio);
      audio.src = TRACK;
      this.play();
    } catch (ignore) {
      if (current()) this.fail();
    }
  };
  BackgroundMusic.prototype.fail = function (kind, error) {
    var code = (error && Number(error.code)) || 0;
    this.failure = {
      kind: kind || 'player',
      code: code,
      name: error && typeof error.name === 'string' ? error.name.slice(0, 80) : ''
    };
    this.failed = true;
    this.blocked = false;
    this.release(true);
    // One delayed retry per foreground visit for transient startup failures.
    // Decode/format errors and focus loss never compete in a timer loop.
    var transient =
      kind === 'timeout' ||
      (kind === 'media' && (code === 1 || code === 2)) ||
      (kind === 'play' && this.failure.name === 'AbortError');
    if (transient && this.allowed() && this.retries < 1) {
      this.retries++;
      var self = this,
        generation = this.generation;
      this.retryTimer = this.setTimer(function () {
        if (self.generation !== generation || !self.allowed()) return;
        self.retryTimer = null;
        self.failed = false;
        self.sync();
      }, 2000);
      this.report('recovering');
      return;
    }
    this.report('unavailable');
  };
  BackgroundMusic.prototype.play = function () {
    if (!this.allowed() || !this.audio || this.pending) return;
    var self = this,
      audio = this.audio,
      generation = this.generation;
    this.pending = true;
    this.report('loading');
    function current() {
      return !self.destroyed && self.audio === audio && self.generation === generation;
    }
    function rejected(error) {
      if (!current()) return;
      if (error && error.name === 'NotAllowedError') {
        self.failure = { kind: 'policy' };
        self.release(true);
        self.blocked = true;
        self.report('blocked');
      } else self.fail('play', error);
    }
    this.cancelTimer();
    this.timer = this.setTimer(function () {
      if (current()) self.fail('timeout');
    }, 15000);
    try {
      var result = audio.play();
      if (result && typeof result.then === 'function')
        result.then(function () {
          if (!current()) return;
          if (!self.allowed()) {
            self.sync();
            return;
          }
          self.pending = false;
          self.cancelTimer();
          self.report('playing');
        }, rejected);
      // Older media implementations return no promise; their playing/error
      // events (or the bounded startup deadline) determine the visible state.
    } catch (error) {
      rejected(error);
    }
  };
  BackgroundMusic.prototype.setEnabled = function (enabled) {
    if (this.destroyed || typeof enabled !== 'boolean' || this.enabled === enabled) return;
    this.enabled = enabled;
    this.retries = 0;
    this.failure = null;
    this.failed = this.blocked = false;
    if (!enabled) {
      this.release(false);
      this.position = 0;
    }
    this.sync();
  };
  BackgroundMusic.prototype.setVolume = function (volume) {
    if (this.destroyed || VOLUMES.indexOf(volume) === -1) return;
    this.volume = volume;
    if (this.audio) {
      try {
        this.audio.volume = volume;
      } catch (ignore) {
        this.fail();
      }
    }
  };
  BackgroundMusic.prototype.setContext = function (active, preview) {
    if (this.destroyed) return;
    this.active = active === true;
    this.preview = preview === true;
    var allowed = this.allowed();
    if (allowed && !this.contextAllowed) {
      this.retries = 0;
      this.failed = false;
      // Preserve autoplay policy. A new foreground visit may retry a player
      // that lost native resources, including errors misreported as format loss.
      if (!this.failure || this.failure.kind !== 'policy') this.blocked = false;
    }
    this.contextAllowed = allowed;
    this.sync();
  };
  BackgroundMusic.prototype.gesture = function (event) {
    if (event && event.isTrusted && !event.repeat && this.blocked && this.allowed()) {
      this.blocked = false;
      this.sync();
    }
  };
  BackgroundMusic.prototype.retry = function () {
    if (!this.allowed()) return;
    // Explicit retry also picks up a replacement track from its beginning.
    this.release(false);
    this.position = 0;
    this.retries = 0;
    this.failure = null;
    this.failed = this.blocked = false;
    this.sync();
  };
  BackgroundMusic.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    this.release(false);
    this.position = 0;
  };
  global.LGXMBBackgroundMusic = BackgroundMusic;
})(typeof window !== 'undefined' ? window : globalThis);
