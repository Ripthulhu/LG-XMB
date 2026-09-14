#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Read an unsigned CLI IPK and normalize only its app-owned archive entries."""
import copy
import gzip
import io
from pathlib import Path, PurePosixPath
import tarfile

APP_ID = 'org.local.openxmb.c5'
APP = 'usr/palm/applications/' + APP_ID
PACKAGE = 'usr/palm/packages/' + APP_ID


def read_ipk(raw):
    if len(raw) > 64 * 1024 * 1024 or raw[:8] != b'!<arch>\n':
        raise ValueError('Not a supported IPK archive')
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
        pos += 60 + size + (size % 2)
    if pos != len(raw) or set(members) != {'debian-binary', 'control.tar.gz', 'data.tar.gz'}:
        raise ValueError('Expected an unsigned CLI IPK')
    if members['debian-binary'] != b'2.0\n':
        raise ValueError('Unexpected IPK format version')
    return members


def write_ipk(members):
    output = bytearray(b'!<arch>\n')
    for name, data in members.items():
        header = f'{name:<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(data):<10}`\n'.encode('ascii')
        if len(header) != 60:
            raise ValueError('Oversized ar member header')
        output.extend(header)
        output.extend(data)
        if len(data) % 2:
            output.extend(b'\n')
    return bytes(output)


def normalize_permissions(raw):
    members = read_ipk(raw)
    # Refuse to silently invalidate a signed package or arbitrary install hooks.
    with tarfile.open(fileobj=io.BytesIO(members['control.tar.gz']), mode='r:gz') as control:
        entries = control.getmembers()
        if len(entries) != 1 or entries[0].name.removeprefix('./') != 'control' or not entries[0].isfile():
            raise ValueError('Only unsigned web-app control metadata is supported')
    output = io.BytesIO()
    with tarfile.open(fileobj=io.BytesIO(members['data.tar.gz']), mode='r:gz') as source, \
         tarfile.open(fileobj=output, mode='w', format=tarfile.USTAR_FORMAT) as target:
        seen, total = set(), 0
        for entry in source:
            name = entry.name.removeprefix('./').rstrip('/')
            if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or name in seen:
                raise ValueError('Unsafe or duplicate package path')
            seen.add(name)
            if not entry.isdir() and not entry.isfile():
                raise ValueError('Unexpected link or special file in web app')
            total += entry.size
            if total > 64 * 1024 * 1024 or len(seen) > 4096:
                raise ValueError('Oversized web app')
            normalized = copy.copy(entry)
            if name == APP or name.startswith(APP + '/') or name == PACKAGE or name.startswith(PACKAGE + '/'):
                normalized.uid = normalized.gid = 0
                normalized.uname = normalized.gname = 'root'
                normalized.mode = 0o755 if entry.isdir() or name == APP + '/helper-startup.py' else 0o644
            # Do not change shared usr/palm ancestor permissions or any payload bytes.
            target.addfile(normalized, source.extractfile(entry) if entry.isfile() else None)
        if APP + '/helper' not in seen:
            raise ValueError('Helper directory is missing from the package')
    members['data.tar.gz'] = gzip.compress(output.getvalue(), mtime=0)
    return write_ipk(members)


def normalize_file(filename):
    path = Path(filename)
    normalized = normalize_permissions(path.read_bytes())
    temporary = path.with_suffix(path.suffix + '.tmp')
    stream = temporary.open('xb')
    try:
        with stream:
            stream.write(normalized)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    import sys
    normalize_file(sys.argv[1])
    print('Normalized app-owned IPK entries: root ownership, directories 0755, files 0644.')
