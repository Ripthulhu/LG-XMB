#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Read TV API shapes without starting media, changing settings or loading the helper.

Run through an existing SSH connection with: python3 -I -B - < tools/tv-diagnostics.py
The result describes shell access, not permissions granted to the packaged app.
"""

import importlib.util
import json
import os
import selectors
import subprocess
import sys
import time

MAX_REPLY = 65536
TIMEOUT = 4
READS = {
    "system": ("com.webos.service.tv.systemproperty/getSystemInfo",
               {"keys": ["sdkVersion"]}),
    "home": ("com.webos.settingsservice/getSystemSettings",
             {"category": "general", "keys": ["defaultApps", "lastAppHandlerPolicy"],
              "subscribe": False}),
    "preload": ("com.webos.service.preloadmanager/getPreloadPolicy", {}),
    "video": ("com.webos.service.videooutput/getStatus", {}),
}


class ProbeError(Exception):
    """A bounded status code; never includes native output."""


def read_process(argv, timeout=TIMEOUT, limit=MAX_REPLY):
    """Limit both elapsed time and captured bytes, including a stuck child."""
    deadline = time.monotonic() + timeout
    with subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL) as child:
        try:
            data = bytearray()
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not selector.select(remaining):
                        raise ProbeError("timeout")
                    chunk = os.read(child.stdout.fileno(), min(4096, limit + 1 - len(data)))
                    if not chunk:
                        break
                    data.extend(chunk)
                    if len(data) > limit:
                        raise ProbeError("reply_too_large")
            try:
                code = child.wait(timeout=max(0.001, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                raise ProbeError("timeout") from None
            if code:
                raise ProbeError("command_failed")
            return bytes(data)
        finally:
            if child.poll() is None:
                # This is our diagnostic subprocess, not an LG service.
                child.kill()
                child.wait()


def query(name, run=read_process):
    uri, payload = READS[name]
    raw = run(["/usr/bin/luna-send", "-n", "1", "-w", "3000",
               "luna://" + uri, json.dumps(payload, separators=(",", ":"))])
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise ProbeError("invalid_reply") from None
    if not isinstance(value, dict) or type(value.get("returnValue")) is not bool:
        raise ProbeError("invalid_reply")
    if value["returnValue"] is not True or value.get("errorCode") not in (None, 0, "0"):
        raise ProbeError("service_refused")
    return value


def summarize(name, value):
    """Keep only diagnostic fields, never app lists or raw native replies."""
    if name == "system":
        version = value.get("sdkVersion")
        if not isinstance(version, str) or not version or len(version) > 32:
            raise ProbeError("unexpected_shape")
        if any(c not in "0123456789.-" for c in version):
            raise ProbeError("unexpected_shape")
        return {"sdkVersion": version}
    if name == "home":
        settings = value.get("settings")
        if not isinstance(settings, dict):
            raise ProbeError("unexpected_shape")
        apps = settings.get("defaultApps")
        if not isinstance(apps, dict) or not all(
                isinstance(k, str) and isinstance(v, str) for k, v in apps.items()):
            raise ProbeError("unexpected_shape")
        home = apps.get("home")
        return {"assignment": "custom" if home == "org.local.openxmb.c5" else
                "stock" if home == "com.webos.app.home" else
                "unset" if home is None else "other",
                "hasLastAppPolicy": isinstance(settings.get("lastAppHandlerPolicy"), str)}
    if name == "preload":
        rows = value.get("applications")
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise ProbeError("unexpected_shape")
        return {"hasPolicyList": True,
                "hasHomePolicy": any(row.get("id") == "com.webos.app.home" and
                                     type(row.get("isEnabled")) is bool for row in rows)}
    if name == "video":
        if not all(isinstance(value.get(key), list) for key in ("video", "clients")):
            raise ProbeError("unexpected_shape")
        return {"hasVideoList": True, "hasClientList": True}
    raise ValueError("Unknown probe")


def collect(call=query):
    result = {"schema": 1, "context": "shell", "effectiveUid": os.geteuid(),
              "python": ".".join(map(str, sys.version_info[:3])), "reads": {}}
    for name in READS:
        try:
            result["reads"][name] = dict(status="ok", **summarize(name, call(name)))
        except ProbeError as error:
            result["reads"][name] = {"status": str(error)}
        except FileNotFoundError:
            result["reads"][name] = {"status": "command_missing"}
        except OSError:
            result["reads"][name] = {"status": "command_unavailable"}
    result["modules"] = {}
    for name in ("dataclasses", "cv2", "numpy"):
        try:
            result["modules"][name] = importlib.util.find_spec(name) is not None
        except (ImportError, ValueError):
            result["modules"][name] = False
    return result


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if args in (["-h"], ["--help"]):
        print(__doc__)
        return 0
    if args:
        print("No arguments accepted. Use --help for instructions.", file=sys.stderr)
        return 2
    print(json.dumps(collect(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
