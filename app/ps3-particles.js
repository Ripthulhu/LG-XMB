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
    'uniform vec2 uPointRange; varying mediump float vAlpha; varying mediump float vDefocus;',
    'varying mediump vec2 vShape; varying mediump vec4 vFlake;',
    'void main() {',
    // Recover a uniform depth seed from the reference's size-biased random seed.
    '  float depth=pow(clamp(aSeed.z-0.1,0.0,1.0),0.125);',
    '  float perspective=2.6/(1.2+depth*3.2);',
    '  vDefocus=smoothstep(0.08,0.55,abs(depth-0.52));',
    '  float sharpSize=(aSeed.z*1.5+2.6)*perspective;',
    '  float spread=vDefocus*(2.0+(1.0-depth)*7.0);',
    '  float spriteSize=sharpSize+spread;',
    // gl_PointSize is declared mediump in GLSL ES 1.00. The rim and sliver maths
    // below need the exact size, so they read this highp local, never the output.
    '  float sprite=clamp(spriteSize*uSizeScale,uPointRange.x,uPointRange.y);',
    '  gl_PointSize=sprite;',
    '  float time=uTime*0.18;',
    // A narrow distant stream on the left broadens towards the viewer/right.
    // The exponent sets how hard they pile up at the left: travel is uniform,
    // so a share a of them sit left of a^(1/exponent) across the screen.
    '  float travel=fract(time*(aSeed.x-0.5)*perspective/15.0+aSeed.y*50.0);',
    '  float across=pow(travel,1.60);',
    '  float x=across*2.0-1.0;',
    '  float y=sin(sign(aSeed.y)*time*(aSeed.y+1.5)/4.0+aSeed.x*100.0)',
    '          /((6.0-aSeed.x*4.0*aSeed.y)/uRatio);',
    '  y*=mix(0.46,1.65,across)*perspective;',
    // Larger out-of-focus discs carry less peak energy; wrap out of view softly.
    '  float energy=clamp(sharpSize*sharpSize/(spriteSize*spriteSize),0.18,1.0);',
    '  float wrapFade=smoothstep(0.0,0.045,travel)*(1.0-smoothstep(0.955,1.0,travel));',
    // Nine per-flake constants out of the three seeds we already ship. Hashing
    // depth rather than aSeed.z matters: aSeed.z is pow(r,8)+0.1 and piles up at
    // 0.1, while depth inverts that exactly and is uniform. Multiply/add/fract
    // only, so nothing here leans on a driver's sin() at a large argument.
    '  vec3 hs=vec3(aSeed.x,aSeed.y,depth);',
    '  vec3 hA=fract(vec3(dot(hs,vec3(21.71,39.13,7.57)),',
    '                     dot(hs,vec3(13.37,11.29,51.83)),',
    '                     dot(hs,vec3(45.19,27.61,33.07))));',
    '  hA=fract(hA*hA.yzx*57.83+hA.zxy*19.73+vec3(0.371,0.577,0.813));',
    '  vec3 hB=fract(hA*hA.zxy*31.73+hA.yzx*29.53+vec3(0.917,0.243,0.659));',
    '  vec3 hC=fract(hB*hB.yzx*31.73+hB.zxy*31.17+vec3(0.653,0.119,0.487));',
    // Three independent angles: tumble tips the plate, axis is the screen
    // direction it foreshortens along, roll turns the flake in its own plane.
    // Sharing one angle between roll and axis pins the hexagon to its own tilt
    // axis and cancels its whole contribution to the aspect ratio.
    // fract() wraps each phase before the multiply by 2pi, so no trig argument
    // ever passes 2pi however long the clock has been running.
    '  float tumble=6.2831853*fract(uTime*(0.18+0.32*hA.x)+hA.y);',
    '  float axis=6.2831853*fract(uTime*(0.05+0.20*hB.x)*sign(hA.z-0.5)+hB.y);',
    '  float roll=6.2831853*fract(uTime*(0.06+0.22*hC.x)*sign(hC.z-0.5)+hC.y);',
    // A plate at tilt t projects to aspect 1/|cos t|. The point spread cannot
    // resolve a sliver under about 0.7px, so add it in quadrature and take the
    // light straight back out: thin flakes fade rather than alias, and the
    // aspect distribution stays smooth instead of piling up against a cap.
    '  float face=abs(cos(tumble));',
    '  float least=0.7/max(sprite,1.0);',
    '  float lsq=least*least;',
    '  float wide=sqrt((face*face+lsq)/(1.0+lsq));',
    // Blur wider than the flake replaces its outline with the aperture's, so the
    // hexagon and its foreshortening fade out together on one weight.
    '  float blurred=smoothstep(0.45,1.00,spread/sharpSize);',
    '  float squeeze=mix(1.0/wide,1.0,blurred);',
    // Sprite space to flake space: undo the squash about axis, then the roll.
    // The divide lives here so the fragment shader only ever multiplies.
    '  float ex=squeeze-1.0;',
    '  vec2 n=vec2(cos(axis),sin(axis));',
    '  float b00=1.0+ex*n.x*n.x;',
    '  float b01=ex*n.x*n.y;',
    '  float b11=1.0+ex*n.y*n.y;',
    '  float cr=cos(roll); float sr=sin(roll);',
    '  vFlake=vec4(cr*b00+sr*b01,cr*b01+sr*b11,cr*b01-sr*b00,cr*b11-sr*b01);',
    // Transition width, as a fraction of the sprite radius, held at 2 display
    // pixels for every size. Under 4px the sprite is smaller than its own
    // transition, rim clamps to 1, and the same formula becomes a smooth bump.
    '  float rim=clamp(4.0/max(sprite,1.0),0.04,1.0);',
    '  vShape=vec2(blurred,1.0/(rim*(2.0-rim)));',
    // A mirror flake flashes when its normal sweeps the specular direction:
    // fixed tumble angle, twice per turn, offset per flake. ^16 by squaring.
    '  float flash=abs(cos(tumble+6.2831853*hB.z));',
    '  flash*=flash; flash*=flash; flash*=flash; flash*=flash;',
    // Foreshortening already thins the silhouette, so peak times area tracks the
    // true projected area on its own. 0.8270 is the hexagon/disc area ratio,
    // which holds total light steady across the morph rather than stepping 21%.
    '  vAlpha=(1.0-0.4*fract(aSeed.x+time*0.00285))*energy*wrapFade',
    '         *mix(face/(wide*(1.0+lsq)),1.0,blurred)*mix(1.0,0.8270,blurred)',
    '         *(0.28+0.40*flash);',
    // Shares the spline's band placement, stretch included, so the sparkles
    // keep filling the wave rather than a slice of it. Keep in step with
    // BAND_SCALE and BAND_Y in ps3-wave.js. Independent of audio.
    '  gl_Position=vec4(x,y*1.850+(-0.0238),0.0,1.0);',
    '}'
  ].join('\n');
  var FRAGMENT = [
    'precision PRECISION float; varying mediump float vAlpha; varying mediump float vDefocus;',
    'varying mediump vec2 vShape; varying mediump vec4 vFlake;',
    'uniform vec3 uWave; uniform float uBrightness;',
    'void main() {',
    '  vec2 c=gl_PointCoord*2.0-1.0;',
    '  float g;',
    // Heavily defocused flakes take the aperture's shape, so they skip the
    // hexagon: 69% of covered fragments, and every sprite over 7.7px. At
    // blurred==1 squeeze is exactly 1 and the two branch bodies agree to the
    // bit, so a driver rounding the varying either way cannot show a seam.
    '  if (vShape.x<1.0) {',
    '    float u=dot(c,vFlake.xy);',
    '    float v=dot(c,vFlake.zw);',
    '    float au=abs(u); float av=abs(v);',
    '    float hex=max(au*1.1547005,au*0.5773503+av);',
    '    g=mix(hex*hex,u*u+v*v,vShape.x);',
    '  } else {',
    '    g=dot(c,c);',
    '  }',
    // Flat-topped interior with a narrow soft rim, sized in the vertex shader.
    // Coverage reaches exactly 0 inside the sprite square, so there is nothing
    // to discard and the draw does not force late depth/stencil on a tiler.
    '  float t=clamp((1.0-g)*vShape.y,0.0,1.0);',
    '  float a=clamp(vAlpha*(t*t*(3.0-2.0*t))*uBrightness,0.0,1.0);',
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
