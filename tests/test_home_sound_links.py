# SPDX-License-Identifier: GPL-3.0-or-later
"""Real filesystem regression tests; no TV paths are used."""
import importlib.util
import json
import os
import sys
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
LINUX_ROOT = sys.platform.startswith('linux') and hasattr(os, 'geteuid') and os.geteuid() == 0
startup = None
if LINUX_ROOT:
    spec = importlib.util.spec_from_file_location('home_sound_startup', ROOT / 'app/helper-startup.py')
    startup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(startup)


@unittest.skipUnless(LINUX_ROOT, 'Requires Linux root ownership checks')
class HomeSoundLinks(unittest.TestCase):
    def setUp(self):
        # Strict /var/lib-style parent permissions, unlike the writable /tmp.
        self.temp = tempfile.TemporaryDirectory(prefix='lg-xmb-sounds-', dir='/root')
        self.root = Path(self.temp.name)
        self.dev = self.root / 'developer'; self.dev.mkdir(mode=0o755)
        self.home = self.root / 'home'
        self.data = self.root / 'media' / 'lg-xmb'
        for name in ('helper-startup.py', 'index.html', 'menu-sounds.js'):
            (self.dev / name).write_bytes((ROOT / 'app' / name).read_bytes())
        self.manifest = dict(id='org.local.openxmb.c5', type='web', main='index.html', version='0.1.31')
        (self.dev / 'appinfo.json').write_text(json.dumps(self.manifest))
        self.patchers = [patch.object(startup, 'APP_DIR', str(self.dev)),
                         patch.object(startup, 'HOME_PAYLOAD_DIR', str(self.home)),
                         patch.object(startup, 'MUSIC_DIR', str(self.data)),
                         patch.object(startup, 'record_startup', return_value=True)]
        for p in self.patchers: p.start()

    def tearDown(self):
        for p in reversed(self.patchers): p.stop()
        self.temp.cleanup()

    def sync_payload(self):
        # Model the user's installer: regular files only; manifest rewritten
        # for the Home identity. No symlinks make it across the copy.
        if self.home.exists(): shutil.rmtree(self.home)
        self.home.mkdir(mode=0o755)
        for entry in self.dev.iterdir():
            if entry.is_file() and not entry.is_symlink(): shutil.copyfile(entry, self.home / entry.name)
        manifest = dict(self.manifest, id='com.webos.app.home', supportQuickStart=True)
        (self.home / 'appinfo.json').write_text(json.dumps(manifest))

    def assert_links(self, root):
        entries = list((root / 'user-sounds').iterdir())
        self.assertEqual({p.name for p in entries}, set(startup.SOUND_FILES))
        for p in entries:
            self.assertTrue(p.is_symlink()); self.assertEqual(p.lstat().st_uid, 0)
            self.assertEqual(os.readlink(p), str(self.data / 'Sounds' / p.name))

    def test_both_payloads_get_all_nine_dangling_links(self):
        self.sync_payload()
        self.assertTrue(startup.prepare_user_sounds())
        self.assert_links(self.dev); self.assert_links(self.home)
        self.assertFalse(self.data.exists())

    def test_after_regular_file_only_resync_links_are_recreated(self):
        self.sync_payload(); self.assertTrue(startup.prepare_user_sounds())
        self.sync_payload(); self.assertFalse((self.home / 'user-sounds').exists())
        self.assertTrue(startup.prepare_user_sounds()); self.assert_links(self.home)

    def test_idempotent_accepts_the_users_manually_mirrored_links(self):
        self.sync_payload(); d = self.home / 'user-sounds'; d.mkdir()
        for name in startup.SOUND_FILES: (d / name).symlink_to(self.data / 'Sounds' / name)
        before = {p.name: p.lstat().st_ino for p in d.iterdir()}
        self.assertTrue(startup.prepare_user_sounds()); self.assertTrue(startup.prepare_user_sounds())
        self.assertEqual(before, {p.name: p.lstat().st_ino for p in d.iterdir()})

    def test_wav_readthrough_and_data_unchanged(self):
        self.sync_payload(); (self.data / 'Sounds').mkdir(parents=True)
        wav = self.data / 'Sounds' / 'snd_cursor.wav'
        wav.write_bytes(b'RIFF\x04\x00\x00\x00WAVE'); wav.chmod(0o640)
        before = (wav.read_bytes(), wav.stat().st_mode, wav.stat().st_ino)
        self.assertTrue(startup.prepare_user_sounds())
        self.assertEqual((self.home / 'user-sounds' / wav.name).read_bytes(), before[0])
        self.assertEqual((wav.read_bytes(), wav.stat().st_mode, wav.stat().st_ino), before)

    def test_absent_takeover_not_created(self):
        self.assertTrue(startup.prepare_user_sounds()); self.assert_links(self.dev)
        self.assertFalse(self.home.exists())

    def test_setup_before_bind_mount_needs_no_stock_home_access(self):
        self.sync_payload()
        with patch.object(startup.os.path, 'samefile', side_effect=AssertionError('Must not access the stock Home mount')):
            self.assertTrue(startup.prepare_user_sounds())
        self.assert_links(self.home)

    def test_stale_payload_code_rejected_until_updated(self):
        self.sync_payload(); (self.home / 'helper-startup.py').write_text('old code')
        self.assertFalse(startup.prepare_user_sounds()); self.assert_links(self.dev)
        self.assertFalse((self.home / 'user-sounds').exists())
        self.sync_payload(); self.assertTrue(startup.prepare_user_sounds()); self.assert_links(self.home)

    def test_wrong_identity_rejected(self):
        self.sync_payload(); (self.home / 'appinfo.json').write_text(json.dumps(self.manifest))
        self.assertFalse(startup.prepare_user_sounds()); self.assertFalse((self.home / 'user-sounds').exists())

    def test_malformed_manifest_rejected_without_disabling_developer(self):
        self.sync_payload(); (self.home / 'appinfo.json').write_text('{broken')
        self.assertFalse(startup.prepare_user_sounds()); self.assert_links(self.dev)

    def test_payload_directory_symlink_not_followed(self):
        target = self.root / 'foreign'; target.mkdir(); self.home.symlink_to(target)
        self.assertFalse(startup.prepare_user_sounds()); self.assertEqual(list(target.iterdir()), [])

    def test_manifest_symlink_not_followed(self):
        self.sync_payload(); manifest = self.home / 'appinfo.json'; manifest.unlink()
        manifest.symlink_to(self.dev / 'appinfo.json')
        self.assertFalse(startup.prepare_user_sounds()); self.assertFalse((self.home / 'user-sounds').exists())

    def test_world_writable_payload_is_not_chmod_repaired(self):
        self.sync_payload(); self.home.chmod(0o777)
        self.assertFalse(startup.prepare_user_sounds()); self.assertEqual(self.home.stat().st_mode & 0o777, 0o777)

    def test_world_writable_code_is_not_chmod_repaired(self):
        self.sync_payload(); code = self.home / 'menu-sounds.js'; code.chmod(0o666)
        self.assertFalse(startup.prepare_user_sounds()); self.assertEqual(code.stat().st_mode & 0o777, 0o666)

    def test_foreign_owner_rejected(self):
        self.sync_payload(); os.chown(self.home, 1001, 1001)
        self.assertFalse(startup.prepare_user_sounds()); self.assertEqual(self.home.stat().st_uid, 1001)

    def test_conflicting_home_alias_never_overwritten(self):
        self.sync_payload(); d = self.home / 'user-sounds'; d.mkdir()
        p = d / 'snd_cursor.wav'; p.symlink_to('/wrong')
        self.assertFalse(startup.prepare_user_sounds()); self.assertEqual(os.readlink(p), '/wrong')
        self.assertEqual(len(list(d.iterdir())), 1); self.assert_links(self.dev)

    def test_developer_alias_conflict_does_not_block_home(self):
        self.sync_payload(); d = self.dev / 'user-sounds'; d.mkdir()
        p = d / 'snd_cursor.wav'; p.write_text('keep')
        self.assertFalse(startup.prepare_user_sounds()); self.assert_links(self.home)
        self.assertEqual(p.read_text(), 'keep')

    def test_alias_directory_symlink_not_followed(self):
        self.sync_payload(); target = self.root / 'foreign'; target.mkdir()
        (self.home / 'user-sounds').symlink_to(target)
        self.assertFalse(startup.prepare_user_sounds()); self.assertEqual(list(target.iterdir()), [])

    def test_hardlinked_identity_file_rejected(self):
        self.sync_payload(); p = self.home / 'index.html'; p.unlink(); os.link(self.dev / 'index.html', p)
        self.assertFalse(startup.prepare_user_sounds()); self.assertFalse((self.home / 'user-sounds').exists())

    def test_oversized_identity_file_rejected(self):
        self.sync_payload(); (self.home / 'appinfo.json').write_bytes(b' ' * 65537)
        self.assertFalse(startup.prepare_user_sounds()); self.assertFalse((self.home / 'user-sounds').exists())

    def test_ensure_always_prepares_aliases_before_worker_reuse(self):
        # Execute start(), including the real alias setup. Stub only the unrelated
        # privileged capture/bundle internals and point locks at temporary paths.
        from types import SimpleNamespace
        self.sync_payload()
        state = self.root / 'state'; state.mkdir(); logs = self.root / 'logs'; logs.mkdir()
        order = []
        recovery = SimpleNamespace(stop=lambda **kw: order.append('stop'),
            find_helpers=lambda: [(1, 2, 'known')], helper_argument=lambda args: 'known', HELPER='known')
        alias_setup = startup.prepare_user_sounds
        def sounds():
            order.append('sounds'); return alias_setup()
        def bundle():
            order.append('verified'); return None, recovery, 'same-bundle'
        with patch.object(startup, 'BASE', str(state)), patch.object(startup, 'LOG_DIR', str(logs)), \
             patch.object(startup, 'load_bundle', side_effect=bundle), \
             patch.object(startup, 'prepare_user_music', return_value=True), \
             patch.object(startup, 'prepare_user_sounds', side_effect=sounds), \
             patch.object(startup, 'thumbnail_link'), patch.object(startup, 'startup_link'), \
             patch.object(startup, 'launch_worker', side_effect=AssertionError('Existing worker must be reused')):
            self.assertTrue(startup.start()['ready'])
            self.sync_payload()
            self.assertTrue(startup.start()['ready'])
        self.assert_links(self.home); self.assertEqual(order.count('sounds'), 2)
        self.assertLess(order.index('verified'), order.index('sounds'))

if __name__ == '__main__': unittest.main()
