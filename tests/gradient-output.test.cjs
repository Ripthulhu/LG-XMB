// SPDX-License-Identifier: GPL-3.0-or-later
// No private PS3 data or TV connection. Rendering is tested separately via EGL.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const repo = fs.existsSync(path.join(root, 'app')) ? root : path.resolve(root, '..');
const source = fs.readFileSync(path.join(repo, 'app/ps3-native-renderer.js'), 'utf8');
const backdrop = fs.readFileSync(path.join(repo, 'shaders/backdropFragment.frag'), 'utf8').replace(/\r\n/g, '\n');
const composite = fs.readFileSync(path.join(repo, 'shaders/compositeFragment.frag'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(repo, 'app/style.css'), 'utf8');
const shaders = require(path.join(repo, 'app/ps3-native-shaders.js'));
const compareVectors = source.match(/  function sameBackgroundVector\([\s\S]*?\n  }/)[0];
function method(owner, name) {
  const a = source.indexOf('  ' + owner + '.prototype.' + name + ' = function (');
  assert.ok(a >= 0, name);
  const start = source.indexOf('function (', a),
    end = source.indexOf('\n  };', start);
  assert.ok(end > start, name);
  return Function(
    'root',
    'document',
    compareVectors + '\nreturn (' + source.slice(start, end + 4) + ');'
  )({ removeEventListener() {} }, { removeEventListener() {} });
}
function makeRenderer(options = {}) {
  let id = 0,
    texture,
    fb,
    error = 0;
  const log = { allocated: [], removed: [], uniforms: [], draws: 0 };
  const gl = {
    RGBA8: 0x8058,
    RGBA16F: 0x881a,
    RGB10_A2: 0x8059,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    NO_ERROR: 0,
    createTexture: () => ({ kind: 'texture', id: ++id }),
    createFramebuffer: () => ({ kind: 'fb', id: ++id }),
    bindTexture(t, x) {
      texture = x;
    },
    bindFramebuffer(t, x) {
      fb = x;
    },
    bindRenderbuffer() {},
    texStorage2D(t, levels, format, width, height) {
      texture.format = format;
      log.allocated.push({ format, width, height });
      if (options.error10 && format === gl.RGB10_A2) error = 0x502;
    },
    framebufferTexture2D() {
      fb.format = texture.format;
    },
    texParameteri() {},
    checkFramebufferStatus: () =>
      options.allFail || (options.fail10 && fb.format === gl.RGB10_A2)
        ? 0x8cd6
        : gl.FRAMEBUFFER_COMPLETE,
    getError: () => {
      const e = error;
      error = 0;
      return e;
    },
    deleteTexture: (x) => log.removed.push(x),
    deleteFramebuffer: (x) => log.removed.push(x),
    deleteRenderbuffer: (x) => log.removed.push(x),
    getExtension: () => null,
    viewport() {},
    disable() {},
    colorMask() {},
    uniform3fv() {},
    uniform2fv() {},
    useProgram() {},
    bindVertexArray() {},
    activeTexture() {},
    uniform1i() {},
    uniform1f: (name, v) => log.uniforms.push([name, v]),
    drawArrays: () => log.draws++
  };
  const r = {
    gl,
    allocations: 0,
    objects: [],
    programs: [],
    monthlyKey: 'a',
    uniforms: { backdrop: { uCacheLevels: 'levels' } }
  };
  for (const name of ['allocate', 'allocateBackdrop', 'releaseTarget', 'backdropPass', 'destroy'])
    r[name] = method('Renderer', name);
  return { r, gl, log };
}
function makeWave() {
  const attributes = {},
    writes = [];
  const canvas = {
    width: 1280,
    height: 720,
    style: {},
    setAttribute(k, v) {
      attributes[k] = v;
      writes.push([k, v]);
    },
    removeAttribute(k) {
      delete attributes[k];
      writes.push([k, null]);
    },
    removeEventListener() {}
  };
  const w = {
    canvas,
    mode: 'webgl',
    allowed: () => true,
    cancel() {},
    renderer: {
      monthlyActive: true,
      configure() {},
      draw() {
        return false;
      },
      destroy() {}
    }
  };
  for (const n of [
    'clockDriven',
    'refreshClock',
    'scheduleClock',
    'paintStatic',
    'clearStatic',
    'syncBackgroundLayer',
    'draw',
    'fail',
    'destroy'
  ])
    w[n] = method('C5Wave', n);
  return { w, attributes, writes };
}
test('both changed GLSL sources agree with the bundled stages', () => {
  assert.equal(shaders.backdropFragment, backdrop);
  assert.equal(shaders.compositeFragment, composite);
  assert.ok(backdrop.startsWith('#version 300 es\n'));
  assert.ok(composite.startsWith('#version 300 es\n'));
});
test('10-bit backdrop remains 32 bits per texel, with no float or MSAA target', () => {
  const { r, gl, log } = makeRenderer();
  r.backdropPass(1920, 1080, true, [0, 0, 0], null);
  assert.deepEqual(log.allocated, [{ format: gl.RGB10_A2, width: 1920, height: 1080 }]);
  assert.deepEqual(
    log.uniforms.filter((x) => x[0] === 'levels'),
    [['levels', 1023]]
  );
  assert.equal('samples' in r.backdrop, false);
  assert.equal(1920 * 1080 * 4, 8294400);
});
test('repeated frames allocate/draw the cached background only once', () => {
  const { r, log } = makeRenderer();
  for (let i = 0; i < 600; i++) r.backdropPass(1920, 1080, true, [0, 0, 0], null);
  assert.equal(log.allocated.length, 1);
  assert.equal(log.draws, 1);
  r.monthlyKey = 'b';
  r.backdropPass(1920, 1080, true, [0, 0, 0], null);
  assert.equal(log.draws, 2);
});
test('RGB10_A2 failure drains the GL error, cleans up, and uses RGBA8', () => {
  const { r, gl, log } = makeRenderer({ error10: true, fail10: true });
  r.backdropPass(1280, 720, true, [0, 0, 0], null);
  assert.deepEqual(
    log.allocated.map((v) => v.format),
    [gl.RGB10_A2, gl.RGBA8]
  );
  assert.equal(log.removed.length, 2);
  assert.equal(gl.getError(), 0);
  assert.deepEqual(
    log.uniforms.filter((x) => x[0] === 'levels'),
    [['levels', 255]]
  );
  assert.equal(r.backdropFallback, 'RGB10_A2 unavailable');
});
test('unavailable 10-bit targets are not retried on each resize', () => {
  const { r, gl, log } = makeRenderer({ fail10: true });
  r.backdropPass(1280, 720, true, [0, 0, 0], null);
  r.backdropPass(1920, 1080, true, [0, 0, 0], null);
  assert.deepEqual(
    log.allocated.map((v) => v.format),
    [gl.RGB10_A2, gl.RGBA8, gl.RGBA8]
  );
  assert.equal(log.draws, 2);
});
test('failure of both backdrop formats is not mistaken for a rendered PS3 frame', () => {
  const { r, log } = makeRenderer({ allFail: true });
  assert.throws(() => r.backdropPass(1280, 720, true, [0, 0, 0], null), /Incomplete/);
  assert.equal(log.removed.length, 4);
  assert.equal(log.draws, 0);
  assert.equal(r.backdrop, undefined);
});
test('only cache RGB loses alpha precision; wave and particle targets are unaffected', () => {
  const { r, gl, log } = makeRenderer();
  const t = r.allocate(1280, 720);
  assert.equal(t.format, gl.RGBA8);
  assert.equal((backdrop.match(/texture\(/g) || []).length, 4);
  assert.match(backdrop, /outColor=vec4\(clamp\(\(code\+0\.25\)\/uCacheLevels,0\.0,1\.0\),1\.0\)/);
  assert.doesNotMatch(backdrop, /sampler.*Noise/);
});
test('explicit UNORM codes survive both truncation and nearest conversion', () => {
  for (const levels of [255, 1023])
    for (let code = 0; code <= levels; code++) {
      const stored = Math.min(1, Math.fround(Math.fround(code + 0.25) / levels)) * levels;
      assert.equal(Math.floor(stored), code);
      assert.equal(Math.round(stored), code);
    }
});
test('colour and output are mediump, including the explicit non-lowp samplers', () => {
  assert.match(composite, /precision mediump float;/);
  assert.match(composite, /precision mediump sampler2D;/);
  assert.match(composite, /out mediump vec4 outColor;/);
  assert.match(composite, /vec3 background=texture\(uBackdrop,vUV\).rgb/);
  assert.doesNotMatch(composite, /highp vec3|highp vec4|ambientTerms/);
  assert.match(composite, /  float m=signalAt\(vUV\);/);
  assert.match(composite, /  vec4 center=texture\(uScene,uv\);/);
  assert.match(composite, /if\(vUV.y<uBand.x\|\|vUV.y>uBand.y\)/);
});
test('single fixed hash replaces the two-hash dither without a frame clock', () => {
  const f = Math.fround,
    fract = (x) => x - Math.floor(x);
  const n = (x, y) =>
    fract(f(f(52.9829189) * fract(f(f(f(x) * f(0.06711056)) + f(f(y) * f(0.00583715))))));
  let sum = 0,
    min = 1,
    max = -1,
    count = 0;
  for (let y = 0; y < 720; y++)
    for (let x = 0; x < 1280; x++) {
      const d = f((n(x + 0.5, y + 0.5) - 0.5) * 2);
      sum += d;
      count++;
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
  assert.ok(min >= -1 && max < 1);
  assert.ok(Math.abs(sum / count) < 0.002);
  assert.equal((composite.match(/52\.9829189/g) || []).length, 1);
  assert.doesNotMatch(composite, /uniform[^;]*(?:uTime|uFrame|uNoise)/);
});
test('a successfully displayed WebGL background disables only its adjacent legacy overlay', () => {
  const { w, attributes, writes } = makeWave();
  w.draw();
  assert.equal(attributes['data-ps3-background'], 'true');
  for (let i = 0; i < 600; i++) w.draw();
  assert.equal(writes.length, 2);
  assert.match(
    css,
    /#wave\[data-ps3-background=['"]true['"]\]\s*\+\s*\.ambient\s*\{\s*display\s*:\s*none\s*;?\s*\}/
  );
});
test('switching to Theme or RGB keeps CSS hidden and removes only the PS3 marker', () => {
  const { w, attributes, writes } = makeWave();
  w.draw();
  w.renderer.monthlyActive = false;
  w.draw();
  w.draw();
  assert.equal(attributes['data-ps3-background'], undefined);
  assert.equal(attributes['data-background-composited'], 'true');
  assert.equal(writes.length, 3);
});
test('missing PS3 textures keep GPU-generated fallback decoration, not a second CSS layer', () => {
  const { w, attributes } = makeWave();
  w.palette = { monthly: { month: 8 } };
  w.renderer.monthlyActive = false;
  w.draw();
  assert.equal(attributes['data-ps3-background'], undefined);
});
test('hidden or paused draw attempts keep the displayed-frame marker', () => {
  const { w, attributes, writes } = makeWave();
  w.draw();
  w.allowed = () => false;
  w.renderer.monthlyActive = false;
  w.draw();
  assert.equal(attributes['data-ps3-background'], 'true');
  assert.equal(writes.length, 2);
});
test('renderer failure restores static fallback decoration', () => {
  const { w, attributes } = makeWave();
  w.draw();
  w.renderer.draw = () => {
    throw Error('Allocation failed');
  };
  w.draw();
  assert.equal(w.mode, 'static');
  assert.equal(w.renderer, null);
  assert.equal(attributes['data-ps3-background'], undefined);
});
test('destroy clears both markers and is idempotent', () => {
  const { w, attributes, writes } = makeWave();
  w.draw();
  w.destroy();
  w.destroy();
  assert.equal(attributes['data-ps3-background'], undefined);
  assert.equal(attributes['data-background-composited'], undefined);
  assert.equal(writes.length, 4);
});
test('recreated renderer redraw uses its actual monthly state after context restoration', () => {
  const { w, attributes } = makeWave();
  w.draw();
  w.renderer = { configure() {}, draw() {}, monthlyActive: false };
  w.draw();
  assert.equal(attributes['data-ps3-background'], undefined);
  w.renderer.monthlyActive = true;
  w.draw();
  assert.equal(attributes['data-ps3-background'], 'true');
});
test('endpoint taper does not lift black or dim white', () => {
  assert.match(composite, /255\.0\*min\(rgb,vec3\(1\.0\)-rgb\)/);
  for (const c of [0, 0.0001, 0.001, 0.01, 0.5, 0.9999, 1]) {
    const amount = Math.min(1, 255 * Math.min(c, 1 - c));
    for (const n of [-1, -0.5, 0, 0.5, 1]) {
      const v = c + (n / 255) * amount;
      assert.ok(v >= -1e-12 && v <= 1 + 1e-12);
      if (c === 0 || c === 1) assert.equal(v, c);
    }
  }
});
