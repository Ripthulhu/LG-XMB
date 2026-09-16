'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/wave.js'), 'utf8');
// The animation clock's rate lives in wave.js. Read it from the source rather
// than repeating it here, so retuning the wave's speed does not fail these
// tests, which are about pacing behaviour and not about the rate itself.
const RATE = Number(/\*([0-9.]+)\*this\.speed/.exec(source)[1]);

function setup({ hidden = false, reducedMotion = false, initialize = true,
  options = {quality: '720p', adaptive: false} } = {}) {
  let frameId = 0;
  let now = 0;
  const frames = new Map();
  const contextRequests = [];
  const metrics = {writes: [], draws: 0, rectReads: 0};
  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    dispatch(type) {
      for (const fn of this.listeners.get(type) || []) fn({type, preventDefault() {}});
    }
  }
  const document = new Events();
  document.hidden = hidden;
  const media = new Events();
  media.matches = reducedMotion;
  const canvas = new Events();
  canvas.style = {};
  canvas.rect = {width: 1920, height: 1080};
  canvas.pixels = 'last-presented-frame';
  let width = 1280;
  let height = 720;
  Object.defineProperties(canvas, {
    width: {get: () => width, set: value => {
      width = value;
      metrics.writes.push(['width', value]);
      canvas.pixels = 'cleared';
    }},
    height: {get: () => height, set: value => {
      height = value;
      metrics.writes.push(['height', value]);
      canvas.pixels = 'cleared';
    }}
  });
  canvas.getBoundingClientRect = () => { metrics.rectReads++; return {...canvas.rect}; };
  let contextOptions;
  const gl = {
    getExtension: () => null,
    getContextAttributes: () => ({...contextOptions}),
    getParameter: name => name === 'MAX_VIEWPORT_DIMS' ? [4096, 4096] :
      name === 'MAX_RENDERBUFFER_SIZE' || name === 'MAX_TEXTURE_SIZE' ? 4096 : 'Fake WebGL',
    getShaderPrecisionFormat: () => ({precision: 23}),
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    drawArrays() { metrics.draws++; canvas.pixels = 'drawn-frame-' + metrics.draws; }
  };
  for (const name of ['MAX_VIEWPORT_DIMS', 'MAX_RENDERBUFFER_SIZE', 'MAX_TEXTURE_SIZE', 'VENDOR', 'RENDERER',
    'VERSION', 'SHADING_LANGUAGE_VERSION', 'FRAGMENT_SHADER', 'VERTEX_SHADER', 'HIGH_FLOAT', 'LINK_STATUS',
    'COMPILE_STATUS', 'ARRAY_BUFFER', 'STATIC_DRAW', 'FLOAT', 'DEPTH_TEST', 'BLEND', 'TRIANGLES']) gl[name] = name;
  for (const name of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader',
    'useProgram', 'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'disable',
    'viewport', 'uniform2f', 'uniform1f', 'uniform3fv', 'deleteBuffer', 'deleteProgram']) gl[name] = () => {};
  canvas.getContext = (type, options) => {
    contextRequests.push({type, options: {...options}});
    contextOptions = options;
    return gl;
  };
  const window = new Events();
  Object.assign(window, {
    document, innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    performance: {now: () => now}, matchMedia: () => media,
    requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  // These tests cover what wave.js owns: context attributes, backing size,
  // pacing and teardown. The spline surface is stubbed so a fake GL context is
  // enough; ps3-wave.test.cjs drives the real one.
  const surface = {
    programs: [{}], finish() {}, configure() {}, draw() { return false; },
    diagnostics: () => ({surfaceWidth: width, surfaceHeight: height}),
    destroy(lost) { surface.destroyed = lost; }
  };
  window.LGXMBPS3Wave = {
    backdrop: 'precision PRECISION float; void main() {}',
    create: () => surface,
    quality: (options, current) => Object.assign({}, current, options)
  };
  vm.runInNewContext(source, {window, document, Date, Float32Array, console});
  const wave = new window.C5Wave(canvas, options);
  function frame() {
    now += 1000 / 60;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(now));
  }
  if (initialize && !hidden) {
    frame(); frame();
    assert.equal(wave.mode, 'webgl');
    assert.equal(wave.initialized, true);
  }
  function resetMetrics() { metrics.writes.length = 0; metrics.draws = 0; metrics.rectReads = 0; }
  function visibility(value) { document.hidden = value; document.dispatch('visibilitychange'); }
  return {wave, canvas, document, window, frames, contextRequests, metrics, frame, resetMetrics, visibility, surface};
}

