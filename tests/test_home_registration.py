# SPDX-License-Identifier: GPL-3.0-or-later
"""Exercise the Home refresh transaction without touching any TV services."""
import importlib.util
import json
from pathlib import Path
import stat
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("home_registration", ROOT / "tools/refresh-home-registration.py")
home = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(home)
MANIFEST = {"id": home.HOME_ID, "type": "web", "version": "0.1.31",
            "main": "index.html", "supportQuickStart": True}


class FakeTV:
    def __init__(self, matched=False, dmost=True):
        self.matched = matched
        self.has_observer = True
        self.foreground = home.HOME_ID
        self.power = "Active"
        self.launches = []
        self.settings = {}
        self.pipelines = []
        self.states = {home.SAM: "active", home.MEDIA: "active",
                       home.DMOST: "active" if dmost else "inactive"}
        self.pids = {home.SAM: 100, home.MEDIA: 200, home.DMOST: 300 if dmost else 0}
        self.commands = []
        self.fail = set()
        self.observer_recovers = True
        self.metadata_recovers = True
        self.time = 0
        self.capture = SimpleNamespace(before=None, attempted=False,
                                       refresh=lambda owner: False,
                                       restore_availability=lambda owner: None)

    def run(self, args):
        if args[0] == "systemctl":
            if args[1] == "show":
                name = args[-1]
                return "LoadState=loaded\nActiveState=%s\nMainPID=%d\n" % (self.states[name], self.pids[name])
            self.assert_action(args)
            action, name = args[-2:]
            self.commands.append((action, name))
            if (action, name) in self.fail:
                raise home.RefreshError("fake_command_failed")
            if action == "stop":
                self.states[name] = "inactive"
                self.pids[name] = 0
                if name == home.MEDIA:
                    self.states[home.DMOST] = "inactive"  # Requires=umediaserver
                    self.pids[home.DMOST] = 0
                    self.has_observer = False
            else:
                self.states[name] = "active"
                self.pids[name] += 1
                if name == home.SAM and action == "restart":
                    self.has_observer = False
                    self.matched = self.metadata_recovers
                if name == home.MEDIA:
                    self.has_observer = self.observer_recovers
            return ""
        uri = args[-2].removeprefix("luna://")
        if uri.endswith("/getAppInfo"):
            app = dict(MANIFEST, folderPath=str(home.HOME))
            if not self.matched:
                app.update(type="flutter", version="2.0.0")
            return json.dumps({"returnValue": True, "appInfo": app})
        if uri.endswith("/subscriptions"):
            subscribers = [{"service_name": home.OBSERVER}] if self.has_observer else []
            return json.dumps({"returnValue": True, "subscriptions": [
                {"key": "getAppLifeStatus", "subscribers": subscribers}]})
        if uri.endswith("/getForegroundAppInfo"):
            return json.dumps({"returnValue": True, "appId": self.foreground})
        if uri.endswith("/getActivePipelines"):
            return json.dumps(self.pipelines)
        if uri.endswith("/getPowerState"):
            return json.dumps({"returnValue": True, "state": self.power})
        if uri.endswith("/getSystemSettings"):
            return json.dumps({"returnValue": True, "settings": self.settings})
        if uri.endswith("/launch"):
            app = json.loads(args[-1])["id"]
            self.launches.append(app)
            self.foreground = app
            return json.dumps({"returnValue": True})
        raise AssertionError(uri)

    @staticmethod
    def assert_action(args):
        assert args[1] == "--no-block"
        assert args[-2] in ("start", "stop", "restart")
        assert args[-1] in (home.SAM, home.MEDIA, home.DMOST)

    def sleep(self, duration):
        self.time += duration

    def operation(self, validate=lambda: dict(MANIFEST)):
        return home.HomeRegistration("systemctl", run=self.run, validate=validate,
                                     clock=lambda: self.time, sleep=self.sleep,
                                     capture_factory=lambda: self.capture)


