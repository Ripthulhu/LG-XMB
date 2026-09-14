# SPDX-License-Identifier: GPL-3.0-or-later
import copy
import hashlib
import importlib.util
import io
import contextlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('startup', ROOT / 'app/helper-startup.py')
startup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(startup)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


class SetupFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / 'app'
        self.bundle = self.app / 'helper'
        self.bundle.mkdir(parents=True)
        self.base = self.root / 'lg-xmb'
        self.legacy = self.root / 'openxmb-c5'
        self.log = self.root / 'webosbrew'
        self.log.mkdir()
        self.cache = str(self.root / 'cache')
        self.old_cache = str(self.root / 'old-cache')
        # Model root ownership without requiring a privileged test runner. Only
        # host ancestors (such as /tmp) lose their writable bits; fixture file
        # modes, types and link counts remain real and are exercised below.
        def metadata(fd):
            info = os.fstat(fd)
            values = {name: getattr(info, name) for name in dir(info) if name.startswith('st_')}
            values['st_uid'] = 0
            target = Path(os.readlink('/proc/self/fd/' + str(fd)))
            if target in self.root.parents:
                values['st_mode'] &= ~0o022
            return SimpleNamespace(**values)
        os_view = SimpleNamespace(**vars(os))
        os_view.fstat = metadata
        def named_metadata(*args, **kwargs):
            info = os.stat(*args, **kwargs)
            values = {name: getattr(info, name) for name in dir(info) if name.startswith('st_')}
            values['st_uid'] = 0
            return SimpleNamespace(**values)
        os_view.stat = named_metadata
        os_view.geteuid = lambda: 0
        self.patches = patch.multiple(startup, os=os_view, APP_DIR=str(self.app), BASE=str(self.base),
            LEGACY_BASE=str(self.legacy), CACHE=self.cache, LEGACY_CACHE=self.old_cache,
            LOG_DIR=str(self.log))
        self.patches.start()
        self.addCleanup(self.patches.stop)
        # Real file metadata and byte checks; no TV services or processes.
        self.config = {'schema': 1, 'revision': 0, 'enabled': {'home': False}, 'saved': {}}
        self.control = SimpleNamespace(PIN_APPINFO_SHA256='', checked_app=lambda: None,
            default_config=lambda: copy.deepcopy(self.config), valid_config=self.validate_config)
        self.stops = []
        self.recovery = SimpleNamespace(HOOK_NAME='60-lg-xmb', HOOK_TARGET=str(self.app / 'helper-startup.py'),
            HELPER=str(self.bundle / 'thumbnail_cache.py').encode(),
            stop=lambda **kw: self.stops.append(kw), find_helpers=lambda: [],
            helper_argument=lambda raw: raw, read_hook=self.read_hook)
        (self.app / 'appinfo.json').write_bytes(b'{"id":"org.local.openxmb.c5"}\n')
        self.template = b'#!/usr/bin/python3\nBUNDLE_SHA256 = "@BUNDLE_SHA256@"\n'
        (self.app / 'helper-startup.py').write_bytes(self.template)
        (self.app / 'helper-startup.py').chmod(0o755)
        for name in startup.FILES:
            (self.bundle / name).write_text('# fixture\n')
        self.addCleanup(setattr, startup, "BUNDLE_SHA256", startup.BUNDLE_SHA256)
        self.update_manifest()

    @staticmethod
    def validate_config(value):
        if not isinstance(value, dict) or value.get('schema') != 1 or not isinstance(value.get('saved'), dict):
            raise ValueError('bad fixture config')
        return value

    def read_hook(self, directory):
        try:
            meta = os.stat('60-lg-xmb', dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            return None
        if not stat.S_ISLNK(meta.st_mode) or os.readlink('60-lg-xmb', dir_fd=directory) != self.recovery.HOOK_TARGET:
            raise startup.SetupError('startup_hook_conflict')
        return (meta.st_ino,), self.recovery.HOOK_TARGET

    def update_manifest(self):
        self.control.PIN_APPINFO_SHA256 = digest((self.app / 'appinfo.json').read_bytes())
        manifest = {'schema': 1, 'appinfoSha256': self.control.PIN_APPINFO_SHA256,
                    'startupSha256': digest(self.template),
                    'files': {name: digest((self.bundle / name).read_bytes()) for name in startup.FILES}}
        raw = json.dumps(manifest).encode()
        (self.bundle / 'bundle.json').write_bytes(raw)
        startup.BUNDLE_SHA256 = digest(raw)
        (self.app / 'helper-startup.py').write_bytes(self.template.replace(b'@BUNDLE_SHA256@', digest(raw).encode()))

    def modules(self, name, raw, path):
        return self.control if name == 'lg_xmb_control' else self.recovery

    def run_setup(self, running=True):
        with patch.object(startup, 'load_module', side_effect=self.modules), \
             patch.object(startup, 'launch_worker', return_value=running) as launch:
            result = startup.start()
        return result, launch

    def test_clean_install_without_old_helper_creates_safe_config_and_app_owned_links(self):
        result, launch = self.run_setup()
        self.assertTrue(result['ready'])
        self.assertTrue(result['captureRunning'])
        self.assertEqual(json.loads((self.base / 'background.json').read_text()), self.config)
        self.assertEqual(stat.S_IMODE((self.base / 'background.json').stat().st_mode), 0o600)
        self.assertEqual(os.readlink(self.app / 'thumbnails'), self.cache)
        self.assertEqual(os.readlink(self.log / 'init.d/60-lg-xmb'), self.recovery.HOOK_TARGET)
        self.assertFalse(self.legacy.exists())
        self.assertFalse((self.base / 'thumbnail-cache.py').exists())
        launch.assert_called_once()

    def test_existing_settings_and_rollback_values_migrate_byte_for_byte(self):
        self.legacy.mkdir()
        raw = b'{"schema":1,"revision":9,"enabled":{"home":true},"saved":{"home":{"enabled":true,"permanentRestore":true}}}\n'
        (self.legacy / 'background.json').write_bytes(raw)
        self.run_setup()
        self.assertEqual((self.base / 'background.json').read_bytes(), raw)
        self.assertEqual((self.legacy / 'background.json').read_bytes(), raw)
        self.assertEqual(self.stops[0], {'legacy_only': True})

    def test_migration_receipt_does_not_reimport_stale_legacy_choices(self):
        self.legacy.mkdir()
        (self.legacy / 'background.json').write_text(json.dumps(self.config))
        self.run_setup()
        current = dict(self.config, revision=10)
        (self.base / 'background.json').write_text(json.dumps(current))
        self.run_setup()
        self.assertEqual(json.loads((self.base / 'background.json').read_text()), current)

    def test_different_existing_configs_are_preserved_and_reported(self):
        self.base.mkdir()
        self.legacy.mkdir()
        (self.base / 'background.json').write_text(json.dumps(self.config))
        (self.legacy / 'background.json').write_text(json.dumps(dict(self.config, revision=8)))
        before = [(p / 'background.json').read_bytes() for p in (self.base, self.legacy)]
        with self.assertRaisesRegex(startup.SetupError, 'legacy_config_conflict'):
            self.run_setup()
        self.assertEqual([(p / 'background.json').read_bytes() for p in (self.base, self.legacy)], before)

    def test_invalid_config_is_not_reset(self):
        self.base.mkdir()
        (self.base / 'background.json').write_text('{"invalid":true}')
        with self.assertRaises(ValueError):
            self.run_setup()
        self.assertEqual((self.base / 'background.json').read_text(), '{"invalid":true}')

    def test_old_thumbnail_link_is_migrated_without_deleting_pictures(self):
        target = Path(self.old_cache)
        target.mkdir()
        (target / 'hdmi1.png').write_bytes(b'keep')
        (self.app / 'thumbnails').symlink_to(target)
        self.run_setup()
        self.assertEqual(os.readlink(self.app / 'thumbnails'), self.cache)
        self.assertEqual((target / 'hdmi1.png').read_bytes(), b'keep')

    def test_foreign_thumbnail_path_is_preserved(self):
        (self.app / 'thumbnails').symlink_to(self.root / 'foreign')
        with self.assertRaisesRegex(startup.SetupError, 'foreign_thumbnail_path'):
            self.run_setup()
        self.assertEqual(os.readlink(self.app / 'thumbnails'), str(self.root / 'foreign'))

    def test_foreign_startup_hook_is_preserved(self):
        (self.log / 'init.d').mkdir()
        (self.log / 'init.d/60-lg-xmb').symlink_to('/another/script')
        with self.assertRaisesRegex(startup.SetupError, 'startup_hook_conflict'):
            self.run_setup()
        self.assertEqual(os.readlink(self.log / 'init.d/60-lg-xmb'), '/another/script')

    def test_matching_running_worker_is_not_restarted(self):
        self.run_setup()
        self.stops.clear()
        self.recovery.find_helpers = lambda: [(12, 34, self.recovery.HELPER)]
        result, launch = self.run_setup()
        self.assertTrue(result['captureRunning'])
        launch.assert_not_called()
        self.assertEqual(self.stops, [{'legacy_only': True}])

    def test_bundle_upgrade_stops_previous_generation_and_preserves_config(self):
        self.run_setup()
        raw = (self.base / 'background.json').read_bytes()
        self.stops.clear()
        (self.bundle / 'thumbnail_cache.py').write_text('# next reviewed fixture\n')
        self.update_manifest()
        self.run_setup()
        self.assertEqual(self.stops, [{'legacy_only': True}, {}])
        self.assertEqual((self.base / 'background.json').read_bytes(), raw)

    def test_capture_start_failure_does_not_disable_on_demand_home_controls(self):
        result, _ = self.run_setup(running=False)
        self.assertTrue(result['ready'])
        self.assertFalse(result['captureRunning'])

    def test_missing_bundle_never_launches_or_initializes_config(self):
        (self.bundle / 'process_control.py').unlink()
        with self.assertRaisesRegex(startup.SetupError, 'bundle_incomplete'):
            self.run_setup()
        self.assertFalse(self.base.exists())

    def test_changed_bundle_bytes_are_rejected(self):
        (self.bundle / 'process_control.py').write_text('# changed bytes\n')
        with self.assertRaisesRegex(startup.SetupError, 'helper_bundle_mismatch'):
            self.run_setup()
        self.assertFalse(self.base.exists())

    def test_changed_app_manifest_is_rejected(self):
        (self.app / 'appinfo.json').write_text('{"id":"foreign"}')
        with self.assertRaisesRegex(startup.SetupError, 'untrusted_app_manifest'):
            self.run_setup()
        self.assertFalse(self.base.exists())

    def test_symlinked_bundle_member_is_rejected_without_following_it(self):
        member = self.bundle / 'process_control.py'
        member.unlink()
        member.symlink_to('/etc/passwd')
        with self.assertRaises(OSError):
            self.run_setup()

    def test_hardlinked_bundle_member_is_rejected(self):
        member = self.bundle / 'process_control.py'
        os.link(member, self.root / 'extra-link')
        with self.assertRaises(startup.SetupError):
            self.run_setup()

    def test_verified_installed_modes_are_repaired_without_touching_ancestors(self):
        paths = [self.app, self.bundle] + list(self.bundle.iterdir()) + [
            self.app / 'appinfo.json', self.app / 'helper-startup.py']
        for path in paths:
            path.chmod(0o777)
        before = self.root.stat().st_mode
        result, _ = self.run_setup()
        self.assertTrue(result['ready'])
        for path in paths:
            expected = 0o755 if path.is_dir() or path.name == 'helper-startup.py' else 0o644
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), expected, path)
        self.assertEqual(self.root.stat().st_mode, before)

    def test_changed_payload_and_rewritten_bundle_cannot_authorize_mode_repair(self):
        member = self.bundle / 'process_control.py'
        self.bundle.chmod(0o777)
        member.chmod(0o666)
        member.write_text('# substituted payload')
        manifest = json.loads((self.bundle / 'bundle.json').read_text())
        manifest['files']['process_control.py'] = digest(member.read_bytes())
        (self.bundle / 'bundle.json').write_text(json.dumps(manifest))
        with patch.object(startup, 'load_module') as load:
            with self.assertRaisesRegex(startup.SetupError, 'helper_bundle_mismatch'):
                startup.start()
        load.assert_not_called()
        self.assertEqual(stat.S_IMODE(self.bundle.stat().st_mode), 0o777)
        self.assertEqual(stat.S_IMODE(member.stat().st_mode), 0o666)
        self.assertFalse(self.base.exists())

    def test_non_root_owned_bundle_is_refused_not_chowned(self):
        metadata = startup.os.fstat
        def foreign(fd):
            info = metadata(fd)
            if Path(os.readlink('/proc/self/fd/' + str(fd))) == self.bundle:
                info.st_uid = 1000
            return info
        with patch.object(startup.os, 'fstat', side_effect=foreign):
            with self.assertRaisesRegex(startup.SetupError, 'helper_owner_mismatch'):
                self.run_setup()
        self.assertFalse(self.base.exists())

    def test_byte_change_during_chmod_is_refused_before_import(self):
        self.bundle.chmod(0o777)
        chmod = os.fchmod
        def changed(fd, mode):
            chmod(fd, mode)
            if Path(os.readlink('/proc/self/fd/' + str(fd))) == self.bundle:
                (self.bundle / 'process_control.py').write_text('# changed during repair')
        with patch.object(startup.os, 'fchmod', side_effect=changed), patch.object(startup, 'load_module') as load:
            with self.assertRaisesRegex(startup.SetupError, 'helper_bundle_mismatch'):
                startup.start()
        load.assert_not_called()

    def test_member_replacement_during_repair_is_refused(self):
        self.bundle.chmod(0o777)
        chmod = os.fchmod
        def replaced(fd, mode):
            chmod(fd, mode)
            if Path(os.readlink('/proc/self/fd/' + str(fd))) == self.bundle:
                member = self.bundle / 'process_control.py'
                raw = member.read_bytes()
                member.unlink()
                member.write_bytes(raw)
        with patch.object(startup.os, 'fchmod', side_effect=replaced), patch.object(startup, 'load_module') as load:
            with self.assertRaisesRegex(startup.SetupError, 'helper_path_changed'):
                startup.start()
        load.assert_not_called()

    def test_early_failure_creates_private_log_before_state_or_worker(self):
        (self.bundle / 'process_control.py').unlink()
        with self.assertRaises(startup.SetupError):
            self.run_setup()
        log = self.log / startup.LOG_NAME
        rows = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertEqual(rows[-1]['stage'], 'verify_bundle')
        self.assertEqual(rows[-1]['code'], 'bundle_incomplete')
        self.assertTrue(rows[-1]['trace'])
        self.assertEqual(stat.S_IMODE(log.stat().st_mode), 0o600)
        self.assertFalse(self.base.exists())

    def test_log_is_bounded_and_does_not_store_exception_payloads(self):
        log = startup.SetupLog()
        try:
            for _ in range(1000):
                log.record('verify_bundle', ValueError('private native reply'))
            raw = (self.log / startup.LOG_NAME).read_bytes()
            self.assertLessEqual(len(raw), 8192)
            self.assertNotIn(b'private native reply', raw)
        finally:
            log.close()
        self.run_setup()
        self.assertNotIn('ValueError', (self.log / startup.LOG_NAME).read_text())

    def test_foreign_log_symlink_is_never_followed(self):
        other = self.root / 'other'; other.write_text('preserve')
        (self.log / startup.LOG_NAME).symlink_to(other)
        with self.assertRaises(startup.SetupError):
            self.run_setup()
        self.assertEqual(other.read_text(), 'preserve')
        self.assertFalse(self.base.exists())

    def test_previous_worker_log_lock_does_not_block_upgrade(self):
        import fcntl
        old = self.log / startup.LOG_NAME
        old.write_text('old launch record')
        with old.open('r') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result, _ = self.run_setup()
            self.assertTrue(result['ready'])
            self.assertIn('verify_bundle', old.read_text())
            self.assertEqual(stream.read(), 'old launch record')

    def test_busy_setup_does_not_truncate_active_log(self):
        log = startup.SetupLog()
        try:
            before = (self.log / startup.LOG_NAME).read_bytes()
            with self.assertRaisesRegex(startup.SetupError, 'helper_busy'):
                self.run_setup()
            self.assertEqual((self.log / startup.LOG_NAME).read_bytes(), before)
        finally:
            log.close()

    def test_non_root_reply_is_explicit_and_makes_no_files(self):
        with patch.object(startup.os, 'geteuid', return_value=1000), \
             patch.object(startup.sys, 'argv', ['helper-startup.py', 'ensure']), \
             patch('builtins.print') as output:
            self.assertEqual(startup.main(), 2)
        reply = json.loads(output.call_args.args[0])
        self.assertEqual(reply, {'returnValue': False, 'errorCode': 'root_required', 'effectiveUid': 1000})
        self.assertFalse((self.log / startup.LOG_NAME).exists())
        self.assertFalse(self.base.exists())

    def test_old_python_is_not_reported_as_missing_root(self):
        with patch.object(startup.sys, 'version_info', (3, 6, 9)):
            with self.assertRaisesRegex(startup.SetupError, 'python_too_old'):
                startup.start()
        self.assertFalse(self.base.exists())

    def test_symlinked_state_directory_is_not_followed(self):
        self.base.symlink_to(self.root / 'foreign', target_is_directory=True)
        with self.assertRaises(OSError):
            self.run_setup()
        self.assertFalse((self.root / 'foreign').exists())

    def test_duplicate_setup_lock_is_refused_without_overwriting_files(self):
        import fcntl
        self.base.mkdir()
        with (self.base / 'setup.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(startup.SetupError, 'helper_busy'):
                self.run_setup()
        self.assertFalse((self.base / 'background.json').exists())

    def test_app_removal_breaks_boot_link_without_removing_recovery_values(self):
        self.run_setup()
        link = self.log / 'init.d/60-lg-xmb'
        self.assertTrue(link.exists())
        shutil.rmtree(self.app)
        self.assertTrue(link.is_symlink())
        self.assertFalse(link.exists())
        self.assertTrue((self.base / 'background.json').exists())
        if shutil.which('run-parts'):
            result = subprocess.run(['run-parts', '--test', str(self.log / 'init.d')], capture_output=True, text=True)
            self.assertNotIn('60-lg-xmb', result.stdout)

    def test_worker_detaches_and_inherits_only_its_log_lock(self):
        worker = self.bundle / 'thumbnail_cache.py'
        worker.write_text('import os,time\nopen(' + repr(str(self.root / 'session')) + ',"w").write(str(os.getsid(0)))\ntime.sleep(15)\n')
        children = []
        real_popen = subprocess.Popen
        def spawn(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            children.append(child)
            return child
        try:
            recovery = SimpleNamespace(process_identity=lambda pid: (pid, 1, b'fixture'))
            with patch.object(startup.subprocess, 'Popen', side_effect=spawn):
                self.assertTrue(startup.launch_worker(recovery))
                self.assertEqual(int((self.root / 'session').read_text()), children[0].pid)
                with self.assertRaisesRegex(startup.SetupError, 'helper_busy'):
                    startup.launch_worker(recovery)
            self.assertEqual(len(children), 1)
        finally:
            for child in children:
                child.terminate()
                child.wait(timeout=3)


if __name__ == '__main__':
    unittest.main()
