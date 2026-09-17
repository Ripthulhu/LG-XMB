/* lg-xmb, 2026. SPDX-License-Identifier: GPL-3.0-or-later
* Numerical reconstruction of the supplied PS3 3.01 workers. See docs/WEBGL2.md.
* No firmware, captured buffers or embedded starting-state tables in this file.
*/
(function (root) {
  'use strict';
  var f = Math.fround, DEAD = -666, AGE_LIMIT = f(0.9999899864196777);
  var scratch = new ArrayBuffer(4), floats = new Float32Array(scratch), words = new Uint32Array(scratch);
  var RECIP = [0x7ffbe0, 0x7f87a6, 0x70ef72, 0x708b40, 0x638b12, 0x633aea, 0x5792c4, 0x574aa0,
    0x4cca7e, 0x4c9262, 0x430a44, 0x42d62a, 0x3a2e12, 0x39fdfa, 0x3215e4, 0x31f1d2,
    0x2aa9be, 0x2a85ac, 0x23d59a, 0x23bd8e, 0x1d8576, 0x1d8576, 0x17ad5a, 0x17ad5a,
    0x124543, 0x124543, 0x0d392d, 0x0d392d, 0x08851a, 0x08851a, 0x041d07, 0x041d07];
  function bits(x) { floats[0] = x; return words[0]; }
  function value(x) { words[0] = x; return floats[0]; }
  function reciprocal(x) {
    var a = bits(x), e = a >>> 23 & 255;
    if (e < 1 || e > 252)
      throw new RangeError('Reciprocal requires a finite normal input');
    var b = RECIP[a >>> 18 & 31] | (253 - e) << 23 | a & 0x80000000;
    var base = value((b & 0x007ffc00) | 0x3f800000);
    var delta = f(f((b & 1023) * Math.pow(2, -13)) * f((a & 0x7ffff) * Math.pow(2, -19)));
    return value((b & 0xff800000) | (bits(f(base - delta)) & 0x007fffff));
  }
  function array(input, length, name) {
    var a = new Float32Array(input);
    if (a.length !== length || !a.every(Number.isFinite))
      throw new TypeError('Invalid ' + name);
    return a;
  }
  function noise(counter) {
    var n = counter ^ counter << 13;
    var h = (Math.imul(n, Math.imul(Math.imul(n, n), 15731) + 789221) + 1376312589) & 0x7fffffff;
    return f(1 - f(h) * Math.pow(2, -30));
  }
  function vec(settings, prefix) { return new Float32Array([settings[prefix + ' X'], settings[prefix + ' Y'], settings[prefix + ' Z'], 1]); }
  function Wave(seed, settings) {
    this.settings = Object.assign({}, settings);
    this.p = array(seed.current, 1444, 'wave positions');
    this.v = array(seed.velocity, 1444, 'wave velocities');
    this.previous = array(seed.previous || seed.current, 1444, 'previous wave');
    this.output = new Float32Array(1444);
    this.controls = new Float32Array(1444);
    this.lattice = new Float32Array(2156);
    this.transitionLattice = new Float32Array(2156);
    this.transitionTicks = 0;
    this.core = new Float32Array(512);
    this.matrix = array(seed.matrix, 16, 'wave matrix');
    this.clock = f(seed.clock || 0);
    this.smoothedClock = f(seed.smoothedClock || 0);
    this.fraction = f(seed.fraction || 0);
    this.counter = seed.counter >>> 0;
    this.ticks = 0;
    this.clockWraps = 0;
    this.revision = 0;
    this.program = Number.isInteger(seed.program) ? seed.program : settings['FFD SHADER'];
    if (!Number.isInteger(this.program) || this.program < 0 || this.program > 3)
      throw new RangeError('Unsupported deformation program');
    if (!Number.isFinite(settings.TIMESTEP) || settings.TIMESTEP <= 0)
      throw new RangeError('Positive finite wave time step required');
    this.origin = vec(settings, 'FFD OFFSET');
    this.scale = vec(settings, 'FFD SCALE2');
    this.extent = vec(settings, 'FFD SCALE1');
    this.inverse = new Float32Array(Array.from(this.extent, reciprocal));
    this.weights = new Float64Array(12);
    this.delta = new Float32Array(4);
    this.interpolate();
    if (seed.lattice)
      this.lattice.set(array(seed.lattice, 2156, 'wave lattice'));
    else
      this.generateLattice();
    this.deform();
  }
  Wave.prototype.spring = function (a, b, rest, tension) {
    var p = this.p, v = this.v, d = this.delta, sum = 0;
    for (var k = 0; k < 4; k++) {
      d[k] = f(p[b + k] - p[a + k]);
      sum = f(sum + f(d[k] * d[k]));
    }
    var distance = f(Math.sqrt(sum));
    if (distance === 0)
      return;
    var amplitude = f(tension * f(distance - rest));
    for (k = 0; k < 4; k++) {
      var impulse = f(amplitude * f(d[k] / distance));
      v[a + k] = f(v[a + k] + impulse);
      v[b + k] = f(v[b + k] - impulse);
    }
  };
  Wave.prototype.tick = function () {
    var p = this.p, v = this.v, s = this.settings, step = f(s.TIMESTEP), dt = f(step * f(.0001));
    var rest = f(s.LENGTH), tension = f(s.TENSION), rest2 = f(2 * rest), tension2 = f(10 * tension);
    this.previous.set(p);
    this.clock = f(this.clock + dt);
    if (this.transitionTicks > 0)
      this.transitionTicks--;
    if (this.clock > 10) {
      this.clock = 0;
      this.clockWraps++;
      this.transitionLattice.set(this.lattice);
      this.transitionTicks = 60;
    }
    for (var y = 0; y < 19; y++)
      for (var x = 0; x < 19; x++) {
        var a = (y * 19 + x) * 4;
        if (x > 0)
          this.spring(a, a - 4, rest, tension);
        if (x > 1)
          this.spring(a, a - 8, rest2, tension2);
        if (y > 0)
          this.spring(a, a - 76, rest, tension);
        if (y > 1)
          this.spring(a, a - 152, rest2, tension2);
        for (var k = 0; k < 3; k++) {
          this.counter = (this.counter + 1) >>> 0;
          v[a + k] = f(noise(this.counter) * f(s.PERTURBATION) + v[a + k]);
        }
      }
    var damping = f(f(s.DAMPING) * step);
    for (var i = 0; i < 1444; i++) {
      p[i] = f(v[i] * dt + p[i]);
      v[i] = f(v[i] - f(v[i] * damping));
    }
    this.smoothedClock = f(f(this.clock - this.smoothedClock) * f(.1) + this.smoothedClock);
    for (y = 0; y < 19; y++) {
      a = y * 76;
      v[a] = f(v[a] + f(step * f(.02)));
      var phase = f(f(y / 19) + this.smoothedClock);
      a += 72;
      p[a] = 0;
      p[a + 1] = f(f(f(f(Math.sin(f(phase * 11))) + 1) * f(.5)) * f(s['END Y']));
      p[a + 2] = f(f(f(f(Math.cos(f(phase * 15))) + 1) * f(.5)) * f(s['END Z']));
      p[a + 3] = 1;
      v[a] = v[a + 1] = v[a + 2] = v[a + 3] = 0;
    }
    this.ticks++;
  };
  Wave.prototype.interpolate = function () {
    var a = this.fraction, o = this.output, p = this.p, prev = this.previous, start = f(this.settings['FFD PARAM 1']);
    for (var i = 0; i < 1444; i += 4) {
      for (var k = 0; k < 4; k++)
        o[i + k] = f(p[i + k] * a + f(prev[i + k] * f(1 - a)));
      var d = f(o[i] - start), phase = d < 0 ? 0 : f(d * f(Math.PI / 2));
      var u = d < 0 ? 0 : f(d / 5), t = f(1 - Math.min(1, Math.max(0, u)));
      var smooth = f(f(t * t) * f(t * -2 + 3));
      var factor = f(f(1.3) - f(f(Math.cos(phase)) * smooth));
      o[i + 1] = f(o[i + 1] * factor);
      o[i + 2] = f(o[i + 2] * factor);
    }
    return o;
  };
  Wave.prototype.generateLattice = function () {
    // Stable captured path: the consumed field precedes the CPU clock by one tick.
    // Clock-wrap blending is a documented port policy, not recovered PAF timing.
    var time = f(f(this.clock - f(f(this.settings.TIMESTEP) * f(.0001))) * 10);
    if (time < 0)
      time = 0;
    var shader = ffd[this.program], core = this.core, grid = this.lattice;
    for (var z = 0; z < 4; z++)
      for (var y = 0; y < 4; y++)
        for (var x = 0; x < 8; x++) {
          var i = ((z * 4 + y) * 8 + x) * 4;
          shader(x / 8, y / 4, z / 4, time, core, i);
          for (var k = 0; k < 4; k++)
            core[i + k] = f(core[i + k] * this.extent[k] + this.origin[k]);
        }
    for (z = 0; z < 7; z++)
      for (y = 0; y < 7; y++)
        for (x = 0; x < 11; x++) {
          i = ((z * 7 + y) * 11 + x) * 4;
          var j = ((Math.min(3, Math.max(0, z - 1)) * 4 + Math.min(3, Math.max(0, y - 1))) * 8 + Math.min(7, Math.max(0, x - 1))) * 4;
          for (k = 0; k < 4; k++)
            grid[i + k] = core[j + k];
        }
    if (this.transitionTicks) {
      // Explicit one-second smoothstep policy for the unresolved host crossfade.
      var blend = 1 - this.transitionTicks / 60;
      blend = blend * blend * (3 - 2 * blend);
      for (i = 0; i < grid.length; i++)
        grid[i] = this.transitionLattice[i] + (grid[i] - this.transitionLattice[i]) * blend;
    }
  };
  Wave.prototype.deform = function () {
    var o = this.output, l = this.lattice, c = this.controls, m = this.matrix, wt = this.weights;
    // Original B-spline basis is 0.9999999403953552 times the ideal 1/6 basis.
    var sixth = 0.1666666567325592, third = 0.6666666269302368, half = 0.4999999701976776;
    for (var i = 0; i < 1444; i += 4) {
      var nx = (o[i] - this.origin[0]) * this.inverse[0], ny = (o[i + 1] - this.origin[1]) * this.inverse[1];
      var nz = (o[i + 2] - this.origin[2]) * this.inverse[2], nw = (o[i + 3] - this.origin[3]) * this.inverse[3];
      var xx = Math.max(0, Math.min(0.9990000128746033, nx)) * 8;
      var yy = Math.max(0, Math.min(0.9990000128746033, ny)) * 4, zz = Math.max(0, Math.min(0.9990000128746033, nz)) * 4;
      var ix = Math.floor(xx), iy = Math.floor(yy), iz = Math.floor(zz);
      for (var ax = 0; ax < 3; ax++) {
        var t = ax === 0 ? xx - ix : ax === 1 ? yy - iy : zz - iz, t2 = t * t, t3 = t2 * t, q = ax * 4;
        wt[q] = -sixth * t3 + half * t2 - half * t + sixth;
        wt[q + 1] = half * t3 - 2 * half * t2 + third;
        wt[q + 2] = -half * t3 + half * t2 + half * t + sixth;
        wt[q + 3] = sixth * t3;
      }
      var dx = 0, dy = 0, dz = 0, dw = 0;
      for (var z = 0; z < 4; z++)
        for (var y = 0; y < 4; y++)
          for (var x = 0; x < 4; x++) {
            var weight = wt[x] * wt[4 + y] * wt[8 + z], j = (((iz + z) * 7 + iy + y) * 11 + ix + x) * 4;
            dx += l[j] * weight;
            dy += l[j + 1] * weight;
            dz += l[j + 2] * weight;
            dw += l[j + 3] * weight;
          }
      dx = (nx + dx) * this.scale[0];
      dy = (ny + dy) * this.scale[1];
      dz = (nz + dz) * this.scale[2];
      dw = (nw + dw) * this.scale[3];
      for (var k = 0; k < 4; k++)
        c[i + k] = dx * m[k] + dy * m[4 + k] + dz * m[8 + k] + dw * m[12 + k];
    }
    this.revision++;
    return c;
  };
  Wave.prototype.advance = function (seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1)
      throw new RangeError('Wave interval outside 0..1 seconds');
    this.fraction = f(this.fraction + f(f(seconds) * 60));
    var before = this.ticks;
    while (this.fraction > 1) {
      this.tick();
      this.fraction = f(this.fraction - 1);
    }
    this.interpolate();
    if (this.ticks !== before)
      this.generateLattice();
    this.deform();
    return this.ticks - before;
  };
  // The completed 128x128 mesh at integer coordinates, from the same deformed
  // controls and basis table the vertex shader uses. Coordinates wrap.
  Wave.prototype.meshPoint = function (x, y, basis, out) {
    x = ((x % 128) + 128) % 128; y = ((y % 128) + 128) % 128;
    var px = x >> 3, lx = (x & 7) * 64, py = y >> 3, ly = (y & 7) * 64, c = this.controls;
    var a = 0, b = 0, d = 0, e = 0;
    for (var v = 0; v < 4; v++) {
      var wy = basis[ly + v], row = ((py + v) * 19 + px) * 4;
      for (var u = 0; u < 4; u++) {
        var w = basis[lx + u] * wy, j = row + u * 4;
        a += c[j] * w; b += c[j + 1] * w; d += c[j + 2] * w; e += c[j + 3] * w;
      }
    }
    out[0] = a; out[1] = b; out[2] = d; out[3] = e;
    return out;
  };
  function invert4(m) {
    var a = new Float64Array(32), i, j, k;
    for (i = 0; i < 4; i++) { for (j = 0; j < 4; j++) a[i * 8 + j] = m[i * 4 + j]; a[i * 8 + 4 + i] = 1; }
    for (i = 0; i < 4; i++) {
      var pivot = i;
      for (j = i + 1; j < 4; j++) if (Math.abs(a[j * 8 + i]) > Math.abs(a[pivot * 8 + i])) pivot = j;
      if (Math.abs(a[pivot * 8 + i]) < 1e-12) throw new RangeError('Singular view-projection');
      for (k = 0; k < 8; k++) { var t = a[i * 8 + k]; a[i * 8 + k] = a[pivot * 8 + k]; a[pivot * 8 + k] = t; }
      var scale = 1 / a[i * 8 + i];
      for (k = 0; k < 8; k++) a[i * 8 + k] *= scale;
      for (j = 0; j < 4; j++) if (j !== i) { var factor = a[j * 8 + i]; for (k = 0; k < 8; k++) a[j * 8 + k] -= factor * a[i * 8 + k]; }
    }
    var out = new Float32Array(16);
    for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) out[i * 4 + j] = a[i * 8 + 4 + j];
    return out;
  }
  // Sony's host emitter, from the 3.01 particle-motion recovery. Candidates are
  // points on the moving sheet. One invocation later each is sampled again at
  // the same mesh coordinate, and the sheet's local movement decides whether a
  // particle is born there and which way it leaves. `birth` is the recovered
  // equation module (ps3-particle-birth.js), which is tested against the
  // original instructions. What's ours is the scheduling: one invocation per
  // particle update, which is the console's cadence only by assumption.
  function Emitter(wave, particles, basis, viewProjection, birth) {
    if (!birth || typeof birth.createBirth !== 'function') throw new TypeError('Particle birth module required');
    this.wave = wave; this.particles = particles; this.basis = basis; this.birth = birth;
    // The mesh is in clip space. The captured descriptor matrix that takes it to
    // world space is the inverse of the particle view-projection, no divide.
    var transposed = new Float32Array(16);
    for (var r = 0; r < 4; r++) for (var q = 0; q < 4; q++) transposed[r * 4 + q] = viewProjection[q * 4 + r];
    this.toWorld = invert4(transposed);
    var random = new birth.HostRandom(0);
    this.signed = function () { return random.signed(); };
    this.random = random;
    this.previous = [];
    this.trail = { remaining: 112, x: 72, y: 0 }; // retained in the capture
    this.tick = 0;
    this.births = 0;
    this.refused = 0;
    // How many particles may be alive. The pool can be bigger than this, so a
    // lower density doesn't pay for the higher one's slots.
    this.limit = particles.capacity;
    this.revision = -1;
    this.free = [];
    for (var i = 0; i < particles.capacity; i++) if (particles.state[i * 12 + 3] === DEAD) this.free.push(i);
    var clip = new Float32Array(4), m = this.toWorld, self = this;
    this.sample = function (x, y) {
      self.wave.meshPoint(x, y, self.basis, clip);
      return [clip[0] * m[0] + clip[1] * m[1] + clip[2] * m[2] + clip[3] * m[3],
        clip[0] * m[4] + clip[1] * m[5] + clip[2] * m[6] + clip[3] * m[7],
        clip[0] * m[8] + clip[1] * m[9] + clip[2] * m[10] + clip[3] * m[11]];
    };
  }
  Emitter.prototype.retire = function (slots, count) { for (var n = 0; n < count; n++) this.free.push(slots[n]); };
  // `updates` is how many particle updates this frame ran. At 60 fps that's one
  // and this is the recovered routine as is. A slower frame saw the sheet move
  // once for several updates, so the candidates of all of them are drawn now
  // and the movement is divided over that many steps.
  Emitter.prototype.emit = function (updates) {
    if (!(updates > 0) || this.wave.revision === this.revision) return 0;
    this.revision = this.wave.revision;
    var B = this.birth, fresh = [], born = 0, n, i;
    for (n = 0; n < updates; n++) {
      Array.prototype.push.apply(fresh, B.batchCandidates(this.sample, 128, 128, null, this.signed));
      Array.prototype.push.apply(fresh, B.trailCandidates(this.sample, 128, 128, this.trail, this.tick++, this.signed));
    }
    var settings = updates === 1 ? null : { dt: B.defaults.dt * updates };
    for (i = 0; i < this.previous.length; i++) {
      var c = this.previous[i], made = B.createBirth(c.position, this.sample(c.x, c.y), settings, this.signed, [0, 0, 1]);
      if (!made) continue;
      // A full pool refuses the birth, it never overwrites a live particle.
      if (this.particles.capacity - this.free.length < this.limit && B.applyBirth(this.particles.state, this.free, made) >= 0) born++; else this.refused++;
    }
    this.previous = fresh;
    this.births += born;
    return born;
  };
  // Navigation response, from the same recovery. Two separate things:
  //  - a direction press feeds a damped response that briefly raises the
  //    Brownian gain and turns the cloud by a tiny angle about the pivot;
  //  - moving menu objects write a local wind into the 32x16 signed-byte field
  //    the worker already samples, and the field decays in byte steps.
  // The console reads the objects' projected positions. Here the menu hands over
  // target positions and they're animated with the console's own position curve
  // (selector 5, 200 ms), so nothing reads the page's layout per frame.
  var APPROACH = 0.22058835625648499, ICON_ASPECT = f(1.7777777910232544), UI_BROWNIAN = f(0.6000000238418579);
  // LG-XMB tuning, not a recovered coefficient. Scale the sampled vertical
  // wind, not its byte field: fast/above-bar moves already saturate that field.
  // Keep the original spatial footprint and decay, without the full-speed kick.
  var VERTICAL_ICON_WIND_SCALE = .25;
  function Interaction(particles, birth) {
    this.particles = particles; this.birth = birth;
    this.response = new birth.DpadResponse();
    this.pending = 4;
    this.baseBrownian = particles.params.brownian;
    this.objects = {};
    this.moving = false;
    this.fieldLive = false;
    this.writes = 0;
  }
  // 0 left, 1 right, 2 up, 3 down. One accepted navigation step, never a held key.
  Interaction.prototype.direction = function (code) { if (code >= 0 && code <= 3) this.pending = code; };
  // targets: [{id, x, y}] in Y-up NDC. A first sighting only starts a history.
  Interaction.prototype.setObjects = function (targets) {
    var next = {}, moving = false;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i], o = this.objects[t.id];
      if (!o) o = { x: t.x, y: t.y, tx: t.x, ty: t.y };
      o.tx = t.x; o.ty = t.y;
      if (o.tx !== o.x || o.ty !== o.y) moving = true;
      next[t.id] = o;
    }
    this.objects = next;
    this.moving = moving;
  };
  Interaction.prototype.step = function () {
    var p = this.particles.params, B = this.birth, out = this.response.step(this.pending, 1, 0);
    this.pending = 4;
    p.brownian = f(this.baseBrownian + f(UI_BROWNIAN * out.brownian));
    var r = out.rotation, angle = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]), m = p.rotation;
    if (angle < 1e-5) { for (var n = 0; n < 16; n++) m[n] = (n % 5) === 0 ? 1 : 0; }
    else {
      var x = r[0] / angle, y = r[1] / angle, z = r[2] / angle, c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
      m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y; m[3] = 0;
      m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x; m[7] = 0;
      m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c; m[11] = 0;
      m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
    }
    if (this.fieldLive) {
      B.decayField(p.field);
      this.fieldLive = this.moving || p.field.some(function (v) { return v !== 0; });
    }
    if (!this.moving) return;
    var still = true;
    for (var id in this.objects) {
      var o = this.objects[id];
      if (o.x === o.tx && o.y === o.ty) continue;
      var nx = o.x + (o.tx - o.x) * APPROACH, ny = o.y + (o.ty - o.y) * APPROACH;
      if (Math.abs(o.tx - nx) < 1e-4 && Math.abs(o.ty - ny) < 1e-4) { nx = o.tx; ny = o.ty; } else still = false;
      // A zero-strength move still overwrites the cell it visits.
      if (B.iconFieldWrite(p.field, [o.x, o.y], [nx, ny], ICON_ASPECT)) { this.writes++; this.fieldLive = true; }
      o.x = nx; o.y = ny;
    }
    this.moving = !still;
  };
  function transform4(x, y, z, w, m, out) {
    for (var k = 0; k < 4; k++) {
      var a = f(y * m[4 + k]);
      a = f(x * m[k] + a);
      a = f(z * m[8 + k] + a);
      out[k] = f(w * m[12 + k] + a);
    }
  }
  function Parameters(raw) {
    var d = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (raw.byteLength !== 2304 || d.getUint32(0x784) !== 32 || d.getUint32(0x788) !== 16)
      throw new TypeError('Unsupported particle parameter block');
    function read(at, count) { var a = new Float32Array(count); for (var i = 0; i < count; i++)
      a[i] = d.getFloat32(at + i * 4); return a; }
    this.force = read(0, 3);
    this.drag = read(16, 3);
    this.field = new Int8Array(raw.slice(128, 1664).buffer);
    this.fieldToWorld = read(0x700, 16);
    this.worldToField = read(0x740, 16);
    this.minimum = read(0x800, 3);
    this.maximum = read(0x810, 3);
    this.pivot = read(0x830, 3);
    this.rotation = read(0x840, 16);
    this.extra = read(0x890, 3);
    this.fieldGain = d.getFloat32(0x8a0);
    this.brownian = d.getFloat32(0x8a4);
    this.angularRate = d.getFloat32(0x8ac);
    this.dt = read(0x8b0, 3);
    this.inverse = new Float32Array(Array.from(this.dt, reciprocal));
    if (!this.dt.every(function (x) { return x > 0; }) ||
        !this.minimum.every(function (x, i) { return x <= this.maximum[i]; }, this))
      throw new RangeError('Invalid particle time step or bounds');
  }
  function Particles(records, parameters) {
    if (records.length % 12 || !records.length || records.length > 4096 * 12)
      throw new RangeError('Invalid particle capacity');
    this.state = array(records, records.length, 'particle state');
    this.seeds = this.state.slice();
    this.params = parameters;
    this.capacity = records.length / 12;
    this.count = 0;
    this.retiredCount = 0;
    this.retired = new Uint16Array(this.capacity);
    this.rng = new Uint32Array(3);
    this.render = new Float32Array(this.capacity * 8);
    this.tmp = new Float32Array(4);
    this.fieldSample = new Float32Array(4);
    this.rotated = new Float32Array(4);
    this.vector = new Float32Array(4);
    this.fraction = 0;
    this.ticks = 0;
    this.recycled = 0;
    this.revision = 0;
    this.seedIndices = new Uint16Array(this.capacity);
    this.seedCount = 0;
    for (var i = 0; i < this.capacity; i++)
      if (this.seeds[i * 12 + 3] !== DEAD)
        this.seedIndices[this.seedCount++] = i;
    this.pack();
  }
  Particles.prototype.sampleField = function (px, py, pz) {
    var p = this.params, t = this.tmp, v = this.vector, field = p.field;
    transform4(px, py, pz, 1, p.worldToField, t);
    var u = f(t[0] * 32 - .5), w = f(t[1] * 16 - .5), x = Math.floor(u), y = Math.floor(w), fx = f(u - x), fy = f(w - y);
    var x0 = Math.max(0, Math.min(31, x)), x1 = Math.max(0, Math.min(31, x + 1));
    var y0 = Math.max(0, Math.min(15, y)), y1 = Math.max(0, Math.min(15, y + 1)), scale = f(1 / 127);
    for (var k = 0; k < 3; k++) {
      var a = f(field[(y0 * 32 + x0) * 3 + k] * scale), b = f(field[(y0 * 32 + x1) * 3 + k] * scale);
      var c = f(field[(y1 * 32 + x0) * 3 + k] * scale), d = f(field[(y1 * 32 + x1) * 3 + k] * scale);
      var lo = f(f(b - a) * fx + a), hi = f(f(d - c) * fx + c);
      v[k] = f(f(hi - lo) * fy + lo);
    }
    // Only tune the live menu interaction. Raw reference replays stay unchanged;
    // X/Z wind, launch velocity, gravity, drag and the d-pad response are separate.
    if (this.interaction)
      v[1] = f(v[1] * VERTICAL_ICON_WIND_SCALE);
    transform4(v[0], v[1], v[2], 0, p.fieldToWorld, this.fieldSample);
  };
  Particles.prototype.update = function () {
    var s = this.state, p = this.params, rng = this.rng, q = this.vector;
    rng[0] = 0x98756161;
    rng[1] = 0x21324889;
    rng[2] = 0x82181158;
    this.retiredCount = 0;
    // Skip only exactly neutral inputs. This preserves the reference path while
    // avoiding two matrix transforms and a field lookup per idle particle.
    var hasField = p.fieldGain !== 0 && p.field.some(function (v) { return v !== 0; });
    var rotate = p.pivot[0] !== 0 || p.pivot[1] !== 0 || p.pivot[2] !== 0;
    for (var n = 0; n < 16; n++)
      if (p.rotation[n] !== ((n % 5) === 0 ? 1 : 0))
        rotate = true;
    if (!hasField)
      this.fieldSample.fill(0);
    for (var i = 0; i < this.capacity; i++) {
      var at = i * 12;
      if (s[at + 3] === DEAD)
        continue;
      if (hasField)
        this.sampleField(s[at], s[at + 1], s[at + 2]);
      if (rotate)
        transform4(f(s[at] - p.pivot[0]), f(s[at + 1] - p.pivot[1]), f(s[at + 2] - p.pivot[2]), 0, p.rotation, this.rotated);
      for (var k = 0; k < 3; k++) {
        rng[k] = Math.imul(rng[k], 16807) >>> 0;
        var random = f(value((rng[k] >>> 9) | 0x40000000) - 3);
        var force = f(random * p.brownian + p.extra[k]);
        force = f(f(this.fieldSample[k] * p.fieldGain + force) + p.force[k]);
        var rotated = rotate ? f(this.rotated[k] + p.pivot[k]) : s[at + k];
        var velocity = f(f(rotated - s[at + k]) * p.inverse[k] + s[at + 4 + k]);
        var acceleration = f(-velocity * p.drag[k] + force);
        velocity = f(acceleration * p.dt[k] + velocity);
        s[at + 4 + k] = velocity;
        s[at + k] = f(velocity * p.dt[k] + s[at + k]);
      }
      var age = s[at + 3] = f(s[at + 3] + s[at + 7]);
      var phase = f(age * f(2 * Math.PI));
      var ox = f(Math.sin(f(phase * f(.37)))), oy = f(Math.cos(f(phase * f(.17)))), oz = f(Math.cos(f(phase * f(.31))));
      var x = s[at + 8], y = s[at + 9], z = s[at + 10], w = s[at + 11];
      q[0] = f(f(w * ox) + f(f(oy * z) - f(oz * y)));
      q[1] = f(f(w * oy) + f(f(oz * x) - f(ox * z)));
      q[2] = f(f(w * oz) + f(f(ox * y) - f(oy * x)));
      q[3] = -f(f(f(ox * x) + f(oy * y)) + f(oz * z));
      var step = f(p.angularRate * value(0x3c888888)), len = 0;
      for (k = 0; k < 4; k++) {
        q[k] = f(f(.5 * q[k]) * step + s[at + 8 + k]);
        len = f(len + f(q[k] * q[k]));
      }
      len = f(Math.sqrt(len));
      for (k = 0; k < 4; k++)
        s[at + 8 + k] = f(q[k] / len);
      if (age >= AGE_LIMIT || s[at] < p.minimum[0] || s[at] > p.maximum[0] || s[at + 1] < p.minimum[1] || s[at + 1] > p.maximum[1] || s[at + 2] < p.minimum[2] || s[at + 2] > p.maximum[2]) {
        s[at + 3] = DEAD;
        this.retired[this.retiredCount++] = i;
      }
    }
    this.ticks++;
    this.revision++;
    return this.retiredCount;
  };
  Particles.prototype.recycle = function () {
    // Only used when the recovered emitter isn't attached. Keeps the captured
    // distribution, velocity/age-increment and quaternion; age restarts.
    if (!this.seedCount)
      return;
    for (var n = 0; n < this.retiredCount; n++) {
      var i = this.retired[n], j = this.seeds[i * 12 + 3] !== DEAD ? i : this.seedIndices[i % this.seedCount];
      for (var k = 0; k < 12; k++)
        this.state[i * 12 + k] = this.seeds[j * 12 + k];
      this.state[i * 12 + 3] = 0;
      this.recycled++;
    }
  };
  function fade(age) { return f(f(Math.min(age, f(.02)) * 50) * f(Math.max(f(age - f(.94)), 0) * f(-16.666664123535156) + 1)); }
  function halfTruncate(x) {
    var u = bits(x), e = u >>> 23 & 255;
    return (u >>> 16 & 0x8000) | (e > 142 ? 0x7c00 : e > 112 ? ((e - 112) << 10) | (u >>> 13 & 1023) : 0);
  }
  function fromHalf(h) { var e = h >>> 10 & 31; return value(((h & 0x8000) << 16) | (e ? (e === 31 ? 0x7f800000 : (e + 112) << 23) : 0) | ((h & 1023) << 13)); }
  Particles.prototype.pack = function () {
    var s = this.state, r = this.render, n = 0;
    for (var i = 0; i < this.capacity; i++) {
      var j = i * 12;
      if (s[j + 3] === DEAD)
        continue;
      var o = n++ * 8;
      r[o] = s[j];
      r[o + 1] = s[j + 1];
      r[o + 2] = s[j + 2];
      r[o + 3] = fade(s[j + 3]);
      for (var k = 0; k < 4; k++)
        r[o + 4 + k] = fromHalf(halfTruncate(s[j + 8 + k]));
    }
    this.count = n;
    return n;
  };
  Particles.prototype.advance = function (seconds, respawn) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1)
      throw new RangeError('Particle interval outside 0..1');
    this.fraction += seconds * 60;
    var updates = 0;
    while (this.fraction >= 1 - 1e-9) {
      if (this.interaction)
        this.interaction.step();
      this.update();
      updates++;
      if (respawn && this.emitter)
        this.emitter.retire(this.retired, this.retiredCount);
      else if (respawn)
        this.recycle();
      this.fraction = Math.max(0, this.fraction - 1);
    }
    if (respawn && this.emitter)
      this.emitter.emit(updates);
    this.pack();
  };
  // FFD functions are generated from the independently tested scalar dataflow.
  var ffd = [];
  function exp2(x) { return Math.pow(2, x); }
  ffd[0] = function (x, y, z, time, out, at) {
    var s0 = f(x);
    var s1 = f(y);
    var s2 = f((-(s1) + 0.5));
    var s3 = f(time);
    var s4 = f((s3 + 2400.0));
    var s5 = f((f((s0 * 1.4426950216293335)) * f(2)));
    var s6 = f((-(s0) * 0.800000011920929 + 1.0));
    var s7 = f(exp2(-(s5)));
    var s8 = f((s4 * 0.10000000149011612));
    var s9 = f((s4 * 0.10000000149011612 + 20.0));
    var s10 = f(Math.sin(s8));
    var s11 = f((f((s4 * s6)) * f(0.5)));
    var s12 = f((-(s0) * 6.28000020980835 + s11));
    var s13 = f((s4 * 0.12999999523162842));
    var s14 = f((s0 * 15.700000762939453 + -(s13)));
    var s15 = f(Math.sin(s9));
    var s16 = f((s15 + 0.20000000298023224));
    var s17 = f((s14 + -(2.0)));
    var s18 = f((f(Math.sin(s17)) * f(0.25)));
    var s19 = f((-(s16) * 0.8333333134651184 + s0));
    var s20 = f(s0);
    var s21 = f((s10 + 0.20000000298023224));
    var s22 = f((-(s21) * 0.8333333134651184 + s0));
    var s23 = f((s19 * s19));
    var s24 = f((s23 * -(14.426950454711914)));
    var s25 = f((s22 * s22));
    var s26 = f(exp2(s24));
    var s27 = f(s0);
    var s28 = f((s25 * -(72.13475036621094)));
    var s29 = f((s0 * 1.309999942779541));
    var s30 = f(0.20000000298023224);
    var s31 = f(exp2(s28));
    var s32 = f((s26 * -(0.15000000596046448) + s31));
    var s33 = f((-(s7) + 1.0));
    var s34 = f((s2 * s33));
    var s35 = f(Math.sin(s12));
    var s36 = f((s34 * s35 + s32));
    var s37 = f(((s20 * s30) + (s29 * s27)));
    var s38 = f(0.0);
    var s39 = f(0.0);
    var s40 = f((s18 + s36));
    out[at] = s37;
    out[at + 1] = s40;
    out[at + 2] = s38;
    out[at + 3] = s39;
  };
  ffd[1] = function (x, y, z, time, out, at) {
    var s0 = f(x);
    var s1 = f(z);
    var s2 = f((s0 + -(0.5)));
    var s3 = f(time);
    var s4 = f((s3 * 2.0));
    var s5 = f((f((s2 * 1.4426950216293335)) * f(2)));
    var s6 = f(Math.sin(s4));
    var s7 = f((s0 * 7.850000381469727));
    var s8 = f((-(s3) * 2.5 + s7));
    var s9 = f(0.20000000298023224);
    var s10 = f((s6 + 3.0));
    var s11 = f(exp2(s5));
    var s12 = f((s8 + -(1.25)));
    var s13 = f((s3 * 0.25));
    var s14 = f((f(Math.sin(s13)) * f(0.5)));
    var s15 = f((s3 * 0.10000000149011612));
    var s16 = f((s11 + -(1.0)));
    var s17 = f((s11 + 1.0));
    var s18 = f(Math.sin(s15));
    var s19 = f((s18 + 0.20000000298023224));
    var s20 = f((s16 / s17));
    var s21 = f((s3 * -(0.00014426949201151729)));
    var s22 = f((-(s19) * 0.8333333134651184 + s0));
    var s23 = f((s22 * s22));
    var s24 = f(s0);
    var s25 = f(Math.sin(s12));
    var s26 = f((s20 + 1.0));
    var s27 = f(s21);
    var s28 = f((s26 * s10));
    var s29 = f(exp2(s27));
    var s30 = f((-(s1) * 6.28000020980835 + s3));
    var s31 = f(s0);
    var s32 = f((s31 * 1.2999999523162842));
    var s33 = f(s31);
    var s34 = f((s28 * s29));
    var s35 = f((s23 * -(72.13475036621094)));
    var s36 = f(exp2(s35));
    var s37 = f((s34 * s25));
    var s38 = f((s37 * 0.23999999463558197 + s14));
    var s39 = f(s30);
    var s40 = f((s38 + s36));
    var s41 = f((f(Math.sin(s39)) * f(0.125)));
    var s42 = f((s40 + s41));
    var s43 = f(((s24 * s9) + (s32 * s33)));
    var s44 = f((s43 + -(0.15000000596046448)));
    var s45 = f(0.0);
    var s46 = f(0.0);
    out[at] = s44;
    out[at + 1] = s42;
    out[at + 2] = s45;
    out[at + 3] = s46;
  };
  ffd[2] = function (x, y, z, time, out, at) {
    var s0 = f(0.20000000298023224);
    var s1 = f(x);
    var s2 = f(time);
    var s3 = f((s1 * 7.850000381469727));
    var s4 = f((s2 * -(0.00014426949201151729)));
    var s5 = f((-(s2) * 2.5 + s3));
    var s6 = f((s2 * 2.0));
    var s7 = f((s1 + -(0.5)));
    var s8 = f((f((s7 * 1.4426950216293335)) * f(2)));
    var s9 = f(Math.sin(s6));
    var s10 = f(s1);
    var s11 = f((s9 + 3.0));
    var s12 = f(exp2(s8));
    var s13 = f((s12 + 1.0));
    var s14 = f(s1);
    var s15 = f(s12);
    var s16 = f((s15 + -(1.0)));
    var s17 = f((s14 * 1.2999999523162842));
    var s18 = f((s16 / s13));
    var s19 = f((s5 + -(1.25)));
    var s20 = f((s18 + 1.0));
    var s21 = f(exp2(s4));
    var s22 = f((s20 * s11));
    var s23 = f((s22 * s21));
    var s24 = f(Math.sin(s19));
    var s25 = f(((s14 * s0) + (s17 * s10)));
    var s26 = f((s23 * s24));
    var s27 = f((s26 * 0.23999999463558197));
    var s28 = f(0.0);
    var s29 = f(0.0);
    out[at] = s25;
    out[at + 1] = s27;
    out[at + 2] = s28;
    out[at + 3] = s29;
  };
  ffd[3] = function (x, y, z, time, out, at) {
    var s0 = f(x);
    var s1 = f(y);
    var s2 = f((-(s0) * 0.800000011920929 + 1.0));
    var s3 = f((f((s0 * 1.4426950216293335)) * f(2)));
    var s4 = f((f((-(s0) * 6.2831854820251465)) * f(2)));
    var s5 = f(s2);
    var s6 = f((f((s5 * time + s4)) * f(0.5)));
    var s7 = f(exp2(-(s3)));
    var s8 = f(time);
    var s9 = f((-(s7) + 1.0));
    var s10 = f(Math.sin(s6));
    var s11 = f((-(s1) + 0.5));
    var s12 = f((s8 * 0.10000000149011612 + 20.0));
    var s13 = f(Math.sin(s12));
    var s14 = f((s0 + -(s13)));
    var s15 = f((s8 * 0.10000000149011612));
    var s16 = f(Math.sin(s15));
    var s17 = f((s14 * s14));
    var s18 = f((s17 * -(14.426950454711914)));
    var s19 = f((s0 + -(s16)));
    var s20 = f((s19 * s19));
    var s21 = f(exp2(s18));
    var s22 = f((s20 * -(72.13475036621094)));
    var s23 = f((s0 * 1.2000000476837158));
    var s24 = f((s23 * s0));
    var s25 = f(exp2(s22));
    var s26 = f((s11 * s9));
    var s27 = f((f((s21 * -(0.15000000596046448) + s25)) * f(0.5)));
    var s28 = f((f((s26 * s10 + s27)) * f(2)));
    var s29 = f(0.0);
    var s30 = f(0.0);
    out[at] = s24;
    out[at + 1] = s28;
    out[at + 2] = s29;
    out[at + 3] = s30;
  };
  var api = { Wave: Wave, Particles: Particles, Parameters: Parameters, Emitter: Emitter, Interaction: Interaction, reciprocal: reciprocal, noise: noise,
    ffd: ffd, fade: fade, halfTruncate: halfTruncate, fromHalf: fromHalf, DEAD: DEAD };
  if (typeof module === 'object' && module.exports)
    module.exports = api;
  else
    root.LGXMBPS3Core = Object.freeze(api);
})(typeof window === 'object' ? window : globalThis);
