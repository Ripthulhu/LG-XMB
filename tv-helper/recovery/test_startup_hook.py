# SPDX-License-Identifier: GPL-3.0-or-later
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import stop_thumbnail_helper as recovery

REAL_STAT, REAL_FSTAT = os.stat, os.fstat
LEGACY = Path(__file__).parent / "fixtures" / "60-openxmb-thumbnails.legacy"


def root_info(info):
    fields = ('st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    return SimpleNamespace(st_uid=0, **{name: getattr(info, name) for name in fields})


class StartupHookTests(unittest.TestCase):
    def use_patch(self, context):
        value = context.start()
        self.addCleanup(context.stop)
        return value

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app, self.init = self.root / 'app', self.root / 'init.d'
        self.app.mkdir(); self.init.mkdir()
        self.target = self.app / 'helper-startup.py'
        self.target.write_text('#!/bin/sh\necho invoked\n')
        self.target.chmod(0o755)
        self.hook = self.init / recovery.HOOK_NAME
        self.fd = os.open(self.init, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, self.fd)
        self.use_patch(patch.object(recovery, 'HOOK_TARGET', str(self.target)))
        self.use_patch(patch.object(recovery.os, 'stat', side_effect=lambda *a, **kw: root_info(REAL_STAT(*a, **kw))))
        self.use_patch(patch.object(recovery.os, 'fstat', side_effect=lambda fd: root_info(REAL_FSTAT(fd))))

    def test_live_link_removal_preserves_target(self):
        self.hook.symlink_to(self.target)
        snapshot = recovery.read_hook(self.fd)
        recovery.remove_hook(self.fd, snapshot)
        self.assertFalse(os.path.lexists(self.hook))
        self.assertEqual(self.target.read_text(), '#!/bin/sh\necho invoked\n')

    def test_dangling_link_is_removed_without_opening_target(self):
        self.hook.symlink_to(self.target)
        shutil.rmtree(self.app)
        with patch.object(recovery.os, 'open', side_effect=AssertionError('must not follow link')):
            recovery.remove_hook(self.fd, recovery.read_hook(self.fd))
        self.assertFalse(os.path.lexists(self.hook))

    def test_missing_hook_is_idempotent(self):
        self.assertIsNone(recovery.read_hook(self.fd))
        recovery.remove_hook(self.fd, None)
        recovery.remove_hook(self.fd, None)
        self.assertTrue(self.target.exists())

    def test_known_legacy_copy_can_be_migrated(self):
        self.hook.write_bytes(LEGACY.read_bytes())
        recovery.remove_hook(self.fd, recovery.read_hook(self.fd))
        self.hook.symlink_to(self.target)
        self.assertEqual(recovery.read_hook(self.fd)[1], str(self.target))

    def test_crlf_legacy_copy_is_still_recognized(self):
        self.hook.write_bytes(LEGACY.read_bytes().replace(b'\n', b'\r\n'))
        recovery.remove_hook(self.fd, recovery.read_hook(self.fd))
        self.assertFalse(os.path.lexists(self.hook))

    def test_unknown_regular_file_is_not_removed(self):
        self.hook.write_text('#!/bin/sh\necho foreign\n')
        with self.assertRaisesRegex(RuntimeError, 'contents differ'):
            recovery.read_hook(self.fd)
        self.assertTrue(self.hook.exists())

    def test_writable_legacy_copy_is_refused(self):
        self.hook.write_bytes(LEGACY.read_bytes())
        self.hook.chmod(0o777)
        with self.assertRaisesRegex(RuntimeError, 'unsafe'):
            recovery.read_hook(self.fd)

    def test_hardlinked_legacy_copy_is_refused(self):
        self.hook.write_bytes(LEGACY.read_bytes())
        os.link(self.hook, self.root / 'other')
        with self.assertRaisesRegex(RuntimeError, 'unsafe'):
            recovery.read_hook(self.fd)

    def test_fifo_is_refused_before_opening(self):
        os.mkfifo(self.hook)
        with patch.object(recovery.os, 'open', side_effect=AssertionError('must not open FIFO')):
            with self.assertRaisesRegex(RuntimeError, 'unsafe'):
                recovery.read_hook(self.fd)

    def test_other_link_targets_are_not_removed(self):
        for target in (str(self.root / 'other'), '../app/helper-startup.py',
                       str(self.app) + '/../app/helper-startup.py'):
            with self.subTest(target=target):
                self.hook.symlink_to(target)
                with self.assertRaisesRegex(RuntimeError, 'another file'):
                    recovery.read_hook(self.fd)
                self.assertTrue(os.path.lexists(self.hook))
                self.hook.unlink()

    def test_nonroot_link_is_refused(self):
        self.hook.symlink_to(self.target)
        def foreign(*args, **kwargs):
            info = root_info(REAL_STAT(*args, **kwargs)); info.st_uid = 1000
            return info
        with patch.object(recovery.os, 'stat', side_effect=foreign):
            with self.assertRaisesRegex(RuntimeError, 'unsafe'):
                recovery.read_hook(self.fd)

    def test_link_replaced_before_removal_is_left_untouched(self):
        self.hook.symlink_to(self.target)
        snapshot = recovery.read_hook(self.fd)
        self.hook.unlink(); self.hook.symlink_to(self.root / 'other')
        with self.assertRaises(RuntimeError):
            recovery.remove_hook(self.fd, snapshot)
        self.assertEqual(os.readlink(self.hook), str(self.root / 'other'))

    def test_link_replaced_during_inspection_is_rejected(self):
        self.hook.symlink_to(self.target)
        def changed(*args, **kwargs):
            self.hook.unlink(); self.hook.write_text('replacement')
            return str(self.target)
        with patch.object(recovery.os, 'readlink', side_effect=changed):
            with self.assertRaisesRegex(RuntimeError, 'changed'):
                recovery.read_hook(self.fd)

    def test_copy_changed_after_inspection_is_not_removed(self):
        self.hook.write_bytes(LEGACY.read_bytes())
        snapshot = recovery.read_hook(self.fd)
        self.hook.write_text('changed')
        with self.assertRaises(RuntimeError):
            recovery.remove_hook(self.fd, snapshot)
        self.assertEqual(self.hook.read_text(), 'changed')

    @unittest.skipUnless(shutil.which('run-parts'), 'run-parts is not installed')
    def test_run_parts_skips_the_link_after_app_removal(self):
        self.hook.symlink_to(self.target)
        command = ['run-parts', str(self.init)]
        before = subprocess.run(command, check=True, capture_output=True, text=True, timeout=3)
        self.assertEqual(before.stdout.strip(), 'invoked')
        shutil.rmtree(self.app)
        after = subprocess.run(command, capture_output=True, text=True, timeout=3)
        self.assertEqual(after.stdout, '')
        self.assertEqual(after.returncode, 0)
        self.assertTrue(os.path.lexists(self.hook))
        recovery.remove_hook(self.fd, recovery.read_hook(self.fd))

    def test_main_removes_link_before_signalling_and_preserves_state(self):
        self.hook.symlink_to(self.target)
        config = self.root / 'background.json'; config.write_text('saved choices')
        identity = (123, 42, b'fixture')
        def stopped(value):
            self.assertEqual(value, identity)
            self.assertFalse(os.path.lexists(self.hook))
            return True
        # main owns this separate descriptor; the fixture keeps its own open.
        fd = os.dup(self.fd)
        with patch.object(recovery.os, 'geteuid', return_value=0), \
             patch.object(recovery, 'inspect_hook', return_value=(fd, recovery.read_hook(fd))), \
             patch.object(recovery, 'find_helpers', side_effect=[[identity], []]), \
             patch.object(recovery, 'process_identity', return_value=None), \
             patch.object(recovery, 'stop_one', side_effect=stopped), \
             patch('builtins.print'):
            recovery.main()
        self.assertEqual(config.read_text(), 'saved choices')
        self.assertTrue(self.target.exists())


if __name__ == '__main__':
    unittest.main()
