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
        for target in ("/etc", "/tmp/other", "../../tmp/lg-xmb-thumbnails"):
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


if __name__ == "__main__":
    unittest.main()