test('WebGL context requests a preserved color buffer without extra attachments', () => {
  const h = setup();
  assert.equal(h.contextRequests.length, 1);
  assert.equal(h.contextRequests[0].type, 'webgl2');
  assert.equal(h.wave.contextVersion,2);
  assert.equal(h.contextRequests[0].options.preserveDrawingBuffer, true);
  assert.equal(h.contextRequests[0].options.antialias, false);
  assert.equal(h.contextRequests[0].options.depth, false);
  assert.equal(h.contextRequests[0].options.stencil, false);
  assert.equal(h.wave.getDiagnostics().capabilities.contextAttributes.preserveDrawingBuffer, true);
});

test('Wave style defaults preserve quality and timing, validates bounded choices, and changes only clock or brightness', () => {
  const h = setup(), initial = h.wave.getDiagnostics();
  assert.equal(initial.speed, 1); assert.equal(initial.brightness, 1);
  h.resetMetrics();
  h.wave.setStyle({speed: Infinity, brightness: -1});
  assert.equal(h.wave.speed, 1); assert.equal(h.wave.brightness, 1);
  assert.equal(h.metrics.draws, 0);
  h.wave.setStyle({speed: 0.5, brightness: 0.6});
  assert.equal(h.metrics.draws, 1); assert.deepEqual(h.metrics.writes, []);
  assert.equal(h.contextRequests.length, 1);
  const beforeTime = h.wave.time;
  h.wave.lastFrame = 1000; h.wave._tick(1100);
  assert.ok(Math.abs(h.wave.time - beforeTime - RATE*1.5/30) < 1e-10);
  h.wave.setStyle({speed: 2.25, brightness: 1.5});
  const fastTime = h.wave.time;
  h.wave.lastFrame = 2000; h.wave._tick(2100);
  assert.ok(Math.abs(h.wave.time - fastTime - 0.1*RATE*2.25) < 1e-10);
  const after = h.wave.getDiagnostics();
  assert.equal(after.targetFps, initial.targetFps); assert.equal(after.quality, initial.quality);
  assert.equal(after.adaptive, initial.adaptive); assert.deepEqual(h.metrics.writes, []);
});

test('Wave style changes retain hidden frames and do not restart reduced-motion rendering', () => {
  const h = setup(); h.wave.setReducedMotion(true); h.resetMetrics();
  h.wave.setReducedMotion(true);
  assert.equal(h.metrics.draws, 0, 'An unchanged animation choice does not redraw');
  h.visibility(true); const pixels = h.canvas.pixels;
  h.wave.setStyle({brightness: 1.5, speed: 0.5});
  assert.equal(h.canvas.pixels, pixels); assert.equal(h.metrics.draws, 0);
  assert.deepEqual(h.metrics.writes, []); assert.equal(h.frames.size, 0);
  h.visibility(false);
  assert.equal(h.metrics.draws, 1); assert.equal(h.frames.size, 0);
  assert.equal(h.wave.getDiagnostics().brightness, 1.5);
});

test('unchanged dimensions neither rewrite the backing buffer nor redraw', () => {
  const h = setup();
  const oldPixels = h.canvas.pixels;
  h.resetMetrics();
  assert.equal(h.wave._resize(), false);
  assert.equal(h.wave._resize(), false);
  assert.deepEqual(h.metrics.writes, []);
  assert.equal(h.metrics.draws, 0);
  assert.equal(h.canvas.pixels, oldPixels);
  assert.equal(h.wave.resizePending, false);
});

