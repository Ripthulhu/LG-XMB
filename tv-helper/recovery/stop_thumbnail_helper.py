#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Recovery-only cleanup of the exact C5 thumbnail helper and startup hook."""
import errno
import hashlib
import json
import os
import signal
import stat
import time

HELPER = b"/var/lib/openxmb-c5/thumbnail-cache.py"
PYTHON = "/usr/bin/python3"
HOOK_DIR = "/var/lib/webosbrew/init.d"
HOOK_NAME = "60-openxmb-thumbnails"
# Filled by the staging builder from the reviewed wrapper (LF normalized).
HOOK_HASHES = {'c23680117ea88b6932215150683bdde735eb4476fcace0f7dc2a96d9deb88ca8', '855eab9fbcea192ae82c33cf0b3398ab06559a965c44beb24254388fc4399576', '373ca1934619a4887b3bc07ba2859dbb79e91145ee31efa08a359d47b8b0fa81'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def regular_owned(info):
    return (stat.S_ISREG(info.st_mode) and info.st_uid == 0
            and info.st_nlink == 1 and not info.st_mode & 0o022)


def inspect_hook():
    """Return an anchored directory descriptor and exact reviewed hook identity."""
    for directory in ("/var", "/var/lib", "/var/lib/webosbrew", HOOK_DIR):
        try:
            info = os.lstat(directory)
        except FileNotFoundError:
            return None, None
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0
                and not info.st_mode & 0o022,
                "Refusing an unsafe thumbnail startup directory: " + directory)
    descriptor = os.open(HOOK_DIR, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(os.fstat(descriptor).st_ino == info.st_ino
                and os.fstat(descriptor).st_dev == info.st_dev,
                "Thumbnail startup directory changed")
        try:
            entry = os.stat(HOOK_NAME, dir_fd=descriptor, follow_symlinks=False)
        except FileNotFoundError:
            return descriptor, None
        require(regular_owned(entry) and entry.st_size <= 8192,
                "Refusing an unsafe thumbnail startup hook")
        hook = os.open(HOOK_NAME, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
        try:
            opened = os.fstat(hook)
            require(regular_owned(opened) and (opened.st_dev, opened.st_ino)
                    == (entry.st_dev, entry.st_ino), "Thumbnail startup hook changed")
            content = os.read(hook, 8193)
        finally:
            os.close(hook)
        require(hashlib.sha256(content.replace(b"\r\n", b"\n")).hexdigest() in HOOK_HASHES,
                "Thumbnail startup hook contents differ; leaving it untouched")
        return descriptor, (entry.st_dev, entry.st_ino, entry.st_size,
                            entry.st_mtime_ns, entry.st_ctime_ns)
    except BaseException:
        os.close(descriptor)
        raise


def process_identity(pid):
    """A PID alone never authorizes a signal; inspect owner, argv, exe and birth."""
    require(type(pid) is int and pid > 1, "Invalid helper process ID")
    directory = "/proc/%d" % pid
    try:
        if os.stat(directory).st_uid != 0:
            return None
        with open(directory + "/cmdline", "rb") as handle:
            raw = handle.read(16385)
        if len(raw) > 16384:
            return None
        arguments = raw.rstrip(b"\0").split(b"\0")
        if (len(arguments) < 2 or arguments[0] not in (b"python3", PYTHON.encode())
                or arguments[1] != HELPER):
            return None
        require(os.path.samefile(directory + "/exe", PYTHON),
                "Helper-like command has a different interpreter; refusing to signal")
        with open(directory + "/stat", "r", encoding="ascii") as handle:
            fields = handle.read(4096).rsplit(")", 1)[1].split()
        if fields[0] == "Z":
            return None
        start = int(fields[19])
        # Include the complete command, so an argument change cancels the action.
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
                # Older kernels: perform the full identity check immediately above.
                os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            return False
        return True
    finally:
        if descriptor is not None:
            os.close(descriptor)


def main():
    require(os.geteuid() == 0, "Recovery must run as root on the TV")
    directory, hook = inspect_hook()
    try:
        processes = find_helpers()
        # Remove only the reviewed own hook first, preventing its next startup.
        if hook is not None:
            current = os.stat(HOOK_NAME, dir_fd=directory, follow_symlinks=False)
            require(regular_owned(current) and (current.st_dev, current.st_ino, current.st_size,
                    current.st_mtime_ns, current.st_ctime_ns) == hook,
                    "Thumbnail startup hook changed; refusing to remove it")
            os.unlink(HOOK_NAME, dir_fd=directory)
        signalled = sum(stop_one(identity) for identity in processes)
        deadline = time.monotonic() + 40
        while any(process_identity(identity[0]) == identity for identity in processes):
            require(time.monotonic() < deadline,
                    "Thumbnail helper did not stop after SIGTERM; recovery halted without force")
            time.sleep(.25)
        require(not find_helpers(),
                "Another thumbnail helper appeared; recovery halted without a kill loop")
        print(json.dumps({"thumbnailHelperStopped": True,
                          "thumbnailHelpersSignalled": signalled,
                          "thumbnailStartupHookRemoved": hook is not None,
                          "helperAndCacheFilesPreserved": True}), flush=True)
    finally:
        if directory is not None:
            os.close(directory)


if __name__ == "__main__":
    main()
