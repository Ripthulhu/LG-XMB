#version 300 es
// Algebraic port of particles_quads.fpo from the supplied PS3 3.00/3.01 archive.
// Algebraic reconstruction; uniform bindings documented separately.
// Inputs below are the original vertex shader's interpolated TEX outputs.
precision highp float;
uniform sampler2D uIridescent;
uniform vec4 uLightPack[4];
uniform vec4 uColor;
uniform float uIridescentExponent;
uniform float uGamma;
in mediump float vBackdropTransmission;
uniform vec4 uNearControl;
in vec2 vUV;             // TEX0.xy
in vec2 vFocus;          // TEX2.xy
in float vFade;          // TEX3.w
in vec3 vNormal;         // TEX4.xyz
in vec3 vPosition;       // TEX5.xyz
in vec3 vViewNormal;     // TEX7.xyz
layout(location=0) out vec4 outColor;
const float LOG2E = 1.4426950216293335;
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
    vec3 lighting = (iridescence * (uLightPack[1].w * specular) + uLightPack[0].w * abs(dot(vNormal, B))) / attenuation;
    vec3 tone = vec3(1.0) - exp2(-lighting * uLightPack[2].w * LOG2E);
    float focus = clamp(vFocus.x + vFocus.y, 0.0, 1.0);
    float width = 0.6344999670982361 * focus + 0.05000000074505806;
    float radius = length(2.0 * (vUV - 0.5));
    float t = clamp((radius - (0.5 - width)) / (2.0 * width), 0.0, 1.0);
    float body = 1.0 - t * t * (3.0 - 2.0 * t);
    float exponent = 0.8500000238418579 + vFocus.x * (uNearControl.y - 0.8500000238418579);
    float softBody = 1.0 - exp2(-body * exponent * LOG2E);
    float coverage = mix(body, softBody, focus) * vFade;
    // Faithful to final register writes: alpha includes RED lighting.
    // Do not silently replace this with coverage or assume conventional blending.
    outColor = vec4(tone * coverage * uColor.rgb * uGamma, tone.r * coverage);
    if (!(outColor.a > 0.0)) discard; // Original GREATER 0 alpha test
    // The white halo was already added by the compositor. Preserve only the
    // old overlay's attenuation of additive light, without tinting each sprite.
    outColor.rgb *= vBackdropTransmission;
}
