# SPDX-License-Identifier: GPL-3.0-or-later
import errno
import hashlib
import io
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import stop_thumbnail_helper as recovery


class RecoveryGuards(unittest.TestCase):
    def test_thumbnail_arguments_accept_only_the_two_reviewed_scripts(self):
        for script in (recovery.HELPER, recovery.LEGACY_HELPER):
            for interpreter in (b"python3", recovery.PYTHON.encode()):
                for flags in ([], [b"-I", b"-B"]):
                    raw = b"\0".join([interpreter] + flags + [script, b"--allow-home-preview", b""])
                    self.assertEqual(recovery.helper_argument(raw), script)
        for argv in ([b"python3"], [b"/other/python3", recovery.HELPER],
                     [b"python3", b"-c", recovery.HELPER],
                     [b"python3", recovery.HELPER + b".old"],
                     [b"python3", b"/foreign.py", recovery.HELPER]):
            self.assertIsNone(recovery.helper_argument(b"\0".join(argv) + b"\0"))

    def test_home_worker_requires_exact_bootstrap_command_and_flags(self):
        worker = [b"-I", b"-B", recovery.BOOTSTRAP, b"home-button-worker"]
        for interpreter in (b"python3", recovery.PYTHON.encode()):
            raw = b"\0".join([interpreter] + worker) + b"\0"
            self.assertEqual(recovery.helper_argument(raw), recovery.BOOTSTRAP)
        for arguments in (
                [recovery.BOOTSTRAP, b"home-button-worker"],
                [b"-I", recovery.BOOTSTRAP, b"home-button-worker"],
                [b"-B", b"-I", recovery.BOOTSTRAP, b"home-button-worker"],
                [b"-I", b"-B", recovery.BOOTSTRAP],
                [b"-I", b"-B", recovery.BOOTSTRAP, b"ensure"],
                [b"-I", b"-B", recovery.BOOTSTRAP, b"home-button", b"get"],
                [b"-I", b"-B", recovery.BOOTSTRAP, b"home-button", b"set", b"xmb", b"0" * 64],
                [b"-I", b"-B", recovery.BOOTSTRAP + b".old", b"home-button-worker"],
                worker + [b"extra"], worker + [b""]):
            with self.subTest(arguments=arguments):
                raw = b"\0".join([b"python3"] + arguments) + b"\0"
                self.assertIsNone(recovery.helper_argument(raw))
        self.assertIsNone(recovery.helper_argument(b"\0".join([b"/other/python3"] + worker) + b"\0"))

    def test_legacy_python_home_worker_requires_absolute_interpreter_and_isolated_flags(self):
        worker = [b"-E", b"-s", b"-S", b"-B", recovery.BOOTSTRAP, b"home-button-worker"]
        for interpreter in recovery.PYTHONS:
            raw = b"\0".join([interpreter.encode()] + worker) + b"\0"
            self.assertEqual(recovery.helper_argument(raw), recovery.BOOTSTRAP)
            for arguments in (worker[1:], worker[:2] + worker[3:], worker + [b"extra"],
                              worker[:-1] + [b"ensure"], worker[:-1] + [b"home-button", b"get"],
                              worker[:4] + [recovery.HELPER], [recovery.HELPER]):
                with self.subTest(interpreter=interpreter, arguments=arguments):
                    raw = b"\0".join([interpreter.encode()] + arguments) + b"\0"
                    # Python 3 retains its existing unflagged capture recognition.
                    if interpreter == recovery.PYTHON and arguments == [recovery.HELPER]:
                        self.assertEqual(recovery.helper_argument(raw), recovery.HELPER)
                    else:
                        self.assertIsNone(recovery.helper_argument(raw))
        for interpreter in (b"python", b"python2", b"python3", b"/other/python",
                            b"/usr/bin/python2.7"):
            self.assertIsNone(recovery.helper_argument(b"\0".join([interpreter] + worker) + b"\0"))

    def test_process_identity_reads_owner_interpreter_and_birth(self):
        argv = b"\0".join([recovery.PYTHON.encode(), b"-I", b"-B", recovery.HELPER, b""])
        def opened(path, *args, **kwargs):
            if path.endswith("/cmdline"):
                return io.BytesIO(argv)
            self.assertEqual(path, "/proc/123/stat")
            # Parentheses in the process name must not shift the start-time field.
            return io.StringIO("123 (worker (name)) S " + "0 " * 18 + "987 0 0")
        with patch.object(recovery.os, "stat", return_value=SimpleNamespace(st_uid=0)), \
             patch.object(recovery.os.path, "samefile", return_value=True) as interpreter, \
             patch("builtins.open", side_effect=opened):
            self.assertEqual(recovery.process_identity(123), (123, 987, argv))
        interpreter.assert_called_once_with("/proc/123/exe", recovery.PYTHON)

    def test_isolated_capture_worker_requires_exact_command(self):
        worker = [b"-E", b"-s", b"-S", b"-B", recovery.HELPER, b"--allow-home-preview"]
        for executable in recovery.PYTHONS:
            raw = b"\0".join([executable.encode()] + worker + [b""])
            self.assertEqual(recovery.helper_argument(raw), recovery.HELPER)
            with patch.object(recovery.os, "stat", return_value=SimpleNamespace(st_uid=0)), \
                 patch.object(recovery.os.path, "samefile", return_value=True) as interpreter, \
                 patch("builtins.open", side_effect=lambda path, *a:
                       io.BytesIO(raw) if path.endswith("cmdline") else
                       io.StringIO("123 (worker) S " + "0 " * 18 + "987")):
                self.assertEqual(recovery.process_identity(123), (123, 987, raw))
                interpreter.assert_called_once_with("/proc/123/exe", executable)
            for arguments in (worker[1:], worker[:-1], worker + [b"extra"],
                              worker[:4] + [recovery.LEGACY_HELPER, b"--allow-home-preview"]):
                with self.subTest(executable=executable, arguments=arguments):
                    raw = b"\0".join([executable.encode()] + arguments) + b"\0"
                    self.assertIsNone(recovery.helper_argument(raw))
        self.assertIsNone(recovery.helper_argument(b"\0".join([b"python2"] + worker) + b"\0"))

    def test_home_process_identity_checks_the_interpreter_from_its_exact_argv(self):
        for executable in recovery.PYTHONS:
            raw = b"\0".join([executable.encode(), b"-E", b"-s", b"-S", b"-B",
                                recovery.BOOTSTRAP, b"home-button-worker", b""])
            with self.subTest(executable=executable), \
                 patch.object(recovery.os, "stat", return_value=SimpleNamespace(st_uid=0)), \
                 patch.object(recovery.os.path, "samefile", return_value=True) as interpreter, \
                 patch("builtins.open", side_effect=lambda path, *a:
                       io.BytesIO(raw) if path.endswith("cmdline") else
                       io.StringIO("123 (worker) S " + "0 " * 18 + "987")):
                self.assertEqual(recovery.process_identity(123), (123, 987, raw))
                interpreter.assert_called_once_with("/proc/123/exe", executable)

    def test_foreign_owner_unrelated_script_and_zombie_are_not_helpers(self):
        valid = b"\0".join([recovery.PYTHON.encode(), recovery.HELPER, b""])
        for uid, raw, state in ((1001, valid, "S"), (0, b"python3\0/foreign.py\0", "S"),
                                (0, valid, "Z")):
            with self.subTest(uid=uid, raw=raw, state=state), \
                 patch.object(recovery.os, "stat", return_value=SimpleNamespace(st_uid=uid)), \
                 patch.object(recovery.os.path, "samefile", return_value=True), \
                 patch("builtins.open", side_effect=lambda path, *a, **kw:
                       io.BytesIO(raw) if path.endswith("cmdline") else
                       io.StringIO("123 (worker) " + state + " " + "0 " * 18 + "987")):
                self.assertIsNone(recovery.process_identity(123))

    def test_mismatched_interpreter_refuses_and_disappearing_process_is_absent(self):
        raw = b"\0".join([recovery.PYTHON.encode(), recovery.HELPER, b""])
        with patch.object(recovery.os, "stat", return_value=SimpleNamespace(st_uid=0)), \
             patch.object(recovery.os.path, "samefile", return_value=False), \
             patch("builtins.open", return_value=io.BytesIO(raw)):
            with self.assertRaisesRegex(RuntimeError, "different interpreter"):
                recovery.process_identity(123)
        for error in (IOError(errno.ENOENT, "gone"), OSError(errno.ESRCH, "gone")):
            with patch.object(recovery.os, "stat", side_effect=error):
                self.assertIsNone(recovery.process_identity(123))
        with patch.object(recovery.os, "stat", side_effect=IOError(errno.EACCES, "denied")):
            with self.assertRaises(OSError):
                recovery.process_identity(123)

    def test_python2_monotonic_reads_bounded_boot_time_and_rejects_invalid_values(self):
        with patch.object(recovery, "time", SimpleNamespace()), \
             patch("builtins.open", return_value=io.BytesIO(b"123.45 987.65\n")):
            self.assertEqual(recovery.monotonic(), 123.45)
        for raw in (b"", b"bad", b"-1 0", b"nan 0", b"inf 0", b"1 " + b"0" * 127):
            with self.subTest(raw=raw), patch.object(recovery, "time", SimpleNamespace()), \
                 patch("builtins.open", return_value=io.BytesIO(raw)):
                with self.assertRaisesRegex(RuntimeError, "Invalid monotonic clock"):
                    recovery.monotonic()

    def test_anchored_names_cannot_escape_the_held_directory(self):
        self.assertEqual(recovery.at(12, recovery.HOOK_NAME), "/proc/self/fd/12/" + recovery.HOOK_NAME)
        for name in ("", ".", "..", "../other", "/absolute", "bad\0name"):
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, "anchored filename"):
                recovery.at(12, name)

    def test_hook_content_rechecked_without_nanosecond_timestamps(self):
        entry = SimpleNamespace(st_dev=1, st_ino=2, st_mode=stat.S_IFREG | 0o755,
                                st_uid=0, st_nlink=1, st_size=3, st_mtime=1.0, st_ctime=1.0)
        hashes = {hashlib.sha256(raw).hexdigest() for raw in (b"old", b"new")}
        with patch.object(recovery.os, "lstat", return_value=entry), \
             patch.object(recovery.os, "fstat", return_value=entry), \
             patch.object(recovery.os, "open", return_value=123), \
             patch.object(recovery.os, "close"), patch.object(recovery.os, "lseek"), \
             patch.object(recovery.os, "read", side_effect=[b"old", b"old", b"new", b"new"]), \
             patch.object(recovery, "HOOK_HASHES", hashes), \
             patch.object(recovery.os, "unlink") as unlink:
            snapshot = recovery.read_hook(12)
            with self.assertRaisesRegex(RuntimeError, "changed; refusing"):
                recovery.remove_hook(12, snapshot)
            unlink.assert_not_called()
        with patch.object(recovery.os, "lstat", return_value=entry), \
             patch.object(recovery.os, "fstat", return_value=entry), \
             patch.object(recovery.os, "open", return_value=123), \
             patch.object(recovery.os, "close"), patch.object(recovery.os, "lseek"), \
             patch.object(recovery.os, "read", side_effect=[b"old", b"new"]):
            with self.assertRaisesRegex(RuntimeError, "hook changed"):
                recovery.read_hook(12)

    def test_root_regular_file_only(self):
        def entry(mode=stat.S_IFREG | 0o755, uid=0, links=1):
            return SimpleNamespace(st_mode=mode, st_uid=uid, st_nlink=links)
        self.assertTrue(recovery.regular_owned(entry()))
        for item in (entry(stat.S_IFLNK | 0o755), entry(uid=1), entry(links=2),
                     entry(stat.S_IFREG | 0o777)):
            self.assertFalse(recovery.regular_owned(item))

    def test_changed_pid_never_signalled(self):
        identity = (123, 42, b"verified helper")
        with patch.object(recovery.os, "pidfd_open", return_value=5, create=True), \
             patch.object(recovery.signal, "pidfd_send_signal", create=True) as send, \
             patch.object(recovery.os, "close") as close, \
             patch.object(recovery, "process_identity", return_value=None), \
             patch.object(recovery.os, "kill") as kill:
            self.assertFalse(recovery.stop_one(identity))
        send.assert_not_called()
        kill.assert_not_called()
        close.assert_called_once_with(5)

    def test_pid_descriptor_only_sigterm(self):
        identity = (123, 42, b"verified helper")
        with patch.object(recovery.os, "pidfd_open", return_value=5, create=True), \
             patch.object(recovery.signal, "pidfd_send_signal", create=True) as send, \
             patch.object(recovery.os, "close"), \
             patch.object(recovery, "process_identity", return_value=identity), \
             patch.object(recovery.os, "kill") as kill:
            self.assertTrue(recovery.stop_one(identity))
        send.assert_called_once_with(5, recovery.signal.SIGTERM)
        kill.assert_not_called()

    def test_old_kernel_fallback_still_rechecks_identity(self):
        identity = (123, 42, b"verified helper")
        with patch.object(recovery.os, "pidfd_open", side_effect=OSError(errno.ENOSYS, "unsupported"), create=True), \
             patch.object(recovery.signal, "pidfd_send_signal", create=True) as send, \
             patch.object(recovery, "process_identity", return_value=identity) as check, \
             patch.object(recovery.os, "kill") as kill:
            self.assertTrue(recovery.stop_one(identity))
        check.assert_called_once_with(123)
        kill.assert_called_once_with(123, recovery.signal.SIGTERM)
        send.assert_not_called()

    def test_optional_absent_helper_and_hook_succeed(self):
        with patch.object(recovery.os, "geteuid", return_value=0, create=True), \
             patch.object(recovery, "inspect_hook", return_value=(None, None)), \
             patch.object(recovery, "find_helpers", return_value=[]), \
             patch.object(recovery, "stop_one") as stop, \
             patch("builtins.print"):
            recovery.main()
        stop.assert_not_called()

    def test_failed_stop_halts_without_force_or_retry(self):
        identity = (123, 42, b"verified helper")
        with patch.object(recovery.os, "geteuid", return_value=0, create=True), \
             patch.object(recovery, "inspect_hook", return_value=(None, None)), \
             patch.object(recovery, "find_helpers", return_value=[identity]), \
             patch.object(recovery, "stop_one", return_value=True) as stop, \
             patch.object(recovery, "process_identity", return_value=identity), \
             patch.object(recovery.time, "monotonic", side_effect=[0, 41]), \
             patch.object(recovery.os, "kill") as kill:
            with self.assertRaisesRegex(RuntimeError, "without force"):
                recovery.main()
        stop.assert_called_once_with(identity)
        kill.assert_not_called()


if __name__ == "__main__":
    unittest.main()
