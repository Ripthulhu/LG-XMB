/* PS3 3.01 particle host equations. SPDX-License-Identifier: MIT
 * Reference component: no browser event wiring, global QGL scheduling, or
 * automatic replacement of LG-XMB's State.recycle(). See HANDOFF.md.
 */
(function (root) {
  'use strict';
  const F = Math.fround;
  const madd = (a, b, c) => F(F(a) * F(b) + F(c));
  const unit = (r) => F(F(F(r) + 1) * 0.5);
  const defaults = Object.freeze({
    minimumSpeed: 0.15064,
    velocityMultiplier: 0.19,
    velocityVariance: 0.282567,
    coneDegrees: 51.8695,
    reverseProbability: 0.173899,
    depthScale: 0,
    batchCount: 16,
    batchProbability: 0.479115,
    agingSpeed: 0.00285223,
    agingVariance: 0.493003,
    dt: 0.0088883
  });
  const xyz = (p, label) => {
    if (!p || p.length < 3 || ![p[0], p[1], p[2]].every(Number.isFinite))
      throw new TypeError(label + ' requires finite XYZ');
    return [F(p[0]), F(p[1]), F(p[2])];
  };
  function settings(value) {
    const s = Object.assign({}, defaults, value);
    if (
      !Object.values(s).every(Number.isFinite) ||
      s.dt <= 0 ||
      !Number.isInteger(s.batchCount) ||
      s.batchCount < 0 ||
      s.batchCount > 65536 ||
      s.reverseProbability < 0 ||
      s.reverseProbability > 1 ||
      s.batchProbability < 0 ||
      s.batchProbability > 1 ||
      s.velocityMultiplier < 0 ||
      s.velocityVariance < 0 ||
      s.velocityVariance > 1
    )
      throw new RangeError('Invalid birth settings');
    return s;
  }
  const cross = (a, b) => [
    F(F(a[1] * b[2]) - F(a[2] * b[1])),
    F(F(a[2] * b[0]) - F(a[0] * b[2])),
    F(F(a[0] * b[1]) - F(a[1] * b[0]))
  ];
  const dot = (a, b) => F(F(F(a[0] * b[0]) + F(a[1] * b[1])) + F(a[2] * b[2]));
  function HostRandom(counter = 0) {
    if (!Number.isInteger(counter)) throw new TypeError('Integer random counter required');
    this.counter = counter >>> 0;
  }
  HostRandom.prototype.signed = function () {
    this.counter = (this.counter + 1) >>> 0;
    const n = (this.counter ^ (this.counter << 13)) >>> 0;
    const inner = (Math.imul(Math.imul(n, n), 15731) + 789221) | 0;
    const bits = (Math.imul(n, inner) + 1376312589) & 0x7fffffff;
    return madd(F(bits), -Math.pow(2, -30), 1);
  };
  function createBirth(previous, current, value, randomSigned, depthAxis = [0, 0, 1]) {
    const s = settings(value),
      old = xyz(previous, 'Previous point'),
      p = xyz(current, 'Current point');
    const inv = F(1 / F(s.dt)),
      movement = p.map((v, i) => F(F(v - old[i]) * inv));
    const speed = F(Math.sqrt(dot(movement, movement)));
    if (speed < F(0.0001)) return null;
    let n = movement.map((v) => F(v * F(1 / speed)));
    const reversed = unit(randomSigned()) < F(s.reverseProbability);
    if (reversed) n = n.map((v) => -v);
    const axes = [
      [0, n[2], -n[1]],
      [-n[2], 0, n[0]],
      [n[1], -n[0], 0]
    ];
    const lengths = axes.map((v) => dot(v, v));
    const pick =
      lengths[0] > lengths[1] ? (lengths[0] > lengths[2] ? 0 : 2) : lengths[1] > lengths[2] ? 1 : 2;
    const tangent = axes[pick].map((v) => F(v * F(1 / Math.sqrt(lengths[pick]))));
    const theta = F(unit(randomSigned()) * F(F(s.coneDegrees) * F(Math.PI / 180)));
    const phi = F(unit(randomSigned()) * F(2 * Math.PI));
    const st = F(Math.sin(theta)),
      ct = F(Math.cos(theta)),
      sp = F(Math.sin(phi)),
      cp = F(Math.cos(phi));
    const t2 = cross(n, tangent),
      direction = n.map((v, i) =>
        F(F(F(v * ct) + F(tangent[i] * F(st * cp))) + F(t2[i] * F(st * sp)))
      );
    const axis = xyz(depthAxis, 'Depth axis'),
      axisNorm = dot(axis, axis);
    if (!(axisNorm > 0)) throw new RangeError('Nonzero depth axis required');
    const projection = axis.map((v) => F(v * F(dot(direction, axis) / axisNorm)));
    // Do not normalize again: depth suppression changes the final speed.
    for (let k = 0; k < 3; k++)
      direction[k] = F(F(direction[k] - projection[k]) + F(projection[k] * F(s.depthScale)));
    const variance = madd(randomSigned(), s.velocityVariance, 1);
    const launchSpeed = F(
      Math.max(F(s.minimumSpeed), F(Math.sqrt(F(speed * F(F(s.velocityMultiplier) * variance)))))
    );
    const ageIncrement = F(
      Math.max(F(0.001), F(F(s.agingSpeed) * madd(randomSigned(), s.agingVariance, 1)))
    );
    return {
      position: p,
      velocity: direction.map((v) => F(v * launchSpeed)),
      ageIncrement,
      sheetSpeed: speed,
      launchSpeedBeforeDepthScaling: launchSpeed,
      reversed
    };
  }
  function candidate(sample, x, y) {
    return { x, y, position: xyz(sample(x, y), 'Sample') };
  }
  function batchCandidates(sample, width, height, value, randomSigned) {
    const s = settings(value),
      out = [];
    if (madd(randomSigned(), 0.5, 0.5) >= F(s.batchProbability)) return out;
    for (let i = 0; i < s.batchCount; i++) {
      const x = Math.trunc(F(unit(randomSigned()) * F(width - 1)));
      const y = Math.trunc(F(unit(randomSigned()) * F(height - 1)));
      out.push(candidate(sample, x, y));
    }
    return out;
  }
  function trailCandidates(sample, width, height, state, tick, randomSigned) {
    if (state.remaining === 0) {
      if (madd(randomSigned(), 0.5, 0.5) < F(0.06)) {
        state.x = Math.trunc(F(unit(randomSigned()) * F(width - 1)));
        state.y = Math.trunc(F(unit(randomSigned()) * F(height - 1)));
        state.remaining = 100 + Math.trunc(F(F(randomSigned()) * 80));
      }
      return [];
    }
    if (tick & 1) return [];
    if (state.x >= width) {
      state.remaining = 0;
      return [];
    }
    const out = candidate(sample, state.x, state.y);
    state.x++;
    state.remaining--;
    return [out];
  }
  function applyBirth(records, freeSlots, birth) {
    if (!(records instanceof Float32Array) || records.length % 12 || !Array.isArray(freeSlots))
      throw new TypeError('Expected Float32Array records and free-index array');
    if (!birth || !freeSlots.length) return -1;
    const id = freeSlots[freeSlots.length - 1];
    if (!Number.isInteger(id) || id < 0 || id >= records.length / 12)
      throw new RangeError('Invalid free slot');
    freeSlots.pop();
    const b = id * 12;
    // Same two cleared vec4s as the original allocator; retain the quaternion.
    records.fill(0, b, b + 8);
    records.set(birth.position, b);
    records.set(birth.velocity, b + 4);
    records[b + 7] = birth.ageIncrement;
    return id;
  }
  function decayField(field, decay = 0.98) {
    if (!(field instanceof Int8Array) || field.length !== 1536 || !Number.isFinite(decay))
      throw new TypeError('Expected signed 32x16 RGB field');
    for (let i = 0; i < field.length; i++)
      field[i] = Math.trunc(
        F(Math.max(-1, Math.min(1, F(F(field[i] * F(1 / 127)) * F(decay)))) * 127)
      );
    return field;
  }
  function iconFieldWrite(field, old, now, aspect, gain = 11.3877, scaleX = 0, scaleY = 1) {
    if (
      !(field instanceof Int8Array) ||
      field.length !== 1536 ||
      !old ||
      !now ||
      ![...old, ...now, aspect, gain, scaleX, scaleY].every(Number.isFinite)
    )
      throw new TypeError('Invalid field input');
    const delta = [F(F(now[0]) - F(old[0])), F(F(now[1]) - F(old[1]))];
    if (!delta.some((v) => v !== 0)) return null;
    const xy = [0, 1].map((k) =>
      Math.max(0, Math.min(k ? 15 : 31, Math.trunc(F(F(F(F(now[k]) + 1) * 0.5) * (k ? 16 : 32)))))
    );
    const force = delta.map((v, k) =>
      F(F(F(F(v * F(k ? 1 : aspect)) * F(gain)) * F(k ? scaleY : scaleX)) * 10)
    );
    const at = (xy[1] * 32 + xy[0]) * 3;
    field[at] = Math.trunc(F(Math.max(-1, Math.min(1, force[0])) * 127));
    field[at + 1] = Math.trunc(F(Math.max(-1, Math.min(1, force[1])) * 127));
    field[at + 2] = 0;
    return xy;
  }
  function DpadResponse() {
    this.position = 0;
    this.velocity = 0;
    this.impulse = 0;
    this.axis = [0, 0, 0];
    this.brownianPosition = 0;
    this.brownianVelocity = 0;
    this.brownianImpulse = 0;
  }
  DpadResponse.prototype.step = function (direction, scaleX = 1, scaleY = 0) {
    // Identity camera basis for this convenience wrapper; rotate the returned
    // local axis through the actual camera basis in a renderer integration.
    if (!Number.isInteger(direction) || direction < 0 || direction > 4)
      throw new RangeError('Direction 0..4 required');
    if (direction !== 4) {
      const [dx, dy] = [
        [-1, 0],
        [1, 0],
        [0, 1],
        [0, -1]
      ][direction];
      this.axis = [F(-dy * scaleY), F(dx * scaleX), 0];
      this.impulse = F(this.impulse + F(0.03));
      this.brownianImpulse = madd(
        F(0.04),
        Math.abs(F(F(dx * F(scaleX)) + F(dy * F(scaleY)))),
        this.brownianImpulse
      );
    }
    this.velocity = F(madd(-this.velocity, 0.02, this.impulse) + this.velocity);
    this.position = F(this.position + this.velocity);
    this.impulse = 0;
    const strength = F(Math.max(0, Math.min(1, this.velocity)));
    const rotation = this.axis.map((v) => F(F(v * F(0.000116654)) * strength));
    const drag = madd(-this.brownianVelocity, 0.4, this.brownianImpulse);
    const dv = madd(-this.brownianPosition, 0.004, drag);
    this.brownianVelocity = F(this.brownianVelocity + dv);
    this.brownianPosition = F(this.brownianPosition + this.brownianVelocity);
    this.brownianImpulse = 0;
    return { rotation, strength, brownian: Math.max(0, Math.min(1, this.brownianPosition)) };
  };
  const api = {
    defaults,
    HostRandom,
    createBirth,
    batchCandidates,
    trailCandidates,
    applyBirth,
    decayField,
    iconFieldWrite,
    DpadResponse
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGXMBRecoveredParticleBirth = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