test('changed visible dimensions update the backing size and redraw exactly once', () => {
  const h = setup();
  h.canvas.rect = {width: 1000, height: 500};
  h.resetMetrics();
  assert.equal(h.wave._resize(), true);
  assert.equal(h.canvas.width, 1000);
  assert.equal(h.canvas.height, 500);
  assert.equal(h.metrics.draws, 1);
  assert.notEqual(h.canvas.pixels, 'cleared');
  const writes = h.metrics.writes.length;
  assert.equal(h.wave._resize(), false);
  assert.equal(h.metrics.writes.length, writes);
  assert.equal(h.metrics.draws, 1);
});

test('hidden resize preserves the last frame and applies only the latest size once on return', () => {
  const h = setup();
  h.visibility(true);
  const oldPixels = h.canvas.pixels;
  h.resetMetrics();
  h.canvas.rect = {width: 0, height: 0};
  assert.equal(h.wave._resize(), false);
  h.canvas.rect = {width: 640, height: 360};
  assert.equal(h.wave._resize(), false);
  h.canvas.rect = {width: 1000, height: 500};
  assert.equal(h.wave._resize(), false);
  assert.equal(h.wave.resizePending, true);
  assert.deepEqual(h.metrics.writes, []);
  assert.equal(h.metrics.rectReads, 0, 'hidden geometry is not sampled');
  assert.equal(h.metrics.draws, 0);
  assert.equal(h.canvas.pixels, oldPixels);
  assert.equal(h.frames.size, 0);
  h.visibility(false);
  assert.equal(h.canvas.width, 1000);
  assert.equal(h.canvas.height, 500);
  assert.equal(h.wave.resizePending, false);
  assert.equal(h.metrics.rectReads, 1);
  assert.equal(h.metrics.draws, 1, 'resume does not draw twice after applying the pending resize');
  assert.equal(h.frames.size, 1);
  const writeCount = h.metrics.writes.length;
  h.visibility(false);
  h.wave.setPaused(false);
  assert.equal(h.wave._resize(), false);
  assert.equal(h.metrics.writes.length, writeCount);
  assert.equal(h.metrics.draws, 1);
  assert.equal(h.frames.size, 1);
});

test('paused resize keeps the current backing intact until unpaused', () => {
  const h = setup();
  h.wave.setPaused(true);
  const oldPixels = h.canvas.pixels;
  h.resetMetrics();
  h.canvas.rect = {width: 800, height: 450};
  assert.equal(h.wave._resize(), false);
  h.canvas.rect = {width: 960, height: 540};
  assert.equal(h.wave._resize(), false);
  assert.equal(h.wave.resizePending, true);
  assert.equal(h.metrics.rectReads, 0);
  assert.deepEqual(h.metrics.writes, []);
  assert.equal(h.metrics.draws, 0);
  assert.equal(h.canvas.pixels, oldPixels);
  assert.equal(h.frames.size, 0);
  h.wave.setPaused(false);
  assert.equal(h.canvas.width, 960);
  assert.equal(h.canvas.height, 540);
  assert.equal(h.metrics.draws, 1);
  assert.equal(h.wave.resizePending, false);
  assert.equal(h.frames.size, 1);
});

test('a deferred unchanged size resumes with one draw and no backing assignments', () => {
  const h = setup();
  h.visibility(true);
  h.resetMetrics();
  assert.equal(h.wave._resize(), false);
  assert.equal(h.wave.resizePending, true);
  h.visibility(false);
  assert.deepEqual(h.metrics.writes, []);
  assert.equal(h.metrics.draws, 1, 'resume supplies one redraw even though the pending size stayed unchanged');
  assert.equal(h.wave.resizePending, false);
});

