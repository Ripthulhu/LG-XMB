#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Keep four recent HDMI thumbnails using the TV's normal protected capture API."""
import argparse
import hashlib
import json
import os
import re
import signal
import stat
import struct
import subprocess
import threading
import time
import zlib
from collections import OrderedDict
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

HOME_ID = "org.local.openxmb.c5"
STOCK_HOME_ID = "com.webos.app.home"
APP_DIR = "/media/developer/apps/usr/palm/applications/" + HOME_ID
APPINFO = APP_DIR + "/appinfo.json"
HOME_PAYLOAD_DIR = "/var/lib/lg-xmb-home"
HOME_MOUNT_DIR = "/usr/palm/applications/" + STOCK_HOME_ID
HOME_IDENTITY_FILES = ("helper-startup.py", "index.html", "input-preview.js", "tv-bridge.js", "app.js")
CACHE_DIR = "/tmp/lg-xmb-thumbnails"
WIDTH, HEIGHT = 480, 270
# This C5's physical output was independently verified against two DOM/PIG maps.
# These are panel/output dimensions, deliberately not the HDMI signal dimensions.
PANEL_WIDTH, PANEL_HEIGHT = 3840, 2160
PIG_CAPTURE_WIDTH, PIG_CAPTURE_HEIGHT = 1920, 1080
POLL_SECONDS, SETTLE_SECONDS, REFRESH_SECONDS = 5, 5, 60
APP_READY_GRACE_SECONDS = 90
MAX_IMAGE_BYTES = 2 * 1024 * 1024
URIS = {
    "foreground": "luna://com.webos.applicationManager/getForegroundAppInfo",
    "video": "luna://com.webos.service.videooutput/getStatus",
    "power": "luna://com.webos.service.tvpower/power/getPowerState",
    "capture": "luna://com.webos.service.capture/executeOneShot",
}


class SafeError(Exception):
    """An internal code safe to include in bounded status output."""


PIN_APPINFO_SHA256 = '4d443e33ec00f0c6f8815923dff86b2f4cc1ec8acfe3fd1670f20e73bea9e06f'


def require(value, code):
    if not value:
        raise SafeError(code)


def checked_app():
    """Repair only this pinned app's metadata after LG resets modes at boot."""
    import fcntl
    parts = Path(APPINFO).parts
    directories = []; manifest = None
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    def file_identity(meta):
        require(stat.S_ISREG(meta.st_mode) and meta.st_uid == 0 and meta.st_nlink == 1, 'unsafe_app_manifest')
        return meta.st_dev, meta.st_ino
    def pinned_bytes():
        os.lseek(manifest, 0, os.SEEK_SET)
        raw = os.read(manifest, 65537)
        require(len(raw) <= 65536 and hashlib.sha256(raw).hexdigest() == PIN_APPINFO_SHA256, 'untrusted_app_manifest')
        value = json.loads(raw)
        require(isinstance(value, dict) and value.get('id') == HOME_ID, 'invalid_app_manifest')
    def verify_bindings():
        try:
            for index, name in enumerate(parts[1:-1]):
                named = os.stat(name, dir_fd=directories[index], follow_symlinks=False)
                opened = os.fstat(directories[index + 1])
                require(stat.S_ISDIR(named.st_mode) and named.st_uid == 0
                        and (named.st_dev, named.st_ino) == (opened.st_dev, opened.st_ino), 'app_path_changed')
            named = os.stat(parts[-1], dir_fd=directories[-1], follow_symlinks=False)
            require(file_identity(named) == file_identity(os.fstat(manifest)), 'app_path_changed')
        except OSError as error:
            raise SafeError('app_path_changed') from error
    try:
        directories.append(os.open('/', flags))
        for name in parts[1:-1]:
            fd = os.open(name, flags, dir_fd=directories[-1]); directories.append(fd)
            meta = os.fstat(fd)
            require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == 0, 'unsafe_app_directory')
        manifest = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directories[-1])
        file_identity(os.fstat(manifest))
        deadline = time.monotonic() + .5
        while True:
            try: fcntl.flock(directories[-1], fcntl.LOCK_EX | fcntl.LOCK_NB); break
            except BlockingIOError:
                require(time.monotonic() < deadline, 'app_metadata_busy'); time.sleep(.01)
        pinned_bytes(); verify_bindings()
        if stat.S_IMODE(os.fstat(directories[-1]).st_mode) != 0o755: os.fchmod(directories[-1], 0o755)
        if stat.S_IMODE(os.fstat(manifest).st_mode) != 0o644: os.fchmod(manifest, 0o644)
        # Permissions do not revoke pre-existing file handles. Confirm the bytes
        # and named inodes again before allowing any controller operation.
        pinned_bytes(); verify_bindings()
        require(stat.S_IMODE(os.fstat(directories[-1]).st_mode) == 0o755
                and stat.S_IMODE(os.fstat(manifest).st_mode) == 0o644, 'app_permissions_not_confirmed')
        return True
    except FileNotFoundError:
        # A missing initial path may be an application mount that is not ready.
        raise
    except OSError as error:
        raise SafeError('unsafe_app_path') from error
    finally:
        if manifest is not None: os.close(manifest)
        for fd in reversed(directories): os.close(fd)


