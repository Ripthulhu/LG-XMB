/*
 * OpenXMB C5: the canvas, GL context and frame clock behind the spline wave.
 *
 * This file used to carry a WebGL and Canvas2D adaptation of OpenXMB's
 * shaders/original.frag, copyright (C) 2025-2026 Syndromatic Ltd., designed by
 * Kavish Krishnakumar in Manchester. That renderer was removed after 0.1.30;
 * the notice stays because the project still adapts other OpenXMB work, and
 * ../licenses/WAVE-PROVENANCE.md records what came from where.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation, either version 3, or (at your option) any later
 * version. This program comes WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the accompanying LICENSE and ../WAVE-PROVENANCE.md.
 */
(function (global) {
  'use strict';

  var VERTEX = [
    'attribute vec2 aPosition;',
    'varying vec2 vUV;',
    'void main() { vUV = (aPosition + 1.0) * 0.5;',
    'gl_Position = vec4(aPosition, 0.0, 1.0); }'
  ].join('\n');

  var colors = global.LGXMBWaveColors;

  function color(value, fallback) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
      return [parseInt(value.slice(1,3),16)/255, parseInt(value.slice(3,5),16)/255,
        parseInt(value.slice(5,7),16)/255];
    }
    if (Array.isArray(value) && value.length === 3 && value.every(function (x) {
      return typeof x === 'number' && isFinite(x) && x >= 0 && x <= 1;
    })) return value.slice();
    return fallback;
  }

  var QUALITY = [
    {name:'1080p',width:1920,height:1080},
    {name:'720p',width:1280,height:720},
    {name:'540p',width:960,height:540}
  ];
  // The clock is accumulated in double precision but reaches the shaders as a
  // float32 uniform, so its resolution falls as it grows. A frame advances the
  // clock by about 0.035; float32 steps by that much near 600,000, which a
  // resident launcher reaches after a few days of visible time, and motion
  // quantises well before then. The curves mix incommensurate frequencies, so
  // no wrap is seamless: wrap only while nothing is on screen. WRAP keeps the
  // step at 0.7% of a frame; CEILING is the backstop for a launcher that is
  // never hidden, where one imperceptible jump beats degrading indefinitely.
  var TIME_WRAP = 4096, TIME_CEILING = 131072;

  function nowMs() {
    return global.performance && global.performance.now ? global.performance.now() : Date.now();
  }

  function C5Wave(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('C5Wave requires a canvas');
    this.canvas = canvas;
    this.background = color('#08101c');
    this.wave = color('#518aab');
    this.palette = null;
    this.reducedMotion = false;
    this.paused = false;
    this.documentHidden = !!document.hidden;
    this.resizePending = false;
    this.destroyed = false;
    this.contextLost = false;
    this.time = 14;
    this.speed = 1;
    this.brightness = 1;
    this.lastFrame = 0;
    this.nextFrame = 0;
    this.raf = 0;
    this.initRaf = 0;
    this.compileRaf = 0;
    this.initialized = false;
    this.qualityIndex = options && options.quality === '720p' ? 1 : options && options.quality === '540p' ? 2 : 0;
    this.adaptive = !(options && options.adaptive === false);
    this.ps3Quality = {sampling:1,detail:'standard',softness:1.5,postprocess:'off',strength:'normal',particles:false,particleCount:2000,msaa:0};
    this.onRenderStatus = options && typeof options.onRenderStatus === 'function' ? options.onRenderStatus : null;
    this.ps3Surface = null;
    this.position = null;
    this.capabilities = null;
    this.qualityChanges = [];
    this.pendingShaders = null;
    this.parallelCompile = null;
    this.compileStarted = 0;
    this.compileMs = null;
    this.timing = {last:0,start:0,windowStart:0,samples:0,gaps:0,worst:0,badWindows:0,windows:0,lastGapRatio:0};
    this.mode = 'pending';
    this.error = null;
    this.contextVersion = 0;
    this.forceWebGL1 = !!(options && options.webglVersion === 1);
    this.gl = null;
    this.program = null;
    this.buffer = null;
    this.media = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reducedMotion = !!(this.media && this.media.matches);
    this._tickBound = this._tick.bind(this);
    this._visibilityBound = this._visibility.bind(this);
    this._resizeBound = this._resize.bind(this);
    this._motionBound = function (e) { this.setReducedMotion(e.matches); }.bind(this);
    this._lostBound = function (e) {
      e.preventDefault(); this.contextLost = true; this._cancel();
    }.bind(this);
    this._restoredBound = function () {
      if (this.destroyed) return;
      this.contextLost = false;
      if (this.ps3Surface) this.ps3Surface.destroy(true);
      this.ps3Surface = null;
      this.program = null; this.buffer = null;
      this.pendingShaders = null;
      this.initialized = false; this.mode = 'pending'; this._resume();
    }.bind(this);
    canvas.addEventListener('webglcontextlost', this._lostBound, false);
    canvas.addEventListener('webglcontextrestored', this._restoredBound, false);
    document.addEventListener('visibilitychange', this._visibilityBound, false);
    global.addEventListener('resize', this._resizeBound, false);
    if (this.media) {
      if (this.media.addEventListener) this.media.addEventListener('change', this._motionBound);
      else if (this.media.addListener) this.media.addListener(this._motionBound);
    }
    if (global.ResizeObserver) {
      this.observer = new global.ResizeObserver(this._resizeBound);
      this.observer.observe(canvas);
    }
    this._resize();
    this._resume();
  }

  C5Wave.prototype._scheduleInitialize = function () {
    if (this.initialized || this.initRaf || this.destroyed || this.paused || document.hidden) return;
    // Let the app finish building and paint its menu before any canvas setup.
    // WebGL never compiles in the constructor.
    this.initRaf = global.requestAnimationFrame(function () {
      this.initRaf = global.requestAnimationFrame(function () {
        this.initRaf = 0;
        if (this.destroyed || this.paused || document.hidden) return;
        this.initialized = true;
        this._initialize();
      }.bind(this));
    }.bind(this));
  };

  C5Wave.prototype._shader = function (type, source) {
    var gl = this.gl;
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    // Do not query COMPILE_STATUS here: it can synchronize the driver and
    // defeat KHR_parallel_shader_compile. Inspect errors after linking only.
    return shader;
  };

  C5Wave.prototype._initialize = function () {
    this.mode = 'static';
    // Keep the last complete frame while Home is paused. This does not
    // guarantee compositor retention; native performance is tested separately.
    var options = {alpha:false, antialias:false, depth:false, stencil:false,
      preserveDrawingBuffer:true, powerPreference:'high-performance'};
    var vertex = null;
    var fragment = null;
    try {
      if (!this.gl && !this.forceWebGL1) {
        try { this.gl = this.canvas.getContext('webgl2', options); } catch (ignore) {}
        if (this.gl) this.contextVersion = 2;
      }
      if (!this.gl) {
        this.gl = this.canvas.getContext('webgl', options) || this.canvas.getContext('experimental-webgl', options);
        if (this.gl) this.contextVersion = 1;
      }
      if (!this.gl) { this._failStatic(); return; }
      var gl = this.gl;
      this._inspectGpu();
      this.parallelCompile = gl.getExtension('KHR_parallel_shader_compile');
      this.compileStarted = nowMs();
      var precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      var shaderPrecision = precision && precision.precision ? 'highp' : 'mediump';
      var ps3 = global.LGXMBPS3Wave;
      if (!ps3) throw new Error('Spline wave module is missing');
      this.ps3Surface = ps3.create(gl,shaderPrecision,this.ps3Quality);
      vertex = this._shader(gl.VERTEX_SHADER, VERTEX);
      fragment = this._shader(gl.FRAGMENT_SHADER, ps3.backdrop.replace('PRECISION', shaderPrecision));
      this.program = gl.createProgram();
      gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment);
      this.pendingShaders = [vertex,fragment];
      vertex = null; fragment = null;
      gl.linkProgram(this.program);
      this.mode = 'compiling';
      if (this.parallelCompile) this._scheduleCompilePoll();
      else this._finishCompile();
    } catch (e) {
      this.error = String(e.message || e);
      if (this.gl) {
        if (!this.pendingShaders && vertex) this.gl.deleteShader(vertex);
        if (!this.pendingShaders && fragment) this.gl.deleteShader(fragment);
      }
      this._failGpu(e);
    }
  };

  C5Wave.prototype._inspectGpu = function () {
    var gl = this.gl;
    var viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    var debug = gl.getExtension('WEBGL_debug_renderer_info');
    this.capabilities = {
      vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),
      version:gl.getParameter(gl.VERSION),shadingLanguage:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      unmaskedVendor:debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      maxViewport:[viewport[0],viewport[1]],maxRenderbuffer:gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxTexture:gl.getParameter(gl.MAX_TEXTURE_SIZE),contextAttributes:gl.getContextAttributes()
    };
    while (this.qualityIndex < QUALITY.length-1 &&
        (QUALITY[this.qualityIndex].width > viewport[0] || QUALITY[this.qualityIndex].height > viewport[1] ||
         QUALITY[this.qualityIndex].width > this.capabilities.maxRenderbuffer)) this.qualityIndex++;
  };

  C5Wave.prototype._scheduleCompilePoll = function () {
    if (this.compileRaf || this.destroyed || this.paused || document.hidden || this.contextLost) return;
    this.compileRaf = global.requestAnimationFrame(function () {
      this.compileRaf = 0;
      if (this.destroyed || this.paused || document.hidden || this.contextLost) return;
      try {
        if (this.gl.getProgramParameter(this.program,this.parallelCompile.COMPLETION_STATUS_KHR) &&
            (!this.ps3Surface || this.ps3Surface.programs.every(function (program) {
              return this.gl.getProgramParameter(program,this.parallelCompile.COMPLETION_STATUS_KHR);
            },this))) this._finishCompile();
        else if (nowMs()-this.compileStarted > 15000) throw new Error('Wave shader compilation exceeded 15 seconds');
        else this._scheduleCompilePoll();
      } catch (e) { this._failGpu(e); }
    }.bind(this));
  };

  C5Wave.prototype._finishCompile = function () {
    var gl = this.gl;
    if (!gl.getProgramParameter(this.program,gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(this.program) || 'Wave program failed to link';
      (this.pendingShaders || []).forEach(function (shader) {
        if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) log += '\n' + gl.getShaderInfoLog(shader);
      });
      throw new Error(log);
    }
    if (this.ps3Surface) this.ps3Surface.finish();
    this.compileMs = Math.round(nowMs()-this.compileStarted);
    (this.pendingShaders || []).forEach(function (shader) { gl.deleteShader(shader); });
    this.pendingShaders = null;
    gl.useProgram(this.program);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    var position = this.position = gl.getAttribLocation(this.program,'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    this.uniforms = {
      resolution:gl.getUniformLocation(this.program,'uResolution'),time:gl.getUniformLocation(this.program,'uTime'),
      background:gl.getUniformLocation(this.program,'uBackground'),wave:gl.getUniformLocation(this.program,'uWave'),
      brightness:gl.getUniformLocation(this.program,'uBrightness')
    };
    if(colors) this.colorUniforms=colors.locations(gl,this.program);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    this.mode = 'webgl'; this.error = null;
    this._resetTiming(); this._resize(); this._resume();
  };

  C5Wave.prototype._failGpu = function (error) {
    if (this.ps3Surface) this.ps3Surface.destroy(this.contextLost);
    this.ps3Surface = null;
    this.error = String(error.message || error);
    var gl = this.gl;
    if (gl && !this.contextLost) {
      (this.pendingShaders || []).forEach(function (shader) { gl.deleteShader(shader); });
      if (this.program) gl.deleteProgram(this.program);
      if (this.buffer) gl.deleteBuffer(this.buffer);
    }
    this.pendingShaders = null; this.program = null; this.buffer = null;
    this._failStatic();
  };

  // Without a GPU there is nothing left to draw: the spline needs one, and the
  // Canvas2D ribbons that used to stand in for it were retired after 0.1.30.
  C5Wave.prototype._failStatic = function () {
    this.mode = 'static';
    this.canvas.style.background = 'linear-gradient(160deg,#111e31,#061017 68%,#04080d)';
    this._cancel();
  };

  C5Wave.prototype._resize = function () {
    if (this.destroyed) return false;
    // A resize clears the backing pixels. Defer it until we can repaint in
    // the same task, keeping the old frame during hidden/transient geometry.
    if (document.hidden || this.paused || this.contextLost) {
      this.resizePending = true;
      return false;
    }
    this.resizePending = false;
    var rect = this.canvas.getBoundingClientRect();
    var width = Math.max(1, rect.width || global.innerWidth || 1920);
    var height = Math.max(1, rect.height || global.innerHeight || 1080);
    var quality = QUALITY[this.qualityIndex];
    // DPR can improve a small desktop preview; it never pushes this backdrop
    // beyond the explicit quality cap or changes the app's DOM resolution.
    var scale = Math.min(global.devicePixelRatio || 1,quality.width/width,quality.height/height);
    if (this.capabilities) {
      scale = Math.min(scale,this.capabilities.maxViewport[0]/width,this.capabilities.maxViewport[1]/height,
        this.capabilities.maxRenderbuffer/width,this.capabilities.maxRenderbuffer/height);
    }
    var w = Math.max(1, Math.round(width * scale));
    var h = Math.max(1, Math.round(height * scale));
    var resized = false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
      resized = true;
    }
    if (resized) this._draw();
    return resized;
  };

  C5Wave.prototype._resetTiming = function () {
    var timing = this.timing;
    timing.last = 0; timing.start = 0; timing.windowStart = 0;
    timing.samples = 0; timing.gaps = 0; timing.worst = 0; timing.badWindows = 0;
  };

  C5Wave.prototype._sampleTiming = function (now) {
    if (this.mode !== 'webgl') return;
    var timing = this.timing;
    if (!timing.start) timing.start = now;
    var delta = timing.last ? now-timing.last : 0;
    timing.last = now;
    // Startup, resumes, and resolution changes get a fresh two-second warmup.
    if (!delta || now-timing.start < 2000) return;
    if (!timing.windowStart) timing.windowStart = now;
    timing.samples++;
    if (delta > 25) timing.gaps++;
    timing.worst = Math.max(timing.worst,delta);
    if (now-timing.windowStart < 4000) return;
    var ratio = timing.gaps/timing.samples;
    timing.windows++; timing.lastGapRatio = ratio;
    timing.badWindows = ratio > 0.20 ? timing.badWindows+1 : 0;
    if (this.adaptive && timing.badWindows >= 2 && this.qualityIndex < QUALITY.length-1) {
      var before = QUALITY[this.qualityIndex].name;
      this.qualityIndex++;
      this.qualityChanges.push({from:before,to:QUALITY[this.qualityIndex].name,atMs:Math.round(now),
        reason:'Two 4-second windows with over 20% of rAF intervals above 25ms',gapRatio:ratio});
      this._resetTiming(); this._resize();
    } else {
      timing.windowStart = 0; timing.samples = 0; timing.gaps = 0;
    }
  };

  C5Wave.prototype.getDiagnostics = function () {
    // Local diagnostic data only. Scheduling gaps are not GPU execution time.
    return {
      mode:this.mode,contextVersion:this.contextVersion,capabilities:this.capabilities,
      renderQuality:Object.assign({},this.ps3Quality),
      surface:this.ps3Surface ? this.ps3Surface.diagnostics() : null,
      parallelShaderCompile:!!this.parallelCompile,compileMs:this.compileMs,
      quality:QUALITY[this.qualityIndex].name,
      backingWidth:this.canvas.width,backingHeight:this.canvas.height,
      targetFps:30,adaptive:this.adaptive,
      reducedMotion:this.reducedMotion,paused:this.paused,error:this.error,
      speed:this.speed,brightness:this.brightness,
      scheduling:{completedWindows:this.timing.windows,lastGapRatio:this.timing.lastGapRatio,
        currentSamples:this.timing.samples,currentGaps:this.timing.gaps,worstIntervalMs:this.timing.worst},
      qualityChanges:this.qualityChanges.slice()
    };
  };

  C5Wave.prototype._draw = function () {
    if (this.destroyed || this.contextLost || this.paused || document.hidden) return;
    if (this.mode === 'webgl') {
      var gl = this.gl;
      gl.viewport(0,0,this.canvas.width,this.canvas.height);
      gl.useProgram(this.program);
      // The mesh pass shares this context; restore the background vertex binding.
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.enableVertexAttribArray(this.position);
      gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,0,0);
      gl.uniform2f(this.uniforms.resolution,this.canvas.width,this.canvas.height);
      gl.uniform1f(this.uniforms.time,this.time);
      gl.uniform1f(this.uniforms.brightness,this.brightness);
      gl.uniform3fv(this.uniforms.background,this.background);
      gl.uniform3fv(this.uniforms.wave,this.wave);
      if(colors) colors.upload(gl,this.colorUniforms,this.palette);
      gl.drawArrays(gl.TRIANGLES,0,3);
      if (this.ps3Surface) {
        var renderChanged = false;
        try {
          this.ps3Surface.configure(this.ps3Quality);
          renderChanged = this.ps3Surface.draw(this.time,this.wave,this.brightness,this.canvas.width,this.canvas.height,this.background,this.palette);
        }
        catch (error) { this._cancel(); this._failGpu(error); renderChanged = true; }
        if (renderChanged && this.onRenderStatus) this.onRenderStatus();
      }
    }
  };

  C5Wave.prototype._cancel = function () {
    if (this.raf) global.cancelAnimationFrame(this.raf);
    if (this.initRaf) global.cancelAnimationFrame(this.initRaf);
    if (this.compileRaf) global.cancelAnimationFrame(this.compileRaf);
    this.initRaf = 0;
    this.compileRaf = 0;
    this.raf = 0; this.lastFrame = 0; this.nextFrame = 0;
    this._resetTiming();
  };

  C5Wave.prototype._resume = function () {
    if (this.destroyed || this.contextLost || this.paused || document.hidden) return;
    if (!this.initialized) { this._scheduleInitialize(); return; }
    if (this.mode === 'compiling') { this._scheduleCompilePoll(); return; }
    var resized = this.resizePending && this._resize();
    if (!resized) this._draw();
    if (!this.reducedMotion && this.mode !== 'static' && !this.raf) {
      this.raf = global.requestAnimationFrame(this._tickBound);
    }
  };

  C5Wave.prototype._tick = function (now) {
    this.raf = 0;
    if (this.destroyed || this.contextLost || this.paused || this.reducedMotion || document.hidden) return;
    this._sampleTiming(now);
    if (!this.lastFrame) this.lastFrame = now;
    var interval = 1000/30;
    if (!this.nextFrame) this.nextFrame = this.lastFrame+interval;
    if (now >= this.nextFrame-0.5) {
      // 0.39 rather than the 0.70 this ran at until now. Measured against real
      // XMB footage the band's centre moved 1.9% of screen height per second
      // against the console's 1.47, so the whole animation was simply too fast.
      // This is the single knob for that: every term downstream reads the clock.
      this.time += Math.min((now-this.lastFrame)/1000,0.1)*0.39*this.speed;
      this._wrapClock(false);
      this.lastFrame = now;
      // Retain the 30/20 Hz phase after a late callback. Resetting the deadline
      // to 'now' loses the remainder and can turn small jitter into 50 ms gaps.
      // Skip missed deadlines; never queue catch-up draws or advance time twice.
      this.nextFrame += (Math.floor((now-this.nextFrame+0.5)/interval)+1)*interval;
      this._draw();
    }
    if (!this.raf) this.raf = global.requestAnimationFrame(this._tickBound);
  };

  C5Wave.prototype._wrapClock = function (hidden) {
    // Wrapping shifts every curve's phase, so only do it out of sight. The
    // ceiling is the exception: past it the float32 uniform loses too much of a
    // frame's step to keep motion smooth, and one jump is the lesser fault.
    var wrap = hidden ? TIME_WRAP : TIME_CEILING;
    if (this.time > wrap) this.time = this.time % TIME_WRAP;
  };

  C5Wave.prototype._visibility = function () {
    var hidden = !!document.hidden;
    if (hidden === this.documentHidden) return;
    this.documentHidden = hidden;
    if (hidden) { this._cancel(); this._wrapClock(true); }
    else this._resume();
  };

  C5Wave.prototype.setTheme = function (theme) {
    if (this.destroyed) return;
    theme = theme || {};
    this.background = color(theme.background,this.background);
    this.wave = color(theme.wave,this.wave);
    this.palette = colors ? colors.resolve(theme.colors) : null;
    if(this.palette) this.wave = this.palette.tint.slice();
    this._draw();
  };

  C5Wave.prototype.setReducedMotion = function (value) {
    value = !!value;
    if (this.destroyed || this.reducedMotion === value) return;
    this.reducedMotion = value;
    this._cancel(); this._resume();
  };

  C5Wave.prototype.setStyle = function (style) {
    if (this.destroyed) return;
    style = style || {};
    var speed = [0.5,1.5,2.25].indexOf(style.speed) !== -1 ? style.speed : this.speed;
    var brightness = [0.6,1,1.5].indexOf(style.brightness) !== -1 ? style.brightness : this.brightness;
    if (this.speed === speed && this.brightness === brightness) return;
    var repaint = this.brightness !== brightness;
    this.speed = speed; this.brightness = brightness;
    // Uniform/clock changes retain the context, geometry, frame and frame cap.
    if (repaint) this._draw();
  };

  C5Wave.prototype.setQuality = function (options) {
    if (this.destroyed || !global.LGXMBPS3Wave) return;
    var next = global.LGXMBPS3Wave.quality(options,this.ps3Quality), previous = this.ps3Quality;
    if (next.msaa === previous.msaa && next.sampling === previous.sampling && next.detail === previous.detail && next.softness === previous.softness &&
        next.postprocess === previous.postprocess && next.strength === previous.strength && next.particles === previous.particles && next.particleCount === previous.particleCount) return;
    this.ps3Quality = next;
    // Apply resources on the next permitted draw, never while hidden or paused.
    this._draw();
  };

  C5Wave.prototype.setPaused = function (value) {
    value = !!value;
    if (this.destroyed || this.paused === value) return;
    this.paused = value;
    this._cancel();
    if (this.paused) this._wrapClock(true);
    else this._resume();
  };

  C5Wave.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true; this._cancel();
    document.removeEventListener('visibilitychange',this._visibilityBound,false);
    global.removeEventListener('resize',this._resizeBound,false);
    this.canvas.removeEventListener('webglcontextlost',this._lostBound,false);
    this.canvas.removeEventListener('webglcontextrestored',this._restoredBound,false);
    if (this.observer) this.observer.disconnect();
    if (this.media) {
      if (this.media.removeEventListener) this.media.removeEventListener('change',this._motionBound);
      else if (this.media.removeListener) this.media.removeListener(this._motionBound);
    }
    if (this.ps3Surface) this.ps3Surface.destroy(this.contextLost);
    this.ps3Surface = null;
    if (this.gl && !this.contextLost) {
      (this.pendingShaders || []).forEach(function (shader) { this.gl.deleteShader(shader); },this);
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.gl = null;
    this.pendingShaders = null;
  };

  global.C5Wave = C5Wave;
}(window));
