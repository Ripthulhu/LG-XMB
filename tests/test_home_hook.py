# SPDX-License-Identifier: GPL-3.0-only
"""Local Unix sockets and temporary files only; never inject into an LG process."""
import errno
import importlib.util
import os
from pathlib import Path
import socket
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import test_helper_startup as bootstrap_tests

startup = bootstrap_tests.startup
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('home_hook', ROOT / 'tv-helper/home_hook.py')
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)
BUILD = 'a' * 64


class WithoutRecvmsg:
    """Exercise the Python 2 libc path with the same real socket descriptor."""
    def __init__(self, sock):
        self.sock = sock

    def fileno(self):
        return self.sock.fileno()


class ClockTests(unittest.TestCase):
    def test_python2_clock_matches_native_protocol_precision(self):
        with patch.object(hook, 'time', SimpleNamespace()):
            before = time.clock_gettime(7)
            observed = hook.clock()
            after = time.clock_gettime(7)
        self.assertGreaterEqual(observed, before, 'A truncated uptime makes fresh native messages look future-dated')
        self.assertLessEqual(observed, after)


class ReceiveTests(unittest.TestCase):
    def pair(self, credentials=True):
        reader, writer = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
        self.addCleanup(reader.close)
        self.addCleanup(writer.close)
        reader.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, int(credentials))
        reader.setblocking(False)
        return reader, writer

    def test_recvmsg_and_ctypes_receive_the_same_kernel_credentials(self):
        reader, writer = self.pair()
        for receiver in (reader, WithoutRecvmsg(reader)):
            writer.send(b'local packet')
            self.assertEqual(hook.receive(receiver),
                             (b'local packet', (os.getpid(), os.getuid(), os.getgid())))
            with self.assertRaises(OSError) as raised:
                hook.receive(receiver)
            self.assertIn(raised.exception.errno, (errno.EAGAIN, errno.EWOULDBLOCK))

    def test_missing_credentials_and_truncated_packets_are_rejected(self):
        for credentials, message in ((False, b'packet'), (True, b'x' * 257)):
            reader, writer = self.pair(credentials)
            for receiver in (reader, WithoutRecvmsg(reader)):
                with self.subTest(credentials=credentials, fallback=isinstance(receiver, WithoutRecvmsg)):
                    writer.send(message)
                    with self.assertRaises(hook.HookError):
                        hook.receive(receiver)


