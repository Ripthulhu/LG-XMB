#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Install the bundled C5 helper after an explicit in-app request. No network downloads."""
import contextlib
import fcntl
import hashlib
import io
import json
import os
import re
import selectors
import stat
import subprocess
import sys
import time
import types

APP = '/media/developer/apps/usr/palm/applications/org.local.openxmb.c5'
BASE = '/var/lib/openxmb-c5'
HOOK_DIR = '/var/lib/webosbrew/init.d'
HOOK = '60-openxmb-thumbnails'
TARGET = APP + '/helper-startup.py'
BUNDLE_SHA256 = '@BUNDLE_SHA256@'  # Filled only in the staged package.
FILES = ('process-control.py', 'thumbnail-cache.py', 'stop-helper.py')


class SetupError(Exception):
    pass


def require(value, code='helper_unsafe_path'):
    if not value:
        raise SetupError(code)


@contextlib.contextmanager
def directory(path, create=False, app=False):
    """Anchor every path component; create only our own two leaf directories."""
    descriptor = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parts = path.strip('/').split('/')
        for index, part in enumerate(parts):
            if create and index == len(parts) - 1:
                try:
                    os.mkdir(part, 0o755, dir_fd=descriptor)
                except FileExistsError:
                    pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
            info = os.fstat(descriptor)
            # Installation ancestors can be writable on webOS. Manifest bytes
            # are pinned, and the controller repairs only its own app metadata.
            require(info.st_uid == 0 and (app or not info.st_mode & 0o022))
        yield descriptor
    finally:
        os.close(descriptor)


def regular(info, writable=False):
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
            and (writable or not info.st_mode & 0o022))


def read_file(fd, name, writable=False):
    file = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        regular(os.fstat(file), writable)
        with os.fdopen(os.dup(file), 'rb') as stream:
            raw = stream.read(262145)
        require(len(raw) <= 262144, 'helper_file_too_large')
        return raw
    finally:
        os.close(file)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def load_bundle():
    with directory(APP, app=True) as app:
        raw = read_file(app, 'helper-bundle.json')
        require(sha(raw) == BUNDLE_SHA256, 'helper_bundle_mismatch')
        bundle = json.loads(raw)
        expected = {'helper/' + name for name in FILES} | {'helper-startup.py'}
        require(bundle.get('schema') == 1 and set(bundle.get('files', {})) == expected,
                'helper_bundle_mismatch')
        require(sha(read_file(app, 'appinfo.json', writable=True)) == bundle['appinfo'],
                'helper_manifest_mismatch')
        data = {'helper-startup.py': read_file(app, 'helper-startup.py')}
    with directory(APP + '/helper', app=True) as source:
        for name in FILES:
            data['helper/' + name] = read_file(source, name)
    require(all(sha(raw) == bundle['files'][name] for name, raw in data.items()),
            'helper_bundle_mismatch')
    return data


def module(name, raw):
    # Execute the bytes already validated, not a second path-based read.
    name = 'lg_xmb_setup_' + name
    result = types.ModuleType(name)
    sys.modules[name] = result
    exec(compile(raw, '<bundled ' + name + '>', 'exec'), result.__dict__)
    return result


def platform():
    argv = ['/usr/bin/luna-send', '-n', '1', '-w', '3000',
            'luna://com.webos.service.tv.systemproperty/getSystemInfo',
            '{"keys":["modelName","sdkVersion"]}']
    deadline = time.monotonic() + 4
    with subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL) as child:
        try:
            raw = bytearray()
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    require(remaining > 0 and selector.select(remaining), 'helper_tv_unknown')
                    chunk = os.read(child.stdout.fileno(), 4096)
                    if not chunk:
                        break
                    raw.extend(chunk)
                    require(len(raw) <= 65536, 'helper_tv_unknown')
            require(child.wait(timeout=max(.001, deadline - time.monotonic())) == 0,
                    'helper_tv_unknown')
        finally:
            if child.poll() is None:
                child.kill()  # Only our own short-lived query, never a TV service.
                child.wait()
    value = json.loads(raw)
    require(isinstance(value, dict) and value.get('returnValue') is True, 'helper_tv_unknown')
    model, sdk = value.get('modelName'), value.get('sdkVersion')
    require(isinstance(model, str) and isinstance(sdk, str), 'helper_tv_unknown')
    # Do not turn a frontend compatibility target into permission to apply the
    # C5-specific process/capture assumptions to an unknown television.
    require(re.fullmatch(r'(?:OLED)?(?:42|48|55|65|77|83)C5[A-Z0-9.\-]*', model.upper())
            and re.fullmatch(r'10\.\d+\.\d+(?:[.\-][0-9]+)*', sdk), 'helper_tv_unsupported')


def validate_config(control, raw):
    try:
        control.valid_config(json.loads(raw))
    except (ValueError, control.ControlError):
        raise SetupError('helper_invalid_config') from None


