# Installation and recovery

Install the launcher first. The root helper is optional and remains limited to
the tested C5 environment. The development target is webOS 22–26; check the
[compatibility matrix](COMPATIBILITY.md) before trying another TV.

## Install the launcher

1. Get the IPK from a successful **Checks** run in GitHub Actions (the
   `lg-xmb-candidate` artifact), or build it below. Candidate artifacts are for
   testing, not stable releases. Extract the artifact ZIP on your computer.
2. Open [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases).
   Add your TV using its existing Developer Mode or rooted connection, following
   the tool's setup prompts. Never paste device credentials into a bug report.
3. Select the TV, choose **Install**, and select the `.ipk`. Launch **Home** from
   the TV's app list. Test navigation and app launch/return before changing any
   system setting.

A Developer Mode-only installation does not need root or the native SDK, and
it does not assign the Home button. Keep Developer Mode active according to
[Homebrew's guide](https://www.webosbrew.org/devmode/). Cached pictures and
background controls will remain unavailable without the helper.

**Existing helper installation?** Before upgrading the IPK, stop the helper as
explained below. Do not replace app files underneath the running worker.

To remove a launcher-only installation, uninstall **Home** using the TV's app
manager or Dev Manager. With a root-helper installation, first follow
[Return to LG Home](#return-to-lg-home), confirm restoration, and stop the helper;
only then remove the app. App removal does not clean up root-owned helper files.

## Build

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run package
```

The package and SHA-256 file are under `dist/`. Use a Homebrew-compatible app installer or a configured webOS CLI device:

```sh
npx ares-install --device tv dist/org.local.openxmb.c5_0.1.11_all.ipk
```

`tv` is your own configured device name. The device ID, credentials and host configuration are not supplied by this repository. A Developer Mode-only installation can run the launcher but does not provide its root helper features.

**For an upgrade, stop the existing helper before installing the new IPK or replacing its modules.** Run the recovery stop utility below without running `process-control.py restore`; that preserves the user's background choices.

## Deploy the helper (C5 only)

This requires an already rooted LG C5, working Homebrew Channel, root SSH,
`/usr/bin/python3`, and the existing `/var/lib/webosbrew/init.d` mechanism. It
does not provide root access. Keep a working SSH connection and a way to open
LG Home before changing the default launcher.

The following is the existing 0.1.11 helper procedure, not a cross-model
installer. Its copied startup hook must be replaced, with corresponding recovery
tests, before Homebrew submission; see [remaining work](COMPATIBILITY.md#before-broad-distribution).

Copy the source files over your existing authenticated SSH connection into a new root-only staging directory. For example, in a POSIX shell on your computer, set `TV_HOST` to your TV's address:

```sh
ssh root@"$TV_HOST" 'umask 077; mkdir /tmp/lg-xmb-stage'
scp tv-helper/thumbnail_cache.py tv-helper/process_control.py \
    tv-helper/60-openxmb-thumbnails tv-helper/recovery/stop_thumbnail_helper.py \
    root@"$TV_HOST":/tmp/lg-xmb-stage/
```

The staging directory creation intentionally fails if it already exists. Inspect any existing directory before reusing it. Compare the transferred file hashes with the local source before executing it as root.

On the TV, stop any existing helper with the supplied guarded utility:

```sh
/usr/bin/python3 /tmp/lg-xmb-stage/stop_thumbnail_helper.py
```

It checks the exact startup hook and process identity, removes that hook and sends SIGTERM to the helper. It preserves app files, cached pictures and background choices. If it refuses an unexpected file or process, investigate the mismatch instead of replacing files beneath a running worker.

Install the IPK now if this is an upgrade. Then place the helper modules in their protected directory:

```sh
mkdir -p /var/lib/openxmb-c5
chown root:root /var/lib/openxmb-c5
chmod 0755 /var/lib/openxmb-c5
cp /tmp/lg-xmb-stage/thumbnail_cache.py /var/lib/openxmb-c5/thumbnail-cache.py
cp /tmp/lg-xmb-stage/process_control.py /var/lib/openxmb-c5/process-control.py
cp /tmp/lg-xmb-stage/stop_thumbnail_helper.py /var/lib/openxmb-c5/stop-helper.py
chown root:root /var/lib/openxmb-c5/thumbnail-cache.py /var/lib/openxmb-c5/process-control.py /var/lib/openxmb-c5/stop-helper.py
chmod 0755 /var/lib/openxmb-c5/thumbnail-cache.py /var/lib/openxmb-c5/process-control.py /var/lib/openxmb-c5/stop-helper.py
```

Use real root-owned directories and regular files at these paths, not symlinks. Never overwrite `background.json` during an upgrade. For a **fresh install with no existing configuration**, initialize every background control to Allow:

```sh
/usr/bin/python3 - <<'PY'
import importlib.util, json, os
path = '/var/lib/openxmb-c5/process-control.py'
spec = importlib.util.spec_from_file_location('control', path)
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)
control.checked_app()
config = {'schema': 1, 'revision': 0,
          'enabled': {key: False for key in control.ITEMS}, 'saved': {}}
os.umask(0o077)
with open('/var/lib/openxmb-c5/background.json', 'x', encoding='utf-8') as stream:
    json.dump(config, stream)
PY
```

Exclusive creation refuses to replace an existing configuration. The app manifest must match the controller's reviewed pin; do not bypass a mismatch by weakening the checks.

Run a bounded startup check:

```sh
/usr/bin/python3 /var/lib/openxmb-c5/thumbnail-cache.py --once --allow-home-preview --process-controls
```

Inspect `/tmp/openxmb-c5-thumbnails/status.json`. With an eligible HDMI input displayed, a fresh `hdmi1.png`–`hdmi4.png` should appear at 480×270. A muted or protected source can legitimately remain without a picture. Once the check succeeds, install and run the existing Homebrew startup hook:

```sh
cp /tmp/lg-xmb-stage/60-openxmb-thumbnails /var/lib/webosbrew/init.d/60-openxmb-thumbnails
chown root:root /var/lib/webosbrew/init.d/60-openxmb-thumbnails
chmod 0755 /var/lib/webosbrew/init.d/60-openxmb-thumbnails
/var/lib/webosbrew/init.d/60-openxmb-thumbnails
/usr/bin/python3 /var/lib/openxmb-c5/process-control.py get
```

The helper holds a lifetime lock, so duplicate starts are refused. Confirm Background activity is available in the actual app, then select the controls you want. Choose **Settings → Remote buttons → Our Home** to assign the Home button. Installation alone does not change the assignment.

## Return to LG Home

In the app, select **Settings → Remote buttons → LG Home**. This restores LG Home's preload and allows it to run. Select **LG behavior** for Back if desired. Other background choices remain as selected; set them to Allow if you also want those services restored.

If the app is unavailable, use your existing root SSH session. To stop all background management and restore saved settings:

```sh
/usr/bin/python3 /var/lib/openxmb-c5/stop-helper.py
/usr/bin/python3 /var/lib/openxmb-c5/process-control.py restore
luna-send -n 1 luna://com.webos.applicationManager/setDefaultApp '{"category":"home","appId":"com.webos.app.home"}'
luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}'
```

Check every command's result. Recovery keeps the custom app installed and retains its helper files; it is not an uninstall. The guarded stop utility can also be run from a freshly transferred source copy if it was not installed previously.

## Updating the manifest

The controller pins exact `app/appinfo.json` bytes. A version or metadata change requires a reviewed update to `PIN_APPINFO_SHA256` in `tv-helper/process_control.py`, followed by tests and packaging. Preserve LF line endings. Deploy the matching app and helper together, with the worker stopped during replacement.

Do not copy device credentials, captured HDMI pictures, firmware backups or runtime configuration into the repository.
