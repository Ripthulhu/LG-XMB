/* lg-xmb web application, 2026. SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';

  // Color-only offscreen MSAA, not canvas antialiasing. Resolve at the same
  // dimensions into RGBA8 before the separate supersampling/softness filter.
  function create(gl) {
    var available = [], probeError = null, renderbuffer = null, framebuffer = null;
    var width = 0, height = 0, samples = 0, requested = 0, key = null, failure = null, dead = false;
    var isWebGL2 = typeof gl.RGBA8 === 'number' && typeof gl.blitFramebuffer === 'function' &&
      typeof gl.renderbufferStorageMultisample === 'function' && typeof gl.getInternalformatParameter === 'function';
    var limit = 0;
    if (isWebGL2) {
      try {
        var counts = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA8, gl.SAMPLES);
        limit = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
        // The C5's Mali-G52 advertises RGBA8 sample counts above its own
        // MAX_SAMPLES: the list reads 16, 8, 4 while the limit is 4, and asking
        // for 16 or 8 fails with INVALID_VALUE and an incomplete framebuffer.
        // Clamp to MAX_SAMPLES so the reported list only holds counts that can
        // actually be allocated.
        var maxSamples = gl.getParameter(gl.MAX_SAMPLES);
        if (gl.getError() !== gl.NO_ERROR || !counts || !Number.isFinite(limit) ||
            !Number.isFinite(maxSamples)) throw new Error('Sample query refused');
        available = Array.prototype.filter.call(counts, function (n) {
          return Number.isInteger(n) && n > 1 && n <= 32 && n <= maxSamples;
        });
        available = available.filter(function (n, i, list) { return list.indexOf(n) === i; }).sort(function (a, b) { return b - a; });
      } catch (ignore) { probeError = 'MSAA capability query failed'; }
    }
    function release(lost) {
      if (!lost) {
        if (framebuffer) gl.deleteFramebuffer(framebuffer);
        if (renderbuffer) gl.deleteRenderbuffer(renderbuffer);
      }
      framebuffer = null; renderbuffer = null; width = 0; height = 0; samples = 0;
    }
    function prepare(value, w, h) {
      if (dead) return false;
      if ([0, 2, 4].indexOf(value) < 0 || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
        throw new RangeError('Invalid MSAA request');
      }
      var next = w + 'x' + h + '@' + value;
      if (next === key) return samples > 1;
      release(false); key = next; requested = value; failure = null;
      if (!value) return false;
      if (!isWebGL2) { failure = 'WebGL 2 unavailable'; return false; }
      if (probeError) { failure = probeError; return false; }
      if (w > limit || h > limit) { failure = 'MSAA renderbuffer size limit'; return false; }
      // Never silently round UP: that could cost more than the chosen setting.
      var candidates = available.filter(function (n) { return n <= value; });
      if (!candidates.length) { failure = 'Requested sample count unsupported'; return false; }
      for (var i = 0; i < candidates.length; i++) {
        var n = candidates[i], rb = null, fb = null, valid = false;
        try {
          rb = gl.createRenderbuffer(); fb = gl.createFramebuffer();
          if (!rb || !fb) throw new Error('No MSAA storage');
          gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
          gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, gl.RGBA8, w, h);
          var error = gl.getError();
          if (error === gl.NO_ERROR) {
            // Some drivers round storage sample counts; report/use only what was checked.
            var actual = gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_SAMPLES);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
            valid = actual === n && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE &&
              gl.getError() === gl.NO_ERROR;
          }
        } catch (ignore) { valid = false; }
        finally {
          gl.bindRenderbuffer(gl.RENDERBUFFER, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Reset both READ and DRAW bindings.
          if (!valid) {
            if (fb) gl.deleteFramebuffer(fb);
            if (rb) gl.deleteRenderbuffer(rb);
          }
        }
        if (valid) {
          renderbuffer = rb; framebuffer = fb; width = w; height = h; samples = n;
          if (n !== value) failure = failure || 'Using supported lower sample count';
          return true;
        }
        failure = 'MSAA allocation refused';
        if (gl.isContextLost()) break;
      }
      return false;
    }
    function resolve(destination) {
      if (dead || !framebuffer) return false;
      var valid = false;
      try {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination);
        gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        valid = gl.getError() === gl.NO_ERROR;
      } catch (ignore) { valid = false; }
      finally { gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
      if (!valid) {
        release(!!gl.isContextLost());
        failure = 'MSAA resolve refused'; // Cached until the request changes: no per-frame retries.
      }
      return valid;
    }
    return {
      prepare: prepare, resolve: resolve, target: function () { return framebuffer; },
      diagnostics: function () { return {supported: available.slice(), requested: requested, samples: samples,
        failure: failure, width: width, height: height, bytes: width * height * 4 * samples}; },
      destroy: function (lost) { if (!dead) { release(lost); dead = true; } }
    };
  }
  root.LGXMBWaveMSAA = Object.freeze({create: create});
})(window);