def inspect(data, recovery):
    try:
        with directory(BASE) as base:
            current = all(read_file(base, name) == data['helper/' + name] for name in FILES)
            config = read_file(base, 'background.json')
        control = module('control', data['helper/process-control.py'])
        validate_config(control, config)
    except FileNotFoundError:
        return 'missing'
    fd, identity = recovery.inspect_hook()
    try:
        linked = identity is not None and os.readlink(HOOK, dir_fd=fd) == TARGET
    except OSError:
        linked = False
    finally:
        if fd is not None:
            os.close(fd)
    if not current or not linked:
        return 'needs_setup'
    return 'running' if recovery.find_helpers() else 'stopped'


def write_new(base, name, raw, mode=0o755):
    temporary = '.setup-' + os.urandom(8).hex()
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 mode, dir_fd=base)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        # Validate the destination again, including dangling links and hardlinks.
        try:
            regular(os.stat(name, dir_fd=base, follow_symlinks=False))
        except FileNotFoundError:
            pass
        os.replace(temporary, name, src_dir_fd=base, dst_dir_fd=base)
    finally:
        try:
            os.unlink(temporary, dir_fd=base)
        except FileNotFoundError:
            pass


@contextlib.contextmanager
def locked_base():
    with directory(BASE, create=True) as base:
        lock = os.open('setup.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK,
                       0o600, dir_fd=base)
        try:
            regular(os.fstat(lock))
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SetupError('helper_busy') from None
            yield base
        finally:
            os.close(lock)


def install(data, recovery):
    control = module('control', data['helper/process-control.py'])
    # Validate every destination before stopping anything. Unknown hooks and
    # foreign files are not an invitation to overwrite them.
    fd, _ = recovery.inspect_hook()
    if fd is not None:
        os.close(fd)
    worker = module('worker', data['helper/thumbnail-cache.py'])
    with directory(APP, app=True) as app:
        try:
            info = os.stat('thumbnails', dir_fd=app, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            require(stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                    and os.readlink('thumbnails', dir_fd=app) == worker.CACHE_DIR)
    with locked_base() as base:
        for name in FILES:
            try:
                read_file(base, name)
            except FileNotFoundError:
                pass
        try:
            validate_config(control, read_file(base, 'background.json'))
            existing_config = True
        except FileNotFoundError:
            existing_config = False
        control.checked_app()
        with directory(HOOK_DIR, create=True):
            pass
        # Legacy and current workers share the exact guarded recovery path.
        # Do not mix its JSON result with this command's single JSON reply.
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                recovery.main()
        except RuntimeError:
            raise SetupError('helper_recovery_refused') from None
        for name in FILES:
            write_new(base, name, data['helper/' + name])
        if not existing_config:
            config = {'schema': 1, 'revision': 0,
                      'enabled': {key: False for key in control.ITEMS}, 'saved': {}}
            config_fd = os.open('background.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                                os.O_NOFOLLOW, 0o600, dir_fd=base)
            with os.fdopen(config_fd, 'w') as stream:
                json.dump(config, stream)
                stream.flush()
                os.fsync(stream.fileno())
        # No configuration or Home mapping writes during updates.
        worker.ensure_thumbnail_link()
        with directory(HOOK_DIR) as hooks:
            os.symlink(TARGET, HOOK, dir_fd=hooks)
        starter = module('starter', data['helper-startup.py'])
        starter.start()
        # A spawn is not proof of a successful capture. Report only that
        # the exact worker is alive; status/capture APIs remain separate.
        deadline = time.monotonic() + 3
        while not recovery.find_helpers():
            require(time.monotonic() < deadline, 'helper_start_failed')
            time.sleep(.1)
        return 'starting'


def execute(action):
    require(action in ('status', 'install', 'stop'), 'helper_invalid_action')
    require(os.geteuid() == 0, 'helper_root_required')
    require(sys.version_info >= (3, 7), 'helper_python_required')
    data = load_bundle()
    recovery = module('recovery', data['helper/stop-helper.py'])
    if action == 'stop':
        # Stopping our verified worker remains possible after an OS upgrade;
        # it never applies a C5 process profile or resets the user's choices.
        with locked_base(), contextlib.redirect_stdout(io.StringIO()):
            recovery.main()
        return {'returnValue': True, 'state': 'stopped'}
    platform()
    state = inspect(data, recovery)
    if action == 'install' and state != 'running':
        state = install(data, recovery)
    return {'returnValue': True, 'state': state}


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    try:
        require(len(args) == 1, 'helper_invalid_action')
        value = execute(args[0])
    except SetupError as error:
        value = {'returnValue': False, 'errorCode': str(error)}
    except Exception:
        value = {'returnValue': False, 'errorCode': 'helper_setup_failed'}
    print(json.dumps(value, separators=(',', ':')))
    # Structured failures are delivered through Homebrew exec as JSON. They
    # remain failures to the app; a shell exit code must not hide the reason.
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
