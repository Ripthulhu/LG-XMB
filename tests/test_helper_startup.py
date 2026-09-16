# SPDX-License-Identifier: GPL-3.0-or-later
import copy
import hashlib
import importlib.util
import io
from contextlib import redirect_stdout
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
        self.music = self.root / 'media/internal/lg-xmb'
        self.music.parent.mkdir(parents=True)
        self.legacy = self.root / 'openxmb-c5'
        self.log = self.root / 'webosbrew'
        self.log.mkdir()
        self.cache = str(self.root / 'cache')
        self.old_cache = str(self.root / 'old-cache')
        self.owners = {}
        self.chowns = []
        # Model root ownership without requiring a privileged test runner. Only
        # host ancestors (such as /tmp) lose their writable bits; fixture file
        # modes, types and link counts remain real and are exercised below.
        def metadata(fd):
            info = os.fstat(fd)
            values = {name: getattr(info, name) for name in dir(info) if name.startswith('st_')}
            target = Path(os.readlink('/proc/self/fd/' + str(fd)))
            values['st_uid'], values['st_gid'] = self.owners.get(target, (0, 0))
            if target in self.root.parents:
                values['st_mode'] &= ~0o022
            return SimpleNamespace(**values)
        os_view = SimpleNamespace(**vars(os))
        os_view.fstat = metadata
        def named_metadata(*args, **kwargs):
            info = os.stat(*args, **kwargs)
            values = {name: getattr(info, name) for name in dir(info) if name.startswith('st_')}
            target = Path(args[0])
            if kwargs.get('dir_fd') is not None:
                target = Path(os.readlink('/proc/self/fd/' + str(kwargs['dir_fd']))) / target
            values['st_uid'], values['st_gid'] = self.owners.get(target, (0, 0))
            return SimpleNamespace(**values)
        os_view.stat = named_metadata
        def change_owner(fd, uid, gid):
            target = Path(os.readlink('/proc/self/fd/' + str(fd)))
            self.chowns.append((target, uid, gid))
            self.owners[target] = (uid, gid)
        os_view.fchown = change_owner
        os_view.geteuid = lambda: 0
        self.patches = patch.multiple(startup, os=os_view, APP_DIR=str(self.app), BASE=str(self.base), MUSIC_DIR=str(self.music),
            LEGACY_BASE=str(self.legacy), CACHE=self.cache, LEGACY_CACHE=self.old_cache,
            LOG_DIR=str(self.log), BUNDLE_SHA256='fixture')
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
        (self.app / 'helper-startup.py').write_text('#!/bin/sh\nexit 0\n')
        (self.app / 'helper-startup.py').chmod(0o755)
        for name in startup.FILES:
            (self.bundle / name).write_text('# fixture\n')
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
                    'files': {name: digest((self.bundle / name).read_bytes()) for name in startup.FILES}}
        (self.bundle / 'bundle.json').write_text(json.dumps(manifest))
        startup.BUNDLE_SHA256 = digest((self.bundle / 'bundle.json').read_bytes())

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

    def test_optional_music_path_is_created_without_a_track(self):
        result, _ = self.run_setup()
        self.assertTrue(result['ready'])
        self.assertEqual(os.readlink(self.app / 'user-music.mp3'), str(self.music / 'background.mp3'))
        self.assertTrue(self.music.is_dir())
        self.assertFalse((self.music / 'background.mp3').exists())
        self.assertEqual(stat.S_IMODE(self.music.stat().st_mode), 0o755)

    def test_music_survives_link_loss_and_repeated_upgrade_preparation(self):
        self.run_setup()
        track = self.music / 'background.mp3'
        track.write_bytes(b'user owned recording fixture')
        before = (track.stat().st_ino, track.read_bytes())
        (self.app / 'user-music.mp3').unlink()  # installer replaced the app tree
        self.run_setup()
        self.run_setup()
        self.assertEqual((track.stat().st_ino, track.read_bytes()), before)
        self.assertEqual((self.app / 'user-music.mp3').read_bytes(), before[1])

    def test_conflicting_music_file_does_not_disable_helper_or_get_overwritten(self):
        link = self.app / 'user-music.mp3'
        link.write_bytes(b'keep me')
        result, _ = self.run_setup()
        self.assertTrue(result['ready'])
        self.assertEqual(link.read_bytes(), b'keep me')
        self.assertIn('music_path_unavailable', (self.log / startup.LOG_NAME).read_text())

    def test_foreign_music_link_is_not_followed_or_replaced(self):
        outside = self.root / 'outside'
        outside.write_bytes(b'not music')
        (self.app / 'user-music.mp3').symlink_to(outside)
        result, _ = self.run_setup()
        self.assertTrue(result['ready'])
        self.assertEqual(os.readlink(self.app / 'user-music.mp3'), str(outside))
        self.assertEqual(outside.read_bytes(), b'not music')

    def test_symlinked_music_directory_is_not_followed_and_is_nonfatal(self):
        self.base.mkdir()
        outside = self.root / 'outside-dir'
        outside.mkdir()
        self.music.symlink_to(outside)
        result, _ = self.run_setup()
        self.assertTrue(result['ready'])
        self.assertEqual(list(outside.iterdir()), [])
        self.assertFalse(os.path.lexists(self.app / 'user-music.mp3'))

    def test_legacy_music_link_is_repointed_without_moving_or_overwriting_tracks(self):
        legacy = self.base / 'music/background.mp3'
        legacy.parent.mkdir(parents=True)
        legacy.write_bytes(b'old private track')
        self.music.mkdir()
        current = self.music / 'background.mp3'
        current.write_bytes(b'existing public track')
        before = [(p.stat().st_ino, p.read_bytes()) for p in (legacy, current)]
        (self.app / 'user-music.mp3').symlink_to(legacy)
        self.run_setup()
        self.assertEqual(os.readlink(self.app / 'user-music.mp3'), str(current))
        self.assertEqual([(p.stat().st_ino, p.read_bytes()) for p in (legacy, current)], before)
        self.assertFalse(list(self.app.glob('.user-music-*')))

    def test_unavailable_media_storage_is_optional_and_does_not_create_private_music(self):
        self.music.parent.rmdir()
        result, _ = self.run_setup()
        self.assertTrue(result['ready'])
        self.assertFalse((self.base / 'music').exists())
        self.assertIn('music_path_unavailable', (self.log / startup.LOG_NAME).read_text())

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
        (self.bundle / 'thumbnail_cache.py').unlink()
        with self.assertRaisesRegex(startup.SetupError, 'bundle_incomplete'):
            self.run_setup()
        self.assertFalse((self.base / 'background.json').exists())
        self.assertFalse((self.base / 'installed.json').exists())

    def test_changed_bundle_bytes_are_rejected(self):
        (self.bundle / 'thumbnail_cache.py').write_text('# changed bytes\n')
        with self.assertRaisesRegex(startup.SetupError, 'helper_bundle_mismatch'):
            self.run_setup()
        self.assertFalse((self.base / 'background.json').exists())
        self.assertFalse((self.base / 'installed.json').exists())

    def test_changed_app_manifest_is_rejected(self):
        (self.app / 'appinfo.json').write_text('{"id":"foreign"}')
        with self.assertRaisesRegex(startup.SetupError, 'untrusted_app_manifest'):
            self.run_setup()
        self.assertFalse((self.base / 'background.json').exists())
        self.assertFalse((self.base / 'installed.json').exists())

    def test_symlinked_bundle_member_is_rejected_without_following_it(self):
        member = self.bundle / 'thumbnail_cache.py'
        member.unlink()
        member.symlink_to('/etc/passwd')
        with self.assertRaises(OSError):
            self.run_setup()

    def test_hardlinked_bundle_member_is_rejected(self):
        member = self.bundle / 'thumbnail_cache.py'
        os.link(member, self.root / 'extra-link')
        with self.assertRaises(startup.SetupError):
            self.run_setup()

    def test_root_owned_writable_bundle_member_is_repaired_not_rejected(self):
        # LG resets this tree to 0777 at boot. Rejecting that left the helper
        # dead until someone chmodded it by hand, and the directory repair below
        # could never run, cause reading the bundle failed first.
        member = self.bundle / 'thumbnail_cache.py'
        member.chmod(0o666)
        self.run_setup()
        self.assertEqual(stat.S_IMODE(member.stat().st_mode), 0o644)

    def test_a_repaired_member_is_still_verified_against_the_build_pin(self):
        # The mode is put back before the read, so the hash stays the thing that
        # decides trust. Tampered bytes are refused whatever the mode says.
        member = self.bundle / 'thumbnail_cache.py'
        member.write_bytes(member.read_bytes() + b'# changed')
        member.chmod(0o666)
        with self.assertRaises(startup.SetupError):
            self.run_setup()

    def test_non_root_reply_is_explicit_and_makes_no_files(self):
        with patch.object(startup.os, 'geteuid', return_value=1000), \
             patch.object(startup.sys, 'argv', ['helper-startup.py', 'ensure']), \
             patch('builtins.print') as output:
            self.assertEqual(startup.main(), 2)
        reply = json.loads(output.call_args.args[0])
        self.assertEqual(reply, {'returnValue': False, 'errorCode': 'root_required', 'effectiveUid': 1000, 'logWritten': False})
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

    def test_busy_setup_has_a_bounded_wait_without_modifying_configuration(self):
        import fcntl
        self.base.mkdir()
        with (self.base / 'setup.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(startup, 'SETUP_WAIT_SECONDS', 0), \
                 patch.object(startup, 'load_bundle') as load, \
                 self.assertRaisesRegex(startup.SetupError, 'setup_in_progress'):
                self.run_setup()
            load.assert_not_called()
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

    def test_worker_detaches_and_does_not_block_setup_logging(self):
        worker = self.bundle / 'thumbnail_cache.py'
        worker.write_text('import os,time\nopen(' + repr(str(self.root / 'session')) + ',"w").write(str(os.getsid(0)))\ntime.sleep(15)\n')
        children = []
        self.base.mkdir()
        setup_lock = os.open(self.base / 'setup.lock', os.O_RDWR | os.O_CREAT, 0o600)
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
                self.assertTrue(startup.record_startup('test_while_worker_runs'))
                descriptors = Path('/proc') / str(children[0].pid) / 'fd'
                paths = [os.readlink(fd) for fd in descriptors.iterdir()]
                self.assertIn(str(self.log / startup.WORKER_LOCK_NAME), paths)
                self.assertNotIn(str(self.base / 'setup.lock'), paths,
                                 'A live worker must not retain the short-lived setup lock')
                with self.assertRaisesRegex(startup.SetupError, 'worker_lock_busy'):
                    startup.launch_worker(recovery)
            self.assertEqual(len(children), 1)
        finally:
            os.close(setup_lock)
            for child in children:
                child.terminate()
                child.wait(timeout=3)

    def main_reply(self):
        output = io.StringIO()
        with patch.object(startup.sys, 'argv', ['helper-startup.py', 'ensure']), redirect_stdout(output):
            result = startup.main()
        return result, json.loads(output.getvalue())

    def log_records(self):
        return [json.loads(line) for line in (self.log / startup.LOG_NAME).read_text().splitlines()]

    def test_root_owned_writable_directory_is_repaired_after_bundle_verification(self):
        self.bundle.chmod(0o777)
        self.run_setup()
        self.assertEqual(stat.S_IMODE(self.bundle.stat().st_mode), 0o755)
        self.assertEqual(self.log_records()[-1]['event'], 'helper_directory_repaired')
        self.assertEqual(self.chowns, [])

    def test_ownership_mismatch_is_reported_distinctly_without_chown(self):
        original = startup.os.fstat
        def metadata(fd):
            info = original(fd)
            if Path(os.readlink('/proc/self/fd/' + str(fd))) == self.bundle:
                info.st_uid = 1001
            return info
        with patch.object(startup.os, 'fstat', side_effect=metadata), patch.object(startup.os, 'chown') as chown:
            code, reply = self.main_reply()
        self.assertEqual(reply['errorCode'], 'helper_owner_mismatch')
        self.assertEqual(self.log_records()[-1]['uid'], 1001)
        chown.assert_not_called()
        self.assertFalse((self.base / 'background.json').exists())
        self.assertFalse((self.base / 'installed.json').exists())

    def test_missing_bundle_logs_without_a_running_capture_worker(self):
        shutil.rmtree(self.bundle)
        code, reply = self.main_reply()
        self.assertEqual(code, 2)
        self.assertEqual(reply['errorCode'], 'bundle_incomplete')
        self.assertTrue(reply['logWritten'])
        self.assertEqual(self.log_records()[-1]['exception'], 'FileNotFoundError')

    def test_logs_are_created_on_first_failure_and_remain_private_and_bounded(self):
        self.log.rmdir()
        for index in range(200):
            self.assertTrue(startup.record_startup('fixture', sequence=index))
        log = self.log / startup.LOG_NAME
        self.assertLessEqual(log.stat().st_size, startup.LOG_LIMIT)
        self.assertEqual(stat.S_IMODE(log.stat().st_mode), 0o600)
        self.assertEqual(self.log_records()[-1]['sequence'], 199)

    def test_exception_payloads_are_not_logged(self):
        try:
            raise ValueError('secret native reply or saved configuration')
        except ValueError as error:
            self.assertTrue(startup.record_startup('fixture_failure', error))
        text = (self.log / startup.LOG_NAME).read_text()
        self.assertNotIn('secret', text)
        self.assertIn('ValueError', text)
        self.assertIn('test_exception_payloads_are_not_logged', text)

    def test_foreign_log_paths_are_not_followed_or_replaced(self):
        target = self.root / 'foreign-log'
        target.write_text('keep')
        log = self.log / startup.LOG_NAME
        log.symlink_to(target)
        self.assertFalse(startup.record_startup('fixture'))
        self.assertEqual(target.read_text(), 'keep')
        (self.bundle / 'thumbnail_cache.py').write_text('# bad bytes')
        _, reply = self.main_reply()
        self.assertFalse(reply['logWritten'])
        self.assertEqual(reply['errorCode'], 'helper_bundle_mismatch')
        self.assertTrue(log.is_symlink())

    def test_logging_failure_does_not_mask_setup_failure(self):
        (self.bundle / 'thumbnail_cache.py').write_text('# bad bytes')
        with patch.object(startup.os, 'write', side_effect=OSError('disk full')):
            code, reply = self.main_reply()
        self.assertEqual(code, 2)
        self.assertEqual(reply['errorCode'], 'helper_bundle_mismatch')
        self.assertFalse(reply['logWritten'])

    def set_legacy_owner(self):
        self.owners[self.bundle] = (1001, 1001)
        self.bundle.chmod(0o777)
        self.app.chmod(0o777)

    def test_reported_upgrade_shape_is_recovered_without_changing_payloads(self):
        self.set_legacy_owner()
        before = {p.name: p.read_bytes() for p in self.bundle.iterdir()}
        parent_mode = self.root.stat().st_mode
        self.base.mkdir()
        saved = dict(self.config, revision=4, saved={'home': {'enabled': True}})
        raw = (json.dumps(saved) + '\n').encode()
        (self.base / 'background.json').write_bytes(raw)
        result, launch = self.run_setup()
        self.assertTrue(result['ready'])
        self.assertEqual(self.chowns, [(self.bundle, 0, 0)])
        self.assertEqual(self.owners[self.bundle], (0, 0))
        self.assertEqual(stat.S_IMODE(self.bundle.stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE(self.app.stat().st_mode), 0o755)
        self.assertEqual(self.root.stat().st_mode, parent_mode)
        self.assertEqual({p.name: p.read_bytes() for p in self.bundle.iterdir()}, before)
        self.assertEqual((self.base / 'background.json').read_bytes(), raw)
        launch.assert_called_once()
        event = self.log_records()[-1]
        self.assertEqual((event['event'], event['fromUid'], event['fromGid']),
                         ('helper_directory_repaired', 1001, 1001))
        self.run_setup()
        self.assertEqual(self.chowns, [(self.bundle, 0, 0)], 'Repeat setup must not chown again')

    def test_unrecognized_directory_owners_are_not_adopted(self):
        for owner in [(1000, 1000), (1001, 0), (1002, 1001)]:
            with self.subTest(owner=owner), patch.object(startup, 'load_module') as load:
                self.owners[self.bundle] = owner
                with self.assertRaisesRegex(startup.SetupError, 'helper_owner_mismatch'):
                    startup.load_bundle()
                load.assert_not_called()
        self.assertEqual(self.chowns, [])

    def test_known_uid_is_not_sufficient_when_payload_bytes_are_changed(self):
        self.set_legacy_owner()
        (self.bundle / 'thumbnail_cache.py').write_text('# changed')
        with patch.object(startup, 'load_module') as load:
            with self.assertRaisesRegex(startup.SetupError, 'helper_bundle_mismatch'):
                startup.load_bundle()
        load.assert_not_called()
        self.assertEqual(self.chowns, [])
        self.assertEqual(stat.S_IMODE(self.app.stat().st_mode), 0o777)
        self.assertEqual(stat.S_IMODE(self.bundle.stat().st_mode), 0o777)

    def test_helper_cannot_self_approve_new_payload_hashes(self):
        self.set_legacy_owner()
        member = self.bundle / 'thumbnail_cache.py'
        member.write_text('# changed')
        manifest = self.bundle / 'bundle.json'
        data = json.loads(manifest.read_text())
        data['files'][member.name] = digest(member.read_bytes())
        manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(startup.SetupError, 'helper_bundle_mismatch'):
            startup.load_bundle()
        self.assertEqual(self.chowns, [])

    def test_foreign_owned_or_writable_members_are_not_repaired(self):
        self.set_legacy_owner()
        member = self.bundle / 'thumbnail_cache.py'
        self.owners[member] = (1001, 1001)
        with self.assertRaises(startup.SetupError):
            startup.load_bundle()
        self.owners[member] = (0, 0)
        member.chmod(0o666)
        with self.assertRaises(startup.SetupError):
            startup.load_bundle()
        self.assertEqual(self.chowns, [])

    def test_legacy_directory_with_extra_entries_is_not_adopted(self):
        self.set_legacy_owner()
        extra = self.bundle / 'foreign-file'
        extra.write_text('keep')
        with self.assertRaisesRegex(startup.SetupError, 'unexpected_helper_files'):
            startup.load_bundle()
        self.assertEqual(self.chowns, [])
        self.assertEqual(extra.read_text(), 'keep')

    def test_symlinked_legacy_directory_is_never_followed(self):
        self.set_legacy_owner()
        target = self.app / 'foreign'
        self.bundle.rename(target)
        self.bundle.symlink_to(target)
        with self.assertRaises(OSError):
            startup.load_bundle()
        self.assertEqual(self.chowns, [])

    def test_legacy_directory_lock_conflict_does_not_modify_state(self):
        self.set_legacy_owner()
        import fcntl
        fd = os.open(self.bundle, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(startup.SetupError, 'bundle_lock_busy'):
                startup.load_bundle()
        finally:
            os.close(fd)
        self.assertEqual(self.chowns, [])
        self.assertEqual(stat.S_IMODE(self.bundle.stat().st_mode), 0o777)

    def test_failed_owner_repair_never_imports_code(self):
        self.set_legacy_owner()
        with patch.object(startup.os, 'fchown'), patch.object(startup, 'load_module') as load:
            with self.assertRaisesRegex(startup.SetupError, 'helper_permissions_failed'):
                startup.load_bundle()
        load.assert_not_called()

    def test_failed_mode_repair_never_imports_code(self):
        self.set_legacy_owner()
        with patch.object(startup.os, 'fchmod'), patch.object(startup, 'load_module') as load:
            with self.assertRaisesRegex(startup.SetupError, 'helper_permissions_failed'):
                startup.load_bundle()
        load.assert_not_called()

    def test_changed_bytes_during_owner_repair_are_rejected(self):
        self.set_legacy_owner()
        change_owner = startup.os.fchown
        def changed(fd, uid, gid):
            change_owner(fd, uid, gid)
            (self.bundle / 'thumbnail_cache.py').write_text('# changed mid-repair')
        with patch.object(startup.os, 'fchown', side_effect=changed), patch.object(startup, 'load_module') as load:
            with self.assertRaisesRegex(startup.SetupError, 'helper_bundle_mismatch'):
                startup.load_bundle()
        load.assert_not_called()

    def test_directory_replacement_during_repair_is_rejected(self):
        self.set_legacy_owner()
        chmod = startup.os.fchmod
        def replaced(fd, mode):
            chmod(fd, mode)
            if Path(os.readlink('/proc/self/fd/' + str(fd))) == self.app:
                self.bundle.rename(self.app / 'old-helper')
                self.bundle.mkdir()
        with patch.object(startup.os, 'fchmod', side_effect=replaced), patch.object(startup, 'load_module') as load:
            with self.assertRaisesRegex(startup.SetupError, 'helper_path_changed'):
                startup.load_bundle()
        self.assertEqual(self.chowns, [])
        load.assert_not_called()

    def test_verified_root_owned_directory_does_not_trigger_repair(self):
        with patch.object(startup, 'repair_helper_directory') as repair:
            self.run_setup()
        repair.assert_not_called()


    def test_existing_unlocked_setup_file_is_not_a_busy_helper(self):
        self.base.mkdir()
        lock = self.base / 'setup.lock'
        lock.write_text('old setup file')
        identity = (lock.stat().st_dev, lock.stat().st_ino)
        result, _ = self.run_setup()
        self.assertTrue(result['ready'])
        self.assertEqual((lock.stat().st_dev, lock.stat().st_ino), identity)
        self.assertEqual(lock.read_text(), 'old setup file')

    def test_replaced_setup_lock_cannot_authorize_setup(self):
        self.base.mkdir()
        lock = self.base / 'setup.lock'
        lock.touch()
        directory = os.open(self.base, os.O_RDONLY | os.O_DIRECTORY)
        descriptor = os.open(lock, os.O_RDWR)
        try:
            lock.rename(self.base / 'old.lock')
            lock.touch()
            with self.assertRaisesRegex(startup.SetupError, 'setup_lock_changed'):
                startup.acquire_setup_lock(directory, descriptor)
        finally:
            os.close(descriptor)
            os.close(directory)
        self.assertFalse((self.base / 'background.json').exists())

    def test_reused_worker_does_not_rewrite_installation_record(self):
        self.run_setup()
        record = self.base / 'installed.json'
        before = (record.read_bytes(), record.stat().st_ino, record.stat().st_mtime_ns)
        self.recovery.find_helpers = lambda: [(12, 34, self.recovery.HELPER)]
        result, launch = self.run_setup()
        self.assertTrue(result['captureRunning'])
        launch.assert_not_called()
        self.assertEqual((record.read_bytes(), record.stat().st_ino, record.stat().st_mtime_ns), before)
        self.assertEqual(self.log_records()[-1]['event'], 'worker_reused')

    def test_foreign_or_duplicate_workers_are_never_reused(self):
        self.run_setup()
        for workers in [[(12, 34, b'/foreign.py')],
                        [(12, 34, self.recovery.HELPER), (13, 35, self.recovery.HELPER)]]:
            with self.subTest(workers=workers), patch.object(startup, 'load_module', side_effect=self.modules), \
                 patch.object(startup, 'launch_worker') as launch:
                self.recovery.find_helpers = lambda: workers
                with self.assertRaisesRegex(startup.SetupError, 'unexpected_helper_process'):
                    startup.start()
                launch.assert_not_called()

    def concurrent_setup(self, upgrade=False, fail_first=False):
        # Real independent processes and flock, but inert native operations. The
        # worker marker models only a verified worker; launch identity is covered
        # separately by recovery tests and the detached-worker test above.
        import multiprocessing
        context = multiprocessing.get_context('fork')
        started, waiting, release = (context.Event() for _ in range(3))
        marker = self.root / 'worker.fixture'
        launches = self.root / 'launches.fixture'
        stops = self.root / 'stops.fixture'
        if upgrade:
            self.run_setup()
            (self.bundle / 'thumbnail_cache.py').write_text('# upgraded fixture\n')
            self.update_manifest()
        saved = (self.base / 'background.json').read_bytes() if upgrade else None
        def stop(**kwargs):
            if not kwargs.get('legacy_only'):
                with stops.open('a') as file:
                    file.write('stop\n')
        self.recovery.stop = stop
        self.recovery.find_helpers = lambda: [(12, 34, self.recovery.HELPER)] if marker.exists() else []
        def child(connection, first):
            record = startup.record_startup
            def record_event(event, *args, **kwargs):
                if event == 'setup_waiting':
                    waiting.set()
                return record(event, *args, **kwargs)
            def launch(recovery):
                started.set()
                if first:
                    if not release.wait(5):
                        raise RuntimeError('fixture release timed out')
                    if fail_first:
                        raise startup.SetupError('fixture_start_failure')
                with launches.open('a') as file:
                    file.write('launch\n')
                marker.touch()
                return True
            try:
                with patch.object(startup, 'load_module', side_effect=self.modules), \
                     patch.object(startup, 'launch_worker', side_effect=launch), \
                     patch.object(startup, 'record_startup', side_effect=record_event), \
                     patch.object(startup, 'SETUP_WAIT_SECONDS', 4):
                    connection.send(startup.start())
            except Exception as error:
                connection.send({'error': str(error)})
            finally:
                connection.close()
        processes, readers = [], []
        try:
            for first in (True, False):
                reader, writer = context.Pipe(duplex=False)
                process = context.Process(target=child, args=(writer, first))
                process.start()
                writer.close()
                processes.append(process)
                readers.append(reader)
                if first:
                    self.assertTrue(started.wait(3), 'First setup must hold the lock')
            self.assertTrue(waiting.wait(3), 'Second setup must actually encounter the held lock')
            self.assertFalse(readers[1].poll(), 'Contender must wait rather than return Busy/success')
            release.set()
            results = []
            for reader, process in zip(readers, processes):
                self.assertTrue(reader.poll(6), 'Setup must terminate within the bounded fixture wait')
                results.append(reader.recv())
                process.join(timeout=2)
                self.assertEqual(process.exitcode, 0)
            expected = {'returnValue': True, 'ready': True, 'captureRunning': True}
            self.assertEqual(results, [{'error': 'fixture_start_failure'} if fail_first else expected, expected])
            self.assertEqual(launches.read_text(), 'launch\n')
            self.assertEqual(stops.read_text(), 'stop\n' * (2 if fail_first else 1))
            if saved is not None:
                self.assertEqual((self.base / 'background.json').read_bytes(), saved)
            events = [entry['event'] for entry in self.log_records()]
            self.assertIn('setup_waiting', events)
            self.assertIn('setup_resumed', events)
            self.assertEqual('worker_reused' in events, not fail_first)
        finally:
            release.set()
            for process in processes:
                if process.is_alive():
                    process.terminate()
                process.join(timeout=2)
            for reader in readers:
                reader.close()

    def test_simultaneous_clean_setups_start_one_worker_and_both_succeed(self):
        self.concurrent_setup()

    def test_simultaneous_upgrade_setups_restart_once_and_preserve_settings(self):
        self.concurrent_setup(upgrade=True)

    def test_waiter_revalidates_after_an_unsuccessful_owner_instead_of_assuming_ready(self):
        self.concurrent_setup(fail_first=True)


if __name__ == '__main__':
    unittest.main()
