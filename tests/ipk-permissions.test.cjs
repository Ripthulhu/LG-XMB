'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {gzipSync, gunzipSync} = require('node:zlib');
const names = ['usr/palm/applications/org.local.openxmb.c5',
  'usr/palm/applications/org.local.openxmb.c5/helper',
  'usr/palm/packages/org.local.openxmb.c5'];
const checksum = h => {
  h.fill(32,148,156);
  h.write(h.reduce((sum,b)=>sum+b,0).toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
};
function header(name, mode=0o777, kind='5', size=0) {
  const h=Buffer.alloc(512);
  h.write(name);h.write(mode.toString(8).padStart(7,'0')+'\0',100,8,'ascii');
  h.write(size.toString(8).padStart(11,'0')+'\0',124,12,'ascii');h.write(kind,156);
  checksum(h);return h;
}
function archive(tar) {
  const entries=[['debian-binary',Buffer.from('2.0\n')],['control.tar.gz',gzipSync(Buffer.from('control'))],['data.tar.gz',gzipSync(tar)]];
  return Buffer.concat([Buffer.from('!<arch>\n'),...entries.flatMap(([name,b])=>[
    Buffer.from(name.padEnd(16)+'0'.padEnd(12)+'0'.padEnd(6)+'0'.padEnd(6)+'100644'.padEnd(8)+String(b.length).padEnd(10)+'`\n'),
    b,...(b.length%2?[Buffer.from('\n')]:[])])]);
}
function members(ipk) {
  const found={};let i=8;
  while(i<ipk.length){const h=ipk.subarray(i,i+60),n=h.subarray(0,16).toString().trim(),s=Number(h.subarray(48,58).toString().trim());found[n]=ipk.subarray(i+60,i+60+s);i+=60+s+s%2;}
  return found;
}
const tarFixture=()=>Buffer.concat([...names.map(n=>header(n)),header('unrelated',0o777),
  header(names[0]+'/app.js',0o644,'0',8),Buffer.concat([Buffer.from('payload\n'),Buffer.alloc(504)]),Buffer.alloc(1024)]);

test('only owned directory mode/checksum fields change; all file and control bytes remain intact',async()=>{
  const {normalizeIpkPermissions}=await import('../tools/ipk-permissions.mjs');
  const before=tarFixture(),ipk=archive(before),fixed=normalizeIpkPermissions(ipk),m=members(fixed);
  const after=gunzipSync(m['data.tar.gz']);
  assert.deepEqual(m['control.tar.gz'],members(ipk)['control.tar.gz']);
  assert.deepEqual(m['debian-binary'],members(ipk)['debian-binary']);
  for(let i=0;i<before.length;i++)if(before[i]!==after[i]){
    const block=Math.floor(i/512),field=i%512;
    assert.ok(block<3&&((field>=100&&field<108)||(field>=148&&field<156)));
  }
  for(let i=0;i<3;i++)assert.equal(after.subarray(i*512+100,i*512+108).toString(),'0000755\0');
  assert.throws(()=>normalizeIpkPermissions(ipk,{verifyOnly:true}),/Unsafe packaged directory/);
  assert.strictEqual(normalizeIpkPermissions(fixed,{verifyOnly:true}),fixed);
  assert.strictEqual(normalizeIpkPermissions(fixed),fixed);
});

test('malformed, truncated, missing, duplicate and path-override archives are refused',async()=>{
  const {normalizeIpkPermissions}=await import('../tools/ipk-permissions.mjs');
  assert.throws(()=>normalizeIpkPermissions(Buffer.from('not an ipk')));
  assert.throws(()=>normalizeIpkPermissions(archive(tarFixture()).subarray(0,65)));
  const bad=tarFixture();bad[5]^=1;assert.throws(()=>normalizeIpkPermissions(archive(bad)),/checksum/);
  for(const blocks of [names.slice(1).map(n=>header(n)),[...names.map(n=>header(n)),header(names[0])],
    [...names.map(n=>header(n)),header('override',0o644,'x')]]){
    assert.throws(()=>normalizeIpkPermissions(archive(Buffer.concat([...blocks,Buffer.alloc(1024)]))));
  }
  const file=header(names[0],0o644,'0');
  assert.throws(()=>normalizeIpkPermissions(archive(Buffer.concat([file,...names.slice(1).map(n=>header(n)),Buffer.alloc(1024)]))),/directory entry/);
});
