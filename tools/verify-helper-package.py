#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Check the shipped helper, not just the source tree. Does not extract or execute it."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
APP = 'usr/palm/applications/org.local.openxmb.c5/'
SOURCES = {'process_control.py': 'tv-helper/process_control.py',
           'thumbnail_cache.py': 'tv-helper/thumbnail_cache.py',
           'stop_thumbnail_helper.py': 'tv-helper/recovery/stop_thumbnail_helper.py'}


def verify(filename):
    raw = Path(filename).read_bytes()
    if raw[:8] != b'!<arch>\n':
        raise ValueError('Not an IPK archive')
    pos, members = 8, {}
    while pos < len(raw):
        header = raw[pos:pos + 60]
        if len(header) != 60 or header[58:] != b'`\n':
            raise ValueError('Invalid ar member')
        name = header[:16].decode('ascii').strip().rstrip('/')
        size = int(header[48:58])
        if size < 0 or name in members or pos + 60 + size > len(raw):
            raise ValueError('Invalid ar size or duplicate member')
        members[name] = raw[pos + 60:pos + 60 + size]
        pos += 60 + size + size % 2
    with tarfile.open(fileobj=io.BytesIO(members['data.tar.gz']), mode='r:gz') as archive:
        entries = {}
        for entry in archive:
            name = entry.name.removeprefix('./')
            if name in entries:
                raise ValueError('Duplicate package path')
            entries[name] = entry
        for name in (APP.rstrip('/'), APP + 'helper'):
            entry = entries[name]
            if not entry.isdir() or entry.mode != 0o755:
                raise ValueError('Unsafe packaged helper directory: ' + name)
        def read(name, executable=False):
            entry = entries[APP + name]
            if not entry.isfile() or entry.mode & 0o022 or (executable and not entry.mode & 0o111):
                raise ValueError('Unsafe packaged helper permissions: ' + name)
            return archive.extractfile(entry).read()
        appinfo = read('appinfo.json')
        if appinfo != (ROOT / 'app/appinfo.json').read_bytes():
            raise ValueError('Packaged manifest differs from source')
        bundle = read('helper/bundle.json')
        manifest = json.loads(bundle)
        template = (ROOT / 'app/helper-startup.py').read_bytes()
        expected = template.replace(b'\nBUNDLE_SHA256 = "@BUNDLE_SHA256@"',
                                    b'\nBUNDLE_SHA256 = "' + hashlib.sha256(bundle).hexdigest().encode() + b'"', 1)
        if read('helper-startup.py', True) != expected or manifest.get('startupSha256') != hashlib.sha256(template).hexdigest():
            raise ValueError('Startup entry or embedded bundle pin differs from source')
        if manifest.get('schema') != 1 or set(manifest.get('files', {})) != set(SOURCES):
            raise ValueError('Incomplete helper bundle')
        if manifest['appinfoSha256'] != hashlib.sha256(appinfo).hexdigest():
            raise ValueError('Bundle manifest pin mismatch')
        for name, source in SOURCES.items():
            payload = read('helper/' + name)
            if payload != (ROOT / source).read_bytes() or hashlib.sha256(payload).hexdigest() != manifest['files'][name]:
                raise ValueError('Bundled helper differs from source: ' + name)
        if any(name.startswith(('var/', 'tmp/')) for name in entries):
            raise ValueError('Runtime files must not be installed by the IPK')
    print('Verified app-owned helper bundle, exact source bytes and executable startup entry.')


if __name__ == '__main__':
    verify(sys.argv[1])
