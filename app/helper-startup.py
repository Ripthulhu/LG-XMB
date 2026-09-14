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
WORKER_LOCK_NAME = "lg-xmb-worker.lock"
LOG_LIMIT = 16384
PYTHON = "/usr/bin/python3"
FILES = ("process_control.py", "thumbnail_cache.py", "stop_thumbnail_helper.py")
BUNDLE_SHA256 = "@BUNDLE_SHA256@"  # Replaced by the packager, not read from helper/.
LEGACY_HELPER_OWNER = (1001, 1001)  # CI runner IDs shipped in the early 0.1.12 IPKs.


class SetupError(Exception):
    def __init__(self, code, **details):
        super().__init__(code)
        self.details = details


def require(condition, code="unsafe_helper_path", **details):
    if not condition:
        raise SetupError(code, **details)


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


def read_bundle(app, directory):
    raw = read_file(directory, "bundle.json", 4096)
    require(hashlib.sha256(raw).hexdigest() == BUNDLE_SHA256, "helper_bundle_mismatch")
    manifest = json.loads(raw)
    require(isinstance(manifest, dict) and manifest.get("schema") == 1,
            "invalid_helper_bundle")
    hashes = manifest.get("files")
    require(isinstance(hashes, dict) and set(hashes) == set(FILES),
            "invalid_helper_bundle")
    require(all(isinstance(h, str) and re.fullmatch("[0-9a-f]{64}", h)
                for h in list(hashes.values()) + [manifest.get("appinfoSha256")]),
            "invalid_helper_bundle")
    appinfo = read_file(app, "appinfo.json", 65536, app_file=True)
    require(hashlib.sha256(appinfo).hexdigest() == manifest["appinfoSha256"],
            "untrusted_app_manifest")
    sources = {name: read_file(directory, name) for name in FILES}
    require(all(hashlib.sha256(sources[name]).hexdigest() == hashes[name]
                for name in FILES), "helper_bundle_mismatch")
    return manifest, raw, appinfo, sources


def repair_helper_directory(app, directory, original, bundle):
    """Recover only a verified app-owned directory left by an earlier install."""
    expected = {"bundle.json", *FILES}

    def check_binding():
        # Hold the original directory descriptor: never chown a symlink or a
        # replacement selected by a second pathname lookup.
        named = os.stat("helper", dir_fd=app, follow_symlinks=False)
        opened = os.fstat(directory)
        require(stat.S_ISDIR(named.st_mode) and
                (named.st_dev, named.st_ino) == (original.st_dev, original.st_ino) ==
                (opened.st_dev, opened.st_ino), "helper_path_changed")
        current = open_directory(APP_DIR, app_path=True)
        try:
            a, b = os.fstat(app), os.fstat(current)
            require((a.st_dev, a.st_ino) == (b.st_dev, b.st_ino), "helper_path_changed")
        finally:
            os.close(current)
        require(set(os.listdir(directory)) == expected, "unexpected_helper_files")

    check_binding()
    require(read_bundle(app, directory) == bundle, "helper_bundle_changed")
    # The app manifest and every root-owned, non-writable helper file have now
    # matched the independent build pin. Shared installation ancestors are not
    # changed. Only the known legacy directory may have a non-root owner.
    if stat.S_IMODE(os.fstat(app).st_mode) != 0o755:
        os.fchmod(app, 0o755)
    check_binding()
    meta = os.fstat(directory)
    require((meta.st_uid, meta.st_gid) == (original.st_uid, original.st_gid),
            "helper_path_changed")
    legacy = meta.st_uid != 0
    if legacy:
        require((meta.st_uid, meta.st_gid) == LEGACY_HELPER_OWNER, "helper_owner_mismatch")
        os.fchown(directory, 0, 0)
    if stat.S_IMODE(os.fstat(directory).st_mode) != 0o755:
        os.fchmod(directory, 0o755)
    check_binding()
    meta = os.fstat(directory)
    require(meta.st_uid == 0 and (not legacy or meta.st_gid == 0) and
            stat.S_IMODE(meta.st_mode) == 0o755 and
            stat.S_IMODE(os.fstat(app).st_mode) == 0o755, "helper_permissions_failed")
    require(read_bundle(app, directory) == bundle, "helper_bundle_changed")
    record_startup("helper_directory_repaired", path="helper/", fromUid=original.st_uid,
                   fromGid=original.st_gid, fromMode=oct(stat.S_IMODE(original.st_mode)))


def load_bundle():
    app = open_directory(APP_DIR, app_path=True)
    try:
        directory = os.open("helper", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=app)
        try:
            meta = os.fstat(directory)
            require(meta.st_uid == 0 or (meta.st_uid, meta.st_gid) == LEGACY_HELPER_OWNER,
                    "helper_owner_mismatch", path="helper/", uid=meta.st_uid,
                    gid=meta.st_gid, mode=oct(stat.S_IMODE(meta.st_mode)))
            try:
                fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SetupError("helper_busy") from None
            bundle = read_bundle(app, directory)
            if meta.st_uid != 0 or stat.S_IMODE(meta.st_mode) != 0o755:
                repair_helper_directory(app, directory, meta, bundle)
            manifest, raw, appinfo, sources = bundle
        finally:
            os.close(directory)
    finally:
        os.close(app)
    control = load_module("lg_xmb_control", sources[FILES[0]], APP_DIR + "/helper/" + FILES[0])
    require(control.PIN_APPINFO_SHA256 == manifest["appinfoSha256"], "helper_bundle_mismatch")
    control.checked_app()
    recovery = load_module("lg_xmb_recovery", sources[FILES[2]], APP_DIR + "/helper/" + FILES[2])
    return control, recovery, hashlib.sha256(raw).hexdigest()


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


