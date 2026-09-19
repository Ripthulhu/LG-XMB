#version 300 es
// Recovered normals and Fresnel lookup, with an explicitly adapted linear
// material/composite. Sony's encoded-HDR display chain is NOT reproduced here.
// mediump ALU, the C5's Mali runs fp16 at twice the rate; the geometry
// inputs stay highp because the clip-space normal is used raw.
precision mediump float;
uniform sampler2D uFresnel;
uniform vec3 uWave;
uniform float uBrightness;
uniform vec3 uMaterial; // Fresnel coefficient, brightness coefficient, mipmap bias
in highp vec4 tfPosition;
in highp vec4 tfNormal;
in mediump float vEdge;
layout(location=0) out vec4 outColor;
void main() {
  highp float plen=max(length(tfPosition.xyz),0.000001);
  highp float nlen=max(length(tfNormal.xyz),0.000001);
  highp vec3 eye=tfPosition.xyz/plen;
  float cosine=abs(dot(eye,tfNormal.xyz/nlen));
  // Edge-on the dot goes to zero, and on a fold that's a region, not a line,
  // so the sheet dropped out in an oval. Floor it at a slice of the normal's
  // length so the stretch-based thinning survives but never hits zero.
  float density=max(abs(dot(eye,tfNormal.xyz)),0.12*nlen)/plen*uMaterial.z;
  vec2 lut=texture(uFresnel,vec2(cosine*density,0.5)).rg;
  // The original vertex program passes attribute 8.y through TEX1.w;
  // its fragment program multiplies light by that taper before encoding it.
  float light=density*dot(lut,uMaterial.xy)*vEdge;
  // User-selected Wave Lab ceiling; port tuning, not a recovered Sony constant.
  // Keep the existing ceiling on each sheet before additive accumulation.
  float coverage=min(1.0-exp(-light*5.0),0.30);
  outColor=vec4(uWave*coverage*uBrightness,coverage);
}
