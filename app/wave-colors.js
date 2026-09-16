/*
 * Monthly gradient data and interpolation adapted from linkev/PlayStation-3-XMB
 * at 1ec453a9dddec5448d615116ff428349f42d454e. Copyright (c) 2025 Mart.
 * SPDX-License-Identifier: MIT. See licenses/PS3-XMB-MIT.txt.
 */
(function (root) {
  'use strict';
  // [angle in degrees, start RGB, end RGB]; upstream uses top-down UVs.
  var DAY = [
    [90.25,[197,197,197],[201,201,201]], [67,[203,158,13],[219,214,41]],
    [106,[142,190,40],[104,168,22]], [136.75,[216,182,182],[231,66,117]],
    [1.5,[19,108,19],[24,156,24]], [148.75,[198,120,238],[103,77,161]],
    [26.5,[0,167,146],[10,240,239]], [62.5,[0,0,95],[33,217,255]],
    [148.5,[146,44,155],[217,98,236]], [128.5,[227,151,15],[224,187,2]],
    [90,[115,68,20],[154,118,47]], [170.5,[236,68,45],[214,63,43]]
  ];
  var NIGHT = [
    [89.75,[181,181,181],[0,0,0]], [93.75,[198,188,128],[0,0,0]],
    [90.25,[152,170,113],[0,0,0]], [90.25,[212,174,182],[10,8,8]],
    [116,[48,118,48],[11,3,11]], [91,[209,163,225],[0,0,0]],
    [109.75,[16,129,124],[17,0,0]], [69.5,[20,159,176],[0,0,31]],
    [51,[116,0,153],[12,0,11]], [89.75,[216,142,0],[0,0,0]],
    [90,[131,86,32],[18,20,17]], [118.25,[157,59,44],[0,0,3]]
  ];
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function bounded(value,min,max,fallback) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback; }
  function normalize(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      mode:['theme','monthly','rgb'].indexOf(value.mode) >= 0 ? value.mode : 'theme',
      month:Number.isInteger(value.month) && value.month >= 1 && value.month <= 12 ? value.month : 1,
      period:value.period === 'night' ? 'night' : 'day',
      red:Math.round(bounded(value.red,0,255,37)), green:Math.round(bounded(value.green,0,255,89)),
      blue:Math.round(bounded(value.blue,0,255,179)),
      top:bounded(value.top,0,0.3,0.09), bottom:bounded(value.bottom,0.2,1.2,0.62)
    };
  }
  function resolve(value) {
    var s = normalize(value);
    if (s.mode === 'theme') return null;
    var start,end,angle=90,tint;
    if (s.mode === 'monthly') {
      var p = (s.period === 'night' ? NIGHT : DAY)[s.month-1]; angle=p[0];
      start=p[1].map(function(v){return v/255;}); end=p[2].map(function(v){return v/255;});
      tint=start.map(function(v,i){return Math.max(v,end[i]);});
    } else {
      tint=[s.red/255,s.green/255,s.blue/255];
      start=[tint[0]*s.top,tint[1]*s.top,tint[2]*s.top*1.2];
      end=tint.map(function(v){return v*s.bottom;});
    }
    var rad=angle*Math.PI/180,dir=[Math.cos(rad),Math.sin(rad)];
    var min=Math.min(0,dir[0],dir[1],dir[0]+dir[1]),max=Math.max(0,dir[0],dir[1],dir[0]+dir[1]);
    return {start:start,end:end,dir:dir,range:[min,Math.max(1e-6,max-min)],tint:tint};
  }
  var SHADER = [
    'uniform bool uColorEnabled; uniform vec3 uColorStart; uniform vec3 uColorEnd;',
    'uniform vec2 uColorDir; uniform vec2 uColorRange;',
    'vec3 presetBackground(vec2 uv) {',
    '  float t=dot(vec2(uv.x,1.0-uv.y),uColorDir);',
    '  float u=clamp((t-uColorRange.x)/max(uColorRange.y,0.000001),0.0,1.0);',
    '  return mix(uColorStart,uColorEnd,u*u*(3.0-2.0*u));',
    '}'
  ].join('\n');
  function locations(gl,program) {
    var u={}; ['uColorEnabled','uColorStart','uColorEnd','uColorDir','uColorRange'].forEach(function(n){u[n]=gl.getUniformLocation(program,n);}); return u;
  }
  function upload(gl,u,palette) {
    gl.uniform1i(u.uColorEnabled,palette ? 1 : 0);
    if (!palette) return;
    gl.uniform3fv(u.uColorStart,palette.start); gl.uniform3fv(u.uColorEnd,palette.end);
    gl.uniform2f(u.uColorDir,palette.dir[0],palette.dir[1]); gl.uniform2f(u.uColorRange,palette.range[0],palette.range[1]);
  }
  function sample(palette,x,y) {
    var t=Math.max(0,Math.min(1,(x*palette.dir[0]+y*palette.dir[1]-palette.range[0])/palette.range[1]));
    t=t*t*(3-2*t); return palette.start.map(function(v,i){return v+(palette.end[i]-v)*t;});
  }
  root.LGXMBWaveColors=Object.freeze({normalize:normalize,resolve:resolve,months:Object.freeze(MONTHS),shader:SHADER,locations:locations,upload:upload,sample:sample});
}(window));
