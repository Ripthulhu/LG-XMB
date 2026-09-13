# SPDX-License-Identifier: GPL-3.0-or-later
import copy
import json
import os
import stat
import struct
import subprocess
import threading
import unittest
import zlib
from types import SimpleNamespace
from unittest.mock import Mock, patch

import thumbnail_cache as tc


def fixture(port=1, app_id=None, context="context-a"):
    app = app_id or "com.webos.app.hdmi%d" % port
    return {
        "power": {"returnValue": True, "state": "Active"},
        "foreground": {"returnValue": True, "appId": app},
        "video": {"returnValue": True, "video": [{
            "sink": "MAIN", "connected": True, "connectedSource": "HDMI",
            "appId": app, "contentType": "hdmi%d" % port, "context": context,
            "muted": False, "width": 3840, "height": 2160, "frameRate": 144,
            "displayOutput": {"x": 0, "y": 0, "width": 3840, "height": 2160},
            "videoInfo": {"hdrType": "HDR10", "hdmiVrrInfo": {"vrrEnabled": True}},
        }], "clients": [{"clientId": context, "appId": app, "activation": True,
                         "sourceName": "HDMI", "sinkName": "MAIN"}]},
    }


class FakeCache:
    def __init__(self):
        self.temporary = False
        self.published = []
        self.states = []
        self.cropped = []
        self.on_crop = None

    def prepare(self):
        self.temporary = True
        return tc.CACHE_DIR + "/.capture.png"

    def publish(self, port):
        self.published.append(port)
        self.temporary = False

    def crop_home(self, source):
        self.cropped.append(source)
        if self.on_crop:
            self.on_crop()

    def remove_temp(self):
        self.temporary = False

    def status(self, value):
        self.states.append(copy.deepcopy(value))


