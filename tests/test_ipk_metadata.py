# SPDX-License-Identifier: GPL-3.0-or-later
import copy
import gzip
import io
from pathlib import Path
import sys
import tarfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import ipk_metadata as ipk


def tar_bytes(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.PAX_FORMAT) as archive:
        for info, data in entries:
            archive.addfile(info, io.BytesIO(data) if data is not None else None)
    return gzip.compress(output.getvalue(), mtime=0)


def entry(name, data=None, uid=1001, mode=None):
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE if data is None else tarfile.REGTYPE
    info.size = len(data) if data is not None else 0
    info.uid = info.gid = uid
    info.uname, info.gname = 'runner', 'runner'
    info.mode = mode if mode is not None else (0o777 if data is None else 0o666)
    info.mtime = 1789406691
    return info, data


class PackageMetadataTests(unittest.TestCase):
    def setUp(self):
        self.files = [entry(p) for p in sorted(ipk.SHARED)] + [
            entry(ipk.APP), entry(ipk.PACKAGE), entry(ipk.APP + '/helper'),
            entry(ipk.APP + '/appinfo.json', b'{"id":"org.local.openxmb.c5"}\n'),
            entry(ipk.APP + '/helper-startup.py', b'print("fixture")\n', mode=0o755),
            entry(ipk.APP + '/helper/bundle.json', b'{"schema":1}\n'),
            entry(ipk.APP + '/helper/process_control.py', b'# fixture\n'),
            entry(ipk.PACKAGE + '/packageinfo.json', b'{}\n')]
        self.controls = [entry('control', b'Package: org.local.openxmb.c5\n')]

    def build(self):
        return ipk.write_ipk({'debian-binary': b'2.0\n',
                             'control.tar.gz': tar_bytes(self.controls),
                             'data.tar.gz': tar_bytes(self.files)})

    def test_runner_owned_build_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Non-root'):
            ipk.verify_metadata(ipk.read_ipk(self.build()))

    def test_normalization_preserves_payloads_and_removes_shared_attributes(self):
        members = ipk.read_ipk(ipk.normalize(self.build()))
        ipk.verify_metadata(members)
        result = ipk.tar_entries(members['data.tar.gz'], 'data.tar.gz')
        self.assertEqual({e.name: data for e, data in result if e.isfile()},
                         {e.name: data for e, data in self.files if e.isfile()})
        self.assertFalse(ipk.SHARED & {e.name for e, _ in result})
        for info, data in result:
            self.assertEqual((info.uid, info.gid, info.uname, info.gname), (0, 0, 'root', 'root'))
            expected = 0o755 if data is None or info.name.endswith('/helper-startup.py') else 0o644
            self.assertEqual(info.mode, expected)
        self.assertEqual(ipk.tar_entries(members['control.tar.gz'], 'control.tar.gz')[0][1], self.controls[0][1])

    def test_uid_zero_alone_does_not_hide_a_nonroot_gid_or_name(self):
        clean = ipk.read_ipk(ipk.normalize(self.build()))
        for field, value in [('gid', 1001), ('uname', 'runner'), ('gname', 'runner')]:
            with self.subTest(field=field):
                entries = ipk.tar_entries(clean['data.tar.gz'], 'data.tar.gz')
                setattr(entries[0][0], field, value)
                changed = dict(clean, **{'data.tar.gz': tar_bytes(entries)})
                with self.assertRaisesRegex(ValueError, 'Non-root'):
                    ipk.verify_metadata(changed)

    def test_pax_owner_overrides_cannot_survive_normalization(self):
        self.files[-1][0].pax_headers = {'uid': '1001', 'gid': '1002', 'uname': 'runner'}
        clean = ipk.read_ipk(ipk.normalize(self.build()))
        for info, _ in ipk.tar_entries(clean['data.tar.gz'], 'data.tar.gz'):
            self.assertEqual((info.uid, info.gid), (0, 0))
            self.assertEqual(info.pax_headers, {})

    def test_links_and_special_files_are_refused(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE):
            with self.subTest(kind=kind):
                self.files[-1][0].type = kind
                self.files[-1][0].linkname = '/etc/passwd'
                with self.assertRaisesRegex(ValueError, 'ordinary files'):
                    ipk.normalize(self.build())

    def test_foreign_and_escaping_paths_are_refused(self):
        for name in ('/etc/passwd', '../appinfo.json', ipk.APP + '/../other', 'var/lib/lg-xmb/run.py'):
            with self.subTest(name=name):
                self.files[-1][0].name = name
                with self.assertRaises(ValueError): ipk.normalize(self.build())

    def test_duplicate_paths_are_refused(self):
        self.files.append(copy.deepcopy(self.files[-1]))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            ipk.normalize(self.build())

    def test_signed_or_scripted_control_archives_are_refused(self):
        for name in ('postinst', 'data.tar.gz.sha256.txt', 'certificate.pem'):
            with self.subTest(name=name):
                self.controls = [entry(name, b'not a supported control file')]
                with self.assertRaisesRegex(ValueError, 'Unsupported control'):
                    ipk.normalize(self.build())

    def test_extra_ar_members_are_refused(self):
        raw = self.build()
        members = ipk.read_ipk(raw)
        extra = ipk.write_ipk(members)[8:72]
        with self.assertRaises(ValueError): ipk.read_ipk(raw + extra)

    def test_corrupt_or_truncated_ar_is_refused(self):
        raw = self.build()
        for bad in (b'bad', raw[:-3], raw[:58] + b'x' + raw[59:]):
            with self.subTest(length=len(bad)), self.assertRaises(ValueError):
                ipk.normalize(bad)

    def test_normalization_is_idempotent(self):
        clean = ipk.normalize(self.build())
        self.assertEqual(ipk.normalize(clean), clean)

    def test_missing_app_directories_are_refused(self):
        self.files = [(e, d) for e, d in self.files if e.name != ipk.APP + '/helper']
        with self.assertRaisesRegex(ValueError, 'Missing package'):
            ipk.normalize(self.build())


if __name__ == '__main__':
    unittest.main()
