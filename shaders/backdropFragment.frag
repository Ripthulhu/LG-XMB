#version 300 es
precision highp float;
uniform sampler2D uMonthly;
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
  outColor=vec4(rgb,1.0);
}