class FakeLuna:
    def __init__(self, data=None):
        self.data = data or fixture()
        self.captures = []
        self.on_capture = None
        self.failure = None
        self.methods = []

    def __call__(self, method, payload):
        self.methods.append(method)
        if method == "capture":
            self.captures.append(payload)
            if self.on_capture:
                self.on_capture()
            if self.failure:
                raise self.failure
            return {"returnValue": True}
        return copy.deepcopy(self.data[method])


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.installed = True
        self.luna = FakeLuna()
        self.cache = FakeCache()
        self.worker = tc.Worker(self.luna, self.cache, installed=lambda: self.installed,
                                clock=lambda: self.now, wall=lambda: 1000 + self.now,
                                ensure_link=lambda: None)

    def tick(self, at):
        self.now = at
        return self.worker.step()

    def test_settles_then_captures_only_existing_input(self):
        self.tick(0)
        self.tick(4.9)
        self.assertEqual(self.luna.captures, [])
        self.tick(5)
        self.assertEqual(self.cache.published, [1])
        self.assertEqual(self.luna.captures[0], {
            "path": tc.CACHE_DIR + "/.capture.png", "method": "VIDEO",
            "width": 480, "height": 270, "format": "PNG"})
        self.assertTrue(set(self.luna.methods) <= {"power", "foreground", "video", "capture"})
        self.assertFalse(self.cache.temporary)

    def test_standby_and_screen_saver_skip_without_video_query(self):
        for state in ("Screen Saver", "Standby", "Suspend", "Unknown", None):
            self.luna.data["power"]["state"] = state
            self.tick(0)
            self.tick(10)
        self.assertEqual(self.luna.captures, [])
        self.assertEqual(set(self.luna.methods), {"power"})

    def test_context_changes_before_capture_restart_settle(self):
        self.tick(0)
        self.luna.data = fixture(context="context-b")
        self.tick(5)
        self.tick(9)
        self.assertFalse(self.luna.captures)
        self.tick(10)
        self.assertEqual(self.cache.published, [1])

    def test_source_changes_during_capture_discard(self):
        self.tick(0)
        self.luna.on_capture = lambda: setattr(self.luna, "data", fixture(2, context="b"))
        self.tick(5)
        self.assertEqual(self.cache.published, [])
        self.assertFalse(self.cache.temporary)
        self.assertEqual(self.cache.states[-1]["state"], "discarded_source_changed")

    def test_foreground_changes_during_capture_discard(self):
        self.tick(0)
        self.luna.on_capture = lambda: self.luna.data["foreground"].update(appId=tc.HOME_ID)
        self.tick(5)
        self.assertFalse(self.cache.published)

    def test_picture_mode_change_restarts_settle_and_inflight_discard(self):
        self.tick(0)
        self.luna.data["video"]["video"][0]["videoInfo"]["hdrType"] = "SDR"
        self.tick(5)
        self.assertFalse(self.luna.captures)
        self.luna.on_capture = lambda: self.luna.data["video"]["video"][0].update(frameRate=60)
        self.tick(10)
        self.assertFalse(self.cache.published)

    def test_no_fast_retry_after_permission_denied(self):
        self.tick(0)
        self.luna.failure = tc.SafeError("luna_refused")
        self.tick(5)
        for now in (10, 15, 30, 64):
            self.tick(now)
        self.assertEqual(len(self.luna.captures), 1)
        self.tick(65)
        self.assertEqual(len(self.luna.captures), 2)
        self.assertFalse(self.cache.temporary)

    def test_success_rate_limit_remembers_context_after_leaving(self):
        self.tick(0)
        self.tick(5)
        self.luna.data["power"]["state"] = "Standby"
        self.tick(10)
        self.luna.data["power"]["state"] = "Active"
        self.tick(15)
        self.tick(20)
        self.tick(64)
        self.assertEqual(len(self.luna.captures), 1)
        self.tick(65)
        self.assertEqual(len(self.luna.captures), 2)

    def test_home_preview_requires_opt_in_and_video_mode(self):
        self.luna.data = fixture(app_id=tc.HOME_ID)
        self.tick(0)
        self.tick(5)
        self.assertFalse(self.luna.captures)
        with self.assertRaises(tc.SafeError):
            tc.Worker(self.luna, self.cache, capture_method="BLENDED", allow_home=True)
        self.worker.allow_home = True
        self.tick(10)
        self.tick(15)
        self.assertEqual(self.cache.published, [1])
        self.assertEqual((self.luna.captures[0]["width"], self.luna.captures[0]["height"]), (1920, 1080))
        self.assertEqual(len(self.cache.cropped), 1)

    def test_home_foreground_change_during_crop_discards(self):
        self.luna.data = fixture(app_id=tc.HOME_ID)
        self.worker.allow_home = True
        self.cache.on_crop = lambda: self.luna.data["foreground"].update(appId="com.webos.app.browser")
        self.tick(0)
        self.tick(5)
        self.assertEqual(len(self.cache.cropped), 1)
        self.assertFalse(self.cache.published)
        self.assertFalse(self.cache.temporary)

    def test_invalid_home_rectangle_does_not_capture(self):
        self.luna.data = fixture(app_id=tc.HOME_ID)
        self.worker.allow_home = True
        self.luna.data["video"]["video"][0]["displayOutput"]["x"] = 4000
        self.tick(0)
        self.tick(5)
        self.assertFalse(self.luna.captures)
        self.assertFalse(self.cache.published)

    def test_stop_during_initial_snapshot_never_starts_capture(self):
        self.tick(0)
        snapshot = self.worker.snapshot
        def stopped_snapshot(*args, **kwargs):
            source = snapshot(*args, **kwargs)
            self.worker.stop.set()
            return source
        self.worker.snapshot = stopped_snapshot
        self.assertFalse(self.tick(5))
        self.assertFalse(self.luna.captures)

    def test_uninstall_exits_and_sigterm_discards_inflight(self):
        self.installed = False
        self.assertFalse(self.tick(0))
        self.assertEqual(self.luna.methods, [])
        self.installed = True
        self.tick(0)
        self.luna.on_capture = self.worker.stop.set
        self.tick(5)
        self.assertFalse(self.cache.published)
        self.assertFalse(self.cache.temporary)

    def test_foreign_link_error_never_captures_or_replaces(self):
        self.worker.ensure_link = lambda: (_ for _ in ()).throw(tc.SafeError("foreign_thumbnail_path"))
        self.tick(0)
        self.tick(10)
        self.assertFalse(self.luna.captures)
        self.assertEqual(self.cache.states[-1]["error"], "foreign_thumbnail_path")


class AppReadinessTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.cache, self.luna = FakeCache(), FakeLuna()
        self.ready = Mock(return_value=True)
        self.installed = Mock(return_value=True)
        self.link = Mock()
        self.worker = tc.Worker(self.luna, self.cache, installed=self.installed,
                                clock=lambda: self.now, wall=lambda: 1000 + self.now,
                                ensure_link=self.link, app_ready=self.ready)

    def tick(self, at):
        self.now = at
        return self.worker.step()

    def test_readiness_precedes_manifest_and_link_on_every_poll(self):
        events = []
        self.ready.side_effect = lambda: events.append("verified") or True
        self.installed.side_effect = lambda: events.append("installed") or True
        self.link.side_effect = lambda: events.append("link")
        self.luna.data["power"]["state"] = "Standby"
        self.assertTrue(self.tick(0))
        self.assertTrue(self.tick(5))
        self.assertEqual(events, ["verified", "installed", "link"] * 2)
        self.assertEqual(self.luna.methods, ["power", "power"])

    def test_missing_mount_has_finite_grace_without_app_or_luna_work(self):
        self.ready.side_effect = FileNotFoundError("private missing path")
        for now in (0, 5, 89.9):
            self.assertTrue(self.tick(now))
            self.assertEqual(self.cache.states[-1]["state"], "waiting_for_app")
        self.assertFalse(self.tick(90))
        self.assertEqual(self.cache.states[-1]["error"], "app_missing_timeout")
        self.installed.assert_not_called()
        self.link.assert_not_called()
        self.assertEqual(self.luna.methods, [])
        self.assertNotIn("private", json.dumps(self.cache.states))

    def test_verified_return_resets_missing_grace_and_capture_settling(self):
        self.assertTrue(self.tick(0))
        self.ready.side_effect = FileNotFoundError()
        self.assertTrue(self.tick(5))
        self.ready.side_effect = None
        self.assertTrue(self.tick(80))
        self.assertEqual(self.cache.states[-1]["state"], "settling")
        self.assertEqual(self.luna.captures, [])
        self.assertIsNone(self.worker.app_missing_since)
        self.ready.side_effect = FileNotFoundError()
        self.assertTrue(self.tick(85))
        self.assertTrue(self.tick(174.9))
        self.assertFalse(self.tick(175))

    def test_rejected_or_invalid_readiness_stops_without_retry_or_details(self):
        for failure in (tc.SafeError("sensitive details" * 1000), False, None):
            with self.subTest(failure=type(failure).__name__):
                self.ready.side_effect = failure if isinstance(failure, Exception) else None
                self.ready.return_value = failure
                self.assertFalse(self.tick(0))
                self.assertEqual(self.cache.states[-1]["state"], "app_rejected")
                self.assertEqual(self.cache.states[-1]["error"], "app_readiness_failed")
        self.installed.assert_not_called()
        self.link.assert_not_called()
        self.assertEqual(self.luna.methods, [])
        self.assertNotIn("sensitive", json.dumps(self.cache.states))

    def test_cancellation_before_or_during_readiness_skips_following_work(self):
        self.worker.stop.set()
        self.assertFalse(self.tick(0))
        self.ready.assert_not_called()
        self.worker.stop.clear()
        self.ready.side_effect = lambda: self.worker.stop.set() or True
        self.assertFalse(self.tick(5))
        self.installed.assert_not_called()
        self.link.assert_not_called()
        self.assertEqual(self.luna.methods, [])

    def test_cancellation_during_missing_check_does_not_wait(self):
        def stop_and_miss():
            self.worker.stop.set()
            raise FileNotFoundError()
        self.ready.side_effect = stop_and_miss
        self.assertFalse(self.tick(0))
        self.assertEqual(self.cache.states, [])
        self.installed.assert_not_called()
        self.assertEqual(self.luna.methods, [])

    def test_controller_adapter_preserves_only_missing_path_signal(self):
        class ControlError(Exception):
            pass
        module = SimpleNamespace(checked_app=Mock(return_value=True), ControlError=ControlError)
        self.assertIs(tc.checked_process_app(module), True)
        module.checked_app.side_effect = FileNotFoundError("missing")
        with self.assertRaises(FileNotFoundError):
            tc.checked_process_app(module)
        for failure, message in ((ControlError("private hash"), "app_metadata_rejected"),
                                 (PermissionError("private path"), "app_readiness_failed")):
            module.checked_app.side_effect = failure
            with self.assertRaises(tc.SafeError) as raised:
                tc.checked_process_app(module)
            self.assertEqual(str(raised.exception), message)
            self.assertIsNone(raised.exception.__cause__)

    def test_main_wires_readiness_only_for_process_controls(self):
        class ControlError(Exception):
            pass
        for enabled in (False, True):
            with self.subTest(enabled=enabled):
                controls = Mock()
                module = SimpleNamespace(Manager=Mock(return_value=controls),
                                         checked_app=Mock(return_value=True), ControlError=ControlError)
                spec = SimpleNamespace(loader=Mock())
                with patch.object(tc, "Cache") as cache_class, \
                     patch.object(tc, "Worker") as worker_class, \
                     patch.object(tc, "Luna"), patch.object(tc, "check_directory"), \
                     patch.object(tc, "check_file"), patch.object(tc.os, "lstat"), \
                     patch.object(tc.signal, "signal"), \
                     patch("shutil.which", return_value="/usr/bin/luna-send"), \
                     patch("importlib.util.spec_from_file_location", return_value=spec), \
                     patch("importlib.util.module_from_spec", return_value=module):
                    worker_class.return_value.step.return_value = False
                    self.assertEqual(tc.main(["--process-controls"] if enabled else []), 0)
                    ready = worker_class.call_args.kwargs["app_ready"]
                    if enabled:
                        self.assertIs(ready(), True)
                        module.checked_app.assert_called_once_with()
                        controls.shutdown.assert_called_once_with()
                    else:
                        self.assertIsNone(ready)
                        module.Manager.assert_not_called()
                    cache_class.return_value.close.assert_called_once_with()