class RefreshTests(unittest.TestCase):
    def test_order_drops_media_before_sam_then_restores_observer_and_dmost(self):
        tv = FakeTV()
        result = tv.operation().refresh()
        self.assertEqual(tv.commands, [("stop", home.MEDIA), ("restart", home.SAM),
                                       ("start", home.MEDIA), ("start", home.DMOST)])
        self.assertEqual(result, {"changed": True, "mediaObserver": True, "dmostRestored": True,
                                  "captureRefreshed": False})
        self.assertTrue(tv.has_observer)

    def test_matching_registration_is_a_noop(self):
        tv = FakeTV(matched=True)
        self.assertFalse(tv.operation().refresh()["changed"])
        self.assertEqual(tv.commands, [])

    def test_force_exercises_the_same_guarded_transaction(self):
        tv = FakeTV(matched=True)
        self.assertTrue(tv.operation().refresh(force=True)["changed"])
        self.assertEqual(tv.commands.count(("restart", home.SAM)), 1)

    def test_check_reads_transaction_readiness_without_mutation(self):
        tv = FakeTV(matched=True)
        self.assertEqual(tv.operation().check(), {"readyToRefresh": True, "registered": True,
                                                 "mediaObserver": True, "dmostActive": True,
                                                 "captureRunning": False})
        self.assertEqual(tv.commands, [])

    def test_matching_registration_with_lost_observer_reports_without_restart(self):
        tv = FakeTV(matched=True)
        tv.has_observer = False
        with self.assertRaisesRegex(home.RefreshError, "media_observer_missing"):
            tv.operation().refresh()
        self.assertEqual(tv.commands, [])

    def test_inactive_dmost_stays_inactive(self):
        tv = FakeTV(dmost=False)
        self.assertFalse(tv.operation().refresh()["dmostRestored"])
        self.assertEqual(tv.states[home.DMOST], "inactive")
        self.assertNotIn(("start", home.DMOST), tv.commands)

    def test_native_app_foreground_aborts_even_when_forced(self):
        tv = FakeTV()
        tv.foreground = "com.webos.app.hdmi1"
        with self.assertRaisesRegex(home.RefreshError, "leave_other_apps_before_refresh"):
            tv.operation().refresh(force=True)
        self.assertEqual(tv.commands, [])

    def test_recording_and_unknown_media_are_not_interrupted(self):
        for kind in ("record", "tv_bg", "camera", "tv", "unknown"):
            with self.subTest(kind=kind):
                tv = FakeTV()
                tv.pipelines = [{"type": kind, "resource": [], "currentAppId": home.HOME_ID}]
                with self.assertRaisesRegex(home.RefreshError, "media_in_use"):
                    tv.operation().refresh()
                self.assertEqual(tv.commands, [])

    def test_empty_background_service_clients_are_allowed(self):
        tv = FakeTV()
        tv.pipelines = [{"type": "dvbcasrmc", "resource": []},
                        {"type": "avconnector", "resource": []}]
        self.assertTrue(tv.operation().refresh()["changed"])

    def test_exact_native_empty_pipeline_object_is_allowed(self):
        tv = FakeTV()
        tv.pipelines = {"returnValue": True, "errorCode": 0,
                        "data": "pipeline empty", "mediaId": "<anonymous>"}
        self.assertTrue(tv.operation().refresh()["changed"])

    def test_unclear_successful_pipeline_object_is_not_empty(self):
        tv = FakeTV()
        tv.pipelines = {"returnValue": True, "data": "unknown"}
        with self.assertRaisesRegex(home.RefreshError, "invalid_media_status"):
            tv.operation().refresh()
        self.assertEqual(tv.commands, [])

    def test_inactive_last_hdmi_receiver_behind_home_is_allowed(self):
        tv = FakeTV()
        tv.pipelines = [{"type": "tv", "currentAppId": "com.webos.app.hdmi1",
                         "is_foreground": False, "is_focus": False,
                         "resource": [{"resource": "HDMI_INPUT"}, {"resource": "VHDMIRX"},
                                      {"resource": "AHDMIRX"}, {"resource": "ADEC"}]}]
        self.assertTrue(tv.operation().refresh()["changed"])

    def test_inactive_input_with_recording_or_unknown_resource_is_rejected(self):
        for resource in ("DVR_HANDLE", "VENC", "unknown"):
            tv = FakeTV()
            tv.pipelines = [{"type": "tv", "currentAppId": "com.webos.app.livetv",
                             "is_foreground": False, "is_focus": False,
                             "resource": [{"resource": resource}]}]
            with self.assertRaisesRegex(home.RefreshError, "media_in_use"):
                tv.operation().refresh()
            self.assertEqual(tv.commands, [])

    def test_focused_or_ambiguous_hdmi_pipeline_is_rejected(self):
        for focus in (True, None):
            tv = FakeTV()
            tv.pipelines = [{"type": "tv", "currentAppId": "com.webos.app.hdmi1",
                             "is_foreground": False, "is_focus": focus, "resource": []}]
            with self.assertRaisesRegex(home.RefreshError, "media_in_use"):
                tv.operation().refresh()
            self.assertEqual(tv.commands, [])

    def test_resource_holding_background_client_aborts(self):
        tv = FakeTV()
        tv.pipelines = [{"type": "avconnector", "resource": [{"resource": "HDMI_INPUT"}]}]
        with self.assertRaisesRegex(home.RefreshError, "media_in_use"):
            tv.operation().refresh()
        self.assertEqual(tv.commands, [])

    def test_payload_change_during_preflight_aborts(self):
        tv = FakeTV()
        manifests = iter([MANIFEST, dict(MANIFEST, version="different")])
        with self.assertRaisesRegex(home.RefreshError, "payload_changed"):
            tv.operation(validate=lambda: next(manifests)).refresh()
        self.assertEqual(tv.commands, [])

    def test_failed_sam_restart_restores_stopped_services_without_second_restart(self):
        tv = FakeTV()
        tv.fail.add(("restart", home.SAM))
        with self.assertRaisesRegex(home.RefreshError, "fake_command_failed"):
            tv.operation().refresh()
        self.assertEqual(tv.commands, [("stop", home.MEDIA), ("restart", home.SAM),
                                       ("start", home.SAM), ("start", home.MEDIA), ("start", home.DMOST)])
        self.assertTrue(all(value == "active" for value in tv.states.values()))

    def test_failed_stop_does_not_restart_sam(self):
        tv = FakeTV()
        tv.fail.add(("stop", home.MEDIA))
        with self.assertRaises(home.RefreshError):
            tv.operation().refresh()
        self.assertNotIn(("restart", home.SAM), tv.commands)
        self.assertEqual(tv.states[home.MEDIA], "active")

    def test_missing_observer_has_bounded_wait_and_no_restart_loop(self):
        tv = FakeTV()
        tv.observer_recovers = False
        with self.assertRaisesRegex(home.RefreshError, "media_observer_timeout"):
            tv.operation().refresh()
        self.assertEqual(tv.time, home.WAIT_SECONDS)
        self.assertEqual(tv.commands.count(("restart", home.SAM)), 1)
        self.assertNotIn(("restart", home.MEDIA), tv.commands)
        self.assertTrue(all(value == "active" for value in tv.states.values()))

    def test_early_media_reactivation_fails_without_repeated_service_restarts(self):
        tv = FakeTV()
        base_run = tv.run
        def run(args):
            value = base_run(args)
            if args[-2:] == ["restart", home.SAM]:
                tv.states[home.MEDIA] = "active"
                tv.pids[home.MEDIA] = 999
            return value
        operation = tv.operation()
        operation.run = run
        with self.assertRaisesRegex(home.RefreshError, "media_restarted_during_refresh"):
            operation.refresh()
        self.assertEqual(tv.commands.count(("restart", home.SAM)), 1)
        self.assertEqual(tv.commands.count(("stop", home.MEDIA)), 1)
        self.assertNotIn(("restart", home.MEDIA), tv.commands)

    def test_registration_timeout_restores_media(self):
        tv = FakeTV()
        tv.metadata_recovers = False
        with self.assertRaisesRegex(home.RefreshError, "home_registration_timeout"):
            tv.operation().refresh()
        self.assertEqual(tv.time, home.WAIT_SECONDS)
        self.assertEqual(tv.states[home.MEDIA], "active")

    def test_recovery_failure_does_not_mask_original_error(self):
        tv = FakeTV()
        tv.fail.update({("restart", home.SAM), ("start", home.MEDIA)})
        operation = tv.operation()
        with self.assertRaisesRegex(home.RefreshError, "fake_command_failed"):
            operation.refresh()
        self.assertEqual(operation.recovery_errors,
                         [{"service": home.MEDIA, "error": "fake_command_failed"}])

    def test_failure_does_not_enable_previously_inactive_dmost(self):
        tv = FakeTV(dmost=False)
        tv.fail.add(("restart", home.SAM))
        with self.assertRaises(home.RefreshError):
            tv.operation().refresh()
        self.assertNotIn(("start", home.DMOST), tv.commands)

    def test_uncertain_media_reply_aborts_before_changes(self):
        tv = FakeTV()
        tv.pipelines = {"returnValue": False}
        with self.assertRaisesRegex(home.RefreshError, "service_refused"):
            tv.operation().refresh()
        self.assertEqual(tv.commands, [])


