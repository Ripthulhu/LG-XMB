#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Prepare lg-xmb's bundled helper and start its single background worker."""
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
import types
import traceback

# Retained as the upgrade identifier; runtime files use the project name.
APP_DIR = "/media/developer/apps/usr/palm/applications/org.local.openxmb.c5"
BASE = "/var/lib/lg-xmb"
LEGACY_BASE = "/var/lib/openxmb-c5"
CACHE = "/tmp/lg-xmb-thumbnails"
LEGACY_CACHE = "/tmp/openxmb-c5-thumbnails"
LOG_DIR = "/var/lib/webosbrew"
LOG_NAME = "lg-xmb-startup.log"
WORKER_LOG_NAME = "lg-xmb-worker.log"
BUNDLE_SHA256 = "@BUNDLE_SHA256@"  # Filled by the packager, not learned from the TV.
PYTHON = "/usr/bin/python3"
FILES = ("process_control.py", "thumbnail_cache.py", "stop_thumbnail_helper.py")


class SetupError(Exception):
    pass


def require(condition, code="unsafe_helper_path"):
    if not condition:
        raise SetupError(code)


def open_directory(path, app_path=False):
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.strip("/").split("/"):
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
            info = os.fstat(descriptor)
            # LG owns writable installation ancestors. checked_app() repairs
            # only our exact pinned app directory and manifest, not those parents.
            require(info.st_uid == 0 and (app_path or not info.st_mode & 0o022))
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def regular_file(info, app_file=False):
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
            and (app_file or not info.st_mode & 0o022))


