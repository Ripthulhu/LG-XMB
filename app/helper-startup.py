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
MUSIC_DIR = "/media/internal/lg-xmb"
# This is the writable source of the Home bind mount, never the stock Home
# target. APP_DIR remains the trust anchor for privileged helper verification.
HOME_PAYLOAD_DIR = "/var/lib/lg-xmb-home"
SOUND_FILES = ("snd_cancel.wav", "snd_category_decide.wav", "snd_cursor.wav",
               "snd_decide.wav", "snd_error.wav", "snd_option.wav",
               "snd_system_ng.wav", "snd_system_ok.wav", "snd_trophy.wav")
CACHE = "/tmp/lg-xmb-thumbnails"
LEGACY_CACHE = "/tmp/openxmb-c5-thumbnails"
LOG_DIR = "/var/lib/webosbrew"
LOG_NAME = "lg-xmb-startup.log"
WORKER_LOCK_NAME = "lg-xmb-worker.lock"
LOG_LIMIT = 16384
SETUP_WAIT_SECONDS = 30  # Below the frontend RPC deadline; never wait indefinitely.
PYTHON = "/usr/bin/python3"
CAPTURE_MODULE = "thumbnail_cache.py"
RECOVERY_MODULE = "stop_thumbnail_helper.py"
HOME_BUTTON_MODULE = "home_button.py"
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


def restore_owner_only_write(fd, info):
    """LG resets this tree to 0777 at boot, which leaves the bundle unreadable
    by the check above and the helper unable to start until someone chmods it
    by hand. Repair it on the descriptor we already hold, so no second pathname
    lookup can aim the chmod somewhere else. The bundle is trusted by its build
    pin and per-file hashes, not by its mode, so this only puts back what the
    installer set.
    """
    if not info.st_mode & 0o022:
        return info
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1)
    os.fchmod(fd, stat.S_IMODE(info.st_mode) & ~0o022)
    repaired = os.fstat(fd)
    require(not repaired.st_mode & 0o022)
    return repaired


def read_file(directory, name, limit=131072, optional=False, app_file=False, repair_permissions=True):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                     dir_fd=directory)
    except FileNotFoundError:
        if optional:
            return None
        raise SetupError("bundle_incomplete") from None
    try:
        info = os.fstat(fd)
        if not app_file and repair_permissions:
            info = restore_owner_only_write(fd, info)
        if not app_file and not repair_permissions:
            require(not info.st_mode & 0o022, "helper_permissions_required")
        regular_file(info, app_file)
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


def read_bundle(app, directory, repair_permissions=True):
    raw = read_file(directory, "bundle.json", 4096, repair_permissions=repair_permissions)
    require(hashlib.sha256(raw).hexdigest() == BUNDLE_SHA256, "helper_bundle_mismatch")
    manifest = json.loads(raw)
    require(isinstance(manifest, dict) and manifest.get("schema") == 1,
            "invalid_helper_bundle")
    hashes = manifest.get("files")
    # The build pin authenticates the complete inventory, including any future
    # modules. Entry points remain explicit; paths can only be flat Python names.
    require(isinstance(hashes, dict) and {CAPTURE_MODULE, RECOVERY_MODULE, HOME_BUTTON_MODULE}.issubset(hashes)
            and all(re.fullmatch(r"[a-z][a-z0-9_]*\.py", name) for name in hashes),
            "invalid_helper_bundle")
    require(all(isinstance(h, str) and re.fullmatch("[0-9a-f]{64}", h)
                for h in list(hashes.values()) + [manifest.get("appinfoSha256")]),
            "invalid_helper_bundle")
    appinfo = read_file(app, "appinfo.json", 65536, app_file=repair_permissions,
                        repair_permissions=repair_permissions)
    require(hashlib.sha256(appinfo).hexdigest() == manifest["appinfoSha256"],
            "untrusted_app_manifest")
    sources = {name: read_file(directory, name, repair_permissions=repair_permissions) for name in hashes}
    require(all(hashlib.sha256(sources[name]).hexdigest() == hashes[name]
                for name in hashes), "helper_bundle_mismatch")
    return manifest, raw, appinfo, sources


