/* lg-xmb, 2026. SPDX-License-Identifier: GPL-3.0-or-later
 * Native WebGL 2 / GLSL ES 3.00 renderer. Small CPU simulation; GPU spline
 * evaluation and instanced quads. No WebGL 1 shader translation or fallback.
 * Reference arithmetic, optical bindings and port policies: docs/WEBGL2.md.
 */
(function (root) {
  'use strict';
  var Core = root.LGXMBPS3Core,
    Shaders = root.LGXMBPS3Shaders;
  var MOTION_EASE_MS = 220;
  var DEFAULT = {
    sampling: 1,
    detail: 'high',
    softness: 1.5,
    postprocess: 'off',
    strength: 'normal',
    particles: false,
    particleCount: 2000,
    frameRate: 60
  };
  function quality(options, previous) {
    var p = previous || DEFAULT,
      o = options || {};
    function select(name, allowed) {
      return allowed.indexOf(o[name]) >= 0 ? o[name] : p[name];
    }
    return {
      sampling: select('sampling', [1, 1.25, 1.5, 2]),
      detail: o.detail === 'fine' ? 'high' : select('detail', ['low', 'standard', 'high']),
      softness: o.softness === 0.75 ? 1.5 : select('softness', [0, 1.5, 3]),
      postprocess: o.postprocess === 'fxaa' ? 'wave' : select('postprocess', ['off', 'wave']),
      strength: select('strength', ['gentle', 'normal', 'strong']),
      particles: typeof o.particles === 'boolean' ? o.particles : p.particles,
      particleCount: select('particleCount', [500, 1000, 2000, 4000]),
      frameRate: select('frameRate', [30, 60])
    };
  }
  function same(a, b) {
    return Object.keys(DEFAULT).every(function (k) {
      return a[k] === b[k];
    });
  }
  function color(value, fallback) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
      return [
        parseInt(value.slice(1, 3), 16) / 255,
        parseInt(value.slice(3, 5), 16) / 255,
        parseInt(value.slice(5, 7), 16) / 255
      ];
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      value.every(function (x) {
        return Number.isFinite(x) && x >= 0 && x <= 1;
      })
    )
      return value.slice();
    return fallback;
  }
  function transpose(m) {
    var out = new Float32Array(16);
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) out[i * 4 + j] = m[j * 4 + i];
    return out;
  }
  function Simulation(reference) {
    if (!Core || !reference || reference.format !== 1)
      throw new Error('Local PS3 reference pack missing. Run tools/import-ps3-reference.py.');
    this.reference = reference;
    this.wave = new Core.Wave(reference.wave, reference.settings);
    // With the emitter the pool grows to 4096 slots, so the High density has
    // room. The extra slots start dead and borrow a captured orientation, cause
    // the console's allocator keeps whatever quaternion a slot already holds and
    // how it fills a fresh pool isn't recovered.
    var records = reference.particles,
      captured = records.length / 12;
    if (root.LGXMBRecoveredParticleBirth && captured < 4096) {
      var grown = new Float32Array(4096 * 12);
      grown.set(records);
      for (var slot = captured; slot < 4096; slot++) {
        grown[slot * 12 + 3] = Core.DEAD;
        for (var q = 8; q < 12; q++) grown[slot * 12 + q] = records[(slot % captured) * 12 + q];
      }
      records = grown;
    }
    this.particles = new Core.Particles(records, new Core.Parameters(reference.particleParams));
    // Births come from the moving sheet when the recovered host equations are
    // loaded. Without them the captured particles are recycled, as before.
    if (root.LGXMBRecoveredParticleBirth) {
      this.particles.emitter = new Core.Emitter(
        this.wave,
        this.particles,
        reference.basis,
        reference.viewProjection,
        root.LGXMBRecoveredParticleBirth
      );
      this.particles.interaction = new Core.Interaction(
        this.particles,
        root.LGXMBRecoveredParticleBirth
      );
    }
    this.elapsed = 0;
    this.steps = 0;
    this.respawn = true;
  }
  Simulation.prototype.advance = function (seconds, particlesEnabled) {
    if (!seconds) return;
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
    this.uniforms = {};
    this.filterTunings = {
      gentle: new Float32Array([0.015625, 0.125, 0.5]),
      normal: new Float32Array([0.0078125, 0.0833333, 0.75]),
      strong: new Float32Array([0.00390625, 0.0625, 1])
    };
    this.particlesUploaded = false;
    var limit = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    this.maxDimension = Math.min(3840, limit, gl.getParameter(gl.MAX_TEXTURE_SIZE), vp[0], vp[1]);
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    try {
      this.waveProgram = this.program(Shaders.waveVertex, Shaders.waveFragment, [
        'tfPosition',
        'tfNormal'
      ]);
      this.particleProgram = this.program(Shaders.particleVertex, Shaders.particleFragment);
      this.glareProgram = this.program(Shaders.glareVertex, Shaders.glareFragment);
      this.compositeProgram = this.program(Shaders.fullscreenVertex, Shaders.compositeFragment);
      this.monthlyProgram = this.program(Shaders.fullscreenVertex, Shaders.monthlyBackground);
      this.backdropProgram = this.program(Shaders.fullscreenVertex, Shaders.backdropFragment);
    } catch (error) {
      this.destroy(false);
      throw error;
    }
  }
  Renderer.prototype.resource = function (kind) {
    var gl = this.gl,
      value = gl['create' + kind]();
    if (!value) throw new Error('Could not allocate ' + kind);
    this.objects.push([kind, value]);
    return value;
  };
  Renderer.prototype.program = function (vertex, fragment, varyings) {
    var gl = this.gl,
      p = this.resource('Program'),
      self = this;
    [vertex, fragment].forEach(function (source, index) {
      if (!source.startsWith('#version 300 es\n')) throw new Error('Expected GLSL ES 3.00 shader');
      var s = gl.createShader(index ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER);
      if (!s) throw new Error('Shader allocation failed');
      self.objects.push(['Shader', s]);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      gl.attachShader(p, s);
    });
    if (varyings) gl.transformFeedbackVaryings(p, varyings, gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(p);
    this.programs.push(p);
    return p;
  };
  Renderer.prototype.compiled = function () {
    var self = this;
    return (
      !this.parallel ||
      this.programs.every(function (p) {
        return self.gl.getProgramParameter(p, self.parallel.COMPLETION_STATUS_KHR);
      })
    );
  };
  Renderer.prototype.locations = function (program) {
    var gl = this.gl,
      map = {},
      count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var u = gl.getActiveUniform(program, i),
        name = u.name.replace(/\[0\]$/, '');
      map[name] = gl.getUniformLocation(program, name);
    }
    return map;
  };
  Renderer.prototype.texture = function (width, height, pixels, format, type, filter, channels) {
    var gl = this.gl,
      t = this.resource('Texture');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (pixels)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, channels || gl.RGBA, type, pixels);
    return t;
  };
  // Only the 2,048-pixel colour intermediate uses FP16. Full-size targets
  // stay 32 bits per pixel: RGBA8 for the wave, RGB10_A2 for the backdrop.
  Renderer.prototype.prepareMonthlyTarget = function () {
    var gl = this.gl;
    this.releaseTarget(this.monthlyTarget);
    this.monthlyTarget = null;
    this.monthlyTexture = null;
    this.monthlyFbo = null;
    this.monthlyKey = '';
    if (
      gl.getExtension('EXT_color_buffer_float') ||
      gl.getExtension('EXT_color_buffer_half_float')
    ) {
      try {
        this.monthlyTarget = this.allocate(64, 32, gl.RGBA16F);
      } catch (ignored) {
        /* A refused optional target must not disable the waves. */
      }
    }
    if (!this.monthlyTarget) {
      try {
        this.monthlyTarget = this.allocate(64, 32);
      } catch (ignored) {
        return;
      }
    }
    this.monthlyTexture = this.monthlyTarget.texture;
    this.monthlyFbo = this.monthlyTarget.framebuffer;
  };
  Renderer.prototype.finish = function () {
    if (this.ready || this.dead) return;
    var gl = this.gl,
      reference = this.simulation.reference;
    this.programs.forEach(function (p) {
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        var log = gl.getProgramInfoLog(p) || 'Native shader link failed';
        (gl.getAttachedShaders(p) || []).forEach(function (s) {
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) log += '\n' + gl.getShaderInfoLog(s);
        });
        throw new Error(log);
      }
    });
    this.objects = this.objects.filter(function (entry) {
      if (entry[0] === 'Shader') {
        gl.deleteShader(entry[1]);
        return false;
      }
      return true;
    });
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
    this.fresnelTexture = this.texture(
      reference.fresnel.width,
      reference.fresnel.height,
      reference.fresnel.rgba,
      gl.RGBA8,
      gl.UNSIGNED_BYTE,
      gl.LINEAR
    );
    this.iridescenceTexture = this.texture(
      reference.iridescence.width,
      reference.iridescence.height,
      reference.iridescence.rgba,
      gl.RGBA8,
      gl.UNSIGNED_BYTE,
      gl.LINEAR
    );
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
    if (
      months &&
      months.width === 64 &&
      months.height === 32 &&
      months.layers === 24 &&
      months.rgba.length === 64 * 32 * 4 * 24
    ) {
      this.monthlyArray = this.resource('Texture');
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.monthlyArray);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 64, 32, 24);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        0,
        64,
        32,
        24,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        months.rgba
      );
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      this.prepareMonthlyTarget();
    }
    this.material = this.materialUniforms(reference);
    this.materialRows = new Float32Array(16);
    this.colorVector = this.material.uColor || new Float32Array([1, 1, 1, 0]);
    this.waveMaterial = new Float32Array([
      reference.settings.FRESNEL,
      reference.settings.BRIGHTNESS,
      reference.settings['MIPMAP BIAS']
    ]);
    this.prepareParticleMaterial(this.particleProgram, this.uniforms.particle);
    this.prepareParticleMaterial(this.glareProgram, this.uniforms.glare);
    this.ready = true;
    this.updateGrid();
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL 2 resource initialization failed');
  };
  Renderer.prototype.materialUniforms = function (reference) {
    // Root menu fallback, overridden below by named retained QGL values when
    // supplied. Projection remains inferred, unlike the tested simulation inputs.
    var m = reference.particleMaterial,
      p = this.simulation.particles.params;
    var result = {
      uLifeBoundsMin: new Float32Array([p.minimum[0], p.minimum[1], p.minimum[2], 0]),
      uLifeBoundsMax: new Float32Array([p.maximum[0], p.maximum[1], p.maximum[2], 0]),
      uModelviewProjection: transpose(reference.viewProjection),
      uModelview: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -2, 0, 0, 0, 1]),
      uLightPack: new Float32Array([
        0,
        m['spot pos x'],
        m['spot attn x'],
        m['lambert coeff'],
        0,
        m['spot pos y'],
        m['spot attn y'],
        m['specular coeff'],
        2,
        m['spot pos z'],
        m['spot attn z'],
        m.exposure,
        0,
        m['specular power'],
        0,
        m.color_control
      ]),
      uParticleSize: new Float32Array([m['size middle'], m['size near'], m['size far'], 0]),
      uFocus: new Float32Array([
        m['near focus'],
        m['near focus'] + m['near focus_dist'],
        m['far focus'],
        m['far focus'] + m['far focus_dist']
      ]),
      uFocusCurves: new Float32Array([
        m['near focus_pow'],
        m['far focus_pow'],
        0.9250245094299316,
        0
      ]),
      uFrontFacingQuaternion: new Float32Array([0, 0, 0, 1]),
      uTransparency: new Float32Array([m.fresnel, m['global alpha'], 0, 0]),
      uNearControl: new Float32Array([m['size align'], m['near fuzziness'], m['near align'], 0]),
      uDarkness: new Float32Array([m['near darkness'], m['far darkness'], 0, 0]),
      uGlare: new Float32Array([m.glare, m['glare scale'], m['glare p1'], m['glare p2']])
    };
    if (reference.optics) {
      Object.keys(reference.optics.uniforms).forEach(function (name) {
        var value = reference.optics.uniforms[name];
        if (Array.isArray(value)) result[name] = new Float32Array(value);
      });
    }
    return result;
  };
  Renderer.prototype.updateGrid = function () {
    var n = this.settings.detail === 'low' || this.settings.detail === 'standard' ? 64 : 128;
    if (this.grid === n) return;
    var gl = this.gl,
      indices = new Uint16Array((n - 1) * (n - 1) * 6 + (n - 1) * 12),
      j = 0,
      g = n * n;
    for (var y = 0; y < n - 1; y++) {
      for (var x = 0; x < n - 1; x++) {
        var a = y * n + x,
          b = a + n;
        indices[j++] = a;
        indices[j++] = b;
        indices[j++] = a + 1;
        indices[j++] = a + 1;
        indices[j++] = b;
        indices[j++] = b + 1;
      }
      // Guard quads: vertex g+2y is the right-end copy of row y, g+2y+1 the left.
      indices[j++] = g + y * 2;
      indices[j++] = g + (y + 1) * 2;
      indices[j++] = y * n;
      indices[j++] = y * n;
      indices[j++] = g + (y + 1) * 2;
      indices[j++] = (y + 1) * n;
      indices[j++] = y * n + n - 1;
      indices[j++] = (y + 1) * n + n - 1;
      indices[j++] = g + y * 2 + 1;
      indices[j++] = g + y * 2 + 1;
      indices[j++] = (y + 1) * n + n - 1;
      indices[j++] = g + (y + 1) * 2 + 1;
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
    if (!t) return;
    var gl = this.gl;
    if (t.framebuffer) gl.deleteFramebuffer(t.framebuffer);
    if (t.texture) gl.deleteTexture(t.texture);
  };
  Renderer.prototype.allocate = function (w, h, format) {
    var gl = this.gl,
      internalFormat = format || gl.RGBA8;
    if (
      internalFormat !== gl.RGBA8 &&
      internalFormat !== gl.RGB10_A2 &&
      !(internalFormat === gl.RGBA16F && w === 64 && h === 32)
    )
      throw new Error('Full-size floating-point render targets are not supported');
    var t = { width: w, height: h, format: internalFormat },
      ok = false;
    try {
      t.texture = gl.createTexture();
      t.framebuffer = gl.createFramebuffer();
      if (!t.texture || !t.framebuffer) throw new Error('No render target');
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
      var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER),
        error = gl.getError();
      if (status !== gl.FRAMEBUFFER_COMPLETE || error !== gl.NO_ERROR)
        throw new Error('Incomplete render target');
      ok = true;
      return t;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) this.releaseTarget(t);
    }
  };
  Renderer.prototype.resize = function (w, h) {
    var s = this.settings,
      key = w + 'x' + h + '@' + s.sampling;
    if (key === this.allocationKey) return;
    this.samplingFallback = null;
    var scales = [s.sampling, 1],
      last = '',
      candidate = null;
    for (var i = 0; i < scales.length && !candidate; i++) {
      var scale = Math.min(scales[i], this.maxDimension / w, this.maxDimension / h),
        sw = Math.max(1, Math.floor(w * scale)),
        sh = Math.max(1, Math.floor(h * scale));
      var size = sw + 'x' + sh;
      if (size === last) continue;
      last = size;
      if (sw * sh * 4 > 96 * 1024 * 1024) continue;
      try {
        candidate = this.allocate(sw, sh);
      } catch (error) {
        if (this.gl.isContextLost()) throw error;
      }
      if (candidate) this.effectiveScale = scale;
    }
    if (!candidate) throw new Error('WebGL 2 render target unavailable');
    if (this.effectiveScale !== s.sampling) this.samplingFallback = 'Render-target limit';
    this.releaseTarget(this.target);
    this.target = candidate;
    this.allocationKey = key;
    this.width = candidate.width;
    this.height = candidate.height;
    this.allocations++;
    this.changed = true;
  };
  Renderer.prototype.configure = function (options) {
    var next = quality(options, this.settings);
    if (!same(next, this.settings)) {
      this.settings = next;
      this.changed = true;
    }
  };
  Renderer.prototype.wavePass = function (aspect, wave, brightness) {
    var gl = this.gl,
      u = this.uniforms.wave,
      state = this.simulation.wave;
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
    gl.uniform1f(u.uAspectCorrection, 16 / 9 / aspect);
    gl.uniform1f(u.uGuardClip, 1 + 8 / Math.max(1, this.target.width));
    gl.uniform3fv(u.uWave, wave);
    gl.uniform1f(u.uBrightness, brightness);
    gl.uniform3fv(u.uMaterial, this.waveMaterial);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  };
  // Material values belong to the linked program and survive program switches.
  // Each renderer uploads them once, including after a context restoration.
  Renderer.prototype.prepareParticleMaterial = function (program, u) {
    var gl = this.gl,
      m = this.material;
    gl.useProgram(program);
    for (var name in m)
      if (u[name] !== undefined && name !== 'uModelviewProjection' && name !== 'uColor')
        gl.uniform4fv(u[name], m[name]);
    gl.uniform4fv(u.uColor, this.colorVector);
    gl.uniform1f(
      u.uIridescentExponent,
      this.simulation.reference.particleMaterial['iridescent exp']
    );
  };
  Renderer.prototype.particlePass = function (program, u, aspect, brightness) {
    var gl = this.gl,
      m = this.material,
      rows = this.materialRows;
    gl.useProgram(program);
    gl.bindVertexArray(this.particleVAO);
    rows.set(m.uModelviewProjection);
    for (var k = 0; k < 4; k++) rows[k] *= 16 / 9 / aspect;
    gl.uniform4fv(u.uModelviewProjection, rows);
    gl.uniform1f(u.uGamma, brightness);
    // A cached spatial lookup in the vertex shader, not per-fragment math.
    gl.uniform1i(u.uAmbientEnabled, this.monthlyActive ? 0 : 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.ambientTexture || this.fresnelTexture);
    gl.uniform1i(u.uAmbient, 2);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.iridescenceTexture);
    gl.uniform1i(u.uIridescent, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.lastCount);
  };
  // Re-render the 64x32 monthly background when its clock uniforms change.
  // In auto mode that's once a second, 2,048 fragments, nothing to schedule.
  Renderer.prototype.monthlyPass = function (monthly) {
    var clock = root.LGXMBPS3BackgroundClock,
      gl = this.gl;
    if (!clock || !this.monthlyTexture) return false;
    // These controls have whole-second precision. Do not allocate Date,
    // coordinate/uniform objects and JSON strings sixty times per second.
    var automatic = !!monthly.auto || monthly.period === 'auto',
      second = automatic ? Math.floor(Date.now() / 1000) : 0;
    if (
      this.monthlyKey &&
      this.monthlyRequestAuto === monthly.auto &&
      this.monthlyRequestMonth === monthly.month &&
      this.monthlyRequestPeriod === monthly.period &&
      this.monthlyRequestSecond === second
    )
      return true;
    var coordinates = clock.coordinates(
      new Date(second * 1000),
      monthly.auto,
      monthly.month,
      monthly.period
    );
    // Day/night controls as retained in the RPCS3 dump's background object,
    // not the menu constructor defaults: night blend 0.5, dawn to 05:10,
    // dusk 18:30 to 20:20, day spread 2.68. The defaults left dawn black.
    var u = clock.uniforms(coordinates, clock.retained, 1),
      key = JSON.stringify(u);
    this.monthlyRequestAuto = monthly.auto;
    this.monthlyRequestMonth = monthly.month;
    this.monthlyRequestPeriod = monthly.period;
    this.monthlyRequestSecond = second;
    if (key === this.monthlyKey) return true;
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
    Object.keys(u.values).forEach(function (name) {
      if (m[name]) gl.uniform1f(m[name], u.values[name]);
    });
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
    var c = this.simulation.wave.controls,
      lo = 1,
      hi = -1;
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
  // Opaque cached colour needs no fractional alpha. RGB10_A2 stores four
  // times as many RGB levels in the same 32 bits/texel as RGBA8. Never use a
  // full-size floating-point target; keep the existing wave path intact.
  Renderer.prototype.allocateBackdrop = function (w, h) {
    var gl = this.gl,
      target = null;
    if (this.backdropFormat !== gl.RGBA8) {
      try {
        target = this.allocate(w, h, gl.RGB10_A2);
      } catch (ignored) {
        this.backdropFormat = gl.RGBA8;
        this.backdropFallback = 'RGB10_A2 unavailable';
      }
    }
    if (!target) target = this.allocate(w, h);
    this.backdropFormat = target.format;
    return target;
  };
  // Read-only, bilinear transmission/halo lookup. Core WebGL 2 supports
  // RG16F sampling without a floating-point colour-buffer extension.
  // 8 KiB, uploaded once; no per-frame ellipse math in overlapping sprites.
  Renderer.prototype.prepareAmbient = function () {
    if (this.ambientTexture) return;
    var data = new Float32Array(64 * 32 * 2),
      gl = this.gl;
    for (var y = 0; y < 32; y++) {
      var top = 1 - (y + 0.5) / 32;
      var py = (top - 0.21) / 0.79;
      var shade = Math.max(0.08 * (1 - top / 0.55), (0.22 * (top - 0.55)) / 0.45);
      for (var x = 0; x < 64; x++) {
        var px = ((x + 0.5) / 64 - 0.57) / 0.57;
        var halo = 0.05 * Math.max(0, 1 - Math.sqrt(px * px + py * py) / 0.735391052434);
        var at = (y * 64 + x) * 2;
        data[at] = (1 - shade) * (1 - halo);
        data[at + 1] = halo;
      }
    }
    this.ambientTexture = this.texture(64, 32, data, gl.RG16F, gl.FLOAT, gl.LINEAR, gl.RG);
    this.uploadedBytes += data.byteLength;
  };
  function sameBackgroundVector(a, b) {
    if (!a || !b) return a === b;
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  // Every colour source now uses the same cache. Comparing a few controls is
  // cheap; copy/serialize them only when they change, not on every draw.
  Renderer.prototype.backdropPass = function (w, h, monthly, background, palette) {
    var gl = this.gl,
      colors = !monthly && palette && palette.start ? palette : null;
    var previous = this.backdropInputs,
      invalid = !previous || previous.monthly !== monthly;
    if (monthly) invalid = invalid || previous.monthlyKey !== this.monthlyKey;
    else
      invalid =
        invalid ||
        !sameBackgroundVector(previous.background, background) ||
        !!previous.colors !== !!colors ||
        (colors &&
          (!sameBackgroundVector(previous.colors.start, colors.start) ||
            !sameBackgroundVector(previous.colors.end, colors.end) ||
            !sameBackgroundVector(previous.colors.dir, colors.dir) ||
            !sameBackgroundVector(previous.colors.range, colors.range)));
    if (this.backdrop && (this.backdrop.width !== w || this.backdrop.height !== h)) {
      this.releaseTarget(this.backdrop);
      this.backdrop = null;
    }
    if (!this.backdrop) {
      this.backdrop = this.allocateBackdrop(w, h);
      this.allocations++;
      invalid = true;
    }
    if (!invalid) return;
    var peak = 1;
    if (!monthly)
      for (var channel = 0; channel < 3; channel++)
        peak = Math.max(
          peak,
          colors ? colors.start[channel] : background[channel] * 1.05,
          colors ? colors.end[channel] : 0
        );
    this.backdropScale = peak;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.backdrop.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.backdropProgram);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.activeTexture(gl.TEXTURE0);
    // Keep the sampler complete even on a theme-only installation. Never bind
    // the destination texture as its own input (a WebGL feedback loop).
    gl.bindTexture(gl.TEXTURE_2D, this.monthlyTexture || this.fresnelTexture);
    var u = this.uniforms.backdrop;
    gl.uniform1i(u.uMonthly, 0);
    gl.uniform1i(u.uMonthlyEnabled, monthly ? 1 : 0);
    gl.uniform1f(u.uBackdropScale, this.backdropScale);
    gl.uniform3fv(u.uBackground, background);
    gl.uniform1i(u.uColorEnabled, colors ? 1 : 0);
    if (colors) {
      gl.uniform3fv(u.uColorStart, colors.start);
      gl.uniform3fv(u.uColorEnd, colors.end);
      gl.uniform2fv(u.uColorDir, colors.dir);
      gl.uniform2fv(u.uColorRange, colors.range);
    }
    gl.uniform1f(u.uCacheLevels, this.backdrop.format === gl.RGB10_A2 ? 1023 : 255);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.backdropInputs = {
      monthly: monthly,
      monthlyKey: this.monthlyKey,
      background: background.slice(),
      colors: colors
        ? {
            start: colors.start.slice(),
            end: colors.end.slice(),
            dir: colors.dir.slice(),
            range: colors.range.slice()
          }
        : null
    };
    this.backdropRenders = (this.backdropRenders || 0) + 1;
  };
  Renderer.prototype.draw = function (w, h, wave, brightness, background, palette) {
    if (!this.ready || this.dead) return false;
    this.updateGrid();
    this.resize(w, h);
    var monthly = !!(palette && palette.monthly && this.monthlyPass(palette.monthly));
    this.monthlyActive = monthly;
    if (!monthly) this.prepareAmbient();
    this.backdropPass(w, h, monthly, background, palette);
    var band = this.band(h);
    this.outputWidth = w;
    this.outputHeight = h;
    var gl = this.gl,
      t = this.target,
      p = this.simulation.particles;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
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

    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.compositeProgram);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backdrop.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.ambientTexture || this.fresnelTexture);
    gl.activeTexture(gl.TEXTURE0);
    var u = this.uniforms.composite;
    gl.uniform1i(u.uScene, 0);
    gl.uniform1i(u.uBackdrop, 1);
    gl.uniform1i(u.uAmbient, 2);
    gl.uniform1f(u.uBackdropScale, this.backdropScale);
    gl.uniform1i(u.uAmbientEnabled, monthly ? 0 : 1);
    gl.uniform2f(u.uBand, band[0], band[1]);
    gl.uniform2f(u.uTexel, 1 / w, 1 / h);
    gl.uniform3fv(u.uTuning, this.filterTunings[this.settings.strength]);
    gl.uniform1f(u.uSoftness, this.settings.softness);
    gl.uniform1i(u.uFilter, this.settings.postprocess !== 'off' ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Filtering belongs to the wave, never the launcher's text or tiny sparkles.
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
    if (this.settings.particles) {
      if (p.emitter) p.emitter.limit = this.settings.particleCount;
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
    return {
      renderer: 'ps3-native-webgl2',
      shaderLanguage: 'GLSL ES 3.00',
      reference: '3.01 runtime buffers',
      surfaceWidth: this.width,
      surfaceHeight: this.height,
      requestedScale: this.settings.sampling,
      effectiveScale: this.effectiveScale,
      samplingFallback: this.samplingFallback,
      detail: this.settings.detail,
      grid: this.grid,
      vertices: this.grid * this.grid,
      postprocess: this.settings.postprocess,
      postprocessImplementation: 'GLSL ES 3.00 FXAA; particles excluded',
      postWidth: this.outputWidth,
      postHeight: this.outputHeight,
      postprocessFallback: null,
      gradientOutput: {
        active: this.monthlyActive === true,
        intermediate: this.monthlyTarget
          ? this.monthlyTarget.format === this.gl.RGBA16F
            ? 'RGBA16F'
            : 'RGBA8'
          : null,
        cache: this.backdrop
          ? this.backdrop.format === this.gl.RGB10_A2
            ? 'RGB10_A2'
            : 'RGBA8'
          : null,
        fallback: this.backdropFallback || null,
        cacheBytes: this.backdrop ? this.backdrop.width * this.backdrop.height * 4 : 0,
        dither: 'screen-fixed single hash, +/-1 display code',
        ambientOverlay: false,
        ambientStage: this.monthlyActive ? 'none' : 'cached',
        pipelineRevision: 'cached-colour-mediump-1',
        backdropRenders: this.backdropRenders || 0,
        ambientBytes: this.ambientTexture ? 8192 : 0,
        compositePrecision: 'mediump colour and output; highp coordinates and hash'
      },
      particleCount: this.lastCount,
      particleCapacity: p.capacity,
      particlesFallback: null,
      particleRespawnPolicy: p.emitter
        ? 'recovered host emitter: births on the moving sheet'
        : 'captured-distribution recycling',
      particleBirths: p.emitter ? p.emitter.births : 0,
      particleBirthsRefused: p.emitter ? p.emitter.refused : 0,
      fidelity: {
        geometry: 'fixture-validated',
        particleUpdate: 'fixture-validated',
        opticalBindings: this.simulation.reference.optics
          ? 'retained material uniforms; inferred projection'
          : 'provisional',
        compositing: 'adapted',
        emitter: 'port policy'
      },
      draws: this.drawCount,
      allocations: this.allocations,
      uploadedBytes: this.uploadedBytes,
      perFrameReadbacks: 0,
      waveTicks: this.simulation.wave.ticks,
      particleTicks: p.ticks,
      recycledParticles: p.recycled,
      renderTargetBytes: this.target ? this.width * this.height * 4 : 0
    };
  };
  Renderer.prototype.destroy = function (lost) {
    if (this.dead) return;
    this.dead = true;
    if (!lost) {
      this.releaseTarget(this.target);
      this.releaseTarget(this.backdrop);
      this.releaseTarget(this.monthlyTarget);
      var gl = this.gl;
      this.objects.reverse().forEach(function (o) {
        gl['delete' + o[0]](o[1]);
      });
    }
    this.target = null;
    this.backdrop = null;
    this.monthlyTarget = null;
    this.monthlyTexture = null;
    this.monthlyFbo = null;
    this.ambientTexture = null;
    this.backdropInputs = null;
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
    this.motionHeld = false;
    this.motionGain = 1;
    this.motionFrom = 1;
    this.motionElapsed = MOTION_EASE_MS;
    this.time = 0;
    this.lastFrame = 0;
    this.raf = 0;
    this.initRaf = 0;
    this.compileRaf = 0;
    this.clockTimer = 0;
    this.initialized = false;
    this.resizePending = false;
    this.documentHidden = !!document.hidden;
    this.qualityIndex =
      this.options.quality === '540p' ? 2 : this.options.quality === '720p' ? 1 : 0;
    this.adaptive = false;
    this.capabilities = null;
    this.compileMs = null;
    this.onRenderStatus = this.options.onRenderStatus;
    this.media = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reducedMotion = !!(this.media && this.media.matches);
    this.tickBound = this.tick.bind(this);
    this.resizeBound = this.resize.bind(this);
    this.visibilityBound = this.visibility.bind(this);
    this.motionBound = function (e) {
      this.setReducedMotion(e.matches);
    }.bind(this);
    this.lostBound = function (e) {
      e.preventDefault();
      this.contextLost = true;
      this.cancel();
    }.bind(this);
    this.restoredBound = function () {
      if (this.destroyed) return;
      this.contextLost = false;
      if (this.renderer) this.renderer.destroy(true);
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
      if (this.media.addEventListener) this.media.addEventListener('change', this.motionBound);
      else this.media.addListener(this.motionBound);
    }
    if (root.ResizeObserver) {
      this.observer = new root.ResizeObserver(this.resizeBound);
      this.observer.observe(canvas);
    }
    this.resume();
  }
  C5Wave.prototype.allowed = function () {
    return !this.destroyed && !this.contextLost && !this.paused && !document.hidden;
  };
  C5Wave.prototype.fail = function (error) {
    this.error = String(error.message || error);
    this.mode = 'static';
    this.syncBackgroundLayer(false);
    this.cancel();
    if (this.renderer) this.renderer.destroy(this.contextLost);
    this.renderer = null;
    this.canvas.style.background = 'linear-gradient(160deg,#111e31,#061017 68%,#04080d)';
    if (this.onRenderStatus) this.onRenderStatus();
  };
  C5Wave.prototype.initialize = function () {
    if (!this.allowed()) return;
    this.initialized = true;
    try {
      // No preserveDrawingBuffer: on the C5's tiler it forced every tile to
      // load last frame's canvas before drawing and the compositor to copy
      // the canvas instead of swapping it, half of all fragment work. The
      // compositor keeps showing the last presented frame while we're
      // paused, the buffer is only cleared by the next draw.
      // preserveDrawingBuffer stays off in production; the pixel-readback
      // browser check asks for it explicitly through the constructor option.
      this.gl = this.canvas.getContext('webgl2', {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: this.options.preserveDrawingBuffer === true,
        powerPreference: 'high-performance'
      });
      if (!this.gl) throw new Error('WebGL 2 unavailable; using static backdrop');
      var gl = this.gl;
      this.contextVersion = 2;
      this.capabilities = {
        version: gl.getParameter(gl.VERSION),
        shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxRenderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        maxViewport: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)),
        contextAttributes: gl.getContextAttributes()
      };
      if (!this.simulation) this.simulation = new Simulation(root.LGXMBPS3Reference);
      this.renderer = new Renderer(gl, this.simulation, this.ps3Quality);
      this.mode = 'compiling';
      this.compileStarted = performance.now();
      this.pollCompile();
    } catch (error) {
      this.fail(error);
    }
  };
  C5Wave.prototype.pollCompile = function () {
    if (!this.allowed()) return;
    try {
      if (this.renderer.compiled()) {
        this.renderer.finish();
        this.mode = 'webgl';
        this.error = null;
        this.compileMs = performance.now() - this.compileStarted;
        this.resize();
        this.resume();
      } else if (performance.now() - this.compileStarted > 30000)
        throw new Error('Native shader compilation timed out');
      else
        this.compileRaf = root.requestAnimationFrame(
          function () {
            this.compileRaf = 0;
            this.pollCompile();
          }.bind(this)
        );
    } catch (error) {
      this.fail(error);
    }
  };
  C5Wave.prototype.resize = function () {
    if (!this.allowed()) {
      this.resizePending = true;
      return false;
    }
    this.resizePending = false;
    var rect = this.canvas.getBoundingClientRect(),
      width = rect.width || root.innerWidth || 1920,
      height = rect.height || root.innerHeight || 1080;
    var cap = [
        [1920, 1080],
        [1280, 720],
        [960, 540]
      ][this.qualityIndex],
      scale = Math.min(root.devicePixelRatio || 1, cap[0] / width, cap[1] / height);
    if (this.capabilities)
      scale = Math.min(
        scale,
        this.capabilities.maxRenderbuffer / width,
        this.capabilities.maxRenderbuffer / height,
        this.capabilities.maxViewport[0] / width,
        this.capabilities.maxViewport[1] / height
      );
    var w = Math.max(1, Math.round(width * scale)),
      h = Math.max(1, Math.round(height * scale)),
      changed = w !== this.canvas.width || h !== this.canvas.height;
    if (changed) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.draw();
    }
    return changed;
  };
  // CSS alpha gradients after the canvas can reintroduce banding and tint
  // the original PS3 colour pass. Hide that legacy decoration only while a
  // monthly frame is actually displayed. No per-frame DOM writes.
  C5Wave.prototype.syncBackgroundLayer = function (monthly) {
    // Every successful WebGL frame now includes the legacy decoration where
    // appropriate. Keep CSS only for the static fallback. No per-frame writes.
    var composited = !this.destroyed && this.mode === 'webgl';
    if (this.compositedBackgroundLayer !== composited) {
      this.compositedBackgroundLayer = composited;
      if (composited) this.canvas.setAttribute('data-background-composited', 'true');
      else this.canvas.removeAttribute('data-background-composited');
    }
    monthly = monthly === true;
    if (this.monthlyBackgroundLayer === monthly) return;
    this.monthlyBackgroundLayer = monthly;
    if (monthly) this.canvas.setAttribute('data-ps3-background', 'true');
    else this.canvas.removeAttribute('data-ps3-background');
  };
  C5Wave.prototype.clockDriven = function () {
    var s = this.colorSettings;
    return (
      !!s &&
      (((s.mode === 'ps3' || s.mode === 'monthly') &&
        (s.dateMode === 'auto' || s.timeMode === 'auto')) ||
        (s.mode === 'theme' && s.themeClock))
    );
  };
  C5Wave.prototype.refreshClock = function () {
    if (!this.colorSettings || (this.clockSecond != null && !this.clockDriven())) return;
    var second = Math.floor(Date.now() / 1000);
    if (this.clockSecond === second) return;
    this.clockSecond = second;
    var s = this.colorSettings,
      date = new Date(second * 1000),
      clock = root.LGXMBPS3BackgroundClock;
    this.palette = root.LGXMBWaveColors.resolve(s, date);
    if (this.palette) this.wave = this.palette.tint.slice();
    else if (this.themeWave) {
      var gain = 1;
      if (s.mode === 'theme' && s.themeClock && clock) {
        var blend = clock.uniforms(clock.fromLocalDate(date)).values._NightDayBlend;
        gain = clock.retained.nightBrightness + (1 - clock.retained.nightBrightness) * blend;
      }
      this.wave = this.themeWave.map(function (v) {
        return v * gain;
      });
      this.background = this.themeBackground.map(function (v) {
        return v * gain;
      });
    }
  };
  C5Wave.prototype.scheduleClock = function () {
    if (
      this.clockTimer ||
      this.motionHeld ||
      !this.reducedMotion ||
      !this.clockDriven() ||
      !this.allowed() ||
      this.mode !== 'webgl'
    )
      return;
    this.clockTimer = root.setTimeout(
      function () {
        this.clockTimer = 0;
        this.draw();
      }.bind(this),
      1000
    );
  };
  C5Wave.prototype.draw = function () {
    if (!this.allowed() || this.mode !== 'webgl') return;
    try {
      this.refreshClock();
      var changed = this.renderer.draw(
        this.canvas.width,
        this.canvas.height,
        this.wave,
        this.brightness,
        this.background,
        this.palette
      );
      this.syncBackgroundLayer(this.renderer.monthlyActive === true);
      this.scheduleClock();
      if (changed && this.onRenderStatus) this.onRenderStatus();
    } catch (error) {
      this.fail(error);
    }
  };
  C5Wave.prototype.cancel = function () {
    if (this.clockTimer) root.clearTimeout(this.clockTimer);
    this.clockTimer = 0;
    if (this.raf) root.cancelAnimationFrame(this.raf);
    if (this.initRaf) root.cancelAnimationFrame(this.initRaf);
    if (this.compileRaf) root.cancelAnimationFrame(this.compileRaf);
    this.raf = this.initRaf = this.compileRaf = 0;
    this.lastFrame = 0;
    // A hidden or lost surface does not need to finish slowing down. Keep
    // the hold through restoration, then ease up only when it is released.
    if (this.motionHeld) {
      this.motionGain = this.motionFrom = 0;
      this.motionElapsed = MOTION_EASE_MS;
    }
  };
  C5Wave.prototype.resume = function () {
    if (!this.allowed()) return;
    if (!this.initialized) {
      if (!this.initRaf)
        this.initRaf = root.requestAnimationFrame(
          function () {
            this.initRaf = root.requestAnimationFrame(
              function () {
                this.initRaf = 0;
                this.initialize();
              }.bind(this)
            );
          }.bind(this)
        );
      return;
    }
    if (this.mode === 'compiling') {
      if (!this.compileRaf) this.pollCompile();
      return;
    }
    // resize() already paints when the size changed; don't paint it twice.
    if (!(this.resizePending && this.resize())) this.draw();
    if (
      !this.reducedMotion &&
      (!this.motionHeld || this.motionGain > 0) &&
      this.mode === 'webgl' &&
      !this.raf
    )
      this.raf = root.requestAnimationFrame(this.tickBound);
  };
  C5Wave.prototype.tick = function (now) {
    this.raf = 0;
    if (!this.allowed() || this.reducedMotion) return;
    var interval = 1000 / this.ps3Quality.frameRate;
    if (!this.lastFrame) this.lastFrame = now - interval;
    // Draw once at least an interval minus half a vsync has gone by. The old
    // 33.3 ms grid with a 0.5 ms tolerance slipped about once a second on the
    // C5, whose rAF timestamps jitter more than that: one frame held for
    // three vsyncs, the next shown for one. A late frame is not chased with
    // an early one. The simulation keeps its own 60 Hz fixed step either way.
    if (now - this.lastFrame >= interval - 8) {
      var milliseconds = Math.min(100, Math.max(0, now - this.lastFrame)),
        previousGain = this.motionGain;
      if (this.motionElapsed < MOTION_EASE_MS) {
        this.motionElapsed = Math.min(MOTION_EASE_MS, this.motionElapsed + milliseconds);
        var progress = this.motionElapsed / MOTION_EASE_MS,
          eased = progress * progress * (3 - 2 * progress);
        this.motionGain = this.motionFrom + ((this.motionHeld ? 0 : 1) - this.motionFrom) * eased;
      }
      // Scale simulation time, rather than its positions or configured speed.
      // Waves and particles slow together and resume from the retained frame.
      var seconds = (milliseconds * this.speed * (previousGain + this.motionGain)) / 3000;
      try {
        this.simulation.advance(seconds, this.ps3Quality.particles);
      } catch (error) {
        this.fail(error);
        return;
      }
      this.time += seconds;
      this.lastFrame = now;
      this.draw();
    }
    if (this.motionHeld && this.motionGain === 0) this.lastFrame = 0;
    else if (this.mode === 'webgl' && !this.raf)
      this.raf = root.requestAnimationFrame(this.tickBound);
  };
  C5Wave.prototype.visibility = function () {
    this.documentHidden = !!document.hidden;
    if (document.hidden) this.cancel();
    else this.resume();
  };
  C5Wave.prototype.setPaused = function (v) {
    v = !!v;
    if (this.destroyed || this.paused === v) return;
    this.paused = v;
    this.cancel();
    if (!v) this.resume();
  };
  // A temporary visual hold is independent of saved motion/quality settings
  // and the immediate lifecycle pause used when Home is hidden.
  C5Wave.prototype.setMotionHeld = function (v) {
    v = !!v;
    if (this.destroyed || this.motionHeld === v) return;
    this.motionHeld = v;
    this.motionFrom = this.motionGain;
    this.motionElapsed = 0;
    if (v) {
      if (this.clockTimer) root.clearTimeout(this.clockTimer);
      this.clockTimer = 0;
      if (!this.allowed() || this.reducedMotion) {
        this.motionGain = this.motionFrom = 0;
        this.motionElapsed = MOTION_EASE_MS;
      }
    }
    if (!this.raf) {
      this.lastFrame = 0;
      this.resume();
    }
  };
  C5Wave.prototype.setReducedMotion = function (v) {
    v = !!v;
    if (this.destroyed || this.reducedMotion === v) return;
    this.reducedMotion = v;
    this.cancel();
    this.resume();
  };
  C5Wave.prototype.setQuality = function (o) {
    if (this.destroyed) return;
    var q = quality(o, this.ps3Quality);
    if (!same(q, this.ps3Quality)) {
      this.ps3Quality = q;
      if (this.renderer) this.renderer.configure(q);
      this.draw();
    }
  };
  C5Wave.prototype.setTheme = function (theme) {
    if (this.destroyed) return;
    theme = theme || {};
    this.themeBackground = color(theme.background, this.background);
    this.themeWave = color(theme.wave, this.wave);
    this.background = this.themeBackground.slice();
    this.wave = this.themeWave.slice();
    this.colorSettings = root.LGXMBWaveColors ? root.LGXMBWaveColors.normalize(theme.colors) : null;
    this.clockSecond = null;
    this.refreshClock();
    if (this.clockTimer) root.clearTimeout(this.clockTimer);
    this.clockTimer = 0;
    this.draw();
  };
  C5Wave.prototype.setStyle = function (o) {
    if (this.destroyed) return;
    o = o || {};
    if ([0.5, 1, 1.5, 2.25].indexOf(o.speed) >= 0) this.speed = o.speed;
    if ([0.3, 0.6, 1].indexOf(o.brightness) >= 0 && this.brightness !== o.brightness) {
      this.brightness = o.brightness;
      this.draw();
    }
  };
  // Menu hooks for the particles. Both are cheap and do nothing until the
  // simulation exists or when the recovered module isn't loaded.
  C5Wave.prototype.navigated = function (direction) {
    var i = this.simulation && this.simulation.particles.interaction,
      code = { left: 0, right: 1, up: 2, down: 3 }[direction];
    if (i && code !== undefined) i.direction(code);
  };
  C5Wave.prototype.setMenuObjects = function (targets) {
    var i = this.simulation && this.simulation.particles.interaction;
    if (i && Array.isArray(targets)) i.setObjects(targets);
  };
  C5Wave.prototype.getDiagnostics = function () {
    return {
      mode: this.mode,
      pattern: 'ps3',
      contextVersion: this.contextVersion,
      capabilities: this.capabilities,
      renderQuality: Object.assign({}, this.ps3Quality),
      surface: this.renderer ? this.renderer.diagnostics() : null,
      parallelShaderCompile: !!(this.renderer && this.renderer.parallel),
      compileMs: this.compileMs,
      quality: ['1080p', '720p', '540p'][this.qualityIndex],
      backingWidth: this.canvas.width,
      backingHeight: this.canvas.height,
      targetFps: this.ps3Quality.frameRate,
      simulationHz: 60,
      adaptive: false,
      reducedMotion: this.reducedMotion,
      paused: this.paused,
      motionHeld: this.motionHeld,
      motionGain: this.motionGain,
      motionTransitioning: this.motionElapsed < MOTION_EASE_MS,
      error: this.error,
      speed: this.speed,
      brightness: this.brightness,
      time: this.time
    };
  };
  C5Wave.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    this.syncBackgroundLayer(false);
    this.cancel();
    document.removeEventListener('visibilitychange', this.visibilityBound);
    root.removeEventListener('resize', this.resizeBound);
    this.canvas.removeEventListener('webglcontextlost', this.lostBound);
    this.canvas.removeEventListener('webglcontextrestored', this.restoredBound);
    if (this.observer) this.observer.disconnect();
    if (this.media) {
      if (this.media.removeEventListener)
        this.media.removeEventListener('change', this.motionBound);
      else this.media.removeListener(this.motionBound);
    }
    if (this.renderer) this.renderer.destroy(this.contextLost);
    this.renderer = null;
    this.gl = null;
    this.simulation = null;
  };
  // Compatibility with the launcher's public controller API, not the old renderer.
  C5Wave.prototype._draw = C5Wave.prototype.draw;
  root.LGXMBPS3Wave = Object.freeze({ quality: quality });
  root.LGXMBPS3Native = Object.freeze({
    Renderer: Renderer,
    Simulation: Simulation,
    quality: quality
  });
  root.C5Wave = C5Wave;
})(window);