class StartupTests(unittest.TestCase):
    def setUp(self):
        self.tv = FakeTV()
        self.input = "com.webos.app.hdmi1"
        self.tv.foreground = self.input
        # These are the owners/types/resources observed on the C5 at boot.
        self.tv.pipelines = [
            self.pipeline("avconnector", ["MAIN_SOUND"]),
            self.pipeline("avconnector", ["MAIN_SCALER"]),
            self.pipeline("tv", ["HDMI_INPUT", "VHDMIRX", "AHDMIRX", "ADEC",
                                 "ADEC_BANDWIDTH", "SUB_SCALER"]),
            {"type": "vtclient", "resource": []},
        ]

    def pipeline(self, kind, resources):
        return {"currentAppId": self.input, "type": kind, "is_foreground": True,
                "is_focus": False, "sharedAppIdList": "",
                "resource": [{"resource": resource} for resource in resources]}

    def test_boot_selected_hdmi_is_restored_after_services_and_capture(self):
        capture_checked = []
        def capture(owner):
            self.assertEqual(self.tv.states[home.MEDIA], "active")
            self.assertTrue(owner.observer())
            owner.preflight()  # Capture's later check retains the same input allowance.
            capture_checked.append(True)
            return True
        self.tv.capture.refresh = capture
        operation = self.tv.operation()
        run = operation.run
        def ordered(args):
            if args[-2] == "luna://com.webos.applicationManager/launch":
                self.assertEqual(capture_checked, [True])
                self.assertTrue(self.tv.has_observer)
                self.assertTrue(all(state == "active" for state in self.tv.states.values()))
            return run(args)
        operation.run = ordered
        result = operation.refresh(startup=True)
        self.assertEqual(result["restoredInput"], self.input)
        self.assertEqual(self.tv.launches, [self.input])
        self.assertEqual(self.tv.commands.count(("restart", home.SAM)), 1)

    def test_recent_input_survives_home_fallback_before_startup_hook(self):
        for foreground in ("", home.HOME_ID):
            with self.subTest(foreground=foreground):
                tv = FakeTV()
                tv.foreground = foreground
                tv.settings = {"homeAutoLaunch": "off",
                               "physicalLastInputApp": "com.webos.app.hdmi2",
                               "lastInputApp": "com.webos.app.hdmi1"}
                result = tv.operation().refresh(startup=True)
                self.assertEqual(result["restoredInput"], "com.webos.app.hdmi2")
                self.assertEqual(tv.launches, ["com.webos.app.hdmi2"])

    def test_home_power_on_choice_does_not_redirect(self):
        tv = FakeTV()
        tv.settings = {"homeAutoLaunch": "on", "physicalLastInputApp": self.input}
        self.assertIsNone(tv.operation().refresh(startup=True)["restoredInput"])
        self.assertEqual(tv.launches, [])

    def test_recent_input_fallback_accepts_only_native_inputs(self):
        for candidate in ("com.webos.app.hdmi4", "com.webos.app.livetv",
                          "youtube.leanback.v4", home.HOME_ID, "com.webos.app.hdmi5", None):
            with self.subTest(candidate=candidate):
                tv = FakeTV()
                tv.settings = {"homeAutoLaunch": "off", "lastInputApp": candidate}
                result = tv.operation().refresh(startup=True)
                expected = candidate if candidate in ("com.webos.app.hdmi4", "com.webos.app.livetv") else None
                self.assertEqual(result["restoredInput"], expected)

    def test_unknown_or_unavailable_settings_do_not_choose_input(self):
        for response in ({"returnValue": False}, {"returnValue": True},
                         {"returnValue": True, "settings": []},
                         {"returnValue": True, "settings": {"homeAutoLaunch": False,
                                                            "lastInputApp": self.input}}):
            with self.subTest(response=response):
                tv = FakeTV()
                operation = tv.operation()
                run = operation.run
                operation.run = lambda args: (json.dumps(response) if args[-2].endswith('/getSystemSettings')
                                              else run(args))
                self.assertIsNone(operation.refresh(startup=True)["restoredInput"])
                self.assertEqual(tv.launches, [])

    def test_saved_input_does_not_override_real_boot_selection(self):
        self.tv.settings = {"homeAutoLaunch": "off", "physicalLastInputApp": "com.webos.app.hdmi2"}
        self.assertEqual(self.tv.operation().refresh(startup=True)["restoredInput"], self.input)

    def test_saved_input_does_not_wake_standby_boot(self):
        tv = FakeTV()
        tv.power = "Suspend"
        tv.settings = {"homeAutoLaunch": "off", "physicalLastInputApp": self.input}
        self.assertIsNone(tv.operation().refresh(startup=True)["restoredInput"])
        self.assertEqual(tv.launches, [])

    def test_saved_input_does_not_affect_manual_or_matched_refresh(self):
        for matched, startup in ((False, False), (True, True)):
            with self.subTest(matched=matched, startup=startup):
                tv = FakeTV(matched=matched)
                tv.settings = {"homeAutoLaunch": "off", "physicalLastInputApp": self.input}
                tv.operation().refresh(startup=startup)
                self.assertEqual(tv.launches, [])

    def test_saved_input_is_cancelled_if_settings_or_foreground_change(self):
        for change in ("setting", "input", "foreground"):
            with self.subTest(change=change):
                tv = FakeTV()
                tv.settings = {"homeAutoLaunch": "off", "physicalLastInputApp": self.input}
                def capture(owner):
                    if change == "setting":
                        tv.settings["homeAutoLaunch"] = "on"
                    elif change == "input":
                        tv.settings["physicalLastInputApp"] = "com.webos.app.hdmi2"
                    else:
                        tv.foreground = "youtube.leanback.v4"
                    return False
                tv.capture.refresh = capture
                self.assertIsNone(tv.operation().refresh(startup=True)["restoredInput"])
                self.assertEqual(tv.launches, [])

    def test_normal_manual_force_still_refuses_active_hdmi(self):
        with self.assertRaisesRegex(home.RefreshError, "leave_other_apps_before_refresh"):
            self.tv.operation().refresh(force=True)
        self.assertEqual(self.tv.commands, [])
        self.assertEqual(self.tv.launches, [])

    def test_startup_never_admits_another_foreground_app(self):
        for app in ("youtube.leanback.v4", "com.webos.app.livetv", "com.webos.app.hdmi5"):
            with self.subTest(app=app):
                self.tv.foreground = app
                with self.assertRaisesRegex(home.RefreshError, "leave_other_apps_before_refresh"):
                    self.tv.operation().refresh(startup=True)
        self.assertEqual(self.tv.commands, [])

    def test_startup_rejects_another_input_or_shared_owner(self):
        for field, value in (("currentAppId", "com.webos.app.hdmi2"),
                             ("sharedAppIdList", "casting.app")):
            with self.subTest(field=field):
                pipeline = self.pipeline("avconnector", ["MAIN_SCALER"])
                pipeline[field] = value
                self.tv.pipelines = [pipeline]
                with self.assertRaisesRegex(home.RefreshError, "media_in_use"):
                    self.tv.operation().refresh(startup=True)
        self.assertEqual(self.tv.commands, [])

    def test_startup_rejects_capture_recording_and_unknown_resources(self):
        for resource in ("VT_CAPTURE", "VTP", "VENC", "DVR_HANDLE", "unknown"):
            with self.subTest(resource=resource):
                self.tv.pipelines = [self.pipeline("tv", [resource])]
                with self.assertRaisesRegex(home.RefreshError, "media_in_use"):
                    self.tv.operation().refresh(startup=True)
        self.assertEqual(self.tv.commands, [])

    def test_standby_boot_does_not_launch_input(self):
        self.tv.power = "Suspend"
        self.assertIsNone(self.tv.operation().refresh(startup=True)["restoredInput"])
        self.assertEqual(self.tv.launches, [])

    def test_new_user_app_is_not_replaced_after_refresh(self):
        def capture(owner):
            self.tv.foreground = "youtube.leanback.v4"
            return False
        self.tv.capture.refresh = capture
        self.assertIsNone(self.tv.operation().refresh(startup=True)["restoredInput"])
        self.assertEqual(self.tv.launches, [])

    def test_failed_launch_is_not_repeated_during_recovery(self):
        operation = self.tv.operation()
        run = operation.run
        attempts = []
        def reject(args):
            if args[-2] == "luna://com.webos.applicationManager/launch":
                attempts.append(True)
                return json.dumps({"returnValue": False})
            return run(args)
        operation.run = reject
        with self.assertRaisesRegex(home.RefreshError, "service_refused"):
            operation.refresh(startup=True)
        self.assertEqual(attempts, [True])
        self.assertEqual(self.tv.commands.count(("restart", home.SAM)), 1)

    def test_matched_startup_is_a_noop_without_input_relaunch(self):
        self.tv.matched = True
        self.assertFalse(self.tv.operation().refresh(startup=True)["changed"])
        self.assertEqual(self.tv.commands, [])
        self.assertEqual(self.tv.launches, [])

    def test_accepted_launch_must_reach_foreground_without_retry(self):
        operation = self.tv.operation()
        run = operation.run
        attempts = []
        def pending(args):
            if args[-2] == "luna://com.webos.applicationManager/launch":
                attempts.append(True)
                self.tv.foreground = home.HOME_ID
                return json.dumps({"returnValue": True})
            return run(args)
        operation.run = pending
        with self.assertRaisesRegex(home.RefreshError, "input_restore_timeout"):
            operation.refresh(startup=True)
        self.assertEqual(attempts, [True])
        self.assertEqual(self.tv.time, home.WAIT_SECONDS)