def check_directory(metadata, owner_uid=0, allow_sticky=False):
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner_uid:
        raise SafeError("unsafe_directory")
    writable = metadata.st_mode & 0o022
    if writable and not (allow_sticky and metadata.st_mode & stat.S_ISVTX):
        raise SafeError("writable_directory")


def check_file(metadata, owner_uid=0):
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner_uid
            or metadata.st_nlink != 1 or metadata.st_mode & 0o022):
        raise SafeError("unsafe_file")


def inode_identity(metadata):
    return metadata.st_dev, metadata.st_ino


def content_identity(metadata):
    return (metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_uid,
            metadata.st_nlink, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns)


@contextmanager
def preview_directory(path, app_path=False):
    """Hold and recheck every directory binding; never repair a capture source."""
    parts = Path(path).parts
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptors = [os.open(parts[0], flags)]
    try:
        for part in parts[1:]:
            fd = os.open(part, flags, dir_fd=descriptors[-1])
            descriptors.append(fd)
            info = os.fstat(fd)
            # LG's shared installation parents may be writable. Our actual app
            # directory must already have been repaired by checked_app().
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0,
                    "unsafe_home_preview_directory")
            if not app_path:
                check_directory(info)
        check_directory(os.fstat(descriptors[-1]))
        yield descriptors[-1]
        for index, part in enumerate(parts[1:]):
            named = os.stat(part, dir_fd=descriptors[index], follow_symlinks=False)
            opened = os.fstat(descriptors[index + 1])
            require(stat.S_ISDIR(named.st_mode) and
                    inode_identity(named) == inode_identity(opened), "home_preview_path_changed")
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


