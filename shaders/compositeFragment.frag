#version 300 es
// FXAA edge search adapted from three.js FXAAShader.js caddbf4cd84b62d7edf6b9fc937ca709afdfe915.
// Copyright 2010-2025 three.js authors. MIT: licenses/THREE-FXAA-MIT.txt.
// Native ES 3.00 and integration: lg-xmb contributors.
//
// Precision: mediump by default. The C5's Mali-G52 runs fp16 ALU at twice
// the rate and this pass was 11 ms a frame at Strong. Anything that is a
// texture coordinate or a pixel step stays highp, fp16 can't address 1080p.
precision mediump float;
uniform sampler2D uScene;
uniform sampler2D uBackdrop;
uniform highp vec2 uTexel;
uniform float uSoftness;
uniform bool uFilter;
uniform bool uCoverage;
uniform vec3 uTuning;
uniform vec3 uBackground;
uniform vec3 uWave;
uniform bool uColorEnabled;
uniform bool uBackdropEnabled;
uniform vec3 uColorStart;
uniform vec3 uColorEnd;
uniform vec2 uColorDir;
uniform vec2 uColorRange;
// Rows the wave can reach this frame, in UV, with the filter radius added.
uniform highp vec2 uBand;
in highp vec2 vUV;
layout(location=0) out vec4 outColor;
float signalAt(highp vec2 uv) {
  vec4 c=texture(uScene,uv);
  return uCoverage ? c.a : dot(c.rgb,vec3(0.3,0.59,0.11));
}
float stepSize(int i) {
  if(i==0) return 1.5;
  if(i==4) return 4.0;
  return 2.0;
}
highp vec2 fxaaUV() {
  float m=signalAt(vUV);
  float n=signalAt(vUV+vec2(0.0,uTexel.y));
  float s=signalAt(vUV-vec2(0.0,uTexel.y));
  float e=signalAt(vUV+vec2(uTexel.x,0.0));
  float w=signalAt(vUV-vec2(uTexel.x,0.0));
  float hi=max(m,max(max(n,s),max(e,w)));
  float lo=min(m,min(min(n,s),min(e,w)));
  float contrast=hi-lo;
  if(contrast<max(uTuning.x,uTuning.y*hi)) {
    return vUV;
  }
  float ne=signalAt(vUV+uTexel);
  float nw=signalAt(vUV+vec2(-uTexel.x,uTexel.y));
  float se=signalAt(vUV+vec2(uTexel.x,-uTexel.y));
  float sw=signalAt(vUV-uTexel);
  float horizontal=2.0*abs(n+s-2.0*m)+abs(ne+se-2.0*e)+abs(nw+sw-2.0*w);
  float vertical=2.0*abs(e+w-2.0*m)+abs(ne+nw-2.0*n)+abs(se+sw-2.0*s);
  bool isHorizontal=horizontal>=vertical;
  float positive=isHorizontal?n:e, negative=isHorizontal?s:w;
  float gp=abs(positive-m), gn=abs(negative-m);
  highp float pixelStep=isHorizontal?uTexel.y:uTexel.x;
  float opposite=positive, gradient=gp;
  if(gn>gp) {pixelStep=-pixelStep;opposite=negative;gradient=gn;}
  highp vec2 normalStep=isHorizontal?vec2(0.0,pixelStep):vec2(pixelStep,0.0);
  highp vec2 along=isHorizontal?vec2(uTexel.x,0.0):vec2(0.0,uTexel.y);
  highp vec2 edgeUV=vUV+normalStep*0.5;
  float edgeValue=(m+opposite)*0.5, threshold=gradient*0.25;
  highp vec2 puv=edgeUV+along, nuv=edgeUV-along;
  float pd=signalAt(puv)-edgeValue, nd=signalAt(nuv)-edgeValue;
  bool pEnd=abs(pd)>=threshold, nEnd=abs(nd)>=threshold;
  for(int i=0;i<5;i++) {
    highp float step=stepSize(i);
    if(!pEnd) {puv+=along*step;pd=signalAt(puv)-edgeValue;pEnd=abs(pd)>=threshold;}
    if(!nEnd) {nuv-=along*step;nd=signalAt(nuv)-edgeValue;nEnd=abs(nd)>=threshold;}
    if(pEnd&&nEnd) break;
  }
  if(!pEnd) puv+=along*8.0;
  if(!nEnd) nuv-=along*8.0;
  highp float pDistance=isHorizontal?puv.x-vUV.x:puv.y-vUV.y;
  highp float nDistance=isHorizontal?vUV.x-nuv.x:vUV.y-nuv.y;
  highp float nearest=min(pDistance,nDistance);
  bool endSign=(pDistance<=nDistance?pd:nd)>=0.0;
  float edgeBlend=0.0;
  if(endSign!=(m-edgeValue>=0.0)) edgeBlend=0.5-nearest/max(pDistance+nDistance,0.000001);
  float sub=abs((2.0*(n+s+e+w)+ne+nw+se+sw)/12.0-m)/max(contrast,0.000001);
  sub=smoothstep(0.0,1.0,clamp(sub,0.0,1.0));
  float blend=max(edgeBlend,sub*sub*uTuning.z);
  return vUV+normalStep*blend;
}
void main() {
  float vertical=smoothstep(0.0,1.0,1.0-vUV.y);
  vec3 background=mix(uBackground*0.78,uBackground*1.05,vertical);
  if(uBackdropEnabled) {
    background=texture(uBackdrop,vUV).rgb;
  } else if(uColorEnabled) {
    float t=clamp((dot(vec2(vUV.x,1.0-vUV.y),uColorDir)-uColorRange.x)/max(uColorRange.y,0.000001),0.0,1.0);
    background=mix(uColorStart,uColorEnd,t*t*(3.0-2.0*t));
  }
  // Fixed-pattern zero-mean dither against banding (R2 sequence); no clock,
  // so frozen frames stay stable. highp: fp16 can't hold a pixel coordinate.
  highp float d=fract(dot(gl_FragCoord.xy,vec2(0.7548776662,0.5698402909)))-0.5;
  // Outside the rows the sheet can reach there's nothing to filter, soften
  // or roll off, so the backdrop goes straight out. That's over half the
  // screen at this camera.
  if(vUV.y<uBand.x||vUV.y>uBand.y) {
    outColor=vec4(clamp(background+d/255.0,0.0,1.0),1.0);
    return;
  }
  highp vec2 uv=uFilter?fxaaUV():vUV;
  vec4 center=texture(uScene,uv);
  vec3 scene=center.rgb;
  // Softness taps only where there is wave to soften.
  if(uSoftness>0.0&&center.a>0.0) {
    highp vec2 stepUV=uTexel*uSoftness;
    vec3 neighbors=texture(uScene,uv+vec2(stepUV.x,0)).rgb+
      texture(uScene,uv-vec2(stepUV.x,0)).rgb+texture(uScene,uv+vec2(0,stepUV.y)).rgb+
      texture(uScene,uv-vec2(0,stepUV.y)).rgb;
    scene=mix(scene,neighbors*0.25,clamp(uSoftness/3.0,0.0,0.65));
  }
  // Hue-preserving roll-off above a knee at the backdrop's own peak, so the
  // backdrop passes through untouched and only the wave light stacked on it
  // compresses instead of clipping to white. Done here in RGBA8 on purpose:
  // half-float targets took the C5's Mali from 55% to 94% busy on their own.
  // Particles add on top afterwards and may still clip; they're small.
  vec3 c=background+scene;
  float knee=min(0.9999,max(0.75,max(background.r,max(background.g,background.b))));
  float peak=max(c.r,max(c.g,c.b));
  if(peak>knee) {
    float room=1.0-knee;
    c*=(knee+room*(1.0-exp(-(peak-knee)/room)))/max(peak,0.000001);
  }
  outColor=vec4(clamp(c+d/255.0,0.0,1.0),1.0);
}
