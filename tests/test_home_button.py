# SPDX-License-Identifier: GPL-3.0-or-later
"""Home-only routing and lifecycle checks; no TV or real input device required."""
import importlib.util
import errno
import json
import os
from pathlib import Path
import stat
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import test_helper_startup as bootstrap_tests

startup = bootstrap_tests.startup

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('home_button', ROOT / 'tv-helper/home_button.py')
home = importlib.util.module_from_spec(spec)
spec.loader.exec_module(home)


def event(kind, code, value):
    return home.EVENT.pack(123, 456, kind, code, value)


class HomeButtonTests(unittest.TestCase):
    def setUp(self):
        self.fixture = bootstrap_tests.SetupFixture()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.base, self.app = self.fixture.base, self.fixture.app
        self.identities = {}
        self.recovery = self.fixture.recovery
        self.recovery.BOOTSTRAP = b'bootstrap'
        self.recovery.find_helpers = lambda: list(self.identities.values())
        self.recovery.process_identity = self.identities.get
        self.recovery.stop_one = lambda identity: self.identities.pop(identity[0], None)
        self.patch = patch.multiple(home, os=startup.os, APP_DIR=str(self.app),
                                    HOME_PAYLOAD=str(self.fixture.root / 'absent'),
                                    STOCK_HOME=str(self.fixture.root / 'stock'))
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.native = patch.object(home, 'native', return_value={'settings': {'defaultApps': {}}})
        self.native_mock = self.native.start()
        self.addCleanup(self.native.stop)

    def save(self, mode):
        self.base.mkdir(exist_ok=True)
        (self.base / home.CONFIG).write_text(json.dumps({'mode': mode}))
        (self.base / home.CONFIG).chmod(0o600)

    def state(self, legacy=False):
        return home.public(startup, self.recovery, 'bundle', legacy=legacy)

    def command(self, *args):
        return home.command(list(args), startup, self.recovery, 'bundle')

    def ready(self, bundle='bundle'):
        identity = (111, 222, self.recovery.BOOTSTRAP)
        self.identities[111] = identity
        (self.base / home.STATUS).write_text(json.dumps({'pid': 111, 'birth': 222,
             'bundle': bundle, 'state': 'running'}))
        (self.base / home.STATUS).chmod(0o600)
        return identity

    def test_get_is_read_only_and_saved_choice_is_not_running_proof(self):
        self.assertEqual(self.command('get')['mode'], 'stock')
        self.assertFalse(self.base.exists())
        self.save('xmb')
        self.assertFalse(self.state()['running'])
        self.ready()
        self.assertTrue(self.state()['running'])
        self.identities[111] = (111, 999, self.recovery.BOOTSTRAP)
        self.assertFalse(self.state()['running'])
        self.ready('old-bundle')
        self.assertFalse(self.state()['running'])

    def test_legacy_assignment_is_visible_but_not_automatically_enabled(self):
        self.native_mock.return_value = {'settings': {'defaultApps': {'home': home.APPS['xmb']}}}
        self.assertEqual(self.command('get')['mode'], 'xmb')
        self.assertEqual(self.state()['mode'], 'stock')
        with patch.object(home.subprocess, 'Popen') as spawn:
            self.assertEqual(home.ensure(startup, self.recovery, 'bundle')['mode'], 'stock')
            spawn.assert_not_called()
        self.assertFalse(self.base.exists())

    def test_enable_persists_and_disable_stops_only_mapper_without_removing_hook(self):
        def started(*args, **kwargs):
            self.ready()
            return self.state()
        with patch.object(home, 'ensure', side_effect=started):
            reply = self.command('set', 'xmb', self.state()['revision'])
        self.assertTrue(reply['running'])
        self.assertEqual(json.loads((self.base / home.CONFIG).read_text()), {'mode': 'xmb'})
        hook = self.fixture.log / 'init.d/60-lg-xmb'
        self.assertTrue(hook.is_symlink())
        self.identities[333] = (333, 444, self.recovery.HELPER)
        reply = self.command('set', 'stock', self.state()['revision'])
        self.assertEqual(reply['mode'], 'stock')
        self.assertEqual(list(self.identities), [333])
        self.assertTrue(hook.is_symlink())

    def test_disable_releases_grab_even_when_legacy_cleanup_fails(self):
        self.save('xmb')
        self.ready()
        with patch.object(home, 'clear_legacy_assignment', side_effect=home.HomeButtonError('native_timeout')):
            reply = self.command('set', 'stock', self.state()['revision'])
        self.assertEqual(reply['errorCode'], 'native_timeout')
        self.assertFalse(self.identities)
        self.assertEqual(self.state()['mode'], 'stock')
        self.native_mock.return_value = {'settings': {'defaultApps': {'home': home.APPS['xmb']}}}
        self.assertEqual(self.command('get')['mode'], 'xmb')

    def test_stale_setting_and_active_upgrade_do_not_change_mapping(self):
        self.save('stock')
        self.assertEqual(self.command('set', 'xmb', '0' * 64)['errorCode'], 'home_mapping_changed')
        with home.change_lock(startup) as base:
            self.assertTrue(stat.S_ISDIR(os.fstat(base).st_mode))
            self.assertEqual(self.command('set', 'xmb', self.state()['revision'])['errorCode'], 'home_button_busy')
        with self.assertRaises(OSError):
            os.fstat(base)
        self.assertEqual(self.state()['mode'], 'stock')

    def test_foreign_hook_rejects_enable_before_save_and_releases_setup_lock(self):
        hook = self.fixture.log / 'init.d/60-lg-xmb'
        hook.parent.mkdir()
        hook.write_text('foreign hook')
        with patch.object(home, 'ensure') as ensure:
            with self.assertRaisesRegex(startup.SetupError, 'startup_hook_conflict'):
                self.command('set', 'xmb', self.state()['revision'])
        self.assertFalse((self.base / home.CONFIG).exists())
        self.assertEqual(hook.read_text(), 'foreign hook')
        ensure.assert_not_called()
        self.native_mock.assert_not_called()
        with home.change_lock(startup) as base:
            self.assertTrue(stat.S_ISDIR(os.fstat(base).st_mode))

    def test_foreign_state_file_and_invalid_commands_are_rejected(self):
        self.save('stock')
        (self.base / home.CONFIG).write_text('{"mode":"xmb","command":"untrusted"}')
        self.assertEqual(self.command('get')['errorCode'], 'invalid_home_settings')
        for args in (['get', 'extra'], ['set', 'xmb'], ['set', 'evil', 'a' * 64]):
            self.assertEqual(self.command(*args)['errorCode'], 'invalid_command')
        with patch.object(home, 'overlay_active', return_value=True):
            self.assertEqual(self.command('get')['errorCode'], 'home_overlay_active')

    def test_legacy_cleanup_preserves_other_defaults_and_never_assigns_xmb(self):
        before = {'home': home.APPS['xmb'], 'browser': 'another.browser'}
        self.native_mock.side_effect = [
            {'settings': {'defaultApps': before}}, {'returnValue': True},
            {'settings': {'defaultApps': dict(before, home=home.APPS['stock'])}}]
        home.clear_legacy_assignment()
        self.assertEqual(self.native_mock.call_args_list[1].args,
                         ('set', {'category': 'home', 'appId': home.APPS['stock']}))
        self.native_mock.reset_mock(side_effect=True)
        self.native_mock.return_value = {'settings': {'defaultApps': {'home': 'third.party'}}}
        home.clear_legacy_assignment()
        self.assertEqual(self.native_mock.call_count, 1)

    def test_upgrade_restarts_old_mapper_even_without_capture(self):
        self.save('xmb')
        old = self.ready('old')
        def spawn(*args, **kwargs):
            self.assertNotIn(old[0], self.identities)
            self.ready()
        with patch.object(home.subprocess, 'Popen', side_effect=spawn) as popen:
            result = home.ensure(startup, self.recovery, 'bundle')
        self.assertTrue(result['running'])
        self.assertEqual(popen.call_args.args[0][-1], 'home-button-worker')
        self.assertNotIn('launch', ' '.join(popen.call_args.args[0]))
        with home.change_lock(startup) as base:
            self.assertTrue(home.ensure(startup, self.recovery, 'bundle', base)['running'])
            self.assertTrue(stat.S_ISDIR(os.fstat(base).st_mode), 'ensure must not close a borrowed descriptor')

    def test_home_press_launches_once_and_all_other_input_is_byte_exact(self):
        output, launches = [], []
        relay = home.InputRelay(output.append, lambda: launches.append(1))
        other = [event(1, 103, 1), event(1, 103, 2), event(2, 8, -1),
                 event(3, 0, 100), event(1, 1198, 1), event(0, 0, 0), event(1, 103, 0)]
        relay.feed(b''.join([event(1, home.HOME_KEY, 1), event(1, home.HOME_KEY, 2)] + other +
                           [event(1, home.HOME_KEY, 0)]))
        self.assertEqual(launches, [1])
        self.assertEqual(output, other)
        relay.release()
        self.assertEqual(output[-2:], [home.EVENT.pack(0,0,1,1198,0), home.EVENT.pack(0,0,0,0,0)])
        for invalid in (b'', b'x', event(0, 3, 0)):
            with self.assertRaisesRegex(home.HomeButtonError, 'remote_disconnected'):
                relay.feed(invalid)

    def test_device_discovery_uses_names_and_version_specific_output(self):
        raw = '\n\n'.join('N: Name="LGE M-RCU - Builtin [%d]"\nH: Handlers=kbd event%d ' % (i, n)
                            for i, n in [(0, 7), (1, 4), (2, 9)])
        self.assertEqual(home.device_paths(raw, 9), ('/dev/input/event7', '/dev/input/event9'))
        self.assertEqual(home.device_paths(raw, 10), ('/dev/input/event7', '/dev/input/event4'))
        self.assertEqual(home.launch_command(9)[1:3], ['-n', '1'])
        self.assertEqual(home.launch_command(10)[1:3], ['-t', '1'])

    def test_device_fallback_stays_with_unambiguous_builtin_outputs(self):
        def device(index, handlers):
            return 'I: Bus=0019\nN: Name="LGE M-RCU - Builtin [%s]"\nH: Handlers=kbd %s' % (index, handlers)
        source = device(0, 'event7')
        cases = [
            (9, [device(1, 'event4')], '/dev/input/event4'),  # Older target without [2].
            (10, [device(2, 'event9')], '/dev/input/event9'),  # Newer target without [1].
            (9, [device(3, 'event12')], '/dev/input/event12'),
            (10, [device(3, 'event12')], '/dev/input/event12'),
            (10, [device(1, 'event7'), device(2, 'event9')], '/dev/input/event9'),
            (9, [device(2, 'event7')], None),  # Another name for the source is never an output.
            (9, [], None),
            (9, ['N: Name="USB keyboard"\nH: Handlers=kbd event9'], None),
            (9, [device('not-a-number', 'event9')], None),
            (9, [device(2, 'event9/invalid')], None),
            (9, [device(2, 'event9 event10')], None),
            (9, [device(2, 'event9'), device(2, 'event10')], None),
            (9, [device(2, 'event9'), device(2, 'event10'), device(3, 'event12')], '/dev/input/event12'),
            (9, [device(0, 'event8'), device(2, 'event9')], None),
        ]
        for major, outputs, expected in cases:
            with self.subTest(major=major, outputs=outputs):
                # Kernel blocks may be separated by a blank line or just the next I: line.
                for separator in ('\n\n', '\n'):
                    raw = separator.join([source] + outputs)
                    if expected is None:
                        with self.assertRaisesRegex(home.HomeButtonError, 'remote_missing'):
                            home.device_paths(raw, major)
                    else:
                        self.assertEqual(home.device_paths(raw, major), ('/dev/input/event7', expected))

    def test_grab_conflict_closes_both_devices_without_touching_other_mapper(self):
        from unittest.mock import mock_open
        with patch('builtins.open', mock_open(read_data=b'devices')), \
             patch.object(home, 'device_paths', return_value=('/dev/input/event7', '/dev/input/event9')), \
             patch.object(home.os, 'open', side_effect=[7, 9]) as opened, \
             patch.object(home.os, 'fstat', return_value=SimpleNamespace(st_mode=stat.S_IFCHR)), \
             patch.object(home.os, 'close') as closed, \
             patch.object(home.fcntl, 'ioctl', side_effect=OSError(errno.EBUSY, 'busy')) as grab:
            with self.assertRaisesRegex(home.HomeButtonError, 'remote_busy'):
                home.open_remote(9)
        self.assertEqual(opened.call_count, 2)
        grab.assert_called_once_with(7, home.EVIOCGRAB, 1)
        self.assertEqual([call.args[0] for call in closed.call_args_list], [7, 9])

    def test_launch_drains_reply_written_between_eagain_and_process_exit(self):
        launch = home.AppLaunch(10)
        child = Mock()
        child.poll.return_value = 0
        launch.child = child
        reply = b'timingServiceResponse: {"returnValue":true}\n'
        with patch.object(home.os, 'read', side_effect=[OSError(errno.EAGAIN, 'again'), reply, b'']):
            launch.check()
        self.assertIsNone(launch.child)
        child.stdout.close.assert_called_once()

    def test_native_requests_decode_bound_and_close_real_child_pipes(self):
        self.native.stop()
        popen = home.subprocess.Popen
        children = []
        def spawn(command, **kwargs):
            self.assertTrue(kwargs['close_fds'])
            child = popen([sys.executable, '-c', script], **kwargs)
            children.append(child)
            return child
        for script, error in [
            ('print(\'{"returnValue":true}\')', None),
            ('print("not json")', 'invalid_reply'),
            ('print("x" * 65537)', 'invalid_reply'),
        ]:
            with self.subTest(error=error), patch.object(home.subprocess, 'Popen', side_effect=spawn):
                if error:
                    with self.assertRaisesRegex(home.HomeButtonError, error):
                        home.native('get', {})
                else:
                    self.assertTrue(home.native('get', {})['returnValue'])
                self.assertIsNotNone(children[-1].poll())
                self.assertTrue(children[-1].stdout.closed)
        script = 'import sys,time;sys.stdout.write("{}");sys.stdout.flush();time.sleep(10)'
        with patch.object(home.subprocess, 'Popen', side_effect=spawn), \
             patch.object(home, 'monotonic', side_effect=[0, 0, 5]):
            with self.assertRaisesRegex(home.HomeButtonError, 'native_timeout'):
                home.native('get', {})
        self.assertIsNotNone(children[-1].poll())
        self.assertTrue(children[-1].stdout.closed)

    def test_launch_start_uses_nonblocking_pipe_and_can_be_reused(self):
        launch = home.AppLaunch(10)
        script = 'import sys;sys.stderr.write(\'timingServiceResponse: {"returnValue":true}\\n\')'
        try:
            with patch.object(home, 'launch_command', return_value=[sys.executable, '-c', script]):
                for _ in range(2):
                    launch.start()
                    child = launch.child
                    self.assertTrue(home.fcntl.fcntl(child.stdout.fileno(), home.fcntl.F_GETFL) & os.O_NONBLOCK)
                    child.wait(timeout=3)
                    launch.check()
                    self.assertIsNone(launch.child)
                    self.assertTrue(child.stdout.closed)
        finally:
            launch.close()

    def test_failed_or_timed_out_launch_is_not_reported_successful(self):
        for reply in (b'{"returnValue":false}\n', b''):
            launch = home.AppLaunch(9)
            launch.child = Mock()
            launch.child.poll.return_value = 0
            with patch.object(home.os, 'read', side_effect=[reply, b'', b'']):
                with self.assertRaisesRegex(home.HomeButtonError, 'remote_launch_failed'):
                    launch.check()
        launch = home.AppLaunch(9)
        child = Mock()
        child.poll.return_value = None
        launch.child, launch.deadline = child, 0
        with patch.object(home.os, 'read', side_effect=OSError(errno.EAGAIN, 'again')):
            with self.assertRaisesRegex(home.HomeButtonError, 'remote_launch_failed'):
                launch.check()
        launch.close()
        child.kill.assert_called_once()
        child.wait.assert_called_once()

    def test_worker_relays_and_releases_held_keys_when_disabled(self):
        self.save('xmb')
        self.identities[os.getpid()] = (os.getpid(), 123, self.recovery.BOOTSTRAP)
        reader, sender = os.pipe()
        path = self.fixture.root / 'forwarded'
        writer = os.open(path, os.O_WRONLY | os.O_CREAT, 0o600)
        os.write(sender, event(1, 103, 1) + event(1, home.HOME_KEY, 1) + event(2, 8, -1))
        launcher = Mock()
        launcher.check.side_effect = lambda: self.save('stock')
        try:
            with patch.object(home, 'webos_major', return_value=9), \
                 patch.object(home, 'open_remote', return_value=(reader, writer)), \
                 patch.object(home, 'AppLaunch', return_value=launcher), \
                 patch.object(home.signal, 'signal'):
                home.run(startup, self.recovery, 'bundle')
        finally:
            os.close(sender)
        self.assertEqual(path.read_bytes(), event(1,103,1) + event(2,8,-1) +
                         home.EVENT.pack(0,0,1,103,0) + home.EVENT.pack(0,0,0,0,0))
        launcher.start.assert_called_once()
        launcher.close.assert_called_once()
        self.assertEqual(json.loads((self.base / home.STATUS).read_text())['state'], 'stopped')

    def test_bootstrap_get_verifies_bundle_without_capture_setup(self):
        module = SimpleNamespace(command=Mock(return_value={'returnValue': True}))
        with patch.object(startup, 'home_modules', return_value=(module, self.recovery, 'bundle')), \
             patch.dict(sys.modules, {startup.__name__: startup}), patch.object(startup, 'start') as start:
            self.assertTrue(startup.home_button(['get'])['returnValue'])
        module.command.assert_called_once_with(['get'], startup, self.recovery, 'bundle')
        start.assert_not_called()


if __name__ == '__main__':
    unittest.main()
