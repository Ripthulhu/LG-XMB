# SPDX-License-Identifier: GPL-3.0-or-later
"""Run with Python 2.7 or 3 as root in a local Linux test environment, not a TV.

Uses a temporary tree under /root so real root ownership/path checks still run.
No remote devices, Luna services or system installation paths are changed.
"""
from __future__ import print_function
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(path, "rb") as stream:
        return stream.read()


def write(path, value):
    with open(path, "wb") as stream:
        stream.write(value)


def rejects(function, exception):
    try:
        function()
    except exception:
        return
    raise AssertionError("Expected rejection")


def main():
    assert os.geteuid() == 0, "Run in a local root-owned Linux test environment"
    scratch = tempfile.mkdtemp(prefix="lg-xmb-python-", dir="/root")
    try:
        entry = os.path.join(ROOT, "app/helper-startup.py")
        setup = types.ModuleType("startup_compat_check")
        sys.modules[setup.__name__] = setup
        exec(compile(read(entry), entry, "exec"), setup.__dict__)
        setup.APP_DIR = scratch + "/app"
        setup.BASE = scratch + "/state"
        setup.LOG_DIR = scratch + "/webosbrew"
        os.mkdir(setup.APP_DIR)
        os.mkdir(setup.APP_DIR + "/helper")
        appinfo = read(ROOT + "/app/appinfo.json")
        write(setup.APP_DIR + "/appinfo.json", appinfo)
        sources = json.loads(read(ROOT + "/tv-helper/bundle-sources.json").decode("utf-8"))
        hashes = {}
        for name, source in sources.items():
            raw = read(ROOT + "/" + source)
            write(setup.APP_DIR + "/helper/" + name, raw)
            hashes[name] = hashlib.sha256(raw).hexdigest()
        manifest = json.dumps({"schema": 1, "files": hashes,
                               "appinfoSha256": hashlib.sha256(appinfo).hexdigest()}).encode("utf-8")
        write(setup.APP_DIR + "/helper/bundle.json", manifest)
        setup.BUNDLE_SHA256 = hashlib.sha256(manifest).hexdigest()
        home, recovery, bundle = setup.home_modules()
        recovery.HOOK_TARGET = setup.APP_DIR + "/helper-startup.py"
        home.APP_DIR = setup.APP_DIR
        home.HOME_PAYLOAD = scratch + "/absent-home"
        home.native = lambda *args: {"returnValue": True, "settings": {"defaultApps": {}}}
        assert home.command(["get"], setup, recovery, bundle)["mode"] == "stock"
        assert not os.path.exists(setup.BASE), "A read must not create state"

        with home.change_lock(setup) as base:
            setup.write_file(base, home.CONFIG, b'{"mode":"xmb"}')
        state = home.public(setup, recovery, bundle)
        assert state["mode"] == "xmb" and not state["running"]
        result = home.command(["set", "stock", state["revision"]], setup, recovery, bundle)
        assert result["returnValue"] and result["mode"] == "stock"
        setup.startup_link(recovery)
        hook = setup.LOG_DIR + "/init.d/" + recovery.HOOK_NAME
        assert os.readlink(hook) == recovery.HOOK_TARGET
        assert setup.record_startup("python_compat_check")

        # Anchors survive a directory rename; symlinks and path escapes fail.
        directory = setup.open_directory(setup.BASE)
        try:
            os.rename(setup.BASE, scratch + "/moved")
            os.mkdir(setup.BASE)
            setup.write_file(directory, "anchored.json", b"{}")
            assert read(scratch + "/moved/anchored.json") == b"{}"
            assert not os.path.exists(setup.BASE + "/anchored.json")
            for bad in ("../escape", "/escape", ".", "..", ""):
                rejects(lambda: setup.read_file(directory, bad), setup.SetupError)
            os.symlink(setup.APP_DIR + "/appinfo.json", scratch + "/moved/foreign")
            rejects(lambda: setup.read_file(directory, "foreign"), EnvironmentError)
            rejects(lambda: setup.write_file(directory, "foreign", b"bad"), setup.SetupError)
        finally:
            os.close(directory)
        write(setup.APP_DIR + "/helper/" + setup.HOME_BUTTON_MODULE, b"raise Exception('untrusted')")
        rejects(setup.home_modules, setup.SetupError)

        devices = '\n\n'.join('N: Name="LGE M-RCU - Builtin [%d]"\nH: Handlers=event%d' %
                              (number, number + 10) for number in (0, 3))
        assert home.device_paths(devices, 9) == ("/dev/input/event10", "/dev/input/event13")
        assert home.device_paths(devices, 10) == ("/dev/input/event10", "/dev/input/event13")
        forwarded, launches = [], []
        relay = home.InputRelay(forwarded.append, lambda: launches.append(True))
        key = lambda code, value: home.EVENT.pack(0, 0, 1, code, value)
        relay.feed(key(773, 1) + key(773, 2) + key(773, 0) + key(103, 1))
        relay.release()
        assert launches == [True] and forwarded[:2] == [key(103, 1), key(103, 0)]

        before = recovery.monotonic()
        time.sleep(.02)
        assert recovery.monotonic() >= before
        home.launch_command = lambda major: [sys.executable, "-E", "-s", "-S", "-B", "-c",
                                             "print('{\"returnValue\":true}')"]
        launcher = home.AppLaunch(9)
        try:
            launcher.start()
            deadline = recovery.monotonic() + 5
            while launcher.child is not None:
                assert recovery.monotonic() < deadline
                launcher.check()
                time.sleep(.01)
        finally:
            launcher.close()

        # Exercise a real boot/stop cycle using pinned, scratch-only copies.
        # Hardware is unavailable here; keep the worker's real process lifecycle.
        for name, source in sources.items():
            raw = read(ROOT + "/" + source).replace(
                b"/media/developer/apps/usr/palm/applications/org.local.openxmb.c5",
                setup.APP_DIR.encode("utf-8"))
            if name == setup.HOME_BUTTON_MODULE:
                raw += ("\nHOME_PAYLOAD = %r\nSTOCK_HOME = %r\n" %
                        (scratch + "/absent-home", scratch + "/stock-home")).encode("utf-8")
                raw += b'''\nwebos_major = lambda: 9
def open_remote(major):
    raise HomeButtonError("remote_missing")
native = lambda *args: {"returnValue": True, "settings": {"defaultApps": {}}}
'''
            elif name == setup.RECOVERY_MODULE:
                raw += ("\nPYTHONS = PYTHONS + (%r,)\n" % sys.executable).encode("utf-8")
            write(setup.APP_DIR + "/helper/" + name, raw)
            hashes[name] = hashlib.sha256(raw).hexdigest()
        manifest = json.dumps({"schema": 1, "files": hashes,
                               "appinfoSha256": hashlib.sha256(appinfo).hexdigest()}).encode("utf-8")
        write(setup.APP_DIR + "/helper/bundle.json", manifest)
        setup.BUNDLE_SHA256 = hashlib.sha256(manifest).hexdigest()
        home, recovery, bundle = setup.home_modules()
        bootstrap = read(entry).replace(
            b'("/usr/bin/python3", "/usr/bin/python", "/usr/bin/python2")',
            ('("/usr/bin/python3", "/usr/bin/python", "/usr/bin/python2", %r)' % sys.executable).encode("utf-8"))
        candidates = " ".join("'" + path.replace("'", "'\"'\"'") + "'"
                              for path in (scratch + "/missing-python3", sys.executable))
        bootstrap = bootstrap.replace(b"for python in /usr/bin/python3 /usr/bin/python /usr/bin/python2; do",
                                      ("for python in " + candidates + "; do").encode("utf-8"))
        overrides = "\nAPP_DIR = %r\nBASE = %r\nLOG_DIR = %r\nBUNDLE_SHA256 = %r\n" % (
            setup.APP_DIR, setup.BASE, setup.LOG_DIR, setup.BUNDLE_SHA256)
        # Avoid native capture while exercising Home restoration after failure.
        overrides += '''def start():
    raise SetupError("capture_unavailable_in_fixture")
'''
        bootstrap = bootstrap.replace(b'if __name__ == "__main__":',
                                      overrides.encode("utf-8") + b'\nif __name__ == "__main__":')
        fixture_entry = setup.APP_DIR + "/helper-startup.py"
        write(fixture_entry, bootstrap)
        os.chmod(fixture_entry, 0o755)
        with home.change_lock(setup) as base:
            setup.write_file(base, home.CONFIG, b'{"mode":"xmb"}')
        boot = subprocess.Popen(["/bin/sh", fixture_entry, "ensure"],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = recovery.monotonic() + 10
            while boot.poll() is None:
                assert recovery.monotonic() < deadline, "Boot restore timed out"
                time.sleep(.05)
            out, err = boot.communicate()
            reply = json.loads(out.decode("utf-8"))
            assert boot.returncode == 2 and not err, (out, err)
            assert reply["errorCode"] == "capture_unavailable_in_fixture", reply
            status = json.loads(read(setup.BASE + "/" + home.STATUS).decode("utf-8"))
            assert status["state"] == "waiting" and status["reason"] == "remote_missing", status
            identity = recovery.process_identity(status["pid"])
            assert identity and identity[1] == status["birth"]
            assert recovery.helper_argument(identity[2]) == recovery.BOOTSTRAP
            assert home.workers(recovery) == [identity]
            state = home.public(setup, recovery, bundle)
            result = home.command(["set", "stock", state["revision"]], setup, recovery, bundle)
            assert result["returnValue"] and result["mode"] == "stock", result
            assert recovery.process_identity(identity[0]) is None, "Worker survived disable"
            assert json.loads(read(setup.BASE + "/" + home.STATUS).decode("utf-8"))["state"] == "stopped"
            assert os.readlink(hook) == recovery.HOOK_TARGET
        finally:
            if boot.poll() is None:
                boot.kill()
            if not boot.stdout.closed:
                boot.communicate()
            for identity in home.workers(recovery):
                recovery.stop_one(identity)
            deadline = recovery.monotonic() + 3
            while home.workers(recovery):
                assert recovery.monotonic() < deadline, "Fixture worker did not stop"
                time.sleep(.05)
        # Both script forms must parse and reject bad arguments before touching the TV.
        for command in ([sys.executable, "-E", "-s", "-S", "-B", entry], ["/bin/sh", entry]):
            child = subprocess.Popen(command + ["invalid"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            out, err = child.communicate()
            assert child.returncode == 2 and not err, (out, err)
            assert json.loads(out.decode("utf-8"))["errorCode"] == "invalid_command"
        print("Home compatibility checks passed on Python " + sys.version.split()[0])
    finally:
        shutil.rmtree(scratch)


if __name__ == "__main__":
    main()
