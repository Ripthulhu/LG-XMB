# SPDX-License-Identifier: GPL-3.0-or-later
"""Real filesystem identity checks in an isolated Linux root fixture."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

import thumbnail_cache as tc


LINUX_ROOT = sys.platform.startswith("linux") and hasattr(os, "geteuid") and os.geteuid() == 0


@unittest.skipUnless(LINUX_ROOT, "Requires Linux root ownership checks")
class HomePreviewIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lg-xmb-preview-", dir="/root")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.developer = self.root / "developer"
        self.payload = self.root / "payload"
        self.developer.mkdir(mode=0o755)
        self.payload.mkdir(mode=0o755)
        app = {"id": tc.HOME_ID, "type": "web", "main": "index.html", "version": "fixture"}
        self.manifest = json.dumps(app).encode()
        (self.developer / "appinfo.json").write_bytes(self.manifest)
        (self.payload / "appinfo.json").write_text(json.dumps(dict(app, id=tc.STOCK_HOME_ID)))
        for name in tc.HOME_IDENTITY_FILES:
            for directory in (self.developer, self.payload):
                (directory / name).write_text("matching fixture: " + name)
        # A bind mount presents precisely the payload's device/inode through
        # the second path. Use that same directory without requiring CAP_SYS_ADMIN.
        for name, value in (("APP_DIR", str(self.developer)),
                            ("HOME_PAYLOAD_DIR", str(self.payload)),
                            ("HOME_MOUNT_DIR", str(self.payload)),
                            ("PIN_APPINFO_SHA256", hashlib.sha256(self.manifest).hexdigest())):
            context = patch.object(tc, name, value)
            context.start()
            self.addCleanup(context.stop)

    def test_matching_mounted_payload_has_stable_identity(self):
        first = tc.checked_home_preview()
        self.assertEqual(first, tc.checked_home_preview())
        self.assertTrue(first)

    def test_boot_reset_developer_reference_modes_are_read_without_repair(self):
        paths = [self.developer / name for name in tc.HOME_IDENTITY_FILES]
        for path in paths:
            path.chmod(0o777)
        before = [(path.read_bytes(), path.stat()) for path in paths]
        identity = tc.checked_home_preview()
        self.assertEqual(identity, tc.checked_home_preview())
        for path, (data, info) in zip(paths, before):
            self.assertEqual(path.read_bytes(), data)
            current = path.stat()
            self.assertEqual((current.st_mode, current.st_uid, current.st_ino, current.st_ctime_ns),
                             (info.st_mode, info.st_uid, info.st_ino, info.st_ctime_ns))

    def test_writable_developer_reference_still_requires_matching_bytes(self):
        path = self.developer / "helper-startup.py"
        path.chmod(0o777)
        path.write_text("different installed code")
        with self.assertRaisesRegex(tc.SafeError, "identity_mismatch"):
            tc.checked_home_preview()

    def test_writable_developer_reference_rejects_symlink_hardlink_and_owner(self):
        path = self.developer / "index.html"
        path.chmod(0o777)
        saved = self.developer / "saved.html"
        path.rename(saved)
        path.symlink_to(saved)
        with self.assertRaises(tc.SafeError):
            tc.checked_home_preview()
        path.unlink()
        os.link(saved, path)
        with self.assertRaisesRegex(tc.SafeError, "unsafe_home_preview_reference"):
            tc.checked_home_preview()
        path.unlink()
        saved.rename(path)
        os.chown(path, 1001, 1001)
        with self.assertRaisesRegex(tc.SafeError, "unsafe_home_preview_reference"):
            tc.checked_home_preview()

    def test_payload_files_and_developer_manifest_must_remain_nonwritable(self):
        for path in ([self.payload / name for name in tc.HOME_IDENTITY_FILES] +
                     [self.payload / "appinfo.json", self.developer / "appinfo.json"]):
            with self.subTest(path=path):
                path.chmod(0o777)
                with self.assertRaises(tc.SafeError):
                    tc.checked_home_preview()
                path.chmod(0o644)

    def test_writable_developer_reference_changed_during_read_is_rejected(self):
        path = self.developer / "index.html"
        path.chmod(0o777)
        inode = path.stat().st_ino
        original_read = os.read
        changed = False
        def changing_read(fd, size):
            nonlocal changed
            if not changed and os.fstat(fd).st_ino == inode:
                changed = True
                path.write_text("changed during identity read")
            return original_read(fd, size)
        with patch.object(tc.os, "read", side_effect=changing_read):
            with self.assertRaisesRegex(tc.SafeError, "identity_changed"):
                tc.checked_home_preview()

    def test_writable_developer_reference_changed_during_capture_is_discarded(self):
        from test_thumbnail_cache import FakeCache, FakeLuna, fixture
        path = self.developer / "index.html"
        path.chmod(0o777)
        cache = FakeCache()
        luna = FakeLuna(fixture(app_id=tc.STOCK_HOME_ID))
        now = [0]
        worker = tc.Worker(luna, cache, installed=lambda: True, clock=lambda: now[0],
                           ensure_link=lambda: None, allow_home=True)
        self.assertTrue(worker.step())
        luna.on_capture = lambda: path.write_text("changed during capture")
        now[0] = tc.SETTLE_SECONDS
        self.assertTrue(worker.step())
        self.assertEqual(len(luna.captures), 1)
        self.assertFalse(cache.published)
        self.assertFalse(cache.temporary)

    def test_stock_unmounted_or_foreign_home_is_refused(self):
        stock = self.root / "stock"
        shutil.copytree(self.payload, stock)
        with patch.object(tc, "HOME_MOUNT_DIR", str(stock)):
            with self.assertRaisesRegex(tc.SafeError, "not_mounted"):
                tc.checked_home_preview()
        with patch.object(tc, "HOME_MOUNT_DIR", str(self.root / "absent")):
            with self.assertRaises(tc.SafeError):
                tc.checked_home_preview()

    def test_payload_requires_pinned_developer_manifest_and_matching_code(self):
        for directory in (self.developer, self.payload):
            for name in ("appinfo.json",) + tc.HOME_IDENTITY_FILES:
                path = directory / name
                original = path.read_bytes()
                path.write_bytes(original + b"changed")
                with self.subTest(directory=directory.name, name=name):
                    with self.assertRaises(tc.SafeError):
                        tc.checked_home_preview()
                path.write_bytes(original)

    def test_changed_manifest_identity_or_version_is_refused(self):
        path = self.payload / "appinfo.json"
        original = json.loads(path.read_bytes())
        for key, value in (("id", "org.other"), ("type", "native"),
                           ("main", "other.html"), ("version", "old")):
            with self.subTest(key=key):
                path.write_text(json.dumps(dict(original, **{key: value})))
                with self.assertRaisesRegex(tc.SafeError, "identity_mismatch"):
                    tc.checked_home_preview()

    def test_replacing_equal_file_or_payload_changes_the_token(self):
        first = tc.checked_home_preview()
        path = self.payload / "index.html"
        replacement = self.payload / "replacement.html"
        replacement.write_bytes(path.read_bytes())
        replacement.replace(path)
        second = tc.checked_home_preview()
        self.assertNotEqual(first, second)
        replacement_payload = self.root / "replacement"
        shutil.copytree(self.payload, replacement_payload)
        self.payload.rename(self.root / "previous")
        replacement_payload.rename(self.payload)
        self.assertNotEqual(second, tc.checked_home_preview())

    def test_symlink_writable_or_nonroot_identity_is_refused(self):
        path = self.payload / "index.html"
        saved = self.payload / "saved.html"
        path.rename(saved)
        path.symlink_to(saved)
        with self.assertRaises(tc.SafeError):
            tc.checked_home_preview()
        path.unlink()
        saved.rename(path)
        path.chmod(0o666)
        with self.assertRaises(tc.SafeError):
            tc.checked_home_preview()
        path.chmod(0o644)
        os.chown(path, 1001, 1001)
        with self.assertRaises(tc.SafeError):
            tc.checked_home_preview()

    def test_symlink_or_writable_payload_directory_is_refused(self):
        alias = self.root / "alias"
        alias.symlink_to(self.payload)
        with patch.object(tc, "HOME_PAYLOAD_DIR", str(alias)):
            with self.assertRaises(tc.SafeError):
                tc.checked_home_preview()
        self.payload.chmod(0o777)
        with self.assertRaises(tc.SafeError):
            tc.checked_home_preview()

    def test_payload_replaced_during_verification_is_refused(self):
        read = tc.read_preview_identity
        replaced = False
        def replace(directory, name, *args, **kwargs):
            nonlocal replaced
            result = read(directory, name, *args, **kwargs)
            if not replaced:
                replaced = True
                self.payload.rename(self.root / "previous")
                shutil.copytree(self.root / "previous", self.payload)
            return result
        with patch.object(tc, "read_preview_identity", side_effect=replace):
            with self.assertRaisesRegex(tc.SafeError, "path_changed"):
                tc.checked_home_preview()


if __name__ == "__main__":
    unittest.main()
