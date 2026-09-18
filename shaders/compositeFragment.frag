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
// A lowp sampler can discard the extra precision of the 10-bit cache.
uniform highp sampler2D uBackdrop;
uniform highp vec2 uTexel;
uniform float uSoftness;
uniform bool uFilter;
uniform bool uCoverage;
uniform vec3 uTuning;
uniform highp vec3 uBackground;
uniform vec3 uWave;
uniform bool uColorEnabled;
uniform bool uBackdropEnabled;
// The decorative overlay must be applied before the final display dither.
uniform bool uAmbientEnabled;
uniform highp vec3 uColorStart;
uniform highp vec3 uColorEnd;
uniform highp vec2 uColorDir;
uniform highp vec2 uColorRange;
// Rows the wave can reach this frame, in UV, with the filter radius added.
uniform highp vec2 uBand;
in highp vec2 vUV;
layout(location=0) out highp vec4 outColor;
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
// Match the legacy CSS overlay in unquantized colour: farthest-corner
// ellipse at 57% 21%, a 5% white halo to 52%, and the 8%/0%/22% vignette.
// Return (transmission, white contribution), in the canvas's Y-up UV space.
highp vec2 ambientTerms(highp vec2 uv) {
  highp float y=1.0-uv.y;
  highp vec2 p=(vec2(uv.x,y)-vec2(0.57,0.21))/vec2(0.57,0.79);
  highp float halo=0.05*max(0.0,1.0-length(p)/0.735391052434);
  highp float shade=max(0.08*(1.0-y/0.55),0.22*(y-0.55)/0.45);
  return vec2((1.0-shade)*(1.0-halo),halo);
}
// Fade noise within one display code of either endpoint. Exact black/white
// must stay exact; clipping symmetric noise there would bias the colour.
highp vec3 displayColour(highp vec3 rgb, highp float noise) {
  rgb=clamp(rgb,0.0,1.0);
  if(uAmbientEnabled) {
    highp vec2 ambient=ambientTerms(vUV);
    rgb=rgb*ambient.x+ambient.y;
  }
  highp vec3 amount=min(vec3(1.0),255.0*min(rgb,vec3(1.0)-rgb));
  return clamp(rgb+noise*amount,0.0,1.0);
}
void main() {
  highp float vertical=smoothstep(0.0,1.0,1.0-vUV.y);
  highp vec3 background=mix(uBackground*0.78,uBackground*1.05,vertical);
  if(uBackdropEnabled) {
    background=texture(uBackdrop,vUV).rgb;
  } else if(uColorEnabled) {
    highp float t=clamp((dot(vec2(vUV.x,1.0-vUV.y),uColorDir)-uColorRange.x)/max(uColorRange.y,0.000001),0.0,1.0);
    background=mix(uColorStart,uColorEnd,t*t*(3.0-2.0*t));
  }
  // Screen-fixed triangular dither, at most one 8-bit code either way.
  // The two thresholds are decorrelated spatially, not animated over time.
  // Keep this arithmetic and final colour highp; leave the FXAA search mediump.
  highp float n0=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));
  highp float n1=fract(52.9829189*fract(dot(gl_FragCoord.yx+vec2(19.0,47.0),vec2(0.06711056,0.00583715))));
  highp float d=(n0+n1-1.0)/255.0;
  // Outside the rows the sheet can reach there's nothing to filter, soften
  // or roll off, so the backdrop goes straight out. That's over half the
  // screen at this camera.
  if(vUV.y<uBand.x||vUV.y>uBand.y) {
    outColor=vec4(displayColour(background,d),1.0);
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
  highp vec3 c=background+scene;
  highp float knee=min(0.9999,max(0.75,max(background.r,max(background.g,background.b))));
  highp float peak=max(c.r,max(c.g,c.b));
  if(peak>knee) {
    highp float room=1.0-knee;
    c*=(knee+room*(1.0-exp(-(peak-knee)/room)))/max(peak,0.000001);
  }
  outColor=vec4(displayColour(c,d),1.0);
}