def record_startup(event, error=None, **details):
    """Bounded local diagnostics, independent of bundle loading and worker locks."""
    if os.geteuid() != 0:
        return False
    directory = log = None
    try:
        parent = open_directory(os.path.dirname(LOG_DIR))
        try:
            directory = make_directory(parent, os.path.basename(LOG_DIR))
        finally:
            os.close(parent)
        log = os.open(LOG_NAME, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                      0o600, dir_fd=directory)
        regular_file(os.fstat(log))
        fcntl.flock(log, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.fchmod(log, 0o600)
        value = {"time": int(time.time()), "event": event, **details}
        if error is not None:
            value["exception"] = type(error).__name__
            value["frames"] = [{"file": os.path.basename(f.filename), "line": f.lineno,
                                "function": f.name} for f in traceback.extract_tb(error.__traceback__)[-8:]]
            if isinstance(error, SetupError):
                value["code"] = str(error)
                value.update(error.details)
            elif isinstance(error, OSError):
                value["errno"] = error.errno
        # No raw native replies, config contents or exception messages in logs.
        line = (json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n").encode()
        if len(line) > LOG_LIMIT // 2:
            return False
        size = os.fstat(log).st_size
        os.lseek(log, max(0, size - (LOG_LIMIT - len(line))), os.SEEK_SET)
        tail = os.read(log, LOG_LIMIT - len(line))
        if size > len(tail):
            tail = tail.partition(b"\n")[2]
        data = tail + line
        os.lseek(log, 0, os.SEEK_SET)
        os.ftruncate(log, 0)
        while data:
            written = os.write(log, data)
            if written == 0:
                raise OSError("Short log write")
            data = data[written:]
        return True
    except Exception:
        # A foreign/unsafe log path must not be repaired or mask the setup error.
        return False
    finally:
        if log is not None:
            os.close(log)
        if directory is not None:
            os.close(directory)


def launch_worker(recovery):
    directory = open_directory(LOG_DIR)
    try:
        lock = os.open(WORKER_LOCK_NAME, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                       0o600, dir_fd=directory)
    finally:
        os.close(directory)
    try:
        regular_file(os.fstat(lock))
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SetupError("helper_busy") from None
        record_startup("worker_start")
        child = subprocess.Popen([PYTHON, "-I", "-B", APP_DIR + "/helper/thumbnail_cache.py",
                                  "--allow-home-preview", "--process-controls"],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, pass_fds=(lock,),
                                 start_new_session=True, close_fds=True)
        # Catch immediate interpreter/import failures. Capture diagnostics remain
        # in /tmp/lg-xmb-thumbnails/status.json, not an unbounded output stream.
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            if child.poll() is not None:
                record_startup("worker_exited", returnCode=child.returncode)
                return False
            time.sleep(.05)
        return recovery.process_identity(child.pid) is not None
    finally:
        os.close(lock)


def start():
    require(os.geteuid() == 0, "root_required")
    require(sys.version_info >= (3, 7), "python_too_old")
    control, recovery, bundle = load_bundle()
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
        # Stop old code before reading its last saved restoration values.
        recovery.stop(legacy_only=True)
        if not previous or previous["bundle"] != bundle:
            recovery.stop()
        migrate_config(base, control, previous)
        thumbnail_link()
        startup_link(recovery)
        running = recovery.find_helpers()
        require(all(recovery.helper_argument(p[2]) == recovery.HELPER for p in running)
                and len(running) <= 1, "unexpected_helper_process")
        capture_running = bool(running) or launch_worker(recovery)
        write_file(base, "installed.json", json.dumps({"bundle": bundle, "legacyMigrated": True}).encode())
        return {"returnValue": True, "ready": True, "captureRunning": capture_running}
    finally:
        if lock is not None:
            os.close(lock)
        os.close(base)


def main():
    if sys.argv[1:] not in ([], ["ensure"]):
        print(json.dumps({"returnValue": False, "errorCode": "invalid_command"}))
        return 2
    record_startup("setup_start")
    try:
        result = start()
    except SetupError as error:
        result = {"returnValue": False, "errorCode": str(error)}
        if str(error) == "root_required":
            result["effectiveUid"] = os.geteuid()
        result["logWritten"] = record_startup("setup_failed", error)
    except (FileNotFoundError, ImportError) as error:
        result = {"returnValue": False, "errorCode": "bundle_incomplete",
                  "logWritten": record_startup("setup_failed", error)}
    except Exception as error:
        result = {"returnValue": False, "errorCode": "setup_failed",
                  "logWritten": record_startup("setup_failed", error)}
    else:
        record_startup("setup_ready", captureRunning=result["captureRunning"])
    print(json.dumps(result), flush=True)
    return 0 if result["returnValue"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
