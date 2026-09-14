# SPDX-License-Identifier: GPL-3.0-or-later
"""Exercise the packaged controller and permission-repair refusal paths."""
import os
import stat
import unittest
from unittest.mock import patch

import test_helper_startup as fixtures


class InstalledBundleTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.SetupFixture()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setUp()
        self.startup = fixtures.startup

    def test_real_controller_loads_with_reset_installed_modes(self):
        f = self.fixture
        (f.app / 'appinfo.json').write_bytes((fixtures.ROOT / 'app/appinfo.json').read_bytes())
        sources = {'process_control.py': 'tv-helper/process_control.py',
                   'thumbnail_cache.py': 'tv-helper/thumbnail_cache.py',
                   'stop_thumbnail_helper.py': 'tv-helper/recovery/stop_thumbnail_helper.py'}
        for name, relative in sources.items():
            (f.bundle / name).write_bytes((fixtures.ROOT / relative).read_bytes())
        f.update_manifest()
        paths = [f.app, f.bundle, f.app / 'appinfo.json', f.bundle / 'bundle.json']
        paths += [f.bundle / name for name in sources]
        for path in paths:
            path.chmod(0o777)
        original = self.startup.load_module

        def load(name, raw, path):
            module = original(name, raw, path)
            if name == 'lg_xmb_control':
                module.os = self.startup.os
                module.APPINFO = str(f.app / 'appinfo.json')
            return module

        with patch.object(self.startup, 'load_module', side_effect=load):
            control, _, pin = self.startup.load_bundle()
        self.assertEqual(pin, self.startup.BUNDLE_SHA256)
        self.assertFalse(any(control.default_config()['enabled'].values()))
        self.assertFalse(f.base.exists(), 'Validation does not create background state')
        for path in paths:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o755 if path.is_dir() else 0o644)

    def test_failed_chmod_cannot_import_modules(self):
        self.fixture.bundle.chmod(0o777)
        with patch.object(self.startup.os, 'fchmod'), patch.object(self.startup, 'load_module') as load:
            with self.assertRaisesRegex(self.startup.SetupError, 'helper_permissions_not_confirmed'):
                self.startup.load_bundle()
        load.assert_not_called()

    def test_preexisting_writer_cannot_change_bytes_during_repair(self):
        member = self.fixture.bundle / 'process_control.py'
        member.chmod(0o777)
        original = self.startup.os.fchmod
        with member.open('r+b') as writer:
            def changed(fd, mode):
                original(fd, mode)
                writer.seek(0)
                writer.write(b'# changed')
                writer.flush()
            with patch.object(self.startup.os, 'fchmod', side_effect=changed), \
                 patch.object(self.startup, 'load_module') as load:
                with self.assertRaisesRegex(self.startup.SetupError, 'helper_bundle_mismatch'):
                    self.startup.load_bundle()
        load.assert_not_called()

    def test_fifo_is_rejected_without_blocking(self):
        member = self.fixture.bundle / 'process_control.py'
        member.unlink()
        os.mkfifo(member)
        with patch.object(self.startup, 'load_module') as load:
            with self.assertRaises(self.startup.SetupError):
                self.startup.load_bundle()
        load.assert_not_called()

    def test_symlinked_helper_directory_is_not_followed(self):
        f = self.fixture
        moved = f.app / 'moved'
        f.bundle.rename(moved)
        f.bundle.symlink_to(moved)
        with patch.object(self.startup, 'load_module') as load:
            with self.assertRaises(OSError):
                self.startup.load_bundle()
        load.assert_not_called()

    def test_unlisted_file_is_not_chmodded(self):
        extra = self.fixture.bundle / 'not-in-bundle'
        extra.write_text('preserve')
        extra.chmod(0o666)
        self.fixture.bundle.chmod(0o777)
        with patch.object(self.startup, 'load_module', side_effect=self.fixture.modules):
            self.startup.load_bundle()
        self.assertEqual(stat.S_IMODE(extra.stat().st_mode), 0o666)
        self.assertEqual(extra.read_text(), 'preserve')


if __name__ == '__main__':
    unittest.main()
