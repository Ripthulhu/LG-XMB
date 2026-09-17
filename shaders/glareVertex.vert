#version 300 es
// Register-dataflow reconstruction of particles_second.vpo, 3.01.
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
uniform vec4 uTransparency;
uniform vec4 uFocusCurves;
uniform vec4 uGlare;
uniform vec4 uModelviewProjection[4];
uniform vec4 uDarkness;
void main() {
  vec4 r0=vec4(0),r1=vec4(0),r2=vec4(0),r3=vec4(0),r4=vec4(0),r5=vec4(0),r6=vec4(0),r7=vec4(0),r8=vec4(0),r9=vec4(0),r10=vec4(0),r11=vec4(0),r12=vec4(0),r13=vec4(0),r14=vec4(0),r15=vec4(0);
  vec4 o0=vec4(0,0,0,1),o7=vec4(0,0,0,1),o9=vec4(0,0,0,1),o10=vec4(0,0,0,1),o11=vec4(0,0,0,1),o12=vec4(0,0,0,1),o14=vec4(0,0,0,1);
  vec4 cc0=vec4(0),cc1=vec4(0);
  { // 0x0000 MOV
    vec4 vv=(vec4(2.0,1.0,0.0,0.5)).yyyy;
    o10.xyz=vv.xyz;
  }
  { // 0x0010 MOV
    vec4 vv=(aParticle).xyzx;
    r0.xyz=vv.xyz;
  }
  { // 0x0020 ADD
    vec4 vv=(-((uLifeBoundsMin).xyzx)+(aParticle).xyzx);
    r2.xyz=vv.xyz;
  }
  { // 0x0030 ADD
    vec4 vv=((uLifeBoundsMax).xyzx+-((aParticle).xyzx));
    r3.xyz=vv.xyz;
  }
  { // 0x0040 MOV
    vec4 vv=(vec4(aCorner,0.0,0.0)).xyxx;
    o7.xy=vv.xy;
  }
  { // 0x0050 MOV
    vec4 vv=(vec4(2.0,1.0,0.0,0.5)).zzzz;
    o7.zw=vv.zw;
  }
  { // 0x0060 ADD
    vec4 vv=(-((uFocus).zzzy)+(uFocus).wwwx);
    r10.zw=vv.zw;
  }
  { // 0x0070 ADD
    vec4 vv=(-((vec4(2.0,1.0,0.0,0.5)).wwww)+(vec4(aCorner,0.0,0.0)).xyxx);
    r10.xy=vv.xy;
  }
  { // 0x0080 MOV
    vec4 vv=(vec4(2.0,1.0,0.0,0.5)).yyyy;
    r0.w=vv.w;
  }
  { // 0x0090 ADD
    vec4 vv=(-((uParticleSize).xxxx)+(uParticleSize).yyyy);
    r4.w=vv.w;
  }
  { // 0x00a0 MOV
    vec4 vv=(vec4(2.0,1.0,0.0,0.5)).zzzz;
    r2.w=vv.w;
  }
  { // 0x00b0 MOV
    vec4 vv=(vec4(2.0,1.0,0.0,0.5)).zzzz;
    r1.w=vv.w;
  }
  { // 0x00c0 DP4
    vec4 vv=vec4(dot((aQuaternion).xyzw,(aQuaternion).xyzw));
    r3.w=vv.w;
  }
  { // 0x00d0 MOV
    vec4 vv=(uFocus).zzzz;
    r5.x=vv.x;
  }
  { // 0x00e0 MOV
    vec4 vv=(vec4(2.0,1.0,0.0,0.5)).xxxx;
    r8.w=vv.w;
  }
  { // 0x00f0 MOV
    vec4 vv=(uLightPack[0]).yyyy;
    r1.x=vv.x;
  }
  { // 0x0100 MOV
    vec4 vv=(uLightPack[1]).yyyy;
    r1.y=vv.y;
  }
  { // 0x0110 MOV
    vec4 vv=(uLightPack[2]).yyyy;
    r1.z=vv.z;
  }
  { // 0x0120 MOV
    vec4 vv=(uLightPack[0]).xxxx;
    r4.x=vv.x;
  }
  { // 0x0130 MOV
    vec4 vv=(uLightPack[1]).xxxx;
    r4.y=vv.y;
  }
  { // 0x0140 MOV
    vec4 vv=(uLightPack[2]).xxxx;
    r4.z=vv.z;
  }
  { // 0x0150 ADD
    vec4 vv=((aParticle).xyzx+-((r4).xyzx));
    r4.xyz=vv.xyz;
  }
  { // 0x0160 ADD
    vec4 vv=(-((aParticle).xyzx)+(r1).xyzx);
    r6.xyz=vv.xyz;
  }
  { // 0x0170 MUL
    vec4 vv=((r8).wwww*(uFrontFacingQuaternion).xyzx);
    r1.xyz=vv.xyz;
  }
  { // 0x0180 ADD
    vec4 vv=(-((vec4(0.4000000059604645,0.20000000298023224,-0.013480469584465027,0.05747731402516365)).yxyy)+(r5).xxxx);
    r11.xy=vv.xy;
  }
  { // 0x0190 ADD
    vec4 vv=(-((vec4(1.5707963705062866,0.6000000238418579,5.0,3.0)).yyyy)+(r5).xxxx);
    r6.w=vv.w;
  }
  { // 0x01a0 MIN
    vec4 vv=min((r2).xyzx,(r3).xyzx);
    r5.xyz=vv.xyz;
  }
  { // 0x01b0 MUL
    vec4 vv=((r1).xyzx*(uFrontFacingQuaternion).xyzx);
    r3.xyz=vv.xyz;
  }
  { // 0x01c0 MUL
    vec4 vv=((r1).yzxy*(uFrontFacingQuaternion).xyzx);
    r2.xyz=vv.xyz;
  }
  { // 0x01d0 MUL
    vec4 vv=((r1).xyzx*(uFrontFacingQuaternion).wwww);
    r7.xyz=vv.xyz;
  }
  { // 0x01e0 ADD
    vec4 vv=((uFocus).zzzz+-((r11).xxxx));
    r7.w=vv.w;
  }
  { // 0x01f0 ADD
    vec4 vv=((r2).xyzx+-((r7).zxyz));
    r1.xyz=vv.xyz;
  }
  { // 0x0200 ADD
    vec4 vv=((r2).yxzy+(r7).xzyx);
    r2.xyz=vv.xyz;
  }
  { // 0x0210 MIN
    vec4 vv=min((r5).xxxx,(r5).yyyy);
    r5.x=vv.x;
  }
  { // 0x0220 ADD
    vec4 vv=(-((r3).yxxy)+-((r3).zzyz));
    r3.xyz=vv.xyz;
  }
  { // 0x0230 DP3 + RSQ
    vec4 vv=vec4(dot(((r6).xyzx).xyz,((r6).xyzx).xyz));
    vec4 sv=vec4(inversesqrt(abs(((r3).wwww).x)));
    r11.w=vv.w;
    r5.y=sv.y;
  }
  { // 0x0240 DP3
    vec4 vv=vec4(dot(((r4).xyzx).xyz,((r4).xyzx).xyz));
    r12.x=vv.x;
  }
  { // 0x0250 ADD
    vec4 vv=((r11).yyyy+-((r6).wwww));
    r11.z=vv.z;
  }
  { // 0x0260 ADD
    vec4 vv=((r11).xxxx+-((r11).yyyy));
    r9.w=vv.w;
  }
  { // 0x0270 MIN
    vec4 vv=min((r5).xxxx,(r5).zzzz);
    r3.w=vv.w;
  }
  { // 0x0280 MUL
    vec4 vv=((r5).yyyy*(aQuaternion).xyzw);
    r5.xyzw=vv.xyzw;
  }
  { // 0x0290 ADD
    vec4 vv=((vec4(2.0,1.0,0.0,0.5)).yyyy+(r3).xyzx);
    r8.xyz=vv.xyz;
  }
  { // 0x02a0 MUL
    vec4 vv=clamp(((r3).wwww*(vec4(1.5707963705062866,0.6000000238418579,5.0,3.0)).zzzz),0.0,1.0);
    r7.z=vv.z;
  }
  { // 0x02b0 MOV
    vec4 vv=(r2).zzzz;
    r7.x=vv.x;
  }
  { // 0x02c0 MOV
    vec4 vv=(r1).yyyy;
    r7.y=vv.y;
  }
  { // 0x02d0 MOV
    vec4 vv=(r1).zzzz;
    r2.z=vv.z;
  }
  { // 0x02e0 MOV
    vec4 vv=(r2).xxxx;
    r1.z=vv.z;
  }
  { // 0x02f0 MUL
    vec4 vv=((r5).xyzx*(vec4(2.0,1.0,0.0,0.5)).xxxx);
    r9.xyz=vv.xyz;
  }
  { // 0x0300 MUL
    vec4 vv=((r5).wyzw*(r9).xzxy);
    r3.xyzw=vv.xyzw;
  }
  { // 0x0310 MUL
    vec4 vv=((r5).xxxy*(r9).xxxy);
    r5.zw=vv.zw;
  }
  { // 0x0320 MAD
    vec4 vv=((r8).wwww*-((r7).zzzz)+(vec4(1.5707963705062866,0.6000000238418579,5.0,3.0)).wwww);
    r9.x=vv.x;
  }
  { // 0x0330 MUL
    vec4 vv=((r7).zzzz*(r7).zzzz);
    r8.w=vv.w;
  }
  { // 0x0340 MOV
    vec4 vv=(r8).zzzz;
    r7.z=vv.z;
  }
  { // 0x0350 MOV
    vec4 vv=(r8).xxxx;
    r2.x=vv.x;
  }
  { // 0x0360 MOV
    vec4 vv=(r8).yyyy;
    r1.y=vv.y;
  }
  { // 0x0370 ADD
    vec4 vv=((r3).zzzz+(r3).wwww);
    r5.x=vv.x;
  }
  { // 0x0380 ADD
    vec4 vv=((r3).yyyy+-((r3).xxxx));
    r5.y=vv.y;
  }
  { // 0x0390 MUL + RSQ
    vec4 vv=((r10).yyyy*(r1).xyzw);
    vec4 sv=vec4(inversesqrt(abs(((r12).xxxx).x)));
    r1.xyzw=vv.xyzw;
    r3.w=sv.w;
  }
  { // 0x03a0 ADD
    vec4 vv=(-((r5).zzzz)+-((r5).wwww));
    r5.z=vv.z;
  }
  { // 0x03b0 MUL
    vec4 vv=((r3).wwww*-((r4).xyzx));
    r3.xyz=vv.xyz;
  }
  { // 0x03c0 MAD
    vec4 vv=((r2).xyzw*(r10).xxxx+(r1).xyzw);
    r1.xyzw=vv.xyzw;
  }
  { // 0x03d0 MUL + RSQ
    vec4 vv=((r8).wwww*(r9).xxxx);
    vec4 sv=vec4(inversesqrt(abs(((r11).wwww).x)));
    r2.w=vv.w;
    r4.x=sv.x;
  }
  { // 0x03e0 DP3 + RCP
    vec4 vv=vec4(dot(((r3).xyzx).xyz,((r7).xyzx).xyz));
    vec4 sv=vec4(1.0/((r3).wwww).x);
    r4.y=vv.y;
    r2.x=sv.x;
  }
  { // 0x03f0 MAD
    vec4 vv=((r4).xxxx*(r6).xyzx+(r3).xyzx);
    r3.xyz=vv.xyz;
  }
  { // 0x0400 ADD
    vec4 vv=((vec4(2.0,1.0,0.0,0.5)).yyyy+(r5).zzzz);
    r5.z=vv.z;
  }
  { // 0x0410 ADD
    vec4 vv=((vec4(2.0,1.0,0.0,0.5)).yyyy+-(abs((r4).yyyy)));
    r5.w=vv.w;
  }
  { // 0x0420 MIN
    vec4 vv=min((r2).xxxx,(r11).xyxx);
    r4.xy=vv.xy;
  }
  { // 0x0430 MIN
    vec4 vv=min((r2).xxxx,(uFocus).wyzw);
    r2.xyz=vv.xyz;
  }
  { // 0x0440 MOV
    vec4 vv=(r5).xyzx;
    o11.xyz=vv.xyz;
  }
  { // 0x0450 DP3
    vec4 vv=vec4(dot(((r5).xyzx).xyz,((uModelview[3]).xyzx).xyz));
    o14.w=vv.w;
  }
  { // 0x0460 DP3
    vec4 vv=vec4(dot(((r5).xyzx).xyz,((uModelview[2]).xyzx).xyz));
    o14.z=vv.z;
  }
  { // 0x0470 DP3
    vec4 vv=vec4(dot(((r5).xyzx).xyz,((uModelview[1]).xyzx).xyz));
    o14.y=vv.y;
  }
  { // 0x0480 DP3
    vec4 vv=vec4(dot(((r5).xyzx).xyz,((uModelview[0]).xyzx).xyz));
    o14.x=vv.x;
  }
  { // 0x0490 DP3
    vec4 vv=vec4(dot(((r3).xyzx).xyz,((r3).xyzx).xyz));
    r6.x=vv.x;
  }
  { // 0x04a0 MAX + RCP
    vec4 vv=max((r2).xyxx,(uFocus).zxzz);
    vec4 sv=vec4(1.0/((r10).wwww).x);
    r2.xy=vv.xy;
    r6.y=sv.y;
  }
  { // 0x04b0 MAX + RCP
    vec4 vv=max((r4).xxxx,(r11).yyyy);
    vec4 sv=vec4(1.0/((r10).zzzz).x);
    r4.x=vv.x;
    r6.z=sv.z;
  }
  { // 0x04c0 MAX + RCP
    vec4 vv=max((r2).zzzz,(r11).xxxx);
    vec4 sv=vec4(1.0/((r9).wwww).x);
    r7.x=vv.x;
    r4.z=sv.z;
  }
  { // 0x04d0 MAX
    vec4 vv=max((r4).yyyy,(r6).wwww);
    r2.z=vv.z;
  }
  { // 0x04e0 ADD
    vec4 vv=((r2).zzzz+-((r6).wwww));
    r2.z=vv.z;
  }
  { // 0x04f0 ADD
    vec4 vv=((r7).xxxx+-((r11).xxxx));
    r4.y=vv.y;
  }
  { // 0x0500 ADD
    vec4 vv=((r4).xxxx+-((r11).yyyy));
    r4.x=vv.x;
  }
  { // 0x0510 ADD
    vec4 vv=(-((uFocus).zyzz)+(r2).xyxx);
    r2.xy=vv.xy;
  }
  { // 0x0520 MUL + RCP
    vec4 vv=((r4).xxxx*(r4).zzzz);
    vec4 sv=vec4(1.0/((r7).wwww).x);
    r4.z=vv.z;
    r6.w=sv.w;
  }
  { // 0x0530 MUL + LG2
    vec4 vv=((r2).xxxx*(r6).zzzz);
    vec4 sv=vec4(log2(max(((r5).wwww).x,1.0e-30)));
    r6.z=vv.z;
    r4.x=sv.x;
  }
  { // 0x0540 MUL + RCP
    vec4 vv=((r4).yyyy*(r6).wwww);
    vec4 sv=vec4(1.0/((r11).zzzz).x);
    r4.y=vv.y;
    r2.x=sv.x;
  }
  { // 0x0550 MUL + RSQ
    vec4 vv=((r4).xxxx*(uTransparency).xxxx);
    vec4 sv=vec4(inversesqrt(abs(((r6).xxxx).x)));
    r4.x=vv.x;
    r6.x=sv.x;
  }
  { // 0x0560 MAD
    vec4 vv=(-((r2).zzzz)*(r2).xxxx+(r4).yyyy);
    r4.y=vv.y;
  }
  { // 0x0570 MUL + EX2
    vec4 vv=((r2).yyyy*(r6).yyyy);
    vec4 sv=vec4(exp2(((r4).xxxx).x));
    r5.w=vv.w;
    r4.x=sv.x;
  }
  { // 0x0580 MUL + LG2
    vec4 vv=((r6).xxxx*(r3).xyzx);
    vec4 sv=vec4(log2(max(((r5).wwww).x,1.0e-30)));
    r2.xyz=vv.xyz;
    r7.x=sv.x;
  }
  { // 0x0590 DP3 + LG2
    vec4 vv=vec4(dot(((r5).xyzx).xyz,((r2).xyzx).xyz));
    vec4 sv=vec4(log2(max(((r6).zzzz).x,1.0e-30)));
    r2.x=vv.x;
    r3.x=sv.x;
  }
  { // 0x05a0 ADD
    vec4 vv=((vec4(2.0,1.0,0.0,0.5)).yyyy+-((r4).xxxx));
    r2.y=vv.y;
  }
  { // 0x05b0 ADD
    vec4 vv=((vec4(2.0,1.0,0.0,0.5)).yyyy+(r4).yyyy);
    r2.z=vv.z;
  }
  { // 0x05c0 MUL
    vec4 vv=((r3).xxxx*(uFocusCurves).yyyy);
    r3.x=vv.x;
  }
  { // 0x05d0 MUL
    vec4 vv=((r7).xxxx*(uFocusCurves).xxxx);
    r3.y=vv.y;
  }
  { // 0x05e0 MUL + LG2
    vec4 vv=((r2).yyyy*(uTransparency).yyyy);
    vec4 sv=vec4(log2(max((abs((r2).xxxx)).x,1.0e-30)));
    r5.x=vv.x;
    r3.z=sv.z;
  }
  { // 0x05f0 MUL + EX2
    vec4 vv=((aParticle).wwww*(r5).xxxx);
    vec4 sv=vec4(exp2(((r3).yyyy).x));
    r2.x=vv.x;
    r4.x=sv.x;
  }
  { // 0x0600 MUL + EX2
    vec4 vv=((r2).xxxx*(r2).zzzz);
    vec4 sv=vec4(exp2(((r3).xxxx).x));
    r2.x=vv.x;
    r3.x=sv.x;
  }
  { // 0x0610 MUL
    vec4 vv=((r3).zzzz*(uLightPack[3]).yyyy);
    r2.y=vv.y;
  }
  { // 0x0620 MAD
    vec4 vv=((r4).xxxx*(r4).wwww+(uParticleSize).xxxx);
    r2.z=vv.z;
  }
  { // 0x0630 ADD
    vec4 vv=((uParticleSize).zzzz+-((r2).zzzz));
    r3.y=vv.y;
  }
  { // 0x0640 MOV + EX2
    vec4 vv=(r3).xxxx;
    vec4 sv=vec4(exp2(((r2).yyyy).x));
    r4.y=vv.y;
    r2.y=sv.y;
  }
  { // 0x0650 MAD
    vec4 vv=((r3).xxxx*(r3).yyyy+(r2).zzzz);
    r2.z=vv.z;
  }
  { // 0x0660 MUL
    vec4 vv=((r2).yyyy*(uGlare).yyyy);
    r2.y=vv.y;
  }
  { // 0x0670 MUL
    vec4 vv=((r2).zzzz*(r2).yyyy);
    r3.x=vv.x;
  }
  { // 0x0680 MUL
    vec4 vv=((r3).wwww*(r2).zzzz);
    r2.y=vv.y;
  }
  { // 0x0690 MAD
    vec4 vv=((r1).xyzw*(r3).xxxx+(r0).xyzw);
    r0.xyzw=vv.xyzw;
  }
  { // 0x06a0 MAX
    vec4 vv=max(abs((r2).yyyy),(vec4(2.0,1.0,0.0,0.5)).yyyy);
    r1.x=vv.x;
  }
  { // 0x06b0 MOV
    vec4 vv=(r2).yyyy;
    cc0.y=vv.y;
  }
  { // 0x06c0 NOP + RCP
    vec4 sv=vec4(1.0/((r1).xxxx).x);
    r1.y=sv.y;
  }
  { // 0x06d0 MIN
    vec4 vv=min(abs((r2).yyyy),(vec4(2.0,1.0,0.0,0.5)).yyyy);
    r1.x=vv.x;
  }
  { // 0x06e0 MUL
    vec4 vv=((r1).xxxx*(r1).yyyy);
    r1.x=vv.x;
  }
  { // 0x06f0 MUL
    vec4 vv=((r1).xxxx*(r1).xxxx);
    r1.y=vv.y;
  }
  { // 0x0700 MAD
    vec4 vv=((r1).yyyy*(vec4(0.4000000059604645,0.20000000298023224,-0.013480469584465027,0.05747731402516365)).zzzz+(vec4(0.4000000059604645,0.20000000298023224,-0.013480469584465027,0.05747731402516365)).wwww);
    r1.z=vv.z;
  }
  { // 0x0710 SGT
    vec4 vv=vec4(greaterThan(abs((r2).yyyy),(vec4(2.0,1.0,0.0,0.5)).yyyy));
    cc0.x=vv.x;
  }
  { // 0x0720 MAD
    vec4 vv=((r1).zzzz*(r1).yyyy+-((vec4(0.121239073574543,0.19563592970371246,0.33299461007118225,0.9999956488609314)).xxxx));
    r1.z=vv.z;
  }
  { // 0x0730 DP4
    vec4 vv=vec4(dot((r0).xyzw,(uModelviewProjection[3]).xyzw));
    o0.w=vv.w;
  }
  { // 0x0740 MAD
    vec4 vv=((r1).zzzz*(r1).yyyy+(vec4(0.121239073574543,0.19563592970371246,0.33299461007118225,0.9999956488609314)).yyyy);
    r1.z=vv.z;
  }
  { // 0x0750 DP4
    vec4 vv=vec4(dot((r0).xyzw,(uModelviewProjection[2]).xyzw));
    o0.z=vv.z;
  }
  { // 0x0760 MAD
    vec4 vv=((r1).zzzz*(r1).yyyy+-((vec4(0.121239073574543,0.19563592970371246,0.33299461007118225,0.9999956488609314)).zzzz));
    r1.z=vv.z;
  }
  { // 0x0770 DP4
    vec4 vv=vec4(dot((r0).xyzw,(uModelviewProjection[1]).xyzw));
    o0.y=vv.y;
  }
  { // 0x0780 MAD
    vec4 vv=((r1).zzzz*(r1).yyyy+(vec4(0.121239073574543,0.19563592970371246,0.33299461007118225,0.9999956488609314)).wwww);
    r1.y=vv.y;
  }
  { // 0x0790 DP4
    vec4 vv=vec4(dot((r0).xyzw,(uModelviewProjection[0]).xyzw));
    o0.x=vv.x;
  }
  { // 0x07a0 MUL
    vec4 vv=((r1).yyyy*(r1).xxxx);
    r1.y=vv.y;
  }
  { // 0x07b0 MOV
    vec4 vv=(r1).yyyy;
    r1.x=vv.x;
  }
  { // 0x07c0 ADD
    bvec4 execute=notEqual(cc0.xyzw,vec4(0));
    vec4 vv=((vec4(1.5707963705062866,0.6000000238418579,5.0,3.0)).xxxx+-((r1).yyyy));
    r1.x=mix(r1.x,vv.x,execute.x);
  }
  { // 0x07d0 MOV + RCP
    vec4 vv=(r0).xyzw;
    vec4 sv=vec4(1.0/((uFocusCurves).zzzz).x);
    o12.xyzw=vv.xyzw;
    r1.y=sv.y;
  }
  { // 0x07e0 MOV
    vec4 vv=(r1).xxxx;
    r0.x=vv.x;
  }
  { // 0x07f0 MOV
    bvec4 execute=lessThan(cc0.yyyy,vec4(0));
    vec4 vv=-((r1).xxxx);
    r0.x=mix(r0.x,vv.x,execute.x);
  }
  { // 0x0800 MUL
    vec4 vv=((r0).xxxx*(r1).yyyy);
    r0.x=vv.x;
  }
  { // 0x0810 MUL
    vec4 vv=((r0).xxxx*(vec4(2.0,1.0,0.0,0.5)).xxxx);
    r0.x=vv.x;
  }
  { // 0x0820 MOV
    vec4 vv=(r0).xxxx;
    r4.w=vv.w;
  }
  { // 0x0830 MUL
    vec4 vv=((r0).xxxx*(uDarkness).yxyy);
    r0.xy=vv.xy;
  }
  { // 0x0840 MOV
    vec4 vv=(r4).xyzw;
    o9.xyzw=vv.xyzw;
  }
  { // 0x0850 MUL
    vec4 vv=clamp(((r5).wwww*(r0).yyyy),0.0,1.0);
    r0.y=vv.y;
  }
  { // 0x0860 MUL
    vec4 vv=clamp(((r6).zzzz*(r0).xxxx),0.0,1.0);
    r0.x=vv.x;
  }
  { // 0x0870 ADD
    vec4 vv=((vec4(2.0,1.0,0.0,0.5)).yyyy+-((r0).xxxx));
    r0.x=vv.x;
  }
  { // 0x0880 ADD
    vec4 vv=((vec4(2.0,1.0,0.0,0.5)).yyyy+-((r0).yyyy));
    r0.y=vv.y;
  }
  { // 0x0890 MUL
    vec4 vv=((r2).xxxx*(r0).xxxx);
    r0.x=vv.x;
  }
  { // 0x08a0 MUL
    vec4 vv=((r0).xxxx*(r0).yyyy);
    r0.x=vv.x;
  }
  { // 0x08b0 MUL
    vec4 vv=((r0).xxxx*(r2).wwww);
    o10.w=vv.w;
  }
  gl_Position=o0;
  vUV=o7.xy;vFocus=o9.xy;vFade=o10.w;vNormal=o11.xyz;vPosition=o12.xyz;vViewNormal=o14.xyz;
}