@unittest.skipUnless(os.geteuid() == 0, 'Controller credential checks require a root Linux test runner')
class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.fixture = bootstrap_tests.SetupFixture()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.runtime = self.fixture.root / 'home-button'
        self.fixture.base.mkdir()
        base = startup.open_directory(str(self.fixture.base))
        self.addCleanup(os.close, base)
        self.now = 100.0
        # This Python test process is the only allowed identity. No real LG
        # target is enumerated, inspected, renamed or attached to.
        name = Path('/proc/self/comm').read_text().strip()
        patched = patch.multiple(hook, RUNTIME=str(self.runtime), TARGETS=(name,))
        patched.start()
        self.addCleanup(patched.stop)
        self.identity = hook.process(os.getpid())
        self.assertIsNotNone(self.identity)
        self.current = {self.identity[0]: self.identity}
        for replacement in (
            patch.object(hook, 'clock', side_effect=lambda: self.now),
            patch.object(hook, 'targets', side_effect=lambda: dict(self.current)),
            patch.object(hook, 'inspect_target', return_value=True),
            patch.object(hook, 'install_artifacts', return_value=(BUILD, str(self.fixture.base / 'native'))),
        ):
            replacement.start()
            self.addCleanup(replacement.stop)
        self.spawn = patch.object(hook.subprocess, 'Popen', side_effect=AssertionError('No injection in socket tests'))
        self.spawn.start()
        self.addCleanup(self.spawn.stop)
        self.controller = hook.Controller(startup, base)
        self.addCleanup(self.controller.close)
        self.sender = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        self.sender.connect(str(self.runtime / 'control.sock'))
        self.addCleanup(self.sender.close)
        self.launch = Mock()
        self.controller.step(self.launch, timeout=0)

    def packet(self, kind='READY', **values):
        fields = {'build': BUILD, 'pid': self.identity[0], 'birth': self.identity[1],
                  'route': 'lginput', 'stamp': int(self.now * 1000), 'code': 773, 'state': 1}
        fields.update(values)
        suffix = ('{route} {stamp}' if kind == 'READY' else '{code} {state} {stamp}')
        return ('LGXMB_HOME 1 ' + kind + ' {build} {pid} {birth} ' + suffix + '\n').format(**fields).encode('ascii')

    def send(self, message):
        self.sender.send(message)
        self.controller.step(self.launch, timeout=0)

    def arm(self):
        self.send(self.packet())
        self.assertTrue(self.controller.running)
        self.assertTrue(hook.healthy(startup, BUILD))

    def test_ready_requires_kernel_sender_current_process_and_recent_timestamp(self):
        invalid = [
            self.packet(build='b' * 64), self.packet(pid=self.identity[0] + 1000000),
            self.packet(birth=self.identity[1] + 1), self.packet(route='unknown'),
            self.packet(stamp=98499), self.packet(stamp=100001),
            self.packet().rsplit(b' ', 1)[0] + b'\n',  # Legacy READY has no sender timestamp.
            self.packet() + b'extra', b'\xff', b'x' * 257,
        ]
        for message in invalid:
            with self.subTest(message=message):
                self.send(message)
                self.assertFalse(self.controller.running)
                self.assertFalse(self.controller.ready)
                self.assertFalse((self.runtime / 'lease').exists())
        with patch.object(hook, 'process', return_value=None):
            self.send(self.packet())
        self.assertFalse(self.controller.ready, 'A disappeared/reused PID cannot announce readiness')
        self.arm()
        self.launch.assert_not_called()

    def test_already_mapped_hook_without_ready_requires_reboot_after_five_seconds(self):
        # Discovery reports this build already mapped; never retry injection
        # merely because ezinject previously returned success.
        self.now = 104.999
        self.send(self.packet('HOME'))
        self.assertFalse(self.controller.running)
        self.assertFalse((self.runtime / 'lease').exists())
        self.now = 105
        with self.assertRaisesRegex(hook.HookError, 'hook_reboot_required'):
            self.controller.step(self.launch, timeout=0)
        hook.inspect_target.assert_called_once_with(
            self.identity, self.controller.path + '/' + hook.LIBRARY)
        hook.subprocess.Popen.assert_not_called()
        self.launch.assert_not_called()
        self.assertFalse(hook.healthy(startup, BUILD))
        self.controller.close()
        self.assertFalse((self.runtime / 'lease').exists())
        self.assertFalse((self.runtime / 'control.sock').exists())

    def test_nonroot_sender_cannot_announce_ready_over_an_inherited_socket(self):
        child = os.fork()
        if child == 0:
            try:
                os.setgid(65534)
                os.setuid(65534)
                self.sender.send(self.packet(pid=os.getpid()))
            except BaseException:
                os._exit(1)
            os._exit(0)
        _, status = os.waitpid(child, 0)
        self.assertEqual(os.waitstatus_to_exitcode(status), 0)
        # The packet PID matches the kernel PID; UID alone must reject it.
        identity = (child, self.identity[1], self.identity[2])
        self.controller.identities[child] = identity
        with patch.object(hook, 'process', return_value=identity):
            self.controller._messages(self.launch)
        self.assertFalse(self.controller.ready)
        self.launch.assert_not_called()

    def test_home_accepts_only_fresh_root_presses_from_a_ready_identity(self):
        self.send(self.packet('HOME'))
        self.launch.assert_not_called()
        self.arm()
        for values in ({'code': 102}, {'state': 0}, {'state': 2}, {'stamp': 99749},
                       {'stamp': 100001}, {'birth': self.identity[1] + 1}, {'build': 'b' * 64}):
            with self.subTest(values=values):
                self.send(self.packet('HOME', **values))
        with patch.object(hook, 'process', return_value=None):
            self.send(self.packet('HOME'))
        self.launch.assert_not_called()
        for code in (125, 773, 774):
            self.send(self.packet('HOME', code=code))
        self.assertEqual(self.launch.call_count, 3)
        self.assertEqual(self.controller.last_input, {'source': self.identity[2], 'code': 774})

    def test_expired_ready_and_queued_pre_standby_ready_cannot_renew_the_lease(self):
        self.arm()
        self.now = 102.01
        self.send(self.packet('HOME'))
        self.launch.assert_not_called()
        self.assertFalse(self.controller.running)
        self.assertFalse((self.runtime / 'lease').exists())
        self.send(self.packet(stamp=100000))
        self.assertFalse(self.controller.running)
        self.assertFalse((self.runtime / 'lease').exists())
        self.arm()

    def test_another_target_without_readiness_disarms_existing_routes(self):
        self.arm()
        pid = self.identity[0] + 1000000
        self.current[pid] = (pid, 123, 'synthetic second target')
        self.controller.next_scan = 0
        self.controller.step(self.launch, timeout=0)
        self.assertFalse(self.controller.running)
        self.assertFalse((self.runtime / 'lease').exists())
        self.send(self.packet('HOME'))
        self.launch.assert_not_called()

    def test_reused_pid_loses_readiness_and_no_targets_means_unavailable(self):
        self.arm()
        self.current[self.identity[0]] = (self.identity[0], self.identity[1] + 1, self.identity[2])
        self.controller.next_scan = 0
        self.controller.step(self.launch, timeout=0)
        self.assertFalse(self.controller.ready)
        self.assertFalse(self.controller.running)
        self.assertFalse((self.runtime / 'lease').exists())
        self.current.clear()
        self.controller.next_scan = 0
        self.controller.step(self.launch, timeout=0)
        self.assertEqual(self.controller.reason, 'hook_unavailable')

    def test_zombie_process_is_not_a_live_input_target(self):
        child = os.fork()
        if child == 0:
            os._exit(0)
        try:
            os.waitid(os.P_PID, child, os.WEXITED | os.WNOWAIT)
            self.assertIsNone(hook.process(child))
        finally:
            os.waitpid(child, 0)

    def test_lease_health_rejects_expiry_future_build_and_unsafe_files(self):
        self.arm()
        self.now = 101.999
        self.assertTrue(hook.healthy(startup, BUILD))
        self.now = 102
        self.assertFalse(hook.healthy(startup, BUILD))
        self.now = 99.999
        self.assertFalse(hook.healthy(startup, BUILD))
        self.now = 100
        self.assertFalse(hook.healthy(startup, 'b' * 64))
        lease = self.runtime / 'lease'
        lease.chmod(0o666)
        self.assertFalse(hook.healthy(startup, BUILD))
        lease.chmod(0o600)
        endpoint = self.runtime / 'control.sock'
        endpoint.chmod(0o666)
        self.assertFalse(hook.healthy(startup, BUILD))
        endpoint.chmod(0o600)
        self.assertTrue(hook.healthy(startup, BUILD))

    def test_disarm_and_close_remove_permission_to_consume_home(self):
        self.arm()
        hook.disarm()
        self.assertFalse(hook.healthy(startup, BUILD))
        self.assertFalse((self.runtime / 'lease').exists())
        self.sender.send(self.packet('HOME'))
        self.controller._messages(self.launch)
        self.launch.assert_not_called()
        self.controller.close()
        self.assertFalse((self.runtime / 'control.sock').exists())
        self.assertFalse(hook.healthy(startup, BUILD))
        hook.disarm()
        self.controller.close()

    def test_close_releases_descriptors_even_when_a_foreign_lease_is_preserved(self):
        self.arm()
        lease = self.runtime / 'lease'
        lease.chmod(0o666)
        with self.assertRaisesRegex(hook.HookError, 'hook_conflict'):
            self.controller.close()
        self.assertTrue(lease.exists())
        self.assertIsNone(self.controller.socket)
        self.assertIsNone(self.controller.directory)
        self.assertFalse((self.runtime / 'control.sock').exists())
        self.assertFalse(hook.healthy(startup, BUILD))


if __name__ == '__main__':
    unittest.main()
