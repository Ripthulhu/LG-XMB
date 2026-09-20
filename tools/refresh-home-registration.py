#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Refresh an already mounted Home payload, once, from the TV's root shell.

This interrupts Home and its media. Run during setup or from the Home mount
hook, never as a standby watchdog. --force exercises the transaction even
when SAM already knows the payload. No mounts, app files or settings change.
The mount hook uses --startup to preserve an input selected during boot.
"""
import argparse
from collections import namedtuple
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import time

HOME_ID = "com.webos.app.home"
HOME = Path("/usr/palm/applications") / HOME_ID
PAYLOAD = Path("/var/lib/lg-xmb-home")
STATE = Path("/var/lib/lg-xmb")
SAM = "sam.service"
MEDIA = "umediaserver.service"
DMOST = "dmost.service"
OBSERVER = "com.webos.media.appobserver"
WAIT_SECONDS = 12
MAX_REPLY = 262144
CAPTURE = "/usr/sbin/captureservice"
CaptureIdentity = namedtuple("CaptureIdentity", "pid start command")


class RefreshError(Exception):
    """A short error code, without arbitrary native command output."""


def require(condition, code):
    if not condition:
        raise RefreshError(code)


def protected(path, directory=False):
    value = path.lstat()
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    require(kind(value.st_mode) and value.st_uid == 0 and not value.st_mode & 0o022,
            "unsafe_payload_path")
    if not directory:
        require(value.st_nlink == 1 and value.st_size <= 65536, "unsafe_payload_file")


def checked_payload():
    protected(PAYLOAD, directory=True)
    protected(HOME, directory=True)
    require(os.path.samefile(PAYLOAD, HOME), "home_payload_not_mounted")
    mounts = Path("/proc/self/mountinfo").read_text().splitlines()
    require(sum(line.split()[4] == str(HOME) for line in mounts) == 1,
            "unexpected_home_mount")
    manifest = PAYLOAD / "appinfo.json"
    protected(manifest)
    value = json.loads(manifest.read_text())
    require(isinstance(value, dict) and value.get("id") == HOME_ID
            and value.get("type") == "web" and value.get("main") == "index.html"
            and isinstance(value.get("version"), str) and value["version"]
            and value.get("supportQuickStart") is True, "unexpected_home_manifest")
    return value


@contextmanager
def setup_lock():
    import fcntl
    protected(STATE, directory=True)
    fd = os.open(str(STATE / "home-registration.lock"),
                 os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        value = os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_uid == 0
                and value.st_nlink == 1 and not value.st_mode & 0o077, "unsafe_setup_lock")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RefreshError("refresh_already_running") from None
        yield
    finally:
        os.close(fd)


def run_command(argv):
    deadline = time.monotonic() + 5
    with subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL) as child:
        try:
            data = bytearray()
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    require(remaining > 0 and selector.select(remaining), "command_timeout")
                    chunk = os.read(child.stdout.fileno(), min(4096, MAX_REPLY + 1 - len(data)))
                    if not chunk:
                        break
                    data.extend(chunk)
                    require(len(data) <= MAX_REPLY, "reply_too_large")
            try:
                code = child.wait(timeout=max(0.001, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                raise RefreshError("command_timeout") from None
            require(code == 0, "command_failed")
        finally:
            if child.poll() is None:
                child.kill()  # Only our command process, never an LG service.
                child.wait()
    try:
        return bytes(data).decode("utf-8")
    except UnicodeDecodeError:
        raise RefreshError("invalid_command_output") from None


def process_start(pid):
    # The command name may contain spaces or parentheses. Field 22 follows
    # the final ')' plus 19 fields, rather than a naive split of /proc/stat.
    fields = (Path("/proc") / str(pid) / "stat").read_text().rsplit(")", 1)[1].split()
    return int(fields[19])


def capture_identity(pid):
    process = Path("/proc") / str(pid)
    try:
        start = process_start(pid)
        if os.readlink(str(process / "exe")) != CAPTURE:
            return None
        command = (process / "cmdline").read_bytes()
        require(command.split(b"\0")[0] == CAPTURE.encode()
                and process_start(pid) == start, "capture_identity_changed")
        return CaptureIdentity(pid, start, command)
    except (FileNotFoundError, ProcessLookupError):
        return None


def capture_process():
    found = []
    for path in Path("/proc").iterdir():
        if path.name.isdigit():
            value = capture_identity(int(path.name))
            if value:
                found.append(value)
    require(len(found) <= 1, "multiple_capture_processes")
    return found[0] if found else None


def capture_signal_support():
    require(hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"),
            "capture_restart_requires_pidfd")
    fd = None
    try:
        # Python may expose these calls while the TV's kernel lacks them.
        # Signal 0 checks availability without sending a signal to the process.
        fd = os.pidfd_open(os.getpid(), 0)
        signal.pidfd_send_signal(fd, 0, None, 0)
    except OSError:
        raise RefreshError("capture_restart_requires_pidfd") from None
    finally:
        if fd is not None:
            os.close(fd)


def terminate_capture(identity):
    # Pin the process before the last identity check. If it exits or its PID
    # is reused afterward, the signal cannot reach the replacement process.
    try:
        fd = os.pidfd_open(identity.pid, 0)
    except ProcessLookupError:
        return  # It exited while the preflight queries were running.
    try:
        current = capture_identity(identity.pid)
        if current is None:
            return
        require(current == identity, "capture_identity_changed")
        try:
            signal.pidfd_send_signal(fd, signal.SIGTERM, None, 0)
        except ProcessLookupError:
            pass  # It exited after verification; there is nothing to terminate.
    finally:
        os.close(fd)


class CaptureService:
    """Reset only a pre-existing capture client stranded by this media reset."""
    def __init__(self, scan=capture_process, identify=capture_identity,
                 terminate=terminate_capture, start_time=process_start,
                 signal_support=capture_signal_support):
        self.scan, self.identify, self.terminate, self.start_time = scan, identify, terminate, start_time
        self.before = self.scan()
        if self.before:
            signal_support()  # Fail before any service changes on older Python.
        self.attempted = self.signalled = self.activation_attempted = False

    def activate(self, owner):
        self.activation_attempted = True
        owner.query("com.webos.service.capture/getCapability")

    def refresh(self, owner):
        self.attempted = True
        media_start = self.start_time(owner.service(MEDIA)["MainPID"])
        current = self.scan()
        if self.before is None:
            require(current is None or current.start > media_start, "capture_started_during_refresh")
            return False
        if current == self.before:
            owner.preflight()  # Reject capture resources acquired since setup began.
            self.terminate(self.before)
            self.signalled = True
            owner.wait(lambda: self.identify(self.before.pid) != self.before, "capture_stop_timeout")
            current = self.scan()
        # A different process is never signalled. A replacement is usable only
        # if it registered after the new media server started.
        require(current is None or current.start > media_start, "capture_changed_during_refresh")
        self.activate(owner)
        current = self.scan()
        require(current is not None and current.start > media_start, "capture_start_unverified")
        return True

    def restore_availability(self, owner):
        # SIGTERM may finish just after the bounded exit wait. Make at most one
        # activation request; never repeat a signal or restart another process.
        if self.before and self.signalled and not self.activation_attempted and self.scan() is None:
            self.activate(owner)


class HomeRegistration:
    def __init__(self, systemctl, run=run_command, validate=checked_payload,
                 clock=time.monotonic, sleep=time.sleep, capture_factory=CaptureService):
        self.systemctl, self.run, self.validate = systemctl, run, validate
        self.clock, self.sleep = clock, sleep
        self.capture_factory = capture_factory
        self.recovery_errors = []
        self.startup_input = None
        self.input_restore_attempted = False

    def query(self, method, payload=None):
        raw = self.run(["/usr/bin/luna-send", "-n", "1", "-w", "3000",
                        "luna://" + method, json.dumps(payload or {}, separators=(",", ":"))])
        try:
            value = json.loads(raw)
        except (ValueError, TypeError):
            raise RefreshError("invalid_service_reply") from None
        if isinstance(value, dict):
            require(value.get("returnValue") is True, "service_refused")
        return value

    def service(self, name):
        raw = self.run([self.systemctl, "show", "--property=LoadState",
                        "--property=ActiveState", "--property=MainPID", name])
        value = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
        require(value.get("LoadState") == "loaded", "service_not_loaded")
        require(value.get("ActiveState") in ("active", "inactive", "failed", "activating",
                                             "deactivating"), "unknown_service_state")
        try:
            value["MainPID"] = int(value["MainPID"])
        except (KeyError, ValueError):
            raise RefreshError("unknown_service_pid") from None
        require(value["MainPID"] >= 0, "unknown_service_pid")
        return value

    def change(self, action, name):
        # Queue a single job; polling below bounds the wait without leaving a
        # timed-out systemctl process waiting for an unobserved service job.
        self.run([self.systemctl, "--no-block", action, name])

    def wait(self, predicate, code):
        deadline = self.clock() + WAIT_SECONDS
        while True:
            try:
                if predicate():
                    return
            except RefreshError:
                pass  # LS2 registration can briefly disappear during startup.
            if self.clock() >= deadline:
                raise RefreshError(code)
            self.sleep(0.25)

    def observer(self):
        value = self.query("com.webos.applicationManager/com/palm/luna/private/subscriptions")
        require(isinstance(value, dict) and isinstance(value.get("subscriptions"), list),
                "invalid_subscriptions")
        for group in value["subscriptions"]:
            require(isinstance(group, dict) and isinstance(group.get("subscribers"), list),
                    "invalid_subscriptions")
            if group.get("key") == "getAppLifeStatus":
                return any(isinstance(row, dict) and row.get("service_name") == OBSERVER
                           for row in group["subscribers"])
        return False

    def registered(self, manifest):
        value = self.query("com.webos.applicationManager/getAppInfo", {"id": HOME_ID})
        require(isinstance(value, dict) and isinstance(value.get("appInfo"), dict),
                "invalid_home_info")
        app = value["appInfo"]
        return (all(app.get(key) == manifest[key] for key in ("id", "type", "version"))
                and app.get("folderPath") == str(HOME)
                and app.get("main") in ("index.html", str(HOME / "index.html")))

    def foreground(self):
        value = self.query("com.webos.applicationManager/getForegroundAppInfo")
        require(isinstance(value, dict) and isinstance(value.get("appId"), str),
                "invalid_foreground_status")
        return value["appId"]

    def preflight(self, startup=False):
        foreground = self.foreground()
        if startup and re.fullmatch(r"com\.webos\.app\.hdmi[1-4]", foreground):
            self.startup_input = foreground
        require(foreground in ("", HOME_ID, self.startup_input),
                "leave_other_apps_before_refresh")
        pipelines = self.query("com.webos.media/getActivePipelines")
        if (isinstance(pipelines, dict) and pipelines.get("returnValue") is True
                and pipelines.get("data") == "pipeline empty"
                and pipelines.get("mediaId") == "<anonymous>"
                and pipelines.get("errorCode", 0) == 0):
            pipelines = []
        require(isinstance(pipelines, list), "invalid_media_status")
        for pipeline in pipelines:
            require(isinstance(pipeline, dict) and isinstance(pipeline.get("resource"), list)
                    and isinstance(pipeline.get("type"), str), "invalid_media_status")
            require(all(isinstance(row, dict) and isinstance(row.get("resource"), str)
                        for row in pipeline["resource"]), "invalid_media_status")
            resources = {row["resource"] for row in pipeline["resource"]}
            # Never interrupt recordings or casting. Manual refresh also
            # excludes active native input playback.
            # Empty background service clients are normal during TV startup.
            harmless = (pipeline["type"] in ("avconnector", "cirmc", "dvbcasrmc", "vtg", "vtclient")
                        and not pipeline["resource"])
            home_audio = (pipeline.get("currentAppId") == HOME_ID and pipeline["type"] == "media"
                          and resources <= {"ADEC", "ADEC_BANDWIDTH", "MAIN_SOUND", "MIXING_SOUND"})
            # webOS keeps the last input's receiver allocated behind Home.
            # SAM's restart clears that native instance; it is safe to include
            # only known inactive input clients, never recording/casting types.
            owner = pipeline.get("currentAppId", "")
            inactive_input = (isinstance(owner, str)
                              and (re.fullmatch(r"com\.webos\.app\.hdmi[1-4]", owner)
                                   or owner == "com.webos.app.livetv")
                              and pipeline["type"] in ("tv", "avconnector")
                              and pipeline.get("is_foreground") is False
                              and pipeline.get("is_focus") is False
                              and pipeline.get("sharedAppIdList", "") == ""
                              and resources <= {"HDMI_INPUT", "VHDMIRX", "AHDMIRX", "ADEC",
                                                "ADEC_BANDWIDTH", "SUB_SCALER", "ADTU", "DTU",
                                                "ATU", "SDEC"})
            # A boot can restore HDMI before this hook runs. Only that saved
            # input may hold active output resources; other apps stay excluded.
            startup_resources = {
                "tv": {"HDMI_INPUT", "VHDMIRX", "AHDMIRX", "ADEC", "ADEC_BANDWIDTH", "SUB_SCALER"},
                "avconnector": {"MAIN_SCALER", "MAIN_SOUND"},
            }
            startup_input = (self.startup_input is not None and owner == self.startup_input
                             and isinstance(pipeline.get("is_foreground"), bool)
                             and isinstance(pipeline.get("is_focus"), bool)
                             and pipeline.get("sharedAppIdList", "") == ""
                             and pipeline["type"] in startup_resources
                             and resources <= startup_resources[pipeline["type"]])
            require(harmless or home_audio or inactive_input or startup_input, "media_in_use")

    def inspect(self, startup=False):
        manifest = self.validate()
        initial = {name: self.service(name) for name in (SAM, MEDIA, DMOST)}
        require(all(initial[name]["ActiveState"] == "active" and initial[name]["MainPID"] > 0
                    for name in (SAM, MEDIA)), "sam_and_media_must_be_running")
        require(initial[DMOST]["ActiveState"] in ("active", "inactive", "failed"),
                "dmost_is_transitioning")
        self.preflight(startup=startup)
        return manifest, initial

    def check(self):
        manifest, initial = self.inspect()
        return {"readyToRefresh": True, "registered": self.registered(manifest),
                "mediaObserver": self.observer(),
                "dmostActive": initial[DMOST]["ActiveState"] == "active",
                "captureRunning": self.capture_factory().before is not None}

    def ensure_started(self, name):
        self.change("start", name)
        self.wait(lambda: self.service(name)["ActiveState"] == "active", "service_start_timeout")

    def restore_startup_input(self):
        if not self.startup_input or self.input_restore_attempted:
            return False
        self.input_restore_attempted = True
        power = self.query("com.webos.service.tvpower/power/getPowerState")
        # A background boot must not wake the TV. Nor should a new app selected
        # while this transaction ran be replaced with the earlier input.
        if not isinstance(power, dict) or power.get("state") != "Active":
            return False
        if self.foreground() not in ("", HOME_ID, self.startup_input):
            return False
        self.query("com.webos.applicationManager/launch", {"id": self.startup_input})
        self.wait(lambda: self.foreground() == self.startup_input, "input_restore_timeout")
        return True

    def refresh(self, force=False, startup=False):
        manifest = self.validate()
        if self.registered(manifest) and not force:
            require(self.observer(), "media_observer_missing")
            return {"changed": False, "mediaObserver": True}
        checked, initial = self.inspect(startup=startup)
        require(checked == manifest and self.validate() == manifest, "payload_changed")
        capture = self.capture_factory()
        media_stopped = sam_touched = False
        try:
            # uMedia's lifecycle observer does not reconnect to a restarted SAM.
            # Stop it first, then let SAM's normal restart clear native clients.
            # Start media only after the new SAM is ready, before restoring dmost.
            media_stopped = True  # A command failure may still have queued its job.
            self.change("stop", MEDIA)
            self.wait(lambda: self.service(MEDIA)["ActiveState"] == "inactive", "media_stop_timeout")
            require(self.service(MEDIA)["ActiveState"] == "inactive", "media_restarted_during_refresh")
            sam_touched = True
            self.change("restart", SAM)
            def sam_ready():
                service = self.service(SAM)
                return (service["ActiveState"] == "active" and service["MainPID"] > 0
                        and service["MainPID"] != initial[SAM]["MainPID"]
                        and self.registered(manifest))
            self.wait(sam_ready, "home_registration_timeout")
            require(self.service(MEDIA)["ActiveState"] == "inactive", "media_restarted_during_refresh")
            self.ensure_started(MEDIA)
            self.wait(self.observer, "media_observer_timeout")
            capture_refreshed = capture.refresh(self)
            if initial[DMOST]["ActiveState"] == "active":
                self.ensure_started(DMOST)
            require(self.validate() == manifest, "payload_changed")
            restored_input = self.restore_startup_input()
            media_stopped = False
            result = {"changed": True, "mediaObserver": True,
                      "dmostRestored": initial[DMOST]["ActiveState"] == "active",
                      "captureRefreshed": capture_refreshed}
            if startup:
                result["restoredInput"] = self.startup_input if restored_input else None
            return result
        finally:
            if media_stopped:
                # Start, never restart, on failure. No retry loop can repeatedly
                # disrupt the TV. Report each failure without masking the first.
                restore = ([SAM] if sam_touched else []) + [MEDIA]
                if initial[DMOST]["ActiveState"] == "active":
                    restore.append(DMOST)
                for name in restore:
                    try:
                        self.ensure_started(name)
                    except (RefreshError, OSError) as error:
                        self.recovery_errors.append({"service": name, "error": str(error)})
                try:
                    if (capture.before and not capture.attempted
                            and self.service(MEDIA)["MainPID"] != initial[MEDIA]["MainPID"]):
                        self.wait(self.observer, "media_observer_timeout")
                        capture.refresh(self)
                    else:
                        capture.restore_availability(self)
                except (RefreshError, OSError) as error:
                    self.recovery_errors.append({"service": "com.webos.service.capture", "error": str(error)})
                if sam_touched and self.startup_input and not self.input_restore_attempted:
                    try:
                        if self.observer():
                            self.restore_startup_input()
                    except (RefreshError, OSError) as error:
                        self.recovery_errors.append({"service": "com.webos.applicationManager", "error": str(error)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--force", action="store_true", help="refresh even if Home metadata already matches")
    mode.add_argument("--check", action="store_true", help="read setup readiness without changing anything")
    mode.add_argument("--startup", action="store_true", help="mount hook: preserve a boot-selected HDMI input")
    args = parser.parse_args()
    operation = None
    try:
        require(os.geteuid() == 0, "root_required")
        systemctl = shutil.which("systemctl", path="/usr/bin:/bin:/usr/sbin:/sbin")
        require(systemctl is not None, "systemctl_missing")
        operation = HomeRegistration(systemctl)
        if args.check:
            result = operation.check()
        else:
            with setup_lock():
                result = operation.refresh(force=args.force, startup=args.startup)
        result["returnValue"] = True
    except (RefreshError, OSError, ValueError) as error:
        result = {"returnValue": False, "error": str(error)}
        if operation and operation.recovery_errors:
            result["recoveryErrors"] = operation.recovery_errors
    print(json.dumps(result))
    return 0 if result["returnValue"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
