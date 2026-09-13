/*
 * OpenXMB C5: WebGL / Canvas adaptation of OpenXMB shaders/original.frag.
 * Upstream copyright (C) 2025-2026 Syndromatic Ltd. All rights reserved.
 * Designed by Kavish Krishnakumar in Manchester.
 * Adapted for the user's LG C5 prototype, September 2026.
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

  // The five ribbon curves, mask widths, seeds, noise and crossing function
  // come from original.frag at OpenXMB commit 84f153f441c5f860a07acd5b37bd90c4aaae82de.
  // Vulkan push constants become WebGL uniforms; the composition is darkened
  // and moved below the menu. Deferred WebGL restores the original rich mask
  // and crossing detail; Canvas2D is only a compatibility fallback.
  var FRAGMENT = [
    'precision PRECISION float;',
    'varying vec2 vUV;',
    'uniform vec2 uResolution;',
    'uniform float uTime;',
    'uniform float uBrightness;',
    'uniform vec3 uBackground;',
    'uniform vec3 uWave;',
    'float hash12(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    'float noise2(vec2 p) {',
    '  vec2 i = floor(p); vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash12(i), hash12(i + vec2(1.0,0.0)), u.x),',
    '    mix(hash12(i + vec2(0.0,1.0)), hash12(i + vec2(1.0,1.0)), u.x), u.y);',
    '}',
    'float fbm(vec2 p) {',
    '  float v = 0.0; float a = 0.5;',
    '  mat2 r = mat2(0.82, -0.57, 0.57, 0.82);',
    '  for (int i = 0; i < 4; ++i) {',
    '    v += a * noise2(p); p = r * p * 2.03 + vec2(11.7, 4.2); a *= 0.5;',
    '  } return v;',
    '}',
    'float ribbon_curve(float x, float seed, float t) {',
    '  float slow = t * (0.045 + seed * 0.011);',
    '  float y = sin(x * (1.15 + seed * 0.07) + slow + seed * 3.1) * 0.115;',
    '  y += sin(x * (2.05 + seed * 0.11) - slow * 1.45 + seed * 6.4) * 0.045;',
    '  y += sin(x * (3.10 + seed * 0.19) + slow * 0.72 + seed * 2.4) * 0.018;',
    '  return y;',
    '}',
    'float ribbon_mask(vec2 p, float seed, float t, float width, out float glow) {',
    '  float y = ribbon_curve(p.x, seed, t) + seed * 0.045 - 0.055;',
    '  float d = abs(p.y - y);',
    '  glow = 1.0 - smoothstep(width, width * 7.0, d);',
    '  return 1.0 - smoothstep(width * 0.12, width, d);',
    '}',
    'void main() {',
    '  vec2 uv = vUV;',
    '  vec2 p = uv * 2.0 - 1.0;',
    '  p.x *= uResolution.x / max(uResolution.y, 1.0);',
    '  p.y += 0.43;',
    '  float leftGlow = exp(-length((p - vec2(-1.28,0.22)) * vec2(0.64,1.05)) * 1.35);',
    '  float horizon = exp(-abs(p.y + 0.03) * 3.0);',
    '  float vignette = 1.0 - smoothstep(0.18,1.65,length((uv - 0.5) * vec2(1.4,1.8)));',
    '  vec3 color = uBackground * mix(0.5,1.0,uv.y);',
    '  color += uWave * (leftGlow * 0.035 + horizon * 0.016);',
    '  float g0; float g1; float g2; float g3; float g4;',
    '  float c0 = ribbon_mask(p + vec2(0.00,0.012),0.2,uTime,0.022,g0);',
    '  float c1 = ribbon_mask(p + vec2(0.16,-0.018),1.1,uTime,0.017,g1);',
    '  float c2 = ribbon_mask(p + vec2(-0.12,0.030),2.0,uTime,0.013,g2);',
    '  float c3 = ribbon_mask(p + vec2(0.08,-0.048),3.0,uTime,0.010,g3);',
    '  float c4 = ribbon_mask(p + vec2(-0.22,0.056),3.8,uTime,0.018,g4);',
    '  float core = c0*0.42 + c1*0.34 + c2*0.26 + c3*0.18 + c4*0.12;',
    '  float glow = g0*0.20 + g1*0.18 + g2*0.14 + g3*0.10 + g4*0.08;',
    '  float crossing = smoothstep(0.05,0.75,fbm(vec2(p.x*0.74,p.y*1.8+uTime*0.018)));',
    '  core *= mix(0.78,1.26,crossing);',
    '  float edgeFade = 0.58 + 0.42 * sin(uv.x * 3.14159265);',
    '  vec3 waveColor = mix(uWave,vec3(0.70,0.84,0.96),0.25);',
    '  color += waveColor * glow * 0.23 * edgeFade * uBrightness;',
    '  color += waveColor * core * 0.34 * edgeFade * uBrightness;',
    '  color += vec3(0.61,0.78,0.90) * pow(clamp(core,0.0,1.0),2.2) * 0.075 * uBrightness;',
    '  gl_FragColor = vec4(clamp(color * mix(0.70,1.0,vignette),0.0,1.0),1.0);',
    '}'
  ].join('\n');

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

  function rgb(c, alpha) {
    return 'rgba(' + c.map(function (x) { return Math.round(x * 255); }).join(',') + ',' + alpha + ')';
  }

  // Same ribbon_curve equation as original.frag, for the CPU fallback.
  function curve(x, seed, t) {
    var slow = t * (0.045 + seed * 0.011);
    return Math.sin(x * (1.15 + seed * 0.07) + slow + seed * 3.1) * 0.115 +
      Math.sin(x * (2.05 + seed * 0.11) - slow * 1.45 + seed * 6.4) * 0.045 +
      Math.sin(x * (3.10 + seed * 0.19) + slow * 0.72 + seed * 2.4) * 0.018;
  }

  var SEEDS = [0.2,1.1,2.0,3.0,3.8];
  var OFFSETS = [[0,0.012],[0.16,-0.018],[-0.12,0.030],[0.08,-0.048],[-0.22,0.056]];
  var WIDTHS = [0.022,0.017,0.013,0.010,0.018];
  var WEIGHTS = [0.42,0.34,0.26,0.18,0.12];
  var SOFT_WIDTHS = [3.2,1.4,0.40];
  var SOFT_ALPHA = [0.045,0.085,0.35];
  var QUALITY = [
    {name:'1080p',width:1920,height:1080},
    {name:'720p',width:1280,height:720},
    {name:'540p',width:960,height:540}
  ];

  function nowMs() {
    return global.performance && global.performance.now ? global.performance.now() : Date.now();
  }

  function C5Wave(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('C5Wave requires a canvas');
    this.canvas = canvas;
    this.background = color('#08101c');
    this.wave = color('#518aab');
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
    this.raf = 0;
    this.initRaf = 0;
    this.compileRaf = 0;
    this.initialized = false;
    this.renderer = options && options.renderer === 'canvas2d' ? 'canvas2d' : 'webgl';
    this.qualityIndex = options && options.quality === '720p' ? 1 : options && options.quality === '540p' ? 2 : 0;
    this.adaptive = !(options && options.adaptive === false);
    this.capabilities = null;
    this.qualityChanges = [];
    this.pendingShaders = null;
    this.parallelCompile = null;
    this.compileStarted = 0;
    this.compileMs = null;
    this.timing = {last:0,start:0,windowStart:0,samples:0,gaps:0,worst:0,badWindows:0,windows:0,lastGapRatio:0};
    this.mode = 'pending';
    this.error = null;
    this.gl = null;
    this.ctx = null;
    this.program = null;
    this.buffer = null;
    this.fallbackCanvas = null;
    this.backgroundSurface = null;
    this.strokeStyles = null;
    this.points = null;
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
    if (this.fallbackCanvas && this.fallbackCanvas.parentNode) {
      this.fallbackCanvas.parentNode.removeChild(this.fallbackCanvas);
    }
    this.fallbackCanvas = null; this.ctx = null; this.mode = 'static';
    if (this.renderer !== 'webgl') { this._fallback(); this._resize(); this._resume(); return; }
    // Keep the last complete frame while Home is paused. This does not
    // guarantee compositor retention; native performance is tested separately.
    var options = {alpha:false, antialias:false, depth:false, stencil:false,
      preserveDrawingBuffer:true, powerPreference:'high-performance'};
    var vertex = null;
    var fragment = null;
    try {
      this.gl = this.canvas.getContext('webgl', options) || this.canvas.getContext('experimental-webgl', options);
      if (!this.gl) { this._fallback(); this._resize(); this._resume(); return; }
      var gl = this.gl;
      this._inspectGpu();
      this.parallelCompile = gl.getExtension('KHR_parallel_shader_compile');
      this.compileStarted = nowMs();
      var precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      vertex = this._shader(gl.VERTEX_SHADER, VERTEX);
      fragment = this._shader(gl.FRAGMENT_SHADER, FRAGMENT.replace('PRECISION', precision && precision.precision ? 'highp' : 'mediump'));
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
        if (this.gl.getProgramParameter(this.program,this.parallelCompile.COMPLETION_STATUS_KHR)) this._finishCompile();
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
    this.compileMs = Math.round(nowMs()-this.compileStarted);
    (this.pendingShaders || []).forEach(function (shader) { gl.deleteShader(shader); });
    this.pendingShaders = null;
    gl.useProgram(this.program);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    var position = gl.getAttribLocation(this.program,'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    this.uniforms = {
      resolution:gl.getUniformLocation(this.program,'uResolution'),time:gl.getUniformLocation(this.program,'uTime'),
      background:gl.getUniformLocation(this.program,'uBackground'),wave:gl.getUniformLocation(this.program,'uWave'),
      brightness:gl.getUniformLocation(this.program,'uBrightness')
    };
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    this.mode = 'webgl'; this.error = null;
    this._resetTiming(); this._resize(); this._resume();
  };

  C5Wave.prototype._failGpu = function (error) {
    this.error = String(error.message || error);
    var gl = this.gl;
    if (gl && !this.contextLost) {
      (this.pendingShaders || []).forEach(function (shader) { gl.deleteShader(shader); });
      if (this.program) gl.deleteProgram(this.program);
      if (this.buffer) gl.deleteBuffer(this.buffer);
    }
    this.pendingShaders = null; this.program = null; this.buffer = null;
    this._fallback(); this._resize(); this._resume();
  };

  C5Wave.prototype._fallback = function () {
    var target = this.canvas;
    // A canvas cannot switch context families after a failed WebGL compile.
    // Keep the caller's element/ID, and place an owned Canvas2D surface above it.
    if (this.gl && target.parentNode) {
      this.fallbackCanvas = document.createElement('canvas');
      var style = global.getComputedStyle(target);
      this.fallbackCanvas.style.cssText = 'position:absolute;pointer-events:none;';
      ['top','left','right','bottom','width','height','zIndex','opacity','borderRadius'].forEach(function (key) {
        this.fallbackCanvas.style[key] = style[key];
      }, this);
      this.fallbackCanvas.setAttribute('aria-hidden','true');
      target.parentNode.insertBefore(this.fallbackCanvas, target.nextSibling);
      target = this.fallbackCanvas;
    }
    try { this.ctx = target.getContext('2d', {alpha:false}); } catch (e) { this.ctx = null; }
    this.mode = this.ctx ? 'canvas2d' : 'static';
    if (!this.ctx) this.canvas.style.background = 'linear-gradient(160deg,#111e31,#061017 68%,#04080d)';
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
    var quality = this.mode === 'canvas2d' || this.renderer === 'canvas2d' ? QUALITY[2] : QUALITY[this.qualityIndex];
    // DPR can improve a small desktop preview; it never pushes this backdrop
    // beyond the explicit quality cap or changes the app's DOM resolution.
    var scale = Math.min(global.devicePixelRatio || 1,quality.width/width,quality.height/height);
    if (this.capabilities && this.mode !== 'canvas2d') {
      scale = Math.min(scale,this.capabilities.maxViewport[0]/width,this.capabilities.maxViewport[1]/height,
        this.capabilities.maxRenderbuffer/width,this.capabilities.maxRenderbuffer/height);
    }
    var w = Math.max(1, Math.round(width * scale));
    var h = Math.max(1, Math.round(height * scale));
    var resized = false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
      this.backgroundSurface = null; this.points = null;
      resized = true;
    }
    if (this.fallbackCanvas && (this.fallbackCanvas.width !== w || this.fallbackCanvas.height !== h)) {
      if (this.fallbackCanvas.width !== w) this.fallbackCanvas.width = w;
      if (this.fallbackCanvas.height !== h) this.fallbackCanvas.height = h;
      this.backgroundSurface = null; this.points = null;
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
      mode:this.mode,requestedRenderer:this.renderer,capabilities:this.capabilities,
      parallelShaderCompile:!!this.parallelCompile,compileMs:this.compileMs,
      quality:this.mode === 'canvas2d' ? '540p' : QUALITY[this.qualityIndex].name,
      backingWidth:this.canvas.width,backingHeight:this.canvas.height,
      targetFps:this.mode === 'canvas2d' ? 20 : 30,adaptive:this.adaptive,
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
      gl.uniform2f(this.uniforms.resolution,this.canvas.width,this.canvas.height);
      gl.uniform1f(this.uniforms.time,this.time);
      gl.uniform1f(this.uniforms.brightness,this.brightness);
      gl.uniform3fv(this.uniforms.background,this.background);
      gl.uniform3fv(this.uniforms.wave,this.wave);
      gl.drawArrays(gl.TRIANGLES,0,3);
    } else if (this.ctx) this._draw2d();
  };

  C5Wave.prototype._draw2d = function () {
    var ctx = this.ctx;
    var w = ctx.canvas.width, h = ctx.canvas.height;
    if (!this.backgroundSurface) this._cache2d(w,h);
    ctx.drawImage(this.backgroundSurface,0,0);
    ctx.lineCap = 'round';
    for (var j=0;j<5;j++) {
      ctx.beginPath();
      var row = this.points[j];
      for (var i=0;i<row.length;i+=2) {
        var px = row[i];
        var y = curve(row[i+1],SEEDS[j],this.time)+SEEDS[j]*0.045-0.055-OFFSETS[j][1];
        var py = (1-(y-0.43))*h*0.5;
        if (px===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      // Three soft strokes approximate the fragment mask, without expensive
      // per-pixel CPU noise or Canvas shadowBlur on a television browser.
      for (var pass=0;pass<3;pass++) {
        ctx.lineWidth = Math.max(0.8,WIDTHS[j]*h*SOFT_WIDTHS[pass]);
        ctx.strokeStyle = this.strokeStyles[j][pass];
        ctx.stroke();
      }
    }
  };

  C5Wave.prototype._cache2d = function (w,h) {
    var surface = document.createElement('canvas');
    surface.width = w; surface.height = h;
    var ctx = surface.getContext('2d',{alpha:false});
    var bg = ctx.createLinearGradient(0,0,w*0.4,h);
    bg.addColorStop(0,rgb(this.background,1));
    bg.addColorStop(1,rgb(this.background.map(function (v) { return v*0.5; }),1));
    ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);
    var halo = ctx.createRadialGradient(w*0.25,h*0.69,0,w*0.25,h*0.69,w*0.65);
    halo.addColorStop(0,rgb(this.wave,0.07)); halo.addColorStop(1,rgb(this.wave,0));
    ctx.fillStyle = halo; ctx.fillRect(0,0,w,h);
    this.backgroundSurface = surface;
    var tint = this.wave.map(function (v,i) { return v*0.75+[0.70,0.84,0.96][i]*0.25; });
    this.strokeStyles = []; this.points = [];
    for (var j=0;j<5;j++) {
      var styles = []; var row = [];
      for (var pass=0;pass<3;pass++) styles.push(rgb(tint,WEIGHTS[j]*SOFT_ALPHA[pass]*this.brightness));
      // The curves are low-frequency. 120 segments are smooth at TV distance,
      // and avoid repeatedly computing identical x positions on each frame.
      for (var i=0;i<=120;i++) row.push(i*w/120,(i/120*2-1)*(w/h)+OFFSETS[j][0]);
      this.strokeStyles.push(styles); this.points.push(row);
    }
  };

  C5Wave.prototype._cancel = function () {
    if (this.raf) global.cancelAnimationFrame(this.raf);
    if (this.initRaf) global.cancelAnimationFrame(this.initRaf);
    if (this.compileRaf) global.cancelAnimationFrame(this.compileRaf);
    this.initRaf = 0;
    this.compileRaf = 0;
    this.raf = 0; this.lastFrame = 0;
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
    var delta = now-this.lastFrame;
    if (delta >= 1000/(this.mode === 'canvas2d' ? 20 : 30)-0.5) {
      this.time += Math.min(delta/1000,0.1)*0.70*this.speed;
      this.lastFrame = now;
      this._draw();
    }
    this.raf = global.requestAnimationFrame(this._tickBound);
  };

  C5Wave.prototype._visibility = function () {
    var hidden = !!document.hidden;
    if (hidden === this.documentHidden) return;
    this.documentHidden = hidden;
    if (hidden) this._cancel();
    else this._resume();
  };

  C5Wave.prototype.setTheme = function (theme) {
    if (this.destroyed) return;
    theme = theme || {};
    this.background = color(theme.background,this.background);
    this.wave = color(theme.wave,this.wave);
    this.backgroundSurface = null;
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
    if (repaint) { this.backgroundSurface = null; this._draw(); }
  };

  C5Wave.prototype.setPaused = function (value) {
    value = !!value;
    if (this.destroyed || this.paused === value) return;
    this.paused = value;
    this._cancel();
    if (!this.paused) this._resume();
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
    if (this.gl && !this.contextLost) {
      (this.pendingShaders || []).forEach(function (shader) { this.gl.deleteShader(shader); },this);
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    if (this.fallbackCanvas && this.fallbackCanvas.parentNode) this.fallbackCanvas.parentNode.removeChild(this.fallbackCanvas);
    this.fallbackCanvas = null; this.ctx = null; this.gl = null;
    this.pendingShaders = null;
    this.backgroundSurface = null; this.points = null; this.strokeStyles = null;
  };

  global.C5Wave = C5Wave;
}(window));
