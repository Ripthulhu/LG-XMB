#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Check the helper inside the built IPK, without extracting or executing it."""
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def verify(package):
    data = subprocess.run(['ar', 'p', str(package), 'data.tar.gz'],
                          check=True, capture_output=True).stdout
    prefix = 'usr/palm/applications/org.local.openxmb.c5/'
    sources = {
        'helper/process-control.py': 'tv-helper/process_control.py',
        'helper/thumbnail-cache.py': 'tv-helper/thumbnail_cache.py',
        'helper/stop-helper.py': 'tv-helper/recovery/stop_thumbnail_helper.py',
        'helper-startup.py': 'app/helper-startup.py',
        'appinfo.json': 'app/appinfo.json',
    }
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        members = archive.getmembers()
        def read(name):
            entry, = [m for m in members if m.name.removeprefix('./') == prefix + name]
            assert entry.isfile() and not entry.mode & 0o022, name + ': unsafe file mode/type'
            if name == 'helper-startup.py':
                assert entry.mode & 0o111, 'Startup entry must be executable'
            return archive.extractfile(entry).read()
        for name, source in sources.items():
            assert read(name) == (ROOT / source).read_bytes(), 'Packaged source differs: ' + name
        raw = read('helper-bundle.json')
        bundle = json.loads(raw)
        assert bundle['schema'] == 1
        assert set(bundle['files']) == set(sources) - {'appinfo.json'}
        for name, digest in bundle['files'].items():
            assert hashlib.sha256(read(name)).hexdigest() == digest, 'Bundle hash differs: ' + name
        assert hashlib.sha256(read('appinfo.json')).hexdigest() == bundle['appinfo']
        controller_pin = re.search(rb"^PIN_APPINFO_SHA256 = '([a-f0-9]{64})'$", read('helper/process-control.py'), re.M)
        assert controller_pin and controller_pin[1].decode() == bundle['appinfo']
        expected = (ROOT/'tv-helper/setup.py').read_text().replace('@BUNDLE_SHA256@', hashlib.sha256(raw).hexdigest())
        assert read('helper-setup.py') == expected.encode(), 'Packaged installer differs'
        assert not any(m.name.removeprefix('./').startswith('var/lib/webosbrew/init.d/')
                       for m in members), 'Do not package a persistent startup copy'
    print('Verified bundled helper sources, manifest pins and app-owned startup entry.')


if __name__ == '__main__':
    package, = (ROOT/'dist').glob('*.ipk')
    verify(package)
