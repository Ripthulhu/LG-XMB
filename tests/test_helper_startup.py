# SPDX-License-Identifier: GPL-3.0-or-later
import importlib.util
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / "app" / "helper-startup.py"
spec = importlib.util.spec_from_file_location("helper_startup", SOURCE)
startup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(startup)
REAL_FSTAT = os.fstat
REAL_POPEN = subprocess.Popen


def root_info(info):
    return SimpleNamespace(st_mode=info.st_mode, st_uid=0, st_nlink=info.st_nlink)


class StartupTests(unittest.TestCase):
    def use_patch(self, context):
        value = context.start()
        self.addCleanup(context.stop)
        return value

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app, self.base, self.logs = [self.root / name for name in ("app", "helper", "logs")]
        for directory in (self.app, self.base, self.logs):
            directory.mkdir(mode=0o755)
        (self.app / "appinfo.json").write_text('{}\n')
        for name in ("thumbnail-cache.py", "process-control.py"):
            (self.base / name).write_text('# fixture\n')
        for name, value in (("APP_DIR", str(self.app)), ("BASE", str(self.base)),
                            ("LOG_DIR", str(self.logs)), ("PYTHON", sys.executable)):
            self.use_patch(patch.object(startup, name, value))
        # Fixtures need no root privileges. Production directory traversal is
        # tested separately; these descriptors refer only to our temporary tree.
        self.directories = {str(p) for p in (self.app, self.base, self.logs)}
        def open_fixture(path, app_path=False):
            self.assertIn(path, self.directories)
            return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.use_patch(patch.object(startup, "open_directory", side_effect=open_fixture))
        self.use_patch(patch.object(startup.os, "geteuid", return_value=0))
        self.use_patch(patch.object(startup.os, "fstat", side_effect=lambda fd: root_info(REAL_FSTAT(fd))))
        self.spawn = self.use_patch(patch.object(startup.subprocess, "Popen"))

    def test_root_required(self):
        with patch.object(startup.os, "geteuid", return_value=1000):
            with self.assertRaises(RuntimeError):
                startup.start()
        self.spawn.assert_not_called()

    def test_absent_app_creates_nothing(self):
        (self.app / "appinfo.json").unlink()
        self.app.rmdir()
        self.assertEqual(startup.start(), 0)
        self.assertEqual(list(self.logs.iterdir()), [])
        self.spawn.assert_not_called()

    def test_missing_manifest_creates_nothing(self):
        (self.app / "appinfo.json").unlink()
        self.assertEqual(startup.start(), 0)
        self.spawn.assert_not_called()
        self.assertEqual(list(self.logs.iterdir()), [])

    def test_manifest_symlink_is_not_followed(self):
        manifest = self.app / "appinfo.json"
        manifest.unlink()
        manifest.symlink_to(self.base / "process-control.py")
        with self.assertRaises(OSError):
            startup.start()
        self.spawn.assert_not_called()

    def test_missing_helper_does_not_start(self):
        (self.base / "process-control.py").unlink()
        with self.assertRaises(FileNotFoundError):
            startup.start()
        self.spawn.assert_not_called()
        self.assertEqual(list(self.logs.iterdir()), [])

    def test_writable_helper_is_refused(self):
        (self.base / "thumbnail-cache.py").chmod(0o666)
        with self.assertRaises(RuntimeError):
            startup.start()
        self.spawn.assert_not_called()

    def test_helper_symlink_is_refused(self):
        helper = self.base / "thumbnail-cache.py"
        helper.unlink()
        helper.symlink_to(self.base / "process-control.py")
        with self.assertRaises(OSError):
            startup.start()
        self.spawn.assert_not_called()

    def test_log_symlink_cannot_overwrite_target(self):
        target = self.root / "keep"
        target.write_text('do not overwrite\n')
        (self.logs / startup.LOG_NAME).symlink_to(target)
        with self.assertRaises(OSError):
            startup.start()
        self.assertEqual(target.read_text(), 'do not overwrite\n')
        self.spawn.assert_not_called()

    def test_log_hardlink_cannot_overwrite_target(self):
        target = self.root / "keep"
        target.write_text('do not overwrite\n')
        os.link(target, self.logs / startup.LOG_NAME)
        with self.assertRaises(RuntimeError):
            startup.start()
        self.assertEqual(target.read_text(), 'do not overwrite\n')
        self.spawn.assert_not_called()

    def test_log_fifo_cannot_hang_startup(self):
        os.mkfifo(self.logs / startup.LOG_NAME)
        with self.assertRaises(OSError):
            startup.start()
        self.spawn.assert_not_called()

    def test_start_uses_fixed_arguments_and_detaches(self):
        self.assertEqual(startup.start(), 0)
        argv = self.spawn.call_args.args[0]
        options = self.spawn.call_args.kwargs
        self.assertEqual(argv, [sys.executable, str(self.base / "thumbnail-cache.py"),
                                "--allow-home-preview", "--process-controls"])
        self.assertTrue(options['start_new_session'])
        self.assertTrue(options['close_fds'])
        self.assertEqual(options['stdin'], subprocess.DEVNULL)
        self.assertEqual(options['stdout'], subprocess.DEVNULL)
        self.assertEqual(options['stderr'], subprocess.DEVNULL)
        self.assertEqual(len(options['pass_fds']), 1)
        self.assertIn('starting C5 helper', (self.logs / startup.LOG_NAME).read_text())

    def test_spawn_failure_is_logged(self):
        self.spawn.side_effect = FileNotFoundError()
        with self.assertRaises(FileNotFoundError):
            startup.start()
        self.assertIn('could not launch', (self.logs / startup.LOG_NAME).read_text())

    def test_child_holds_log_lock_without_blocking_boot(self):
        (self.base / "thumbnail-cache.py").write_text('import time\ntime.sleep(30)\n')
        children = []
        def spawn(*args, **kwargs):
            child = REAL_POPEN(*args, **kwargs)
            children.append(child)
            return child
        self.spawn.side_effect = spawn
        try:
            self.assertEqual(startup.start(), 0)
            self.assertIsNone(children[0].poll())
            log = self.logs / startup.LOG_NAME
            before = log.read_bytes()
            self.assertEqual(startup.start(), 0)
            self.assertEqual(self.spawn.call_count, 1)
            self.assertEqual(log.read_bytes(), before)
        finally:
            for child in children:
                child.terminate()
                child.wait(timeout=5)
        # A stopped worker releases the lock; a later start replaces old output.
        (self.logs / startup.LOG_NAME).write_text('old boot\n' * 100)
        self.spawn.side_effect = None
        self.assertEqual(startup.start(), 0)
        self.assertNotIn('old boot', (self.logs / startup.LOG_NAME).read_text())

    def test_boot_reset_app_modes_are_left_to_pinned_worker_check(self):
        (self.app / "appinfo.json").chmod(0o666)
        self.assertEqual(startup.start(), 0)
        self.assertEqual(stat.S_IMODE((self.app / "appinfo.json").stat().st_mode), 0o666)


class PathChecks(unittest.TestCase):
    def test_file_identity_rejects_foreign_owner_and_extra_links(self):
        for mode, uid, links in ((stat.S_IFREG | 0o644, 1000, 1),
                                  (stat.S_IFREG | 0o644, 0, 2),
                                  (stat.S_IFIFO | 0o600, 0, 1)):
            with self.subTest(mode=mode, uid=uid, links=links), self.assertRaises(RuntimeError):
                startup.regular_file(SimpleNamespace(st_mode=mode, st_uid=uid, st_nlink=links))

    def test_directory_symlink_is_never_followed(self):
        with tempfile.TemporaryDirectory() as root:
            link = Path(root) / 'link'
            link.symlink_to('/')
            with patch.object(startup.os, "fstat", side_effect=lambda fd: root_info(REAL_FSTAT(fd))):
                with self.assertRaises(OSError):
                    startup.open_directory(str(link), app_path=True)

    def test_writable_shared_directory_is_refused(self):
        with patch.object(startup.os, "fstat", return_value=SimpleNamespace(st_uid=0, st_mode=0o777)):
            with self.assertRaises(RuntimeError):
                startup.open_directory('/tmp')


if __name__ == "__main__":
    unittest.main()
