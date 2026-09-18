#version 300 es
// Algebraic port of particles_second.fpo; requires its matching vertex outputs.
// Algebraic reconstruction; uniform bindings documented separately.
precision highp float;
uniform sampler2D uIridescent;
uniform vec4 uLightPack[4];
uniform vec4 uColor;
uniform float uIridescentExponent;
uniform float uGamma;
uniform bool uAmbientEnabled;
uniform highp vec2 uAmbientInvSize;
uniform vec4 uGlare;
in vec2 vUV;
in float vFade;
in vec3 vNormal;
in vec3 vPosition;
in vec3 vViewNormal;
layout(location=0) out vec4 outColor;
const float LOG2E = 1.4426950216293335;
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
void main() {
    vec3 A = normalize(vec3(uLightPack[0].x, uLightPack[1].x, uLightPack[2].x) - vPosition);
    vec3 B = vec3(uLightPack[0].y, uLightPack[1].y, uLightPack[2].y) - vPosition;
    float distanceB = length(B);
    B /= distanceB;
    vec3 halfVector = normalize(A + B);
    vec3 tex = texture(uIridescent, (vViewNormal.xy + 1.0) * 0.5).rgb;
    vec3 iridescence = pow(vec3(1.0) + uLightPack[3].w * (tex - 1.0), vec3(uIridescentExponent));
    float specular = pow(abs(dot(vNormal, halfVector)), uLightPack[3].y);
    float attenuation = uLightPack[0].z + uLightPack[1].z * distanceB + uLightPack[2].z * distanceB * distanceB;
    vec3 lighting = iridescence * (uLightPack[1].w * specular) / attenuation;
    vec3 tone = vec3(1.0) - exp2(-lighting * uLightPack[2].w * LOG2E);
    float radius = clamp(length(2.0 * (vUV - 0.5)), 0.0, 1.0);
    float glare = uGlare.x * exp2(-uGlare.w * pow(radius, uGlare.z) * LOG2E);
    // Glare.y is absent from this fragment program; the vertex program uses it.
    // Alpha intentionally does NOT include glare, Color, or Gamma.
    outColor = vec4(tone * vFade * uColor.rgb * glare * uGamma, tone.r * vFade);
    if (!(outColor.a > 0.0)) discard; // Original GREATER 0 alpha test
    // The white halo was already added by the compositor. Preserve only the
    // old overlay's attenuation of additive light, without tinting each sprite.
    if (uAmbientEnabled) outColor.rgb *= ambientTerms(gl_FragCoord.xy*uAmbientInvSize).x;
}