class EligibilityTests(unittest.TestCase):
    def test_rejects_mismatch_muted_inactive_and_missing_signal(self):
        changes = [
            {"appId": tc.HOME_ID}, {"connected": False}, {"muted": True},
            {"connectedSource": "VDEC"}, {"contentType": "hdmi2"},
            {"context": "unknown"}, {"width": 0}, {"frameRate": 0},
            {"displayOutput": {"width": 0, "height": 0}},
        ]
        for change in changes:
            data = fixture()
            data["video"]["video"][0].update(change)
            with self.subTest(change=change):
                self.assertIsNone(tc.eligible_source(**data))
        data = fixture()
        data["video"]["clients"][0]["activation"] = False
        self.assertIsNone(tc.eligible_source(**data))

    def test_all_four_ports_accepted_no_other_apps(self):
        for port in range(1, 5):
            self.assertEqual(tc.eligible_source(**fixture(port)).port, port)
        self.assertIsNone(tc.eligible_source(**fixture(app_id="com.webos.app.browser")))
        self.assertIsNone(tc.eligible_source(**fixture(port=5)))


class GuardTests(unittest.TestCase):
    def metadata(self, mode, uid=0, nlink=1):
        return SimpleNamespace(st_mode=mode, st_uid=uid, st_nlink=nlink)

    def test_root_ownership_and_no_symlinks_or_hardlinks(self):
        tc.check_directory(self.metadata(stat.S_IFDIR | 0o755))
        tc.check_directory(self.metadata(stat.S_IFDIR | 0o1777), allow_sticky=True)
        tc.check_file(self.metadata(stat.S_IFREG | 0o644))
        for meta in (self.metadata(stat.S_IFLNK | 0o777),
                     self.metadata(stat.S_IFREG | 0o644, uid=1000),
                     self.metadata(stat.S_IFREG | 0o666),
                     self.metadata(stat.S_IFREG | 0o644, nlink=2)):
            with self.assertRaises(tc.SafeError):
                tc.check_file(meta)
        for meta in (self.metadata(stat.S_IFLNK | 0o777),
                     self.metadata(stat.S_IFDIR | 0o777),
                     self.metadata(stat.S_IFDIR | 0o755, uid=1000)):
            with self.assertRaises(tc.SafeError):
                tc.check_directory(meta)

    def test_only_exact_approved_app_link(self):
        meta = self.metadata(stat.S_IFLNK | 0o777)
        tc.check_thumbnail_link(meta, tc.CACHE_DIR)
        for target in ("/etc", "/tmp/other", "../../tmp/openxmb-c5-thumbnails"):
            with self.assertRaises(tc.SafeError):
                tc.check_thumbnail_link(meta, target)
        with self.assertRaises(tc.SafeError):
            tc.check_thumbnail_link(self.metadata(stat.S_IFDIR | 0o755), tc.CACHE_DIR)

    def test_png_rejects_wrong_dimensions_truncation_and_crc(self):
        def chunk(kind, data):
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
        def png(width=480):
            header = struct.pack(">IIBBBBB", width, 270, 8, 2, 0, 0, 0)
            return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
                    + chunk(b"IDAT", zlib.compress((b"\0" + b"\0" * (width * 3)) * 270))
                    + chunk(b"IEND", b""))
        valid = png()
        tc.validate_png(valid)
        for data in (png(320), valid[:-2], valid + b"extra", b"no PNG", valid[:40] + b"x" + valid[41:]):
            with self.assertRaises(tc.SafeError):
                tc.validate_png(data)


