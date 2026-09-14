"""One-shot workspace patch; removed before the final source tree is committed."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess

ROOT = Path.cwd()
FILES = ROOT / '.maintenance/files'
PINNED = {
    'app/app.js': '2f7aec2c3b565b40967c541cf3c8527c0516b2ed',
    'app/style.css': '6dc5e1073ca0bdba959e8520f80dbeeb358a66dc',
    'app/process-transport.js': 'a30dc35fa92aa860ec514598a168b6cf08831565',
    'tv-helper/process_control.py': '25446bf14f3026e00882c4a6c6a5ebe788fae026',
    'tv-helper/thumbnail_cache.py': '61e98e075c90b7049e89f53740927b0046ae67dc',
    'tools/package.mjs': 'e1f0766758452f0618b149fb42e1f8226938d4f1',
}
for name, expected in PINNED.items():
    actual = subprocess.check_output(['git', 'hash-object', name], text=True).strip()
    if actual != expected:
        raise RuntimeError('Source changed: ' + name)


def edit(name, old, new, count=1):
    path = ROOT / name
    text = path.read_text()
    if text.count(old) != count:
        raise RuntimeError(f'{name}: expected {count} occurrences of {old[:80]!r}, found {text.count(old)}')
    path.write_text(text.replace(old, new))


# Rename current project paths and storage keys, retaining only the installed
# application ID and explicit migration readers. Never rewrite upstream licenses.
paths = [Path('package.json'), Path('package-lock.json')]
for directory in ('app', 'tests', 'tv-helper', 'tools'):
    paths += [p for p in Path(directory).rglob('*') if p.suffix in ('.js','.cjs','.mjs','.py','.json')
              and 'licenses' not in p.parts and 'fixtures' not in p.parts]
for path in paths:
    text = path.read_text()
    text = text.replace('openxmb-c5-web-port', 'lg-xmb').replace('openxmb-c5', 'lg-xmb')
    text = text.replace('OpenXMB C5 web adaptation', 'lg-xmb web application')
    path.write_text(text)

# Keep the application ID stable so this upgrades the existing Home app.
manifest_path = Path('app/appinfo.json')
manifest = json.loads(manifest_path.read_text())
manifest['version'] = '0.1.12'
manifest['vendor'] = 'lg-xmb contributors'
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
for name in ('package.json','package-lock.json'):
    path = Path(name)
    # Only the project version, never unrelated dependency versions.
    text = path.read_text()
    text = text.replace('"version": "0.1.11"', '"version": "0.1.12"')
    path.write_text(text)
edit('app/app.js', "about:'Version 0.1.11'", "about:'Version 0.1.12'")
edit('tools/package.mjs', "const expectedVersion = '0.1.11';", "const expectedVersion = '0.1.12';")
path = Path('tools/browser-check.cjs')
s = path.read_text().replace(r'0\.1\.11', r'0\.1\.12').replace('About identifies version 0.1.11', 'About identifies version 0.1.12')
path.write_text(s)
new_pin = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
path = Path('tv-helper/process_control.py')
s = path.read_text()
s, changed = re.subn(r"^PIN_APPINFO_SHA256 = '[a-f0-9]{64}'$", "PIN_APPINFO_SHA256 = '" + new_pin + "'", s, flags=re.M)
assert changed == 1
path.write_text(s)
edit('tv-helper/process_control.py', '''    # Stock Home was managed before this menu existed. Its original preload was enabled.
    return {'schema': 1, 'revision': 0, 'enabled': {k: k == 'home' for k in ITEMS},
            'saved': {'home': {'enabled': True, 'permanentRestore': True}}}''', '''    # A fresh installation must not invent preload or service rollback values.
    return {'schema': 1, 'revision': 0, 'enabled': {k: False for k in ITEMS}, 'saved': {}}''')
# Existing management tests exercise an explicitly configured legacy installation.
edit('tv-helper/test_process_control.py', "import process_control as pc\n", """import process_control as pc


def legacy_config():
    value = pc.default_config()
    value['enabled']['home'] = True
    value['saved']['home'] = {'enabled': True, 'permanentRestore': True}
    return value
