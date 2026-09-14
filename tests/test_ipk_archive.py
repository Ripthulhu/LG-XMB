# SPDX-License-Identifier: GPL-3.0-or-later
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from ipk_archive import APP, normalize_file, normalize_permissions, read_ipk, write_ipk
spec = importlib.util.spec_from_file_location('verify_helper_package', ROOT / 'tools/verify-helper-package.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def tar_bytes(entries):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w:gz') as archive:
        for entry, payload in entries:
            archive.addfile(entry, io.BytesIO(payload) if entry.isfile() else None)
    return result.getvalue()


def entry(name, payload=b'', mode=0o644, directory=False):
    info = tarfile.TarInfo(name)
    info.mode = mode
    info.type = tarfile.DIRTYPE if directory else tarfile.REGTYPE
    info.size = len(payload)
    return info, payload


def package(helper_mode=0o777, extra=()):
    manifest = (ROOT / 'app/appinfo.json').read_bytes()
    bundle = {'schema': 1, 'appinfoSha256': hashlib.sha256(manifest).hexdigest(), 'files': {}}
    entries = [entry('usr', mode=0o777, directory=True),
               entry(APP, mode=0o755, directory=True),
               entry(APP + '/helper', mode=helper_mode, directory=True),
               entry(APP + '/appinfo.json', manifest),
               entry(APP + '/helper-startup.py', (ROOT / 'app/helper-startup.py').read_bytes(), mode=0o755)]
    for name, path in verifier.SOURCES.items():
        payload = (ROOT / path).read_bytes()
        entries.append(entry(APP + '/helper/' + name, payload))
        bundle['files'][name] = hashlib.sha256(payload).hexdigest()
    bundle_bytes = json.dumps(bundle).encode()
    entries.append(entry(APP + '/helper/bundle.json', bundle_bytes))
    startup = (ROOT / 'app/helper-startup.py').read_bytes().replace(
        b'@BUNDLE_SHA256@', hashlib.sha256(bundle_bytes).hexdigest().encode())
    entries[4] = entry(APP + '/helper-startup.py', startup, mode=0o755)
    return write_ipk({'debian-binary': b'2.0\n',
                      'control.tar.gz': tar_bytes([entry('control', b'Package: fixture\n')]),
                      'data.tar.gz': tar_bytes(entries + list(extra))})


class PackagePermissionsTests(unittest.TestCase):
    def verify(self, raw):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'test.ipk'
            path.write_bytes(raw)
            verifier.verify(path)

    def test_old_0777_helper_directory_fails_actual_package_verification(self):
        with self.assertRaisesRegex(ValueError, 'directory permissions'):
            self.verify(package())

    def test_normalized_package_passes_exact_source_and_directory_checks(self):
        self.verify(normalize_permissions(package()))

    def test_only_app_owned_metadata_changes_and_all_payloads_survive(self):
        before = read_ipk(package())
        after = read_ipk(normalize_permissions(package()))
        self.assertEqual(before['control.tar.gz'], after['control.tar.gz'])
        def inventory(raw):
            with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
                return {item.name: (item.mode, item.uid, item.gid,
                        archive.extractfile(item).read() if item.isfile() else b'') for item in archive}
        old, new = inventory(before['data.tar.gz']), inventory(after['data.tar.gz'])
        self.assertEqual(old.keys(), new.keys())
        self.assertEqual(old['usr'], new['usr'], 'Never chmod shared TV ancestors via the archive')
        for name in old:
            self.assertEqual(old[name][3], new[name][3], name)
        self.assertEqual(new[APP + '/helper'][:3], (0o755, 0, 0))

    def test_non_root_packaged_owner_is_rejected(self):
        raw = read_ipk(package(helper_mode=0o755))
        with tarfile.open(fileobj=io.BytesIO(raw['data.tar.gz']), mode='r:gz') as archive:
            entries = [(item, archive.extractfile(item).read() if item.isfile() else b'') for item in archive]
        entries[2][0].uid = 1001
        raw['data.tar.gz'] = tar_bytes(entries)
        with self.assertRaisesRegex(ValueError, 'not packaged as root'):
            self.verify(write_ipk(raw))
        self.verify(normalize_permissions(write_ipk(raw)))

    def test_normalizer_refuses_links_special_files_and_traversal(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE):
            info, _ = entry(APP + '/foreign')
            info.type, info.linkname = kind, '/etc/passwd'
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                normalize_permissions(package(extra=[(info, b'')]))
        with self.assertRaises(ValueError):
            normalize_permissions(package(extra=[entry('../foreign')]))

    def test_normalizer_refuses_duplicate_paths_and_install_hooks(self):
        with self.assertRaises(ValueError):
            normalize_permissions(package(extra=[entry(APP + '/helper', directory=True)]))
        members = read_ipk(package())
        members['control.tar.gz'] = tar_bytes([entry('control'), entry('postinst', b'exit 0')])
        with self.assertRaisesRegex(ValueError, 'control metadata'):
            normalize_permissions(write_ipk(members))

    def test_existing_temporary_file_is_not_removed_or_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'test.ipk'
            original = package()
            path.write_bytes(original)
            pending = path.with_suffix('.ipk.tmp')
            pending.write_bytes(b'other build')
            with self.assertRaises(FileExistsError):
                normalize_file(path)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(pending.read_bytes(), b'other build')

    def test_normalizer_rejects_bad_or_truncated_archives(self):
        for raw in (b'', b'not an ipk', package()[:-9]):
            with self.assertRaises((ValueError, EOFError)):
                normalize_permissions(raw)


if __name__ == '__main__':
    unittest.main()
