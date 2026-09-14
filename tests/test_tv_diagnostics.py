# SPDX-License-Identifier: GPL-3.0-or-later
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "diagnostics", Path(__file__).resolve().parents[1] / "tools" / "tv-diagnostics.py")
diagnostics = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(diagnostics)


class DiagnosticsTests(unittest.TestCase):
    def test_fixed_read_only_requests(self):
        calls = []
        def run(argv):
            calls.append(argv)
            return b'{"returnValue":true}'
        for name in diagnostics.READS:
            diagnostics.query(name, run)
        self.assertEqual(len(calls), 4)
        for argv in calls:
            self.assertEqual(argv[:5], ["/usr/bin/luna-send", "-n", "1", "-w", "3000"])
            self.assertNotIn("exec", argv[5])
            self.assertIn(argv[5].rsplit("/", 1)[-1],
                          ["getSystemInfo", "getSystemSettings", "getPreloadPolicy", "getStatus"])
            self.assertIsInstance(json.loads(argv[6]), dict)

    def test_versions_are_reported_not_guessed(self):
        for version in ("7.5.0", "10.3.1", "11.0.0"):
            self.assertEqual(diagnostics.summarize("system", {"sdkVersion": version}),
                             {"sdkVersion": version})

    def test_private_native_fields_are_dropped(self):
        reply = {"settings": {"defaultApps": {"home": "private.app", "browser": "secret"},
                               "lastAppHandlerPolicy": "private-policy"}, "serial": "private-serial"}
        summary = diagnostics.summarize("home", reply)
        self.assertEqual(summary, {"assignment": "other", "hasLastAppPolicy": True})
        self.assertNotIn("private", json.dumps(summary))

    def test_missing_home_is_not_claimed_to_be_stock(self):
        self.assertEqual(diagnostics.summarize("home", {"settings": {"defaultApps": {}}})["assignment"], "unset")

    def test_home_classification(self):
        for app, expected in (("com.webos.app.home", "stock"), ("org.local.openxmb.c5", "custom")):
            self.assertEqual(diagnostics.summarize("home", {"settings": {"defaultApps": {"home": app}}})["assignment"], expected)

    def test_preload_names_are_not_exported(self):
        self.assertEqual(diagnostics.summarize("preload", {"applications": [
            {"id": "private.app"}, {"id": "com.webos.app.home", "isEnabled": True}]}),
            {"hasPolicyList": True, "hasHomePolicy": True})

    def test_video_does_not_export_pipeline_content(self):
        self.assertEqual(diagnostics.summarize("video", {"video": [{"secret": "value"}], "clients": []}),
                         {"hasVideoList": True, "hasClientList": True})

    def test_unexpected_shapes(self):
        for name, value in (("system", {}), ("system", {"sdkVersion": "secret\nvalue"}),
                            ("home", {"settings": {"defaultApps": []}}),
                            ("preload", {"applications": [None]}), ("video", {"video": []})):
            with self.subTest(name=name), self.assertRaises(diagnostics.ProbeError):
                diagnostics.summarize(name, value)

    def test_invalid_json_and_return_values(self):
        for raw in (b"oops", b"[]", b"null", b'{}', b'{"returnValue":1}', b'\xff'):
            with self.subTest(raw=raw), self.assertRaisesRegex(diagnostics.ProbeError, "invalid_reply"):
                diagnostics.query("system", lambda _: raw)

    def test_refusal_drops_error_text(self):
        with self.assertRaisesRegex(diagnostics.ProbeError, "^service_refused$"):
            diagnostics.query("system", lambda _: b'{"returnValue":false,"errorText":"private-details"}')

    def test_nonzero_error_code_is_not_success(self):
        with self.assertRaisesRegex(diagnostics.ProbeError, "service_refused"):
            diagnostics.query("system", lambda _: b'{"returnValue":true,"errorCode":-1}')

    def test_probes_fail_independently(self):
        def call(name):
            if name == "system":
                return {"sdkVersion": "10.3.1"}
            raise diagnostics.ProbeError("timeout")
        result = diagnostics.collect(call)
        self.assertEqual(result["context"], "shell")
        self.assertEqual(result["reads"]["system"]["status"], "ok")
        for name in ("home", "preload", "video"):
            self.assertEqual(result["reads"][name], {"status": "timeout"})

    def test_missing_command_has_useful_status(self):
        with patch.object(diagnostics.importlib.util, "find_spec", return_value=None):
            result = diagnostics.collect(lambda _: (_ for _ in ()).throw(FileNotFoundError()))
        self.assertTrue(all(v == {"status": "command_missing"} for v in result["reads"].values()))
        self.assertFalse(any(result["modules"].values()))

    def test_subprocess_output(self):
        self.assertEqual(diagnostics.read_process([sys.executable, "-c", "print('hello')"]), b"hello\n")

    def test_subprocess_timeout(self):
        with self.assertRaisesRegex(diagnostics.ProbeError, "timeout"):
            diagnostics.read_process([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.1)

    def test_subprocess_output_limit(self):
        with self.assertRaisesRegex(diagnostics.ProbeError, "reply_too_large"):
            diagnostics.read_process([sys.executable, "-c", "print('x'*1024)"], limit=100)

    def test_subprocess_nonzero_exit(self):
        with self.assertRaisesRegex(diagnostics.ProbeError, "command_failed"):
            diagnostics.read_process([sys.executable, "-c", "raise SystemExit(2)"])


if __name__ == "__main__":
    unittest.main()
