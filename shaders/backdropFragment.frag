#version 300 es
precision highp float;
precision highp sampler2D;
uniform highp sampler2D uMonthly;
uniform bool uMonthlyEnabled;
uniform bool uColorEnabled;
uniform vec3 uBackground;
uniform vec3 uColorStart;
uniform vec3 uColorEnd;
uniform vec2 uColorDir;
uniform vec2 uColorRange;
uniform float uCacheLevels;
uniform float uBackdropScale;
in vec2 vUV;
layout(location=0) out highp vec4 outColor;
// All spatial background work runs on cache invalidation, never per frame.
vec2 ambientTerms(vec2 uv) {
  float y=1.0-uv.y;
  vec2 p=(vec2(uv.x,y)-vec2(0.57,0.21))/vec2(0.57,0.79);
  float halo=0.05*max(0.0,1.0-length(p)/0.735391052434);
  float shade=max(0.08*(1.0-y/0.55),0.22*(y-0.55)/0.45);
  return vec2((1.0-shade)*(1.0-halo),halo);
}
// Four bilinear reads implement the existing cubic B-spline upsample.
vec3 monthlyColour() {
  vec2 size=vec2(64.0,32.0), inv=1.0/size;
  vec2 c=vUV*size-0.5, f=fract(c); c-=f;
  vec2 f2=f*f, f3=f2*f;
  vec2 w0=(1.0-3.0*f+3.0*f2-f3)/6.0, w1=(4.0-6.0*f2+3.0*f3)/6.0;
  vec2 w2=(1.0+3.0*f+3.0*f2-3.0*f3)/6.0, w3=f3/6.0;
  vec2 g0=w0+w1, g1=w2+w3;
  vec2 t0=(c-1.0+w1/g0+0.5)*inv, t1=(c+1.0+w3/g1+0.5)*inv;
  return g0.y*(g0.x*texture(uMonthly,vec2(t0.x,t0.y)).rgb+g1.x*texture(uMonthly,vec2(t1.x,t0.y)).rgb)
        +g1.y*(g0.x*texture(uMonthly,vec2(t0.x,t1.y)).rgb+g1.x*texture(uMonthly,vec2(t1.x,t1.y)).rgb);
}
void main() {
  vec3 rgb;
  if(uMonthlyEnabled) rgb=monthlyColour();
  else {
    float vertical=smoothstep(0.0,1.0,1.0-vUV.y);
    rgb=mix(uBackground*0.78,uBackground*1.05,vertical);
    if(uColorEnabled) {
      float t=clamp((dot(vec2(vUV.x,1.0-vUV.y),uColorDir)-uColorRange.x)/max(uColorRange.y,0.000001),0.0,1.0);
      rgb=mix(uColorStart,uColorEnd,t*t*(3.0-2.0*t));
    }
    // RGB controls can exceed display white. Preserve those values for the
    // wave's existing highlight roll-off rather than clipping a cache early.
    if(uBackdropScale>1.0) rgb/=uBackdropScale;
    else {
      vec2 ambient=ambientTerms(vUV);
      rgb=clamp(rgb,0.0,1.0)*ambient.x+vec3(ambient.y);
    }
  }
  // Quantize once at cache precision. Final display has its own single hash.
  float d=fract(dot(gl_FragCoord.xy,vec2(0.7548776662,0.5698402909)))-0.5;
  // Keep the selected UNORM code valid on nearest and truncating stores.
  vec3 code=floor(clamp(rgb,0.0,1.0)*uCacheLevels+d+0.5);
  outColor=vec4(clamp((code+0.25)/uCacheLevels,0.0,1.0),1.0);
}
