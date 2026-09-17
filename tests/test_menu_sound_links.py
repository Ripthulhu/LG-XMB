# SPDX-License-Identifier: GPL-3.0-or-later
import importlib.util
import os
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
LINUX_ROOT = sys.platform.startswith('linux') and hasattr(os, 'geteuid') and os.geteuid() == 0
startup = None
if LINUX_ROOT:
    spec = importlib.util.spec_from_file_location('sound_startup', ROOT / 'app/helper-startup.py')
    startup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(startup)

@unittest.skipUnless(LINUX_ROOT, 'Root ownership checks require a Linux root test container')
class SoundLinks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lg-xmb-sounds-', dir='/root')
        self.root = Path(self.temp.name)
        self.app = self.root / 'app'; self.app.mkdir(mode=0o755)
        self.data = self.root / 'user-data'  # deliberately absent
        self.patches = [patch.object(startup, 'APP_DIR', str(self.app)),
                        patch.object(startup, 'MUSIC_DIR', str(self.data)),
                        patch.object(startup, 'HOME_PAYLOAD_DIR', str(self.root / 'absent-home')),
                        patch.object(startup, 'record_startup', return_value=True)]
        for p in self.patches: p.start()
    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()
    def test_dangling_links_allow_later_folder_drop(self):
        self.assertTrue(startup.prepare_user_sounds())
        links = list((self.app / 'user-sounds').iterdir())
        self.assertEqual(len(links), 9)
        self.assertFalse(self.data.exists())
        for p in links:
            self.assertTrue(p.is_symlink())
            self.assertEqual(os.readlink(p), str(self.data / 'Sounds' / p.name))
        (self.data / 'Sounds').mkdir(parents=True)
        raw = b'user supplied audio, never copied or changed'
        (self.data / 'Sounds/snd_cursor.wav').write_bytes(raw)
        self.assertEqual((self.app / 'user-sounds/snd_cursor.wav').read_bytes(), raw)
    def test_idempotent_keeps_inode_and_user_data(self):
        self.assertTrue(startup.prepare_user_sounds())
        link = self.app / 'user-sounds/snd_cursor.wav'; ino=link.lstat().st_ino
        self.assertTrue(startup.prepare_user_sounds());self.assertEqual(link.lstat().st_ino,ino)
    def test_foreign_directory_symlink_is_not_followed(self):
        foreign=self.root/'foreign';foreign.mkdir();(self.app/'user-sounds').symlink_to(foreign)
        self.assertFalse(startup.prepare_user_sounds());self.assertEqual(list(foreign.iterdir()),[])
    def test_regular_file_is_never_overwritten(self):
        d=self.app/'user-sounds';d.mkdir();p=d/'snd_cursor.wav';p.write_bytes(b'keep')
        self.assertFalse(startup.prepare_user_sounds());self.assertEqual(p.read_bytes(),b'keep');self.assertEqual(len(list(d.iterdir())),1)
    def test_wrong_link_target_is_never_repaired(self):
        d=self.app/'user-sounds';d.mkdir();p=d/'snd_cursor.wav';p.symlink_to('/wrong')
        self.assertFalse(startup.prepare_user_sounds());self.assertEqual(os.readlink(p),'/wrong')
    def test_unexpected_file_disables_only_optional_setup(self):
        d=self.app/'user-sounds';d.mkdir();(d/'unknown').write_text('keep')
        self.assertFalse(startup.prepare_user_sounds());self.assertEqual((d/'unknown').read_text(),'keep')
    def test_writable_alias_directory_is_rejected(self):
        d=self.app/'user-sounds';d.mkdir();d.chmod(0o777)
        self.assertFalse(startup.prepare_user_sounds());self.assertEqual(d.stat().st_mode & 0o777,0o777)
    def test_foreign_owner_link_is_rejected(self):
        self.assertTrue(startup.prepare_user_sounds());p=self.app/'user-sounds/snd_cursor.wav'
        os.chown(p,1001,1001,follow_symlinks=False)
        self.assertFalse(startup.prepare_user_sounds());self.assertEqual(p.lstat().st_uid,1001)
    def test_call_runs_after_bundle_validation(self):
        code=(ROOT/'app/helper-startup.py').read_text().split('def start():',1)[1]
        self.assertLess(code.index('load_bundle()'),code.index('prepare_user_sounds()'))
        self.assertLess(code.index('prepare_user_music()'),code.index('prepare_user_sounds()'))

if __name__=='__main__':unittest.main()
