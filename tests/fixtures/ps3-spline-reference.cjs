/*
 * Spline surface adapted from linkev/PlayStation-3-XMB, revision
 * 1ec453a9dddec5448d615116ff428349f42d454e (spline-reverse.js,
 * spline.js and spline-settings.js). Copyright (c) 2025 Mart.
 * SPDX-License-Identifier: MIT
 * Full notice: licenses/PS3-XMB-MIT.txt. Port notes: WAVE-PROVENANCE.md.
 *
 * The upstream runtime descriptors are synthetic, not captured PS3 data.
 * This port evaluates displacement into vertices instead of a float texture.
 * Frozen test reference from LG-XMB 898024a (before navigation optimization).
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
    this.kernel = new Float32Array(KERNEL_SIZE * 4);
    this.samples = new Float32Array(16);
    this.controls = new Float32Array(CONTROL_COUNT);
    this.basis = new Float32Array((columns + 1) * 4);
    this.segments = new Uint8Array(columns + 1);
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

  SplineSurface.prototype._kernel = function (time) {
    var table = this.table, descriptors = this.descriptors, kernel = this.kernel;
    var phase = time * 0.18 * 0.65;
    var entry, lane, block;
    for (entry = 0; entry < TABLE_SIZE; entry++) {
      for (lane = 0; lane < 4; lane++) {
        var raw = 0;
        for (block = 0; block < 4; block++) {
          var at = (entry*0x130 + block*16 + lane*4 + entry%7) % descriptors.length;
          var centered = descriptors[at]/255*2 - 1;
          var harmonic = Math.sin(entry*0.07 + block*0.91 + lane*1.37 + phase*0.23);
          raw += (centered*0.75 + harmonic*0.25) * WEIGHTS[block];
        }
        var divisor = Math.max(Math.abs(NORM_B[lane]), 0.05) * (NORM_B[lane] < 0 ? -1 : 1);
        table[entry*4 + lane] = Math.tanh((raw - NORM_A[lane]) / divisor * 0.08);
      }
    }
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
          Math.sin(rowPhase + x*3.4)*0.30 + Math.cos(z*3.6 + x*4.8 + flow*0.09)*0.025;
        var travelling = Math.sin(x*Math.PI*1.3 + z*0.8 - flow*0.25)*0.014*0.12 +
          Math.sin(x*Math.PI*2.8 - z*1.2 + flow*0.15)*0.008 +
          0.0998587*0.07*Math.sin((x*(4+0.306001*2) + z*1.6 - flow*0.6)*4.07658);
        cp[i] = core*0.45 + travelling*0.55;
      }
      for (x = 0; x <= columns; x++) {
        var seg = this.segments[x], basis = x*4;
        heights[row*stride + x] = this.basis[basis]*cp[seg] + this.basis[basis+1]*cp[seg+1] +
          this.basis[basis+2]*cp[seg+2] + this.basis[basis+3]*cp[seg+3];
      }
    }
    var vertices = this.vertices, minY = Infinity, maxY = -Infinity;
    for (row = 0; row <= rows; row++) {
      for (x = 0; x <= columns; x++) {
        var px = x/columns*2 - 1;
        z = row/rows*2 - 1;
        var pz = z + Math.cos(z*2.88782 + flow)*0.06;
        var baseWave = (Math.cos(px*2 - time*0.5)*0.09 - 0.1)*0.9999 +
          0.12*Math.sin(px*0.306001 + flow*0.25);
        var structured = 0.0998587*0.07*(
          Math.sin((px*0.306001*6 + pz*0.5)*4.07658 + flow*0.7)*0.5 +
          Math.sin((px*0.306001*10 - pz*0.8)*2.03829 - flow*0.35)*0.25);
        var py = heights[row*stride+x] + Math.sin(px*5.67726 + flow)*0.05 - softClip((baseWave+structured)*0.5);
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        var shifted = wrap(x/columns - flow*0.04, 1)*columns;
        var left = Math.floor(shifted), right = Math.min(columns, left+1);
        pz -= mix(heights[row*stride+left], heights[row*stride+right], shifted-left)*0.08;
        var at = (row*stride+x)*7;
        vertices[at] = px; vertices[at+1] = py; vertices[at+2] = pz; vertices[at+3] = z;
      }
    }
    this.bounds.minY = minY - 1e-6;
    this.bounds.maxY = maxY + 1e-6;
    // Smooth surface normals avoid per-triangle highlights and also remove
    // the derivative-extension requirement on older WebGL implementations.
    for (row = 0; row <= rows; row++) {
      for (x = 0; x <= columns; x++) {
        var l = (row*stride+Math.max(0,x-1))*7, r = (row*stride+Math.min(columns,x+1))*7;
        var u = (Math.max(0,row-1)*stride+x)*7, d = (Math.min(rows,row+1)*stride+x)*7;
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

  module.exports = SplineSurface;
})(globalThis);
