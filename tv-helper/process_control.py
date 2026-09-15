#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Fixed optional-app and privacy controls for the local C5 Home menu."""
import copy
import errno
import hashlib
import json
import os
import re
import signal
import stat
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

HOME = 'org.local.openxmb.c5'
BASE = '/var/lib/lg-xmb'
RUNTIME = '/tmp/lg-xmb-controls'
APPINFO = '/media/developer/apps/usr/palm/applications/' + HOME + '/appinfo.json'
PIN_APPINFO_SHA256 = '1aaeb80b98594b30fec8423a12eb9c90f2d03c07923b0a2e8d544230ad5089d2'
PRELOAD_FILE = '/var/preferences/webos-preload-manager-conf.json'
ITEMS = {
 'home': {'title': 'LG Home', 'group': 'apps', 'app': 'com.webos.app.home', 'exe': '/usr/bin/flutter-client', 'description': 'Open it from Settings when needed. It closes again after you return.'},
 'browser': {'title': 'Web Browser', 'group': 'apps', 'app': 'com.webos.app.browser', 'exe': '/var/palm/jail/com.webos.app.browser/mnt/otncabi/usr/palm/applications/com.webos.app.browser/chrome', 'description': 'Starts when opened. The first launch may take longer; open tabs may reload.'},
 'search': {'title': 'Search', 'group': 'apps', 'app': 'com.webos.app.voice', 'exe': '/usr/bin/com.webos.app.voice', 'description': 'Text and voice search start on demand. Search and spoken guidance may take longer to open.'},
 'hdmi1': {'title': 'HDMI 1', 'group': 'apps', 'app': 'com.webos.app.hdmi1', 'exe': '/usr/bin/com.webos.app.inputcommon', 'description': 'Closes this input app while Home is open. Switching to it may take longer. Live previews are kept running.'},
 'hdmi2': {'title': 'HDMI 2', 'group': 'apps', 'app': 'com.webos.app.hdmi2', 'exe': '/usr/bin/com.webos.app.inputcommon', 'description': 'Closes this input app while Home is open. Switching to it may take longer. Live previews are kept running.'},
 'hdmi3': {'title': 'HDMI 3', 'group': 'apps', 'app': 'com.webos.app.hdmi3', 'exe': '/usr/bin/com.webos.app.inputcommon', 'description': 'Closes this input app while Home is open. Switching to it may take longer.'},
 'hdmi4': {'title': 'HDMI 4', 'group': 'apps', 'app': 'com.webos.app.hdmi4', 'exe': '/usr/bin/com.webos.app.inputcommon', 'description': 'Closes this input app while Home is open. Switching to it may take longer.'},
 'livetv': {'title': 'Live TV', 'group': 'apps', 'app': 'com.webos.app.livetv', 'exe': '/usr/bin/com.webos.app.inputcommon', 'description': 'Starts when opened. Channels, the guide and captions may take longer to appear.'},
 'usage': {'title': 'Usage history & AI nudges', 'group': 'privacy', 'description': 'Stops usage ranking and AI nudges in Home, including related reminders. Allow restores services that were running. Existing history is kept.'},
 'voice': {'title': 'LG voice commands', 'group': 'privacy', 'description': 'Stops LG voice recognition and command handling in Home. Voice search and dictation may be unavailable until Allow. This does not mute microphones.'},
 'ads': {'title': 'LG advertising service', 'group': 'privacy', 'description': 'Stops LG advertising activity in Home. Other TV apps can request it again. This does not block ads inside streaming apps.'}
}
APPS = {v['app']: k for k, v in ITEMS.items() if 'app' in v}
UNITS = {'user-context-manager.service': '/usr/sbin/user-context-manager', 'nudge.service': '/usr/sbin/nudge'}
VOICE_UNITS = {'voiceconductor.service': '/usr/sbin/voiceconductor'}
UNIT_GROUPS = {'usage': UNITS, 'voice': VOICE_UNITS}
ALL_UNITS = dict(UNITS, **VOICE_UNITS)
ORIGINAL_ITEMS = {'home', 'browser', 'search', 'hdmi3', 'hdmi4', 'livetv', 'usage', 'ads'}
URLS = {
 'power': 'luna://com.webos.service.tvpower/power/getPowerState',
 'foreground': 'luna://com.webos.applicationManager/getForegroundAppInfo',
 'running': 'luna://com.webos.applicationManager/running',
 'close': 'luna://com.webos.applicationManager/close',
 'policies': 'luna://com.webos.service.preloadmanager/getPreloadPolicy',
 'policy': 'luna://com.webos.service.preloadmanager/setPreloadPolicy',
 'ads_start': 'luna://com.webos.service.admanager/start',
 'video': 'luna://com.webos.service.videooutput/getStatus',
 'home_settings': 'luna://com.webos.settingsservice/getSystemSettings',
 'home_mapping': 'luna://com.webos.applicationManager/setDefaultApp',
}

