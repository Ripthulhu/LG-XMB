# SPDX-License-Identifier: GPL-3.0-or-later
"""Run with Python 2.7 or 3 as root on local Linux, never on a TV.

Real filesystem, subprocess, bundle and recovery checks use only a temporary
tree under /root. Native capture is replaced by local fixture replies.
"""
from __future__ import print_function
import errno
import fcntl
import hashlib
import json
import os
import shutil
import stat
import struct
import sys
import tempfile
import time
import types
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(path, "rb") as stream:
        return stream.read()


def write(path, raw):
    with open(path, "wb") as stream:
        stream.write(raw)


def rejects(function, exception, code=None):
    try:
        function()
    except exception as error:
        assert code is None or str(error) == code, str(error)
        return
    raise AssertionError("Expected rejection")


def load(name, raw, path):
    module = types.ModuleType(name)
    module.__file__ = path
    sys.modules[name] = module
    exec(compile(raw, path, "exec"), module.__dict__)
    return module


def fixture(context="context-a"):
    # A JSON round trip deliberately produces unicode strings on Python 2.
    app = "com.webos.app.hdmi1"
    return json.loads(json.dumps({
        "power": {"returnValue": True, "state": "Active"},
        "foreground": {"returnValue": True, "appId": app},
        "video": {"returnValue": True, "video": [{
            "sink": "MAIN", "connected": True, "connectedSource": "HDMI",
            "appId": app, "contentType": "hdmi1", "context": context,
            "muted": False, "width": 3840, "height": 2160, "frameRate": 60,
            "displayOutput": {"x": 0, "y": 0, "width": 3840, "height": 2160}
        }], "clients": [{"clientId": context, "appId": app, "activation": True,
                         "sourceName": "HDMI", "sinkName": "MAIN"}]}
    }))


def check_capture(capture):
    def chunk(kind, raw):
        return (struct.pack(">I", len(raw)) + kind + raw +
                struct.pack(">I", zlib.crc32(kind + raw) & 0xffffffff))
    png = (b"\x89PNG\r\n\x1a\n" +
           chunk(b"IHDR", struct.pack(">IIBBBBB", 480, 270, 8, 2, 0, 0, 0)) +
           chunk(b"IDAT", zlib.compress((b"\0" + b"\x20\x40\x60" * 480) * 270)) +
           chunk(b"IEND", b""))
    capture.validate_png(png)
    rejects(lambda: capture.validate_png(png[:-1] + b"x"), capture.SafeError, "invalid_image")
    data, calls, now, behavior = [fixture()], [], [0], ["ok"]

    def luna(method, payload):
        if method != "capture":
            return data[0][method]
        calls.append(payload)
        write(payload["path"], png)
        if behavior[0] == "refused":
            raise capture.SafeError("luna_refused")
        if behavior[0] == "changed":
            data[0] = fixture("changed-during-capture")
        return {"returnValue": True}

    source = capture.eligible_source(data[0]["power"], data[0]["foreground"], data[0]["video"])
    assert source.port == 1 and source.home_identity is None and hash(source)
    cache = capture.Cache(capture.CACHE_DIR)
    try:
        rejects(lambda: capture.Cache(capture.CACHE_DIR), capture.SafeError, "already_running")
        worker = capture.Worker(luna, cache, installed=lambda: True,
                                clock=lambda: now[0], ensure_link=lambda: None)
        assert worker.snapshot() == source
        assert worker.step() and not calls
        now[0] = 5
        assert worker.step() and len(calls) == 1
        image = capture.CACHE_DIR + "/hdmi1.png"
        assert read(image) == png and stat.S_IMODE(os.stat(image).st_mode) == 0o644
        original = os.stat(image).st_ino
        behavior[0], now[0] = "refused", 65
        assert worker.step() and len(calls) == 2
        for tick in (70, 75, 90, 124):
            now[0] = tick
            assert worker.step()
        assert len(calls) == 2 and os.stat(image).st_ino == original
        behavior[0], now[0] = "changed", 125
        assert worker.step() and len(calls) == 3
        assert os.stat(image).st_ino == original and read(image) == png
        assert not os.path.exists(capture.CACHE_DIR + "/.capture.png")
        status = json.loads(read(capture.CACHE_DIR + "/status.json").decode("ascii"))
        assert status["state"] == "discarded_source_changed", status
        behavior[0] = "refused"
        for index in range(40):
            data[0] = fixture("context-%d" % index)
            now[0] = 200 + index * 10
            assert worker.step()
            now[0] += 5
            assert worker.step()
        assert len(worker.attempts) == 32
        assert (u"com.webos.app.hdmi1", u"context-0") not in worker.attempts
        assert (u"com.webos.app.hdmi1", u"context-39") in worker.attempts
        assert read(image) == png
    finally:
        cache.close()


