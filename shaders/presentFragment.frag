#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform float uSceneScale;
in vec2 vUV;
layout(location=0) out vec4 outColor;
// Hue-preserving roll-off above a knee set by the backdrop's brightness, which
// the composite left in the scene's alpha. Anything at or below the knee passes
// through untouched, so a bright monthly backdrop isn't dimmed; only the wave
// and particle light stacked above it gets compressed instead of clipped.
void main() {
  vec4 s=texture(uScene,vUV);
  vec3 c=max(s.rgb/uSceneScale,vec3(0.0));
  float knee=min(0.9999,max(0.75,s.a));
  float peak=max(c.r,max(c.g,c.b));
  if(peak>knee) {
    float room=1.0-knee;
    c*=(knee+room*(1.0-exp(-(peak-knee)/room)))/max(peak,0.000001);
  }
  // Fixed-pattern zero-mean dither against 8-bit banding. No clock in it, so a
  // frozen or reduced-motion frame stays byte-stable.
  float d=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))))-0.5;
  outColor=vec4(clamp(c+d/255.0,0.0,1.0),1.0);
}
