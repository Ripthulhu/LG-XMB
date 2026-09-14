#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Normalize host ownership in an unsigned LG-XMB IPK; never extract or run it."""
import argparse
import gzip
import io
import os
from pathlib import Path, PurePosixPath
import tarfile
import tempfile

APP = 'usr/palm/applications/org.local.openxmb.c5'
PACKAGE = 'usr/palm/packages/org.local.openxmb.c5'
SHARED = {'usr', 'usr/palm', 'usr/palm/applications', 'usr/palm/packages'}
MEMBERS = ('debian-binary', 'control.tar.gz', 'data.tar.gz')
LIMIT = 32 * 1024 * 1024


def read_ipk(raw):
    if len(raw) > LIMIT or raw[:8] != b'!<arch>\n':
        raise ValueError('Expected an unsigned LG-XMB IPK')
    pos, members = 8, {}
    while pos < len(raw):
        header = raw[pos:pos + 60]
        if len(header) != 60 or header[58:] != b'`\n':
            raise ValueError('Invalid ar header')
        name = header[:16].decode('ascii').strip().rstrip('/')
        size = int(header[48:58])
        end = pos + 60 + size
        if size < 0 or end + size % 2 > len(raw) or name in members:
            raise ValueError('Invalid ar member size or duplicate')
        members[name] = raw[pos + 60:end]
        pos = end + size % 2
    if set(members) != set(MEMBERS) or members['debian-binary'] != b'2.0\n':
        raise ValueError('Unsupported or signed IPK; refusing to rewrite it')
    return members


def write_ipk(members):
    result = bytearray(b'!<arch>\n')
    for name in MEMBERS:
        payload = members[name]
        header = f'{name:<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(payload):<10}`\n'
        result.extend(header.encode('ascii'))
        result.extend(payload)
        if len(payload) % 2:
            result.extend(b'\n')
    return bytes(result)


def tar_entries(raw, section):
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
        payload = stream.read(LIMIT + 1)
    if len(payload) > LIMIT:
        raise ValueError('Package tar exceeds the size limit')
    result, seen = [], set()
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:') as archive:
        for entry in archive:
            name = entry.name.removeprefix('./').rstrip('/')
            parts = PurePosixPath(name).parts
            if (not name or name.startswith('/') or '..' in parts or
                    str(PurePosixPath(name)) != name or name in seen or len(seen) >= 4096):
                raise ValueError('Unsafe or duplicate package path: ' + name)
            seen.add(name)
            if not (entry.isfile() or entry.isdir()):
                raise ValueError('Only ordinary files and directories may be packaged: ' + name)
            if section == 'control.tar.gz':
                if name != 'control' or not entry.isfile():
                    raise ValueError('Unsupported control file; refusing signed packages or scripts')
            elif name in SHARED:
                if not entry.isdir():
                    raise ValueError('Shared ancestor is not a directory')
            elif not any(name == root or name.startswith(root + '/') for root in (APP, PACKAGE)):
                raise ValueError('Path is outside this app: ' + name)
            if entry.size < 0 or entry.size > LIMIT:
                raise ValueError('Oversized tar entry')
            entry.name = name
            data = archive.extractfile(entry).read() if entry.isfile() else None
            result.append((entry, data))
    return result


def normalized_tar(raw, section):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for entry, data in tar_entries(raw, section):
            # Do not ship attributes for shared installation ancestors. The app
            # installer owns those paths; only our two package subtrees belong here.
            if entry.name in SHARED:
                continue
            fixed = tarfile.TarInfo(entry.name)
            fixed.type, fixed.size = entry.type, entry.size
            fixed.mtime = int(entry.mtime)
            fixed.uid = fixed.gid = 0
            fixed.uname = fixed.gname = 'root'
            fixed.mode = 0o755 if entry.isdir() or entry.name == APP + '/helper-startup.py' else 0o644
            archive.addfile(fixed, io.BytesIO(data) if data is not None else None)
    return gzip.compress(output.getvalue(), mtime=0)


def verify_metadata(members):
    for section in MEMBERS[1:]:
        entries = tar_entries(members[section], section)
        paths = {entry.name for entry, _ in entries}
        required = {'control'} if section == 'control.tar.gz' else {APP, PACKAGE, APP + '/helper'}
        if not required.issubset(paths) or (section == 'data.tar.gz' and
                any(not entry.isdir() for entry, _ in entries if entry.name in required)):
            raise ValueError('Missing package directories or control metadata')
        for entry, _ in entries:
            mode = 0o755 if entry.isdir() or entry.name == APP + '/helper-startup.py' else 0o644
            if entry.name in SHARED:
                raise ValueError('Do not package shared ancestor attributes: ' + entry.name)
            if (entry.uid != 0 or entry.gid != 0 or entry.uname != 'root' or
                    entry.gname != 'root' or entry.mode != mode):
                raise ValueError('Non-root or unsafe package metadata: ' + entry.name)


def normalize(raw):
    members = read_ipk(raw)
    for section in MEMBERS[1:]:
        members[section] = normalized_tar(members[section], section)
    verify_metadata(members)
    return write_ipk(members)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--normalize', action='store_true', help='Rewrite build-host metadata atomically')
    parser.add_argument('ipk', type=Path)
    args = parser.parse_args()
    raw = args.ipk.read_bytes()
    if args.normalize:
        raw = normalize(raw)
        # Complete validation before replacing the build output. No TV or source
        # files are changed, and no elevated build privileges are required.
        with tempfile.NamedTemporaryFile(dir=args.ipk.parent, delete=False) as stream:
            temporary = Path(stream.name)
            try:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            except BaseException:
                temporary.unlink()
                raise
        try:
            os.replace(temporary, args.ipk)
        finally:
            temporary.unlink(missing_ok=True)
    verify_metadata(read_ipk(raw))
    print('Verified root-owned IPK files and directories, without shared ancestor entries.')


if __name__ == '__main__':
    main()
