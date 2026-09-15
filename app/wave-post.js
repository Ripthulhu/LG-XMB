/*
 * FXAA edge search adapted from three.js FXAAShader.js, revision
 * caddbf4cd84b62d7edf6b9fc937ca709afdfe915. Copyright 2010-2025 three.js authors.
 * NVIDIA algorithm; Jasper Flick implementation; Dave Hoskins GLSL port.
 * SPDX-License-Identifier: MIT. Full notice: licenses/THREE-FXAA-MIT.txt.
 * WebGL 1 port and optional wave-coverage detection: lg-xmb contributors.
 */
(function (root) {
  'use strict';
  var STRENGTHS = {
    gentle:[0.015625,0.125,0.5], normal:[0.0078125,0.0833333,0.75], strong:[0.00390625,0.0625,1]
  };
  var VERTEX = 'attribute vec2 aPosition; varying vec2 vUV; void main(){vUV=(aPosition+1.0)*0.5;gl_Position=vec4(aPosition,0.0,1.0);}';
  // The resolve stores display RGB and wave coverage in A. Only the edge detector
  // reads coverage; the output always filters RGB together and writes opaque alpha.
  // Static loop bounds and texture2D keep this GLSL ES 1.00 compatible.
  var FRAGMENT = `
precision PRECISION float;
varying vec2 vUV;
uniform sampler2D uImage;
uniform vec2 uPixel;
uniform vec3 uTuning;
uniform bool uCoverage;
float signalAt(vec2 uv) {
  vec4 c=texture2D(uImage,uv);
  return uCoverage ? c.a : dot(c.rgb,vec3(0.3,0.59,0.11));
}
float stepSize(int i) {
  if(i==0) return 1.5;
  if(i==4) return 4.0;
  return 2.0;
}
void main() {
  float m=signalAt(vUV);
  float n=signalAt(vUV+vec2(0.0,uPixel.y));
  float s=signalAt(vUV-vec2(0.0,uPixel.y));
  float e=signalAt(vUV+vec2(uPixel.x,0.0));
  float w=signalAt(vUV-vec2(uPixel.x,0.0));
  float hi=max(m,max(max(n,s),max(e,w)));
  float lo=min(m,min(min(n,s),min(e,w)));
  float contrast=hi-lo;
  if(contrast<max(uTuning.x,uTuning.y*hi)) {
    gl_FragColor=vec4(texture2D(uImage,vUV).rgb,1.0); return;
  }
  float ne=signalAt(vUV+uPixel);
  float nw=signalAt(vUV+vec2(-uPixel.x,uPixel.y));
  float se=signalAt(vUV+vec2(uPixel.x,-uPixel.y));
  float sw=signalAt(vUV-uPixel);
  float horizontal=2.0*abs(n+s-2.0*m)+abs(ne+se-2.0*e)+abs(nw+sw-2.0*w);
  float vertical=2.0*abs(e+w-2.0*m)+abs(ne+nw-2.0*n)+abs(se+sw-2.0*s);
  bool isHorizontal=horizontal>=vertical;
  float positive=isHorizontal?n:e, negative=isHorizontal?s:w;
  float gp=abs(positive-m), gn=abs(negative-m);
  float pixelStep=isHorizontal?uPixel.y:uPixel.x;
  float opposite=positive, gradient=gp;
  if(gn>gp) {pixelStep=-pixelStep;opposite=negative;gradient=gn;}
  vec2 normalStep=isHorizontal?vec2(0.0,pixelStep):vec2(pixelStep,0.0);
  vec2 along=isHorizontal?vec2(uPixel.x,0.0):vec2(0.0,uPixel.y);
  vec2 edgeUV=vUV+normalStep*0.5;
  float edgeValue=(m+opposite)*0.5, threshold=gradient*0.25;
  vec2 puv=edgeUV+along, nuv=edgeUV-along;
  float pd=signalAt(puv)-edgeValue, nd=signalAt(nuv)-edgeValue;
  bool pEnd=abs(pd)>=threshold, nEnd=abs(nd)>=threshold;
  for(int i=0;i<5;i++) {
    float step=stepSize(i);
    if(!pEnd) {puv+=along*step;pd=signalAt(puv)-edgeValue;pEnd=abs(pd)>=threshold;}
    if(!nEnd) {nuv-=along*step;nd=signalAt(nuv)-edgeValue;nEnd=abs(nd)>=threshold;}
    if(pEnd&&nEnd) break;
  }
  if(!pEnd) puv+=along*8.0;
  if(!nEnd) nuv-=along*8.0;
  float pDistance=isHorizontal?puv.x-vUV.x:puv.y-vUV.y;
  float nDistance=isHorizontal?vUV.x-nuv.x:vUV.y-nuv.y;
  float nearest=min(pDistance,nDistance);
  bool endSign=(pDistance<=nDistance?pd:nd)>=0.0;
  float edgeBlend=0.0;
  if(endSign!=(m-edgeValue>=0.0)) edgeBlend=0.5-nearest/max(pDistance+nDistance,0.000001);
  float sub=abs((2.0*(n+s+e+w)+ne+nw+se+sw)/12.0-m)/max(contrast,0.000001);
  sub=smoothstep(0.0,1.0,clamp(sub,0.0,1.0));
  float blend=max(edgeBlend,sub*sub*uTuning.z);
  gl_FragColor=vec4(texture2D(uImage,vUV+normalStep*blend).rgb,1.0);
}`;

  function create(gl, precision) {
    var shaders=[], program=null, buffer=null, texture=null, framebuffer=null;
    var width=0, height=0, failedSize=null, failure=null, dead=false;
    var position, image, pixel, tuning, coverage;
    function releaseSurface(lost) {
      if(!lost) {
        if(texture)gl.deleteTexture(texture);
        if(framebuffer)gl.deleteFramebuffer(framebuffer);
      }
      texture=null;framebuffer=null;width=0;height=0;
    }
    function destroy(lost) {
      if(dead)return;dead=true;releaseSurface(lost);
      if(!lost) {
        shaders.forEach(function(shader){gl.deleteShader(shader);});
        if(program)gl.deleteProgram(program);
        if(buffer)gl.deleteBuffer(buffer);
      }
      shaders=[];program=null;buffer=null;
    }
    try {
      program=gl.createProgram();if(!program)throw new Error('Post-process program unavailable');
      [VERTEX,FRAGMENT.replace('PRECISION',precision)].forEach(function(source,index){
        var shader=gl.createShader(index?gl.FRAGMENT_SHADER:gl.VERTEX_SHADER);
        if(!shader)throw new Error('Post-process shader unavailable');
        shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);gl.attachShader(program,shader);
      });
      gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Post-process shader refused');
      shaders.forEach(function(shader){gl.deleteShader(shader);});shaders=[];
      buffer=gl.createBuffer();if(!buffer)throw new Error('Post-process buffer unavailable');
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      if(gl.getError()!==gl.NO_ERROR)throw new Error('Post-process buffer refused');
      position=gl.getAttribLocation(program,'aPosition');
      if(position<0)throw new Error('Post-process attribute unavailable');
      image=gl.getUniformLocation(program,'uImage');pixel=gl.getUniformLocation(program,'uPixel');
      tuning=gl.getUniformLocation(program,'uTuning');coverage=gl.getUniformLocation(program,'uCoverage');
    } catch(error) {destroy(false);throw error;}
    return {
      prepare:function(w,h) {
        if(dead)return false;
        if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>1920||h>1080)throw new RangeError('Invalid post-process size');
        if(w===width&&h===height)return true;
        var key=w+'x'+h;if(failedSize===key)return false;
        var limit=gl.getParameter(gl.MAX_TEXTURE_SIZE),viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        if(w>limit||h>limit||w>viewport[0]||h>viewport[1]) {
          releaseSurface(false);failedSize=key;failure='GPU limit';return false;
        }
        // A same-size failure is cached. Do not retry allocations on every frame.
        releaseSurface(false);
        var t=gl.createTexture(),f=gl.createFramebuffer(),valid=false;
        try {
          if(t&&f) {
            gl.bindTexture(gl.TEXTURE_2D,t);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
            var error=gl.getError();
            gl.bindFramebuffer(gl.FRAMEBUFFER,f);
            gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
            var status=gl.checkFramebufferStatus(gl.FRAMEBUFFER),attachError=gl.getError();
            valid=error===gl.NO_ERROR&&attachError===gl.NO_ERROR&&status===gl.FRAMEBUFFER_COMPLETE;
          }
        } catch(ignore) {valid=false;}
        finally {gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
        if(!valid) {
          if(t)gl.deleteTexture(t);if(f)gl.deleteFramebuffer(f);
          failedSize=key;failure='allocation refused';return false;
        }
        texture=t;framebuffer=f;width=w;height=h;failedSize=null;failure=null;return true;
      },
      target:function(){return framebuffer;},
      render:function(mode,strength,region) {
        if(dead||!texture)return;
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        gl.viewport(region ? region.x : 0,region ? region.y : 0,width,height);gl.disable(gl.BLEND);
        gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.uniform1i(image,0);gl.uniform2f(pixel,1/width,1/height);
        gl.uniform3fv(tuning,STRENGTHS[strength]||STRENGTHS.normal);gl.uniform1i(coverage,mode==='wave'?1:0);
        gl.drawArrays(gl.TRIANGLES,0,3);
      },
      release:function(){releaseSurface(false);},
      diagnostics:function(){return {width:width,height:height,failure:failure};},
      destroy:destroy
    };
  }
  root.LGXMBWavePost=Object.freeze({create:create});
}(window));