def read_file(directory, name, limit=131072, optional=False, app_file=False):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                     dir_fd=directory)
    except FileNotFoundError:
        if optional:
            return None
        raise SetupError("bundle_incomplete") from None
    try:
        regular_file(os.fstat(fd), app_file)
        raw = bytearray()
        while len(raw) <= limit:
            chunk = os.read(fd, min(8192, limit + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
        require(len(raw) <= limit, "oversized_helper_file")
        return bytes(raw)
    finally:
        os.close(fd)


def make_directory(parent, name):
    try:
        os.mkdir(name, 0o755, dir_fd=parent)
    except FileExistsError:
        pass
    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        meta = os.fstat(child)
        require(meta.st_uid == 0 and not meta.st_mode & 0o022)
        return child
    except BaseException:
        os.close(child)
        raise


def write_file(directory, name, raw):
    # Atomic replacement, but never follow or replace a foreign existing entry.
    try:
        regular_file(os.stat(name, dir_fd=directory, follow_symlinks=False))
    except FileNotFoundError:
        pass
    temporary = ".setup-" + os.urandom(8).hex()
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=directory)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass


def load_module(name, raw, path):
    module = types.ModuleType(name)
    module.__file__ = path
    # Dataclasses consult sys.modules while the class body is evaluated.
    sys.modules[name] = module
    exec(compile(raw, path, "exec"), module.__dict__)
    return module


def load_bundle():
    """Verify installed bytes before repairing modes or importing helper code."""
    app = open_directory(APP_DIR, app_path=True)
    helper = None
    files = {}
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK

    def identity(info):
        return info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode), info.st_uid, info.st_nlink

    def open_member(parent, name, key):
        fd = os.open(name, flags, dir_fd=parent)
        files[key] = (parent, name, fd)
        regular_file(os.fstat(fd), app_file=True)
        return fd

    def read(fd):
        regular_file(os.fstat(fd), app_file=True)
        os.lseek(fd, 0, os.SEEK_SET)
        raw = bytearray()
        while len(raw) <= 131072:
            chunk = os.read(fd, min(8192, 131073 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
        require(len(raw) <= 131072, "oversized_helper_file")
        return bytes(raw)

    def bindings():
        # Reopen the anchored app path too: unchanged leaf names are not enough
        # when an installation directory was replaced during the operation.
        current = open_directory(APP_DIR, app_path=True)
        try:
            require(identity(os.fstat(current)) == identity(os.fstat(app)), "helper_path_changed")
        finally:
            os.close(current)
        named = os.stat("helper", dir_fd=app, follow_symlinks=False)
        require(identity(named) == identity(os.fstat(helper)), "helper_path_changed")
        for parent, name, fd in files.values():
            require(identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) ==
                    identity(os.fstat(fd)), "helper_path_changed")
            regular_file(os.fstat(fd), app_file=True)

    def verify():
        bindings()
        raw = read(files["bundle.json"][2])
        require(hashlib.sha256(raw).hexdigest() == BUNDLE_SHA256, "helper_bundle_mismatch")
        manifest = json.loads(raw)
        require(isinstance(manifest, dict) and manifest.get("schema") == 1 and
                set(manifest.get("files", {})) == set(FILES), "invalid_helper_bundle")
        appinfo = read(files["appinfo.json"][2])
        require(hashlib.sha256(appinfo).hexdigest() == manifest.get("appinfoSha256"),
                "untrusted_app_manifest")
        # The bootstrap includes the bundle pin, so hash its source template.
        startup = read(files["helper-startup.py"][2])
        pin = ('\nBUNDLE_SHA256 = "' + BUNDLE_SHA256 + '"').encode()
        require(startup.count(pin) == 1, "helper_bundle_mismatch")
        template = startup.replace(pin, b'\nBUNDLE_SHA256 = "@BUNDLE_SHA256@"', 1)
        require(hashlib.sha256(template).hexdigest() == manifest.get("startupSha256"),
                "helper_bundle_mismatch")
        sources = {name: read(files[name][2]) for name in FILES}
        require(all(hashlib.sha256(sources[name]).hexdigest() == manifest["files"][name]
                    for name in FILES), "helper_bundle_mismatch")
        bindings()
        return sources, manifest

    try:
        try:
            fcntl.flock(app, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SetupError("helper_busy") from None
        helper = os.open("helper", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=app)
        require(os.fstat(helper).st_uid == 0, "helper_owner_mismatch")
        open_member(app, "appinfo.json", "appinfo.json")
        open_member(app, "helper-startup.py", "helper-startup.py")
        for name in ("bundle.json",) + FILES:
            open_member(helper, name, name)
        sources, manifest = verify()
        # webOS can reset installed directories/files to writable modes. Repair
        # only the verified app and bundle, never their shared ancestors or uid.
        targets = [(app, 0o755), (helper, 0o755)] + [
            (fd, 0o755 if key == "helper-startup.py" else 0o644)
            for key, (_, _, fd) in files.items()]
        for fd, mode in targets:
            bindings()
            if stat.S_IMODE(os.fstat(fd).st_mode) != mode:
                os.fchmod(fd, mode)
        # chmod cannot revoke old write handles. Recheck bytes and inode bindings
        # before compiling the already-read code, and leave any change refused.
        sources, manifest = verify()
        require(all(stat.S_IMODE(os.fstat(fd).st_mode) == mode for fd, mode in targets),
                "helper_permissions_not_confirmed")
    except FileNotFoundError:
        raise SetupError("bundle_incomplete") from None
    finally:
        for _, _, fd in files.values():
            os.close(fd)
        if helper is not None:
            os.close(helper)
        os.close(app)
    control = load_module("lg_xmb_control", sources[FILES[0]], APP_DIR + "/helper/" + FILES[0])
    require(control.PIN_APPINFO_SHA256 == manifest["appinfoSha256"], "helper_bundle_mismatch")
    control.checked_app()
    recovery = load_module("lg_xmb_recovery", sources[FILES[2]], APP_DIR + "/helper/" + FILES[2])
    return control, recovery, BUNDLE_SHA256


class SetupLog:
    """One bounded, private record per setup attempt, including early failures."""
    def __init__(self):
        self.fd = self.lock = None
        self.stage = "starting"
        parent = open_directory(os.path.dirname(LOG_DIR))
        try:
            directory = make_directory(parent, os.path.basename(LOG_DIR))
        finally:
            os.close(parent)
        try:
            self.lock = os.open("lg-xmb-setup.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                                0o600, dir_fd=directory)
            regular_file(os.fstat(self.lock))
            try:
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SetupError("helper_busy") from None
            # RC1 workers kept the old log inode locked for their lifetime.
            # Replace our checked log entry, not that lock or a foreign file.
            write_file(directory, LOG_NAME, b"")
            self.fd = os.open(LOG_NAME, os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            regular_file(os.fstat(self.fd))
            self.record("starting")
        except BaseException:
            if self.fd is not None:
                os.close(self.fd)
            if self.lock is not None:
                os.close(self.lock)
            raise
        finally:
            os.close(directory)

    def record(self, stage, error=None):
        self.stage = stage
        value = {"time": int(time.time()), "stage": stage}
        if error is not None:
            value["exception"] = type(error).__name__
            if isinstance(error, SetupError):
                value["code"] = str(error)
            if isinstance(error, OSError):
                value["errno"] = error.errno
            # Line locations are useful; native replies, locals and exception
            # messages can contain private TV data and are not written here.
            value["trace"] = ["%s:%s:%s" % (os.path.basename(frame.filename), frame.lineno, frame.name)
                              for frame in traceback.extract_tb(error.__traceback__)[-8:]]
        raw = (json.dumps(value, separators=(",", ":")) + "\n").encode()
        if os.fstat(self.fd).st_size + len(raw) <= 8192:
            os.write(self.fd, raw)
            os.fsync(self.fd)

    def close(self):
        os.close(self.fd)
        os.close(self.lock)


def migrate_config(base, control, previous):
    current = read_file(base, "background.json", optional=True)
    if current is not None:
        control.valid_config(json.loads(current))
    legacy = None
    if not previous or not previous.get("legacyMigrated"):
        try:
            old = open_directory(LEGACY_BASE)
        except FileNotFoundError:
            old = None
        if old is not None:
            try:
                legacy = read_file(old, "background.json", optional=True)
                if legacy is not None:
                    control.valid_config(json.loads(legacy))
            finally:
                os.close(old)
        require(current is None or legacy is None or json.loads(current) == json.loads(legacy),
                "legacy_config_conflict")
    if current is None:
        raw = legacy if legacy is not None else json.dumps(control.default_config()).encode()
        write_file(base, "background.json", raw)
    # Old choices remain on disk for recovery, but cannot be imported twice.
    return True


def thumbnail_link():
    app = open_directory(APP_DIR, app_path=True)
    try:
        meta = os.fstat(app)
        require(not meta.st_mode & 0o022)
        try:
            entry = os.stat("thumbnails", dir_fd=app, follow_symlinks=False)
        except FileNotFoundError:
            entry = None
        if entry is not None:
            require(stat.S_ISLNK(entry.st_mode) and entry.st_uid == 0 and entry.st_nlink == 1,
                    "foreign_thumbnail_path")
            target = os.readlink("thumbnails", dir_fd=app)
            require(target in (CACHE, LEGACY_CACHE), "foreign_thumbnail_path")
            if target == CACHE:
                return
            current = os.stat("thumbnails", dir_fd=app, follow_symlinks=False)
            require((entry.st_dev, entry.st_ino, entry.st_ctime_ns) ==
                    (current.st_dev, current.st_ino, current.st_ctime_ns), "thumbnail_path_changed")
            os.unlink("thumbnails", dir_fd=app)
        os.symlink(CACHE, "thumbnails", dir_fd=app)
    finally:
        os.close(app)


def startup_link(recovery):
    parent = open_directory(LOG_DIR)
    try:
        directory = make_directory(parent, "init.d")
    finally:
        os.close(parent)
    try:
        existing = recovery.read_hook(directory)
        if existing is None:
            os.symlink(recovery.HOOK_TARGET, recovery.HOOK_NAME, dir_fd=directory)
        else:
            # New setup creates links only; do not overwrite even a reviewed copy.
            require(existing[1] == recovery.HOOK_TARGET, "startup_hook_conflict")
    finally:
        os.close(directory)


def launch_worker(recovery):
    directory = open_directory(LOG_DIR)
    try:
        log = os.open(WORKER_LOG_NAME, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                      0o600, dir_fd=directory)
    finally:
        os.close(directory)
    try:
        regular_file(os.fstat(log))
        try:
            fcntl.flock(log, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SetupError("helper_busy") from None
        os.ftruncate(log, 0)
        os.write(log, b"lg-xmb: starting bundled worker; capture status: /tmp/lg-xmb-thumbnails/status.json\n")
        child = subprocess.Popen([PYTHON, "-I", "-B", APP_DIR + "/helper/thumbnail_cache.py",
                                  "--allow-home-preview", "--process-controls"],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, pass_fds=(log,),
                                 start_new_session=True, close_fds=True)
        # Catch immediate interpreter/import failures. This does not assert that
        # a signal is present or the TV's capture API will allow a picture.
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            if child.poll() is not None:
                os.write(log, b"lg-xmb: worker exited during startup\n")
                return False
            time.sleep(.05)
        return recovery.process_identity(child.pid) is not None
    finally:
        os.close(log)


def start():
    require(os.geteuid() == 0, "root_required")
    log = SetupLog()
    try:
        require(sys.version_info >= (3, 7), "python_too_old")
        return prepare(log)
    except Exception as error:
        log.record(log.stage, error)
        raise
    finally:
        log.close()


def prepare(log):
    log.record("verify_bundle")
    control, recovery, bundle = load_bundle()
    log.record("prepare_state")
    parent = open_directory(os.path.dirname(BASE))
    try:
        base = make_directory(parent, os.path.basename(BASE))
        logdir = make_directory(parent, os.path.basename(LOG_DIR))
        os.close(logdir)
    finally:
        os.close(parent)
    lock = None
    try:
        lock = os.open("setup.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                       0o600, dir_fd=base)
        regular_file(os.fstat(lock))
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SetupError("helper_busy") from None
        raw = read_file(base, "installed.json", 4096, optional=True)
        previous = json.loads(raw) if raw is not None else None
        require(previous is None or (isinstance(previous, dict)
                and set(previous) == {"bundle", "legacyMigrated"}
                and isinstance(previous["bundle"], str)
                and type(previous["legacyMigrated"]) is bool), "invalid_setup_record")
        log.record("stop_previous_worker")
        # Stop old code before reading its last saved restoration values.
        recovery.stop(legacy_only=True)
        if not previous or previous["bundle"] != bundle:
            recovery.stop()
        log.record("migrate_config")
        migrate_config(base, control, previous)
        log.record("create_links")
        thumbnail_link()
        startup_link(recovery)
        running = recovery.find_helpers()
        require(all(recovery.helper_argument(p[2]) == recovery.HELPER for p in running)
                and len(running) <= 1, "unexpected_helper_process")
        log.record("start_worker")
        capture_running = bool(running) or launch_worker(recovery)
        write_file(base, "installed.json", json.dumps({"bundle": bundle, "legacyMigrated": True}).encode())
        log.record("ready" if capture_running else "capture_start_failed")
        return {"returnValue": True, "ready": True, "captureRunning": capture_running}
    finally:
        if lock is not None:
            os.close(lock)
        os.close(base)


def main():
    if sys.argv[1:] not in ([], ["ensure"]):
        print(json.dumps({"returnValue": False, "errorCode": "invalid_command"}))
        return 2
    try:
        result = start()
    except SetupError as error:
        result = {"returnValue": False, "errorCode": str(error)}
        if str(error) == "root_required":
            result["effectiveUid"] = os.geteuid()
    except (FileNotFoundError, ImportError):
        result = {"returnValue": False, "errorCode": "bundle_incomplete"}
    except Exception:
        # Native command and filesystem errors must not leak raw data to the UI.
        result = {"returnValue": False, "errorCode": "setup_failed"}
    print(json.dumps(result), flush=True)
    return 0 if result["returnValue"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
