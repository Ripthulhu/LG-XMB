#version 300 es
// FXAA edge search adapted from three.js FXAAShader.js caddbf4cd84b62d7edf6b9fc937ca709afdfe915.
// Copyright 2010-2025 three.js authors. MIT: licenses/THREE-FXAA-MIT.txt.
// Native ES 3.00 and integration: lg-xmb contributors.
precision highp float;
uniform sampler2D uScene;
uniform vec2 uTexel;
uniform float uSoftness;
uniform bool uFilter;
uniform bool uCoverage;
uniform vec3 uTuning;
uniform vec3 uBackground;
uniform vec3 uWave;
uniform bool uColorEnabled;
uniform vec3 uColorStart;
uniform vec3 uColorEnd;
uniform vec2 uColorDir;
uniform vec2 uColorRange;
uniform sampler2D uMonthly;
uniform bool uMonthlyEnabled;
uniform float uSceneScale;
in vec2 vUV;
layout(location=0) out vec4 outColor;
// Cubic B-spline upsample of the 64x32 monthly pass through four bilinear
// taps. The console does this with a lookup-table bicubic in bg_copy.fpo;
// that table isn't recovered, so this is a stand-in kernel, not a copy.
vec3 monthlyAt(vec2 uv) {
  vec2 size=vec2(64.0,32.0), inv=1.0/size;
  vec2 c=uv*size-0.5, f=fract(c); c-=f;
  vec2 f2=f*f, f3=f2*f;
  vec2 w0=(1.0-3.0*f+3.0*f2-f3)/6.0, w1=(4.0-6.0*f2+3.0*f3)/6.0;
  vec2 w2=(1.0+3.0*f+3.0*f2-3.0*f3)/6.0, w3=f3/6.0;
  vec2 g0=w0+w1, g1=w2+w3;
  vec2 t0=(c-1.0+w1/g0+0.5)*inv, t1=(c+1.0+w3/g1+0.5)*inv;
  return g0.y*(g0.x*texture(uMonthly,vec2(t0.x,t0.y)).rgb+g1.x*texture(uMonthly,vec2(t1.x,t0.y)).rgb)
        +g1.y*(g0.x*texture(uMonthly,vec2(t0.x,t1.y)).rgb+g1.x*texture(uMonthly,vec2(t1.x,t1.y)).rgb);
}
float signalAt(vec2 uv) {
  vec4 c=texture(uScene,uv);
  return uCoverage ? c.a : dot(c.rgb,vec3(0.3,0.59,0.11));
}
float stepSize(int i) {
  if(i==0) return 1.5;
  if(i==4) return 4.0;
  return 2.0;
}
vec2 fxaaUV() {
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
  float pixelStep=isHorizontal?uTexel.y:uTexel.x;
  float opposite=positive, gradient=gp;
  if(gn>gp) {pixelStep=-pixelStep;opposite=negative;gradient=gn;}
  vec2 normalStep=isHorizontal?vec2(0.0,pixelStep):vec2(pixelStep,0.0);
  vec2 along=isHorizontal?vec2(uTexel.x,0.0):vec2(0.0,uTexel.y);
  vec2 edgeUV=vUV+normalStep*0.5;
  float edgeValue=(m+opposite)*0.5, threshold=gradient*0.25;
  vec2 puv=edgeUV+along, nuv=edgeUV-along;
  float pd=signalAt(puv)-edgeValue, nd=signalAt(nuv)-edgeValue;
  bool pEnd=abs(pd)>=threshold, nEnd=abs(nd)>=threshold;
  for(int i=0;i<5;i++) {
    float step=stepSize(i);
    if(!pEnd) {puv+=along*step;pd=signalAt(puv)-edgeValue;pEnd=abs(pd)>=threshold;}
    if(!nEnd) {nuv-=along*step;nd=signalAt(nuv)-edgeValue;nEnd=abs(nd)>=threshold;}
    if(pEnd&&nEnd) break;
  }
  if(!pEnd) puv+=along*8.0;
  if(!nEnd) nuv-=along*8.0;
  float pDistance=isHorizontal?puv.x-vUV.x:puv.y-vUV.y;
  float nDistance=isHorizontal?vUV.x-nuv.x:vUV.y-nuv.y;
  float nearest=min(pDistance,nDistance);
  bool endSign=(pDistance<=nDistance?pd:nd)>=0.0;
  float edgeBlend=0.0;
  if(endSign!=(m-edgeValue>=0.0)) edgeBlend=0.5-nearest/max(pDistance+nDistance,0.000001);
  float sub=abs((2.0*(n+s+e+w)+ne+nw+se+sw)/12.0-m)/max(contrast,0.000001);
  sub=smoothstep(0.0,1.0,clamp(sub,0.0,1.0));
  float blend=max(edgeBlend,sub*sub*uTuning.z);
  return vUV+normalStep*blend;
}
void main() {
  vec2 uv=uFilter?fxaaUV():vUV;
  vec4 center=texture(uScene,uv);
  vec3 scene=center.rgb;
  if(uSoftness>0.0) {
    vec2 stepUV=uTexel*uSoftness;
    vec3 neighbors=texture(uScene,uv+vec2(stepUV.x,0)).rgb+
      texture(uScene,uv-vec2(stepUV.x,0)).rgb+texture(uScene,uv+vec2(0,stepUV.y)).rgb+
      texture(uScene,uv-vec2(0,stepUV.y)).rgb;
    scene=mix(scene,neighbors*0.25,clamp(uSoftness/3.0,0.0,0.65));
  }
  float vertical=smoothstep(0.0,1.0,1.0-vUV.y);
  vec3 background=mix(uBackground*0.78,uBackground*1.05,vertical);
  if(uMonthlyEnabled) {
    background=monthlyAt(vUV);
  } else if(uColorEnabled) {
    float t=clamp((dot(vec2(vUV.x,1.0-vUV.y),uColorDir)-uColorRange.x)/max(uColorRange.y,0.000001),0.0,1.0);
    background=mix(uColorStart,uColorEnd,t*t*(3.0-2.0*t));
  }
  // RGB goes to the scene target (scaled into range when it's RGBA8); alpha
  // carries the backdrop's peak for the presentation shoulder's knee.
  outColor=vec4((background+scene)*uSceneScale,max(background.r,max(background.g,background.b)));
}
