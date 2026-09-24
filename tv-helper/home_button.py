#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Change only the native Home button assignment after an explicit UI choice."""
import copy
import fcntl
import hashlib
import json
import os
import re
import selectors
import stat
import subprocess
import time

APP_DIR = "/media/developer/apps/usr/palm/applications/org.local.openxmb.c5"
STOCK_HOME = "/usr/palm/applications/com.webos.app.home"
HOME_PAYLOAD = "/var/lib/lg-xmb-home"
APPS = {"stock": "com.webos.app.home", "xmb": "org.local.openxmb.c5"}
KEYS = ("defaultApps", "lastAppHandlerPolicy", "homeAutoLaunch")
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
    deadline = time.monotonic() + 4
    with subprocess.Popen(["/usr/bin/luna-send", "-n", "1", "-w", "3000",
                           URLS[operation], json.dumps(payload)], stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as child:
        try:
            raw = bytearray()
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    require(remaining > 0 and selector.select(remaining), "native_timeout")
                    part = os.read(child.stdout.fileno(), min(4096, 65537 - len(raw)))
                    if not part:
                        break
                    raw.extend(part)
                    require(len(raw) <= 65536, "invalid_reply")
            try:
                code = child.wait(timeout=max(.001, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                raise HomeButtonError("native_timeout") from None
            require(code == 0, "native_unavailable")
            value = json.loads(raw)
            require(isinstance(value, dict) and value.get("returnValue") is True
                    and value.get("errorCode") in (None, 0, "0"), "native_unavailable")
            return value
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()


def settings(call=native):
    value = call("get", {"category": "general", "keys": list(KEYS),
                         "subscribe": False}).get("settings")
    require(isinstance(value, dict) and isinstance(value.get("defaultApps"), dict)
            and len(value["defaultApps"]) <= 128 and all(
                isinstance(key, str) and isinstance(app, str) and len(app) <= 256
                for key, app in value["defaultApps"].items())
            and isinstance(value.get("lastAppHandlerPolicy"), str), "invalid_home_settings")
    # Some releases omit homeAutoLaunch. Include it when supplied and ensure its
    # presence and value remain identical after changing the button assignment.
    require("homeAutoLaunch" not in value or type(value["homeAutoLaunch"]) in (str, bool),
            "invalid_home_settings")
    return {key: copy.deepcopy(value[key]) for key in KEYS if key in value}


def revision(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def public(value):
    app = value["defaultApps"].get("home")
    mode = "stock" if app in (None, APPS["stock"]) else "xmb" if app == APPS["xmb"] else "other"
    return {"returnValue": True, "mode": mode, "available": True, "revision": revision(value)}


def overlay_active():
    try:
        source, target = os.stat(HOME_PAYLOAD), os.stat(STOCK_HOME)
    except FileNotFoundError:
        return False
    return (source.st_dev, source.st_ino) == (target.st_dev, target.st_ino)


def apply(mode, expected, call=native, overlay=overlay_active):
    require(mode in APPS and isinstance(expected, str)
            and re.fullmatch("[0-9a-f]{64}", expected), "invalid_command")
    require(not overlay(), "home_overlay_active")
    before = settings(call)
    require(revision(before) == expected, "home_mapping_changed")
    if before["defaultApps"].get("home") == APPS[mode]:
        return public(before)
    # A second read catches changes made while the menu was open or by another
    # controller. The native API has no transactional compare-and-set operation.
    require(settings(call) == before and not overlay(), "home_mapping_changed")
    call("set", {"category": "home", "appId": APPS[mode]})
    after = settings(call)
    wanted = copy.deepcopy(before)
    wanted["defaultApps"]["home"] = APPS[mode]
    require(after == wanted, "home_mapping_not_confirmed")
    return public(after)


def command(args):
    lock = None
    try:
        require(os.geteuid() == 0, "root_required")
        require(args == ["get"] or (len(args) == 3 and args[0] == "set"
                and args[1] in APPS and re.fullmatch("[0-9a-f]{64}", args[2])), "invalid_command")
        require(not overlay_active(), "home_overlay_active")
        if args == ["get"]:
            return public(settings())
        # Reuse the verified installed directory as a lock. No state file,
        # startup hook, capture process or background controller is created.
        lock = os.open(APP_DIR, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(lock)
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0, "unsafe_app_path")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise HomeButtonError("home_button_busy") from None
        return apply(args[1], args[2])
    except HomeButtonError as error:
        return {"returnValue": False, "errorCode": str(error)}
    except (OSError, ValueError, TypeError):
        return {"returnValue": False, "errorCode": "home_button_unavailable"}
    finally:
        if lock is not None:
            os.close(lock)
