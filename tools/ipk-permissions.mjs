// SPDX-License-Identifier: GPL-3.0-or-later
// The pinned CLI ignores directory filemode overrides. Normalize only our own
// three directory headers in its unsigned IPK, before calculating release hashes.
import {gunzipSync, gzipSync} from 'node:zlib';

const directories = new Set([
  'usr/palm/applications/org.local.openxmb.c5',
  'usr/palm/applications/org.local.openxmb.c5/helper',
  'usr/palm/packages/org.local.openxmb.c5'
]);
const maximum = 20 * 1024 * 1024;
const require = (value, message) => { if (!value) throw new Error(message); };
const text = value => value.toString('ascii').replace(/\0.*$/s, '').trim();
function octal(value) {
  const input = text(value);
  require(/^[0-7]+$/.test(input), 'Invalid tar numeric field');
  return Number.parseInt(input, 8);
}

export function normalizeIpkPermissions(input, {verifyOnly = false} = {}) {
  require(Buffer.isBuffer(input) && input.length <= maximum &&
    input.subarray(0, 8).toString() === '!<arch>\n', 'Expected a bounded unsigned IPK');
  const entries = [];
  let offset = 8;
  while (offset < input.length) {
    require(offset + 60 <= input.length, 'Truncated ar header');
    const header = Buffer.from(input.subarray(offset, offset + 60));
    require(header.subarray(58).toString() === '`\n', 'Invalid ar header');
    const name = text(header.subarray(0, 16)).replace(/\/$/, '');
    const sizeText = text(header.subarray(48, 58));
    require(/^[0-9]+$/.test(sizeText), 'Invalid ar member size');
    const size = Number(sizeText), end = offset + 60 + size;
    require(end + size % 2 <= input.length, 'Truncated ar member');
    entries.push({name, header, bytes: input.subarray(offset + 60, end)});
    offset = end + size % 2;
  }
  require(entries.map(entry => entry.name).join(',') === 'debian-binary,control.tar.gz,data.tar.gz',
    'Only the unsigned CLI package layout is supported');
  require(entries[0].bytes.toString() === '2.0\n', 'Unexpected package format');
  const data = entries[2], tar = gunzipSync(data.bytes, {maxOutputLength: maximum});
  const found = new Set();
  let changed = false;
  offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const stored = octal(header.subarray(148, 156));
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
    require(stored === checksum, 'Invalid tar header checksum');
    // Extended path records could override a following name: do not guess.
    const kind = header[156];
    require(kind === 0 || kind === 48 || kind === 53, 'Unsupported tar entry type');
    const prefix = text(header.subarray(345, 500));
    const name = ((prefix ? prefix + '/' : '') + text(header.subarray(0, 100)))
      .replace(/^\.\//, '').replace(/\/$/, '');
    const size = octal(header.subarray(124, 136));
    const end = offset + 512 + Math.ceil(size / 512) * 512;
    require(end <= tar.length, 'Truncated tar member');
    if (directories.has(name)) {
      require(kind === 53 && size === 0 && !found.has(name), 'Invalid app directory entry');
      found.add(name);
      if (octal(header.subarray(100, 108)) !== 0o755) {
        require(!verifyOnly, 'Unsafe packaged directory mode: ' + name);
        header.write('0000755\0', 100, 8, 'ascii');
        header.fill(32, 148, 156);
        checksum = header.reduce((sum, byte) => sum + byte, 0);
        header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
        changed = true;
      }
    }
    offset = end;
  }
  require(found.size === directories.size && tar.length - offset >= 1024 &&
    tar.subarray(offset).every(byte => byte === 0), 'Missing directories or invalid tar end');
  if (!changed) return input;
  data.bytes = gzipSync(tar, {level: 9});
  data.header.write(String(data.bytes.length).padEnd(10, ' '), 48, 10, 'ascii');
  return Buffer.concat([input.subarray(0, 8), ...entries.flatMap(entry => [
    entry.header, entry.bytes, ...(entry.bytes.length % 2 ? [Buffer.from('\n')] : [])
  ])]);
}
