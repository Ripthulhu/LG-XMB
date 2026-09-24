# SPDX-License-Identifier: GPL-3.0-or-later
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

home = load("home_button", "tv-helper/home_button.py")
startup = load("startup_home_button", "app/helper-startup.py")


class NativeFixture:
    def __init__(self, app=None):
        self.value = {"defaultApps": {"home": app or home.APPS["stock"],
                     "browser": "com.webos.app.browser"},
                     "lastAppHandlerPolicy": "recent", "homeAutoLaunch": "off"}
        self.calls = []

    def call(self, operation, payload):
        self.calls.append((operation, payload))
        if operation == "set":
            self.value["defaultApps"]["home"] = payload["appId"]
            return {"returnValue": True}
        return {"returnValue": True, "settings": copy.deepcopy(self.value)}


class HomeButtonTests(unittest.TestCase):
    def test_get_is_read_only_and_reports_all_assignments(self):
        for app, mode in [(home.APPS["stock"], "stock"), (home.APPS["xmb"], "xmb"),
                          ("some.other.home", "other")]:
            fake = NativeFixture(app)
            result = home.public(home.settings(fake.call))
            self.assertEqual(result["mode"], mode)
            self.assertRegex(result["revision"], "^[0-9a-f]{64}$")
            self.assertEqual([op for op, _ in fake.calls], ["get"])

    def test_explicit_mapping_changes_only_home_and_preserves_power_on_settings(self):
        for mode in ("stock", "xmb"):
            fake = NativeFixture("other.home")
            before = copy.deepcopy(fake.value)
            result = home.apply(mode, home.revision(before), fake.call, lambda: False)
            self.assertEqual(result["mode"], mode)
            before["defaultApps"]["home"] = home.APPS[mode]
            self.assertEqual(fake.value, before)
            self.assertEqual([payload for op, payload in fake.calls if op == "set"],
                             [{"category": "home", "appId": home.APPS[mode]}])

    def test_stale_snapshot_and_concurrent_native_change_do_not_write(self):
        fake = NativeFixture()
        with self.assertRaisesRegex(home.HomeButtonError, "home_mapping_changed"):
            home.apply("xmb", "0" * 64, fake.call, lambda: False)
        self.assertNotIn("set", [op for op, _ in fake.calls])
        fake = NativeFixture()
        expected = home.revision(fake.value)
        def racing(op, payload):
            result = fake.call(op, payload)
            fake.value["homeAutoLaunch"] = "on"
            return result
        with self.assertRaisesRegex(home.HomeButtonError, "home_mapping_changed"):
            home.apply("xmb", expected, racing, lambda: False)
        self.assertNotIn("set", [op for op, _ in fake.calls])

    def test_already_assigned_needs_no_write(self):
        fake = NativeFixture()
        home.apply("stock", home.revision(fake.value), fake.call, lambda: False)
        self.assertEqual([op for op, _ in fake.calls], ["get"])

    def test_unconfirmed_write_is_not_retried_or_rolled_back(self):
        for failure in ("refused", "unrelated_change", "timeout"):
            fake = NativeFixture()
            def failing(op, payload):
                if op == "set":
                    if failure == "refused":
                        fake.calls.append((op, payload))
                        return {"returnValue": True}
                    result = fake.call(op, payload)
                    if failure == "timeout":
                        raise home.HomeButtonError("native_timeout")
                    fake.value["homeAutoLaunch"] = "on"
                    return result
                return fake.call(op, payload)
            with self.assertRaises(home.HomeButtonError):
                home.apply("xmb", home.revision(fake.value), failing, lambda: False)
            self.assertEqual(sum(op == "set" for op, _ in fake.calls), 1)

    def test_missing_optional_boot_preference_is_preserved(self):
        fake = NativeFixture()
        del fake.value["homeAutoLaunch"]
        result = home.apply("xmb", home.revision(fake.value), fake.call, lambda: False)
        self.assertEqual(result["mode"], "xmb")
        self.assertNotIn("homeAutoLaunch", fake.value)

    def test_invalid_settings_never_enable_a_write(self):
        for value in ({}, {"defaultApps": []}, {"defaultApps": {"home": 3},
                     "lastAppHandlerPolicy": "recent"}):
            with self.assertRaises(home.HomeButtonError):
                home.settings(lambda *args: {"settings": value})

    def test_home_overlay_blocks_both_operations_before_native_calls(self):
        with patch.object(home.os, "geteuid", return_value=0), \
             patch.object(home, "overlay_active", return_value=True), \
             patch.object(home, "settings") as read:
            for args in (["get"], ["set", "xmb", "0" * 64]):
                self.assertEqual(home.command(args)["errorCode"], "home_overlay_active")
            read.assert_not_called()
        fake = NativeFixture()
        with self.assertRaisesRegex(home.HomeButtonError, "home_overlay_active"):
            home.apply("xmb", home.revision(fake.value), fake.call, lambda: True)
        self.assertFalse(fake.calls)

    def test_overlay_detection_compares_directory_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "payload"
            source.mkdir()
            other = Path(directory) / "stock"
            other.mkdir()
            with patch.multiple(home, HOME_PAYLOAD=str(source), STOCK_HOME=str(source)):
                self.assertTrue(home.overlay_active())
            with patch.multiple(home, HOME_PAYLOAD=str(source), STOCK_HOME=str(other)):
                self.assertFalse(home.overlay_active())

    def test_bootstrap_dispatch_verifies_bundle_without_capture_or_setup(self):
        class Module:
            @staticmethod
            def command(args):
                return {"returnValue": True, "mode": "stock", "args": args}
        sources = {startup.HOME_BUTTON_MODULE: b"# verified source"}
        with patch.object(startup.os, "geteuid", return_value=0), \
             patch.object(startup, "verified_bundle", return_value=({}, b"", b"", sources)) as verify, \
             patch.object(startup, "load_module", return_value=Module) as module, \
             patch.object(startup, "start") as start, \
             patch.object(startup, "launch_worker") as worker:
            result = startup.home_button(["get"])
            self.assertEqual(result["args"], ["get"])
            verify.assert_called_once_with(allow_repair=False)
            self.assertEqual(module.call_args.args[1], b"# verified source")
            start.assert_not_called()
            worker.assert_not_called()

    def test_bootstrap_rejects_invalid_commands_and_nonroot_before_bundle_load(self):
        with patch.object(startup.os, "geteuid", return_value=0), \
             patch.object(startup, "verified_bundle") as verify:
            for args in (["set", "xmb"], ["set", "anything", "0" * 64],
                         ["set", "stock", ";touch /tmp/bad"], ["get", "extra"]):
                with self.assertRaisesRegex(startup.SetupError, "invalid_command"):
                    startup.home_button(args)
            verify.assert_not_called()
        with patch.object(startup.os, "geteuid", return_value=1000), \
             patch.object(startup, "verified_bundle") as verify:
            with self.assertRaisesRegex(startup.SetupError, "root_required"):
                startup.home_button(["get"])
            verify.assert_not_called()

    def test_native_process_uses_fixed_argv_and_bounds_failed_replies(self):
        popen = subprocess.Popen
        for script, expected in [
            ("print('{\"returnValue\":true}')", None),
            ("print('{\"returnValue\":false}')", "native_unavailable"),
            ('print("x" * 70000)', "invalid_reply"),
            ('raise SystemExit(2)', "native_unavailable"),
        ]:
            commands = []
            def process(argv, **kwargs):
                commands.append(argv)
                return popen([sys.executable, "-c", script], **kwargs)
            with patch.object(home.subprocess, "Popen", side_effect=process):
                if expected:
                    with self.assertRaisesRegex(home.HomeButtonError, expected):
                        home.native("get", {"category": "general"})
                else:
                    self.assertTrue(home.native("get", {"category": "general"})["returnValue"])
            self.assertEqual(commands[0][0:5], ["/usr/bin/luna-send", "-n", "1", "-w", "3000"])
            self.assertEqual(commands[0][5], home.URLS["get"])
            self.assertEqual(json.loads(commands[0][6]), {"category": "general"})

    def test_native_timeout_reaps_only_its_child(self):
        popen = subprocess.Popen
        children = []
        def process(argv, **kwargs):
            child = popen([sys.executable, "-c", "import time; time.sleep(10)"], **kwargs)
            children.append(child)
            return child
        with patch.object(home.subprocess, "Popen", side_effect=process), \
             patch.object(home.time, "monotonic", side_effect=[100, 105]):
            with self.assertRaisesRegex(home.HomeButtonError, "native_timeout"):
                home.native("get", {})
        self.assertIsNotNone(children[0].returncode)

    def test_cli_home_get_bypasses_ensure_and_startup_log(self):
        with patch.object(sys, "argv", ["helper-startup.py", "home-button", "get"]), \
             patch.object(startup, "home_button", return_value={"returnValue": True}) as command, \
             patch.object(startup, "start") as start, \
             patch.object(startup, "record_startup") as log, redirect_stdout(io.StringIO()) as out:
            self.assertEqual(startup.main(), 0)
            self.assertEqual(json.loads(out.getvalue()), {"returnValue": True})
            command.assert_called_once_with(["get"])
            start.assert_not_called()
            log.assert_not_called()


if __name__ == "__main__":
    unittest.main()
