# SPDX-License-Identifier: GPL-3.0-or-later
"""Real filesystem checks for optional personal wallpaper links; no TV access."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
LINUX_ROOT = sys.platform.startswith('linux') and hasattr(os, 'geteuid') and os.geteuid() == 0
startup = None
if LINUX_ROOT:
    spec = importlib.util.spec_from_file_location('wallpaper_startup', ROOT / 'app/helper-startup.py')
    startup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(startup)


@unittest.skipUnless(LINUX_ROOT, 'Requires Linux root ownership checks')
class WallpaperLinks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lg-xmb-wallpaper-', dir='/root')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dev = self.root / 'developer'
        self.dev.mkdir(mode=0o755)
        self.home = self.root / 'home'
        self.media = self.root / 'media'
        self.media.mkdir(mode=0o755)
        self.data = self.media / 'lg-xmb'
        for name in ('helper-startup.py', 'index.html', 'menu-sounds.js'):
            shutil.copyfile(ROOT / 'app' / name, self.dev / name)
        self.manifest = dict(id='org.local.openxmb.c5', type='web', main='index.html', version='0.1.31')
        (self.dev / 'appinfo.json').write_text(json.dumps(self.manifest))
        patches = patch.multiple(startup, APP_DIR=str(self.dev), HOME_PAYLOAD_DIR=str(self.home),
                                 MUSIC_DIR=str(self.data))
        patches.start()
        self.addCleanup(patches.stop)
        log = patch.object(startup, 'record_startup', return_value=True)
        self.log = log.start()
        self.addCleanup(log.stop)

    def add_home(self):
        self.home.mkdir(mode=0o755)
        for entry in self.dev.iterdir():
            if entry.is_file() and not entry.is_symlink():
                shutil.copyfile(entry, self.home / entry.name)
        (self.home / 'appinfo.json').write_text(json.dumps(dict(self.manifest, id='com.webos.app.home')))

    def alias(self, app):
        return app / 'user-wallpaper.jpg'

    def assert_alias(self, app):
        link = self.alias(app)
        self.assertTrue(link.is_symlink())
        self.assertEqual(os.readlink(link), str(self.data / 'wallpaper.jpg'))
        self.assertEqual(link.lstat().st_uid, 0)

    def test_font_folder_and_links_preserve_existing_personal_fonts(self):
        self.add_home()
        old = self.dev / 'user-fonts'
        old.mkdir()
        (old / 'keep.ttf').write_bytes(b'personal font')
        self.assertTrue(startup.prepare_user_fonts())
        font = self.data / 'Fonts' / 'SCE-PS3-RD-R-LATIN2.TTF'
        font.write_bytes(b'user font')
        before = font.stat().st_ino, font.read_bytes()
        self.assertTrue(startup.prepare_user_fonts())
        for app in (self.dev, self.home):
            self.assertEqual(os.readlink(app / 'media-fonts'), str(self.data / 'Fonts'))
        self.assertEqual(before, (font.stat().st_ino, font.read_bytes()))
        self.assertEqual((old / 'keep.ttf').read_bytes(), b'personal font')

    def test_font_alias_conflict_is_preserved(self):
        self.add_home()
        (self.dev / 'media-fonts').write_bytes(b'keep')
        self.assertFalse(startup.prepare_user_fonts())
        self.assertEqual((self.dev / 'media-fonts').read_bytes(), b'keep')
        self.assertTrue((self.home / 'media-fonts').is_symlink())

    def test_symlinked_font_folder_is_refused(self):
        self.data.mkdir()
        outside = self.root / 'outside'
        outside.mkdir()
        (self.data / 'Fonts').symlink_to(outside)
        self.assertFalse(startup.prepare_user_fonts())
        self.assertFalse(os.path.lexists(self.dev / 'media-fonts'))
        self.assertEqual(list(outside.iterdir()), [])

    def test_prepares_both_apps_without_creating_an_image(self):
        self.add_home()
        self.assertTrue(startup.prepare_user_wallpaper())
        self.assert_alias(self.dev)
        self.assert_alias(self.home)
        self.assertEqual(list(self.data.iterdir()), [])
        self.assertEqual(self.data.stat().st_mode & 0o777, 0o755)

    def test_absent_home_is_not_created(self):
        self.assertTrue(startup.prepare_user_wallpaper())
        self.assert_alias(self.dev)
        self.assertFalse(self.home.exists())

    def test_existing_image_and_aliases_remain_unchanged(self):
        self.add_home()
        self.data.mkdir()
        image = self.data / 'wallpaper.jpg'
        image.write_bytes(b'private image fixture')
        image.chmod(0o640)
        before = image.stat().st_ino, image.stat().st_mode, image.read_bytes()
        self.assertTrue(startup.prepare_user_wallpaper())
        links = [self.alias(app).lstat().st_ino for app in (self.dev, self.home)]
        self.assertTrue(startup.prepare_user_wallpaper())
        self.assertEqual(links, [self.alias(app).lstat().st_ino for app in (self.dev, self.home)])
        self.assertEqual(before, (image.stat().st_ino, image.stat().st_mode, image.read_bytes()))

    def test_lost_link_is_recreated_without_touching_user_image(self):
        self.assertTrue(startup.prepare_user_wallpaper())
        image = self.data / 'wallpaper.jpg'
        image.write_bytes(b'keep this image')
        before = image.stat().st_ino, image.read_bytes()
        self.alias(self.dev).unlink()  # Model an app update replacing its directory.
        self.assertTrue(startup.prepare_user_wallpaper())
        self.assert_alias(self.dev)
        self.assertEqual(before, (image.stat().st_ino, image.read_bytes()))

    def test_conflicting_file_is_preserved_and_other_app_still_prepared(self):
        self.add_home()
        link = self.alias(self.dev)
        link.write_bytes(b'keep this entry')
        before = link.stat().st_ino
        self.assertFalse(startup.prepare_user_wallpaper())
        self.assertEqual(link.read_bytes(), b'keep this entry')
        self.assertEqual(link.stat().st_ino, before)
        self.assert_alias(self.home)

    def test_foreign_link_is_not_replaced_or_followed(self):
        self.add_home()
        foreign = self.root / 'private.jpg'
        foreign.write_bytes(b'keep private')
        self.alias(self.home).symlink_to(foreign)
        self.assertFalse(startup.prepare_user_wallpaper())
        self.assertEqual(os.readlink(self.alias(self.home)), str(foreign))
        self.assertEqual(foreign.read_bytes(), b'keep private')
        self.assert_alias(self.dev)

    def test_raced_in_foreign_link_is_not_replaced(self):
        original = os.symlink

        def race(target, name, **kwargs):
            original('/foreign.jpg', name, **kwargs)
            raise FileExistsError(name)

        with patch.object(startup.os, 'symlink', side_effect=race):
            self.assertFalse(startup.prepare_user_wallpaper())
        self.assertEqual(os.readlink(self.alias(self.dev)), '/foreign.jpg')

    def test_matching_link_must_be_root_owned(self):
        self.assertTrue(startup.prepare_user_wallpaper())
        link = self.alias(self.dev)
        os.chown(link, 1001, 1001, follow_symlinks=False)
        self.assertFalse(startup.prepare_user_wallpaper())
        self.assertEqual(link.lstat().st_uid, 1001)

    def test_symlinked_data_directory_is_rejected(self):
        outside = self.root / 'outside'
        outside.mkdir()
        self.data.symlink_to(outside)
        self.assertFalse(startup.prepare_user_wallpaper())
        self.assertEqual(list(outside.iterdir()), [])
        self.assertFalse(os.path.lexists(self.alias(self.dev)))

    def test_stale_home_payload_is_left_alone(self):
        self.add_home()
        (self.home / 'helper-startup.py').write_text('old code')
        self.assertFalse(startup.prepare_user_wallpaper())
        self.assertFalse(os.path.lexists(self.alias(self.home)))
        self.assert_alias(self.dev)

    def test_writable_home_payload_is_not_repaired(self):
        self.add_home()
        self.home.chmod(0o777)
        self.assertFalse(startup.prepare_user_wallpaper())
        self.assertEqual(self.home.stat().st_mode & 0o777, 0o777)
        self.assertFalse(os.path.lexists(self.alias(self.home)))


if __name__ == '__main__':
    unittest.main()
