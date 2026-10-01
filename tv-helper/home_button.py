#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Persist the opt-in Home mapping and launch the standalone app on a press."""
import errno
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
import re
import select
import signal
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
hook = None  # Authenticated native controller supplied by helper-startup.py.
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
                   and status.get("bundle") == bundle and status.get("state") == "running"
                   and hook is not None and hook.healthy(setup, status.get("nativeBuild")))
    result = {"returnValue": True, "mode": value["mode"], "available": True,
              "revision": revision(value), "running": running}
    if value["mode"] == "xmb" and not running:
        result["reason"] = status.get("reason") or "remote_start_failed"
    if status.get("lastInput") is not None:
        result["lastInput"] = status["lastInput"]
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
    require(match is not None, "hook_unsupported")
    return int(match.group(1))


def launch_command(major):
    # Magic Mapper found -n to be a silent no-op on webOS 10. -t sends once;
    # neither branch retries a launch. This child must not block input handling.
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
    lock = controller = launcher = identity = None
    worker = {"stopped": False, "last_report": None}
    reason = "remote_start_failed"
    def stop(signum, frame):
        worker["stopped"] = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    def report(state, reason=""):
        last_input = controller.last_input if controller else None
        if worker["last_report"] == (state, reason, last_input):
            return
        setup.write_file(base, STATUS, json.dumps({"pid": os.getpid(), "birth": identity[1],
                         "bundle": bundle, "state": state, "reason": reason,
                         "nativeBuild": controller.build if controller else None,
                         "lastInput": last_input}).encode())
        worker["last_report"] = (state, reason, last_input)
    try:
        lock = os.open(setup.at(base, "home-button-worker.lock"),
                       os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        setup.regular_file(os.fstat(lock))
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        identity = recovery.process_identity(os.getpid())
        require(identity is not None, "remote_start_failed")
        major = webos_major()
        launcher = AppLaunch(major)
        require(hook is not None, "hook_missing")
        controller = hook.Controller(setup, base)
        while not worker["stopped"] and read_config(setup, base)["mode"] == "xmb" and not overlay_active():
            if not os.path.isfile(APP_DIR + "/appinfo.json"):
                break
            controller.step(launcher.start)
            launcher.check()
            report("running" if controller.running else "waiting", controller.reason)
    except Exception as error:
        if isinstance(error, HomeButtonError) or (hook is not None and isinstance(error, hook.HookError)):
            reason = str(error)
        else:
            setup.record_startup("home_button_worker_failed", error)
    finally:
        try:
            if controller is not None:
                controller.close()
        finally:
            try:
                if identity is not None:
                    report("stopped", reason)
                if launcher is not None:
                    launcher.close()
            finally:
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
        if hook is not None:
            hook.disarm()
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
    deadline = monotonic() + 8
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
        if hook is not None:
            hook.disarm()
        active = workers(recovery)
        for identity in active:
            recovery.stop_one(identity)
        deadline = monotonic() + 3
        while any(recovery.process_identity(item[0]) == item for item in active):
            require(monotonic() < deadline, "home_mapping_not_confirmed")
            time.sleep(.05)
        # Always disarm the hook first, even if the old native API fails.
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
    except Exception as error:
        if hook is None or not isinstance(error, hook.HookError):
            raise
        return {"returnValue": False, "errorCode": str(error)}
