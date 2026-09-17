#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uControls;
uniform vec4 uBasis[8];
uniform vec4 uDerivative[8];
uniform int uGrid;
uniform float uAspectCorrection;
out vec4 tfPosition;
out vec4 tfNormal;
out vec2 vUV;
void main() {
  ivec2 sampleIndex=ivec2(gl_VertexID%uGrid,gl_VertexID/uGrid);
  // Lower detail selects a subset of the verified 128x128 grid; endpoints stay put.
  sampleIndex=ivec2(round(vec2(sampleIndex)*127.0/float(uGrid-1)));
  ivec2 patchIndex=sampleIndex/8;
  ivec2 localIndex=sampleIndex%8;
  vec4 bx=uBasis[localIndex.x],by=uBasis[localIndex.y];
  vec4 dx=uDerivative[localIndex.x],dy=uDerivative[localIndex.y];
  vec4 p=vec4(0),du=vec4(0),dv=vec4(0);
  for(int y=0;y<4;y++) {
    vec4 row=vec4(0),tangent=vec4(0);
    for(int x=0;x<4;x++) {
      vec4 c=texelFetch(uControls,patchIndex+ivec2(x,y),0);
      row+=c*bx[x];tangent+=c*dx[x];
    }
    p+=row*by[y];du+=tangent*by[y];dv+=row*dy[y];
  }
  tfPosition=p;tfNormal=vec4(cross(dv.xyz,du.xyz),0.0);
  gl_Position=vec4(p.x*uAspectCorrection,p.yzw);
  vUV=vec2(sampleIndex)/127.0;
}
