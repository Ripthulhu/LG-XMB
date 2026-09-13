# SPDX-License-Identifier: GPL-3.0-or-later
import errno
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import stop_thumbnail_helper as recovery


class RecoveryGuards(unittest.TestCase):
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
