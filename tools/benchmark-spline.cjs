// SPDX-License-Identifier: MIT
// CPU-only comparison with the frozen evaluator; not a browser/TV FPS benchmark.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const Reference = require('../tests/fixtures/ps3-spline-reference.cjs');
const root = {};
new Function('window',fs.readFileSync(path.join(__dirname,'../app/ps3-wave.js'),'utf8'))(root);
const results = [];
for (const [columns,rows] of [[128,48],[256,96],[384,128]]) {
  const meshes = [new Reference(columns,rows),root.LGXMBPS3Wave.createGeometry(columns,rows)];
  const samples = [[],[]];
  for (let frame=0; frame<220; frame++) {
    // Alternate order; both evaluators receive the same complete clock history.
    for (const index of (frame%2 ? [1,0] : [0,1])) {
      const start = performance.now();
      meshes[index].update(14+frame*0.035);
      const elapsed = performance.now()-start;
      if (frame>=40) samples[index].push(elapsed);
    }
  }
  const stats = samples.map(values=>{
    values.sort((a,b)=>a-b);
    return {medianMs:values[Math.floor(values.length*0.5)],p95Ms:values[Math.floor(values.length*0.95)]};
  });
  results.push({columns,rows,vertices:(columns+1)*(rows+1),baseline:stats[0],optimized:stats[1],
    medianReductionPercent:100*(1-stats[1].medianMs/stats[0].medianMs)});
}
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,
  warmupFrames:40,measuredFrames:180,scope:'CPU spline update only; no GPU, DOM or TV measurement',results},null,2));
