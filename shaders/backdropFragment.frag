#version 300 es
precision highp float;
uniform highp sampler2D uMonthly;
uniform float uCacheLevels;
in vec2 vUV;
layout(location=0) out vec4 outColor;
// Cubic B-spline upsample of the 64x32 monthly pass through four bilinear
// taps. The console does this with a lookup-table bicubic in bg_copy.fpo;
// that table isn't recovered, so this is a stand-in kernel, not a copy.
// Runs once per clock change into a cached texture, not per frame.
void main() {
  vec2 size=vec2(64.0,32.0), inv=1.0/size;
  vec2 c=vUV*size-0.5, f=fract(c); c-=f;
  vec2 f2=f*f, f3=f2*f;
  vec2 w0=(1.0-3.0*f+3.0*f2-f3)/6.0, w1=(4.0-6.0*f2+3.0*f3)/6.0;
  vec2 w2=(1.0+3.0*f+3.0*f2-3.0*f3)/6.0, w3=f3/6.0;
  vec2 g0=w0+w1, g1=w2+w3;
  vec2 t0=(c-1.0+w1/g0+0.5)*inv, t1=(c+1.0+w3/g1+0.5)*inv;
  vec3 rgb=g0.y*(g0.x*texture(uMonthly,vec2(t0.x,t0.y)).rgb+g1.x*texture(uMonthly,vec2(t1.x,t0.y)).rgb)
          +g1.y*(g0.x*texture(uMonthly,vec2(t0.x,t1.y)).rgb+g1.x*texture(uMonthly,vec2(t1.x,t1.y)).rgb);
  // Keep rounding errors fine-grained in either the 10-bit cache or its
  // RGBA8 fallback. This runs only when the background cache refreshes.
  // Display dithering happens separately, after the final colour arithmetic.
  float d=fract(dot(gl_FragCoord.xy,vec2(0.7548776662,0.5698402909)))-0.5;
  // Choose the integer code explicitly. The quarter-code offset keeps its
  // float representation inside that code's bin with either truncating or
  // nearest UNORM conversion; it is not added to the stored colour.
  vec3 code=floor(clamp(rgb,0.0,1.0)*uCacheLevels+d+0.5);
  outColor=vec4(clamp((code+0.25)/uCacheLevels,0.0,1.0),1.0);
}
