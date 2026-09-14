#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Start the optional C5 helper. The init.d link must point into the installed app."""
import fcntl
import os
import stat
import subprocess
import sys

APP_DIR = "/media/developer/apps/usr/palm/applications/org.local.openxmb.c5"
BASE = "/var/lib/openxmb-c5"
LOG_DIR = "/var/lib/webosbrew"
LOG_NAME = "lg-xmb-startup.log"
PYTHON = "/usr/bin/python3"


def require(condition):
    if not condition:
        raise RuntimeError("Unsafe helper startup path")


def open_directory(path, app_path=False):
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.strip("/").split("/"):
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
            info = os.fstat(descriptor)
            # LG resets app modes at boot. The worker validates its pinned
            # manifest and repairs only the app's metadata before doing any work.
            require(info.st_uid == 0 and (app_path or not info.st_mode & 0o022))
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def regular_file(info, app_file=False):
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
            and (app_file or not info.st_mode & 0o022))


def check_file(directory, name, app_file=False):
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                         dir_fd=directory)
    try:
        regular_file(os.fstat(descriptor), app_file)
    finally:
        os.close(descriptor)


def start():
    require(os.geteuid() == 0)
    # Nothing is created and no process is launched if the app is gone.
    try:
        app = open_directory(APP_DIR, app_path=True)
        try:
            check_file(app, "appinfo.json", app_file=True)
        finally:
            os.close(app)
    except FileNotFoundError:
        return 0
    base = open_directory(BASE)
    try:
        for name in ("thumbnail-cache.py", "process-control.py"):
            check_file(base, name)
    finally:
        os.close(base)
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
            return 0
        # Keep the lock in the child so a duplicate start cannot erase this
        # record. Worker status uses its bounded JSON files, not a growing log.
        os.ftruncate(log, 0)
        os.write(log, b"LG-XMB: starting C5 helper; runtime status is under /tmp/openxmb-c5-*\n")
        try:
            subprocess.Popen([PYTHON, BASE + "/thumbnail-cache.py",
                              "--allow-home-preview", "--process-controls"],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, pass_fds=(log,),
                             start_new_session=True, close_fds=True)
        except OSError:
            os.write(log, b"LG-XMB: could not launch helper\n")
            raise
    finally:
        os.close(log)
    return 0


def main():
    if len(sys.argv) != 1:
        print("No arguments accepted.", file=sys.stderr)
        return 2
    try:
        return start()
    except (OSError, RuntimeError):
        print("LG-XMB helper startup refused; check installed files and ownership.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
