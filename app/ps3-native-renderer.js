/* lg-xmb, 2026. SPDX-License-Identifier: GPL-3.0-or-later
* Native WebGL 2 / GLSL ES 3.00 renderer. Small CPU simulation; GPU spline
* evaluation and instanced quads. No WebGL 1 shader translation or fallback.
* Reference arithmetic, optical bindings and port policies: docs/WEBGL2.md.
*/
(function (root) {
  'use strict';
  var Core = root.LGXMBPS3Core, Shaders = root.LGXMBPS3Shaders;
  var DEFAULT = { sampling: 1, detail: 'high', softness: 1.5, postprocess: 'off', strength: 'normal',
    particles: false, particleCount: 2000, msaa: 0, frameRate: 60 };
  function quality(options, previous) {
    var p = previous || DEFAULT, o = options || {};
    function select(name, allowed) { return allowed.indexOf(o[name]) >= 0 ? o[name] : p[name]; }
    return { sampling: select('sampling', [1, 1.25, 1.5, 2]), detail: select('detail', ['low', 'standard', 'high', 'fine']),
      softness: select('softness', [0, .5, .75, 1, 1.5, 2, 3]), postprocess: select('postprocess', ['off', 'fxaa', 'wave']),
      strength: select('strength', ['gentle', 'normal', 'strong']), particles: typeof o.particles === 'boolean' ? o.particles : p.particles,
      particleCount: select('particleCount', [500, 1000, 2000, 4000]), msaa: select('msaa', [0, 2, 4]),
      frameRate: select('frameRate', [30, 60]) };
  }
  function same(a, b) { return Object.keys(DEFAULT).every(function (k) { return a[k] === b[k]; }); }
  function color(value, fallback) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
      return [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255];
    if (Array.isArray(value) && value.length === 3 && value.every(function (x) { return Number.isFinite(x) && x >= 0 && x <= 1; }))
      return value.slice();
    return fallback;
  }
  function transpose(m) { var out = new Float32Array(16); for (var i = 0; i < 4; i++)
    for (var j = 0; j < 4; j++)
      out[i * 4 + j] = m[j * 4 + i]; return out; }
  var RETAINED_DAY_NIGHT = Object.freeze({ nightBlend: 0.4999470114707947, nightBrightness: 0.4860590100288391,
    dawnBegin: 0, dawnEnd: 5.16611, duskBegin: 18.498, duskEnd: 20.3312, daySpread: 2.68038010597229 });
  function Simulation(reference) {
    if (!Core || !reference || reference.format !== 1)
      throw new Error('Local PS3 reference pack missing. Run tools/import-ps3-reference.py.');
    this.reference = reference;
    this.wave = new Core.Wave(reference.wave, reference.settings);
    this.particles = new Core.Particles(reference.particles, new Core.Parameters(reference.particleParams));
    this.elapsed = 0;
    this.steps = 0;
    this.respawn = true;
  }
  Simulation.prototype.advance = function (seconds, particlesEnabled) {
    if (!seconds)
      return;
    this.wave.advance(seconds);
    if (particlesEnabled !== false) this.particles.advance(seconds, this.respawn);
    this.elapsed += seconds;
    this.steps++;
  };
  function Renderer(gl, simulation, settings) {
    if (!gl || typeof gl.createVertexArray !== 'function' || typeof gl.texStorage2D !== 'function')
      throw new Error('Native renderer requires WebGL 2');
    this.gl = gl;
    this.simulation = simulation;
    this.settings = quality(settings);
    this.objects = [];
    this.programs = [];
    this.dead = false;
    this.ready = false;
    this.target = null;
    this.allocationKey = '';
    this.grid = 0;
    this.meshRevision = -1;
    this.particleRevision = -1;
    this.drawCount = 0;
    this.uploadedBytes = 0;
    this.allocations = 0;
    this.lastCount = 0;
    this.changed = true;
    this.width = 0;
    this.height = 0;
    this.effectiveScale = 1;
    this.samplingFallback = null;
    this.msaaFallback = null;
    this.msaaSamples = 0;
    this.uniforms = {};
    this.filterTunings = { gentle: new Float32Array([.015625, .125, .5]), normal: new Float32Array([.0078125, .0833333, .75]), strong: new Float32Array([.00390625, .0625, 1]) };
    this.particlesUploaded = false;
    var limit = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    this.maxDimension = Math.min(3840, limit, gl.getParameter(gl.MAX_TEXTURE_SIZE), vp[0], vp[1]);
    var maxSamples = gl.getParameter(gl.MAX_SAMPLES), counts = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA8, gl.SAMPLES);
    this.msaaSupported = Array.from(counts || []).filter(function (n) { return n > 1 && n <= 4 && n <= maxSamples; }).sort(function (a, b) { return b - a; });
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    try {
      this.waveProgram = this.program(Shaders.waveVertex, Shaders.waveFragment, ['tfPosition', 'tfNormal']);
      this.particleProgram = this.program(Shaders.particleVertex, Shaders.particleFragment);
      this.glareProgram = this.program(Shaders.glareVertex, Shaders.glareFragment);
      this.compositeProgram = this.program(Shaders.fullscreenVertex, Shaders.compositeFragment);
      this.monthlyProgram = this.program(Shaders.fullscreenVertex, Shaders.monthlyBackground);
      this.backdropProgram = this.program(Shaders.fullscreenVertex, Shaders.backdropFragment);
    }
    catch (error) {
      this.destroy(false);
      throw error;
    }
  }
  Renderer.prototype.resource = function (kind) {
    var gl = this.gl, value = gl['create' + kind]();
    if (!value)
      throw new Error('Could not allocate ' + kind);
    this.objects.push([kind, value]);
    return value;
  };
  Renderer.prototype.program = function (vertex, fragment, varyings) {
    var gl = this.gl, p = this.resource('Program'), self = this;
    [vertex, fragment].forEach(function (source, index) {
      if (!source.startsWith('#version 300 es\n'))
        throw new Error('Expected GLSL ES 3.00 shader');
      var s = gl.createShader(index ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER);
      if (!s)
        throw new Error('Shader allocation failed');
      self.objects.push(['Shader', s]);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      gl.attachShader(p, s);
    });
    if (varyings)
      gl.transformFeedbackVaryings(p, varyings, gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(p);
    this.programs.push(p);
    return p;
  };
  Renderer.prototype.compiled = function () {
    var self = this;
    return !this.parallel || this.programs.every(function (p) { return self.gl.getProgramParameter(p, self.parallel.COMPLETION_STATUS_KHR); });
  };
  Renderer.prototype.locations = function (program) {
    var gl = this.gl, map = {}, count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var u = gl.getActiveUniform(program, i), name = u.name.replace(/\[0\]$/, '');
      map[name] = gl.getUniformLocation(program, name);
    }
    return map;
  };
  Renderer.prototype.texture = function (width, height, pixels, format, type, filter) {
    var gl = this.gl, t = this.resource('Texture');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (pixels)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, type, pixels);
    return t;
  };
  Renderer.prototype.finish = function () {
    if (this.ready || this.dead)
      return;
    var gl = this.gl, reference = this.simulation.reference;
    this.programs.forEach(function (p) {
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        var log = gl.getProgramInfoLog(p) || 'Native shader link failed';
        (gl.getAttachedShaders(p) || []).forEach(function (s) { if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
          log += '\n' + gl.getShaderInfoLog(s); });
        throw new Error(log);
      }
    });
    this.objects = this.objects.filter(function (entry) { if (entry[0] === 'Shader') {
      gl.deleteShader(entry[1]);
      return false;
    } return true; });
    this.uniforms.wave = this.locations(this.waveProgram);
    this.uniforms.particle = this.locations(this.particleProgram);
    this.uniforms.glare = this.locations(this.glareProgram);
    this.uniforms.composite = this.locations(this.compositeProgram);
    this.uniforms.monthly = this.locations(this.monthlyProgram);
    this.uniforms.backdrop = this.locations(this.backdropProgram);
    this.backdrop = null;
    this.backdropKey = '';
    this.waveVAO = this.resource('VertexArray');
    this.indexBuffer = this.resource('Buffer');
    this.fullscreenVAO = this.resource('VertexArray');
    this.particleVAO = this.resource('VertexArray');
    this.instanceBuffer = this.resource('Buffer');
    this.cornerBuffer = this.resource('Buffer');
    gl.bindVertexArray(this.particleVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.simulation.particles.render.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(2, 0);
    gl.bindVertexArray(null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0);
    this.controlTexture = this.texture(19, 19, null, gl.RGBA32F, gl.FLOAT, gl.NEAREST);
    this.fresnelTexture = this.texture(reference.fresnel.width, reference.fresnel.height, reference.fresnel.rgba, gl.RGBA8, gl.UNSIGNED_BYTE, gl.LINEAR);
    this.iridescenceTexture = this.texture(reference.iridescence.width, reference.iridescence.height, reference.iridescence.rgba, gl.RGBA8, gl.UNSIGNED_BYTE, gl.LINEAR);
    this.basis = new Float32Array(32);
    this.derivative = new Float32Array(32);
    for (var j = 0; j < 8; j++)
      for (var k = 0; k < 4; k++) {
        this.basis[j * 4 + k] = reference.basis[j * 64 + k];
        this.derivative[j * 4 + k] = reference.derivative[j * 64 + k];
      }
    // The 24 PS3 month_bg textures as a 2D array, and the 64x32 target the
    // recovered back_colours0 program renders into. Without the local data
    // file the PS3 colour source silently falls back to the theme backdrop.
    var months = root.LGXMBPS3MonthlyTextures;
    this.monthlyTexture = null;
    this.monthlyKey = '';
    if (months && months.width === 64 && months.height === 32 && months.layers === 24 && months.rgba.length === 64 * 32 * 4 * 24) {
      this.monthlyArray = this.resource('Texture');
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.monthlyArray);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 64, 32, 24);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 64, 32, 24, gl.RGBA, gl.UNSIGNED_BYTE, months.rgba);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      this.monthlyTexture = this.texture(64, 32, null, gl.RGBA8, gl.UNSIGNED_BYTE, gl.LINEAR);
      this.monthlyFbo = this.resource('Framebuffer');
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.monthlyFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.monthlyTexture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        this.monthlyTexture = null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    this.material = this.materialUniforms(reference);
    this.materialRows = new Float32Array(16);
    this.colorVector = this.material.uColor || new Float32Array([1, 1, 1, 0]);
    this.waveMaterial = new Float32Array([reference.settings.FRESNEL, reference.settings.BRIGHTNESS, reference.settings['MIPMAP BIAS']]);
    this.ready = true;
    this.updateGrid();
    if (gl.getError() !== gl.NO_ERROR)
      throw new Error('WebGL 2 resource initialization failed');
  };
  Renderer.prototype.materialUniforms = function (reference) {
    // Root menu fallback, overridden below by named retained QGL values when
    // supplied. Projection remains inferred, unlike the tested simulation inputs.
    var m = reference.particleMaterial, p = this.simulation.particles.params;
    var result = { uLifeBoundsMin: new Float32Array([p.minimum[0], p.minimum[1], p.minimum[2], 0]),
      uLifeBoundsMax: new Float32Array([p.maximum[0], p.maximum[1], p.maximum[2], 0]),
      uModelviewProjection: transpose(reference.viewProjection),
      uModelview: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -2, 0, 0, 0, 1]),
      uLightPack: new Float32Array([0, m['spot pos x'], m['spot attn x'], m['lambert coeff'],
        0, m['spot pos y'], m['spot attn y'], m['specular coeff'], 2, m['spot pos z'], m['spot attn z'], m.exposure,
        0, m['specular power'], 0, m.color_control]),
      uParticleSize: new Float32Array([m['size middle'], m['size near'], m['size far'], 0]),
      uFocus: new Float32Array([m['near focus'], m['near focus'] + m['near focus_dist'], m['far focus'], m['far focus'] + m['far focus_dist']]),
      uFocusCurves: new Float32Array([m['near focus_pow'], m['far focus_pow'], 0.9250245094299316, 0]),
      uFrontFacingQuaternion: new Float32Array([0, 0, 0, 1]), uTransparency: new Float32Array([m.fresnel, m['global alpha'], 0, 0]),
      uNearControl: new Float32Array([m['size align'], m['near fuzziness'], m['near align'], 0]),
      uDarkness: new Float32Array([m['near darkness'], m['far darkness'], 0, 0]),
      uGlare: new Float32Array([m.glare, m['glare scale'], m['glare p1'], m['glare p2']]) };
    if (reference.optics) {
      Object.keys(reference.optics.uniforms).forEach(function (name) {
        var value = reference.optics.uniforms[name];
        if (Array.isArray(value))
          result[name] = new Float32Array(value);
      });
    }
    return result;
  };
  Renderer.prototype.updateGrid = function () {
    var n = (this.settings.detail === 'low' || this.settings.detail === 'standard') ? 64 : 128;
    if (this.grid === n)
      return;
    var gl = this.gl, indices = new Uint16Array((n - 1) * (n - 1) * 6 + (n - 1) * 12), j = 0, g = n * n;
    for (var y = 0; y < n - 1; y++) {
      for (var x = 0; x < n - 1; x++) {
        var a = y * n + x, b = a + n;
        indices[j++] = a;
        indices[j++] = b;
        indices[j++] = a + 1;
        indices[j++] = a + 1;
        indices[j++] = b;
        indices[j++] = b + 1;
      }
      // Guard quads: vertex g+2y is the right-end copy of row y, g+2y+1 the left.
      indices[j++] = g + y * 2; indices[j++] = g + (y + 1) * 2; indices[j++] = y * n;
      indices[j++] = y * n; indices[j++] = g + (y + 1) * 2; indices[j++] = (y + 1) * n;
      indices[j++] = y * n + n - 1; indices[j++] = (y + 1) * n + n - 1; indices[j++] = g + y * 2 + 1;
      indices[j++] = g + y * 2 + 1; indices[j++] = (y + 1) * n + n - 1; indices[j++] = g + (y + 1) * 2 + 1;
    }
    gl.bindVertexArray(this.waveVAO);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.grid = n;
    this.indexCount = indices.length;
    this.changed = true;
  };
  Renderer.prototype.releaseTarget = function (t) {
    if (!t)
      return;
    var gl = this.gl;
    if (t.msaaFbo)
      gl.deleteFramebuffer(t.msaaFbo);
    if (t.msaaBuffer)
      gl.deleteRenderbuffer(t.msaaBuffer);
    if (t.framebuffer)
      gl.deleteFramebuffer(t.framebuffer);
    if (t.texture)
      gl.deleteTexture(t.texture);
  };
  Renderer.prototype.allocate = function (w, h, samples) {
    var gl = this.gl, t = { width: w, height: h, samples: samples }, ok = false;
    try {
      t.texture = gl.createTexture();
      t.framebuffer = gl.createFramebuffer();
      if (!t.texture || !t.framebuffer)
        throw new Error('No render target');
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE || gl.getError() !== gl.NO_ERROR)
        throw new Error('Incomplete render target');
      if (samples) {
        t.msaaBuffer = gl.createRenderbuffer();
        t.msaaFbo = gl.createFramebuffer();
        if (!t.msaaBuffer || !t.msaaFbo)
          throw new Error('No MSAA target');
        gl.bindRenderbuffer(gl.RENDERBUFFER, t.msaaBuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
        if (gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_SAMPLES) !== samples)
          throw new Error('MSAA sample mismatch');
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.msaaFbo);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.msaaBuffer);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE || gl.getError() !== gl.NO_ERROR)
          throw new Error('Incomplete MSAA target');
      }
      ok = true;
      return t;
    }
    finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      if (!ok)
        this.releaseTarget(t);
    }
  };
  Renderer.prototype.resize = function (w, h) {
    var s = this.settings, key = w + 'x' + h + '@' + s.sampling + '#' + s.msaa;
    if (key === this.allocationKey)
      return;
    this.samplingFallback = null;
    this.msaaFallback = null;
    var scales = [s.sampling, 1], last = '', candidate = null;
    for (var i = 0; i < scales.length && !candidate; i++) {
      var scale = Math.min(scales[i], this.maxDimension / w, this.maxDimension / h), sw = Math.max(1, Math.floor(w * scale)), sh = Math.max(1, Math.floor(h * scale));
      var size = sw + 'x' + sh;
      if (size === last)
        continue;
      last = size;
      var samples = this.msaaSupported.filter(function (n) { return n <= s.msaa; });
      samples.push(0);
      for (var j = 0; j < samples.length && !candidate; j++) {
        if (sw * sh * 4 * (1 + samples[j]) > 96 * 1024 * 1024) {
          this.msaaFallback = '96 MiB render-target budget';
          continue;
        }
        try {
          candidate = this.allocate(sw, sh, samples[j]);
        }
        catch (error) {
          this.msaaFallback = error.message;
          if (this.gl.isContextLost())
            throw error;
        }
      }
      if (candidate) {
        this.effectiveScale = scale;
        this.msaaSamples = candidate.samples;
      }
    }
    if (!candidate)
      throw new Error('WebGL 2 render target unavailable');
    if (this.effectiveScale !== s.sampling)
      this.samplingFallback = 'Render-target limit';
    if (this.msaaSamples !== s.msaa)
      this.msaaFallback = this.msaaFallback || 'Requested MSAA sample count unavailable';
    this.releaseTarget(this.target);
    this.target = candidate;
    this.allocationKey = key;
    this.width = candidate.width;
    this.height = candidate.height;
    this.allocations++;
    this.changed = true;
  };
  Renderer.prototype.configure = function (options) { var next = quality(options, this.settings); if (!same(next, this.settings)) {
    this.settings = next;
    this.changed = true;
  } };
  Renderer.prototype.wavePass = function (aspect, wave, brightness) {
    var gl = this.gl, u = this.uniforms.wave, state = this.simulation.wave;
    gl.useProgram(this.waveProgram);
    gl.bindVertexArray(this.waveVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.controlTexture);
    if (this.meshRevision !== state.revision) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 19, 19, gl.RGBA, gl.FLOAT, state.controls);
      this.uploadedBytes += state.controls.byteLength;
      this.meshRevision = state.revision;
    }
    gl.uniform1i(u.uControls, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fresnelTexture);
    gl.uniform1i(u.uFresnel, 1);
    gl.uniform4fv(u.uBasis, this.basis);
    gl.uniform4fv(u.uDerivative, this.derivative);
    gl.uniform1i(u.uGrid, this.grid);
    gl.uniform1f(u.uAspectCorrection, (16 / 9) / aspect);
    gl.uniform1f(u.uGuardClip, 1 + 8 / Math.max(1, this.target.width));
    gl.uniform3fv(u.uWave, wave);
    gl.uniform1f(u.uBrightness, brightness);
    gl.uniform3fv(u.uMaterial, this.waveMaterial);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  };
  Renderer.prototype.particlePass = function (program, u, aspect, brightness) {
    var gl = this.gl, m = this.material, rows = this.materialRows, ref = this.simulation.reference;
    gl.useProgram(program);
    gl.bindVertexArray(this.particleVAO);
    for (var name in m)
      if (u[name] !== undefined && name !== 'uModelviewProjection')
        gl.uniform4fv(u[name], m[name]);
    rows.set(m.uModelviewProjection);
    for (var k = 0; k < 4; k++)
      rows[k] *= (16 / 9) / aspect;
    gl.uniform4fv(u.uModelviewProjection, rows);
    gl.uniform4fv(u.uColor, this.colorVector);
    gl.uniform1f(u.uGamma, brightness);
    gl.uniform1f(u.uIridescentExponent, ref.particleMaterial['iridescent exp']);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.iridescenceTexture);
    gl.uniform1i(u.uIridescent, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.lastCount);
  };
  // Re-render the 64x32 monthly background when its clock uniforms change.
  // In auto mode that's once a second, 2,048 fragments, nothing to schedule.
  Renderer.prototype.monthlyPass = function (monthly) {
    var clock = root.LGXMBPS3BackgroundClock, gl = this.gl;
    if (!clock || !this.monthlyTexture)
      return false;
    var coordinates = monthly.auto ? clock.fromLocalDate(new Date()) : clock.calendar(monthly.month, 1, monthly.period === 'night' ? 0 : 12);
    // Day/night controls as retained in the RPCS3 dump's background object,
    // not the menu constructor defaults: night blend 0.5, dawn to 05:10,
    // dusk 18:30 to 20:20, day spread 2.68. The defaults left dawn black.
    var u = clock.uniforms(coordinates, RETAINED_DAY_NIGHT, 1), key = JSON.stringify(u);
    if (key === this.monthlyKey)
      return true;
    this.monthlyKey = key;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.monthlyFbo);
    gl.viewport(0, 0, 64, 32);
    gl.disable(gl.BLEND);
    gl.useProgram(this.monthlyProgram);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.monthlyArray);
    var m = this.uniforms.monthly;
    gl.uniform1i(m.uTextures, 0);
    gl.uniform1fv(m.uLayers, new Float32Array(u.layers));
    Object.keys(u.values).forEach(function (name) { if (m[name]) gl.uniform1f(m[name], u.values[name]); });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  };
  // Rows the projected sheet can reach: the spline stays inside the convex
  // hull of its control points, and that holds for y/w too while w>0, so the
  // control points' NDC extent bounds the surface. Margin covers the FXAA
  // search and the softness taps. Guards only extend x.
  Renderer.prototype.band = function (h) {
    var c = this.simulation.wave.controls, lo = 1, hi = -1;
    for (var i = 0; i < c.length; i += 4) {
      var w = c[i + 3];
      if (w <= 0.00001) return [0, 1];
      var y = c[i + 1] / w;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    var margin = 24 / Math.max(1, h);
    return [Math.max(0, (lo + 1) * 0.5 - margin), Math.min(1, (hi + 1) * 0.5 + margin)];
  };
  // Cached full-size backdrop: the bicubic upsample of the monthly pass,
  // re-rendered only when its clock uniforms or the output size change.
  Renderer.prototype.backdropPass = function (w, h) {
    var gl = this.gl, key = this.monthlyKey + '@' + w + 'x' + h;
    if (this.backdrop && (this.backdrop.width !== w || this.backdrop.height !== h)) {
      this.releaseTarget(this.backdrop);
      this.backdrop = null;
    }
    if (!this.backdrop) {
      this.backdrop = this.allocate(w, h, 0);
      this.allocations++;
    }
    if (key === this.backdropKey)
      return;
    this.backdropKey = key;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.backdrop.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.backdropProgram);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.monthlyTexture);
    gl.uniform1i(this.uniforms.backdrop.uMonthly, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  Renderer.prototype.draw = function (w, h, wave, brightness, background, palette) {
    if (!this.ready || this.dead)
      return false;
    this.updateGrid();
    this.resize(w, h);
    var monthly = !!(palette && palette.monthly && this.monthlyPass(palette.monthly));
    if (monthly)
      this.backdropPass(w, h);
    var band = this.band(h);
    this.outputWidth = w; this.outputHeight = h;
    var gl = this.gl, t = this.target, p = this.simulation.particles;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.msaaFbo || t.framebuffer);
    gl.viewport(0, 0, t.width, t.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
    this.wavePass(w / h, wave, brightness);
    this.lastCount = 0;
    if (t.msaaFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.framebuffer);
      gl.blitFramebuffer(0, 0, t.width, t.height, 0, 0, t.width, t.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.compositeProgram);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, monthly ? this.backdrop.texture : t.texture);
    gl.activeTexture(gl.TEXTURE0);
    var u = this.uniforms.composite;
    gl.uniform1i(u.uScene, 0);
    gl.uniform1i(u.uBackdrop, 1);
    gl.uniform1i(u.uBackdropEnabled, monthly ? 1 : 0);
    gl.uniform2f(u.uBand, band[0], band[1]);
    gl.uniform2f(u.uTexel, 1 / w, 1 / h);
    gl.uniform3fv(u.uTuning, this.filterTunings[this.settings.strength]);
    gl.uniform1i(u.uCoverage, this.settings.postprocess === 'wave' ? 1 : 0);
    gl.uniform1f(u.uSoftness, this.settings.softness);
    gl.uniform1i(u.uFilter, this.settings.postprocess !== 'off' ? 1 : 0);
    gl.uniform3fv(u.uBackground, background);
    gl.uniform3fv(u.uWave, wave);
    gl.uniform1i(u.uColorEnabled, palette && palette.start ? 1 : 0);
    if (palette && palette.start) {
      gl.uniform3fv(u.uColorStart, palette.start);
      gl.uniform3fv(u.uColorEnd, palette.end);
      gl.uniform2fv(u.uColorDir, palette.dir);
      gl.uniform2fv(u.uColorRange, palette.range);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Filtering belongs to the wave, never the launcher's text or tiny sparkles.
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
    if (this.settings.particles) {
      this.lastCount = Math.min(p.count, this.settings.particleCount);
      if (this.particleRevision !== p.revision || !this.particlesUploaded) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, p.render, 0, p.count * 8);
        this.particleRevision = p.revision;
        this.particlesUploaded = true;
        this.uploadedBytes += p.count * 32;
      }
      this.particlePass(this.particleProgram, this.uniforms.particle, w / h, brightness);
      this.particlePass(this.glareProgram, this.uniforms.glare, w / h, brightness);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    this.drawCount++;
    var changed = this.changed;
    this.changed = false;
    return changed;
  };
  Renderer.prototype.diagnostics = function () {
    var p = this.simulation.particles;
    return { renderer: 'ps3-native-webgl2', shaderLanguage: 'GLSL ES 3.00', reference: '3.01 runtime buffers',
      surfaceWidth: this.width, surfaceHeight: this.height, requestedScale: this.settings.sampling, effectiveScale: this.effectiveScale,
      samplingFallback: this.samplingFallback, msaaSupported: this.msaaSupported.slice(), msaaSamples: this.msaaSamples, msaaFallback: this.msaaFallback,
      detail: this.settings.detail, detailAlias: this.settings.detail === 'fine' ? 'Original 128 x 128 grid' : null, grid: this.grid, vertices: this.grid * this.grid, postprocess: this.settings.postprocess,
      postprocessImplementation: 'GLSL ES 3.00 FXAA; particles excluded', postWidth: this.outputWidth, postHeight: this.outputHeight, postprocessFallback: null,
      particleCount: this.lastCount, particleCapacity: p.capacity, particlesFallback: null, particleRespawnPolicy: 'captured-distribution recycling',
      fidelity: { geometry: 'fixture-validated', particleUpdate: 'fixture-validated', opticalBindings: this.simulation.reference.optics ? 'retained material uniforms; inferred projection' : 'provisional', compositing: 'adapted', emitter: 'port policy' },
      draws: this.drawCount, allocations: this.allocations, uploadedBytes: this.uploadedBytes, perFrameReadbacks: 0,
      waveTicks: this.simulation.wave.ticks, particleTicks: p.ticks, recycledParticles: p.recycled,
      renderTargetBytes: this.target ? this.width * this.height * 4 * (1 + this.msaaSamples) : 0 };
  };
  Renderer.prototype.destroy = function (lost) {
    if (this.dead)
      return;
    this.dead = true;
    if (!lost) {
      this.releaseTarget(this.target);
      this.releaseTarget(this.backdrop);
      var gl = this.gl;
      this.objects.reverse().forEach(function (o) { gl['delete' + o[0]](o[1]); });
    }
    this.target = null;
    this.backdrop = null;
    this.objects = [];
    this.programs = [];
  };
  function C5Wave(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function')
      throw new TypeError('A canvas is required');
    this.canvas = canvas;
    this.options = options || {};
    this.gl = null;
    this.renderer = null;
    this.simulation = null;
    this.mode = 'pending';
    this.error = null;
    this.contextVersion = 0;
    this.contextLost = false;
    this.destroyed = false;
    this.background = color('#08101c');
    this.wave = color('#518aab');
    this.palette = null;
    this.speed = 1.5;
    this.brightness = 1;
    this.ps3Quality = quality();
    this.paused = false;
    this.time = 0;
    this.lastFrame = 0;
    this.raf = 0;
    this.initRaf = 0;
    this.compileRaf = 0;
    this.initialized = false;
    this.resizePending = false;
    this.documentHidden = !!document.hidden;
    this.qualityIndex = this.options.quality === '540p' ? 2 : this.options.quality === '720p' ? 1 : 0;
    this.adaptive = false;
    this.capabilities = null;
    this.compileMs = null;
    this.onRenderStatus = this.options.onRenderStatus;
    this.media = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reducedMotion = !!(this.media && this.media.matches);
    this.tickBound = this.tick.bind(this);
    this.resizeBound = this.resize.bind(this);
    this.visibilityBound = this.visibility.bind(this);
    this.motionBound = function (e) { this.setReducedMotion(e.matches); }.bind(this);
    this.lostBound = function (e) { e.preventDefault(); this.contextLost = true; this.cancel(); }.bind(this);
    this.restoredBound = function () {
      if (this.destroyed)
        return;
      this.contextLost = false;
      if (this.renderer)
        this.renderer.destroy(true);
      this.renderer = null;
      this.gl = null;
      this.initialized = false;
      this.mode = 'pending';
      this.resume();
    }.bind(this);
    canvas.addEventListener('webglcontextlost', this.lostBound);
    canvas.addEventListener('webglcontextrestored', this.restoredBound);
    document.addEventListener('visibilitychange', this.visibilityBound);
    root.addEventListener('resize', this.resizeBound);
    if (this.media) {
      if (this.media.addEventListener)
        this.media.addEventListener('change', this.motionBound);
      else
        this.media.addListener(this.motionBound);
    }
    if (root.ResizeObserver) {
      this.observer = new root.ResizeObserver(this.resizeBound);
      this.observer.observe(canvas);
    }
    this.resume();
  }
  C5Wave.prototype.allowed = function () { return !this.destroyed && !this.contextLost && !this.paused && !document.hidden; };
  C5Wave.prototype.fail = function (error) {
    this.error = String(error.message || error);
    this.mode = 'static';
    this.cancel();
    if (this.renderer)
      this.renderer.destroy(this.contextLost);
    this.renderer = null;
    this.canvas.style.background = 'linear-gradient(160deg,#111e31,#061017 68%,#04080d)';
    if (this.onRenderStatus)
      this.onRenderStatus();
  };
  C5Wave.prototype.initialize = function () {
    if (!this.allowed())
      return;
    this.initialized = true;
    try {
      this.gl = this.canvas.getContext('webgl2', { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      if (!this.gl)
        throw new Error('WebGL 2 unavailable; using static backdrop');
      var gl = this.gl;
      this.contextVersion = 2;
      this.capabilities = { version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxRenderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        maxViewport: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)), contextAttributes: gl.getContextAttributes() };
      if (!this.simulation)
        this.simulation = new Simulation(root.LGXMBPS3Reference);
      this.renderer = new Renderer(gl, this.simulation, this.ps3Quality);
      this.mode = 'compiling';
      this.compileStarted = performance.now();
      this.pollCompile();
    }
    catch (error) {
      this.fail(error);
    }
  };
  C5Wave.prototype.pollCompile = function () {
    if (!this.allowed())
      return;
    try {
      if (this.renderer.compiled()) {
        this.renderer.finish();
        this.mode = 'webgl';
        this.error = null;
        this.compileMs = performance.now() - this.compileStarted;
        this.resize();
        this.resume();
      }
      else if (performance.now() - this.compileStarted > 30000)
        throw new Error('Native shader compilation timed out');
      else
        this.compileRaf = root.requestAnimationFrame(function () { this.compileRaf = 0; this.pollCompile(); }.bind(this));
    }
    catch (error) {
      this.fail(error);
    }
  };
  C5Wave.prototype.resize = function () {
    if (!this.allowed()) {
      this.resizePending = true;
      return false;
    }
    this.resizePending = false;
    var rect = this.canvas.getBoundingClientRect(), width = rect.width || root.innerWidth || 1920, height = rect.height || root.innerHeight || 1080;
    var cap = [[1920, 1080], [1280, 720], [960, 540]][this.qualityIndex], scale = Math.min(root.devicePixelRatio || 1, cap[0] / width, cap[1] / height);
    if (this.capabilities)
      scale = Math.min(scale, this.capabilities.maxRenderbuffer / width, this.capabilities.maxRenderbuffer / height, this.capabilities.maxViewport[0] / width, this.capabilities.maxViewport[1] / height);
    var w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale)), changed = w !== this.canvas.width || h !== this.canvas.height;
    if (changed) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.draw();
    }
    return changed;
  };
  C5Wave.prototype.draw = function () {
    if (!this.allowed() || this.mode !== 'webgl')
      return;
    try {
      this.renderer.configure(this.ps3Quality);
      var changed = this.renderer.draw(this.canvas.width, this.canvas.height, this.wave, this.brightness, this.background, this.palette);
      if (changed && this.onRenderStatus)
        this.onRenderStatus();
    }
    catch (error) {
      this.fail(error);
    }
  };
  C5Wave.prototype.cancel = function () {
    if (this.raf)
      root.cancelAnimationFrame(this.raf);
    if (this.initRaf)
      root.cancelAnimationFrame(this.initRaf);
    if (this.compileRaf)
      root.cancelAnimationFrame(this.compileRaf);
    this.raf = this.initRaf = this.compileRaf = 0;
    this.lastFrame = 0;
  };
  C5Wave.prototype.resume = function () {
    if (!this.allowed())
      return;
    if (!this.initialized) {
      if (!this.initRaf)
        this.initRaf = root.requestAnimationFrame(function () { this.initRaf = root.requestAnimationFrame(function () { this.initRaf = 0; this.initialize(); }.bind(this)); }.bind(this));
      return;
    }
    if (this.mode === 'compiling') {
      if (!this.compileRaf)
        this.pollCompile();
      return;
    }
    if (this.resizePending)
      this.resize();
    this.draw();
    if (!this.reducedMotion && this.mode === 'webgl' && !this.raf)
      this.raf = root.requestAnimationFrame(this.tickBound);
  };
  C5Wave.prototype.tick = function (now) {
    this.raf = 0;
    if (!this.allowed() || this.reducedMotion)
      return;
    var interval = 1000 / this.ps3Quality.frameRate;
    if (!this.lastFrame)
      this.lastFrame = now - interval;
    // Draw once at least an interval minus half a vsync has gone by. The old
    // 33.3 ms grid with a 0.5 ms tolerance slipped about once a second on the
    // C5, whose rAF timestamps jitter more than that: one frame held for
    // three vsyncs, the next shown for one. A late frame is not chased with
    // an early one. The simulation keeps its own 60 Hz fixed step either way.
    if (now - this.lastFrame >= interval - 8) {
      var seconds = Math.min(.1, Math.max(0, (now - this.lastFrame) / 1000)) * this.speed / 1.5;
      try {
        this.simulation.advance(seconds, this.ps3Quality.particles);
      }
      catch (error) {
        this.fail(error);
        return;
      }
      this.time += seconds;
      this.lastFrame = now;
      this.draw();
    }
    if (this.mode === 'webgl' && !this.raf)
      this.raf = root.requestAnimationFrame(this.tickBound);
  };
  C5Wave.prototype.visibility = function () { this.documentHidden = !!document.hidden; if (document.hidden)
    this.cancel();
  else
    this.resume(); };
  C5Wave.prototype.setPaused = function (v) { v = !!v; if (this.destroyed || this.paused === v)
    return; this.paused = v; this.cancel(); if (!v)
    this.resume(); };
  C5Wave.prototype.setReducedMotion = function (v) { v = !!v; if (this.destroyed || this.reducedMotion === v)
    return; this.reducedMotion = v; this.cancel(); this.resume(); };
  C5Wave.prototype.setQuality = function (o) { if (this.destroyed)
    return; var q = quality(o, this.ps3Quality); if (!same(q, this.ps3Quality)) {
    this.ps3Quality = q;
    this.draw();
  } };
  C5Wave.prototype.setTheme = function (theme) {
    if (this.destroyed)
      return;
    theme = theme || {};
    this.background = color(theme.background, this.background);
    this.wave = color(theme.wave, this.wave);
    this.palette = root.LGXMBWaveColors ? root.LGXMBWaveColors.resolve(theme.colors) : null;
    if (this.palette)
      this.wave = this.palette.tint.slice();
    this.draw();
  };
  C5Wave.prototype.setStyle = function (o) {
    if (this.destroyed)
      return;
    o = o || {};
    if ([.5, 1, 1.5, 2.25].indexOf(o.speed) >= 0)
      this.speed = o.speed;
    if ([.6, 1, 1.5].indexOf(o.brightness) >= 0 && this.brightness !== o.brightness) {
      this.brightness = o.brightness;
      this.draw();
    }
  };
  C5Wave.prototype.getDiagnostics = function () {
    return { mode: this.mode, pattern: 'ps3', contextVersion: this.contextVersion, capabilities: this.capabilities,
      renderQuality: Object.assign({}, this.ps3Quality), surface: this.renderer ? this.renderer.diagnostics() : null,
      parallelShaderCompile: !!(this.renderer && this.renderer.parallel), compileMs: this.compileMs, quality: ['1080p', '720p', '540p'][this.qualityIndex],
      backingWidth: this.canvas.width, backingHeight: this.canvas.height, targetFps: this.ps3Quality.frameRate, simulationHz: 60, adaptive: false,
      reducedMotion: this.reducedMotion, paused: this.paused, error: this.error, speed: this.speed, brightness: this.brightness, time: this.time };
  };
  C5Wave.prototype.destroy = function () {
    if (this.destroyed)
      return;
    this.destroyed = true;
    this.cancel();
    document.removeEventListener('visibilitychange', this.visibilityBound);
    root.removeEventListener('resize', this.resizeBound);
    this.canvas.removeEventListener('webglcontextlost', this.lostBound);
    this.canvas.removeEventListener('webglcontextrestored', this.restoredBound);
    if (this.observer)
      this.observer.disconnect();
    if (this.media) {
      if (this.media.removeEventListener)
        this.media.removeEventListener('change', this.motionBound);
      else
        this.media.removeListener(this.motionBound);
    }
    if (this.renderer)
      this.renderer.destroy(this.contextLost);
    this.renderer = null;
    this.gl = null;
    this.simulation = null;
  };
  // Compatibility with the launcher's public controller API, not the old renderer.
  C5Wave.prototype._draw = C5Wave.prototype.draw;
  root.LGXMBPS3Wave = Object.freeze({ quality: quality });
  root.LGXMBPS3Native = Object.freeze({ Renderer: Renderer, Simulation: Simulation, quality: quality });
  root.C5Wave = C5Wave;
})(window);
