#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Check the shipped helper, not just the source tree. Does not extract or execute it."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile

from ipk_archive import read_ipk

ROOT = Path(__file__).resolve().parents[1]
APP = 'usr/palm/applications/org.local.openxmb.c5/'
SOURCES = json.loads((ROOT / 'tv-helper/bundle-sources.json').read_text(encoding='utf-8'))


def verify(filename):
    if not {'thumbnail_cache.py', 'stop_thumbnail_helper.py', 'home_button.py'}.issubset(SOURCES):
        raise ValueError('Helper inventory is missing a required entry point')
    members = read_ipk(Path(filename).read_bytes())
    with tarfile.open(fileobj=io.BytesIO(members['data.tar.gz']), mode='r:gz') as archive:
        entries = {}
        for entry in archive:
            name = entry.name.removeprefix('./')
            if name in entries:
                raise ValueError('Duplicate package path')
            entries[name] = entry
        for name, entry in entries.items():
            if name == APP.rstrip('/') or name.startswith(APP):
                if entry.uid != 0 or entry.gid != 0:
                    raise ValueError('App entry is not packaged as root: ' + name)
                if entry.isdir() and entry.mode != 0o755:
                    raise ValueError('Unsafe packaged directory permissions: ' + name)
        for name in (APP.rstrip('/'), APP + 'helper'):
            if name not in entries or not entries[name].isdir():
                raise ValueError('Missing app/helper directory: ' + name)
        def read(name, executable=False):
            entry = entries[APP + name]
            if not entry.isfile() or entry.mode & 0o022 or (executable and not entry.mode & 0o111):
                raise ValueError('Unsafe packaged helper permissions: ' + name)
            return archive.extractfile(entry).read()
        template = (ROOT / 'app/helper-startup.py').read_bytes()
        if template.count(b'@BUNDLE_SHA256@') != 1:
            raise ValueError('Expected one source bootstrap bundle pin')
        pin = hashlib.sha256(read('helper/bundle.json')).hexdigest().encode()
        if read('helper-startup.py', True) != template.replace(b'@BUNDLE_SHA256@', pin):
            raise ValueError('Startup entry or build pin differs from source')
        appinfo = read('appinfo.json')
        if appinfo != (ROOT / 'app/appinfo.json').read_bytes():
            raise ValueError('Packaged manifest differs from source')
        manifest = json.loads(read('helper/bundle.json'))
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
    if len(sys.argv) > 1:
        package = Path(sys.argv[1])
    else:
        package, = (ROOT / 'dist').glob('*.ipk')
    verify(package)