def repair_helper_directory(app, directory, original, bundle):
    """Recover only a verified app-owned directory left by an earlier install."""
    expected = {"bundle.json", *bundle[0]["files"]}

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


def verified_bundle(allow_repair=True):
    """Read and authenticate every source without running helper entry points."""
    app = open_directory(APP_DIR, app_path=True)
    try:
        if not allow_repair:
            require(stat.S_IMODE(os.fstat(app).st_mode) == 0o755, "helper_permissions_required")
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
                raise SetupError("bundle_lock_busy") from None
            if not allow_repair:
                require(meta.st_uid == 0 and stat.S_IMODE(meta.st_mode) == 0o755,
                        "helper_permissions_required")
            bundle = read_bundle(app, directory, repair_permissions=allow_repair)
            if allow_repair and (meta.st_uid != 0 or stat.S_IMODE(meta.st_mode) != 0o755):
                repair_helper_directory(app, directory, meta, bundle)
            manifest, raw, appinfo, sources = bundle
        finally:
            os.close(directory)
    finally:
        os.close(app)
    return manifest, raw, appinfo, sources


def load_bundle():
    manifest, raw, appinfo, sources = verified_bundle()
    capture = load_module("lg_xmb_capture", sources[CAPTURE_MODULE], APP_DIR + "/helper/" + CAPTURE_MODULE)
    require(capture.PIN_APPINFO_SHA256 == manifest["appinfoSha256"], "helper_bundle_mismatch")
    capture.checked_app()
    recovery = load_module("lg_xmb_recovery", sources[RECOVERY_MODULE], APP_DIR + "/helper/" + RECOVERY_MODULE)
    return capture, recovery, hashlib.sha256(raw).hexdigest()


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
        value = {"time": int(time.time()), "event": event, "pid": os.getpid(), **details}
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
            raise SetupError("worker_lock_busy") from None
        record_startup("worker_start")
        child = subprocess.Popen([PYTHON, "-I", "-B", APP_DIR + "/helper/thumbnail_cache.py",
                                  "--allow-home-preview"],
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


def acquire_setup_lock(base, lock):
    """Serialize boot/app invocations, then read the winning setup's new state."""
    deadline = time.monotonic() + SETUP_WAIT_SECONDS
    waiting = False
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if not waiting:
                record_startup("setup_waiting")
                waiting = True
            remaining = deadline - time.monotonic()
            require(remaining > 0, "setup_in_progress")
            time.sleep(min(.1, remaining))
            continue
        # Never proceed on an unlinked/replaced lock inode. Lock files are kept
        # in place: deleting a held lock could allow two owners to run at once.
        opened = os.fstat(lock)
        named = os.stat("setup.lock", dir_fd=base, follow_symlinks=False)
        regular_file(named)
        require((opened.st_dev, opened.st_ino) == (named.st_dev, named.st_ino),
                "setup_lock_changed")
        if waiting:
            record_startup("setup_resumed")
        return


def prepare_user_music():
    """Expose user data through one fixed app-relative link; never read or copy it.

    This is optional preparation, not a prerequisite for the capture/controller
    worker. A missing track, conflicting entry or refused path cannot disable it.
    """
    try:
        # /media/internal is writable user storage, not executable helper code.
        parent = open_directory(os.path.dirname(MUSIC_DIR), app_path=True)
        try:
            directory = make_directory(parent, os.path.basename(MUSIC_DIR))
            os.close(directory)
        finally:
            os.close(parent)
        app = open_directory(APP_DIR, app_path=True)
        try:
            name = "user-music.mp3"
            target = MUSIC_DIR + "/background.mp3"
            try:
                info = os.stat(name, dir_fd=app, follow_symlinks=False)
            except FileNotFoundError:
                os.symlink(target, name, dir_fd=app)
            else:
                require(stat.S_ISLNK(info.st_mode) and info.st_uid == 0,
                        "music_path_conflict")
                previous = os.readlink(name, dir_fd=app)
                require(previous in (target, BASE + "/music/background.mp3"),
                        "music_path_conflict")
                if previous != target:
                    # Only replace our recognized legacy link, never either track.
                    temporary = ".user-music-" + str(os.getpid())
                    os.symlink(target, temporary, dir_fd=app)
                    try:
                        os.replace(temporary, name, src_dir_fd=app, dst_dir_fd=app)
                    finally:
                        try:
                            os.unlink(temporary, dir_fd=app)
                        except FileNotFoundError:
                            pass
            return True
        finally:
            os.close(app)
    except (OSError, SetupError) as error:
        record_startup("music_path_unavailable", error)
        return False


def sound_entry_identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def read_sound_identity(directory, name, limit=131072, developer_reference=False):
    """Read stable identity bytes without executing, repairing or following links.

    LG may make developer reference code writable at boot. Those references
    still have to match the separate protected Home payload byte for byte.
    Manifests and Home files always retain the strict mode checks.
    """
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        before = os.fstat(fd)
        regular_file(before, app_file=developer_reference)
        raw = bytearray()
        while len(raw) <= limit:
            block = os.read(fd, min(8192, limit + 1 - len(raw)))
            if not block:
                break
            raw.extend(block)
        require(len(raw) <= limit, "sound_payload_identity_oversized")
        named = os.stat(name, dir_fd=directory, follow_symlinks=False)
        require(sound_entry_identity(before) == sound_entry_identity(os.fstat(fd)) ==
                sound_entry_identity(named), "sound_payload_identity_changed")
        return bytes(raw)
    finally:
        os.close(fd)


def checked_home_payload():
    """Return an open, validated payload, or None when takeover is not installed.

    A bind mount does not preserve the developer path. Validate the copied
    payload directly so preparation also works BEFORE the mount at boot. Never
    change APP_DIR or write through /usr/palm/applications/com.webos.app.home.
    """
    try:
        payload = open_directory(HOME_PAYLOAD_DIR)
    except FileNotFoundError:
        return None
    try:
        source = open_directory(APP_DIR, app_path=True)
        try:
            original = json.loads(read_sound_identity(source, "appinfo.json", 65536))
            home = json.loads(read_sound_identity(payload, "appinfo.json", 65536))
            require(isinstance(original, dict) and isinstance(home, dict) and
                    original.get("id") == "org.local.openxmb.c5" and
                    home.get("id") == "com.webos.app.home" and
                    home.get("type") == original.get("type") == "web" and
                    home.get("main") == original.get("main") == "index.html" and
                    home.get("version") == original.get("version"),
                    "sound_payload_identity_mismatch")
            # The takeover manifest intentionally differs from the developer
            # manifest. Compare the unchanged code instead of trusting its ID.
            for name in ("helper-startup.py", "index.html", "menu-sounds.js"):
                require(read_sound_identity(payload, name) ==
                        read_sound_identity(source, name, developer_reference=True),
                        "sound_payload_identity_mismatch")
        finally:
            os.close(source)
        # Keep and use this descriptor; a pathname replacement cannot redirect
        # subsequent writes into another tree.
        return payload
    except BaseException:
        os.close(payload)
        raise


def sound_alias_inventory(directory):
    """Inspect links themselves; user recordings are never opened or changed."""
    names = set(os.listdir(directory))
    require(names.issubset(set(SOUND_FILES)), "sound_path_conflict")
    entries = {}
    for name in names:
        info = os.stat(name, dir_fd=directory, follow_symlinks=False)
        require(stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1,
                "sound_path_conflict")
        target = os.readlink(name, dir_fd=directory)
        require(target == MUSIC_DIR + "/Sounds/" + name, "sound_path_conflict")
        current = os.stat(name, dir_fd=directory, follow_symlinks=False)
        require(sound_entry_identity(info) == sound_entry_identity(current), "sound_path_changed")
        entries[name] = sound_entry_identity(info), target
    require(set(os.listdir(directory)) == names, "sound_path_changed")
    return entries


def check_sound_directory_binding(app, directory):
    opened = os.fstat(directory)
    named = os.stat("user-sounds", dir_fd=app, follow_symlinks=False)
    require(stat.S_ISDIR(named.st_mode) and named.st_uid == 0 and opened.st_uid == 0 and
            (opened.st_dev, opened.st_ino) == (named.st_dev, named.st_ino), "sound_path_changed")


def prepare_sound_aliases(app, repair_developer=False):
    """Prepare fixed aliases, repairing only a verified developer alias directory."""
    require(not os.fstat(app).st_mode & 0o022)
    try:
        os.mkdir("user-sounds", 0o755, dir_fd=app)
    except FileExistsError:
        pass
    directory = os.open("user-sounds", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=app)
    try:
        meta = os.fstat(directory)
        require(meta.st_uid == 0 and (repair_developer or not meta.st_mode & 0o022))
        check_sound_directory_binding(app, directory)
        entries = sound_alias_inventory(directory)
        if meta.st_mode & 0o022:
            # No generic chmod repair: this must still be the exact developer
            # app and contain only our recognized aliases before changing mode.
            current = open_directory(APP_DIR, app_path=True)
            try:
                original, live = os.fstat(app), os.fstat(current)
                require(not live.st_mode & 0o022 and
                        (original.st_dev, original.st_ino) == (live.st_dev, live.st_ino),
                        "sound_path_changed")
                check_sound_directory_binding(app, directory)
                os.fchmod(directory, 0o755)
                require(stat.S_IMODE(os.fstat(directory).st_mode) == 0o755,
                        "sound_permissions_failed")
                reopened = open_directory(APP_DIR, app_path=True)
                try:
                    live = os.fstat(reopened)
                    require(not live.st_mode & 0o022 and
                            (original.st_dev, original.st_ino) == (live.st_dev, live.st_ino),
                            "sound_path_changed")
                    check_sound_directory_binding(reopened, directory)
                finally:
                    os.close(reopened)
                require(sound_alias_inventory(directory) == entries, "sound_path_changed")
            finally:
                os.close(current)
        for name in SOUND_FILES:
            if name in entries:
                continue
            target = MUSIC_DIR + "/Sounds/" + name
            # Exclusive creation: a raced-in entry is not overwritten. Validate
            # an identical concurrent creation, but never replace a foreign one.
            try:
                os.symlink(target, name, dir_fd=directory)
            except FileExistsError:
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
                require(stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                        and os.readlink(name, dir_fd=directory) == target, "sound_path_conflict")
        check_sound_directory_binding(app, directory)
        require(set(sound_alias_inventory(directory)) == set(SOUND_FILES), "sound_path_changed")
    finally:
        os.close(directory)


def prepare_user_sounds():
    """Recreate optional aliases after every ensure, including after payload sync.

    Links may be dangling. Never read, copy, modify or chmod a user's WAVs. Each
    destination fails independently, and an absent Home payload is not created.
    """
    ready = True
    for destination in ("developer", "home"):
        app = None
        try:
            app = (open_directory(APP_DIR, app_path=True) if destination == "developer"
                   else checked_home_payload())
            if app is None:
                continue
            prepare_sound_aliases(app, repair_developer=destination == "developer")
            record_startup("sound_paths_ready", destination=destination)
        except (OSError, SetupError, ValueError, TypeError) as error:
            ready = False
            record_startup("sound_path_unavailable", error, destination=destination)
        finally:
            if app is not None:
                os.close(app)
    return ready


def prepare_fixed_asset_alias(app, name, target):
    """Create one fixed link without opening user data or replacing an entry."""
    require(not os.fstat(app).st_mode & 0o022)
    try:
        os.symlink(target, name, dir_fd=app)
    except FileExistsError:
        pass
    before = os.stat(name, dir_fd=app, follow_symlinks=False)
    require(stat.S_ISLNK(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
            and os.readlink(name, dir_fd=app) == target, "asset_path_conflict")
    after = os.stat(name, dir_fd=app, follow_symlinks=False)
    require(sound_entry_identity(before) == sound_entry_identity(after), "asset_path_changed")


def prepare_user_asset(alias, relative, label, directory_asset=False):
    """Expose a fixed media path without replacing existing files or links."""
    try:
        parent = open_directory(os.path.dirname(MUSIC_DIR), app_path=True)
        try:
            directory = make_directory(parent, os.path.basename(MUSIC_DIR))
            try:
                if directory_asset:
                    child = make_directory(directory, relative)
                    os.close(child)
            finally:
                os.close(directory)
        finally:
            os.close(parent)
    except (OSError, SetupError) as error:
        record_startup(label + "_path_unavailable", error)
        return False
    ready = True
    for destination in ("developer", "home"):
        app = None
        try:
            app = (open_directory(APP_DIR, app_path=True) if destination == "developer"
                   else checked_home_payload())
            if app is None:
                continue
            prepare_fixed_asset_alias(app, alias, MUSIC_DIR + "/" + relative)
            record_startup(label + "_path_ready", destination=destination)
        except (OSError, SetupError, ValueError, TypeError) as error:
            ready = False
            record_startup(label + "_path_unavailable", error, destination=destination)
        finally:
            if app is not None:
                os.close(app)
    return ready


def prepare_user_wallpaper():
    return prepare_user_asset("user-wallpaper.jpg", "wallpaper.jpg", "wallpaper")


def prepare_user_fonts():
    return prepare_user_asset("media-fonts", "Fonts", "fonts", directory_asset=True)


def start():
    require(os.geteuid() == 0, "root_required")
    require(sys.version_info >= (3, 7), "python_too_old")
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
        acquire_setup_lock(base, lock)
        # Verification/repair belongs inside the lock too. Do not use a bundle
        # or installed record read before waiting for another upgrade to finish.
        capture, recovery, bundle = load_bundle()
        prepare_user_music()
        prepare_user_sounds()
        prepare_user_wallpaper()
        prepare_user_fonts()
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
        thumbnail_link()
        startup_link(recovery)
        running = recovery.find_helpers()
        require(all(recovery.helper_argument(p[2]) == recovery.HELPER for p in running)
                and len(running) <= 1, "unexpected_helper_process")
        capture_running = bool(running) or launch_worker(recovery)
        if running:
            record_startup("worker_reused")
        installed = {"bundle": bundle, "legacyMigrated": True}
        if installed != previous:
            write_file(base, "installed.json", json.dumps(installed).encode())
        return {"returnValue": True, "ready": True, "captureRunning": capture_running}
    finally:
        if lock is not None:
            os.close(lock)
        os.close(base)


def home_button(args):
    """Run a bounded user-requested mapping operation, never worker setup."""
    require(os.geteuid() == 0, "root_required")
    require(sys.version_info >= (3, 7), "python_too_old")
    require(args == ["get"] or (len(args) == 3 and args[0] == "set"
            and args[1] in ("stock", "xmb") and re.fullmatch("[0-9a-f]{64}", args[2])),
            "invalid_command")
    manifest, raw, appinfo, sources = verified_bundle(allow_repair=False)
    module = load_module("lg_xmb_home_button", sources[HOME_BUTTON_MODULE],
                         APP_DIR + "/helper/" + HOME_BUTTON_MODULE)
    return module.command(args)


def main():
    if sys.argv[1:2] == ["home-button"]:
        try:
            result = home_button(sys.argv[2:])
        except SetupError as error:
            result = {"returnValue": False, "errorCode": str(error)}
        except Exception:
            result = {"returnValue": False, "errorCode": "home_button_unavailable"}
        print(json.dumps(result), flush=True)
        return 0 if result.get("returnValue") else 2
    if sys.argv[1:] not in ([], ["ensure"]):
        print(json.dumps({"returnValue": False, "errorCode": "invalid_command"}))
        return 2
    record_startup("setup_start", command="ensure" if sys.argv[1:] else "startup")
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