def check_luna(capture, scratch):
    executable = scratch + "/luna-fixture"
    command = "exec '%s' -E -s -S -B -c " % sys.executable.replace("'", "'\"'\"'")
    cases = (("import sys; sys.stdout.write('{\"returnValue\":true}')", None),
             ("import sys; sys.stdout.write('{\"returnValue\":false}')", "luna_refused"),
             ("import sys; sys.stdout.write('invalid')", "luna_invalid_reply"),
             ("import sys; sys.stdout.write('x' * (256 * 1024 + 1))", "luna_failed"),
             ("import time; time.sleep(30)", "luna_timeout_or_unavailable"))
    for script, error in cases:
        quoted = "'" + script.replace("'", "'\"'\"'") + "'"
        write(executable, ("#!/bin/sh\n" + command + quoted + "\n").encode("utf-8"))
        os.chmod(executable, 0o755)
        started = capture.monotonic()
        call = lambda: capture.Luna(executable)("power", {})
        if error:
            rejects(call, capture.SafeError, error)
        else:
            assert call() == {"returnValue": True}
        assert capture.monotonic() - started < 12, "Luna subprocess was not bounded"


def main():
    assert os.geteuid() == 0, "Run in a local root-owned Linux test environment"
    scratch = tempfile.mkdtemp(prefix="lg-xmb-capture-python-", dir="/root")
    recovery = None
    previous_umask = os.umask(0o022)
    try:
        app, base, logdir = scratch + "/app", scratch + "/state", scratch + "/webosbrew"
        music, payload, cache_path = scratch + "/media", scratch + "/home", scratch + "/cache"
        marker = scratch + "/workers.jsonl"
        for directory in (app, app + "/helper", music, payload):
            os.mkdir(directory)
        appinfo = read(ROOT + "/app/appinfo.json")
        write(app + "/appinfo.json", appinfo)
        homeinfo = json.loads(appinfo.decode("utf-8"))
        homeinfo["id"] = "com.webos.app.home"
        write(payload + "/appinfo.json", json.dumps(homeinfo).encode("utf-8"))
        bootstrap = read(ROOT + "/app/helper-startup.py").replace(
            b'("/usr/bin/python3", "/usr/bin/python", "/usr/bin/python2")',
            ('("/usr/bin/python3", "/usr/bin/python", "/usr/bin/python2", %r)' % sys.executable).encode("utf-8"))
        setup = load("capture_startup_check", bootstrap, app + "/helper-startup.py")
        setup.APP_DIR, setup.BASE, setup.LOG_DIR = app, base, logdir
        setup.MUSIC_DIR, setup.HOME_PAYLOAD_DIR = music, payload
        setup.CACHE, setup.LEGACY_CACHE = cache_path, scratch + "/legacy-cache"
        for name in ("helper-startup.py", "index.html", "menu-sounds.js"):
            raw = bootstrap if name == "helper-startup.py" else read(ROOT + "/app/" + name)
            write(app + "/" + name, raw)
            write(payload + "/" + name, raw)
        write(music + "/background.mp3", b"preserve user music")
        track_inode = os.stat(music + "/background.mp3").st_ino
        sources = json.loads(read(ROOT + "/tv-helper/bundle-sources.json").decode("utf-8"))
        hashes = {}
        for name, source in sources.items():
            raw = read(ROOT + "/" + source)
            if name == setup.CAPTURE_MODULE:
                overrides = ("\nAPP_DIR = %r\nAPPINFO = APP_DIR + '/appinfo.json'\n"
                             "CACHE_DIR = %r\nHOME_PAYLOAD_DIR = %r\nHOME_MOUNT_DIR = %r\n" %
                             (app, cache_path, payload, scratch + "/absent-mount"))
                # Keep production validation and APIs; only the hardware loop is inert.
                overrides += '''def main(argv=None):
    import signal
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    descriptors = []
    for name in os.listdir('/proc/self/fd'):
        try:
            descriptors.append(os.readlink('/proc/self/fd/' + name))
        except OSError:
            pass
    with open(%r, 'ab') as stream:
        stream.write((json.dumps({'pid': os.getpid(), 'sid': os.getsid(0),
                                  'stdin': os.readlink('/proc/self/fd/0'),
                                  'fds': descriptors}) + '\\n').encode('utf-8'))
    stopping.wait(60)
    return 0
''' % marker
                # Source checkouts may use CRLF; normalize before matching the guard.
                raw = raw.replace(b"\r\n", b"\n").replace(
                    b'if __name__ == "__main__":\n    raise SystemExit(main())',
                    overrides.encode("utf-8") + b'\nif __name__ == "__main__":\n    raise SystemExit(main())')
                assert overrides.encode("utf-8") in raw, "Capture entry guard changed"
            elif name == setup.RECOVERY_MODULE:
                raw = raw.replace(b"/media/developer/apps/usr/palm/applications/org.local.openxmb.c5", app.encode("utf-8"))
                raw = raw.replace(b"/var/lib/webosbrew", logdir.encode("utf-8"))
                raw = raw.replace(b"/var/lib/openxmb-c5/thumbnail-cache.py", (scratch + "/legacy.py").encode("utf-8"))
                raw += ("\nPYTHONS = PYTHONS + (%r,)\n" % sys.executable).encode("utf-8")
            write(app + "/helper/" + name, raw)
            hashes[name] = hashlib.sha256(raw).hexdigest()

        def pin_bundle():
            manifest = json.dumps({"schema": 1, "files": hashes,
                                   "appinfoSha256": hashlib.sha256(appinfo).hexdigest()}).encode("utf-8")
            write(app + "/helper/bundle.json", manifest)
            setup.BUNDLE_SHA256 = hashlib.sha256(manifest).hexdigest()

        pin_bundle()
        capture, recovery, bundle = setup.load_bundle()
        check_capture(capture)
        check_luna(capture, scratch)
        result = setup.start()
        assert result == {"returnValue": True, "ready": True, "captureRunning": True}, result
        workers = [json.loads(line.decode("utf-8")) for line in read(marker).splitlines()]
        assert len(workers) == 1
        worker = workers[0]
        identity = recovery.process_identity(worker["pid"])
        assert identity and recovery.helper_argument(identity[2]) == recovery.HELPER
        assert worker["sid"] == worker["pid"]
        assert worker["stdin"] == logdir + "/" + setup.WORKER_LOCK_NAME
        assert base + "/setup.lock" not in worker["fds"], worker
        lock = os.open(worker["stdin"], os.O_WRONLY)
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except EnvironmentError as error:
                assert error.errno in (errno.EAGAIN, errno.EACCES)
            else:
                raise AssertionError("Worker did not retain the inherited lock")
        finally:
            os.close(lock)
        rejects(lambda: setup.launch_worker(recovery), setup.SetupError, "worker_lock_busy")
        assert os.readlink(app + "/thumbnails") == cache_path
        for destination in (app, payload):
            for alias, target in (("user-wallpaper.jpg", "/wallpaper.jpg"), ("media-fonts", "/Fonts")):
                assert os.readlink(destination + "/" + alias) == music + target
            for name in setup.SOUND_FILES:
                assert os.readlink(destination + "/user-sounds/" + name) == music + "/Sounds/" + name
        assert os.readlink(app + "/user-music.mp3") == music + "/background.mp3"
        installed_inode = os.stat(base + "/installed.json").st_ino
        assert setup.start()["captureRunning"]
        assert os.stat(base + "/installed.json").st_ino == installed_inode
        assert len(read(marker).splitlines()) == 1, "Repeated setup spawned another worker"
        # A pinned bundle change must stop the old process before replacing it.
        path = app + "/helper/" + setup.CAPTURE_MODULE
        raw = read(path) + b"\n# fixture bundle upgrade\n"
        write(path, raw)
        hashes[setup.CAPTURE_MODULE] = hashlib.sha256(raw).hexdigest()
        pin_bundle()
        assert setup.start()["captureRunning"]
        assert recovery.process_identity(worker["pid"]) is None
        assert len(read(marker).splitlines()) == 2
        result = recovery.stop()
        assert result["thumbnailHelpersSignalled"] == 1 and result["thumbnailStartupHookRemoved"], result
        assert not recovery.find_helpers()
        assert not os.path.lexists(logdir + "/init.d/" + recovery.HOOK_NAME)
        lock = os.open(logdir + "/" + setup.WORKER_LOCK_NAME, os.O_WRONLY)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(lock)
        assert read(music + "/background.mp3") == b"preserve user music"
        assert os.stat(music + "/background.mp3").st_ino == track_inode
        assert os.path.isfile(cache_path + "/hdmi1.png")
        print("Capture compatibility checks passed on Python " + sys.version.split()[0])
    finally:
        if recovery is not None:
            recovery.stop()
        os.umask(previous_umask)
        shutil.rmtree(scratch)


if __name__ == "__main__":
    main()
