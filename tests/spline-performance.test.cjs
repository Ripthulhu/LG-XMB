// SPDX-License-Identifier: MIT
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Reference = require('./fixtures/ps3-spline-reference.cjs');
const root = {};
new Function('window', fs.readFileSync(path.join(__dirname,'../app/ps3-wave.js'),'utf8'))(root);
const api = root.LGXMBPS3Wave;
function bytes(array) { return Buffer.from(array.buffer, array.byteOffset, array.byteLength); }
for (const [columns,rows] of [[128,48],[256,96],[384,128]]) {
  test(`${columns}x${rows}: optimized surface is byte-identical to the original evaluator`, () => {
    const expected = new Reference(columns,rows), actual = api.createGeometry(columns,rows);
    const scratch = actual.columnWork;
    // Warm motion, repeated stills, a long gap, a day of uptime and a rewind.
    const times = [0,0,0.035,14,...Array.from({length:24},(_,i)=>14+i*0.035),70,300,86400,14];
    for (const time of times) {
      assert.equal(actual.update(time), expected.update(time));
      for (const name of ['vertices','indices','heights','kernel']) {
        assert.deepEqual(bytes(actual[name]),bytes(expected[name]), `${name} at ${time}`);
      }
      assert.deepEqual(actual.bounds,expected.bounds);
      assert.equal(actual.columnWork,scratch,'frame scratch must be reused');
    }
  });
}

test('each frame uses fewer transcendental evaluations, not fewer vertices', () => {
  function countedMath() {
    const math=Object.create(Math), calls={sin:0,cos:0,tanh:0};
    for(const name of Object.keys(calls))math[name]=function(value){calls[name]++;return Math[name](value);};
    return {math,calls,reset(){for(const name of Object.keys(calls))calls[name]=0;}};
  }
  const oldMath=countedMath(),newMath=countedMath(),referenceModule={exports:{}},optimizedRoot={};
  new Function('module','Math',fs.readFileSync(path.join(__dirname,'fixtures/ps3-spline-reference.cjs'),'utf8'))(referenceModule,oldMath.math);
  new Function('window','Math',fs.readFileSync(path.join(__dirname,'../app/ps3-wave.js'),'utf8'))(optimizedRoot,newMath.math);
  const expected=new referenceModule.exports(256,96),actual=optimizedRoot.LGXMBPS3Wave.createGeometry(256,96);
  oldMath.reset();newMath.reset();
  for(const time of [14,14.035]) {expected.update(time);actual.update(time);}
  assert.deepEqual(bytes(actual.vertices),bytes(expected.vertices));
  assert.equal(actual.vertices.length,24929*7);
  for(const name of Object.keys(oldMath.calls))assert.ok(newMath.calls[name]<oldMath.calls[name],name+' work was not reduced');
});