class HomeCropTests(unittest.TestCase):
    def source(self, x=2682, y=1182, width=870, height=492):
        data = fixture(app_id=tc.HOME_ID)
        data["video"]["video"][0]["displayOutput"] = {
            "x": x, "y": y, "width": width, "height": height}
        return tc.eligible_source(**data, allow_home=True)

    def png(self, width, height):
        def chunk(kind, data):
            return (struct.pack(">I", len(data)) + kind + data
                    + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff))
        return (b"\x89PNG\r\n\x1a\n"
                + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress((b"\0" + b"\0" * (width * 3)) * height))
                + chunk(b"IEND", b""))

    def test_verified_c5_output_maps_exact_crop(self):
        self.assertEqual(tc.home_crop_bounds(self.source()), (1341, 591, 1776, 837))
        source = self.source()
        lower_signal = tc.Source(source.port, source.app_id, source.context,
                                 (1920, 1080) + source.mode[2:])
        self.assertEqual(tc.home_crop_bounds(lower_signal), tc.home_crop_bounds(source))

    def test_odd_coordinates_round_inside_and_invalid_bounds_refused(self):
        self.assertEqual(tc.home_crop_bounds(self.source(x=1, y=1, width=11, height=11)), (1, 1, 6, 6))
        for values in ({"x": -1}, {"x": 3840}, {"y": 2160}, {"x": 2.5},
                       {"width": 4000}, {"width": 1, "x": 1}):
            with self.subTest(values=values), self.assertRaises(tc.SafeError):
                tc.home_crop_bounds(self.source(**values))
        with self.assertRaises(tc.SafeError):
            tc.home_crop_bounds(tc.eligible_source(**fixture()))

    def test_crop_uses_verified_slice_and_encodes_valid_final_size(self):
        calls = []
        class Decoded:
            shape = (1080, 1920, 3)
            def __getitem__(self, selection):
                calls.append(selection)
                return "cropped pixels"
        output = self.png(480, 270)
        resize_calls = []
        cv = SimpleNamespace(
            IMREAD_COLOR=1, INTER_AREA=3, INTER_LINEAR=1, IMWRITE_PNG_COMPRESSION=16,
            imdecode=lambda data, mode: Decoded(),
            resize=lambda data, dimensions, interpolation: resize_calls.append((data, dimensions, interpolation)) or "resized",
            imencode=lambda extension, data, settings: (True, SimpleNamespace(tobytes=lambda: output)))
        np = SimpleNamespace(uint8="uint8", frombuffer=lambda data, dtype: data)
        result = tc.crop_home_png(self.png(1920, 1080), self.source(), cv=cv, np=np)
        self.assertEqual(result, output)
        self.assertEqual(calls, [(slice(591, 837), slice(1341, 1776))])
        self.assertEqual(resize_calls, [("cropped pixels", (480, 270), 1)])

    def test_bad_capture_dimensions_or_decode_are_refused(self):
        np = SimpleNamespace(uint8="uint8", frombuffer=lambda data, dtype: data)
        cv = SimpleNamespace(IMREAD_COLOR=1, imdecode=lambda data, mode: None)
        for data in (self.png(480, 270), self.png(1920, 1080), b"x" * (tc.MAX_IMAGE_BYTES + 1)):
            with self.assertRaises(tc.SafeError):
                tc.crop_home_png(data, self.source(), cv=cv, np=np)