""")
path = Path('tv-helper/test_process_control.py')
s = path.read_text().replace('config or pc.default_config()', 'config or legacy_config()')
s = s.replace('def test_defaults_keep_only_existing_stock_home_control(self):', 'def test_fresh_defaults_allow_everything_without_invented_rollback_values(self):')
s = s.replace("self.assertEqual([k for k, v in pc.default_config()['enabled'].items() if v], ['home'])", "self.assertEqual([k for k, v in pc.default_config()['enabled'].items() if v], [])\n        self.assertEqual(pc.default_config()['saved'], {})")
path.write_text(s)

edit('tv-helper/thumbnail_cache.py', '''            # This module is deployed alongside this helper; it is never supplied by the web app.
            import importlib.util
            module_path = "/var/lib/lg-xmb/process-control.py"
            for directory in ("/var", "/var/lib", "/var/lib/lg-xmb"):
                check_directory(os.lstat(directory))''', '''            # The matching controller is shipped in the same app-owned bundle.
            import importlib.util
            module_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "process_control.py")
            for directory in (APP_DIR, os.path.dirname(module_path)):
                check_directory(os.lstat(directory))''')

# Bootstrap executes once on a rooted TV. On-demand commands wait for it, while
# ordinary launches retain their short best-effort preparation path.
command_old = '/usr/bin/python3 /var/lib/lg-xmb/process-control.py '
command_new = '/usr/bin/python3 -I -B /media/developer/apps/usr/palm/applications/org.local.openxmb.c5/helper/process_control.py '
for name in ('app/process-transport.js', 'tests/process-transport.test.cjs'):
    path = Path(name)
    s = path.read_text()
    assert command_old in s
    path.write_text(s.replace(command_old, command_new))
edit('tests/process-transport.test.cjs', 'C5TV: { isTV: () => true }, PalmServiceBridge,', 'C5TV: { isTV: () => true }, PalmServiceBridge, LGXMBHelper: {isReady: () => true},')
edit('app/process-transport.js', '  function request(command, timeout) {', '  function execute(command, timeout) {')
edit('app/process-transport.js', '  function mapped(operation, success, failure) {', '''  function request(command, timeout) {
    var helper = root.LGXMBHelper;
    if (!helper) return Promise.reject(problem('UNAVAILABLE'));
    if (helper.isReady()) return execute(command, timeout);
    var commandRequest = null, cancelled = false, rejectWait;
    var operation = new Promise(function(resolve, reject) {
      rejectWait = reject;
      helper.ensure().then(function() {
        if (cancelled) return;
        commandRequest = execute(command, timeout);
        commandRequest.then(resolve, reject);
      }, reject);
    });
    operation.cancel = function() {
      cancelled = true;
      if (commandRequest) commandRequest.cancel();
      else rejectWait(problem('CANCELLED'));
    };
    return operation;
  }

  function mapped(operation, success, failure) {''')
edit('app/process-transport.js', '''  function prepareLaunch(appId) {
    if (APPS.indexOf(appId) === -1)''', '''  function prepareLaunch(appId) {
    if (!root.LGXMBHelper || !root.LGXMBHelper.isReady()) return Promise.resolve({prepared:false, reason:'unavailable'});
    if (APPS.indexOf(appId) === -1)''')
edit('app/process-transport.js', "      INVALID_CHOICE: 'This background setting is unavailable.',", """      HELPER_MISMATCH: 'The app and helper do not match. Reinstall the lg-xmb IPK.',
      HELPER_REJECTED: 'The helper rejected an unsafe file or configuration. Existing settings were preserved.',
      INVALID_CHOICE: 'This background setting is unavailable.',""")
edit('app/process-transport.js', '''    // Homebrew exec does not normally return an exit code.''', '''    // A failed command can still return a bounded diagnostic from our helper.
    // Never turn an outer execution failure into a successful settings reply.
    if (typeof outer.stdoutString === 'string' && outer.stdoutString.length <= 32768) {
      var diagnostic;
      try { diagnostic = JSON.parse(outer.stdoutString); } catch (ignored) {}
      if (object(diagnostic) && diagnostic.returnValue === false) {
        var codes = {untrusted_app_manifest:'HELPER_MISMATCH',unsafe_app_path:'HELPER_REJECTED',
          unsafe_file:'HELPER_REJECTED',unsafe_directory:'HELPER_REJECTED',invalid_config:'HELPER_REJECTED',
          revision_conflict:'CONFLICT',home_mapping_requires_custom:'HOME_MAPPING_REQUIRES_CUSTOM',other_home_mapping:'OTHER_HOME_MAPPING'};
        if (Object.prototype.hasOwnProperty.call(codes, diagnostic.errorCode)) throw problem(codes[diagnostic.errorCode]);
      }
    }
    // Homebrew exec does not normally return an exit code.''')
# Insert after the native bridge, before the adapters that depend on setup.
path = Path('app/index.html')
s = path.read_text()
needle = '<script src="tv-bridge.js"></script>'
assert s.count(needle) == 1
path.write_text(s.replace(needle, needle + '\n  <script src="helper.js"></script>'))

# Legacy UI preferences are a fallback, not something overwritten on every boot.
edit('app/app.js', "localStorage.getItem('lg-xmb-preferences-v1')||'{}'", "localStorage.getItem('lg-xmb-preferences-v1')||localStorage.getItem('openxmb-c5-preferences-v1')||'{}'")
edit('app/app.js', "b.setAttribute('role','option');b.tabIndex=-1;", "b.setAttribute('role','option');b.setAttribute('aria-label',item.title);b.tabIndex=-1;")
edit('app/app.js', "button.style.setProperty('--offset',offset);button.classList.toggle('selected',offset===0);", "button.style.setProperty('--offset',offset);button.style.setProperty('--item-y',(offset*8.4-(offset<0?25:0))+'vh');button.classList.toggle('above-bar',offset<0);button.classList.toggle('selected',offset===0);")
edit('app/app.js', "var visible=offset>=-1&&offset<=3;button.style.visibility=visible?'visible':'hidden';button.style.opacity=!visible?'0':offset===0?'1':offset===-1?'.38':String(.64-offset*.09);", "var visible=offset>=-3&&offset<=3;button.style.visibility=visible?'visible':'hidden';button.style.opacity=!visible?'0':offset===0?'1':offset<0?String(.48+offset*.10):String(.64-offset*.09);")
edit('app/app.js', "if(visible)$('items').children[index].querySelector('.item-text').textContent=item.title;", "if(visible){var button=$('items').children[index];button.querySelector('.item-text').textContent=item.title;button.setAttribute('aria-label',item.title);}")
edit('app/app.js', "function closeModal(){", '''function updateHelperStatus(){
  var status=$('helperStatus'),retry=$('retryHelper');
  if(!status||!window.LGXMBHelper)return;
  var state=LGXMBHelper.getState();
  status.textContent=state.message;
  if(retry)retry.hidden=state.phase!=='failed' && !(state.ready&&!state.captureRunning);
}
function helperStatusPanel(){
  if(!C5TV.isTV()||!window.LGXMBHelper)return;
  var status=document.createElement('p');status.id='helperStatus';status.className='modal-intro';status.setAttribute('role','status');$('modalContent').appendChild(status);
  var retry=row('Retry helper setup',null,false,function(){LGXMBHelper.retry().then(updateHelperStatus,updateHelperStatus);});retry.id='retryHelper';updateHelperStatus();
}
function startHelper(){
  if(!C5TV.isTV()||!window.LGXMBHelper)return;
  var generation=launchGeneration;
  LGXMBHelper.ensure().then(function(){
    if(pageActive&&!document.hidden&&!busy&&generation===launchGeneration&&currentPort()&&preferences.previewMode==='cached')thumbnail.refresh();
  },function(){/* Settings show the specific setup error; navigation stays usable. */});
}
document.addEventListener('lg-xmb-helper-status',updateHelperStatus);
function closeModal(){''')
edit('app/app.js', "preferences.previewMode='live';save();openModal(type);});}", "preferences.previewMode='live';save();openModal(type);});helperStatusPanel();}")
edit('app/app.js', "$('items').focus();discoverApps();refreshInputLabels();", "$('items').focus();discoverApps();refreshInputLabels();startHelper();")
edit('app/app.js', "var controls=Array.from($('modal').querySelectorAll('button')),index=", "var controls=Array.from($('modal').querySelectorAll('button')).filter(function(button){return !button.hidden;}),index=")
# Don't let unselected row labels float over the category bar.
edit('app/style.css', 'transform:translateY(calc(var(--offset) * 8.4vh));', 'transform:translateY(var(--item-y,0vh));')
path = Path('app/style.css')
path.write_text(path.read_text() + '''\n/* Previous items occupy the upper arm of the XMB; only their icons remain. */
#categories{z-index:2;pointer-events:none}.category{pointer-events:auto}
.cross-content{overflow:visible}.item.above-bar{width:7vw}
.item.above-bar .item-text{visibility:hidden}
''')

# Stage exactly the helper sources in the IPK, without generated files in app/.
edit('tools/package.mjs', "import { fileURLToPath } from 'node:url';", "import { fileURLToPath } from 'node:url';\nimport { stageHelper } from './stage-helper.mjs';")
edit('tools/package.mjs', "    process.stdout.write(runCli(['--no-minify', '--outdir', outputDir, appDir]));", """    const stagedApp = path.join(projectDir, '.build', 'package', 'app');
    fs.rmSync(path.dirname(stagedApp), {recursive: true, force: true});
    fs.cpSync(appDir, stagedApp, {recursive: true});
    stageHelper(projectDir, stagedApp);
    process.stdout.write(runCli(['--no-minify', '--outdir', outputDir, stagedApp]));""")
path = Path('.github/workflows/checks.yml')
s = path.read_text()
start = s.index('      - name: Verify app-owned startup entry\n')
end = s.index('      - uses: actions/upload-artifact', start)
s = s[:start] + '''      - name: Verify bundled helper and app-owned startup
        run: python3 tools/verify-helper-package.py dist/org.local.openxmb.c5_0.1.12_all.ipk
''' + s[end:]
path.write_text(s)
package = json.loads(Path('package.json').read_text())
package['scripts']['test:browser'] += ' && node tests/upper-items-browser.cjs'
Path('package.json').write_text(json.dumps(package, indent=2) + '\n')

# Documentation follows the shipped installation path, not a manual development deployment.
edit('README.md', 'the separate root helper. That helper is still C5-specific. Do not install it\non an unverified TV just because the menu renders correctly.', 'the bundled helper, prepared automatically through Homebrew Channel. Its native\nintegrations are still C5-specific; a working menu is not a compatibility test.')
edit('README.md', 'Root-helper setup and recovery are separate steps in the same guide.', 'Rooted installations prepare their helper on first launch. Recovery is covered in\nthe same guide.')
edit('docs/COMPATIBILITY.md', 'Outstanding: per-feature helper profiles, safe new-install defaults in the\ncontroller itself, capture/controller isolation, and verified geometry outside\nthe C5.', 'Outstanding: per-feature helper profiles, capture/controller isolation, and\nverified geometry outside the C5.')
edit('docs/COMPATIBILITY.md', 'INSTALLATION.md#removal-and-leftovers', 'INSTALLATION.md#return-to-lg-home-and-remove')
path = Path('docs/COMPATIBILITY.md')
path.write_text(path.read_text() + "\n## Clean-install test record\n\nNative input labels in build `edde24c` were confirmed working by the maintainer.\nCached pictures and Home remapping failed when the old external helper was\nremoved: that build did not bundle its helper modules. Version 0.1.12 packages\nthem and adds automatic setup, migration and safe fresh defaults. These changes\nstill need the same clean-install test on the TV; CI does not establish native\nAPI permissions or capture compatibility.\n")
path = Path('tv-helper/README.md')
s = path.read_text().replace('/var/lib/openxmb-c5', '/var/lib/lg-xmb').replace('/tmp/openxmb-c5', '/tmp/lg-xmb')
s = s.replace('`/var/lib/lg-xmb/thumbnail-cache.py`', "Installed app's `helper/thumbnail_cache.py`")
s = s.replace('`/var/lib/lg-xmb/process-control.py`', "Installed app's `helper/process_control.py`")
s = s.replace('`60-openxmb-thumbnails` | `/var/lib/webosbrew/init.d/60-openxmb-thumbnails`', '`app/helper-startup.py` | `/var/lib/webosbrew/init.d/60-lg-xmb` (symlink)')
s = s.replace('Run with `/usr/bin/python3 /var/lib/lg-xmb/process-control.py`:', 'Run the bundled `helper/process_control.py` with `/usr/bin/python3 -I -B`:')
old = 'The legacy default initializer supports earlier installs that already managed LG Home. The documented fresh-install procedure creates an explicit all-Allowed configuration instead, so a new installation does not assume those legacy preload settings.'
s = s.replace(old, 'Fresh defaults allow every background entry and contain no assumed rollback values. Automatic setup migrates existing choices and saved values without resetting them. Helper code ships in the IPK and is not copied into the persistent settings directory.')
path.write_text(s)

# Authored replacements and tests are copied last, preserving explicit legacy names.
for source in FILES.rglob('*'):
    if source.is_file() and '__pycache__' not in source.parts:
        destination = ROOT / source.relative_to(FILES)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
Path('app/helper-startup.py').chmod(0o755)
print('Prepared app-owned helper setup, lg-xmb runtime names and XMB upper icons.')