def read_preview_identity(directory, name, limit=131072, developer_reference=False):
    """Return immutable bytes and a token that also detects file replacement."""
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        before = os.fstat(fd)
        if developer_reference:
            # LG may reset installed browser files to 0777 at boot. These are
            # read-only references, never code we execute or repair. Their bytes
            # must still match the separate, nonwritable mounted Home payload.
            require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1,
                    "unsafe_home_preview_reference")
        else:
            check_file(before)
        require(before.st_size <= limit, "home_preview_identity_oversized")
        raw = bytearray()
        while len(raw) <= limit:
            chunk = os.read(fd, min(8192, limit + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
        require(len(raw) <= limit, "home_preview_identity_oversized")
        named = os.stat(name, dir_fd=directory, follow_symlinks=False)
        require(content_identity(before) == content_identity(os.fstat(fd)) == content_identity(named),
                "home_preview_identity_changed")
        data = bytes(raw)
        return data, (content_identity(before), hashlib.sha256(data).hexdigest())
    finally:
        os.close(fd)


def checked_home_preview():
    """Authorize only our matching payload while it is mounted as stock Home.

    Matching the Home app ID alone would also authorize LG's stock application.
    Compare the unchanged files used by bootstrap's Home-payload contract, and
    include their identities in Source so changes invalidate pending captures.
    """
    try:
        with preview_directory(APP_DIR, app_path=True) as developer:
            with preview_directory(HOME_PAYLOAD_DIR) as payload:
                with preview_directory(HOME_MOUNT_DIR) as mounted:
                    directories = tuple(inode_identity(os.fstat(fd))
                                        for fd in (developer, payload, mounted))
                    require(directories[1] == directories[2], "home_preview_not_mounted")
                    original, original_token = read_preview_identity(developer, "appinfo.json", 65536)
                    raw_home, home_token = read_preview_identity(payload, "appinfo.json", 65536)
                    require(hashlib.sha256(original).hexdigest() == PIN_APPINFO_SHA256,
                            "untrusted_app_manifest")
                    app, home = json.loads(original), json.loads(raw_home)
                    require(isinstance(app, dict) and isinstance(home, dict) and
                            app.get("id") == HOME_ID and home.get("id") == STOCK_HOME_ID and
                            app.get("type") == home.get("type") == "web" and
                            app.get("main") == home.get("main") == "index.html" and
                            app.get("version") == home.get("version"), "home_preview_identity_mismatch")
                    tokens = [original_token, home_token]
                    for name in HOME_IDENTITY_FILES:
                        expected, expected_token = read_preview_identity(developer, name,
                                                                          developer_reference=True)
                        actual, actual_token = read_preview_identity(payload, name)
                        require(actual == expected, "home_preview_identity_mismatch")
                        tokens.extend((expected_token, actual_token))
                    result = directories, tuple(tokens)
        return result
    except (OSError, ValueError, TypeError) as error:
        raise SafeError("home_preview_unavailable") from error


def validate_png(data, width=WIDTH, height=HEIGHT):
    if not 45 <= len(data) <= MAX_IMAGE_BYTES or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SafeError("invalid_image")
    offset, chunks, saw_data = 8, 0, False
    while offset + 12 <= len(data):
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + size
        if end > len(data):
            raise SafeError("invalid_image")
        body = data[offset + 8:offset + 8 + size]
        crc = struct.unpack(">I", data[offset + 8 + size:end])[0]
        if zlib.crc32(kind + body) & 0xffffffff != crc:
            raise SafeError("invalid_image")
        if chunks == 0:
            if kind != b"IHDR" or size != 13 or struct.unpack(">II", body[:8]) != (width, height):
                raise SafeError("invalid_image")
        elif kind == b"IHDR":
            raise SafeError("invalid_image")
        saw_data = saw_data or (kind == b"IDAT" and size > 0)
        if kind == b"IEND":
            if size or end != len(data) or not saw_data:
                raise SafeError("invalid_image")
            return
        chunks += 1
        offset = end
    raise SafeError("invalid_image")


def is_home_source(source):
    return (source.app_id == HOME_ID or
            (source.app_id == STOCK_HOME_ID and source.home_identity is not None))


def home_crop_bounds(source):
    """Map verified physical PIG output to the 1080p capture; round inside it."""
    if not is_home_source(source) or len(source.mode) != 9:
        raise SafeError("invalid_home_crop_source")
    width, height, x, y = source.mode[3:7]
    if (any(type(value) is not int for value in (width, height, x, y))
            or min(x, y) < 0 or min(width, height) <= 0
            or x + width > PANEL_WIDTH or y + height > PANEL_HEIGHT):
        raise SafeError("invalid_home_crop_bounds")
    x0 = (x * PIG_CAPTURE_WIDTH + PANEL_WIDTH - 1) // PANEL_WIDTH
    y0 = (y * PIG_CAPTURE_HEIGHT + PANEL_HEIGHT - 1) // PANEL_HEIGHT
    x1 = (x + width) * PIG_CAPTURE_WIDTH // PANEL_WIDTH
    y1 = (y + height) * PIG_CAPTURE_HEIGHT // PANEL_HEIGHT
    if not (0 <= x0 < x1 <= PIG_CAPTURE_WIDTH and 0 <= y0 < y1 <= PIG_CAPTURE_HEIGHT):
        raise SafeError("invalid_home_crop_bounds")
    return x0, y0, x1, y1


def crop_home_png(data, source, cv=None, np=None):
    """Crop only the app-owned HDMI rectangle using the TV's existing OpenCV."""
    bounds = home_crop_bounds(source)
    validate_png(data, PIG_CAPTURE_WIDTH, PIG_CAPTURE_HEIGHT)
    try:
        if cv is None:
            import cv2 as cv
        if np is None:
            import numpy as np
    except (ImportError, OSError):
        raise SafeError("home_crop_unavailable")
    try:
        decoded = cv.imdecode(np.frombuffer(data, dtype=np.uint8), cv.IMREAD_COLOR)
        if decoded is None or tuple(decoded.shape) != (PIG_CAPTURE_HEIGHT, PIG_CAPTURE_WIDTH, 3):
            raise SafeError("invalid_home_capture")
        x0, y0, x1, y1 = bounds
        rectangle = decoded[y0:y1, x0:x1]
        interpolation = cv.INTER_AREA if x1 - x0 >= WIDTH and y1 - y0 >= HEIGHT else cv.INTER_LINEAR
        resized = cv.resize(rectangle, (WIDTH, HEIGHT), interpolation=interpolation)
        ok, encoded = cv.imencode(".png", resized, [cv.IMWRITE_PNG_COMPRESSION, 3])
        if not ok:
            raise SafeError("home_crop_failed")
        result = encoded.tobytes()
        validate_png(result)
        return result
    except SafeError:
        raise
    except Exception:
        # OpenCV exceptions contain filesystem/build detail, so normalize them.
        raise SafeError("home_crop_failed")


class Cache:
    """Root-only mutation through an anchored directory descriptor."""
    allowed = {".lock", ".capture.png", ".status.tmp", "status.json"} | {
        "hdmi%d.png" % p for p in range(1, 5)
    }

    def __init__(self, path=CACHE_DIR):
        import fcntl
        if os.geteuid() != 0 or path != CACHE_DIR:
            raise SafeError("root_or_path_required")
        check_directory(os.lstat("/tmp"), allow_sticky=True)
        try:
            os.mkdir(path, 0o755)
        except FileExistsError:
            pass
        before = os.lstat(path)
        check_directory(before)
        if stat.S_IMODE(before.st_mode) != 0o755:
            raise SafeError("cache_mode_not_0755")
        self.path = path
        self.fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        after = os.fstat(self.fd)
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
            os.close(self.fd)
            raise SafeError("directory_changed")
        self.lock_fd = None
        try:
            for name in os.listdir(self.fd):
                if name not in self.allowed:
                    raise SafeError("unexpected_cache_entry")
                check_file(os.stat(name, dir_fd=self.fd, follow_symlinks=False))
            self.lock_fd = os.open(".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
                                   0o600, dir_fd=self.fd)
            check_file(os.fstat(self.lock_fd))
            try:
                fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SafeError("already_running")
            self.remove_temp()
            self._remove(".status.tmp")
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.lock_fd is not None:
            os.close(self.lock_fd)
            self.lock_fd = None
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def _check(self, name, missing_ok=True):
        if name not in self.allowed:
            raise SafeError("invalid_filename")
        try:
            check_file(os.stat(name, dir_fd=self.fd, follow_symlinks=False))
        except FileNotFoundError:
            if not missing_ok:
                raise SafeError("missing_file")

    def _remove(self, name):
        self._check(name)
        try:
            os.unlink(name, dir_fd=self.fd)
        except FileNotFoundError:
            pass

    def remove_temp(self):
        self._remove(".capture.png")

    def prepare(self):
        self.remove_temp()
        fd = os.open(".capture.png", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=self.fd)
        os.close(fd)
        return self.path + "/.capture.png"

    def crop_home(self, source):
        self._check(".capture.png", missing_ok=False)
        fd = os.open(".capture.png", os.O_RDWR | os.O_NOFOLLOW, dir_fd=self.fd)
        try:
            metadata = os.fstat(fd)
            check_file(metadata)
            if metadata.st_size > MAX_IMAGE_BYTES:
                raise SafeError("invalid_image")
            with os.fdopen(os.dup(fd), "rb") as stream:
                data = stream.read(MAX_IMAGE_BYTES + 1)
            result = crop_home_png(data, source)
            # Rewrite the one unpublished root-only temp; never create history.
            os.fchmod(fd, 0o600)
            os.lseek(fd, 0, os.SEEK_SET)
            with os.fdopen(os.dup(fd), "wb") as stream:
                stream.write(result)
                stream.flush()
                os.ftruncate(fd, len(result))
        finally:
            os.close(fd)

    def publish(self, port):
        if type(port) is not int or port not in range(1, 5):
            raise SafeError("invalid_port")
        self._check(".capture.png", missing_ok=False)
        fd = os.open(".capture.png", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.fd)
        try:
            metadata = os.fstat(fd)
            check_file(metadata)
            if metadata.st_size > MAX_IMAGE_BYTES:
                raise SafeError("invalid_image")
            with os.fdopen(os.dup(fd), "rb") as stream:
                validate_png(stream.read(MAX_IMAGE_BYTES + 1))
            os.fchmod(fd, 0o644)
        finally:
            os.close(fd)
        destination = "hdmi%d.png" % port
        self._check(destination)
        os.replace(".capture.png", destination, src_dir_fd=self.fd, dst_dir_fd=self.fd)

    def status(self, value):
        data = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("ascii")
        if len(data) > 2048:
            raise SafeError("status_too_large")
        self._remove(".status.tmp")
        fd = os.open(".status.tmp", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o644, dir_fd=self.fd)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        self._check("status.json")
        os.replace(".status.tmp", "status.json", src_dir_fd=self.fd, dst_dir_fd=self.fd)


class Luna:
    def __init__(self, executable):
        self.executable = executable

    def __call__(self, method, payload):
        if method not in URIS:
            raise SafeError("unknown_method")
        try:
            result = subprocess.run(
                [self.executable, "-n", "1", "-w", "6000", URIS[method],
                 json.dumps(payload, separators=(",", ":"))],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, timeout=8, check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise SafeError("luna_timeout_or_unavailable")
        if result.returncode or len(result.stdout) > 256 * 1024:
            raise SafeError("luna_failed")
        try:
            value = json.loads(result.stdout)
        except (ValueError, UnicodeDecodeError):
            raise SafeError("luna_invalid_reply")
        if not isinstance(value, dict) or value.get("returnValue") is not True:
            raise SafeError("luna_refused")
        return value


def app_installed(path=APPINFO):
    try:
        metadata = os.lstat(path)
        check_file(metadata)
        if metadata.st_size > 65536:
            return False
        with open(path, "r", encoding="utf-8") as stream:
            return json.load(stream).get("id") == HOME_ID
    except (OSError, ValueError, AttributeError, SafeError):
        return False


def check_thumbnail_link(metadata, target):
    if (not stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0
            or metadata.st_nlink != 1 or target != CACHE_DIR):
        raise SafeError("foreign_thumbnail_path")


def ensure_thumbnail_link():
    """Restore this one app-owned link after an update; never replace another path."""
    check_directory(os.lstat(APP_DIR))
    app_fd = os.open(APP_DIR, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        check_directory(os.fstat(app_fd))
        manifest_fd = os.open("appinfo.json", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=app_fd)
        with os.fdopen(manifest_fd, "rb") as manifest:
            metadata = os.fstat(manifest.fileno())
            check_file(metadata)
            raw = manifest.read(65537)
            if len(raw) > 65536 or json.loads(raw).get("id") != HOME_ID:
                raise SafeError("invalid_app_manifest")
        try:
            metadata = os.stat("thumbnails", dir_fd=app_fd, follow_symlinks=False)
        except FileNotFoundError:
            os.symlink(CACHE_DIR, "thumbnails", dir_fd=app_fd)
            metadata = os.stat("thumbnails", dir_fd=app_fd, follow_symlinks=False)
        if not stat.S_ISLNK(metadata.st_mode):
            raise SafeError("foreign_thumbnail_path")
        check_thumbnail_link(metadata, os.readlink("thumbnails", dir_fd=app_fd))
    finally:
        os.close(app_fd)


def power_is_active(reply):
    # Fail closed until the caller's exact active state is established.
    return isinstance(reply, dict) and reply.get("returnValue") is True and reply.get("state") == "Active"


@dataclass(frozen=True)
class Source:
    port: int
    app_id: str
    context: str
    mode: tuple
    home_identity: tuple = None


def eligible_source(power, foreground, video, allow_home=False, home_identity=None):
    if not power_is_active(power):
        return None
    if (not isinstance(foreground, dict) or not isinstance(video, dict) or
            foreground.get("returnValue") is not True or video.get("returnValue") is not True):
        return None
    app_id = foreground.get("appId")
    if not isinstance(app_id, str):
        return None
    match = re.fullmatch(r"com\.webos\.app\.hdmi([1-4])", app_id)
    home = allow_home and (app_id == HOME_ID or
                          (app_id == STOCK_HOME_ID and home_identity is not None))
    if not match and not home:
        return None
    if not isinstance(video.get("video"), list) or not isinstance(video.get("clients"), list):
        return None
    mains = [v for v in video.get("video", []) if isinstance(v, dict) and v.get("sink") == "MAIN"]
    if len(mains) != 1:
        return None
    value = mains[0]
    content_type = value.get("contentType")
    content = re.fullmatch(r"hdmi([1-4])", content_type) if isinstance(content_type, str) else None
    context = value.get("context")
    if (not content or (match and match.group(1) != content.group(1))
            or value.get("appId") != app_id or value.get("connected") is not True
            or value.get("connectedSource") != "HDMI" or value.get("muted") is not False
            or not isinstance(context, str) or not context or context == "unknown"):
        return None
    rectangle = value.get("displayOutput", {})
    info = value.get("videoInfo")
    info = {} if info is None else info
    if not isinstance(rectangle, dict) or not isinstance(info, dict):
        return None
    vrr = info.get("hdmiVrrInfo")
    vrr = {} if vrr is None else vrr
    if not isinstance(vrr, dict):
        return None
    numbers = (value.get("width"), value.get("height"), value.get("frameRate"),
               rectangle.get("width"), rectangle.get("height"))
    if not all(type(v) in (int, float) and v > 0 for v in numbers):
        return None
    clients = [c for c in video.get("clients", []) if isinstance(c, dict)
               and c.get("clientId") == context and c.get("appId") == app_id
               and c.get("activation") is True and c.get("sinkName") == "MAIN"
               and c.get("sourceName") == "HDMI"]
    if len(clients) != 1:
        return None
    mode = tuple(numbers) + (rectangle.get("x"), rectangle.get("y"), info.get("hdrType"),
                            vrr.get("vrrEnabled"))
    return Source(int(content.group(1)), app_id, context, mode,
                  home_identity if app_id == STOCK_HOME_ID else None)


class Worker:
    def __init__(self, luna, cache, installed=app_installed, clock=time.monotonic,
                 wall=time.time, stop=None, capture_method="VIDEO", allow_home=False,
                 ensure_link=ensure_thumbnail_link, app_ready=None,
                 verify_home=checked_home_preview):
        if capture_method not in ("BLENDED", "VIDEO") or (allow_home and capture_method != "VIDEO"):
            raise SafeError("unverified_home_capture_mode")
        self.luna, self.cache, self.installed = luna, cache, installed
        self.clock, self.wall = clock, wall
        self.stop = stop or threading.Event()
        self.capture_method, self.allow_home = capture_method, allow_home
        self.ensure_link = ensure_link
        self.app_ready, self.app_missing_since = app_ready, None
        self.verify_home = verify_home
        self.observed, self.since = None, 0
        self.attempts = OrderedDict()
        self.last_capture = {}

    def snapshot(self):
        power = self.luna("power", {})
        if not power_is_active(power):
            return None
        foreground = self.luna("foreground", {})
        if not isinstance(foreground, dict):
            return None
        app_id = foreground.get("appId")
        if not isinstance(app_id, str):
            return None
        if not (re.fullmatch(r"com\.webos\.app\.hdmi[1-4]", app_id)
                or (self.allow_home and app_id in (HOME_ID, STOCK_HOME_ID))):
            return None
        home_identity = self.verify_home() if app_id == STOCK_HOME_ID else None
        video = self.luna("video", {})
        return eligible_source(power, foreground, video, self.allow_home, home_identity)

    def status(self, state, source=None, error=None):
        value = {"version": 1, "state": state, "updatedAt": int(self.wall()),
                 "captures": self.last_capture}
        if source:
            value["input"] = "hdmi%d" % source.port
        if error:
            value["error"] = error
        self.cache.status(value)

    def source_unchanged(self, source):
        """Recheck foreground, signal and takeover identity before publishing."""
        after = None if self.stop.is_set() else self.snapshot()
        if after == source and not self.stop.is_set() and self.installed():
            return True
        self.observed = after
        self.since = self.clock()
        self.status("discarded_source_changed")
        return False

    def capture(self, source):
        """Capture once, crop Home's owned rectangle, then publish atomically."""
        target = self.cache.prepare()
        try:
            home = is_home_source(source)
            if home:
                home_crop_bounds(source)
            self.luna("capture", {"path": target, "method": self.capture_method,
                                  "width": PIG_CAPTURE_WIDTH if home else WIDTH,
                                  "height": PIG_CAPTURE_HEIGHT if home else HEIGHT,
                                  "format": "PNG"})
            if not self.source_unchanged(source):
                return
            if home:
                self.cache.crop_home(source)
                # The first lazy OpenCV import can take seconds on this TV.
                if not self.source_unchanged(source):
                    return
            self.cache.publish(source.port)
            self.last_capture["hdmi%d" % source.port] = int(self.wall())
            self.status("captured", source)
        finally:
            self.cache.remove_temp()

    def step(self):
        if self.stop.is_set():
            return False
        if self.app_ready is not None:
            try:
                # Repair only the exact installed app's pinned metadata.
                if self.app_ready() is not True:
                    raise SafeError("app_metadata_rejected")
            except FileNotFoundError:
                self.observed = None
                if self.stop.is_set():
                    return False
                now = self.clock()
                if self.app_missing_since is None:
                    self.app_missing_since = now
                if now - self.app_missing_since >= APP_READY_GRACE_SECONDS:
                    self.status("app_unavailable", error="app_missing_timeout")
                    return False
                self.status("waiting_for_app")
                # main() uses its ordinary interruptible five-second poll.
                return True
            except SafeError:
                self.observed = None
                self.status("app_rejected", error="app_readiness_failed")
                return False
            self.app_missing_since = None
            if self.stop.is_set():
                return False
        if not self.installed():
            self.status("app_absent")
            return False
        source = None
        try:
            self.ensure_link()
            source = self.snapshot()
            if self.stop.is_set():
                return False
            now = self.clock()
            if source is None:
                self.observed = None
                self.status("idle")
                return True
            if source != self.observed:
                self.observed, self.since = source, now
                self.status("settling", source)
                return True
            if now - self.since < SETTLE_SECONDS:
                self.status("settling", source)
                return True
            key = (source.app_id, source.context)
            if key in self.attempts and now - self.attempts[key] < REFRESH_SECONDS:
                self.status("waiting", source)
                return True
            # Rate-limit attempts as well as successes, including permission refusal.
            self.attempts[key] = now
            self.attempts.move_to_end(key)
            while len(self.attempts) > 32:
                self.attempts.popitem(last=False)
            self.capture(source)
        except SafeError as error:
            self.observed = None
            self.status("skipped", source, str(error))
        except (OSError, ValueError, TypeError, KeyError):
            self.observed = None
            self.status("skipped", source, "local_or_reply_error")
        return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Two polls with a settling interval, then exit")
    parser.add_argument("--iterations", type=int, help="Maximum polling iterations")
    parser.add_argument("--method", choices=("BLENDED", "VIDEO"), default="VIDEO")
    parser.add_argument("--allow-home-preview", action="store_true",
                        help="Use only after VIDEO capture and app-owned live preview are verified")
    args = parser.parse_args(argv)
    if args.iterations is not None and not 1 <= args.iterations <= 100000:
        parser.error("iterations must be between 1 and 100000")
    import shutil
    executable = shutil.which("luna-send")
    if not executable:
        return 2
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda _sig, _frame: stop.set())
    cache = None
    try:
        cache = Cache()
        worker = Worker(Luna(executable), cache, stop=stop,
                        capture_method=args.method, allow_home=args.allow_home_preview,
                        app_ready=checked_app)
        limit = 2 if args.once else args.iterations
        count = 0
        while not stop.is_set() and (limit is None or count < limit):
            if not worker.step():
                break
            count += 1
            if limit is None or count < limit:
                stop.wait(POLL_SECONDS)
        cache.remove_temp()
        if stop.is_set():
            worker.status("stopped")
        return 0
    except (SafeError, OSError):
        # No raw Luna responses, stack traces, content or unbounded logs.
        return 2
    finally:
        if cache is not None:
            cache.close()


if __name__ == "__main__":
    raise SystemExit(main())
