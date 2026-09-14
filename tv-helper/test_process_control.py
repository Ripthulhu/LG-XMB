# SPDX-License-Identifier: GPL-3.0-or-later
import copy
import errno
import io
import json
import signal
import stat
import threading
import unittest
from contextlib import contextmanager, redirect_stdout
from types import SimpleNamespace
from pathlib import Path, PurePosixPath
from unittest.mock import patch

import process_control as pc


def legacy_config():
    value = pc.default_config()
    value['enabled']['home'] = True
    value['saved']['home'] = {'enabled': True, 'permanentRestore': True}
    return value


class AppMetadataFixture:
    """Descriptor-level app tree with LG's writable boot modes, no real chmod."""
    def __init__(self):
        self.raw = (Path(__file__).resolve().parent.parent / 'app/appinfo.json').read_bytes()
        self.bindings = {}; self.inodes = {}; self.descriptors = {}; self.next_fd = 100
        self.changes = []; self.opened = []; self.closed = []; self.missing = set(); self.symlinks = set()
        self.on_read = None; self.on_chmod = None; self.read_count = 0
        for path in ['/', '/media', '/media/developer', '/media/developer/apps', '/media/developer/apps/usr',
                     '/media/developer/apps/usr/palm', '/media/developer/apps/usr/palm/applications',
                     str(PurePosixPath(pc.APPINFO).parent), pc.APPINFO]:
            inode = len(self.bindings) + 1; self.bindings[path] = inode
            self.inodes[inode] = {'path': path, 'mode': (stat.S_IFREG if path == pc.APPINFO else stat.S_IFDIR) | (0o755 if path in ('/', '/media') else 0o777), 'uid': 0, 'nlink': 1}
    def path_for(self, name, dir_fd=None): return str(PurePosixPath(self.inodes[self.descriptors[dir_fd]]['path']) / name) if dir_fd else name
    def open(self, name, flags, dir_fd=None):
        path = self.path_for(name, dir_fd); self.opened.append((path, flags))
        if path in self.missing: raise FileNotFoundError(path)
        if path in self.symlinks: raise OSError(errno.ELOOP, 'symlink')
        self.next_fd += 1; self.descriptors[self.next_fd] = self.bindings[path]; return self.next_fd
    def metadata(self, inode):
        entry = self.inodes[inode]
        return SimpleNamespace(st_mode=entry['mode'], st_uid=entry['uid'], st_nlink=entry['nlink'], st_dev=1, st_ino=inode)
    def fstat(self, fd): return self.metadata(self.descriptors[fd])
    def stat(self, name, dir_fd=None, follow_symlinks=False): return self.metadata(self.bindings[self.path_for(name, dir_fd)])
    def read(self, fd, maximum):
        raw = self.raw; self.read_count += 1
        if self.on_read: self.on_read(self.read_count)
        return raw[:maximum]
    def chmod(self, fd, mode):
        entry = self.inodes[self.descriptors[fd]]; entry['mode'] = stat.S_IFMT(entry['mode']) | mode; self.changes.append((entry['path'], mode))
        if self.on_chmod: self.on_chmod()
    def set_mode(self, path, mode):
        entry = self.inodes[self.bindings[path]]; entry['mode'] = stat.S_IFMT(entry['mode']) | mode
    @contextmanager
    def patched(self):
        fcntl = SimpleNamespace(LOCK_EX=2, LOCK_NB=4, flock=lambda *args: None)
        with patch.dict('sys.modules', {'fcntl': fcntl}), patch.object(pc, 'Path', PurePosixPath), \
             patch.object(pc.os, 'O_DIRECTORY', 16, create=True), patch.object(pc.os, 'O_NOFOLLOW', 8, create=True), \
             patch.object(pc.os, 'open', side_effect=self.open), patch.object(pc.os, 'fstat', side_effect=self.fstat), \
             patch.object(pc.os, 'stat', side_effect=self.stat), patch.object(pc.os, 'lseek', return_value=0), \
             patch.object(pc.os, 'read', side_effect=self.read), patch.object(pc.os, 'fchmod', side_effect=self.chmod, create=True), \
             patch.object(pc.os, 'close', side_effect=lambda fd: self.closed.append(fd)):
            yield


class Clock:
    def __init__(self): self.now = 100.0
    def __call__(self): return self.now
    def advance(self, seconds): self.now += seconds


class FakeStore(pc.Store):
    def __init__(self, config=None):
        self.boot = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
        self.data = {'background.json': copy.deepcopy(config or legacy_config())}
        self.depth = 0; self.closed = False; self.reject_write = False
    @contextmanager
    def locked(self):
        self.depth += 1
        try: yield
        finally: self.depth -= 1
    def read(self, name, runtime=False, default=None): return copy.deepcopy(self.data.get(name, default))
    def write(self, name, value, runtime=False):
        if self.reject_write and name == 'background.json': raise OSError('simulated disk failure')
        self.data[name] = copy.deepcopy(value)
    def close(self): self.closed = True


def process(pid, exe, app=None, birth=None):
    cgroup = '/system.slice/ls-hubd.service' if exe == '/usr/sbin/admanager' else '/' + (app or 'unit')
    return {'pid': pid, 'birth': pid * 10 if birth is None else birth, 'exe': exe,
            'argv': [exe.encode(), b''], 'cgroups': ['3:memory:' + cgroup, '1:name=systemd:' + cgroup], 'uid': 0, 'age': 20}


class FakeNative(pc.Native):
    def __init__(self):
        self.home = True; self.actions = []; self.check_same = True
        self.entries = {v['app']: {'id': v['app'], 'isEnabled': k != 'home', 'isAllowed': True} for k, v in pc.ITEMS.items() if 'app' in v}
        self.processes = {}; self.unit_reads = 0; self.on_units = None; self.on_preload = None
        self.unit_states = {u: {'state': 'active', 'process': process(100 + i, e)} for i, (u, e) in enumerate(pc.ALL_UNITS.items())}
        self.ad_process = None
        self.live_ports = set(); self.on_video = None; self.video_reads = 0
        self.route = {'defaultApps': {'home': pc.HOME, 'MembershipApp': 'com.webos.app.overlaymembership'}, 'lastAppHandlerPolicy': 'idleApp'}
    def policies(self): return copy.deepcopy(self.entries)
    def preload(self, key, enabled, permanent=False):
        if self.on_preload: self.on_preload()
        self.actions.append(('preload', key, enabled, permanent)); self.entries[pc.ITEMS[key]['app']]['isEnabled'] = enabled
    def identity(self, pid): return copy.deepcopy(self.processes.get(pid))
    def call(self, key, payload):
        if key == 'running':
            return {'returnValue': True, 'running': [{'id': app, 'processid': str(p['pid'])} for app, p in self.apps.items()]}
        if key == 'home_settings': return {'returnValue': True, 'settings': copy.deepcopy(self.route)}
        if key == 'home_mapping': self.route['defaultApps']['home'] = payload['appId']
        self.actions.append((key, copy.deepcopy(payload))); return {'returnValue': True}
    @property
    def apps(self):
        return {app: p for p in self.processes.values() for app in pc.APPS if any(x.endswith(':' + '/' + app) for x in p['cgroups'])}
    def units(self, group='usage'):
        self.unit_reads += 1
        if self.on_units: self.on_units(self.unit_reads)
        return {u: copy.deepcopy(self.unit_states[u]) for u in pc.UNIT_GROUPS[group]}
    def unit_action(self, verb, units):
        self.actions.append((verb, tuple(units)))
        for unit in units: self.unit_states[unit]['state'] = 'activating' if verb == 'start' else 'deactivating'
    def ads(self): return copy.deepcopy(self.ad_process)
    def terminate_ads(self, p): self.actions.append(('term', p['pid'], p['birth']))
    def is_home(self): return self.home
    def same(self, p): return self.check_same
    def hdmi_in_use(self, key):
        self.video_reads += 1
        if self.on_video: self.on_video(self.video_reads)
        return key in self.live_ports


class ProcessControlTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock(); self.time_patch = patch.object(pc.time, 'monotonic', self.clock); self.time_patch.start()
        self.store = FakeStore(); self.native = FakeNative(); self.stop = threading.Event()
        self.manager = pc.Manager(self.stop, self.store, self.native, self.clock)
    def tearDown(self): self.time_patch.stop()
    def choose(self, key, enabled=True):
        value = self.store.config(); value['enabled'][key] = enabled; value['revision'] += 1; self.store.write('background.json', value)
    def quiet_defaults(self):
        value = self.store.config(); value['enabled']['home'] = False; value['saved'] = {}; self.store.write('background.json', value)
    def observe(self, app=pc.HOME, active=True, valid=True):
        self.manager.observe({'returnValue': True, 'state': 'Active' if active else 'Standby'}, {'returnValue': valid, 'appId': app})
    def ready(self): self.observe(); self.clock.advance(2); self.observe()
    def add_app(self, key, pid=4321, birth=None):
        item = pc.ITEMS[key]; p = process(pid, item['exe'], item['app'], birth)
        if key == 'home': p['argv'] = [b'/usr/bin/flutter-client', b'-i', item['app'].encode(), b'']
        self.native.processes[pid] = p; return p

    def test_fresh_defaults_allow_everything_without_invented_rollback_values(self):
        self.assertEqual([k for k, v in pc.default_config()['enabled'].items() if v], [])
        self.assertEqual(pc.default_config()['saved'], {})
        self.assertNotIn('familycare', pc.ITEMS)
        self.assertFalse(pc.default_config()['enabled']['ads']); self.assertFalse(pc.default_config()['enabled']['usage'])
        for key in ('voice', 'hdmi1', 'hdmi2'): self.assertFalse(pc.default_config()['enabled'][key])

    def test_old_eight_item_config_migrates_without_changing_choices_or_baselines(self):
        old = pc.default_config(); old['enabled'] = {k: k in ('home', 'usage') for k in pc.ORIGINAL_ITEMS}; old['revision'] = 7
        old['saved']['usage'] = {u: True for u in pc.UNITS}; original = copy.deepcopy(old)
        migrated = pc.valid_config(old)
        self.assertEqual(old, original); self.assertEqual(migrated['revision'], 7); self.assertEqual(migrated['saved'], original['saved'])
        self.assertEqual({k: migrated['enabled'][k] for k in pc.ORIGINAL_ITEMS}, original['enabled'])
        self.assertEqual({k: migrated['enabled'][k] for k in ('voice', 'hdmi1', 'hdmi2')}, {'voice': False, 'hdmi1': False, 'hdmi2': False})

    def test_migration_rejects_missing_old_key_unknown_control_or_foreign_voice_unit(self):
        for mutation in ('missing', 'foreign', 'foreign_unit'):
            value = pc.default_config()
            if mutation == 'missing': del value['enabled']['home']
            elif mutation == 'foreign': value['enabled']['audio'] = True
            else: value['saved']['voice'] = {'ls-hubd.service': True}
            with self.subTest(mutation=mutation), self.assertRaises(pc.ControlError): pc.valid_config(value)

    def test_voice_control_stops_and_restores_only_conductor(self):
        self.quiet_defaults(); self.choose('voice'); self.ready()
        self.assertEqual([a for a in self.native.actions if a[0] == 'stop'], [('stop', ('voiceconductor.service',))])
        self.assertEqual(self.store.config()['saved']['voice'], {'voiceconductor.service': True})
        self.native.unit_states['voiceconductor.service'] = {'state': 'inactive', 'process': None}; self.choose('voice', False); self.observe()
        self.assertEqual([a for a in self.native.actions if a[0] == 'start'], [('start', ('voiceconductor.service',))])

    def test_inactive_voice_baseline_is_not_started_on_allow(self):
        self.quiet_defaults(); self.choose('voice'); self.native.unit_states['voiceconductor.service'] = {'state': 'inactive', 'process': None}
        self.ready(); self.choose('voice', False); self.observe()
        self.assertEqual([a for a in self.native.actions if a[0] in ('start', 'stop')], [])

    def test_all_hdmi_ports_keep_live_preview_then_close_same_lifetime_after_release(self):
        self.quiet_defaults()
        for port in range(1, 5):
            key = 'hdmi%d' % port; self.choose(key); self.add_app(key, pid=4300 + port); self.native.live_ports.add(key)
        self.ready(); self.assertNotIn('close', [a[0] for a in self.native.actions])
        for port in range(1, 5): self.assertEqual(self.manager.states['hdmi%d' % port]['status'], 'Live preview — kept running')
        self.native.live_ports.clear(); self.observe()
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'close']), 4)

    def test_preview_started_during_final_check_does_not_consume_close_lifetime(self):
        self.quiet_defaults(); self.choose('hdmi1'); self.add_app('hdmi1')
        def start(read):
            if read == 2: self.native.live_ports.add('hdmi1')
        self.native.on_video = start; self.ready(); self.assertNotIn('close', [a[0] for a in self.native.actions])
        self.native.on_video = None; self.native.live_ports.clear(); self.observe()
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'close']), 1)

    def test_bad_native_video_status_never_closes_input(self):
        self.quiet_defaults(); self.choose('hdmi2'); self.add_app('hdmi2')
        with patch.object(self.native, 'hdmi_in_use', side_effect=pc.ControlError('invalid_video_status')): self.ready()
        self.assertNotIn('close', [a[0] for a in self.native.actions])

    def test_choice_revision_compare_and_swap_preserves_original(self):
        self.store.set_choice('browser', True, 0)
        with self.assertRaisesRegex(pc.ControlError, 'stale_revision'): self.store.set_choice('ads', True, 0)
        self.assertTrue(self.store.config()['enabled']['browser']); self.assertFalse(self.store.config()['enabled']['ads'])
        self.assertEqual(self.store.config()['revision'], 1)

    def test_choice_no_change_keeps_revision(self):
        self.store.set_choice('ads', False, 0); self.assertEqual(self.store.config()['revision'], 0)

    def test_remote_get_reports_actual_assignment_without_changing_choices(self):
        original = self.store.config()
        for app, expected in ((pc.HOME, 'custom'), (pc.ITEMS['home']['app'], 'stock'), ('other.home', 'other')):
            self.native.route['defaultApps']['home'] = app
            result = self.store.remote_state(self.native)
            self.assertEqual(result['home'], expected); self.assertEqual(result['revision'], original['revision'])
            self.assertTrue(result['homeKeepClosed']); self.assertNotIn(app, str(result))
        del self.native.route['defaultApps']['home']
        self.assertEqual(self.store.remote_state(self.native)['home'], 'stock')
        self.assertEqual(self.store.config(), original); self.assertEqual(self.native.actions, [])

    def test_stock_mapping_allows_only_home_and_restores_its_saved_baseline_first(self):
        c = self.store.config(); c['revision'] = 38; c['enabled'] = {k: k != 'hdmi1' for k in pc.ITEMS}
        c['saved']['usage'] = {u: True for u in pc.UNITS}; self.store.write('background.json', c)
        result = self.store.set_remote_home('stock', 38, self.native)
        after = self.store.config()
        self.assertEqual(result['home'], 'stock'); self.assertFalse(result['homeKeepClosed']); self.assertEqual(result['revision'], 39)
        self.assertEqual({k: v for k, v in after['enabled'].items() if k != 'home'}, {k: v for k, v in c['enabled'].items() if k != 'home'})
        self.assertEqual(after['saved'], {k: v for k, v in c['saved'].items() if k != 'home'})
        self.assertEqual(self.native.actions, [('preload', 'home', True, True), ('home_mapping', {'category': 'home', 'appId': pc.ITEMS['home']['app']})])

    def test_custom_mapping_preserves_every_background_choice_and_baseline(self):
        self.native.route['defaultApps']['home'] = pc.ITEMS['home']['app']; original = self.store.config()
        result = self.store.set_remote_home('custom', 0, self.native)
        self.assertEqual(result['home'], 'custom'); self.assertEqual(result['revision'], 1)
        after = self.store.config(); self.assertEqual(after['enabled'], original['enabled']); self.assertEqual(after['saved'], original['saved'])
        self.assertEqual(self.native.actions, [('home_mapping', {'category': 'home', 'appId': pc.HOME})])

    def test_remote_no_change_is_read_only_and_keeps_revision(self):
        original = self.store.config(); result = self.store.set_remote_home('custom', 0, self.native)
        self.assertEqual(result['revision'], 0); self.assertEqual(self.store.config(), original); self.assertEqual(self.native.actions, [])

    def test_stock_no_change_still_repairs_pending_home_allow_state(self):
        self.native.route['defaultApps']['home'] = pc.ITEMS['home']['app']
        self.store.set_remote_home('stock', 0, self.native)
        self.assertFalse(self.store.config()['enabled']['home']); self.assertNotIn('home', self.store.config()['saved'])
        self.assertEqual(self.native.actions, [('preload', 'home', True, True)])

    def test_remote_stale_revision_or_exhaustion_never_changes_native_state(self):
        original = self.store.config()
        with self.assertRaisesRegex(pc.ControlError, 'stale_revision'): self.store.set_remote_home('stock', 1, self.native)
        self.assertEqual(self.store.config(), original)
        original['revision'] = 1000000000; self.store.write('background.json', original)
        with self.assertRaisesRegex(pc.ControlError, 'revision_limit'): self.store.set_remote_home('stock', 1000000000, self.native)
        self.assertEqual(self.store.config(), original); self.assertEqual(self.native.actions, [])

    def test_foreign_home_mapping_cannot_be_overwritten_or_change_background_choices(self):
        self.native.route['defaultApps']['home'] = 'other.home'; original = self.store.config()
        for target in ('custom', 'stock'):
            with self.subTest(target=target), self.assertRaisesRegex(pc.ControlError, 'other_home_mapping'):
                self.store.set_remote_home(target, 0, self.native)
        self.assertEqual(self.store.config(), original); self.assertEqual(self.native.actions, [])

    def test_failed_config_write_prevents_preload_and_mapping_changes(self):
        self.store.reject_write = True
        with self.assertRaises(OSError): self.store.set_remote_home('stock', 0, self.native)
        self.assertTrue(self.store.config()['enabled']['home']); self.assertEqual(self.native.actions, [])

    def test_failed_preload_restore_keeps_home_allowed_and_saved_for_retry(self):
        self.native.on_preload = lambda: (_ for _ in ()).throw(pc.ControlError('policy_not_confirmed'))
        with self.assertRaisesRegex(pc.ControlError, 'policy_not_confirmed'): self.store.set_remote_home('stock', 0, self.native)
        c = self.store.config(); self.assertEqual(c['revision'], 1); self.assertFalse(c['enabled']['home'])
        self.assertEqual(c['saved']['home'], {'enabled': True, 'permanentRestore': True})
        self.assertEqual(self.native.route['defaultApps']['home'], pc.HOME); self.assertEqual(self.native.actions, [])
        self.native.on_preload = None
        self.assertEqual(self.store.set_remote_home('stock', 1, self.native)['home'], 'stock')

    def test_native_mapping_race_is_not_overwritten_after_preload_restore(self):
        self.native.on_preload = lambda: self.native.route['defaultApps'].update({'Music': 'other.music'})
        with self.assertRaisesRegex(pc.ControlError, 'home_mapping_changed'): self.store.set_remote_home('stock', 0, self.native)
        self.assertEqual(self.native.route['defaultApps']['Music'], 'other.music')
        self.assertEqual(self.native.route['defaultApps']['home'], pc.HOME)
        self.assertFalse(self.store.config()['enabled']['home']); self.assertNotIn('home', self.store.config()['saved'])
        self.assertNotIn('home_mapping', [a[0] for a in self.native.actions])

    def test_unconfirmed_mapping_returns_error_without_reenabling_home_closure(self):
        original = self.native.call
        def wrong(key, payload):
            result = original(key, payload)
            if key == 'home_mapping': self.native.route['lastAppHandlerPolicy'] = 'changed'
            return result
        with patch.object(self.native, 'call', side_effect=wrong), self.assertRaisesRegex(pc.ControlError, 'home_mapping_not_confirmed'):
            self.store.set_remote_home('stock', 0, self.native)
        self.assertFalse(self.store.config()['enabled']['home'])

    def test_stock_mapping_restores_disabled_baseline_without_enabling_preload(self):
        c = self.store.config(); c['saved']['home'] = {'enabled': False, 'permanentRestore': False}; self.store.write('background.json', c)
        self.store.set_remote_home('stock', 0, self.native)
        self.assertEqual(self.native.actions[0], ('preload', 'home', False, False))

    def test_home_keep_closed_requires_actual_custom_home_assignment(self):
        self.quiet_defaults(); original = self.store.config()
        for target in ('com.webos.app.home', 'other.home'):
            self.native.route['defaultApps']['home'] = target
            with self.subTest(target=target), self.assertRaisesRegex(pc.ControlError, 'home_mapping_requires_custom'):
                self.store.set_choice('home', True, 0, self.native)
        self.assertEqual(self.store.config(), original)
        self.native.route['defaultApps']['home'] = pc.HOME
        self.store.set_choice('home', True, 0, self.native); self.assertTrue(self.store.config()['enabled']['home'])

    def test_malformed_native_home_settings_are_rejected(self):
        native = pc.Native()
        for value in (None, [], {}, {'defaultApps': []}, {'defaultApps': {'home': None}, 'lastAppHandlerPolicy': 'idleApp'}, {'defaultApps': {}, 'lastAppHandlerPolicy': 3}):
            with self.subTest(value=value), patch.object(native, 'call', return_value={'settings': value}), self.assertRaises(pc.ControlError):
                native.home_settings()

    def test_remote_targets_are_fixed_before_any_native_operation(self):
        for target in ('other.home', 'stock; anything', '', None):
            with self.subTest(target=target), self.assertRaises(pc.ControlError): self.store.set_remote_home(target, 0, self.native)
        self.assertEqual(self.native.actions, [])

    def test_mapping_and_home_restore_are_serialized_against_new_choices(self):
        observed = []
        self.native.on_preload = lambda: observed.append(('preload', self.store.depth, self.store.config()['enabled']['home']))
        call = self.native.call
        def locked_call(key, payload):
            if key == 'home_mapping': observed.append(('mapping', self.store.depth, self.store.config()['enabled']['home']))
            return call(key, payload)
        with patch.object(self.native, 'call', side_effect=locked_call): self.store.set_remote_home('stock', 0, self.native)
        self.assertEqual(observed, [('preload', 1, False), ('mapping', 1, False)])

    def test_remote_cli_get_and_set_use_authoritative_fixed_contract(self):
        for command, expected in ((['remote-get'], 'custom'), (['remote-set', 'stock', '0'], 'stock')):
            with patch.object(pc.os, 'geteuid', return_value=0, create=True), patch.object(pc, 'Store', return_value=self.store), \
                 patch.object(pc, 'Native', return_value=self.native), patch.object(pc, 'checked_app', return_value=True) as checked, \
                 redirect_stdout(io.StringIO()) as output:
                self.assertEqual(pc.main(command), 0)
            result = json.loads(output.getvalue()); self.assertTrue(result['returnValue']); self.assertEqual(result['home'], expected)
            checked.assert_called_once_with(); self.assertTrue(self.store.closed)

    def test_remote_cli_rejects_injected_targets_extra_args_and_bad_revisions(self):
        for args in (['remote-set', 'stock; reboot', '0'], ['remote-set', 'stock', '0', 'anything'], ['remote-set', 'stock', '-1'], ['remote-set', 'stock', '1000000001'], ['remote-get', 'anything']):
            with self.subTest(args=args), patch.object(pc.os, 'geteuid', return_value=0, create=True), \
                 patch.object(pc, 'Store', return_value=self.store), patch.object(pc, 'Native', return_value=self.native), \
                 patch.object(pc, 'checked_app', return_value=True), redirect_stdout(io.StringIO()) as output:
                self.assertEqual(pc.main(args), 2)
            self.assertFalse(json.loads(output.getvalue())['returnValue'])
        self.assertEqual(self.native.actions, []); self.assertEqual(self.store.config()['revision'], 0)

    def test_remote_cli_checks_installed_trusted_app_before_accessing_store(self):
        with patch.object(pc.os, 'geteuid', return_value=0, create=True), patch.object(pc, 'Store') as store, \
             patch.object(pc, 'checked_app', side_effect=pc.ControlError('untrusted_app_manifest')), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(pc.main(['remote-get']), 2)
        store.assert_not_called(); self.assertEqual(json.loads(output.getvalue())['errorCode'], 'untrusted_app_manifest')

    def test_exhausted_revision_never_writes_invalid_config(self):
        value = self.store.config(); value['revision'] = 1000000000; self.store.write('background.json', value)
        with self.assertRaisesRegex(pc.ControlError, 'revision_limit'): self.store.set_choice('ads', True, 1000000000)
        self.assertEqual(self.store.config(), value)

    def test_malformed_saved_shape_has_controlled_error(self):
        for bad in (None, ['enabled', 'permanentRestore'], 'saved'):
            value = pc.default_config(); value['saved']['browser'] = bad
            with self.subTest(bad=bad), self.assertRaises(pc.ControlError): pc.valid_config(value)

    def test_malformed_runtime_shapes_have_controlled_errors(self):
        for bad in ([], None, 4):
            self.store.data['leases.json'] = bad
            with self.subTest(leases=bad), self.assertRaises(pc.ControlError): self.store.leases()
            self.store.data['state.json'] = bad
            with self.subTest(state=bad), self.assertRaises(pc.ControlError): self.store.public()
        for bad in ([], None, {'ads': []}):
            self.store.data['state.json'] = {'boot': self.store.boot, 'at': self.clock(), 'items': bad}
            with self.subTest(items=bad), self.assertRaises(pc.ControlError): self.store.public()

    def test_prepare_lease_expires_and_ignores_old_boot(self):
        self.store.prepare(pc.ITEMS['browser']['app']); self.assertIn(pc.ITEMS['browser']['app'], self.store.leases())
        self.clock.advance(16); self.assertEqual(self.store.leases(), {})
        self.store.data['leases.json'] = {'boot': 'old', 'items': {pc.ITEMS['browser']['app']: self.clock() + 10}}
        self.assertEqual(self.store.leases(), {})

    def test_lease_prevents_close_during_launch_handoff(self):
        self.quiet_defaults(); self.choose('browser'); self.add_app('browser')
        self.store.prepare(pc.ITEMS['browser']['app']); self.ready()
        self.assertNotIn('close', [x[0] for x in self.native.actions])
        self.clock.advance(16); self.observe(); self.assertIn('close', [x[0] for x in self.native.actions])

    def test_observed_app_visit_clears_its_same_lease_on_return(self):
        self.quiet_defaults(); self.choose('browser'); self.add_app('browser'); app = pc.ITEMS['browser']['app']
        self.store.prepare(app); self.observe(app=app); self.clock.advance(.5); self.observe()
        self.assertNotIn(app, self.store.leases()); self.clock.advance(2); self.observe()
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'close']), 1)
        self.assertLess(self.clock(), 115)

    def test_newer_prepare_lease_survives_an_old_observed_return(self):
        self.quiet_defaults(); self.choose('browser'); self.add_app('browser'); app = pc.ITEMS['browser']['app']
        self.store.prepare(app); self.observe(app=app); self.clock.advance(1); self.store.prepare(app); new_expiry = self.store.leases()[app]
        self.observe(); self.clock.advance(2); self.observe()
        self.assertEqual(self.store.leases()[app], new_expiry)
        self.assertNotIn('close', [a[0] for a in self.native.actions])

    def test_unobserved_other_app_lease_is_not_cleared_on_return(self):
        self.quiet_defaults(); self.choose('hdmi1'); self.add_app('hdmi1'); app = pc.ITEMS['hdmi1']['app']
        self.store.prepare(app); self.observe(app=pc.ITEMS['browser']['app']); self.observe(); self.clock.advance(2); self.observe()
        self.assertIn(app, self.store.leases()); self.assertNotIn('close', [a[0] for a in self.native.actions])

    def test_app_saves_original_disabled_policy_and_restores_it(self):
        self.quiet_defaults(); self.native.entries[pc.ITEMS['browser']['app']]['isEnabled'] = False
        self.choose('browser'); self.ready(); self.choose('browser', False); self.observe()
        self.assertIn(('preload', 'browser', False, False), self.native.actions)
        self.assertNotIn('browser', self.store.config()['saved'])

    def test_restore_preserves_original_usage_inactive_unit(self):
        self.quiet_defaults(); self.choose('usage'); self.native.unit_states['nudge.service'] = {'state': 'inactive', 'process': None}
        self.ready(); self.choose('usage', False)
        self.native.unit_states = {u: {'state': 'inactive', 'process': None} for u in pc.UNITS}; self.observe()
        self.assertIn(('start', ('user-context-manager.service',)), self.native.actions)
        self.assertNotIn(('start', tuple(pc.UNITS)), self.native.actions)

    def test_restore_does_not_reissue_start_while_activating(self):
        self.quiet_defaults(); self.choose('usage'); self.ready(); self.choose('usage', False)
        self.native.unit_states = {u: {'state': 'inactive', 'process': None} for u in pc.UNITS}
        self.observe(); self.observe(); self.observe()
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'start']), 1)

    def test_restore_waits_for_stop_job_then_confirms_new_processes(self):
        self.quiet_defaults(); self.choose('usage'); self.ready(); self.choose('usage', False); self.observe()
        self.assertNotIn('start', [a[0] for a in self.native.actions])
        for u, e in pc.UNITS.items(): self.native.unit_states[u] = {'state': 'active', 'process': process(900, e)}
        self.observe(); self.assertNotIn('usage', self.store.config()['saved'])

    def test_stale_restore_snapshot_cannot_undo_new_choice(self):
        self.quiet_defaults(); self.choose('browser'); self.ready(); self.choose('browser', False)
        stale = self.store.config(); self.choose('browser', True); self.native.actions.clear()
        self.manager.restore_disabled(stale)
        self.assertEqual(self.native.actions, []); self.assertIn('browser', self.store.config()['saved'])

    def test_restoration_native_operation_is_serialized_with_choice(self):
        self.quiet_defaults(); self.choose('browser'); self.ready(); self.choose('browser', False)
        self.native.on_preload = lambda: self.assertGreater(self.store.depth, 0)
        self.observe()

    def test_baseline_save_failure_prevents_privacy_stop(self):
        self.quiet_defaults(); self.choose('usage'); self.store.reject_write = True; self.ready()
        self.assertNotIn('stop', [a[0] for a in self.native.actions])

    def test_fresh_home_check_prevents_stale_app_close(self):
        self.quiet_defaults(); self.choose('browser'); self.add_app('browser'); self.native.home = False; self.ready()
        self.assertNotIn('close', [a[0] for a in self.native.actions])

    def test_reused_app_pid_is_not_closed(self):
        self.quiet_defaults(); self.choose('browser'); self.add_app('browser'); self.native.check_same = False; self.ready()
        self.assertNotIn('close', [a[0] for a in self.native.actions])

    def test_repeated_observations_do_not_close_same_pid_twice(self):
        self.quiet_defaults(); self.choose('browser'); self.add_app('browser'); self.ready()
        for _ in range(6): self.clock.advance(5); self.observe()
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'close']), 1)

    def test_same_pid_new_birth_is_a_distinct_process(self):
        self.quiet_defaults(); self.choose('browser'); self.add_app('browser'); self.ready()
        self.add_app('browser', birth=50000); self.observe()
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'close']), 2)

    def test_privacy_unit_pid_changed_with_equal_birth_is_rejected(self):
        self.quiet_defaults(); self.choose('usage')
        def change(read):
            if read == 2: self.native.unit_states['nudge.service']['process']['pid'] += 1
        self.native.on_units = change; self.ready()
        self.assertNotIn('stop', [a[0] for a in self.native.actions])

    def test_leaving_home_during_unit_lookup_cancels_stop(self):
        self.quiet_defaults(); self.choose('usage')
        def leave(read):
            if read == 2: self.native.home = False
        self.native.on_units = leave; self.ready()
        self.assertNotIn('stop', [a[0] for a in self.native.actions])

    def test_privacy_is_never_stopped_outside_home_or_standby(self):
        self.quiet_defaults(); self.choose('usage'); self.choose('ads'); self.native.ad_process = process(999, '/usr/sbin/admanager')
        self.observe(app='youtube.leanback.v4'); self.clock.advance(10); self.observe(app='youtube.leanback.v4'); self.observe(active=False)
        self.assertEqual(self.native.actions, [])

    def test_ads_one_term_per_lifetime_and_allow_restores_baseline(self):
        self.quiet_defaults(); self.choose('ads'); self.native.ad_process = process(999, '/usr/sbin/admanager'); self.ready(); self.observe()
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'term']), 1)
        self.native.ad_process = None; self.choose('ads', False); self.observe()
        self.assertIn(('ads_start', {}), self.native.actions); self.assertIn('ads', self.store.config()['saved'])
        self.native.ad_process = process(1000, '/usr/sbin/admanager'); self.observe(); self.assertNotIn('ads', self.store.config()['saved'])

    def test_ads_absent_baseline_is_not_started_on_allow(self):
        self.quiet_defaults(); self.choose('ads'); self.ready(); self.choose('ads', False); self.observe()
        self.assertNotIn('ads_start', [a[0] for a in self.native.actions])

    def test_ads_restore_that_never_stays_running_stops_after_three_starts(self):
        self.quiet_defaults(); self.choose('ads'); self.native.ad_process = process(999, '/usr/sbin/admanager'); self.ready()
        self.native.ad_process = None; self.choose('ads', False)
        for _ in range(10): self.observe(); self.clock.advance(30)
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'ads_start']), 3)
        self.assertIn('Restore paused', self.manager.states['ads']['status'])
        self.assertIn('ads', self.store.config()['saved'])

    def test_usage_restore_immediate_failures_have_a_finite_start_budget(self):
        self.quiet_defaults(); self.choose('usage'); self.ready(); self.choose('usage', False)
        for _ in range(7):
            self.native.unit_states = {u: {'state': 'failed', 'process': None} for u in pc.UNITS}
            self.observe()
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'start']), 3)
        self.assertIn('Restore paused', self.manager.states['usage']['status'])

    def test_queued_start_jobs_do_not_consume_restore_retries(self):
        self.quiet_defaults(); self.choose('usage'); self.ready(); self.choose('usage', False)
        self.native.unit_states = {u: {'state': 'inactive', 'process': None} for u in pc.UNITS}; self.observe()
        for _ in range(8): self.observe()
        self.assertEqual(self.manager.restore_starts['usage'], 1)
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'start']), 1)

    def test_unrelated_choice_and_home_visit_do_not_reset_restore_pause(self):
        self.quiet_defaults(); self.choose('ads'); self.native.ad_process = process(999, '/usr/sbin/admanager'); self.ready()
        self.native.ad_process = None; self.choose('ads', False)
        for _ in range(4): self.observe()
        self.choose('browser'); self.observe(app='com.webos.app.browser'); self.observe(); self.clock.advance(120); self.observe()
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'ads_start']), 3)
        self.assertIn('Restore paused', self.manager.states['ads']['status'])

    def test_specific_toggle_retries_paused_restore_and_success_clears_budget(self):
        self.quiet_defaults(); self.choose('ads'); self.native.ad_process = process(999, '/usr/sbin/admanager'); self.ready()
        self.native.ad_process = None; self.choose('ads', False)
        for _ in range(4): self.observe()
        self.choose('ads', True); self.observe(); self.choose('ads', False); self.observe()
        self.assertEqual(len([a for a in self.native.actions if a[0] == 'ads_start']), 4)
        self.native.ad_process = process(1000, '/usr/sbin/admanager'); self.observe()
        self.assertNotIn('ads', self.manager.restore_starts)
        self.assertNotIn('ads', self.store.config()['saved'])

    def test_rejected_native_restore_requests_also_consume_budget(self):
        self.quiet_defaults(); self.choose('ads'); self.native.ad_process = process(999, '/usr/sbin/admanager'); self.ready()
        self.native.ad_process = None; self.choose('ads', False)
        with patch.object(self.native, 'call', side_effect=pc.ControlError('native_refused')) as called:
            for _ in range(6): self.observe()
        self.assertEqual(called.call_count, 3)
        self.assertIn('Restore paused', self.manager.states['ads']['status'])

    def test_breaker_latches_after_three_and_time_does_not_unpause(self):
        for n in range(3): self.assertTrue(self.manager.permitted_attempt('ads', (n, n)))
        self.assertFalse(self.manager.permitted_attempt('ads', (3, 3))); self.clock.advance(120)
        self.assertFalse(self.manager.permitted_attempt('ads', (4, 4)))

    def test_unrelated_revision_and_failed_foreground_do_not_reset_breaker(self):
        self.quiet_defaults(); self.choose('ads'); self.ready()
        for n in range(4): self.manager.permitted_attempt('ads', (n, n))
        self.choose('browser'); self.observe(valid=False); self.observe()
        self.assertIn('ads', self.manager.paused)

    def test_genuine_return_and_specific_toggle_reset_breaker(self):
        self.quiet_defaults(); self.choose('ads'); self.ready(); self.manager.paused.add('ads')
        self.observe(app='com.webos.app.browser'); self.observe(); self.assertNotIn('ads', self.manager.paused)
        self.manager.paused.add('ads'); self.choose('ads', False); self.observe(); self.assertNotIn('ads', self.manager.paused)