class LunaTests(unittest.TestCase):
    def test_no_shell_fixed_uri_and_bounded_timeout(self):
        result = SimpleNamespace(returncode=0, stdout=b'{"returnValue":true,"state":"Active"}')
        with patch.object(subprocess, "run", return_value=result) as run:
            tc.Luna("/usr/bin/luna-send")("power", {})
            args, kwargs = run.call_args
            self.assertEqual(args[0][-2], "luna://com.webos.service.tvpower/power/getPowerState")
            self.assertEqual(kwargs["timeout"], 8)
            self.assertNotIn("shell", kwargs)
        with self.assertRaises(tc.SafeError):
            tc.Luna("luna-send")("launch", {})

    def test_timeout_denial_and_malformed_reply_are_normalized(self):
        for value in (SimpleNamespace(returncode=0, stdout=b'{"returnValue":false,"errorText":"sensitive"}'),
                      SimpleNamespace(returncode=0, stdout=b'not json')):
            with patch.object(subprocess, "run", return_value=value), self.assertRaises(tc.SafeError) as raised:
                tc.Luna("luna-send")("video", {})
            self.assertNotIn("sensitive", str(raised.exception))
        with patch.object(subprocess, "run", side_effect=subprocess.TimeoutExpired("luna", 8)):
            with self.assertRaisesRegex(tc.SafeError, "luna_timeout_or_unavailable"):
                tc.Luna("luna-send")("video", {})


