/*
 * Adapted from linkev/PlayStation-3-XMB ps3xmbwave/particles.js and
 * particles-settings.js at 1ec453a9dddec5448d615116ff428349f42d454e.
 * Copyright (c) 2025 Mart. SPDX-License-Identifier: MIT
 * See licenses/PS3-XMB-MIT.txt and WAVE-PROVENANCE.md.
 */
(function (root) {
  'use strict';
  var COUNTS = [500, 2000, 4000], MAX_COUNT = 4000;
  var VERTEX = [
    'precision highp float; attribute vec3 aSeed;',
    'uniform float uTime; uniform float uRatio; uniform float uSizeScale;',
    'uniform vec2 uPointRange; varying mediump float vAlpha;',
    'void main() {',
    '  gl_PointSize=clamp((aSeed.z*1.5+2.6)*uSizeScale,uPointRange.x,uPointRange.y);',
    '  float time=uTime*0.18;',
    '  float x=fract(time*(aSeed.x-0.5)/15.0+aSeed.y*50.0)*2.0-1.0;',
    '  float y=sin(sign(aSeed.y)*time*(aSeed.y+1.5)/4.0+aSeed.x*100.0)',
    '          /((6.0-aSeed.x*4.0*aSeed.y)/uRatio);',
    '  float opVar=mix(sin(time*(aSeed.x+0.5)*12.0+aSeed.y*10.0),',
    '    sin(time*(aSeed.y+1.5)*6.0+aSeed.x*4.0),y*0.5+0.5)*aSeed.x+aSeed.y;',
    '  vAlpha=opVar*opVar*(1.0-fract(aSeed.x+time*0.00285));',
    // Match the vertical shift of our spline; keep the upstream trajectories.
    '  gl_Position=vec4(x,y-0.17,0.0,1.0);',
    '}'
  ].join('\n');
  var FRAGMENT = [
    'precision PRECISION float; varying mediump float vAlpha;',
    'uniform vec3 uWave; uniform float uBrightness;',
    'void main() {',
    '  vec2 c=gl_PointCoord*2.0-1.0; float d=dot(c,c);',
    '  if(d>1.0) discard;',
    '  float sparkle=(1.0-d)*(1.0-d);',
    '  float a=clamp(vAlpha*0.75*sparkle*uBrightness,0.0,1.0);',
    '  gl_FragColor=vec4(mix(vec3(1.0),uWave,0.16)*a,0.0);',
    '}'
  ].join('\n');

  function seeds() {
    // Stable distribution across quality changes/context restoration; no RNG in draw.
    var state = 0x505333, data = new Float32Array(MAX_COUNT * 3);
    function random() { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }
    for (var i = 0; i < MAX_COUNT; i++) {
      data[i*3] = random(); data[i*3+1] = random(); data[i*3+2] = Math.pow(random(),8)+0.1;
    }
    return data;
  }

  function create(gl, precision) {
    var shaders = [], program = null, buffer = null, dead = false, attribute = -1;
    function destroy(lost) {
      if (dead) return; dead = true;
      if (!lost) {
        shaders.forEach(function (shader) { gl.deleteShader(shader); });
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
      }
      shaders = []; buffer = null; program = null;
    }
    try {
      program = gl.createProgram(); if (!program) throw new Error('Particle program unavailable');
      [VERTEX, FRAGMENT.replace('PRECISION',precision === 'highp' ? 'highp' : 'mediump')].forEach(function (source,i) {
        var shader = gl.createShader(i ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER);
        if (!shader) throw new Error('Particle shader unavailable');
        shaders.push(shader); gl.shaderSource(shader,source); gl.compileShader(shader); gl.attachShader(program,shader);
      });
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('Particle shader refused');
      shaders.forEach(function (shader) { gl.deleteShader(shader); }); shaders = [];
      attribute = gl.getAttribLocation(program,'aSeed');
      if (attribute < 0) throw new Error('Particle attribute unavailable');
      buffer = gl.createBuffer(); if (!buffer) throw new Error('Particle buffer unavailable');
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,seeds(),gl.STATIC_DRAW);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Particle buffer refused');
      var range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
      if (!range || !Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[0] <= 0 || range[1] < range[0]) {
        throw new Error('Particle point sizes unavailable');
      }
      var uniforms = {};
      ['uTime','uRatio','uSizeScale','uPointRange','uWave','uBrightness'].forEach(function (name) {
        uniforms[name] = gl.getUniformLocation(program,name);
      });
      return {
        draw: function (time,width,height,wave,brightness,count) {
          if (dead) return;
          if (!Number.isFinite(time) || time < 0 || !Number.isFinite(width) || width <= 0 ||
              !Number.isFinite(height) || height <= 0 || COUNTS.indexOf(count) < 0 ||
              !Number.isFinite(brightness) || brightness < 0 || brightness > 1.5) throw new RangeError('Invalid particle draw');
          gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
          gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute,3,gl.FLOAT,false,0,0);
          gl.uniform1f(uniforms.uTime,time);
          gl.uniform1f(uniforms.uRatio,Math.max(1,Math.min(width/height,2))*0.375);
          gl.uniform1f(uniforms.uSizeScale,Math.min(height/1080,1));
          gl.uniform2f(uniforms.uPointRange,range[0],range[1]);
          gl.uniform3fv(uniforms.uWave,wave); gl.uniform1f(uniforms.uBrightness,brightness);
          gl.enable(gl.BLEND);
          // Add light, retain canvas alpha. Never overwrite Wave FXAA coverage.
          gl.blendFuncSeparate(gl.ONE,gl.ONE,gl.ZERO,gl.ONE);
          try { gl.drawArrays(gl.POINTS,0,count); }
          finally { gl.disableVertexAttribArray(attribute); gl.disable(gl.BLEND); }
        },
        destroy: destroy
      };
    } catch (error) { destroy(!!gl.isContextLost()); throw error; }
  }
  root.LGXMBPS3Particles = Object.freeze({create:create,createSeeds:seeds});
}(window));