class NativeBoundaryTests(unittest.TestCase):
    def test_live_video_status_uses_content_type_not_opaque_source_port(self):
        for port in range(1, 5):
            value = {'video': [{'contentType': 'hdmi%d' % port, 'connectedSourcePort': 3, 'connected': True,
                               'connectedSource': 'HDMI', 'appId': pc.HOME, 'context': 'preview'}],
                     'clients': [{'clientId': 'preview', 'activation': True, 'sourceName': 'HDMI', 'appId': pc.HOME}]}
            with self.subTest(port=port), patch.object(pc.Native, 'call', return_value=value):
                for other in range(1, 5): self.assertEqual(pc.Native().hdmi_in_use('hdmi%d' % other), other == port)

    def test_unassigned_or_ambiguous_live_pipeline_defers_all_hdmi_closes(self):
        values = [
            {'video': [], 'clients': [{'clientId': 'new', 'activation': True, 'sourceName': 'HDMI', 'appId': pc.HOME}]},
            {'video': [{'connected': True, 'connectedSource': 'HDMI', 'contentType': 'unknown'}], 'clients': []},
        ]
        for value in values:
            with self.subTest(value=value), patch.object(pc.Native, 'call', return_value=value):
                for port in range(1, 5): self.assertTrue(pc.Native().hdmi_in_use('hdmi%d' % port))

    def test_no_live_pipeline_allows_cached_input_closure(self):
        value = {'video': [{'contentType': 'hdmi1', 'connected': False, 'connectedSource': 'HDMI', 'context': 'old'}],
                 'clients': [{'clientId': 'old', 'activation': False, 'sourceName': 'HDMI'}]}
        with patch.object(pc.Native, 'call', return_value=value): self.assertFalse(pc.Native().hdmi_in_use('hdmi1'))

    def test_native_fullscreen_underlay_does_not_block_cached_home_cleanup(self):
        value = {'video': [{'appId': 'com.webos.app.hdmi1', 'fullScreen': True, 'contentType': 'hdmi1',
                            'connected': True, 'connectedSource': 'HDMI', 'context': 'native'}],
                 'clients': [{'appId': 'com.webos.app.hdmi1', 'clientId': 'native', 'activation': True, 'sourceName': 'HDMI'}]}
        with patch.object(pc.Native, 'call', return_value=value):
            for port in range(1, 5): self.assertFalse(pc.Native().hdmi_in_use('hdmi%d' % port))

    def test_home_owned_client_overrides_native_fullscreen_looking_metadata(self):
        value = {'video': [{'appId': 'com.webos.app.hdmi1', 'fullScreen': True, 'contentType': 'hdmi1',
                            'connected': True, 'connectedSource': 'HDMI', 'context': 'handoff'}],
                 'clients': [{'appId': pc.HOME, 'clientId': 'handoff', 'activation': True, 'sourceName': 'HDMI'}]}
        with patch.object(pc.Native, 'call', return_value=value): self.assertTrue(pc.Native().hdmi_in_use('hdmi1'))

    def test_native_nonfullscreen_or_unknown_owner_is_still_protected(self):
        for owner, fullscreen in [('com.webos.app.hdmi1', False), ('unknown', True), (pc.HOME, True)]:
            value = {'video': [{'appId': owner, 'fullScreen': fullscreen, 'contentType': 'hdmi1',
                                'connected': True, 'connectedSource': 'HDMI', 'context': 'preview'}], 'clients': []}
            with self.subTest(owner=owner), patch.object(pc.Native, 'call', return_value=value): self.assertTrue(pc.Native().hdmi_in_use('hdmi1'))

    def test_malformed_video_status_is_rejected(self):
        for value in ({}, {'video': [None], 'clients': []}, {'video': [], 'clients': None}):
            with self.subTest(value=value), patch.object(pc.Native, 'call', return_value=value), self.assertRaises(pc.ControlError): pc.Native().hdmi_in_use('hdmi1')

    @contextmanager
    def fake_checked_file_tree(self, writable_parent='/var/preferences', file_mode=0o644, file_uid=0, file_links=1):
        paths = {}; next_fd = [20]
        def opened(name, flags, dir_fd=None):
            parent = paths.get(dir_fd, '')
            path = str(PurePosixPath(parent) / name) if parent else name
            next_fd[0] += 1; paths[next_fd[0]] = path; return next_fd[0]
        def metadata(fd):
            path = paths[fd]
            if path.endswith('.json'):
                return SimpleNamespace(st_mode=stat.S_IFREG | file_mode, st_uid=file_uid, st_nlink=file_links)
            return SimpleNamespace(st_mode=stat.S_IFDIR | (0o777 if path == writable_parent else 0o755), st_uid=0, st_nlink=1)
        class Stream(io.BytesIO):
            def fileno(self): return self.descriptor
        def stream(fd, mode):
            value = Stream(b'{"version":3,"isEnabled":{"com.webos.app.home":false}}'); value.descriptor = fd; return value
        with patch.object(pc, 'Path', PurePosixPath), patch.object(pc.os, 'O_DIRECTORY', 0, create=True), \
             patch.object(pc.os, 'O_NOFOLLOW', 0, create=True), patch.object(pc.os, 'open', side_effect=opened), \
             patch.object(pc.os, 'fstat', side_effect=metadata), patch.object(pc.os, 'fdopen', side_effect=stream), patch.object(pc.os, 'close'):
            yield

    def test_vendor_writable_preferences_parent_is_accepted_for_exact_preload_file(self):
        with self.fake_checked_file_tree():
            self.assertFalse(pc.checked_json(pc.PRELOAD_FILE)['isEnabled']['com.webos.app.home'])

    def test_writable_preferences_exception_does_not_allow_other_files_or_parents(self):
        with self.fake_checked_file_tree(), self.assertRaisesRegex(pc.ControlError, 'unsafe_directory'):
            pc.checked_json('/var/preferences/another.json')
        with self.fake_checked_file_tree(writable_parent='/var'), self.assertRaisesRegex(pc.ControlError, 'unsafe_directory'):
            pc.checked_json(pc.PRELOAD_FILE)

    def test_preferences_exception_still_rejects_unprotected_or_foreign_file(self):
        for options in ({'file_mode': 0o666}, {'file_uid': 1000}, {'file_links': 2}):
            with self.subTest(options=options), self.fake_checked_file_tree(**options), self.assertRaisesRegex(pc.ControlError, 'unsafe_file'):
                pc.checked_json(pc.PRELOAD_FILE)

    def test_policies_reject_malformed_and_duplicate_entries(self):
        for rows in ([None], [4], [{'id': []}], [{'id': 'same'}, {'id': 'same'}]):
            with self.subTest(rows=rows), patch.object(pc.Native, 'call', return_value={'applications': rows}):
                with self.assertRaises(pc.ControlError): pc.Native().policies()

    def test_exact_app_identity_rejects_foreign_executable_cgroup_and_pid(self):
        native = pc.Native(); item = pc.ITEMS['hdmi3']; rows = [{'id': item['app'], 'processid': '55'}]
        good = process(55, item['exe'], item['app'])
        for field, value in [('exe', '/bin/sh'), ('cgroups', ['3:memory:/com.webos.app.hdmi1'])]:
            bad = copy.deepcopy(good); bad[field] = value
            with self.subTest(field=field), patch.object(native, 'identity', return_value=bad):
                with self.assertRaises(pc.ControlError): native.app_process('hdmi3', rows)
        for pid in ('1', '55; reboot', 55, None):
            with self.subTest(pid=pid), self.assertRaises(pc.ControlError): native.app_process('hdmi3', [{'id': item['app'], 'processid': pid}])

    def test_same_checks_birth_and_all_target_identity(self):
        native = pc.Native(); original = process(55, '/usr/sbin/admanager')
        for key, value in [('birth', 999), ('exe', '/bin/sh'), ('uid', 1000), ('argv', []), ('cgroups', [])]:
            changed = copy.deepcopy(original); changed[key] = value
            with self.subTest(key=key), patch.object(native, 'identity', return_value=changed): self.assertFalse(native.same(original))

    def test_pidfd_signal_is_bound_and_descriptor_closed(self):
        native = pc.Native(); target = process(55, '/usr/sbin/admanager')
        with patch.object(pc.os, 'pidfd_open', return_value=77, create=True) as opened, \
             patch.object(pc.signal, 'pidfd_send_signal', create=True) as sent, \
             patch.object(pc.os, 'close') as closed, patch.object(native, 'same', return_value=True), patch.object(pc.os, 'kill') as killed:
            native.terminate_ads(target)
        opened.assert_called_once_with(55, 0); sent.assert_called_once_with(77, signal.SIGTERM); closed.assert_called_once_with(77); killed.assert_not_called()

    def test_pidfd_reused_target_is_rejected_without_signal(self):
        native = pc.Native()
        with patch.object(pc.os, 'pidfd_open', return_value=77, create=True), patch.object(pc.signal, 'pidfd_send_signal', create=True) as sent, \
             patch.object(pc.os, 'close') as closed, patch.object(native, 'same', return_value=False):
            with self.assertRaisesRegex(pc.ControlError, 'process_changed'): native.terminate_ads(process(55, '/usr/sbin/admanager'))
        sent.assert_not_called(); closed.assert_called_once_with(77)

    def test_pidfd_fallback_only_when_kernel_unsupported(self):
        native = pc.Native(); target = process(55, '/usr/sbin/admanager')
        with patch.object(pc.os, 'pidfd_open', side_effect=OSError(errno.ENOSYS, 'unsupported'), create=True), \
             patch.object(pc.signal, 'pidfd_send_signal', create=True), patch.object(native, 'same', return_value=True), patch.object(pc.os, 'kill') as killed:
            native.terminate_ads(target)
        killed.assert_called_once_with(55, signal.SIGTERM)
        with patch.object(pc.os, 'pidfd_open', side_effect=OSError(errno.EPERM, 'denied'), create=True), \
             patch.object(pc.signal, 'pidfd_send_signal', create=True), patch.object(pc.os, 'kill') as killed:
            with self.assertRaises(OSError): native.terminate_ads(target)
        killed.assert_not_called()

    def test_signal_rejects_hub_or_foreign_ads_group(self):
        for target in (process(2, '/usr/sbin/ls-hubd'), process(55, '/usr/sbin/admanager')):
            target['cgroups'] = ['1:name=systemd:/foreign.service']
            with self.subTest(exe=target['exe']), patch.object(pc.os, 'kill') as killed:
                with self.assertRaises(pc.ControlError): pc.Native().terminate_ads(target)
                killed.assert_not_called()

    def test_boot_metadata_repairs_only_the_pinned_app_directory_and_manifest(self):
        tree = AppMetadataFixture()
        with tree.patched(): self.assertTrue(pc.checked_app())
        self.assertEqual(tree.changes, [(str(PurePosixPath(pc.APPINFO).parent), 0o755), (pc.APPINFO, 0o644)])
        self.assertTrue(all(flags & 8 for _, flags in tree.opened))
        self.assertEqual(set(tree.closed), set(tree.descriptors))

    def test_already_secure_pinned_app_needs_no_permission_write(self):
        tree = AppMetadataFixture(); tree.set_mode(str(PurePosixPath(pc.APPINFO).parent), 0o755); tree.set_mode(pc.APPINFO, 0o644)
        with tree.patched(): self.assertTrue(pc.checked_app())
        self.assertEqual(tree.changes, [])

    def test_changed_hash_with_matching_id_cannot_trigger_permission_repair(self):
        tree = AppMetadataFixture(); tree.raw = tree.raw.replace(b'"title": "Home"', b'"title": "Other"')
        with tree.patched(), self.assertRaisesRegex(pc.ControlError, 'untrusted_app_manifest'): pc.checked_app()
        self.assertEqual(tree.changes, [])

    def test_foreign_owner_hardlink_and_symlink_are_rejected_before_chmod(self):
        for mutation in ('owner', 'hardlink', 'symlink'):
            tree = AppMetadataFixture()
            if mutation == 'owner': tree.inodes[tree.bindings[pc.APPINFO]]['uid'] = 1000
            elif mutation == 'hardlink': tree.inodes[tree.bindings[pc.APPINFO]]['nlink'] = 2
            else: tree.symlinks.add(pc.APPINFO)
            with self.subTest(mutation=mutation), tree.patched(), self.assertRaises(pc.ControlError): pc.checked_app()
            self.assertEqual(tree.changes, [])

    def test_missing_initial_app_path_is_a_readiness_error_without_mutation(self):
        tree = AppMetadataFixture(); tree.missing.add(str(PurePosixPath(pc.APPINFO).parent))
        with tree.patched(), self.assertRaises(FileNotFoundError): pc.checked_app()
        self.assertEqual(tree.changes, [])

    def test_inode_replaced_between_open_and_hash_check_is_not_repaired(self):
        tree = AppMetadataFixture()
        def swap(read_count):
            if read_count == 1:
                tree.inodes[99] = dict(tree.inodes[tree.bindings[pc.APPINFO]]); tree.bindings[pc.APPINFO] = 99
        tree.on_read = swap
        with tree.patched(), self.assertRaisesRegex(pc.ControlError, 'app_path_changed'): pc.checked_app()
        self.assertEqual(tree.changes, [])

    def test_bytes_changed_through_existing_handle_after_chmod_are_rejected(self):
        tree = AppMetadataFixture(); tree.on_chmod = lambda: setattr(tree, 'raw', b'{"id":"org.local.openxmb.c5","title":"changed"}')
        with tree.patched(), self.assertRaisesRegex(pc.ControlError, 'untrusted_app_manifest'): pc.checked_app()
        self.assertEqual(tree.changes, [(str(PurePosixPath(pc.APPINFO).parent), 0o755), (pc.APPINFO, 0o644)])

    def test_cli_installation_check_does_not_block_restore_after_removal(self):
        store = FakeStore(); config = store.config(); config['saved'] = {}; store.write('background.json', config)
        with patch.object(pc.os, 'geteuid', return_value=0, create=True), patch.object(pc, 'Store', return_value=store), \
             patch.object(pc, 'checked_app', side_effect=pc.ControlError('missing')) as checked, redirect_stdout(io.StringIO()) as output:
            self.assertEqual(pc.main(['restore']), 0)
        checked.assert_not_called(); self.assertTrue(json.loads(output.getvalue())['restored']); self.assertTrue(store.closed)


