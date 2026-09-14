# SPDX-License-Identifier: GPL-3.0-or-later
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('helper_setup', ROOT / 'tv-helper/setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
REAL_FSTAT, REAL_STAT = os.fstat, os.stat
REAL_MODULE = setup.module
REAL_PLATFORM = setup.platform
REAL_POPEN = subprocess.Popen


def root_info(value):
    fields = {key: getattr(value, key) for key in dir(value) if key.startswith('st_')}
    fields['st_uid'] = 0
    return SimpleNamespace(**fields)


class HelperSetupTests(unittest.TestCase):
    def patched(self, target, name, **kwargs):
        context = patch.object(target, name, **kwargs)
        result = context.start()
        self.addCleanup(context.stop)
        return result

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / 'app'
        self.base = self.root / 'base'
        self.hooks = self.root / 'init.d'
        self.logs = self.root / 'logs'
        for folder in (self.app, self.app / 'helper', self.logs):
            folder.mkdir(mode=0o755)
        sources = {'helper/process-control.py': 'tv-helper/process_control.py',
                   'helper/thumbnail-cache.py': 'tv-helper/thumbnail_cache.py',
                   'helper/stop-helper.py': 'tv-helper/recovery/stop_thumbnail_helper.py',
                   'helper-startup.py': 'app/helper-startup.py',
                   'appinfo.json': 'app/appinfo.json'}
        self.data = {}
        for target, source in sources.items():
            raw = (ROOT / source).read_bytes()
            (self.app / target).write_bytes(raw)
            if target != 'appinfo.json':
                self.data[target] = raw
        self.bundle = {'schema': 1, 'appinfo': setup.sha((self.app/'appinfo.json').read_bytes()),
                       'files': {name: setup.sha(raw) for name, raw in self.data.items()}}
        bundle_raw = json.dumps(self.bundle).encode()
        (self.app / 'helper-bundle.json').write_bytes(bundle_raw)
        for key, value in {'APP': str(self.app), 'BASE': str(self.base),
                           'HOOK_DIR': str(self.hooks), 'TARGET': str(self.app/'helper-startup.py'),
                           'BUNDLE_SHA256': setup.sha(bundle_raw)}.items():
            self.patched(setup, key, new=value)
        self.patched(setup.os, 'geteuid', return_value=0)
        self.patched(setup.os, 'fstat', side_effect=lambda fd: root_info(REAL_FSTAT(fd)))
        self.patched(setup.os, 'stat', side_effect=lambda *a, **kw: root_info(REAL_STAT(*a, **kw)))
        self.real_directory = setup.directory
        @contextlib.contextmanager
        def fixture_directory(path, create=False, app=False):
            self.assertIn(path, {str(self.app), str(self.app/'helper'), str(self.base), str(self.hooks)})
            if create:
                Path(path).mkdir(mode=0o755, exist_ok=True)
            fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                yield fd
            finally:
                os.close(fd)
        self.patched(setup, 'directory', new=fixture_directory)
        self.platform = self.patched(setup, 'platform')
        self.alive = False
        self.events = []
        self.patched(setup, 'module', side_effect=self.load_module)

    def load_module(self, name, raw):
        value = REAL_MODULE(name, raw)
        if name == 'control':
            value.checked_app = lambda: self.events.append('check_app')
        elif name == 'worker':
            def ensure_link():
                dest = self.app / 'thumbnails'
                if not dest.is_symlink():
                    dest.symlink_to(value.CACHE_DIR)
            value.ensure_thumbnail_link = ensure_link
        elif name == 'recovery':
            value.HOOK_TARGET = setup.TARGET
            def inspect():
                if not self.hooks.exists():
                    return None, None
                fd = os.open(self.hooks, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    return fd, value.read_hook(fd)
                except BaseException:
                    os.close(fd)
                    raise
            value.inspect_hook = inspect
            def stop():
                self.events.append('stop')
                fd, hook = inspect()
                if fd is not None:
                    try:
                        if hook: os.unlink(setup.HOOK, dir_fd=fd)
                    finally:
                        os.close(fd)
                self.alive = False
            value.main = stop
            value.find_helpers = lambda: [(123, 42, b'fixture')] if self.alive else []
        elif name == 'starter':
            def start():
                self.events.append('start')
                self.alive = True
            value.start = start
        return value

    def execute(self, action='install'):
        return setup.execute(action)

    def test_status_on_clean_install_is_read_only(self):
        before = sorted(str(p) for p in self.root.rglob('*'))
        self.assertEqual(self.execute('status')['state'], 'missing')
        self.assertEqual(before, sorted(str(p) for p in self.root.rglob('*')))
        self.assertFalse(self.events)

    def test_clean_install_needs_no_external_helper_files(self):
        self.assertEqual(self.execute()['state'], 'starting')
        self.assertEqual(self.events, ['check_app', 'stop', 'start'])
        for name in setup.FILES:
            self.assertEqual((self.base/name).read_bytes(), self.data['helper/'+name])
        config = json.loads((self.base/'background.json').read_bytes())
        self.assertFalse(any(config['enabled'].values()))
        self.assertEqual(config['saved'], {})
        self.assertEqual(config['revision'], 0)
        self.assertEqual(os.readlink(self.hooks/setup.HOOK), setup.TARGET)
        self.assertTrue((self.app/'thumbnails').is_symlink())
        self.assertEqual(self.execute('status')['state'], 'running')

    def test_healthy_setup_is_idempotent(self):
        self.execute()
        before = (self.base/'background.json').read_bytes()
        self.events.clear()
        self.assertEqual(self.execute()['state'], 'running')
        self.assertEqual(self.events, [])
        self.assertEqual((self.base/'background.json').read_bytes(), before)

    def test_repair_preserves_saved_choices_byte_for_byte(self):
        self.execute()
        config = json.loads((self.base/'background.json').read_bytes())
        config['revision'] = 9
        config['enabled']['browser'] = True
        config['saved']['browser'] = {'enabled': True, 'permanentRestore': False}
        raw = json.dumps(config, indent=4).encode()
        (self.base/'background.json').write_bytes(raw)
        (self.base/'process-control.py').write_bytes(b'# older helper\n')
        self.events.clear()
        self.assertEqual(self.execute()['state'], 'starting')
        self.assertEqual((self.base/'background.json').read_bytes(), raw)
        self.assertEqual(self.events, ['check_app', 'stop', 'start'])

    def test_stopped_worker_is_repaired(self):
        self.execute(); self.alive = False
        self.assertEqual(self.execute('status')['state'], 'stopped')
        self.assertEqual(self.execute()['state'], 'starting')

    def test_stop_for_upgrade_preserves_config_and_removes_own_hook(self):
        self.execute()
        before = (self.base/'background.json').read_bytes()
        self.platform.reset_mock()
        self.assertEqual(self.execute('stop')['state'], 'stopped')
        self.assertFalse(self.alive)
        self.assertFalse((self.hooks/setup.HOOK).is_symlink())
        self.assertTrue((self.app/'helper-startup.py').exists())
        self.assertEqual((self.base/'background.json').read_bytes(), before)
        self.platform.assert_not_called()

    def test_missing_root_never_queries_or_creates_files(self):
        with patch.object(setup.os, 'geteuid', return_value=1000):
            with self.assertRaisesRegex(setup.SetupError, 'root_required'):
                self.execute()
        self.platform.assert_not_called()
        self.assertFalse(self.base.exists())

    def test_unknown_tv_never_creates_or_stops(self):
        self.platform.side_effect = setup.SetupError('helper_tv_unsupported')
        with self.assertRaises(setup.SetupError): self.execute()
        self.assertFalse(self.base.exists()); self.assertFalse(self.events)

    def test_manifest_and_payload_tampering_is_rejected_before_setup(self):
        for name in ['appinfo.json', 'helper-bundle.json', 'helper/process-control.py', 'helper-startup.py']:
            path = self.app/name; original = path.read_bytes(); path.write_bytes(original+b' ')
            with self.assertRaises(setup.SetupError): self.execute()
            path.write_bytes(original)
        self.platform.assert_not_called(); self.assertFalse(self.base.exists())

    def test_payload_symlink_is_rejected(self):
        path = self.app/'helper/process-control.py'; path.unlink(); path.symlink_to(self.app/'appinfo.json')
        with self.assertRaises(OSError): self.execute()
        self.assertFalse(self.base.exists())

    def test_foreign_startup_hook_is_never_removed(self):
        self.hooks.mkdir(); (self.hooks/setup.HOOK).symlink_to('/do/not/overwrite')
        with self.assertRaises(RuntimeError): self.execute()
        self.assertEqual(os.readlink(self.hooks/setup.HOOK), '/do/not/overwrite')
        self.assertFalse(self.events); self.assertFalse(self.base.exists())

    def test_reviewed_legacy_hook_is_migrated(self):
        self.hooks.mkdir()
        fixture = ROOT/'tv-helper/recovery/fixtures/60-openxmb-thumbnails.legacy'
        (self.hooks/setup.HOOK).write_bytes(fixture.read_bytes())
        self.execute()
        self.assertEqual(os.readlink(self.hooks/setup.HOOK), setup.TARGET)

    def test_existing_config_is_not_silently_reset(self):
        self.base.mkdir(); (self.base/'background.json').write_text('{"schema":999}')
        with self.assertRaisesRegex(setup.SetupError, 'invalid_config'): self.execute()
        self.assertEqual((self.base/'background.json').read_text(), '{"schema":999}')
        self.assertNotIn('stop', self.events)

    def test_foreign_destination_links_and_hardlinks_are_refused(self):
        self.base.mkdir()
        destination = self.base/'process-control.py'
        for kind in ('symlink','hardlink'):
            if kind == 'symlink': destination.symlink_to(self.app/'appinfo.json')
            else: os.link(self.app/'appinfo.json', destination)
            with self.assertRaises((setup.SetupError, OSError)): self.execute()
            destination.unlink()
        self.assertNotIn('stop', self.events)

    def test_foreign_thumbnail_path_is_not_replaced(self):
        (self.app/'thumbnails').mkdir()
        with self.assertRaises(setup.SetupError): self.execute()
        self.assertTrue((self.app/'thumbnails').is_dir()); self.assertFalse(self.base.exists())

    def test_bundle_module_load_supports_dataclasses(self):
        worker = REAL_MODULE('fixture_worker', self.data['helper/thumbnail-cache.py'])
        self.assertTrue(hasattr(worker, 'Worker'))

    def test_read_file_refuses_writable_regular_files(self):
        path = self.app/'helper-bundle.json'; path.chmod(0o666)
        with self.assertRaises(setup.SetupError): self.execute()
        self.assertFalse(self.base.exists())

    def test_directory_traversal_refuses_symlink_components(self):
        linked = self.root/'alias'; linked.symlink_to(self.app, target_is_directory=True)
        with self.assertRaises(OSError):
            with self.real_directory(str(linked), app=True): pass

    def test_errors_are_structured_without_shell_failure_or_raw_detail(self):
        self.platform.side_effect = setup.SetupError('helper_tv_unknown')
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(setup.main(['install']), 0)
        self.assertEqual(json.loads(output.getvalue()), {'returnValue': False, 'errorCode':'helper_tv_unknown'})

    def test_install_and_stop_are_serialized_by_the_same_lock(self):
        with setup.locked_base():
            for action in ('install', 'stop'):
                with self.assertRaisesRegex(setup.SetupError, 'helper_busy'):
                    self.execute(action)
        self.assertNotIn('stop', self.events)
        self.assertNotIn('start', self.events)

    def test_platform_query_is_read_only_and_refuses_other_models(self):
        for model, sdk, allowed in [('OLED55C54LA', '10.3.1', True),
                                    ('OLED42C5ELB', '10.3.1', True),
                                    ('OLED65C44LA', '10.3.1', False),
                                    ('OLED55C54LA', '11.0.0', False),
                                    (None, '10.3.1', False)]:
            value = json.dumps({'returnValue': True, 'modelName': model, 'sdkVersion': sdk})
            def spawn(argv, **kwargs):
                self.assertEqual(argv[5], 'luna://com.webos.service.tv.systemproperty/getSystemInfo')
                self.assertEqual(json.loads(argv[6]), {'keys': ['modelName', 'sdkVersion']})
                return REAL_POPEN([sys.executable, '-c', 'print('+repr(value)+')'], **kwargs)
            with patch.object(setup.subprocess, 'Popen', side_effect=spawn):
                if allowed:
                    REAL_PLATFORM()
                else:
                    with self.assertRaises(setup.SetupError): REAL_PLATFORM()

    def test_only_fixed_actions_are_accepted(self):
        for action in ['install; reboot', 'restore', '', 'launch', '../install']:
            with self.assertRaisesRegex(setup.SetupError, 'invalid_action'): self.execute(action)
        self.platform.assert_not_called()


if __name__ == '__main__':
    unittest.main()
