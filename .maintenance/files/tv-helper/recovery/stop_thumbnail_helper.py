#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Stop only lg-xmb's worker and remove its reviewed startup links."""
import errno
import hashlib
import json
import os
import signal
import stat
import time

APP_DIR = "/media/developer/apps/usr/palm/applications/org.local.openxmb.c5"
HELPER = (APP_DIR + "/helper/thumbnail_cache.py").encode()
LEGACY_HELPER = b"/var/lib/openxmb-c5/thumbnail-cache.py"
PYTHON = "/usr/bin/python3"
HOOK_DIR = "/var/lib/webosbrew/init.d"
HOOK_NAME = "60-lg-xmb"
LEGACY_HOOK_NAME = "60-openxmb-thumbnails"
HOOK_TARGET = APP_DIR + "/helper-startup.py"
# Exact copies shipped before the app-owned startup link was introduced.
HOOK_HASHES = {'c23680117ea88b6932215150683bdde735eb4476fcace0f7dc2a96d9deb88ca8', '855eab9fbcea192ae82c33cf0b3398ab06559a965c44beb24254388fc4399576', '373ca1934619a4887b3bc07ba2859dbb79e91145ee31efa08a359d47b8b0fa81'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def regular_owned(info):
    return (stat.S_ISREG(info.st_mode) and info.st_uid == 0
            and info.st_nlink == 1 and not info.st_mode & 0o022)


def inspect_hook(name=None):
    """Return an anchored directory descriptor and exact reviewed hook identity."""
    name = HOOK_NAME if name is None else name
    require(name in (HOOK_NAME, LEGACY_HOOK_NAME), "Unknown startup hook")
    for directory in ("/var", "/var/lib", "/var/lib/webosbrew", HOOK_DIR):
        try:
            info = os.lstat(directory)
        except FileNotFoundError:
            return None, None
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0
                and not info.st_mode & 0o022,
                "Refusing an unsafe startup directory: " + directory)
    descriptor = os.open(HOOK_DIR, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(os.fstat(descriptor).st_ino == info.st_ino
                and os.fstat(descriptor).st_dev == info.st_dev,
                "Startup directory changed")
        return descriptor, read_hook(descriptor, name)
    except BaseException:
        os.close(descriptor)
        raise


def hook_identity(entry):
    return (entry.st_dev, entry.st_ino, entry.st_mode, entry.st_uid, entry.st_nlink,
            entry.st_size, entry.st_mtime_ns, entry.st_ctime_ns)


def read_hook(directory, name=None):
    """Inspect our link itself, even after uninstall; never follow its target."""
    name = HOOK_NAME if name is None else name
    require(name in (HOOK_NAME, LEGACY_HOOK_NAME), "Unknown startup hook")
    try:
        entry = os.stat(name, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return None
    target = None
    if stat.S_ISLNK(entry.st_mode):
        require(entry.st_uid == 0 and entry.st_nlink == 1,
                "Refusing an unsafe thumbnail startup link")
        target = os.readlink(name, dir_fd=directory)
        require(target == HOOK_TARGET,
                "Thumbnail startup link targets another file; leaving it untouched")
    else:
        require(regular_owned(entry) and entry.st_size <= 8192,
                "Refusing an unsafe thumbnail startup hook")
        hook = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                       dir_fd=directory)
        try:
            opened = os.fstat(hook)
            require(regular_owned(opened) and hook_identity(opened) == hook_identity(entry),
                    "Thumbnail startup hook changed")
            content = os.read(hook, 8193)
        finally:
            os.close(hook)
        require(hashlib.sha256(content.replace(b"\r\n", b"\n")).hexdigest() in HOOK_HASHES,
                "Thumbnail startup hook contents differ; leaving it untouched")
    current = os.stat(name, dir_fd=directory, follow_symlinks=False)
    require(hook_identity(current) == hook_identity(entry), "Thumbnail startup hook changed")
    return hook_identity(entry), target


def remove_hook(directory, expected, name=None):
    name = HOOK_NAME if name is None else name
    if expected is None:
        return
    require(read_hook(directory, name) == expected,
            "Thumbnail startup hook changed; refusing to remove it")
    os.unlink(name, dir_fd=directory)


def helper_argument(raw):
    arguments = raw.rstrip(b"\0").split(b"\0")
    if len(arguments) < 2 or arguments[0] not in (b"python3", PYTHON.encode()):
        return None
    arguments = arguments[1:]
    if arguments[:2] == [b"-I", b"-B"]:
        arguments = arguments[2:]
    return arguments[0] if arguments and arguments[0] in (HELPER, LEGACY_HELPER) else None


def process_identity(pid):
    """A PID alone never authorizes a signal; inspect owner, argv, exe and birth."""
    require(type(pid) is int and pid > 1, "Invalid helper process ID")
    directory = "/proc/%d" % pid
    try:
        if os.stat(directory).st_uid != 0:
            return None
        with open(directory + "/cmdline", "rb") as handle:
            raw = handle.read(16385)
        if len(raw) > 16384 or helper_argument(raw) is None:
            return None
        require(os.path.samefile(directory + "/exe", PYTHON),
                "Helper-like command has a different interpreter; refusing to signal")
        with open(directory + "/stat", "r", encoding="ascii") as handle:
            fields = handle.read(4096).rsplit(")", 1)[1].split()
        if fields[0] == "Z":
            return None
        start = int(fields[19])
        return (pid, start, raw)
    except (FileNotFoundError, ProcessLookupError):
        return None


def find_helpers():
    matches = []
    for name in os.listdir("/proc"):
        if name.isdigit() and int(name) > 1:
            identity = process_identity(int(name))
            if identity is not None:
                matches.append(identity)
    require(len(matches) <= 4, "Unexpected number of matching helpers; refusing bulk signals")
    return matches


def stop_one(identity):
    """Use SIGTERM once; prefer a PID descriptor where the TV kernel supports it."""
    pid = identity[0]
    descriptor = None
    try:
        if hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"):
            try:
                descriptor = os.pidfd_open(pid, 0)
            except OSError as error:
                if error.errno == errno.ESRCH:
                    return False
                if error.errno not in (errno.ENOSYS, errno.EINVAL):
                    raise
        if process_identity(pid) != identity:
            return False
        try:
            if descriptor is not None:
                signal.pidfd_send_signal(descriptor, signal.SIGTERM)
            else:
                os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            return False
        return True
    finally:
        if descriptor is not None:
            os.close(descriptor)


def stop(legacy_only=False):
    require(os.geteuid() == 0, "Recovery must run as root on the TV")
    hooks = []
    names = (LEGACY_HOOK_NAME,) if legacy_only else (HOOK_NAME, LEGACY_HOOK_NAME)
    def matching():
        return [identity for identity in find_helpers()
                if not legacy_only or helper_argument(identity[2]) == LEGACY_HELPER]
    try:
        # Inspect every hook before removing or signalling anything.
        for name in names:
            directory, hook = inspect_hook(name)
            hooks.append((name, directory, hook))
        processes = matching()
        for name, directory, hook in hooks:
            remove_hook(directory, hook, name)
        signalled = sum(stop_one(identity) for identity in processes)
        deadline = time.monotonic() + 40
        while any(process_identity(identity[0]) == identity for identity in processes):
            require(time.monotonic() < deadline,
                    "Thumbnail helper did not stop after SIGTERM; recovery halted without force")
            time.sleep(.25)
        require(not matching(),
                "Another thumbnail helper appeared; recovery halted without a kill loop")
        return {"thumbnailHelperStopped": True,
                "thumbnailHelpersSignalled": signalled,
                "thumbnailStartupHookRemoved": any(hook is not None for _, _, hook in hooks),
                "helperAndCacheFilesPreserved": True}
    finally:
        for _, directory, _ in hooks:
            if directory is not None:
                os.close(directory)


def main():
    print(json.dumps(stop()), flush=True)


if __name__ == "__main__":
    main()