test('context-lost resize never writes the backing size or starts animation', () => {
  const h = setup();
  h.canvas.dispatch('webglcontextlost');
  h.canvas.rect = {width: 640, height: 360};
  h.resetMetrics();
  assert.equal(h.wave._resize(), false);
  h.wave._resume();
  assert.equal(h.wave.resizePending, true);
  assert.equal(h.metrics.rectReads, 0);
  assert.deepEqual(h.metrics.writes, []);
  assert.equal(h.metrics.draws, 0);
  assert.equal(h.frames.size, 0);
});

test('hidden construction does not size, initialize or animate before becoming visible', () => {
  const h = setup({hidden: true});
  assert.equal(h.wave.resizePending, true);
  assert.equal(h.metrics.rectReads, 0);
  assert.deepEqual(h.metrics.writes, []);
  assert.equal(h.canvas.pixels, 'last-presented-frame');
  assert.equal(h.contextRequests.length, 0);
  assert.equal(h.frames.size, 0);
  h.wave.setReducedMotion(true);
  h.wave._resume();
  h.frame();
  assert.equal(h.frames.size, 0);
  assert.equal(h.contextRequests.length, 0);
  h.canvas.rect = {width: 640, height: 360};
  h.visibility(false);
  h.frame(); h.frame();
  assert.equal(h.wave.mode, 'webgl');
  assert.equal(h.canvas.width, 640);
  assert.equal(h.canvas.height, 360);
  assert.equal(h.frames.size, 0, 'reduced motion initializes a still without starting an animation loop');
});

test('reduced-motion return applies pending resize once without an animation loop', () => {
  const h = setup({reducedMotion: true});
  assert.equal(h.frames.size, 0);
  h.visibility(true);
  h.canvas.rect = {width: 960, height: 540};
  h.resetMetrics();
  h.wave._resize();
  h.wave._resume();
  h.frame();
  assert.equal(h.frames.size, 0);
  assert.equal(h.metrics.draws, 0);
  h.visibility(false);
  assert.equal(h.metrics.draws, 1);
  assert.equal(h.canvas.width, 960);
  assert.equal(h.canvas.height, 540);
  assert.equal(h.frames.size, 0);
  h.visibility(false);
  h.wave.setPaused(false);
  assert.equal(h.wave._resize(), false);
  assert.equal(h.metrics.draws, 1);
  assert.equal(h.frames.size, 0);
});


test('Fixed full-HD backing does not downscale after sustained scheduling gaps', () => {
  const h = setup({options: {quality: '1080p', adaptive: false}});
  assert.deepEqual([h.canvas.width, h.canvas.height], [1920, 1080]);
  h.resetMetrics();
  for (let now = 1000; now <= 31000; now += 50) h.wave._sampleTiming(now);
  const diagnostics = h.wave.getDiagnostics();
  assert.equal(diagnostics.quality, '1080p');
  assert.equal(diagnostics.adaptive, false);
  assert.equal(diagnostics.qualityChanges.length, 0);
  assert.ok(diagnostics.scheduling.completedWindows >= 2);
  assert.deepEqual([h.canvas.width, h.canvas.height], [1920, 1080]);
  assert.deepEqual(h.metrics.writes, []);
  assert.equal(diagnostics.targetFps, 30);
});

test('Full-HD backing remains capped on high-DPI and 4K displays', () => {
  const h = setup({options: {quality: '1080p', adaptive: false}});
  h.window.devicePixelRatio = 2;
  h.wave._resize();
  assert.deepEqual([h.canvas.width, h.canvas.height], [1920, 1080]);
  h.canvas.rect = {width: 3840, height: 2160}; h.wave._resize();
  assert.deepEqual([h.canvas.width, h.canvas.height], [1920, 1080]);
  h.wave.capabilities.maxViewport = [1024, 1024];
  h.wave.capabilities.maxRenderbuffer = 1024;
  h.wave._resize();
  assert.ok(h.canvas.width <= 1024 && h.canvas.height <= 1024, 'Hard GPU limits still apply');
});