class StockHomeCloserTests(unittest.TestCase):
    def setUp(self):
        self.power = {"returnValue": True, "state": "Active"}
        self.stock = {"returnValue": True, "appId": tc.STOCK_HOME_ID}
        self.home = {"returnValue": True, "appId": tc.HOME_ID}
        self.other = {"returnValue": True, "appId": "com.webos.app.browser"}
        self.pid = "15810"
        self.closed = []
        self.calls = []
        self.current_fg = self.home
        self.rows = [{"id": tc.STOCK_HOME_ID, "processid": self.pid}]
        self.args = [b"/usr/bin/flutter-client", b"-i", b"com.webos.app.home", b""]
        self.stop = threading.Event()
        self.closer = tc.StockHomeCloser(self.luna, self.stop,
                                         read_args=lambda pid: self.args,
                                         exists=lambda pid: bool(self.rows),
                                         wall=lambda: 1000, wait=lambda seconds: None)

    def luna(self, method, payload):
        self.calls.append(method)
        if method == "running":
            return {"returnValue": True, "running": self.rows}
        if method == "power":
            return self.power
        if method == "foreground":
            return self.current_fg
        if method == "close_stock":
            self.closed.append(payload)
            self.rows = []
            return {"returnValue": True}
        raise AssertionError("Unexpected method")

    def test_no_close_when_our_home_has_no_stock_process(self):
        self.rows = []
        self.closer.observe(self.power, self.home)
        self.assertFalse(self.closed)
        self.assertEqual(self.calls, ["running"])

    def test_unobserved_quick_visit_new_pid_is_closed_once(self):
        self.closer.observe(self.power, self.home)
        self.assertEqual(self.closed, [{"processId": self.pid}])
        # Even an unconfirmed lingering entry cannot cause retries of this PID.
        self.rows = [{"id": tc.STOCK_HOME_ID, "processid": self.pid}]
        self.closer.observe(self.power, self.home)
        self.assertEqual(len(self.closed), 1)
        self.assertEqual(self.closer.last_status["state"], "already_attempted")
        self.rows = [{"id": tc.STOCK_HOME_ID, "processid": "15999"}]
        self.closer.observe(self.power, self.home)
        self.assertEqual(self.closed[-1], {"processId": "15999"})

    def test_observe_stock_then_other_app_does_not_close(self):
        self.closer.observe(self.power, self.stock)
        self.closer.observe(self.power, self.stock)
        self.closer.observe(self.power, self.other)
        self.assertEqual(self.calls, [])
        self.closer.observe(self.power, self.home)
        self.assertEqual(self.closed, [{"processId": self.pid}])
        self.assertEqual(self.closer.last_status["state"], "closed")
        self.closer.observe(self.power, self.home)
        self.assertEqual(len(self.closed), 1)

    def test_recheck_changed_foreground_never_closes_or_retries(self):
        self.closer.observe(self.power, self.stock)
        self.current_fg = self.other
        self.closer.observe(self.power, self.home)
        self.current_fg = self.home
        self.closer.observe(self.power, self.home)
        self.assertFalse(self.closed)
        self.assertEqual(self.closer.last_status["state"], "already_attempted")

    def test_rejects_mismatched_process_and_nonnumeric_pid(self):
        for args, pid in (([b"/usr/bin/python3", b"-i", b"com.webos.app.home"], "123"),
                          (self.args, "1"), (self.args, "123;kill"),
                          ([b"/usr/bin/flutter-client", b"-i", b"org.local.other"], "123")):
            self.closer.stock_visible = False
            self.args = args
            self.rows = [{"id": tc.STOCK_HOME_ID, "processid": pid}]
            self.closer.observe(self.power, self.stock)
            self.closer.observe(self.power, self.home)
            self.assertFalse(self.closed)

    def test_standby_and_stop_never_close(self):
        self.closer.observe(self.power, self.stock)
        inactive = {"returnValue": True, "state": "Screen Saver"}
        self.closer.observe(inactive, self.home)
        self.stop.set()
        self.closer.observe(self.power, self.home)
        self.assertFalse(self.closed)

    def test_pid_reuse_between_checks_never_closes(self):
        responses = iter([self.args, [b"/usr/bin/another"]])
        self.closer.read_args = lambda pid: next(responses)
        self.closer.observe(self.power, self.stock)
        self.closer.observe(self.power, self.home)
        self.assertFalse(self.closed)

    def test_no_close_retry_after_refusal(self):
        original = self.closer.luna
        def refuse(method, payload):
            if method == "close_stock":
                self.closed.append(payload)
                raise tc.SafeError("luna_refused")
            return original(method, payload)
        self.closer.luna = refuse
        self.closer.observe(self.power, self.stock)
        self.closer.observe(self.power, self.home)
        self.closer.observe(self.power, self.home)
        self.assertEqual(len(self.closed), 1)
        self.assertEqual(self.closer.last_status["state"], "already_attempted")
        self.closer.observe(self.power, self.stock)
        self.closer.observe(self.power, self.home)
        self.assertEqual(len(self.closed), 2)


if __name__ == "__main__":
    unittest.main()
