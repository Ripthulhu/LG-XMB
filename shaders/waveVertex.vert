#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uControls;
uniform vec4 uBasis[8];
uniform vec4 uDerivative[8];
uniform int uGrid;
uniform float uAspectCorrection;
uniform float uGuardClip;
out vec4 tfPosition;
out vec4 tfNormal;
out mediump float vEdge;
void main() {
  // Vertices past the grid are guards: copies of the end columns that get
  // pushed beyond the viewport, so the sheet's finite end never shows as a
  // hole. The sampled geometry itself is unchanged.
  bool guard=gl_VertexID>=uGrid*uGrid;
  int guardID=gl_VertexID-uGrid*uGrid;
  int gx=(guardID&1)==0?0:uGrid-1;
  ivec2 sampleIndex=guard?ivec2(gx,guardID/2):ivec2(gl_VertexID%uGrid,gl_VertexID/uGrid);
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
  if(guard&&p.w>0.00001){
    float plane=uGuardClip*p.w;
    // In the captured transform column zero is the RIGHT end of the sheet.
    gl_Position.x=gx==0?max(gl_Position.x,plane):min(gl_Position.x,-plane);
  }
  // Recovered attribute 8.y: linear 10% ramps at all four sheet edges.
  // Calculate before rasterization, as in the original coordinate stream.
  vec2 uv=vec2(sampleIndex)/127.0;
  vec2 taper=min(vec2(1.0),10.0*min(uv,1.0-uv));
  vEdge=taper.x*taper.y;
}
