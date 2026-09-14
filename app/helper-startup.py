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
PYTHON = "/usr/bin/python3"
FILES = ("process_control.py", "thumbnail_cache.py", "stop_thumbnail_helper.py")
BUNDLE_SHA256 = "@BUNDLE_SHA256@"  # Filled by the packager, not by the TV.
SETUP_LOG_NAME = "lg-xmb-setup.log"


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
        return read_descriptor(fd, limit, app_file)
    finally:
        os.close(fd)


def read_descriptor(fd, limit, app_file=False):
    regular_file(os.fstat(fd), app_file)
    os.lseek(fd, 0, os.SEEK_SET)
    raw = bytearray()
    while len(raw) <= limit:
        chunk = os.read(fd, min(8192, limit + 1 - len(raw)))
        if not chunk:
            break
        raw.extend(chunk)
    require(len(raw) <= limit, "oversized_helper_file")
    return bytes(raw)


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


def checked_bundle():
    """Verify packaged bytes before repairing installer-reset helper permissions."""
    directories, files = [], {}
    names = APP_DIR.strip("/").split("/") + ["helper"]
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

    def same_entry(parent, name, descriptor):
        named = os.stat(name, dir_fd=parent, follow_symlinks=False)
        opened = os.fstat(descriptor)
        require((named.st_dev, named.st_ino, named.st_uid, stat.S_IFMT(named.st_mode)) ==
                (opened.st_dev, opened.st_ino, 0, stat.S_IFMT(opened.st_mode)),
                "helper_path_changed")

    def verify_bindings():
        for index, name in enumerate(names):
            same_entry(directories[index], name, directories[index + 1])
        for name, (parent, descriptor, limit) in files.items():
            same_entry(parent, name, descriptor)
            regular_file(os.fstat(descriptor), app_file=True)

    def read_all():
        return {name: read_descriptor(fd, limit, app_file=True)
                for name, (_, fd, limit) in files.items()}

    try:
        directories.append(os.open("/", flags))
        for name in names:
            descriptor = os.open(name, flags, dir_fd=directories[-1])
            directories.append(descriptor)
            require(os.fstat(descriptor).st_uid == 0, "helper_owner_mismatch")
        app, helper = directories[-2:]
        try:
            fcntl.flock(helper, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SetupError("helper_busy") from None
        entries = [(helper, "bundle.json", 4096), (app, "appinfo.json", 65536)]
        entries += [(helper, name, 131072) for name in FILES]
        for parent, name, limit in entries:
            try:
                descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                     dir_fd=parent)
            except FileNotFoundError:
                raise SetupError("bundle_incomplete") from None
            files[name] = (parent, descriptor, limit)
            require(os.fstat(descriptor).st_uid == 0, "helper_owner_mismatch")
        data = read_all()
        # A writable bundle must not be allowed to approve its own changed hashes.
        require(hashlib.sha256(data["bundle.json"]).hexdigest() == BUNDLE_SHA256,
                "helper_bundle_mismatch")
        manifest = json.loads(data["bundle.json"])
        require(isinstance(manifest, dict) and manifest.get("schema") == 1,
                "invalid_helper_bundle")
        hashes = manifest.get("files")
        require(isinstance(hashes, dict) and set(hashes) == set(FILES),
                "invalid_helper_bundle")
        require(all(isinstance(h, str) and re.fullmatch("[0-9a-f]{64}", h)
                    for h in list(hashes.values()) + [manifest.get("appinfoSha256")]),
                "invalid_helper_bundle")
        require(hashlib.sha256(data["appinfo.json"]).hexdigest() == manifest["appinfoSha256"],
                "untrusted_app_manifest")
        require(all(hashlib.sha256(data[name]).hexdigest() == hashes[name] for name in FILES),
                "helper_bundle_mismatch")
        verify_bindings()
        # Do not recurse, chown, touch shared ancestors or accept unverified code.
        # The controller separately verifies/repairs the app directory and appinfo.
        if stat.S_IMODE(os.fstat(helper).st_mode) != 0o755:
            os.fchmod(helper, 0o755)
        for name in ("bundle.json",) + FILES:
            parent, descriptor, _ = files[name]
            same_entry(parent, name, descriptor)
            regular_file(os.fstat(descriptor), app_file=True)
            if stat.S_IMODE(os.fstat(descriptor).st_mode) != 0o644:
                os.fchmod(descriptor, 0o644)
        verify_bindings()
        # chmod cannot revoke already-open handles: recheck bytes as well as modes.
        require(read_all() == data, "helper_bundle_changed")
        require(stat.S_IMODE(os.fstat(helper).st_mode) == 0o755, "helper_permissions_failed")
        for name in ("bundle.json",) + FILES:
            require(stat.S_IMODE(os.fstat(files[name][1]).st_mode) == 0o644,
                    "helper_permissions_failed")
        return manifest, {name: data[name] for name in FILES}
    finally:
        for _, descriptor, _ in files.values():
            os.close(descriptor)
        for descriptor in reversed(directories):
            os.close(descriptor)


def load_bundle():
    manifest, sources = checked_bundle()
    control = load_module("lg_xmb_control", sources[FILES[0]], APP_DIR + "/helper/" + FILES[0])
    require(control.PIN_APPINFO_SHA256 == manifest["appinfoSha256"], "helper_bundle_mismatch")
    control.checked_app()
    recovery = load_module("lg_xmb_recovery", sources[FILES[2]], APP_DIR + "/helper/" + FILES[2])
    return control, recovery, BUNDLE_SHA256


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
        log = os.open(LOG_NAME, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
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


def record_setup(result, error=None):
    """Keep one bounded local result, including failures before worker launch."""
    if os.geteuid() != 0:
        return
    value = dict(result, timestamp=int(time.time()))
    if error is not None:
        value["exception"] = type(error).__name__
        # Frame locations are enough to find the failing check. Never log locals,
        # exception messages, configuration, native replies or captured content.
        value["frames"] = [{"file": os.path.basename(frame.filename),
                            "line": frame.lineno, "function": frame.name}
                           for frame in traceback.extract_tb(error.__traceback__)[-8:]]
    parent = open_directory(os.path.dirname(LOG_DIR))
    try:
        directory = make_directory(parent, os.path.basename(LOG_DIR))
    finally:
        os.close(parent)
    try:
        raw = (json.dumps(value) + "\n").encode()
        require(len(raw) <= 8192, "oversized_setup_log")
        write_file(directory, SETUP_LOG_NAME, raw)
    finally:
        os.close(directory)


def main():
    failure = None
    try:
        require(sys.argv[1:] in ([], ["ensure"]), "invalid_command")
        result = start()
    except SetupError as error:
        failure = error
        result = {"returnValue": False, "errorCode": str(error)}
        if str(error) == "root_required":
            result["effectiveUid"] = os.geteuid()
    except (FileNotFoundError, ImportError) as error:
        failure = error
        result = {"returnValue": False, "errorCode": "bundle_incomplete"}
    except Exception as error:
        failure = error
        result = {"returnValue": False, "errorCode": "setup_failed"}
    try:
        record_setup(result, failure)
    except Exception:
        # An unsafe/unavailable log destination must not change setup's outcome.
        result["logWritten"] = False
    print(json.dumps(result), flush=True)
    return 0 if result["returnValue"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
