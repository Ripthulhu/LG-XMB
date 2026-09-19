'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const scripts=['wave-colors','ps3-background-clock','ps3-background-data','ps3-native-data','ps3-native-core','ps3-native-shaders','ps3-native-renderer'];
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],results=[];
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
  try {
    for(const variant of (process.env.WAVE_BASELINE?['before','after']:['after'])) {
      const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
      page.on('pageerror',e=>errors.push(e.message));
      await page.setContent('<style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas id="wave"></canvas>');
      for(const name of scripts) await page.addScriptTag({path:variant==='before'&&name==='ps3-native-shaders'?process.env.WAVE_BASELINE:path.join(root,'app',name+'.js')});
      await page.evaluate(()=>{window.demo=new C5Wave(document.querySelector('canvas'),{preserveDrawingBuffer:true});});
      await page.waitForFunction(()=>demo.mode==='webgl'||demo.mode==='static');
      assert.equal(await page.evaluate(()=>demo.mode),'webgl');
      if(variant==='after') {
        const edge=await page.evaluate(()=>{
          const g=demo.gl,r=demo.renderer;
          const compile=(type,source)=>{const s=g.createShader(type);g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};
          const vs=compile(g.VERTEX_SHADER,LGXMBPS3Shaders.waveVertex),fs=compile(g.FRAGMENT_SHADER,'#version 300 es\nprecision mediump float;out vec4 c;void main(){c=vec4(1);}');
          const program=g.createProgram();g.attachShader(program,vs);g.attachShader(program,fs);g.transformFeedbackVaryings(program,['vEdge'],g.INTERLEAVED_ATTRIBS);g.linkProgram(program);
          if(!g.getProgramParameter(program,g.LINK_STATUS))throw Error(g.getProgramInfoLog(program));
          g.useProgram(program);g.bindVertexArray(r.waveVAO);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,r.controlTexture);
          const rows=[];
          for(const grid of [64,128]) {
            g.uniform1i(g.getUniformLocation(program,'uGrid'),grid);
            const count=grid*grid+grid*2,buffer=g.createBuffer(),tf=g.createTransformFeedback();
            g.bindTransformFeedback(g.TRANSFORM_FEEDBACK,tf);g.bindBuffer(g.TRANSFORM_FEEDBACK_BUFFER,buffer);g.bufferData(g.TRANSFORM_FEEDBACK_BUFFER,count*4,g.STREAM_READ);g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER,0,buffer);
            g.enable(g.RASTERIZER_DISCARD);g.beginTransformFeedback(g.POINTS);g.drawArrays(g.POINTS,0,count);g.endTransformFeedback();g.disable(g.RASTERIZER_DISCARD);
            const values=new Float32Array(count);g.getBufferSubData(g.TRANSFORM_FEEDBACK_BUFFER,0,values);
            let maxError=0;
            const ramp=n=>Math.min(1,10*Math.min(n/127,1-n/127));
            for(let i=0;i<grid*grid;i++) {
              const x=Math.round((i%grid)*127/(grid-1)),y=Math.round(Math.floor(i/grid)*127/(grid-1));
              maxError=Math.max(maxError,Math.abs(values[i]-ramp(x)*ramp(y)));
            }
            rows.push({grid,maxError,guardsZero:values.slice(grid*grid).every(v=>v===0),finite:values.every(Number.isFinite)});
            g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER,0,null);g.bindTransformFeedback(g.TRANSFORM_FEEDBACK,null);g.deleteTransformFeedback(tf);g.deleteBuffer(buffer);
          }
          g.deleteProgram(program);g.deleteShader(vs);g.deleteShader(fs);g.bindVertexArray(null);
          return {rows,error:g.getError()};
        });
        assert.equal(edge.error,0);
        for(const row of edge.rows){assert.ok(row.finite&&row.guardsZero);assert.ok(row.maxError<.001,JSON.stringify(row));}
        results.push(edge);
      }
      for(const seconds of [0,8]) {
        if(seconds)await page.evaluate(()=>{for(let i=0;i<480;i++)demo.simulation.advance(1/60,false);});
        for(const light of [false,true]) {
          await page.evaluate(light=>{demo.setQuality({sampling:1,detail:'high',softness:0,postprocess:'off',particles:false});demo.setTheme({background:light?'#8090a0':'#08101c',wave:'#91b5cc'});demo.draw();},light);
          assert.equal(await page.evaluate(()=>demo.gl.getError()),0);
          await page.screenshot({path:path.join(root,'artifacts',`wave-edge-${variant}-${seconds}-${light?'light':'dark'}.png`)});
        }
      }
      for(const detail of ['standard','high'])for(const postprocess of ['off','wave'])for(const softness of [0,1.5,3]) {
        const state=await page.evaluate(q=>{demo.setQuality(q);demo.draw();return {mode:demo.mode,error:demo.gl.getError(),diagnostics:demo.getDiagnostics().surface};},{detail,postprocess,softness});
        assert.equal(state.mode,'webgl');assert.equal(state.error,0);
      }
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({edge:results,errors,checks:['GPU taper at 64 and 128 grid sizes','zero guard taper','fixed-state light/dark comparisons','both grids with all filters'],tvPerformance:false},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
