# SPDX-License-Identifier: GPL-3.0-or-later
import errno
import io
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import stop_thumbnail_helper as recovery


class RecoveryGuards(unittest.TestCase):
    def test_helper_arguments_accept_only_the_two_reviewed_scripts(self):
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
        for error in (FileNotFoundError(), ProcessLookupError()):
            with patch.object(recovery.os, "stat", side_effect=error):
                self.assertIsNone(recovery.process_identity(123))

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