class CommandTests(unittest.TestCase):
    def test_child_stdin_is_closed_and_command_has_timeout(self):
        process, selector = MagicMock(), MagicMock()
        process.__enter__.return_value = process
        process.wait.return_value = 0
        process.poll.return_value = 0
        selector.__enter__.return_value = selector
        selector.select.return_value = [True]
        with patch.object(home.subprocess, "Popen", return_value=process) as run, \
                patch.object(home.selectors, "DefaultSelector", return_value=selector), \
                patch.object(home.os, "read", side_effect=[b"ok", b""]):
            self.assertEqual(home.run_command(["test"]), "ok")
        self.assertIs(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertLessEqual(process.wait.call_args.kwargs["timeout"], 5)
        self.assertNotIn("shell", run.call_args.kwargs)

    def test_command_timeout_has_short_error(self):
        process, selector = MagicMock(), MagicMock()
        process.__enter__.return_value = process
        process.poll.return_value = None
        selector.__enter__.return_value = selector
        selector.select.return_value = []
        with patch.object(home.subprocess, "Popen", return_value=process), \
                patch.object(home.selectors, "DefaultSelector", return_value=selector):
            with self.assertRaisesRegex(home.RefreshError, "^command_timeout$"):
                home.run_command(["test"])
        process.kill.assert_called_once()

    def test_oversized_reply_stops_reading_and_kills_only_command(self):
        process, selector = MagicMock(), MagicMock()
        process.__enter__.return_value = process
        process.poll.return_value = None
        selector.__enter__.return_value = selector
        selector.select.return_value = [True]
        with patch.object(home.subprocess, "Popen", return_value=process), \
                patch.object(home.selectors, "DefaultSelector", return_value=selector), \
                patch.object(home.os, "read", return_value=b"x" * 4096) as read:
            with self.assertRaisesRegex(home.RefreshError, "^reply_too_large$"):
                home.run_command(["test"])
        self.assertEqual(read.call_count, home.MAX_REPLY // 4096 + 1)
        process.kill.assert_called_once()

    def test_writable_or_symlink_payload_is_rejected(self):
        for mode in (stat.S_IFDIR | 0o777, stat.S_IFLNK | 0o755):
            path = SimpleNamespace(lstat=lambda: SimpleNamespace(st_mode=mode, st_uid=0))
            with self.assertRaisesRegex(home.RefreshError, "unsafe_payload_path"):
                home.protected(path, directory=True)


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.tv = FakeTV()
        self.owner = self.tv.operation()
        self.old = home.CaptureIdentity(50, 100, home.CAPTURE.encode() + b"\0")
        self.new = home.CaptureIdentity(60, 300, home.CAPTURE.encode() + b"\0")
        self.current = self.old
        self.signals = []
        self.activations = 0
        self.exits = True
        self.activation_fails = False
        self.owner.query = self.activate

    def activate(self, method):
        self.assertEqual(method, "com.webos.service.capture/getCapability")
        self.activations += 1
        if self.activation_fails:
            raise home.RefreshError("service_refused")
        if self.current is None:
            self.current = self.new
        return {"returnValue": True}

    def terminate(self, identity):
        self.assertEqual(identity, self.current)
        self.signals.append(identity)
        if self.exits:
            self.current = None

    def service(self):
        # Media started at tick 200; capture tick 100 is stale, tick 300 is new.
        self.owner.preflight = lambda: None
        return home.CaptureService(scan=lambda: self.current,
                                   identify=lambda pid: self.current if self.current and self.current.pid == pid else None,
                                   terminate=self.terminate, start_time=lambda pid: 200,
                                   signal_support=lambda: None)

    def test_old_capture_receives_one_signal_then_readonly_activation(self):
        capture = self.service()
        self.assertTrue(capture.refresh(self.owner))
        self.assertEqual(self.signals, [self.old])
        self.assertEqual(self.activations, 1)
        self.assertEqual(self.current, self.new)

    def test_absent_capture_is_not_started(self):
        self.current = None
        capture = self.service()
        self.assertFalse(capture.refresh(self.owner))
        self.assertEqual(self.signals, [])
        self.assertEqual(self.activations, 0)

    def test_already_replaced_capture_after_media_is_never_signalled(self):
        capture = self.service()
        self.current = self.new
        self.assertTrue(capture.refresh(self.owner))
        self.assertEqual(self.signals, [])
        self.assertEqual(self.activations, 1)

    def test_changed_identity_older_than_media_fails_without_signal(self):
        capture = self.service()
        self.current = self.old._replace(command=self.old.command + b"unexpected\0")
        with self.assertRaisesRegex(home.RefreshError, "capture_changed_during_refresh"):
            capture.refresh(self.owner)
        self.assertEqual(self.signals, [])
        self.assertEqual(self.activations, 0)

    def test_pid_reuse_is_never_signalled(self):
        capture = self.service()
        self.current = self.old._replace(start=150)
        with self.assertRaisesRegex(home.RefreshError, "capture_changed_during_refresh"):
            capture.refresh(self.owner)
        self.assertEqual(self.signals, [])

    def test_initially_absent_capture_started_before_media_is_not_touched(self):
        self.current = None
        capture = self.service()
        self.current = self.old
        with self.assertRaisesRegex(home.RefreshError, "capture_started_during_refresh"):
            capture.refresh(self.owner)
        self.assertEqual(self.signals, [])
        self.assertEqual(self.activations, 0)

    def test_hung_capture_is_not_killed_or_repeatedly_signalled(self):
        capture = self.service()
        self.exits = False
        with self.assertRaisesRegex(home.RefreshError, "capture_stop_timeout"):
            capture.refresh(self.owner)
        capture.restore_availability(self.owner)
        self.assertEqual(self.signals, [self.old])
        self.assertEqual(self.tv.time, home.WAIT_SECONDS)
        self.assertEqual(self.activations, 0)

    def test_late_exit_receives_one_availability_restore_without_another_signal(self):
        capture = self.service()
        self.exits = False
        with self.assertRaises(home.RefreshError):
            capture.refresh(self.owner)
        self.current = None
        capture.restore_availability(self.owner)
        capture.restore_availability(self.owner)
        self.assertEqual(self.signals, [self.old])
        self.assertEqual(self.activations, 1)

    def test_failed_activation_is_reported_without_retry_loop(self):
        capture = self.service()
        self.activation_fails = True
        with self.assertRaisesRegex(home.RefreshError, "service_refused"):
            capture.refresh(self.owner)
        capture.restore_availability(self.owner)
        self.assertEqual(self.signals, [self.old])
        self.assertEqual(self.activations, 1)

    def test_resource_check_runs_again_before_capture_signal(self):
        capture = self.service()
        self.owner.preflight = lambda: home.require(False, "media_in_use")
        with self.assertRaisesRegex(home.RefreshError, "media_in_use"):
            capture.refresh(self.owner)
        self.assertEqual(self.signals, [])

    def test_last_identity_check_refuses_reused_pid(self):
        with patch.object(home, "capture_identity", return_value=self.old._replace(start=150)), \
                patch.object(home.os, "pidfd_open", return_value=1234, create=True), \
                patch.object(home.signal, "pidfd_send_signal", create=True) as send, \
                patch.object(home.os, "close") as close:
            with self.assertRaisesRegex(home.RefreshError, "capture_identity_changed"):
                home.terminate_capture(self.old)
        send.assert_not_called()
        close.assert_called_once_with(1234)

    def test_only_sigterm_is_sent_to_verified_process(self):
        with patch.object(home, "capture_identity", return_value=self.old), \
                patch.object(home.os, "pidfd_open", return_value=1234, create=True) as pin, \
                patch.object(home.signal, "pidfd_send_signal", create=True) as send, \
                patch.object(home.os, "close") as close:
            home.terminate_capture(self.old)
        pin.assert_called_once_with(self.old.pid, 0)
        send.assert_called_once_with(1234, home.signal.SIGTERM, None, 0)
        close.assert_called_once_with(1234)

    def test_pidfd_support_is_checked_before_service_changes(self):
        with self.assertRaisesRegex(home.RefreshError, "capture_restart_requires_pidfd"):
            home.CaptureService(scan=lambda: self.old,
                                signal_support=lambda: home.require(False, "capture_restart_requires_pidfd"))

    def test_kernel_pidfd_support_is_probed_before_service_changes(self):
        self.owner.capture_factory = lambda: home.CaptureService(scan=lambda: self.old)
        # The Python API can exist on a kernel that lacks one of the syscalls.
        for failure in ("open", "signal"):
            with self.subTest(failure=failure), \
                    patch.object(home.os, "pidfd_open", return_value=1234,
                                 side_effect=OSError if failure == "open" else None, create=True), \
                    patch.object(home.signal, "pidfd_send_signal",
                                 side_effect=OSError if failure == "signal" else None, create=True), \
                    patch.object(home.os, "close") as close:
                self.owner.query = home.HomeRegistration.query.__get__(self.owner)
                with self.assertRaisesRegex(home.RefreshError, "capture_restart_requires_pidfd"):
                    self.owner.refresh()
                self.assertEqual(self.tv.commands, [])
                self.assertEqual(close.call_count, int(failure == "signal"))

    def test_capability_probe_uses_signal_zero_on_own_process(self):
        with patch.object(home.os, "pidfd_open", return_value=1234, create=True) as pin, \
                patch.object(home.signal, "pidfd_send_signal", create=True) as send, \
                patch.object(home.os, "close") as close:
            home.capture_signal_support()
        pin.assert_called_once_with(home.os.getpid(), 0)
        send.assert_called_once_with(1234, 0, None, 0)
        close.assert_called_once_with(1234)

    def test_capture_exit_before_pin_continues_to_activation(self):
        capture = self.service()
        capture.terminate = home.terminate_capture
        def already_exited(pid, flags):
            self.current = None
            raise ProcessLookupError()
        with patch.object(home.os, "pidfd_open", side_effect=already_exited, create=True), \
                patch.object(home.signal, "pidfd_send_signal", create=True) as send:
            self.assertTrue(capture.refresh(self.owner))
        send.assert_not_called()
        self.assertEqual(self.activations, 1)
        self.assertEqual(self.current, self.new)

    def test_capture_exit_after_pin_never_signals_replacement(self):
        with patch.object(home, "capture_identity", return_value=None), \
                patch.object(home.os, "pidfd_open", return_value=1234, create=True), \
                patch.object(home.signal, "pidfd_send_signal", create=True) as send, \
                patch.object(home.os, "close") as close:
            home.terminate_capture(self.old)
        send.assert_not_called()
        close.assert_called_once_with(1234)

    def test_process_exit_after_final_check_does_not_target_reused_pid(self):
        with patch.object(home, "capture_identity", return_value=self.old), \
                patch.object(home.os, "pidfd_open", return_value=1234, create=True), \
                patch.object(home.signal, "pidfd_send_signal", side_effect=ProcessLookupError,
                             create=True) as send, patch.object(home.os, "close"):
            home.terminate_capture(self.old)
        self.assertEqual(send.call_count, 1)

    def test_multiple_capture_processes_are_rejected(self):
        with patch.object(home.Path, "iterdir", return_value=[Path("50"), Path("60")]), \
                patch.object(home, "capture_identity", side_effect=[self.old, self.new]):
            with self.assertRaisesRegex(home.RefreshError, "multiple_capture_processes"):
                home.capture_process()

    def test_command_identity_must_match_executable(self):
        with patch.object(home, "process_start", return_value=100), \
                patch.object(home.os, "readlink", return_value=home.CAPTURE), \
                patch.object(home.Path, "read_bytes", return_value=b"unrelated\0"):
            with self.assertRaisesRegex(home.RefreshError, "capture_identity_changed"):
                home.capture_identity(50)


if __name__ == "__main__":
    unittest.main()