class ControlError(Exception):
    pass

def require(value, code):
    if not value:
        raise ControlError(code)

def checked_dir(path, owner=0):
    meta = os.lstat(path)
    require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == owner and not meta.st_mode & 0o022, 'unsafe_directory')

def checked_file(meta):
    require(stat.S_ISREG(meta.st_mode) and meta.st_uid == 0 and meta.st_nlink == 1 and not meta.st_mode & 0o022, 'unsafe_file')


def checked_json(path, limit=131072, writable_ancestors=False):
    """Read an owned file through checked directory descriptors, without symlinks."""
    parts = Path(path).parts
    require(Path(path).is_absolute() and '..' not in parts, 'unsafe_path')
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for index, part in enumerate(parts[1:-1], 1):
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            try:
                meta = os.fstat(child)
                # LG owns writable installation ancestors. The exact app directory
                # and descriptor remain private; never loosen their permissions.
                allow_writable = writable_ancestors and index < len(parts) - 2
                # LG also owns a writable preferences directory. Accept this one
                # verified parent only for its anchored, protected preload file.
                allow_writable = allow_writable or (path == PRELOAD_FILE and index == len(parts) - 2)
                require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == 0
                        and (allow_writable or not meta.st_mode & 0o022), 'unsafe_directory')
            except Exception:
                os.close(child); raise
            os.close(directory); directory = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        with os.fdopen(fd, 'rb') as stream:
            checked_file(os.fstat(stream.fileno())); raw = stream.read(limit + 1)
        require(len(raw) <= limit, 'oversize_state')
        value = json.loads(raw)
        require(isinstance(value, dict), 'invalid_json_object')
        return value
    finally:
        os.close(directory)


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
        require(isinstance(value, dict) and value.get('id') == HOME, 'invalid_app_manifest')
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
            raise ControlError('app_path_changed') from error
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
        raise ControlError('unsafe_app_path') from error
    finally:
        if manifest is not None: os.close(manifest)
        for fd in reversed(directories): os.close(fd)


def valid_config(c):
    require(isinstance(c, dict) and c.get('schema') == 1, 'invalid_config')
    require(type(c.get('revision')) is int and 0 <= c['revision'] <= 1000000000, 'invalid_revision')
    require(isinstance(c.get('enabled'), dict) and ORIGINAL_ITEMS.issubset(c['enabled'])
            and set(c['enabled']).issubset(ITEMS) and all(type(v) is bool for v in c['enabled'].values()), 'invalid_choices')
    if set(c['enabled']) != set(ITEMS):
        c = copy.deepcopy(c)
        for key in ITEMS: c['enabled'].setdefault(key, False)
    require(isinstance(c.get('saved'), dict) and set(c['saved']).issubset(ITEMS), 'invalid_saved_state')
    for key, saved in c['saved'].items():
        require(isinstance(saved, dict), 'invalid_saved_state')
        if 'app' in ITEMS[key]:
            require(set(saved) == {'enabled', 'permanentRestore'} and all(type(v) is bool for v in saved.values()), 'invalid_saved_policy')
        elif key in UNIT_GROUPS:
            require(set(saved) == set(UNIT_GROUPS[key]) and all(type(v) is bool for v in saved.values()), 'invalid_saved_units')
        else:
            require(set(saved) == {'active'} and type(saved['active']) is bool, 'invalid_saved_ads')
    return c

def default_config():
    # A fresh installation must not invent preload or service rollback values.
    return {'schema': 1, 'revision': 0, 'enabled': {k: False for k in ITEMS}, 'saved': {}}

