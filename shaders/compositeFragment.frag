#version 300 es
// FXAA edge search adapted from three.js FXAAShader.js caddbf4cd84b62d7edf6b9fc937ca709afdfe915.
// Copyright 2010-2025 three.js authors. MIT: licenses/THREE-FXAA-MIT.txt.
// Native ES 3.00 and integration: lg-xmb contributors.
// The C5 measured 11 ms for the full-precision version. Keep colour, tone
// mapping, output and FXAA mediump. Only addressing and the dither hash need highp.
precision mediump float;
precision mediump sampler2D;
uniform sampler2D uScene;
uniform sampler2D uBackdrop;
uniform sampler2D uAmbient;
uniform bool uAmbientEnabled;
uniform float uBackdropScale;
uniform highp vec2 uTexel;
uniform float uSoftness;
uniform bool uFilter;
uniform bool uCoverage;
uniform vec3 uTuning;
uniform highp vec2 uBand;
in highp vec2 vUV;
layout(location=0) out mediump vec4 outColor;
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
// Single screen-fixed hash. Do not let highp propagate into colour arithmetic.
float displayNoise() {
  highp float n=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));
  return (n-0.5)*(2.0/255.0);
}
vec3 displayColour(vec3 rgb, float noise) {
  rgb=clamp(rgb,0.0,1.0);
  vec3 amount=min(vec3(1.0),255.0*min(rgb,vec3(1.0)-rgb));
  return clamp(rgb+noise*amount,0.0,1.0);
}
void main() {
  vec3 background=texture(uBackdrop,vUV).rgb;
  float noise=displayNoise();
  bool extended=uBackdropScale>1.0;
  vec2 ambient=vec2(1.0,0.0);
  // Only over-range RGB controls need the undecorated cache representation.
  // Ordinary palettes keep the one-read, already-decorated background path.
  if(extended) {
    background*=uBackdropScale;
    ambient=texture(uAmbient,vUV).rg;
  }
  if(vUV.y<uBand.x||vUV.y>uBand.y) {
    vec3 displayBackground=extended?clamp(background,0.0,1.0)*ambient.x+vec3(ambient.y):background;
    outColor=vec4(displayColour(displayBackground,noise),1.0);
    return;
  }
  highp vec2 uv=uFilter?fxaaUV():vUV;
  vec4 center=texture(uScene,uv);
  vec3 scene=center.rgb;
  if(uSoftness>0.0&&center.a>0.0) {
    highp vec2 stepUV=uTexel*uSoftness;
    vec3 neighbors=texture(uScene,uv+vec2(stepUV.x,0)).rgb+
      texture(uScene,uv-vec2(stepUV.x,0)).rgb+texture(uScene,uv+vec2(0,stepUV.y)).rgb+
      texture(uScene,uv-vec2(0,stepUV.y)).rgb;
    scene=mix(scene,neighbors*0.25,clamp(uSoftness/3.0,0.0,0.65));
  }
  if(!extended&&all(equal(scene,vec3(0.0)))) {
    outColor=vec4(displayColour(background,noise),1.0);
    return;
  }
  // Only wave-covered fragments need the cached transmission/halo. Recovering
  // the undecorated base preserves the old tone-mapping order; darkening the
  // background alone would make the wave and particles noticeably brighter.
  if(!extended&&uAmbientEnabled) ambient=texture(uAmbient,vUV).rg;
  vec3 base=extended?background:(background-vec3(ambient.y))/ambient.x;
  vec3 c=base+scene;
  // 0.9999 rounds to 1 in fp16; this representable knee keeps room nonzero.
  float knee=min(0.9990234375,max(0.75,max(base.r,max(base.g,base.b))));
  float peak=max(c.r,max(c.g,c.b));
  if(peak>knee) {
    float room=1.0-knee;
    c*=(knee+room*(1.0-exp(-(peak-knee)/room)))/max(peak,0.000001);
  }
  c=clamp(c,0.0,1.0)*ambient.x+vec3(ambient.y);
  outColor=vec4(displayColour(c,noise),1.0);
}
