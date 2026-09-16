# SPDX-License-Identifier: GPL-3.0-or-later
import unittest
from unittest.mock import Mock

import thumbnail_cache as tc


class UninstallTests(unittest.TestCase):
    def test_running_worker_stops_native_work_when_app_is_removed(self):
        now = [0]
        present = [True]
        def app_ready():
            if not present[0]:
                raise FileNotFoundError()
            return True
        luna = Mock(return_value={'returnValue': True, 'state': 'Standby'})
        cache = Mock()
        controller = Mock(last_status={})
        link = Mock()
        worker = tc.Worker(luna, cache, installed=lambda: present[0],
                           clock=lambda: now[0], wall=lambda: 0,
                           ensure_link=link, app_ready=app_ready)
        self.assertTrue(worker.step())
        luna.reset_mock(); controller.reset_mock(); link.reset_mock()
        present[0] = False
        now[0] = 5
        self.assertTrue(worker.step())
        now[0] += tc.APP_READY_GRACE_SECONDS - 1
        self.assertTrue(worker.step())
        now[0] += 1
        self.assertFalse(worker.step())
        self.assertEqual(cache.status.call_args.args[0]['state'], 'app_unavailable')
        luna.assert_not_called()
        controller.observe.assert_not_called()
        link.assert_not_called()

    def test_boot_mount_grace_still_allows_app_to_appear(self):
        now = [0]
        ready = Mock(side_effect=[FileNotFoundError(), True])
        luna = Mock(return_value={'returnValue': True, 'state': 'Standby'})
        worker = tc.Worker(luna, Mock(), installed=lambda: True,
                           clock=lambda: now[0], wall=lambda: 0,
                           ensure_link=Mock(), app_ready=ready)
        self.assertTrue(worker.step())
        luna.assert_not_called()
        now[0] = tc.APP_READY_GRACE_SECONDS - 1
        self.assertTrue(worker.step())
        luna.assert_called_once_with('power', {})
        self.assertIsNone(worker.app_missing_since)


if __name__ == '__main__':
    unittest.main()
