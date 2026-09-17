#version 300 es
// Recovered normals and Fresnel lookup, with an explicitly adapted linear
// material/composite. Sony's encoded-HDR display chain is NOT reproduced here.
precision highp float;
uniform sampler2D uFresnel;
uniform vec3 uWave;
uniform float uBrightness;
uniform vec3 uMaterial; // Fresnel coefficient, brightness coefficient, mipmap bias
in vec4 tfPosition;
in vec4 tfNormal;
in vec2 vUV;
layout(location=0) out vec4 outColor;
void main() {
  float plen=max(length(tfPosition.xyz),0.000001);
  float nlen=max(length(tfNormal.xyz),0.000001);
  vec3 eye=tfPosition.xyz/plen;
  float cosine=abs(dot(eye,tfNormal.xyz/nlen));
  // Edge-on the dot goes to zero, and on a fold that's a region, not a line,
  // so the sheet dropped out in an oval. Floor it at a slice of the normal's
  // length so the stretch-based thinning survives but never hits zero.
  float density=max(abs(dot(eye,tfNormal.xyz)),0.12*nlen)/plen*uMaterial.z;
  vec2 lut=texture(uFresnel,vec2(cosine*density,0.5)).rg;
  // Deliberate port edge envelope; original v8 coordinate stream still needs capture.
  float edge=smoothstep(0.0,0.055,vUV.y)*smoothstep(0.0,0.055,1.0-vUV.y);
  float light=density*dot(lut,uMaterial.xy);
  float coverage=(1.0-exp(-light*5.0))*edge;
  outColor=vec4(uWave*coverage*uBrightness,coverage);
}