class Store:
    """Root-owned choices on disk; leases and live status only on tmpfs."""
    def __init__(self):
        for p in ('/var', '/var/lib', BASE): checked_dir(p)
        self.base = os.open(BASE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        temp = os.lstat('/tmp')
        require(stat.S_ISDIR(temp.st_mode) and temp.st_uid == 0 and temp.st_mode & stat.S_ISVTX, 'unsafe_tmp')
        try: os.mkdir(RUNTIME, 0o700)
        except FileExistsError: pass
        checked_dir(RUNTIME)
        self.runtime = os.open(RUNTIME, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.boot = Path('/proc/sys/kernel/random/boot_id').read_text(encoding='ascii').strip()
        require(re.fullmatch(r'[0-9a-f-]{36}', self.boot), 'invalid_boot')

    def close(self):
        os.close(self.base); os.close(self.runtime)

    @contextmanager
    def locked(self):
        import fcntl
        fd = os.open('lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=self.runtime)
        checked_file(os.fstat(fd))
        deadline = time.monotonic() + 2
        try:
            while True:
                try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); break
                except BlockingIOError:
                    if time.monotonic() >= deadline: raise ControlError('busy')
                    time.sleep(.02)
            yield
        finally:
            os.close(fd)

    def read(self, name, runtime=False, default=None):
        require(name in ('background.json', 'state.json', 'leases.json'), 'invalid_store_name')
        try: fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.runtime if runtime else self.base)
        except FileNotFoundError: return copy.deepcopy(default)
        with os.fdopen(fd, 'rb') as f:
            checked_file(os.fstat(f.fileno()))
            data = f.read(131073)
        require(len(data) <= 131072, 'oversize_state')
        try: return json.loads(data)
        except (ValueError, UnicodeDecodeError): raise ControlError('invalid_json')

    def write(self, name, value, runtime=False):
        require(name in ('background.json', 'state.json', 'leases.json'), 'invalid_store_name')
        directory = self.runtime if runtime else self.base
        try: checked_file(os.stat(name, dir_fd=directory, follow_symlinks=False))
        except FileNotFoundError: pass
        raw = (json.dumps(value, separators=(',', ':')) + '\n').encode()
        require(len(raw) <= 131072, 'oversize_state')
        temporary = '.pending-%s-%s' % (os.getpid(), os.urandom(8).hex())
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        try:
            with os.fdopen(fd, 'wb') as f:
                f.write(raw); f.flush()
                if not runtime: os.fsync(f.fileno())
            os.replace(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
        finally:
            try: os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError: pass

    def config(self):
        return valid_config(self.read('background.json', default=default_config()))

    def leases(self):
        value = self.read('leases.json', True, {})
        require(isinstance(value, dict), 'invalid_leases')
        if value.get('boot') != self.boot: return {}
        leases = value.get('items', {})
        require(isinstance(leases, dict) and set(leases).issubset(APPS), 'invalid_leases')
        return {k: v for k, v in leases.items() if type(v) in (int, float) and time.monotonic() < v <= time.monotonic() + 30}

    def prepare(self, app):
        require(app in APPS, 'invalid_app')
        with self.locked():
            leases = self.leases(); leases[app] = time.monotonic() + 15
            self.write('leases.json', {'boot': self.boot, 'items': leases}, True)
        return {'returnValue': True, 'prepared': True}

    def finish_observed_visit(self, app, expiry):
        require(app in APPS and type(expiry) in (int, float), 'invalid_observed_lease')
        with self.locked():
            leases = self.leases()
            if leases.get(app) != expiry: return
            del leases[app]
            self.write('leases.json', {'boot': self.boot, 'items': leases}, True)

    def set_choice(self, key, enabled, revision, native=None):
        require(key in ITEMS and type(enabled) is bool, 'invalid_choice')
        require(type(revision) is int and 0 <= revision <= 1000000000, 'invalid_revision')
        with self.locked():
            c = self.config()
            require(c['revision'] == revision, 'stale_revision')
            if c['enabled'][key] != enabled:
                require(c['revision'] < 1000000000, 'revision_limit')
                if key == 'home' and enabled:
                    require((native or Native()).home_settings()['defaultApps'].get('home') == HOME, 'home_mapping_requires_custom')
                c['enabled'][key] = enabled; c['revision'] += 1
                self.write('background.json', c)
        return self.public()

    def remote_state(self, native=None):
        with self.locked():
            return self.remote_public(self.config(), (native or Native()).home_settings())

    @staticmethod
    def remote_public(c, settings):
        app = settings['defaultApps'].get('home')
        target = 'custom' if app == HOME else 'stock' if app in (None, ITEMS['home']['app']) else 'other'
        return {'returnValue': True, 'available': True, 'revision': c['revision'], 'home': target,
                'homeKeepClosed': c['enabled']['home']}

    def set_remote_home(self, target, revision, native=None):
        require(target in ('custom', 'stock'), 'invalid_home_target')
        require(type(revision) is int and 0 <= revision <= 1000000000, 'invalid_revision')
        native = native or Native()
        with self.locked():
            c = self.config(); require(c['revision'] == revision, 'stale_revision')
            before = native.home_settings()
            current = self.remote_public(c, before)['home']
            require(current != 'other', 'other_home_mapping')
            restore = target == 'stock' and 'home' in c['saved']
            allow = target == 'stock' and c['enabled']['home']
            if current == target and not restore and not allow: return self.remote_public(c, before)
            require(c['revision'] < 1000000000, 'revision_limit')
            # Invalidate older helper/UI work before a native change. A failure
            # keeps stock Home allowed with its baseline available for retry.
            c['revision'] += 1
            if target == 'stock': c['enabled']['home'] = False
            self.write('background.json', c)
            if restore:
                saved = c['saved']['home']
                native.preload('home', saved['enabled'], saved['permanentRestore'])
                del c['saved']['home']; self.write('background.json', c)
            after = native.set_home_mapping(target, before)
            return self.remote_public(c, after)

    def public(self):
        with self.locked():
            c = self.config(); s = self.read('state.json', True, {})
        require(isinstance(s, dict), 'invalid_live_state')
        online = s.get('boot') == self.boot and type(s.get('at')) in (int, float) and 0 <= time.monotonic() - s['at'] < 60
        states = s.get('items', {}) if online else {}
        require(isinstance(states, dict) and set(states).issubset(ITEMS)
                and all(isinstance(v, dict) for v in states.values()), 'invalid_live_items')
        result = []
        for key, item in ITEMS.items():
            current = states.get(key, {})
            status = current.get('status', 'Waiting for Home' if c['enabled'][key] else 'Allowed')
            require(isinstance(status, str) and len(status) <= 100, 'invalid_live_status')
            if current.get('enabled') != c['enabled'][key]: status = 'Applying' if c['enabled'][key] or key in c['saved'] else 'Allowed'
            result.append({'id': key, 'title': item['title'], 'group': item['group'], 'description': item['description'],
                           'enabled': c['enabled'][key], 'supported': True, 'status': status if online else 'Helper unavailable'})
        return {'returnValue': True, 'available': bool(online), 'revision': c['revision'], 'items': result}

class Native:
    def call(self, key, payload):
        require(key in URLS, 'invalid_native_operation')
        p = subprocess.run(['/usr/bin/luna-send', '-n', '1', '-w', '3000', URLS[key], json.dumps(payload)],
                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=4)
        require(p.returncode == 0 and len(p.stdout) <= 262144, 'native_failed')
        value = json.loads(p.stdout)
        require(isinstance(value, dict) and value.get('returnValue') is True, 'native_refused')
        return value

    def home_settings(self):
        value = self.call('home_settings', {'category': 'general', 'keys': ['defaultApps', 'lastAppHandlerPolicy'], 'subscribe': False}).get('settings')
        require(isinstance(value, dict) and isinstance(value.get('defaultApps'), dict)
                and all(isinstance(k, str) and isinstance(v, str) for k, v in value['defaultApps'].items())
                and isinstance(value.get('lastAppHandlerPolicy'), str), 'invalid_home_settings')
        return {key: copy.deepcopy(value[key]) for key in ('defaultApps', 'lastAppHandlerPolicy')}

    def set_home_mapping(self, target, before):
        require(target in ('custom', 'stock'), 'invalid_home_target')
        current = self.home_settings()
        require(current == before, 'home_mapping_changed')
        require(current['defaultApps'].get('home') in (None, HOME, ITEMS['home']['app']), 'other_home_mapping')
        app = HOME if target == 'custom' else ITEMS['home']['app']
        if current['defaultApps'].get('home') == app: return current
        self.call('home_mapping', {'category': 'home', 'appId': app})
        after = self.home_settings(); expected = copy.deepcopy(before); expected['defaultApps']['home'] = app
        require(after == expected, 'home_mapping_not_confirmed')
        return after

    def policies(self):
        entries = self.call('policies', {}).get('applications')
        require(isinstance(entries, list) and all(isinstance(x, dict) and isinstance(x.get('id'), str) for x in entries), 'invalid_policies')
        require(len({x.get('id') for x in entries}) == len(entries), 'ambiguous_policies')
        return {v['id']: v for v in entries}

    def preload(self, key, enabled, permanent=False):
        app = ITEMS[key]['app']; before = self.policies()
        require(app in before and type(before[app].get('isEnabled')) is bool, 'policy_missing')
        stored = None
        if permanent:
            require(key == 'home' and enabled is True, 'unexpected_permanent_policy')
            stored = checked_json(PRELOAD_FILE)
            overrides = stored.get('isEnabled', {})
            require(isinstance(overrides, dict) and all(type(v) is bool for v in overrides.values()), 'invalid_stored_policy')
        if before[app]['isEnabled'] == enabled:
            if not permanent or stored.get('isEnabled', {}).get(app, True) == enabled: return
            # The vendor setter writes permanent state only on an actual value change.
            # This narrow legacy Home recovery is needed only when disk disagrees.
            self.preload(key, False)
        policy = dict(before[app]); policy['isEnabled'] = enabled
        self.call('policy', {'application': policy, 'permanent': permanent})
        after = self.policies()
        expected = copy.deepcopy(before); expected[app]['isEnabled'] = enabled
        require(after == expected, 'policy_not_confirmed')
        if permanent:
            persisted = checked_json(PRELOAD_FILE)
            expected_stored = copy.deepcopy(stored)
            expected_stored.setdefault('isEnabled', {})[app] = enabled
            require(persisted == expected_stored, 'permanent_policy_not_confirmed')

    def identity(self, pid):
        require(type(pid) is int and pid > 1, 'invalid_pid')
        p = Path('/proc') / str(pid)
        try:
            raw = (p / 'stat').read_text(encoding='ascii'); fields = raw.rsplit(')', 1)[1].split()
            birth = int(fields[19]); args = (p / 'cmdline').read_bytes()
            require(len(args) < 16384, 'oversize_process')
            return {'pid': pid, 'birth': birth, 'exe': os.readlink(p / 'exe'), 'argv': args.split(b'\0'),
                    'cgroups': (p / 'cgroup').read_text(encoding='ascii').splitlines(), 'uid': p.stat().st_uid,
                    'age': float(Path('/proc/uptime').read_text().split()[0]) - birth / os.sysconf('SC_CLK_TCK')}
        except FileNotFoundError: return None

    def app_process(self, key, rows):
        require(isinstance(rows, list) and all(isinstance(v, dict) for v in rows), 'invalid_running_apps')
        item = ITEMS[key]; found = [v for v in rows if v.get('id') == item['app']]
        if not found: return None
        require(len(found) == 1 and isinstance(found[0].get('processid'), str)
                and re.fullmatch(r'[1-9][0-9]{0,9}', found[0]['processid']), 'ambiguous_app')
        process = self.identity(int(found[0]['processid']))
        if process is None: return None
        require(process['exe'] == item['exe'], 'foreign_app_executable')
        require(any(line.split(':', 2)[1] == 'memory' and line.split(':', 2)[2] == '/' + item['app'] for line in process['cgroups']), 'foreign_app_cgroup')
        if key == 'home': require(process['argv'][:3] == [b'/usr/bin/flutter-client', b'-i', item['app'].encode()], 'foreign_home_args')
        return process

    def ads(self):
        found = []
        for p in Path('/proc').iterdir():
            if not p.name.isdigit(): continue
            try:
                if os.readlink(p / 'exe') != '/usr/sbin/admanager': continue
                identity = self.identity(int(p.name))
                if identity: found.append(identity)
            except (FileNotFoundError, PermissionError): continue
        require(len(found) <= 1, 'ambiguous_ads')
        if found:
            require(found[0]['uid'] == 0 and found[0]['argv'] == [b'/usr/sbin/admanager', b''], 'foreign_ads_args')
            require('1:name=systemd:/system.slice/ls-hubd.service' in found[0]['cgroups']
                    or any(line.split(':', 2)[1:] == ['name=systemd', '/system.slice/ls-hubd.service'] for line in found[0]['cgroups']), 'foreign_ads_cgroup')
            return found[0]
        return None

    def terminate_ads(self, process):
        """Bind SIGTERM to the observed lifetime where kernel pidfds are available."""
        require(process['exe'] == '/usr/sbin/admanager', 'invalid_signal_target')
        require(process['uid'] == 0 and process['argv'] == [b'/usr/sbin/admanager', b'']
                and any(line.split(':', 2)[1:] == ['name=systemd', '/system.slice/ls-hubd.service'] for line in process['cgroups']), 'foreign_ads_identity')
        if hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'):
            try: fd = os.pidfd_open(process['pid'], 0)
            except OSError as error:
                if error.errno not in (errno.ENOSYS, errno.EINVAL): raise
            else:
                try:
                    require(self.same(process), 'process_changed')
                    signal.pidfd_send_signal(fd, signal.SIGTERM)
                finally: os.close(fd)
                return
        require(self.same(process), 'process_changed')
        os.kill(process['pid'], signal.SIGTERM)

    def units(self, group='usage'):
        require(group in UNIT_GROUPS, 'invalid_unit_group')
        result = {}
        for unit, exe in UNIT_GROUPS[group].items():
            p = subprocess.run(['/bin/systemctl', 'show', unit, '--property=ActiveState,MainPID,ControlGroup,FragmentPath,RefuseManualStop,ExecStart'],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3, text=True)
            require(p.returncode == 0 and len(p.stdout) < 8192, 'unit_query_failed')
            fields = dict(line.split('=', 1) for line in p.stdout.splitlines() if '=' in line)
            require(fields.get('FragmentPath') == '/etc/systemd/system/' + unit and fields.get('RefuseManualStop') == 'no', 'unexpected_unit')
            require(('path=' + exe + ' ;') in fields.get('ExecStart', ''), 'unexpected_unit_executable')
            pid = int(fields.get('MainPID', '0')); identity = self.identity(pid) if pid > 1 else None
            require(fields.get('ActiveState') != 'active' or identity is not None, 'unit_process_missing')
            if identity:
                require(identity['exe'] == exe and identity['uid'] == 0 and fields.get('ControlGroup') == '/system.slice/' + unit, 'foreign_unit_process')
                require(any(line.split(':', 2)[1:] == ['name=systemd', '/system.slice/' + unit] for line in identity['cgroups']), 'foreign_unit_cgroup')
            result[unit] = {'state': fields.get('ActiveState'), 'process': identity}
        return result

    def unit_action(self, verb, units):
        require(verb in ('start', 'stop') and set(units).issubset(ALL_UNITS) and units, 'invalid_unit_action')
        p = subprocess.run(['/bin/systemctl', '--no-block', verb] + list(units), stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
        require(p.returncode == 0, 'unit_action_failed')

    def is_home(self):
        return self.call('power', {}).get('state') == 'Active' and self.call('foreground', {}).get('appId') == HOME

    def same(self, process):
        current = self.identity(process['pid'])
        return current is not None and all(current[k] == process[k] for k in ('birth', 'exe', 'argv', 'uid', 'cgroups'))

    def hdmi_in_use(self, key):
        require(re.fullmatch(r'hdmi[1-4]', key), 'invalid_hdmi_key')
        value = self.call('video', {})
        videos, clients = value.get('video'), value.get('clients')
        require(isinstance(videos, list) and isinstance(clients, list)
                and all(isinstance(v, dict) for v in videos + clients), 'invalid_video_status')
        active_clients = [v for v in clients if v.get('activation') is True and v.get('sourceName') == 'HDMI']
        def native_fullscreen(entry):
            owner = entry.get('appId')
            return (isinstance(owner, str) and re.fullmatch(r'com\.webos\.app\.hdmi[1-4]', owner)
                    and entry.get('fullScreen') is True and not any(
                        c.get('appId') == HOME and c.get('clientId') == entry.get('context') for c in active_clients))
        for entry in videos:
            # A native fullscreen input can remain underneath the cached menu.
            # It is the selected app we intend to close, not Home's live preview.
            if native_fullscreen(entry): continue
            matching_client = any(v.get('clientId') == entry.get('context') for v in active_clients)
            if entry.get('connected') is True and entry.get('connectedSource') == 'HDMI' and not (
                    isinstance(entry.get('contentType'), str) and re.fullmatch(r'hdmi[1-4]', entry['contentType'])):
                return True
            if entry.get('contentType') == key and (matching_client or
                    (entry.get('connected') is True and entry.get('connectedSource') == 'HDMI')):
                return True
        # During pipeline setup the native client may exist before its port is
        # reported. Defer every HDMI close until that ambiguity is resolved.
        for client in active_clients:
            matching = [v for v in videos if v.get('context') == client.get('clientId')]
            if matching and all(native_fullscreen(v) and v.get('appId') == client.get('appId') for v in matching): continue
            if not matching or not all(isinstance(v.get('contentType'), str) and re.fullmatch(r'hdmi[1-4]', v['contentType']) for v in matching):
                return True
        return False

class Manager:
    """Runs inside the existing capture helper; all closes are fresh Home-only checks."""
    def __init__(self, stop, store=None, native=None, clock=time.monotonic):
        self.stop = stop; self.store = store or Store(); self.native = native or Native(); self.clock = clock
        self.states = {}; self.attempted = {}; self.attempt_times = {}; self.paused = set(); self.last_revision = None; self.last_enabled = {}
        self.restore_starts = {}
        self.last_app = None; self.home_since = 0; self.policy_checked = {}; self.last_status = {'state': 'managed'}
        self.away_lease = None
        with self.store.locked():
            c = self.store.config(); self.store.write('background.json', c)

    def mark(self, key, status, enabled):
        self.states[key] = {'status': status, 'enabled': enabled}
        if key == 'home': self.last_status = {'state': status, 'updatedAt': int(time.time())}

    def fresh(self, key, revision):
        with self.store.locked():
            c = self.store.config()
            leased = 'app' in ITEMS[key] and ITEMS[key]['app'] in self.store.leases()
        return not self.stop.is_set() and c['revision'] == revision and c['enabled'][key] and not leased

    def save_original(self, key, value, revision):
        with self.store.locked():
            c = self.store.config()
            require(c['revision'] == revision and c['enabled'][key], 'choice_changed')
            if key not in c['saved']:
                c['saved'][key] = value; self.store.write('background.json', c)
        return c['saved'][key]

    def ensure_policy(self, key, c):
        if key not in c['saved']:
            entry = self.native.policies().get(ITEMS[key]['app'])
            require(entry is not None and type(entry.get('isEnabled')) is bool, 'policy_missing')
            self.save_original(key, {'enabled': entry['isEnabled'], 'permanentRestore': False}, c['revision'])
        if key not in self.policy_checked or self.clock() - self.policy_checked[key] > 60:
            require(self.fresh(key, c['revision']), 'choice_changed')
            self.native.preload(key, False)
            self.policy_checked[key] = self.clock()

    def permit_restore_start(self, key):
        attempts = self.restore_starts.get(key, 0)
        require(attempts < 3, 'restore_restart_loop')
        self.restore_starts[key] = attempts + 1

    def restore_one(self, key, saved):
        if 'app' in ITEMS[key]:
            self.native.preload(key, saved['enabled'], saved['permanentRestore'])
        elif key in UNIT_GROUPS:
            states = self.native.units(key)
            if any(saved[unit] and states[unit]['state'] in ('activating', 'deactivating') for unit in UNIT_GROUPS[key]): return False
            required = [unit for unit in UNIT_GROUPS[key] if saved[unit] and states[unit]['state'] != 'active']
            if required:
                self.permit_restore_start(key)
                self.native.unit_action('start', required); return False
        elif saved['active'] and self.native.ads() is None:
            self.permit_restore_start(key)
            self.native.call('ads_start', {}); return False
        return True

    def restore_disabled(self, c):
        for key, saved in list(c['saved'].items()):
            if c['enabled'][key]: continue
            self.mark(key, 'Restoring', False)
            try:
                with self.store.locked():
                    current = self.store.config()
                    # Serialize the native restoration against a new UI choice.
                    if current['revision'] != c['revision'] or current['enabled'][key] or current['saved'].get(key) != saved: continue
                    if not self.restore_one(key, saved): continue
                    del current['saved'][key]; self.store.write('background.json', current)
                self.mark(key, 'Allowed', False)
                self.restore_starts.pop(key, None)
            except (ControlError, OSError, ValueError, subprocess.TimeoutExpired) as error:
                status = 'Restore paused — choose Keep closed, then Allow' if isinstance(error, ControlError) and str(error) == 'restore_restart_loop' else 'Could not restore — try Allow again'
                self.mark(key, status, False)

    def permitted_attempt(self, key, identity):
        if key in self.paused:
            self.mark(key, 'Automatic restarts — control paused', True); return False
        if self.attempted.get(key) == identity: return False
        times = [t for t in self.attempt_times.get(key, []) if self.clock() - t < 60]
        if len(times) >= 3:
            self.paused.add(key)
            self.mark(key, 'Automatic restarts — control paused', True)
            return False
        self.attempted[key] = identity; self.attempt_times[key] = times + [self.clock()]
        return True

    def close_app(self, key, c, rows):
        self.ensure_policy(key, c)
        process = self.native.app_process(key, rows)
        if process is None: self.mark(key, 'Stopped', True); return
        if process['age'] < 3 or not self.fresh(key, c['revision']): self.mark(key, 'Launch allowed', True); return
        hdmi = re.fullmatch(r'hdmi[1-4]', key) is not None
        if hdmi and self.native.hdmi_in_use(key): self.mark(key, 'Live preview — kept running', True); return
        require(self.native.is_home() and self.fresh(key, c['revision']) and self.native.same(process), 'return_changed')
        if hdmi:
            if self.native.hdmi_in_use(key): self.mark(key, 'Live preview — kept running', True); return
            require(self.native.is_home() and self.fresh(key, c['revision']) and self.native.same(process), 'return_changed')
        identity = (process['pid'], process['birth'])
        if not self.permitted_attempt(key, identity):
            if self.states.get(key, {}).get('status') != 'Automatic restarts — control paused': self.mark(key, 'Waiting for app to close', True)
            return
        self.native.call('close', {'processId': str(process['pid'])})
        self.mark(key, 'Closing', True)

    def close_privacy(self, key, c):
        if key in UNIT_GROUPS:
            units = self.native.units(key)
            if key not in c['saved']:
                self.save_original(key, {unit: v['state'] in ('active', 'activating') for unit, v in units.items()}, c['revision'])
            if all(v['state'] in ('inactive', 'failed') and v['process'] is None for v in units.values()): self.mark(key, 'Stopped', True); return
            if any(v['state'] == 'deactivating' for v in units.values()): self.mark(key, 'Stopping', True); return
            identity = tuple((v['process']['pid'], v['process']['birth']) if v['process'] else v['state'] for v in units.values())
            if not self.permitted_attempt(key, identity): return
            require(self.native.is_home() and self.fresh(key, c['revision']), 'return_changed')
            again = self.native.units(key)
            require(all(again[u]['state'] == units[u]['state'] and
                        all((again[u]['process'] or {}).get(k) == (units[u]['process'] or {}).get(k)
                            for k in ('pid', 'birth', 'exe', 'argv', 'uid', 'cgroups')) for u in UNIT_GROUPS[key]), 'unit_changed')
            require(self.native.is_home() and self.fresh(key, c['revision']), 'return_changed')
            self.native.unit_action('stop', list(reversed(UNIT_GROUPS[key])))
        else:
            process = self.native.ads()
            if key not in c['saved']: self.save_original(key, {'active': process is not None}, c['revision'])
            if process is None: self.mark(key, 'Stopped', True); return
            if process['age'] < 3: self.mark(key, 'Waiting for service', True); return
            if not self.permitted_attempt(key, (process['pid'], process['birth'])): return
            require(self.native.is_home() and self.fresh(key, c['revision']) and self.native.same(process), 'return_changed')
            self.native.terminate_ads(process)
        self.mark(key, 'Stopping', True)

    def observe(self, power, foreground):
        c = self.store.config()
        if self.last_revision != c['revision']:
            for key in ITEMS:
                if self.last_enabled.get(key) != c['enabled'][key]:
                    self.attempted.pop(key, None); self.attempt_times.pop(key, None); self.policy_checked.pop(key, None); self.paused.discard(key)
                    self.restore_starts.pop(key, None)
            self.last_revision = c['revision']; self.last_enabled = dict(c['enabled'])
        active = power.get('returnValue') is True and power.get('state') == 'Active'
        app = foreground.get('appId') if foreground.get('returnValue') is True else None
        if app is not None and app != self.last_app:
            if app == HOME:
                if self.away_lease is not None and self.away_lease[0] == self.last_app:
                    self.store.finish_observed_visit(*self.away_lease)
                self.away_lease = None
                self.home_since = self.clock(); self.attempted.clear(); self.attempt_times.clear(); self.paused.clear()
            self.last_app = app
        if app in APPS and active:
            with self.store.locked(): expiry = self.store.leases().get(app)
            self.away_lease = (app, expiry) if expiry is not None else None
        elif app not in (HOME, None):
            self.away_lease = None
        self.restore_disabled(c)
        rows = None
        for key in ITEMS:
            if not c['enabled'][key]:
                if key not in c['saved']: self.mark(key, 'Allowed', False)
                continue
            if not active or app != HOME or self.clock() - self.home_since < 1.5:
                self.mark(key, 'Runs until Home returns' if app != HOME else 'Waiting for Home', True); continue
            if self.stop.is_set(): break
            try:
                if 'app' in ITEMS[key]:
                    if rows is None: rows = self.native.call('running', {}).get('running', [])
                    self.close_app(key, c, rows)
                else: self.close_privacy(key, c)
            except (ControlError, OSError, ValueError, TypeError, subprocess.TimeoutExpired):
                self.mark(key, 'Could not apply — check again', True)
        self.store.write('state.json', {'boot': self.store.boot, 'at': self.clock(), 'items': self.states, 'pid': os.getpid()}, True)

    def shutdown(self):
        self.store.write('state.json', {'boot': self.store.boot, 'at': 0, 'items': self.states}, True)
        self.store.close()

def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    store = None
    try:
        require(os.geteuid() == 0, 'root_required')
        require(args and args[0] in ('get', 'set', 'prepare', 'restore', 'remote-get', 'remote-set'), 'invalid_command')
        if args[0] != 'restore': checked_app()
        store = Store()
        if args == ['get']: result = store.public()
        elif args == ['remote-get']: result = store.remote_state()
        elif len(args) == 3 and args[0] == 'remote-set':
            require(args[1] in ('custom', 'stock') and re.fullmatch(r'0|[1-9][0-9]{0,9}', args[2]), 'invalid_arguments')
            result = store.set_remote_home(args[1], int(args[2]))
        elif len(args) == 4 and args[0] == 'set':
            require(args[1] in ITEMS and args[2] in ('0', '1') and re.fullmatch(r'0|[1-9][0-9]{0,9}', args[3]), 'invalid_arguments')
            result = store.set_choice(args[1], args[2] == '1', int(args[3]))
        elif len(args) == 2 and args[0] == 'prepare': result = store.prepare(args[1])
        elif args == ['restore']:
            with store.locked():
                c = store.config(); require(c['revision'] < 1000000000, 'revision_limit')
                c['enabled'] = {k: False for k in ITEMS}; c['revision'] += 1; store.write('background.json', c)
            import threading
            manager = Manager(threading.Event(), store=store)
            for _ in range(6):
                c = store.config(); manager.restore_disabled(c)
                if not store.config()['saved']: break
                time.sleep(.5)
            require(not store.config()['saved'], 'restore_not_confirmed')
            result = {'returnValue': True, 'restored': True}
        else: raise ControlError('invalid_arguments')
        print(json.dumps(result, separators=(',', ':'))); return 0
    except (ControlError, OSError, ValueError, TypeError, subprocess.TimeoutExpired) as e:
        code = str(e) if isinstance(e, ControlError) else 'local_operation_failed'
        messages = {'home_mapping_requires_custom': 'Choose this menu for the Home button before keeping LG Home closed.',
                    'other_home_mapping': 'A different Home app is assigned. Its mapping was left unchanged.'}
        print(json.dumps({'returnValue': False, 'errorCode': code, 'message': messages.get(code, 'The setting could not be completed. Refresh its current state.')})); return 2
    finally:
        if store is not None: store.close()

if __name__ == '__main__': raise SystemExit(main())
