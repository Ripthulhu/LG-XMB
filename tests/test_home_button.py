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
        self.hook = SimpleNamespace(healthy=Mock(return_value=True), disarm=Mock(),
                                    HookError=home.HomeButtonError, Controller=Mock())
        self.patch = patch.multiple(home, os=startup.os, hook=self.hook, APP_DIR=str(self.app),
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
             'bundle': bundle, 'state': 'running', 'nativeBuild': 'b' * 64}))
        (self.base / home.STATUS).chmod(0o600)
        return identity

    def test_get_is_read_only_and_saved_choice_is_not_running_proof(self):
        self.assertEqual(self.command('get')['mode'], 'stock')
        self.assertFalse(self.base.exists())
        self.save('xmb')
        self.assertFalse(self.state()['running'])
        self.ready()
        self.assertTrue(self.state()['running'])
        self.hook.healthy.assert_called_with(startup, 'b' * 64)
        self.hook.healthy.return_value = False
        self.assertFalse(self.state()['running'], 'A live process without a valid lease is not ready')
        self.hook.healthy.return_value = True
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

    def test_disable_disarms_before_stopping_even_when_legacy_cleanup_fails(self):
        self.save('xmb')
        self.ready()
        actions = []
        self.hook.disarm.side_effect = lambda: actions.append('disarm')
        def stop(identity):
            actions.append('stop')
            self.identities.pop(identity[0], None)
        self.recovery.stop_one = stop
        with patch.object(home, 'clear_legacy_assignment', side_effect=home.HomeButtonError('native_timeout')):
            reply = self.command('set', 'stock', self.state()['revision'])
        self.assertEqual(reply['errorCode'], 'native_timeout')
        self.assertEqual(actions, ['disarm', 'stop'])
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

    def test_native_disable_error_reaches_remote_settings(self):
        class HookError(Exception):
            pass
        self.save('xmb')
        self.hook.HookError = HookError
        self.hook.disarm.side_effect = HookError('hook_conflict')
        self.assertEqual(self.command('set', 'stock', self.state()['revision']),
                         {'returnValue': False, 'errorCode': 'hook_conflict'})

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

    def test_launch_flags_follow_webos_version(self):
        self.assertEqual(home.launch_command(9)[1:3], ['-n', '1'])
        self.assertEqual(home.launch_command(10)[1:3], ['-t', '1'])

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

    def test_worker_reports_controller_health_and_closes_on_disable_or_removal(self):
        for running, exit_kind in [(True, 'disable'), (False, 'disable'), (True, 'uninstall')]:
            with self.subTest(running=running, exit_kind=exit_kind):
                self.save('xmb')
                (self.app / 'appinfo.json').write_text('{}')
                self.identities[os.getpid()] = (os.getpid(), 123, self.recovery.BOOTSTRAP)
                controller = SimpleNamespace(build='b' * 64, last_input=None, running=running,
                    reason='' if running else 'hook_unavailable', close=Mock())
                def step(launch):
                    if running:
                        controller.last_input = {'source': 'lginput2', 'code': 125}
                        launch()
                    if exit_kind == 'uninstall':
                        (self.app / 'appinfo.json').unlink()
                    else:
                        self.save('stock')
                controller.step = Mock(side_effect=step)
                self.hook.Controller.return_value = controller
                launcher, reports = Mock(), []
                original_write = startup.write_file
                def write(directory, name, raw):
                    if name == home.STATUS:
                        reports.append(json.loads(raw))
                    return original_write(directory, name, raw)
                with patch.object(home, 'webos_major', return_value=9), \
                     patch.object(home, 'AppLaunch', return_value=launcher), \
                     patch.object(home.signal, 'signal'), patch.object(startup, 'write_file', side_effect=write):
                    home.run(startup, self.recovery, 'bundle')
                self.assertEqual(reports[0]['state'], 'running' if running else 'waiting')
                self.assertEqual(reports[0]['nativeBuild'], 'b' * 64)
                self.assertEqual(reports[-1]['state'], 'stopped')
                self.assertEqual(launcher.start.call_count, 1 if running else 0)
                controller.close.assert_called_once()
                launcher.close.assert_called_once()

    def test_controller_failure_closes_and_records_failure(self):
        self.save('xmb')
        self.identities[os.getpid()] = (os.getpid(), 123, self.recovery.BOOTSTRAP)
        controller = SimpleNamespace(build='b' * 64, last_input=None,
            step=Mock(side_effect=home.HomeButtonError('hook_conflict')), close=Mock())
        self.hook.Controller.return_value = controller
        with patch.object(home, 'webos_major', return_value=9), \
             patch.object(home, 'AppLaunch') as launch, patch.object(home.signal, 'signal'):
            home.run(startup, self.recovery, 'bundle')
        controller.close.assert_called_once()
        launch.return_value.close.assert_called_once()
        state = json.loads((self.base / home.STATUS).read_text())
        self.assertEqual((state['state'], state['reason']), ('stopped', 'hook_conflict'))

    def test_bootstrap_get_verifies_bundle_without_capture_setup(self):
        module = SimpleNamespace(command=Mock(return_value={'returnValue': True}))
        with patch.object(startup, 'home_modules', return_value=(module, self.recovery, 'bundle')), \
             patch.dict(sys.modules, {startup.__name__: startup}), patch.object(startup, 'start') as start:
            self.assertTrue(startup.home_button(['get'])['returnValue'])
        module.command.assert_called_once_with(['get'], startup, self.recovery, 'bundle')
        start.assert_not_called()


if __name__ == '__main__':
    unittest.main()
