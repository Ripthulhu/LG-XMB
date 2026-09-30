#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Persist an opt-in Home-only Magic Remote mapping; leave other input intact.

Device routing follows Magic Mapper (see THIRD-PARTY-NOTICES.md). No input
device is opened until the user enables mapping, or restores that saved choice.
"""
import errno
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
import re
import select
import signal
import stat
import struct
import subprocess
import time

# The bootstrap supplies a monotonic clock on Python 2; never use TV wall time.
monotonic = getattr(time, "monotonic", None)
APP_DIR = "/media/developer/apps/usr/palm/applications/org.local.openxmb.c5"
STOCK_HOME = "/usr/palm/applications/com.webos.app.home"
HOME_PAYLOAD = "/var/lib/lg-xmb-home"
APPS = {"stock": "com.webos.app.home", "xmb": "org.local.openxmb.c5"}
CONFIG = "home-button.json"
STATUS = "home-button-status.json"
EVENT = struct.Struct("@llHHi")
HOME_KEY = 773
EVIOCGRAB = 0x40044590
URLS = {
    "get": "luna://com.webos.settingsservice/getSystemSettings",
    "set": "luna://com.webos.applicationManager/setDefaultApp",
}


class HomeButtonError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise HomeButtonError(code)


def native(operation, payload):
    """Bound the native process and its output. Never retry a write."""
    require(operation in URLS, "invalid_command")
    deadline = monotonic() + 4
    with open(os.devnull, "r+b") as null:
        child = subprocess.Popen(["/usr/bin/luna-send", "-n", "1", "-w", "3000",
                                  URLS[operation], json.dumps(payload)], stdin=null,
                                 stdout=subprocess.PIPE, stderr=null, close_fds=True)
    try:
        raw = bytearray()
        while True:
            remaining = deadline - monotonic()
            require(remaining > 0 and select.select([child.stdout], [], [], remaining)[0], "native_timeout")
            part = os.read(child.stdout.fileno(), min(4096, 65537 - len(raw)))
            if not part:
                break
            raw.extend(part)
            require(len(raw) <= 65536, "invalid_reply")
        while child.poll() is None:
            require(monotonic() < deadline, "native_timeout")
            time.sleep(.01)
        require(child.returncode == 0, "native_unavailable")
        try:
            value = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError):
            raise HomeButtonError("invalid_reply")
        require(isinstance(value, dict) and value.get("returnValue") is True
                and value.get("errorCode") in (None, 0, "0"), "native_unavailable")
        return value
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        child.stdout.close()


def clear_legacy_assignment():
    """Undo only this app's old native override, never another Home assignment."""
    payload = {"category": "general", "keys": ["defaultApps"], "subscribe": False}
    settings = native("get", payload).get("settings")
    require(isinstance(settings, dict), "invalid_home_settings")
    before = settings.get("defaultApps", {})
    require(isinstance(before, dict), "invalid_home_settings")
    if before.get("home") != APPS["xmb"]:
        return
    native("set", {"category": "home", "appId": APPS["stock"]})
    settings = native("get", payload).get("settings")
    require(isinstance(settings, dict), "invalid_home_settings")
    after = settings.get("defaultApps")
    require(after == dict(before, home=APPS["stock"]), "home_mapping_not_confirmed")


