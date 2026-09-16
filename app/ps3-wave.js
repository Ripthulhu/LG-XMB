/*
 * Spline surface adapted from linkev/PlayStation-3-XMB, revision
 * 1ec453a9dddec5448d615116ff428349f42d454e (spline-reverse.js,
 * spline.js and spline-settings.js). Copyright (c) 2025 Mart.
 * SPDX-License-Identifier: MIT
 * Full notice: licenses/PS3-XMB-MIT.txt. Port notes: WAVE-PROVENANCE.md.
 *
 * The upstream runtime descriptors are synthetic, not captured PS3 data.
 * This port evaluates displacement into vertices instead of a float texture.
 */
(function (root) {
  'use strict';
  var TABLE_SIZE = 361, KERNEL_SIZE = 64, CONTROL_COUNT = 28;
  var NORM_A = [0.39584, -0.0052389996, -0.58664495, 0.189007];
  var NORM_B = [-0.003751, -0.57536095, 0.161975, 0.417137];
  var WEIGHTS = [0.0001, 0.306001, 0.12, 0.407658];

  function wrap(value, size) { return ((value % size) + size) % size; }
  function mix(a, b, t) { return a + (b - a) * t; }
  function softClip(value) { return 0.22 * Math.tanh(value / 0.22); }

  function SplineSurface(columns, rows) {
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 16 || rows < 8 ||
        columns > 384 || rows > 128 || (columns + 1) * (rows + 1) > 65535) throw new RangeError('Unsupported spline grid');
    this.columns = columns; this.rows = rows;
    this.vertices = new Float32Array((columns + 1) * (rows + 1) * 7);
    this.indices = new Uint16Array(columns * rows * 6);
    this.heights = new Float32Array((columns + 1) * (rows + 1));
    this.descriptors = new Uint8Array(0x2200);
    this.table = new Float32Array(TABLE_SIZE * 4);
    this.tableReady = new Uint8Array(TABLE_SIZE);
    this.kernel = new Float32Array(KERNEL_SIZE * 4);
    this.samples = new Float32Array(16);
    this.controls = new Float32Array(CONTROL_COUNT);
    this.basis = new Float32Array((columns + 1) * 4);
    this.segments = new Uint8Array(columns + 1);
    this.columnWork = new Float64Array((columns + 1) * 5);
    this.time = null;
    this.dirty = true;
    this.bounds = {minY:0,maxY:0};
    var index = 0, x, y, i;
    for (y = 0; y < rows; y++) {
      for (x = 0; x < columns; x++) {
        var a = y * (columns + 1) + x, b = a + columns + 1;
        this.indices[index++] = a; this.indices[index++] = b; this.indices[index++] = a + 1;
        this.indices[index++] = a + 1; this.indices[index++] = b; this.indices[index++] = b + 1;
      }
    }
    for (x = 0; x <= columns; x++) {
      var s = Math.min(x / columns * (CONTROL_COUNT - 3), CONTROL_COUNT - 3 - 1e-6);
      var segment = Math.floor(s), t = s - segment, t2 = t * t, t3 = t2 * t;
      this.segments[x] = segment;
      this.basis.set([(1 - 3*t + 3*t2 - t3)/6, (4 - 6*t2 + 3*t3)/6,
        (1 + 3*t + 3*t2 - 3*t3)/6, t3/6], x * 4);
    }
    for (i = 0; i < this.descriptors.length; i++) {
      var f = i / this.descriptors.length;
      var wave = Math.sin(f*97*0.606001)*0.5 + Math.sin(f*211*0.51)*0.3 + Math.sin(f*17*0.34)*0.2;
      var noise = Math.sin(i*13.37 + 1337*0.01)*43758.5453123;
      noise = (noise - Math.floor(noise))*2 - 1;
      this.descriptors[i] = Math.max(0, Math.min(1, (wave*0.7 + noise*0.35 + 1)*0.5))*255;
    }
  }

  SplineSurface.prototype._tableEntry = function (entry, phase) {
    if (this.tableReady[entry]) return;
    var table = this.table, descriptors = this.descriptors;
    for (var lane = 0; lane < 4; lane++) {
      var raw = 0;
      for (var block = 0; block < 4; block++) {
        var at = (entry*0x130 + block*16 + lane*4 + entry%7) % descriptors.length;
        var centered = descriptors[at]/255*2 - 1;
        var harmonic = Math.sin(entry*0.07 + block*0.91 + lane*1.37 + phase*0.23);
        raw += (centered*0.75 + harmonic*0.25) * WEIGHTS[block];
      }
      var divisor = Math.max(Math.abs(NORM_B[lane]), 0.05) * (NORM_B[lane] < 0 ? -1 : 1);
      table[entry*4 + lane] = Math.tanh((raw - NORM_A[lane]) / divisor * 0.08);
    }
    this.tableReady[entry] = 1;
  };

  SplineSurface.prototype._kernel = function (time) {
    var table = this.table, kernel = this.kernel;
    var tablePhase = time * 0.18 * 0.65, phase, lane, block;
    // Only the two entries at each of 32 cursors are read. Evaluate those
    // exact entries once per frame, rather than all 361 (no time quantization).
    this.tableReady.fill(0);
    // Use elapsed animation time, not render count: repainting a still frame
    // must not move it, and the 30 fps cap must not change the smoothing rate.
    var temporal = this.time === null ? 0 : Math.pow(0.84, Math.max(0, time - this.time)*60);
    var samples = this.samples;
    for (var iter = 0; iter < 8; iter++) {
      phase = time*0.45 + iter*0.37;
      for (lane = 0; lane < 4; lane++) {
        var word = (lane*0x11 + iter*0x13) & 255;
        var base = (19*(word >> 4) + (word & 15)) % TABLE_SIZE;
        var cursor = wrap(base + Math.sin(phase + lane*0.77)*0.006*TABLE_SIZE, TABLE_SIZE);
        var first = Math.floor(cursor), second = (first + 1) % TABLE_SIZE;
        this._tableEntry(first, tablePhase); this._tableEntry(second, tablePhase);
        for (var component = 0; component < 4; component++) {
          samples[lane*4 + component] = mix(table[first*4 + component], table[second*4 + component], cursor-first);
        }
      }
      var mixA = 0.5 + 0.5*Math.sin(phase*0.7), mixB = 0.5 + 0.5*Math.cos(phase*0.9);
      for (block = 0; block < 8; block++) {
        var from = block % 4, to = (from + 1) % 4;
        for (lane = 0; lane < 4; lane++) {
          var a = samples[from*4 + lane], b = samples[to*4 + lane];
          var target = block < 4 ? mix(a,b,block%2 ? mixB : mixA) : b-a;
          var offset = (iter*8 + block)*4 + lane;
          kernel[offset] = mix(target, kernel[offset], temporal);
        }
      }
    }
  };

  SplineSurface.prototype.update = function (time) {
    if (typeof time !== 'number' || !isFinite(time) || time < 0) throw new RangeError('Invalid spline time');
    if (time === this.time && !this.dirty) return false;
    // Resets are deterministic; normal animation only advances the local clock.
    if (this.time !== null && time < this.time) this.time = null;
    this._kernel(time);
    var columns = this.columns, rows = this.rows, stride = columns + 1;
    var flow = time*0.18, cp = this.controls, heights = this.heights, kernel = this.kernel;
    var row, x, i, z;
    for (row = 0; row <= rows; row++) {
      z = row/rows*2 - 1;
      // Keep the descriptor sampling scale independent of mesh quality.
      var referenceRow = row/rows*63, rowPhase = flow*0.25 + z*1.7;
      for (i = 0; i < CONTROL_COUNT; i++) {
        x = i/(CONTROL_COUNT - 1);
        var kv = referenceRow*0.93 + i*0.61 + flow*0.35;
        var floor = Math.floor(kv), k0 = wrap(floor,KERNEL_SIZE)*4, k1 = wrap(floor+1,KERNEL_SIZE)*4;
        var kt = kv - floor;
        var core = (mix(kernel[k0],kernel[k1],kt)*0.45 + mix(kernel[k0+1],kernel[k1+1],kt)*0.25 +
          mix(kernel[k0+2],kernel[k1+2],kt)*0.2 + mix(kernel[k0+3],kernel[k1+3],kt)*0.1)*0.04 +
          Math.sin(rowPhase + x*6.2)*0.2 + Math.cos(z*7 + x*4.8 + flow*0.09)*0.025;
        var travelling = Math.sin(x*Math.PI*1.3 + z*0.8 - flow*0.25)*0.014*0.12 +
          Math.sin(x*Math.PI*2.8 - z*1.2 + flow*0.15)*0.008 +
          0.0998587*0.07*Math.sin((x*(4+0.306001*2) + z*4 - flow*0.6)*4.07658);
        cp[i] = core*0.45 + travelling*0.55;
      }
      for (x = 0; x <= columns; x++) {
        var seg = this.segments[x], basis = x*4;
        heights[row*stride + x] = this.basis[basis]*cp[seg] + this.basis[basis+1]*cp[seg+1] +
          this.basis[basis+2]*cp[seg+2] + this.basis[basis+3]*cp[seg+3];
      }
    }
    var vertices = this.vertices, minY = Infinity, maxY = -Infinity;
    // These terms depend on the column, not the row. Float64 retains the
    // original Number precision; no lookup-table approximation or mesh change.
    var work = this.columnWork;
    for (x = 0; x <= columns; x++) {
      var px = x/columns*2 - 1, column = x*5;
      var shifted = wrap(x/columns - flow*0.04, 1)*columns;
      work[column] = px;
      work[column+1] = (Math.cos(px*2 - time*0.5)*0.09 - 0.1)*0.9999 +
        0.12*Math.sin(px*0.306001 + flow*0.25);
      work[column+2] = Math.sin(px*5.67726 + flow)*0.05;
      work[column+3] = Math.floor(shifted);
      work[column+4] = shifted - work[column+3];
    }
    for (row = 0; row <= rows; row++) {
      z = row/rows*2 - 1;
      var rowZ = z + Math.cos(z*2.88782 + flow)*0.06;
      for (x = 0; x <= columns; x++) {
        column = x*5;
        px = work[column];
        var pz = rowZ, baseWave = work[column+1];
        var structured = 0.0998587*0.07*(
          Math.sin((px*0.306001*6 + pz*0.5)*4.07658 + flow*0.7)*0.5 +
          Math.sin((px*0.306001*10 - pz*0.8)*2.03829 - flow*0.35)*0.25);
        var py = heights[row*stride+x] + work[column+2] - softClip((baseWave+structured)*0.5);
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        var left = work[column+3], right = Math.min(columns, left+1);
        pz -= mix(heights[row*stride+left], heights[row*stride+right], work[column+4])*0.08;
        var at = (row*stride+x)*7;
        vertices[at] = px; vertices[at+1] = py; vertices[at+2] = pz; vertices[at+3] = z;
      }
    }
    this.bounds.minY = minY - 1e-6;
    this.bounds.maxY = maxY + 1e-6;
    // Smooth surface normals avoid per-triangle highlights and also remove
    // the derivative-extension requirement on older WebGL implementations.
    for (row = 0; row <= rows; row++) {
      var above = Math.max(0,row-1)*stride, below = Math.min(rows,row+1)*stride;
      for (x = 0; x <= columns; x++) {
        var l = (row*stride+Math.max(0,x-1))*7, r = (row*stride+Math.min(columns,x+1))*7;
        var u = (above+x)*7, d = (below+x)*7;
        var ax = vertices[r]-vertices[l], ay = vertices[r+1]-vertices[l+1], az = vertices[r+2]-vertices[l+2];
        var bx = vertices[d]-vertices[u], by = vertices[d+1]-vertices[u+1], bz = vertices[d+2]-vertices[u+2];
        var nx = ay*bz-az*by, ny = az*bx-ax*bz, nz = ax*by-ay*bx;
        var length = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
        var n = (row*stride+x)*7+4;
        vertices[n] = nx/length; vertices[n+1] = ny/length; vertices[n+2] = nz/length;
      }
    }
    this.time = time;
    this.dirty = false;
    return true;
  };

  var colors = root.LGXMBWaveColors;
  var BACKGROUND_COLOR = [
    colors ? colors.shader : '',
    'vec3 backgroundColor(vec2 uv,vec3 background,vec3 wave) {',
    colors ? '  if(uColorEnabled) return presetBackground(uv);' : '',
    '  float gradient = smoothstep(0.0,1.0,1.0-uv.y);',
    '  vec3 top = background*0.75 + wave*0.035;',
    '  vec3 bottom = background*0.9 + wave*0.15;',
    '  float glow = exp(-length((uv-vec2(0.18,0.36))*vec2(1.3,2.6))*3.0);',
    // The reference keeps its light a little to the left: top and bottom
    // corners both read a few percent brighter there. A gentle horizontal
    // lean does that without disturbing the glow that sits under the menu.
    // The ported monthly gradients keep their own angles and are left alone.
    '  float lean = mix(1.06,0.98,uv.x);',
    '  return mix(top,bottom,gradient)*lean + wave*glow*0.045;',
    '}'
  ].join('\n');
  var BACKDROP = [
    'precision PRECISION float; varying vec2 vUV;',
    'uniform vec3 uBackground; uniform vec3 uWave;',
    BACKGROUND_COLOR,
    'void main() { gl_FragColor = vec4(backgroundColor(vUV,uBackground,uWave),1.0); }'
  ].join('\n');
  // Where the band sits vertically, in clip space, where 2.0 spans the output
  // height. It came down a twentieth of the height twice after 0.1.30.
  //
  // BAND_SCALE stretches the wave about its lower edge rather than its middle,
  // so the bottom stays where it was tuned by eye and the extra height all goes
  // upward. Measured against a reference capture the band covered 17% of the
  // frame against its 32%, which is where 1.85 comes from.
  //
  // BAND_Y folds the offset and the stretch into the one constant the shader
  // needs: scale about BAND_BOTTOM, then translate.
  // ps3-particles.js repeats both numbers: it loads before this file and so
  // cannot read them from here.
  var BAND_OFFSET = -0.17, BAND_BOTTOM = -0.342, BAND_SCALE = 1.85;
  var BAND_Y = (BAND_OFFSET - BAND_BOTTOM) * BAND_SCALE + BAND_BOTTOM;
  var VERTEX = [
    'attribute vec4 aPosition; attribute vec3 aNormal;',
    'varying vec3 vNormal; varying float vDepth;',
    'void main() {',
    '  vNormal = aNormal; vDepth = aPosition.w;',
    '  gl_Position = vec4(aPosition.x*1.04, aPosition.y*' + BAND_SCALE.toFixed(3) +
      '+(' + BAND_Y.toFixed(4) + '), aPosition.z*0.65,1.0);',
    '}'
  ].join('\n');
  var FRAGMENT = [
    'precision PRECISION float;',
    'varying vec3 vNormal; varying float vDepth;',
    'uniform vec3 uWave; uniform float uBrightness;',
    'void main() {',
    '  vec3 normal = normalize(vNormal);',
    '  float fresnel = pow(clamp(1.0-abs(normal.z),0.0,1.0),4.0)*0.5;',
    '  float edge = 1.0-smoothstep(0.78,1.0,abs(vDepth));',
    '  vec3 tint = mix(vec3(1.0),uWave,0.16);',
    '  gl_FragColor = vec4(tint,clamp(fresnel*0.7*0.98*uBrightness*edge,0.0,1.0));',
    '}'
  ].join('\n');

  var COMPOSITE_VERTEX = [
    'attribute vec2 aPosition; varying vec2 vUV; uniform vec2 uOutputBand;',
    'void main() { vUV=(aPosition+1.0)*0.5; vUV.y=uOutputBand.x+vUV.y*uOutputBand.y; gl_Position=vec4(aPosition,0.0,1.0); }'
  ].join('\n');
  var COMPOSITE_FRAGMENT = [
    'precision PRECISION float; varying vec2 vUV;',
    'uniform sampler2D uSurface; uniform vec2 uTexel; uniform vec2 uSurfaceBand;',
    'uniform bool uResolved; uniform vec3 uBackground; uniform vec3 uWave;',
    BACKGROUND_COLOR,
    'void main() {',
    // A small separable-kernel equivalent softens the mesh at grazing edges.
    // RGBA8 is WebGL 1 core; no floating-point/filtering extension is needed.
    '  vec2 surfaceUV=vec2(vUV.x,(vUV.y-uSurfaceBand.x)/uSurfaceBand.y);',
    '  vec4 color=texture2D(uSurface,surfaceUV)*0.25;',
    '  color+=(texture2D(uSurface,surfaceUV+vec2(uTexel.x,0.0))+texture2D(uSurface,surfaceUV-vec2(uTexel.x,0.0)))*0.125;',
    '  color+=(texture2D(uSurface,surfaceUV+vec2(0.0,uTexel.y))+texture2D(uSurface,surfaceUV-vec2(0.0,uTexel.y)))*0.125;',
    '  color+=(texture2D(uSurface,surfaceUV+uTexel)+texture2D(uSurface,surfaceUV-uTexel))*0.0625;',
    '  color+=(texture2D(uSurface,surfaceUV+vec2(uTexel.x,-uTexel.y))+texture2D(uSurface,surfaceUV+vec2(-uTexel.x,uTexel.y)))*0.0625;',
    // RGB is the complete display background; A remains wave coverage for the
    // optional opacity-aware detector. The final post-process outputs alpha 1.
    '  if(uResolved) color.rgb += backgroundColor(vUV,uBackground,uWave)*(1.0-color.a);',
    '  gl_FragColor=color;',
    '}'
  ].join('\n');

  var GRIDS = {standard:[128,48], high:[256,96], fine:[384,128]};
  var SAMPLE_SCALES = [2,1.5,1.25,1];

  function quality(options, previous) {
    options = options || {};
    previous = previous || {sampling:1,detail:'standard',softness:1.5,postprocess:'off',strength:'normal',particles:false,particleCount:2000,msaa:0};
    return {
      msaa:[0,2,4].indexOf(options.msaa) >= 0 ? options.msaa : previous.msaa || 0,
      sampling:SAMPLE_SCALES.indexOf(options.sampling) >= 0 ? options.sampling : previous.sampling,
      detail:Object.prototype.hasOwnProperty.call(GRIDS,options.detail) ? options.detail : previous.detail,
      softness:[0,0.75,1.5].indexOf(options.softness) >= 0 ? options.softness : previous.softness,
      postprocess:['off','fxaa','wave'].indexOf(options.postprocess) >= 0 ? options.postprocess : previous.postprocess || 'off',
      strength:['gentle','normal','strong'].indexOf(options.strength) >= 0 ? options.strength : previous.strength || 'normal',
      particles:typeof options.particles === 'boolean' ? options.particles : previous.particles === true,
      particleCount:[500,2000,4000].indexOf(options.particleCount) >= 0 ? options.particleCount : previous.particleCount || 2000
    };
  }

  function create(gl, precision, options) {
    var shaders = [], programs = [], buffers = [], texture = null, framebuffer = null;
    var geometry = null, uniformWave, uniformBrightness, attribute, normalAttribute, quadAttribute, texel, sampler;
    var complete = false, dead = false, width = 0, height = 0;
    var outputBandUniform, surfaceBandUniform, resolvedUniform, backgroundUniform, tintUniform, colorUniforms;
    var particles = null, particlesTried = false, particleError = null, particleCount = 0;
    var post = null, postTried = false, postError = null, postMode = 'off', postReason = null;
    var settings = quality(options), meshDetail = null, allocationKey = null, effectiveScale = 0, fallback = null;
    var bandRect = null, bandLayout = null, bandPadding = 20, fullHeight = 0, surfaceBottom = 0;
    var msaa = root.LGXMBWaveMSAA ? root.LGXMBWaveMSAA.create(gl) : null;
    var maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE), viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    var maxWidth = Math.min(3840,maxTexture,viewport[0]), maxHeight = Math.min(2160,maxTexture,viewport[1]);
    var settingsChanged = true;
    function destroy(lost) {
      if (dead) return;
      dead = true;
      if (post) post.destroy(lost); post = null;
      if (msaa) msaa.destroy(lost); msaa = null;
      if (particles) particles.destroy(lost); particles = null; particleCount = 0;
      if (!lost) {
        shaders.forEach(function(shader) { gl.deleteShader(shader); });
        programs.forEach(function(program) { gl.deleteProgram(program); });
        buffers.forEach(function(buffer) { gl.deleteBuffer(buffer); });
        if (texture) gl.deleteTexture(texture);
        if (framebuffer) gl.deleteFramebuffer(framebuffer);
      }
      shaders = []; geometry = null;
    }
    function program(vertex,fragment) {
      var value = gl.createProgram();
      if (!value) throw new Error('Could not create spline program');
      programs.push(value);
      [vertex,fragment].forEach(function(source,index) {
        var shader = gl.createShader(index ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER);
        if (!shader) throw new Error('Could not create spline shader');
        shaders.push(shader); gl.shaderSource(shader,source); gl.compileShader(shader); gl.attachShader(value,shader);
      });
      gl.linkProgram(value);
      return value;
    }
    function buffer() {
      var value = gl.createBuffer();
      if (!value) throw new Error('Could not allocate spline buffer');
      buffers.push(value); return value;
    }
    var meshProgram, compositeProgram, vertexBuffer, indexBuffer, quadBuffer;
    try {
      meshProgram = program(VERTEX,FRAGMENT.replace('PRECISION',precision));
      compositeProgram = program(COMPOSITE_VERTEX,COMPOSITE_FRAGMENT.replace('PRECISION',precision));
    } catch (error) { destroy(false); throw error; }
    function preparePost(w,h) {
      postMode = 'off'; postReason = null;
      if (settings.postprocess === 'off') { if (post) post.release(); return false; }
      if (!postTried) {
        postTried = true;
        try {
          if (!root.LGXMBWavePost) throw new Error('Post-process module unavailable');
          post = root.LGXMBWavePost.create(gl,precision);
        } catch (error) { postError = error.message; }
      }
      if (!post) { postReason = postError; return false; }
      if (!post.prepare(w,h)) { postReason = post.diagnostics().failure; return false; }
      postMode = settings.postprocess; return true;
    }
    function drawParticles(time,w,h,wave,brightness) {
      particleCount = 0;
      if (!settings.particles) return;
      if (!particlesTried) {
        particlesTried = true;
        try {
          if (!root.LGXMBPS3Particles) throw new Error('Particle module unavailable');
          particles = root.LGXMBPS3Particles.create(gl,precision);
        } catch (error) { particleError = error.message; }
      }
      if (!particles) return;
      // Render analytically feathered sprites after FXAA so it cannot erase them.
      // This is the same output-sized pass whether waves use 1x or 2x sampling.
      try {
        particles.draw(time,w,h,wave,brightness,settings.particleCount);
        particleCount = settings.particleCount;
      } catch (error) {
        particles.destroy(!!gl.isContextLost()); particles = null;
        particleError = 'Particle rendering unavailable';
      }
    }
    function updateMesh() {
      if (meshDetail === settings.detail) return false;
      var grid = GRIDS[settings.detail], next = new SplineSurface(grid[0],grid[1]);
      // Changing tessellation must not reset the running spline or its phase.
      if (geometry) { next.kernel.set(geometry.kernel); next.time = geometry.time; }
      gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER,next.vertices.byteLength,gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,next.indices,gl.STATIC_DRAW);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Spline mesh allocation refused');
      geometry = next; meshDetail = settings.detail;
      return true;
    }
    function updateBand(targetWidth,targetHeight) {
      var layout = targetWidth+'x'+targetHeight;
      if (layout !== bandLayout) { bandRect = null; bandLayout = layout; }
      // Includes a raster/filter guard plus the FXAA shader's bounded edge search.
      // Pixel-aligned output origin; the mesh uses a shifted FULL virtual viewport,
      // not a rescaled projection. Fractional SSAA retains its global sample phase.
      var low = Math.max(0,Math.floor((geometry.bounds.minY*BAND_SCALE+BAND_Y+1)*0.5*targetHeight)-bandPadding);
      var high = Math.min(targetHeight,Math.ceil((geometry.bounds.maxY*BAND_SCALE+BAND_Y+1)*0.5*targetHeight)+bandPadding);
      if (bandRect && low >= bandRect.y && high <= bandRect.y+bandRect.height) return;
      var h = Math.min(targetHeight,Math.max(bandRect ? bandRect.height : 0,Math.ceil((high-low)/32)*32,32));
      var bottom = Math.max(0,Math.min(targetHeight-h,Math.floor((low+high-h)*0.5)));
      // Never shrink/reallocate on moving frames. Resize or a new context resets it.
      bandRect = {x:0,y:bottom,width:targetWidth,height:h};
    }
    function resize(targetWidth,targetHeight) {
      if (!Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) || targetWidth <= 0 || targetHeight <= 0) {
        throw new RangeError('Invalid spline surface size');
      }
      updateBand(targetWidth,targetHeight);
      var region = bandRect;
      var baseScale = Math.min(1,1920/targetWidth,1080/targetHeight);
      var baseWidth = Math.max(1,Math.floor(targetWidth*baseScale));
      var baseHeight = Math.max(1,Math.floor(targetHeight*baseScale));
      var key = baseWidth+'x'+baseHeight+'@'+settings.sampling+'#'+region.height;
      if (allocationKey === key) {
        surfaceBottom = Math.min(fullHeight-height,Math.floor(region.y*fullHeight/targetHeight));
        return false;
      }
      var reason = null, lastWidth = 0, lastHeight = 0;
      var bandRatio = region.height / targetHeight;
      // Try smaller sample factors only on a real limit/refusal, never on frame timing.
      // Cache that result so an unsupported size is not retried every frame.
      for (var i = 0; i < SAMPLE_SCALES.length; i++) {
        var scale = SAMPLE_SCALES[i];
        if (scale > settings.sampling) continue;
        var scaledWidth = baseWidth * scale, virtualHeight = Math.floor(baseHeight*scale);
        var scaledHeight = Math.min(virtualHeight,Math.ceil((virtualHeight*bandRatio+2)/8)*8);
        if (scaledWidth > maxWidth || virtualHeight > viewport[1] || scaledHeight > maxHeight) {
          reason = reason || 'GPU limit';
          if (scale > 1) continue;
          scale = Math.min(scale,maxWidth/baseWidth,viewport[1]/baseHeight,maxHeight/(baseHeight*bandRatio));
          scaledWidth = baseWidth * scale;
          virtualHeight = Math.floor(baseHeight*scale);
          scaledHeight = Math.min(virtualHeight,Math.ceil((virtualHeight*bandRatio+2)/8)*8);
        }
        var w = Math.max(1,Math.floor(scaledWidth)), h = Math.max(1,Math.floor(scaledHeight));
        if (w === lastWidth && h === lastHeight) continue;
        lastWidth = w; lastHeight = h;
        if (w === width && h === height) {
          fullHeight = virtualHeight; surfaceBottom = Math.min(fullHeight-h,Math.floor(region.y*fullHeight/targetHeight));
          effectiveScale = scale; fallback = reason; allocationKey = key; return true;
        }
        // Keep the previous texture alive until a replacement is complete. A failed
        // texImage2D can leave old storage intact, so completeness alone is not enough.
        var candidate = gl.createTexture(), candidateFbo = gl.createFramebuffer(), valid = false;
        try {
          if (candidate && candidateFbo) {
            gl.bindTexture(gl.TEXTURE_2D,candidate);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D,0,typeof gl.renderbufferStorageMultisample === 'function' && typeof gl.RGBA8 === 'number' ? gl.RGBA8 : gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
            var error = gl.getError();
            if (error === gl.CONTEXT_LOST_WEBGL) throw new Error('Spline context lost');
            if (error === gl.NO_ERROR) {
              gl.bindFramebuffer(gl.FRAMEBUFFER,candidateFbo);
              gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,candidate,0);
              valid = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
            }
          }
        } finally {
          gl.bindFramebuffer(gl.FRAMEBUFFER,null);
          if (!valid) {
            if (candidate) gl.deleteTexture(candidate);
            if (candidateFbo) gl.deleteFramebuffer(candidateFbo);
          }
        }
        if (valid) {
          if (texture) gl.deleteTexture(texture);
          if (framebuffer) gl.deleteFramebuffer(framebuffer);
          texture = candidate; framebuffer = candidateFbo; width = w; height = h;
          fullHeight = virtualHeight; surfaceBottom = Math.min(fullHeight-h,Math.floor(region.y*fullHeight/targetHeight));
          effectiveScale = scale; fallback = reason; allocationKey = key; return true;
        }
        reason = 'Surface allocation refused';
      }
      throw new Error('Spline framebuffer unavailable');
    }
    return {
      programs: programs,
      configure: function (options) {
        var next = quality(options,settings);
        if (next.msaa === settings.msaa && next.sampling === settings.sampling && next.detail === settings.detail && next.softness === settings.softness && next.postprocess === settings.postprocess && next.strength === settings.strength && next.particles === settings.particles && next.particleCount === settings.particleCount) return;
        settings = next; settingsChanged = true;
      },
      finish: function () {
        if (complete || dead) return;
        programs.forEach(function(value) {
          if (!gl.getProgramParameter(value,gl.LINK_STATUS)) {
            var message = gl.getProgramInfoLog(value) || 'Spline shader link failed';
            shaders.forEach(function(shader) {
              if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) message += '\n'+gl.getShaderInfoLog(shader);
            });
            throw new Error(message);
          }
        });
        shaders.forEach(function(shader) { gl.deleteShader(shader); }); shaders = [];
        vertexBuffer = buffer(); indexBuffer = buffer(); quadBuffer = buffer();
        updateMesh();
        gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
        attribute = gl.getAttribLocation(meshProgram,'aPosition');
        normalAttribute = gl.getAttribLocation(meshProgram,'aNormal');
        quadAttribute = gl.getAttribLocation(compositeProgram,'aPosition');
        if (attribute < 0 || normalAttribute < 0 || quadAttribute < 0) throw new Error('Spline position attribute missing');
        uniformWave = gl.getUniformLocation(meshProgram,'uWave');
        uniformBrightness = gl.getUniformLocation(meshProgram,'uBrightness');
        outputBandUniform = gl.getUniformLocation(compositeProgram,'uOutputBand');
        surfaceBandUniform = gl.getUniformLocation(compositeProgram,'uSurfaceBand');
        resolvedUniform = gl.getUniformLocation(compositeProgram,'uResolved');
        backgroundUniform = gl.getUniformLocation(compositeProgram,'uBackground');
        tintUniform = gl.getUniformLocation(compositeProgram,'uWave');
        if(colors) colorUniforms=colors.locations(gl,compositeProgram);
        texel = gl.getUniformLocation(compositeProgram,'uTexel');
        sampler = gl.getUniformLocation(compositeProgram,'uSurface');
        complete = true;
      },
      draw: function (time,wave,brightness,targetWidth,targetHeight,background,palette) {
        if (!complete || dead) return;
        var remeshed = updateMesh();
        var geometryChanged = geometry.update(time);
        var resized = resize(targetWidth,targetHeight);
        var beforePost = postMode+'|'+postReason;
        var filtered = preparePost(bandRect.width,bandRect.height);
        var beforeMSAA = msaa ? msaa.diagnostics().samples+'|'+msaa.diagnostics().failure : '';
        var multisampled = msaa && msaa.prepare(settings.msaa,width,height);
        try {
          gl.disable(gl.SCISSOR_TEST);
          gl.bindFramebuffer(gl.FRAMEBUFFER,multisampled ? msaa.target() : framebuffer);
          gl.viewport(0,-surfaceBottom,width,fullHeight);
          gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(meshProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);
          if (geometryChanged) gl.bufferSubData(gl.ARRAY_BUFFER,0,geometry.vertices);
          gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute,4,gl.FLOAT,false,28,0);
          gl.enableVertexAttribArray(normalAttribute); gl.vertexAttribPointer(normalAttribute,3,gl.FLOAT,false,28,16);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);
          gl.uniform3fv(uniformWave,wave); gl.uniform1f(uniformBrightness,brightness);
          gl.enable(gl.BLEND);
          gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
          gl.drawElements(gl.TRIANGLES,geometry.indices.length,gl.UNSIGNED_SHORT,0);
          if (multisampled && !msaa.resolve(framebuffer)) {
            // A refused resolve must not leave a stale/empty image or kill the waves.
            gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawElements(gl.TRIANGLES,geometry.indices.length,gl.UNSIGNED_SHORT,0);
          }
          gl.disableVertexAttribArray(normalAttribute);
          gl.bindFramebuffer(gl.FRAMEBUFFER,filtered ? post.target() : null);
          if (filtered) gl.viewport(0,0,bandRect.width,bandRect.height);
          else gl.viewport(bandRect.x,bandRect.y,bandRect.width,bandRect.height);
          gl.useProgram(compositeProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);
          gl.enableVertexAttribArray(quadAttribute); gl.vertexAttribPointer(quadAttribute,2,gl.FLOAT,false,0,0);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);
          // Radius is in output pixels, independent of the internal sample factor.
          var radius = Math.max(settings.softness,effectiveScale > 1 ? 0.5 : 0);
          gl.uniform1i(sampler,0);
          gl.uniform2f(texel,radius/targetWidth,radius*fullHeight/(targetHeight*height));
          gl.uniform2f(surfaceBandUniform,surfaceBottom/fullHeight,height/fullHeight);
          gl.uniform2f(outputBandUniform,bandRect.y/targetHeight,bandRect.height/targetHeight);
          gl.uniform1i(resolvedUniform,filtered ? 1 : 0);
          gl.uniform3fv(backgroundUniform,background || [0,0,0]); gl.uniform3fv(tintUniform,wave);
          if(colors) colors.upload(gl,colorUniforms,palette);
          if (filtered) gl.disable(gl.BLEND);
          else gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
          gl.drawArrays(gl.TRIANGLES,0,3);
          if (filtered) post.render(settings.postprocess,settings.strength,bandRect);
          gl.bindFramebuffer(gl.FRAMEBUFFER,null);
          gl.viewport(0,0,targetWidth,targetHeight);
          drawParticles(time,targetWidth,targetHeight,wave,brightness);
        } finally {
          gl.disableVertexAttribArray(normalAttribute);
          gl.bindFramebuffer(gl.FRAMEBUFFER,null);
          gl.viewport(0,0,targetWidth,targetHeight);
          gl.disable(gl.BLEND);
        }
        var changed = resized || remeshed || settingsChanged || beforePost !== postMode+'|'+postReason ||
          (msaa && beforeMSAA !== msaa.diagnostics().samples+'|'+msaa.diagnostics().failure); settingsChanged = false;
        return changed;
      },
      destroy: destroy,
      diagnostics: function () { return {vertices:geometry ? geometry.vertices.length/7 : 0,
        triangles:geometry ? geometry.indices.length/3 : 0, floatTextures:false,
        surfaceWidth:width,surfaceHeight:height,requestedScale:settings.sampling,effectiveScale:effectiveScale,
        detail:meshDetail,softness:settings.softness,samplingFallback:fallback,
        postprocess:postMode,requestedPostprocess:settings.postprocess,postprocessFallback:postReason,
        requestedParticles:settings.particles,particleCount:particleCount,requestedParticleCount:settings.particleCount,
        particlesFallback:settings.particles ? particleError : null,
        strength:settings.strength,postWidth:post ? post.diagnostics().width : 0,postHeight:post ? post.diagnostics().height : 0,
        bandWidth:bandRect ? bandRect.width : 0,bandHeight:bandRect ? bandRect.height : 0,bandBottom:bandRect ? bandRect.y : 0,
        bandPadding:bandPadding,cropped:true,virtualHeight:fullHeight,surfaceBottom:surfaceBottom,
        requestedMSAA:settings.msaa,msaaSamples:msaa ? msaa.diagnostics().samples : 0,
        msaaSupported:msaa ? msaa.diagnostics().supported : [],
        msaaFallback:settings.msaa ? (msaa ? msaa.diagnostics().failure : 'MSAA module unavailable') : null,
        msaaBytes:msaa ? msaa.diagnostics().bytes : 0}; }
    };
  }
  root.LGXMBPS3Wave = Object.freeze({backdrop:BACKDROP, create:create, quality:quality, createGeometry:function(columns,rows) {
    return new SplineSurface(columns,rows);
  }});
}(window));