class PermanentHomeRestoreTests(unittest.TestCase):
    def setUp(self):
        self.native = pc.Native(); self.app = pc.ITEMS['home']['app']; self.calls = []
        self.live = {self.app: {'id': self.app, 'isEnabled': True}, 'other': {'id': 'other', 'isEnabled': True}}
        self.stored = {'version': 3, 'isEnabled': {self.app: False}, 'allowedApps': {self.app: True, 'other': True}}
        def call(key, payload):
            self.calls.append((key, copy.deepcopy(payload)))
            if key == 'policies': return {'returnValue': True, 'applications': list(copy.deepcopy(self.live).values())}
            self.live[payload['application']['id']] = copy.deepcopy(payload['application'])
            if payload['permanent']: self.stored.setdefault('isEnabled', {})[self.app] = payload['application']['isEnabled']
            return {'returnValue': True}
        self.call_patch = patch.object(self.native, 'call', side_effect=call); self.call_patch.start()
        self.disk_patch = patch.object(pc, 'checked_json', side_effect=lambda path: copy.deepcopy(self.stored)); self.disk_patch.start()
    def tearDown(self): self.disk_patch.stop(); self.call_patch.stop()
    def test_disk_mismatch_performs_only_required_runtime_then_permanent_change(self):
        self.native.preload('home', True, True)
        changes = [p for k, p in self.calls if k == 'policy']
        self.assertEqual([(p['application']['isEnabled'], p['permanent']) for p in changes], [(False, False), (True, True)])
        self.assertTrue(self.stored['isEnabled'][self.app]); self.assertTrue(self.live['other']['isEnabled'])
    def test_matching_disk_does_not_flip_live_state(self):
        self.stored['isEnabled'][self.app] = True; self.native.preload('home', True, True)
        self.assertEqual([k for k, _ in self.calls if k == 'policy'], [])
    def test_original_default_without_override_does_not_flip(self):
        del self.stored['isEnabled']; self.native.preload('home', True, True)
        self.assertEqual([k for k, _ in self.calls if k == 'policy'], [])
    def test_unconfirmed_disk_restore_is_reported(self):
        initial = copy.deepcopy(self.stored)
        with patch.object(pc, 'checked_json', return_value=initial), self.assertRaisesRegex(pc.ControlError, 'permanent_policy_not_confirmed'):
            self.native.preload('home', True, True)


if __name__ == '__main__': unittest.main()