def revision(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def read_config(setup, base):
    raw = setup.read_file(base, CONFIG, 512, optional=True, repair_permissions=False)
    value = json.loads(raw.decode("utf-8")) if raw is not None else {"mode": "stock"}
    require(isinstance(value, dict) and set(value) == {"mode"}
            and value["mode"] in APPS, "invalid_home_settings")
    return value


def workers(recovery):
    return [item for item in recovery.find_helpers()
            if recovery.helper_argument(item[2]) == recovery.BOOTSTRAP]


def public(setup, recovery, bundle, legacy=False):
    value, status = {"mode": "stock"}, {}
    try:
        base = setup.open_directory(setup.BASE)
    except OSError as error:
        if error.errno != errno.ENOENT:
            raise
    else:
        try:
            value = read_config(setup, base)
            raw = setup.read_file(base, STATUS, 1024, optional=True, repair_permissions=False)
            status = json.loads(raw.decode("utf-8")) if raw is not None else {}
            require(isinstance(status, dict), "invalid_home_settings")
        finally:
            os.close(base)
    running = False
    if value["mode"] == "xmb" and type(status.get("pid")) is int:
        identity = recovery.process_identity(status["pid"])
        running = (identity is not None and identity[1] == status.get("birth")
                   and recovery.helper_argument(identity[2]) == recovery.BOOTSTRAP
                   and status.get("bundle") == bundle and status.get("state") == "running")
    result = {"returnValue": True, "mode": value["mode"], "available": True,
              "revision": revision(value), "running": running}
    if value["mode"] == "xmb" and not running:
        result["reason"] = status.get("reason") or "remote_start_failed"
    if legacy and value["mode"] == "stock":
        # Report the old implementation on upgrade, but never turn a native
        # assignment into opt-in interception during automatic startup.
        try:
            apps = native("get", {"category": "general", "keys": ["defaultApps"],
                                  "subscribe": False}).get("settings", {}).get("defaultApps", {})
            app = apps.get("home")
            if app == APPS["xmb"]:
                result.update(mode="xmb", reason="remote_start_failed")
            elif app not in (None, APPS["stock"]):
                result["mode"] = "other"
        except (HomeButtonError, OSError, IOError, AttributeError):
            pass
    return result


@contextmanager
def change_lock(setup):
    """Share the capture upgrader's lock; never restart during its stop pass."""
    parent = setup.open_directory(os.path.dirname(setup.BASE))
    try:
        base = setup.make_directory(parent, os.path.basename(setup.BASE))
    finally:
        os.close(parent)
    lock = None
    try:
        lock = os.open(setup.at(base, "setup.lock"),
                       os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        setup.regular_file(os.fstat(lock))
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (IOError, OSError) as error:
            if error.errno not in (errno.EAGAIN, errno.EACCES):
                raise
            raise HomeButtonError("home_button_busy")
        yield base
    finally:
        if lock is not None:
            os.close(lock)
        os.close(base)


def overlay_active():
    try:
        source, target = os.stat(HOME_PAYLOAD), os.stat(STOCK_HOME)
    except OSError as error:
        if error.errno == errno.ENOENT:
            return False
        raise
    return (source.st_dev, source.st_ino) == (target.st_dev, target.st_ino)


def webos_major():
    with open("/etc/starfish-release", "rb") as stream:
        match = re.search(r"\b(\d+)\.\d+\.\d+\b", stream.read(4096).decode("ascii"))
    require(match is not None, "remote_missing")
    return int(match.group(1))


def device_paths(raw, major):
    devices = {}
    for block in re.split(r"\n\s*\n|\n(?=I:)", raw.strip()):
        name = re.search(r'^N: Name="LGE M-RCU - Builtin \[([0-9]+)\]"$', block, re.M)
        handlers = re.search(r"^H: Handlers=(.*)$", block, re.M)
        if name and handlers:
            events = [token for token in handlers.group(1).split()
                      if re.match(r"\Aevent(?:0|[1-9][0-9]*)\Z", token)]
            index = int(name.group(1))
            # Duplicate names or multiple event handlers are ambiguous.
            devices[index] = ("/dev/input/" + events[0]
                              if len(events) == 1 and index not in devices else None)
    source = devices.get(0)
    require(source, "remote_missing")
    # Magic Mapper prefers [1] on webOS 10+, then [2], then another Builtin.
    for index in ([1] if major >= 10 else []) + [2] + sorted(devices):
        target = devices.get(index)
        if index != 0 and target and target != source:
            return source, target
    raise HomeButtonError("remote_missing")


def open_remote(major):
    with open("/proc/bus/input/devices", "rb") as stream:
        source, target = device_paths(stream.read(65536).decode("utf-8", "replace"), major)
    reader = writer = None
    try:
        reader = os.open(source, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        writer = os.open(target, os.O_WRONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        require(all(stat.S_ISCHR(os.fstat(fd).st_mode) for fd in (reader, writer)), "remote_missing")
        fcntl.ioctl(reader, EVIOCGRAB, 1)
        return reader, writer
    except BaseException as error:
        for fd in (reader, writer):
            if fd is not None:
                os.close(fd)
        if isinstance(error, (OSError, IOError)) and error.errno == errno.EBUSY:
            raise HomeButtonError("remote_busy")
        raise


class InputRelay:
    """One Home launch per press; every other event retains its raw bytes."""
    def __init__(self, write, launch):
        self.write, self.launch = write, launch
        self.home_down = False
        self.pressed = set()

    def feed(self, data):
        require(data and len(data) % EVENT.size == 0, "remote_disconnected")
        for offset in range(0, len(data), EVENT.size):
            raw = data[offset:offset + EVENT.size]
            _, _, kind, code, value = EVENT.unpack(raw)
            require((kind, code) != (0, 3), "remote_disconnected")  # SYN_DROPPED
            if kind == 1 and code == HOME_KEY:
                if value == 1 and not self.home_down:
                    self.home_down = True
                    self.launch()
                elif value == 0:
                    self.home_down = False
                continue
            self.write(raw)
            if kind == 1:
                if value == 1:
                    self.pressed.add(code)
                elif value == 0:
                    self.pressed.discard(code)

    def release(self):
        for code in sorted(self.pressed):
            self.write(EVENT.pack(0, 0, 1, code, 0))
        if self.pressed:
            self.write(EVENT.pack(0, 0, 0, 0, 0))
        self.pressed.clear()


def launch_command(major):
    # Magic Mapper found -n to be a silent no-op on webOS 10. -t sends once;
    # neither branch retries a launch. This child must not block input relay.
    return ["/usr/bin/luna-send", "-t" if major >= 10 else "-n", "1", "-w", "3000",
            "luna://com.webos.service.applicationmanager/launch",
            json.dumps({"id": APPS["xmb"]})]


class AppLaunch:
    """Drain a single bounded Luna request without waiting in the input loop."""
    def __init__(self, major):
        self.major, self.child = major, None
        self.raw = bytearray()

    def start(self):
        if self.child is not None:
            return
        del self.raw[:]
        try:
            with open(os.devnull, "r+b") as null:
                self.child = subprocess.Popen(launch_command(self.major), stdin=null,
                                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                              close_fds=True)
            fd = self.child.stdout.fileno()
            fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) | os.O_NONBLOCK)
        except (OSError, IOError):
            self.close()
            raise HomeButtonError("remote_launch_failed")
        self.deadline = monotonic() + 4

    def check(self):
        if self.child is None:
            return
        while True:
            try:
                data = os.read(self.child.stdout.fileno(), 4096)
            except OSError as error:
                if error.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                    raise
                break
            if not data:
                break
            self.raw.extend(data)
            require(len(self.raw) <= 65536, "remote_launch_failed")
        code = self.child.poll()
        if code is None:
            require(monotonic() < self.deadline, "remote_launch_failed")
            return
        # The child may write between EAGAIN above and poll(). Drain its final
        # bytes after exit before parsing the reply.
        while True:
            data = os.read(self.child.stdout.fileno(), 4096)
            if not data:
                break
            self.raw.extend(data)
            require(len(self.raw) <= 65536, "remote_launch_failed")
        self.child.stdout.close()
        self.child = None
        # -t replies contain a timing prefix on stderr. -n emits plain JSON.
        replies = []
        for line in self.raw.decode("utf-8", "replace").splitlines():
            try:
                replies.append(json.loads(line[line.index("{"):]))
            except (ValueError, TypeError):
                pass
        require(code == 0 and any(isinstance(reply, dict) and reply.get("returnValue") is True
                                 for reply in replies), "remote_launch_failed")

    def close(self):
        if self.child is not None:
            if self.child.poll() is None:
                self.child.kill()
            self.child.wait()
            self.child.stdout.close()
            self.child = None


def run(setup, recovery, bundle):
    base = setup.open_directory(setup.BASE)
    lock = reader = writer = None
    relay = launcher = None
    worker = {"stopped": False, "last_report": None}
    reason = "remote_start_failed"
    def stop(signum, frame):
        worker["stopped"] = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    def report(state, reason=""):
        if worker["last_report"] == (state, reason):
            return
        setup.write_file(base, STATUS, json.dumps({"pid": os.getpid(), "birth": identity[1],
                         "bundle": bundle, "state": state, "reason": reason}).encode())
        worker["last_report"] = (state, reason)
    try:
        lock = os.open(setup.at(base, "home-button-worker.lock"),
                       os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        setup.regular_file(os.fstat(lock))
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        identity = recovery.process_identity(os.getpid())
        require(identity is not None, "remote_start_failed")
        major = webos_major()
        launcher = AppLaunch(major)
        while not worker["stopped"] and read_config(setup, base)["mode"] == "xmb" and not overlay_active():
            # Releasing on uninstall also restores the physical remote. Do not
            # keep intercepting for an app that can no longer be launched.
            if not os.path.isfile(APP_DIR + "/appinfo.json"):
                break
            try:
                reader, writer = open_remote(major)
                def write(raw):
                    require(os.write(writer, raw) == len(raw), "remote_disconnected")
                relay = InputRelay(write, launcher.start)
                report("running")
                checked = monotonic()
                while not worker["stopped"]:
                    if select.select([reader], [], [], .5)[0]:
                        relay.feed(os.read(reader, EVENT.size * 64))
                    now = monotonic()
                    launcher.check()
                    if now - checked >= 1:
                        checked = now
                        if (read_config(setup, base)["mode"] != "xmb"
                                or not os.path.isfile(APP_DIR + "/appinfo.json") or overlay_active()):
                            worker["stopped"] = True
            except (OSError, IOError, select.error, HomeButtonError) as error:
                reason = str(error) if isinstance(error, HomeButtonError) else "remote_disconnected"
                report("waiting", reason)
                # A launch failure or competing mapper needs an explicit retry;
                # do not keep reclaiming input or hide the failure after 5 s.
                worker["stopped"] = worker["stopped"] or reason in ("remote_launch_failed", "remote_busy")
            finally:
                if relay is not None:
                    try:
                        relay.release()
                    except (OSError, IOError, HomeButtonError):
                        pass
                for fd in (reader, writer):
                    if fd is not None:
                        os.close(fd)
                reader = writer = relay = None
            # Remote nodes may appear late during boot or disappear at standby.
            # Slow reconnects are independent of capture and never launch Home.
            for _ in range(10):
                if worker["stopped"]:
                    break
                time.sleep(.5)
        report("stopped", reason)
    finally:
        if launcher is not None:
            launcher.close()
        if lock is not None:
            os.close(lock)
        os.close(base)


def ensure(setup, recovery, bundle, base=None):
    state = public(setup, recovery, bundle)
    if state["mode"] != "xmb" or overlay_active():
        return state
    if base is None:
        with change_lock(setup) as base:
            return ensure(setup, recovery, bundle, base)
    setup.startup_link(recovery)
    raw = setup.read_file(base, STATUS, 1024, optional=True, repair_permissions=False)
    previous = json.loads(raw.decode("utf-8")) if raw is not None else {}
    active = workers(recovery)
    if active and previous.get("bundle") not in (None, bundle):
        for identity in active:
            recovery.stop_one(identity)
        deadline = monotonic() + 3
        while workers(recovery):
            require(monotonic() < deadline, "home_button_busy")
            time.sleep(.05)
    if not workers(recovery):
        with open(os.devnull, "r+b") as null:
            subprocess.Popen(setup.python_command() + [APP_DIR + "/helper-startup.py", "home-button-worker"],
                             stdin=null, stdout=null, stderr=null, preexec_fn=os.setsid, close_fds=True)
    deadline = monotonic() + 3
    while monotonic() < deadline:
        state = public(setup, recovery, bundle)
        if state["running"]:
            return state
        time.sleep(.05)
    return state


def apply(mode, expected, setup, recovery, bundle, base):
    require(public(setup, recovery, bundle)["revision"] == expected, "home_mapping_changed")
    require(revision(read_config(setup, base)) == expected and not overlay_active(), "home_mapping_changed")
    if mode == "xmb":
        setup.startup_link(recovery)
    setup.write_file(base, CONFIG, json.dumps({"mode": mode}).encode())
    if mode == "stock":
        active = workers(recovery)
        for identity in active:
            recovery.stop_one(identity)
        deadline = monotonic() + 3
        while any(recovery.process_identity(item[0]) == item for item in active):
            require(monotonic() < deadline, "home_mapping_not_confirmed")
            time.sleep(.05)
        # Always release our grab first, even if the old native API fails.
        clear_legacy_assignment()
        return public(setup, recovery, bundle)
    # Native calls only retire our earlier implementation. A missing read API
    # must not prevent direct input handling on otherwise supported firmware.
    try:
        clear_legacy_assignment()
    except (HomeButtonError, OSError, IOError, select.error) as error:
        setup.record_startup("legacy_home_assignment_unavailable", error)
    return ensure(setup, recovery, bundle, base)


def command(args, setup, recovery, bundle):
    try:
        require(os.geteuid() == 0, "root_required")
        require(args == ["get"] or (len(args) == 3 and args[0] == "set"
                and args[1] in APPS and re.match(r"\A[0-9a-f]{64}\Z", args[2])), "invalid_command")
        require(not overlay_active(), "home_overlay_active")
        if args == ["get"]:
            return public(setup, recovery, bundle, legacy=True)
        with change_lock(setup) as base:
            return apply(args[1], args[2], setup, recovery, bundle, base)
    except HomeButtonError as error:
        return {"returnValue": False, "errorCode": str(error)}
    except (OSError, IOError, select.error, ValueError, TypeError):
        return {"returnValue": False, "errorCode": "home_button_unavailable"}
