// SPDX-License-Identifier: GPL-3.0-or-later
// Focused background checks; no private data, TV connection or WebGL mock
// presented as a pixel test. The separately supplied EGL test measures pixels.
'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const root = fs.existsSync(path.join(ROOT, 'app')) ? ROOT : path.resolve(ROOT, '..');
const source = fs.readFileSync(path.join(root, 'app/ps3-native-renderer.js'), 'utf8');
const backdrop = fs.readFileSync(path.join(root, 'shaders/backdropFragment.frag'), 'utf8');
const monthly = fs.readFileSync(path.join(root, 'shaders/monthlyBackground.frag'), 'utf8');
const shaders = require(path.join(root, 'app/ps3-native-shaders.js'));
// These production methods are independent of the simulation and its private
// seed pack. Extract their actual bodies rather than reimplementing them here.
function method(name) {
  const start = source.indexOf('  Renderer.prototype.' + name + ' = function (');
  assert.ok(start >= 0, name + ' is present');
  const expression = source.indexOf('function (', start), end = source.indexOf('\n  };', expression);
  assert.ok(end > expression, name + ' has a body');
  return Function('return (' + source.slice(expression, end + 4) + ');')();
}
function makeGL(options = {}) {
  let id = 0, texture = null, framebuffer = null, pending = 0;
  const counts = {draws: 0, allocations: [], deletes: [], extensionCalls: 0};
  const gl = {RGBA8: 0x8058, RGB10_A2: 0x8059, RGBA16F: 0x881a, FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_COMPLETE: 0x8cd5, COLOR_ATTACHMENT0: 0x8ce0, TEXTURE_2D: 0xde1,
    NO_ERROR: 0, LINEAR: 0x2601, RENDERBUFFER: 0x8d41, RENDERBUFFER_SAMPLES: 0x8cab,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803, CLAMP_TO_EDGE: 0x812f, TRIANGLES: 4, BLEND: 0xbe2, TEXTURE0: 0x84c0,
    createTexture: () => ({kind: 'texture', id: ++id}),
    createFramebuffer: () => ({kind: 'framebuffer', id: ++id}),
    createRenderbuffer: () => ({kind: 'renderbuffer', id: ++id}),
    bindTexture: (target, t) => { texture = t; },
    bindFramebuffer: (target, f) => { framebuffer = f; },
    bindRenderbuffer: () => {},
    texStorage2D: (target, levels, format, width, height) => {
      texture.format = format;
      counts.allocations.push({format, width, height});
      if (format === gl.RGBA16F && options.floatError) pending = 0x500;
    },
    texParameteri: () => {},
    framebufferTexture2D: () => { framebuffer.format = texture.format; },
    checkFramebufferStatus: () => options.allIncomplete ||
      (options.floatIncomplete && framebuffer.format === gl.RGBA16F) ? 0x8cd6 : gl.FRAMEBUFFER_COMPLETE,
    getError: () => {const result = pending; pending = 0; return result;},
    getExtension: name => {
      counts.extensionCalls++;
      return options.extension === name ? {} : null;
    },
    deleteTexture: value => counts.deletes.push(value),
    deleteFramebuffer: value => counts.deletes.push(value),
    deleteRenderbuffer: value => counts.deletes.push(value),
    renderbufferStorageMultisample: (target, samples, format, width, height) => {
      counts.samples = samples; counts.msaaFormat = format;
    },
    getRenderbufferParameter: () => counts.samples,
    framebufferRenderbuffer: () => {},
    viewport: () => {}, disable: () => {}, useProgram: () => {},
    bindVertexArray: () => {}, activeTexture: () => {}, uniform1i: () => {}, uniform1f: () => {},
    drawArrays: () => counts.draws++
  };
  return {gl, counts};
}
function renderer(options) {
  const {gl, counts} = makeGL(options), r = {gl, objects: [], programs: [], allocations: 0,
    monthlyKey: '', backdropKey: '', uniforms: {backdrop: {uMonthly: 0}}};
  for (const name of ['allocate', 'releaseTarget', 'prepareMonthlyTarget', 'destroy', 'allocateBackdrop', 'backdropPass']) r[name] = method(name);
  return {r, gl, counts};
}
test('bundled shaders match reviewable GLSL exactly', () => {
  assert.equal(shaders.backdropFragment, backdrop);
  assert.equal(shaders.monthlyBackground, monthly);
  assert.ok(backdrop.startsWith('#version 300 es\n'));
  assert.ok(monthly.startsWith('#version 300 es\n'));
});
test('fractional monthly samples have explicit high precision', () => {
  assert.match(backdrop, /uniform highp sampler2D uMonthly;/);
});
test('dither is bounded, neutral and screen-fixed, without new texture reads', () => {
  assert.equal((backdrop.match(/texture\(/g) || []).length, 4);
  assert.match(backdrop, /gl_FragCoord\.xy/);
  assert.match(backdrop, /clamp\(\(code\+0\.25\)\/uCacheLevels,0\.0,1\.0\)/);
  assert.doesNotMatch(backdrop, /uniform[^;]*(?:Time|Frame|Noise)/);
  let sum = 0, lo = Infinity, hi = -Infinity;
  for (let y = 0; y < 720; y++) for (let x = 0; x < 1280; x++) {
    const q = Math.fround(Math.fround(Math.fround(x + .5) * Math.fround(.7548776662)) +
      Math.fround(Math.fround(y + .5) * Math.fround(.5698402909)));
    const d = q - Math.floor(q) - .5; sum += d; lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  assert.ok(lo >= -.5 && hi < .5);
  assert.ok(Math.abs(sum / (1280 * 720)) < .001);
});
test('FP16 output keeps the previous normalized target range', () => {
  assert.match(monthly, /outColor=clamp\(vec4\(s593, s594, s595, _Alpha\),0\.0,1\.0\);/);
});
test('supported floating-point colour uses only a 64x32 RGBA16F intermediate', () => {
  const {r, gl, counts} = renderer({extension: 'EXT_color_buffer_float'});
  r.prepareMonthlyTarget();
  assert.deepEqual(counts.allocations, [{format: gl.RGBA16F, width: 64, height: 32}]);
  assert.equal(r.monthlyTexture, r.monthlyTarget.texture);
  assert.equal(r.monthlyFbo, r.monthlyTarget.framebuffer);
});
test('half-float-only extension is sufficient', () => {
  const {r, gl} = renderer({extension: 'EXT_color_buffer_half_float'});
  r.prepareMonthlyTarget(); assert.equal(r.monthlyTarget.format, gl.RGBA16F);
});
test('no float extension keeps the existing RGBA8 fallback', () => {
  const {r, gl, counts} = renderer(); r.prepareMonthlyTarget();
  assert.deepEqual(counts.allocations, [{format: gl.RGBA8, width: 64, height: 32}]);
});
test('incomplete optional FP16 target is released and retried in RGBA8', () => {
  const {r, gl, counts} = renderer({extension: 'EXT_color_buffer_float', floatIncomplete: true});
  r.prepareMonthlyTarget();
  assert.equal(r.monthlyTarget.format, gl.RGBA8);
  assert.equal(counts.allocations.length, 2); assert.equal(counts.deletes.length, 2);
});
test('a refused float allocation drains its error before retrying', () => {
  const {r, gl, counts} = renderer({extension: 'EXT_color_buffer_float', floatError: true, floatIncomplete: true});
  r.prepareMonthlyTarget(); assert.equal(r.monthlyTarget.format, gl.RGBA8);
  assert.equal(gl.getError(), 0); assert.equal(counts.deletes.length, 2);
});
test('failure of both optional targets leaves no live monthly target', () => {
  const {r, counts} = renderer({extension: 'EXT_color_buffer_float', allIncomplete: true});
  r.prepareMonthlyTarget(); assert.equal(r.monthlyTexture, null); assert.equal(r.monthlyTarget, null);
  assert.equal(counts.deletes.length, 4);
});
test('default full-size wave/MSAA allocations stay RGBA8', () => {
  const {r, gl, counts} = renderer({extension: 'EXT_color_buffer_float'});
  r.prepareMonthlyTarget();
  assert.equal(r.allocate(1920, 1080, 0).format, gl.RGBA8);
  assert.equal(r.allocate(1280, 720, 4).format, gl.RGBA8);
  assert.equal(counts.msaaFormat, gl.RGBA8);
});
test('recreating the tiny target releases its predecessor', () => {
  const {r, counts} = renderer({extension: 'EXT_color_buffer_float'});
  r.prepareMonthlyTarget(); const previous = r.monthlyTexture;
  r.prepareMonthlyTarget(); assert.notEqual(r.monthlyTexture, previous);
  assert.equal(counts.deletes.filter(v => v === previous).length, 1);
});
test('unchanged full-size cache redraws do not allocate or draw', () => {
  const {r, gl, counts} = renderer({extension: 'EXT_color_buffer_float'});
  r.prepareMonthlyTarget(); r.monthlyKey = 'fixed-preset'; r.backdropPass(1920, 1080);
  const allocationCount = counts.allocations.length, extensionCalls = counts.extensionCalls;
  for (let n = 0; n < 600; n++) r.backdropPass(1920, 1080);
  assert.equal(counts.draws, 1); assert.equal(counts.allocations.length, allocationCount);
  assert.equal(counts.extensionCalls, extensionCalls);
  assert.equal(r.backdrop.format, gl.RGB10_A2);
});
test('clock change or resize refreshes the cache once', () => {
  const {r, counts} = renderer(); r.prepareMonthlyTarget();
  r.monthlyKey = 'a'; r.backdropPass(1280, 720); r.monthlyKey = 'b'; r.backdropPass(1280, 720);
  assert.equal(counts.draws, 2); assert.equal(counts.allocations.length, 2);
  r.backdropPass(1920, 1080); r.backdropPass(1920, 1080);
  assert.equal(counts.draws, 3); assert.equal(counts.allocations.length, 3);
});
test('destroy releases the tiny target exactly once', () => {
  const {r, counts} = renderer({extension: 'EXT_color_buffer_float'});
  r.prepareMonthlyTarget(); const texture = r.monthlyTexture;
  r.destroy(false); r.destroy(false);
  assert.equal(counts.deletes.filter(v => v === texture).length, 1);
  assert.equal(r.monthlyTarget, null); assert.equal(r.monthlyTexture, null);
});
test('context loss drops handles without deleting lost-context resources', () => {
  const {r, counts} = renderer({extension: 'EXT_color_buffer_float'});
  r.prepareMonthlyTarget(); r.destroy(true);
  assert.equal(counts.deletes.length, 0); assert.equal(r.monthlyFbo, null);
});
