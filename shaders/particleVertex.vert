#version 300 es
// Register-dataflow reconstruction of particles_quads.vpo, 3.01.
// Paired scalar/vector operations read the old register state before either write.
// log2(0) is bounded to avoid driver-dependent NaNs; not bit-exact RSX arithmetic.
precision highp float;
layout(location=0) in vec4 aParticle;
layout(location=1) in vec4 aQuaternion;
layout(location=2) in vec2 aCorner;
out vec2 vUV;
out vec2 vFocus;
out float vFade;
out vec3 vNormal;
out vec3 vPosition;
out vec3 vViewNormal;
uniform vec4 uLifeBoundsMin;
uniform vec4 uLifeBoundsMax;
uniform vec4 uFocus;
uniform vec4 uParticleSize;
uniform vec4 uLightPack[4];
uniform vec4 uFrontFacingQuaternion;
uniform vec4 uModelview[4];
uniform vec4 uFocusCurves;
uniform vec4 uNearControl;
uniform vec4 uDarkness;
uniform vec4 uModelviewProjection[4];
uniform vec4 uTransparency;
uniform bool uAmbientEnabled;
uniform mediump sampler2D uAmbient;
out mediump float vBackdropTransmission;
void main() {
  vec4 r0=vec4(0),r1=vec4(0),r2=vec4(0),r3=vec4(0),r4=vec4(0),r5=vec4(0),r6=vec4(0),r7=vec4(0),r8=vec4(0),r9=vec4(0),r10=vec4(0),r11=vec4(0),r12=vec4(0),r13=vec4(0),r14=vec4(0),r15=vec4(0);
  vec4 o0=vec4(0,0,0,1),o7=vec4(0,0,0,1),o9=vec4(0,0,0,1),o10=vec4(0,0,0,1),o11=vec4(0,0,0,1),o12=vec4(0,0,0,1),o14=vec4(0,0,0,1);
  vec4 cc0=vec4(0),cc1=vec4(0);
  { // 0x0000 MOV
    vec4 vv=(vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx;
    o10.xyz=vv.xyz;
  }
  { // 0x0010 MOV
    vec4 vv=(aParticle).xyzx;
    r1.xyz=vv.xyz;
  }
  { // 0x0020 ADD
    vec4 vv=(-((uLifeBoundsMin).xyzx)+(aParticle).xyzx);
    r0.xyz=vv.xyz;
  }
  { // 0x0030 ADD
    vec4 vv=((uLifeBoundsMax).xyzx+-((aParticle).xyzx));
    r2.xyz=vv.xyz;
  }
  { // 0x0040 MOV
    vec4 vv=(vec4(aCorner,0.0,0.0)).xyxx;
    o7.xy=vv.xy;
  }
  { // 0x0050 MOV
    vec4 vv=(vec4(2.0,0.4000000059604645,0.20000000298023224,0.0)).wwww;
    o7.zw=vv.zw;
  }
  { // 0x0060 ADD
    vec4 vv=(-((vec4(0.5,0.6000000238418579,5.0,3.0)).xxxx)+(vec4(aCorner,0.0,0.0)).xyxx);
    r7.xy=vv.xy;
  }
  { // 0x0070 ADD
    vec4 vv=(-((uFocus).zyzz)+(uFocus).wxww);
    r6.xy=vv.xy;
  }
  { // 0x0080 MOV
    vec4 vv=(vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx;
    r1.w=vv.w;
  }
  { // 0x0090 MOV
    vec4 vv=(vec4(2.0,0.4000000059604645,0.20000000298023224,0.0)).wwww;
    r6.w=vv.w;
  }
  { // 0x00a0 MOV
    vec4 vv=(vec4(2.0,0.4000000059604645,0.20000000298023224,0.0)).wwww;
    r5.w=vv.w;
  }
  { // 0x00b0 ADD
    vec4 vv=(-((uParticleSize).xxxx)+(uParticleSize).yyyy);
    r6.z=vv.z;
  }
  { // 0x00c0 MOV
    vec4 vv=(vec4(2.0,0.4000000059604645,0.20000000298023224,0.0)).xxxx;
    r0.w=vv.w;
  }
  { // 0x00d0 DP4
    vec4 vv=vec4(dot((aQuaternion).xyzw,(aQuaternion).xyzw));
    r2.w=vv.w;
  }
  { // 0x00e0 MOV
    vec4 vv=(uFocus).zzzz;
    r3.w=vv.w;
  }
  { // 0x00f0 MOV
    vec4 vv=(uLightPack[0]).xxxx;
    r3.x=vv.x;
  }
  { // 0x0100 MOV
    vec4 vv=(uLightPack[1]).xxxx;
    r3.y=vv.y;
  }
  { // 0x0110 MOV
    vec4 vv=(uLightPack[2]).xxxx;
    r3.z=vv.z;
  }
  { // 0x0120 ADD
    vec4 vv=((aParticle).xyzx+-((r3).xyzx));
    r4.xyz=vv.xyz;
  }
  { // 0x0130 ADD
    vec4 vv=(-((vec4(2.0,0.4000000059604645,0.20000000298023224,0.0)).zzzy)+(r3).wwww);
    r7.zw=vv.zw;
  }
  { // 0x0140 ADD
    vec4 vv=(-((vec4(0.5,0.6000000238418579,5.0,3.0)).yyyy)+(r3).wwww);
    r8.z=vv.z;
  }
  { // 0x0150 MIN
    vec4 vv=min((r0).xyzx,(r2).xyzx);
    r0.xyz=vv.xyz;
  }
  { // 0x0160 ADD
    vec4 vv=((uFocus).zzzz+-((r7).zzzz));
    r9.x=vv.x;
  }
  { // 0x0170 MIN + RSQ
    vec4 vv=min((r0).xxxx,(r0).yyyy);
    vec4 sv=vec4(inversesqrt(abs(((r2).wwww).x)));
    r0.x=vv.x;
    r2.x=sv.x;
  }
  { // 0x0180 DP3
    vec4 vv=vec4(dot(((r4).xyzx).xyz,((r4).xyzx).xyz));
    r8.x=vv.x;
  }
  { // 0x0190 ADD
    vec4 vv=((r7).zzzz+-((r7).wwww));
    r8.w=vv.w;
  }
  { // 0x01a0 ADD
    vec4 vv=((r7).wwww+-((r8).zzzz));
    r9.y=vv.y;
  }
  { // 0x01b0 MIN
    vec4 vv=min((r0).xxxx,(r0).zzzz);
    r0.x=vv.x;
  }
  { // 0x01c0 MUL
    vec4 vv=((r2).xxxx*(aQuaternion).xyzw);
    r2.xyzw=vv.xyzw;
  }
  { // 0x01d0 MUL
    vec4 vv=clamp(((r0).xxxx*(vec4(0.5,0.6000000238418579,5.0,3.0)).zzzz),0.0,1.0);
    r0.x=vv.x;
  }
  { // 0x01e0 MUL
    vec4 vv=((r2).xyzx*(vec4(2.0,0.4000000059604645,0.20000000298023224,0.0)).xxxx);
    r5.xyz=vv.xyz;
  }
  { // 0x01f0 ADD
    vec4 vv=((uFrontFacingQuaternion).xyzw+-((r2).xyzw));
    r3.xyzw=vv.xyzw;
  }
  { // 0x0200 MAD
    vec4 vv=(-((r0).xxxx)*(r0).wwww+(vec4(0.5,0.6000000238418579,5.0,3.0)).wwww);
    r9.w=vv.w;
  }
  { // 0x0210 MUL
    vec4 vv=((r0).xxxx*(r0).xxxx);
    r4.w=vv.w;
  }
  { // 0x0220 MUL + RSQ
    vec4 vv=((r2).wyzw*(r5).xzxy);
    vec4 sv=vec4(inversesqrt(abs(((r8).xxxx).x)));
    r0.xyzw=vv.xyzw;
    r9.z=sv.z;
  }
  { // 0x0230 MUL
    vec4 vv=((r2).xyxx*(r5).xyxx);
    r8.xy=vv.xy;
  }
  { // 0x0240 ADD
    vec4 vv=((r0).zzzz+(r0).wwww);
    r5.x=vv.x;
  }
  { // 0x0250 ADD
    vec4 vv=((r0).yyyy+-((r0).xxxx));
    r5.y=vv.y;
  }
  { // 0x0260 ADD
    vec4 vv=(-((r8).xxxx)+-((r8).yyyy));
    r0.y=vv.y;
  }
  { // 0x0270 MUL + RCP
    vec4 vv=((r9).zzzz*-((r4).xyzx));
    vec4 sv=vec4(1.0/((r9).zzzz).x);
    r4.xyz=vv.xyz;
    r0.x=sv.x;
  }
  { // 0x0280 MUL
    vec4 vv=((r4).wwww*(r9).wwww);
    r4.w=vv.w;
  }
  { // 0x0290 ADD
    vec4 vv=((vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx+(r0).yyyy);
    r5.z=vv.z;
  }
  { // 0x02a0 MIN
    vec4 vv=min((r0).xxxx,(r7).zwzz);
    r8.xy=vv.xy;
  }
  { // 0x02b0 MIN
    vec4 vv=min((r0).xxxx,(uFocus).wyzw);
    r0.xyz=vv.xyz;
  }
  { // 0x02c0 MOV
    vec4 vv=(r5).xyzx;
    o11.xyz=vv.xyz;
  }
  { // 0x02d0 DP3
    vec4 vv=vec4(dot(((r5).xyzx).xyz,((uModelview[3]).xyzx).xyz));
    o14.w=vv.w;
  }
  { // 0x02e0 DP3
    vec4 vv=vec4(dot(((r5).xyzx).xyz,((uModelview[2]).xyzx).xyz));
    o14.z=vv.z;
  }
  { // 0x02f0 MAX
    vec4 vv=max((r0).zzzz,(r7).zzzz);
    r0.z=vv.z;
  }
  { // 0x0300 MAX + RCP
    vec4 vv=max((r0).xyxx,(uFocus).zxzz);
    vec4 sv=vec4(1.0/((r6).xxxx).x);
    r0.xy=vv.xy;
    r9.w=sv.w;
  }
  { // 0x0310 MAX + RCP
    vec4 vv=max((r8).yyyy,(r8).zzzz);
    vec4 sv=vec4(1.0/((r6).yyyy).x);
    r8.y=vv.y;
    r6.x=sv.x;
  }
  { // 0x0320 MAX
    vec4 vv=max((r8).xxxx,(r7).wwww);
    r0.w=vv.w;
  }
  { // 0x0330 ADD
    vec4 vv=((r0).wwww+-((r7).wwww));
    r0.w=vv.w;
  }
  { // 0x0340 ADD
    vec4 vv=((r8).yyyy+-((r8).zzzz));
    r6.y=vv.y;
  }
  { // 0x0350 ADD
    vec4 vv=(-((uFocus).zyzz)+(r0).xyxx);
    r0.xy=vv.xy;
  }
  { // 0x0360 ADD
    vec4 vv=((r0).zzzz+-((r7).zzzz));
    r0.z=vv.z;
  }
  { // 0x0370 MUL
    vec4 vv=((r0).yyyy*(r6).xxxx);
    r6.x=vv.x;
  }
  { // 0x0380 MUL + LG2
    vec4 vv=((r0).xxxx*(r9).wwww);
    vec4 sv=vec4(log2(max(((r6).xxxx).x,1.0e-30)));
    r8.x=vv.x;
    r7.w=sv.w;
  }
  { // 0x0390 DP3 + LG2
    vec4 vv=vec4(dot(((r5).xyzx).xyz,((uModelview[1]).xyzx).xyz));
    vec4 sv=vec4(log2(max(((r8).xxxx).x,1.0e-30)));
    o14.y=vv.y;
    r7.z=sv.z;
  }
  { // 0x03a0 MUL + RCP
    vec4 vv=((r7).wwww*(uFocusCurves).xxxx);
    vec4 sv=vec4(1.0/((r9).xxxx).x);
    r8.y=vv.y;
    r0.y=sv.y;
  }
  { // 0x03b0 MUL + EX2
    vec4 vv=((r7).zzzz*(uFocusCurves).yyyy);
    vec4 sv=vec4(exp2(((r8).yyyy).x));
    r7.z=vv.z;
    r0.x=sv.x;
  }
  { // 0x03c0 DP3 + EX2
    vec4 vv=vec4(dot(((r5).xyzx).xyz,((uModelview[0]).xyzx).xyz));
    vec4 sv=vec4(exp2(((r7).zzzz).x));
    o14.x=vv.x;
    r8.y=sv.y;
  }
  { // 0x03d0 MAD
    vec4 vv=((r0).xxxx*(r6).zzzz+(uParticleSize).xxxx);
    r5.x=vv.x;
  }
  { // 0x03e0 ADD
    vec4 vv=((uParticleSize).zzzz+-((r5).xxxx));
    r5.y=vv.y;
  }
  { // 0x03f0 MUL + RCP
    vec4 vv=((r0).zzzz*(r0).yyyy);
    vec4 sv=vec4(1.0/((r9).yyyy).x);
    r0.y=vv.y;
    r5.z=sv.z;
  }
  { // 0x0400 MAD
    vec4 vv=((r8).yyyy*(r5).yyyy+(r5).xxxx);
    r7.z=vv.z;
  }
  { // 0x0410 MAD
    vec4 vv=(-((r6).yyyy)*(r5).zzzz+(r0).yyyy);
    r0.y=vv.y;
  }
  { // 0x0420 MUL + RCP
    vec4 vv=((r9).zzzz*(r7).zzzz);
    vec4 sv=vec4(1.0/((r8).wwww).x);
    r5.x=vv.x;
    r6.y=sv.y;
  }
  { // 0x0430 MAX
    vec4 vv=max(abs((r5).xxxx),(vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx);
    r0.z=vv.z;
  }
  { // 0x0440 MUL + RCP
    vec4 vv=((r0).wwww*(r6).yyyy);
    vec4 sv=vec4(1.0/((r0).zzzz).x);
    r6.y=vv.y;
    r5.y=sv.y;
  }
  { // 0x0450 MIN
    vec4 vv=min(abs((r5).xxxx),(vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx);
    r0.z=vv.z;
  }
  { // 0x0460 MUL
    vec4 vv=((r0).zzzz*(r5).yyyy);
    r0.w=vv.w;
  }
  { // 0x0470 MUL
    vec4 vv=((r0).wwww*(r0).wwww);
    r5.y=vv.y;
  }
  { // 0x0480 MAD
    vec4 vv=((r5).yyyy*(vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).yyyy+(vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).zzzz);
    r5.z=vv.z;
  }
  { // 0x0490 MOV
    vec4 vv=(r6).yyyy;
    r0.z=vv.z;
  }
  { // 0x04a0 MAD
    vec4 vv=((r5).zzzz*(r5).yyyy+-((vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).wwww));
    r5.z=vv.z;
  }
  { // 0x04b0 ADD
    vec4 vv=((vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx+(r0).yyyy);
    r7.w=vv.w;
  }
  { // 0x04c0 MAD
    vec4 vv=((r5).zzzz*(r5).yyyy+(vec4(0.19563592970371246,0.33299461007118225,0.9999956488609314,1.5707963705062866)).xxxx);
    r0.y=vv.y;
  }
  { // 0x04d0 MAD
    vec4 vv=((r0).xxxx*(uNearControl).zzzz+(r6).yyyy);
    r5.z=vv.z;
  }
  { // 0x04e0 MAD
    vec4 vv=((r0).yyyy*(r5).yyyy+-((vec4(0.19563592970371246,0.33299461007118225,0.9999956488609314,1.5707963705062866)).yyyy));
    r0.y=vv.y;
  }
  { // 0x04f0 MOV
    vec4 vv=(r5).xxxx;
    cc0.y=vv.y;
  }
  { // 0x0500 MAD
    vec4 vv=((r0).yyyy*(r5).yyyy+(vec4(0.19563592970371246,0.33299461007118225,0.9999956488609314,1.5707963705062866)).zzzz);
    r0.y=vv.y;
  }
  { // 0x0510 SGT
    vec4 vv=vec4(greaterThan(abs((r5).xxxx),(vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx));
    cc0.x=vv.x;
  }
  { // 0x0520 MUL
    vec4 vv=((r0).yyyy*(r0).wwww);
    r0.y=vv.y;
  }
  { // 0x0530 MOV
    vec4 vv=(r0).yyyy;
    r0.w=vv.w;
  }
  { // 0x0540 ADD
    bvec4 execute=notEqual(cc0.xxxx,vec4(0));
    vec4 vv=((vec4(0.19563592970371246,0.33299461007118225,0.9999956488609314,1.5707963705062866)).wwww+-((r0).yyyy));
    r0.w=mix(r0.w,vv.w,execute.w);
  }
  { // 0x0550 MOV + RCP
    vec4 vv=(r8).yyyy;
    vec4 sv=vec4(1.0/((uFocusCurves).zzzz).x);
    r0.y=vv.y;
    r5.y=sv.y;
  }
  { // 0x0560 MOV
    vec4 vv=(r0).wwww;
    r5.x=vv.x;
  }
  { // 0x0570 MOV
    bvec4 execute=lessThan(cc0.yyyy,vec4(0));
    vec4 vv=-((r0).wwww);
    r5.x=mix(r5.x,vv.x,execute.x);
  }
  { // 0x0580 MUL
    vec4 vv=((r5).xxxx*(r5).yyyy);
    r0.w=vv.w;
  }
  { // 0x0590 MUL
    vec4 vv=((r0).wwww*(vec4(2.0,0.4000000059604645,0.20000000298023224,0.0)).xxxx);
    r5.x=vv.x;
  }
  { // 0x05a0 MAD
    vec4 vv=clamp(((r5).xxxx*(uNearControl).xxxx+(r5).zzzz),0.0,1.0);
    r5.z=vv.z;
  }
  { // 0x05b0 MOV
    vec4 vv=(r5).xxxx;
    r0.w=vv.w;
  }
  { // 0x05c0 MUL
    vec4 vv=((r5).xxxx*(uDarkness).yxyy);
    r5.xy=vv.xy;
  }
  { // 0x05d0 MUL
    vec4 vv=clamp(((r8).xxxx*(r5).xxxx),0.0,1.0);
    r5.x=vv.x;
  }
  { // 0x05e0 MAD
    vec4 vv=((r5).zzzz*(r3).xyzw+(r2).xyzw);
    r2.xyzw=vv.xyzw;
  }
  { // 0x05f0 MUL
    vec4 vv=clamp(((r6).xxxx*(r5).yyyy),0.0,1.0);
    r3.y=vv.y;
  }
  { // 0x0600 DP4
    vec4 vv=vec4(dot((r2).xyzw,(r2).xyzw));
    r3.x=vv.x;
  }
  { // 0x0610 ADD
    vec4 vv=((vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx+-((r3).yyyy));
    r3.w=vv.w;
  }
  { // 0x0620 MOV + RSQ
    vec4 vv=(r0).xyzw;
    vec4 sv=vec4(inversesqrt(abs(((r3).xxxx).x)));
    o9.xyzw=vv.xyzw;
    r3.x=sv.x;
  }
  { // 0x0630 ADD
    vec4 vv=((vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx+-((r5).xxxx));
    r0.w=vv.w;
  }
  { // 0x0640 MUL
    vec4 vv=((r3).xxxx*(r2).xyzw);
    r2.xyzw=vv.xyzw;
  }
  { // 0x0650 MUL
    vec4 vv=((r2).xyzx*(vec4(2.0,0.4000000059604645,0.20000000298023224,0.0)).xxxx);
    r3.xyz=vv.xyz;
  }
  { // 0x0660 MUL
    vec4 vv=((r2).xyzx*(r3).xyzx);
    r0.xyz=vv.xyz;
  }
  { // 0x0670 MUL
    vec4 vv=((r2).xyzx*(r3).yzxy);
    r2.xyz=vv.xyz;
  }
  { // 0x0680 MUL
    vec4 vv=((r2).wwww*(r3).xyzx);
    r5.xyz=vv.xyz;
  }
  { // 0x0690 ADD
    vec4 vv=((r2).xyzx+-((r5).zxyz));
    r3.xyz=vv.xyz;
  }
  { // 0x06a0 ADD
    vec4 vv=((r2).yxzy+(r5).xzyx);
    r6.xyz=vv.xyz;
  }
  { // 0x06b0 ADD
    vec4 vv=(-((r0).yxxy)+-((r0).zzyz));
    r0.xyz=vv.xyz;
  }
  { // 0x06c0 ADD
    vec4 vv=((vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx+(r0).xyzx);
    r2.xyz=vv.xyz;
  }
  { // 0x06d0 MOV
    vec4 vv=(r6).zzzz;
    r0.x=vv.x;
  }
  { // 0x06e0 MOV
    vec4 vv=(r3).yyyy;
    r0.y=vv.y;
  }
  { // 0x06f0 MOV
    vec4 vv=(r3).zzzz;
    r6.z=vv.z;
  }
  { // 0x0700 MOV
    vec4 vv=(r3).xxxx;
    r5.x=vv.x;
  }
  { // 0x0710 MOV
    vec4 vv=(r6).xxxx;
    r5.z=vv.z;
  }
  { // 0x0720 MOV
    vec4 vv=(r2).zzzz;
    r0.z=vv.z;
  }
  { // 0x0730 MOV
    vec4 vv=(r2).xxxx;
    r6.x=vv.x;
  }
  { // 0x0740 MOV
    vec4 vv=(r2).yyyy;
    r5.y=vv.y;
  }
  { // 0x0750 MUL
    vec4 vv=((r7).yyyy*(r5).xyzw);
    r2.xyzw=vv.xyzw;
  }
  { // 0x0760 MAD
    vec4 vv=((r6).xyzw*(r7).xxxx+(r2).xyzw);
    r2.xyzw=vv.xyzw;
  }
  { // 0x0770 DP3
    vec4 vv=vec4(dot(((r4).xyzx).xyz,((r0).xyzx).xyz));
    r0.x=vv.x;
  }
  { // 0x0780 MAD
    vec4 vv=((r2).xyzw*(r7).zzzz+(r1).xyzw);
    r1.xyzw=vv.xyzw;
  }
  { // 0x0790 ADD
    vec4 vv=((vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx+-(abs((r0).xxxx)));
    r0.x=vv.x;
  }
  { // 0x07a0 DP4
    vec4 vv=vec4(dot((r1).xyzw,(uModelviewProjection[3]).xyzw));
    o0.w=vv.w;
  }
  { // 0x07b0 DP4 + LG2
    vec4 vv=vec4(dot((r1).xyzw,(uModelviewProjection[2]).xyzw));
    vec4 sv=vec4(log2(max(((r0).xxxx).x,1.0e-30)));
    o0.z=vv.z;
    r0.x=sv.x;
  }
  { // 0x07c0 DP4
    vec4 vv=vec4(dot((r1).xyzw,(uModelviewProjection[1]).xyzw));
    o0.y=vv.y;
  }
  { // 0x07d0 MUL
    vec4 vv=((r0).xxxx*(uTransparency).xxxx);
    r0.x=vv.x;
  }
  { // 0x07e0 DP4 + EX2
    vec4 vv=vec4(dot((r1).xyzw,(uModelviewProjection[0]).xyzw));
    vec4 sv=vec4(exp2(((r0).xxxx).x));
    o0.x=vv.x;
    r0.x=sv.x;
  }
  { // 0x07f0 ADD
    vec4 vv=((vec4(1.0,-0.013480469584465027,0.05747731402516365,0.121239073574543)).xxxx+-((r0).xxxx));
    r0.x=vv.x;
  }
  { // 0x0800 MOV
    vec4 vv=(r1).xyzw;
    o12.xyzw=vv.xyzw;
  }
  { // 0x0810 MUL
    vec4 vv=((r0).xxxx*(uTransparency).yyyy);
    r0.x=vv.x;
  }
  { // 0x0820 MUL
    vec4 vv=((aParticle).wwww*(r0).xxxx);
    r0.x=vv.x;
  }
  { // 0x0830 MUL
    vec4 vv=((r0).xxxx*(r7).wwww);
    r0.x=vv.x;
  }
  { // 0x0840 MUL
    vec4 vv=((r0).xxxx*(r0).wwww);
    r0.x=vv.x;
  }
  { // 0x0850 MUL
    vec4 vv=((r0).xxxx*(r3).wwww);
    r0.x=vv.x;
  }
  { // 0x0860 MUL
    vec4 vv=((r0).xxxx*(r4).wwww);
    o10.w=vv.w;
  }
  gl_Position=o0;
  vBackdropTransmission=1.0;
  if(uAmbientEnabled && o0.w>0.000001)
    vBackdropTransmission=texture(uAmbient,0.5*(o0.xy/o0.w)+0.5).r;
  vUV=o7.xy;vFocus=o9.xy;vFade=o10.w;vNormal=o11.xyz;vPosition=o12.xyz;vViewNormal=o14.xyz;
}
