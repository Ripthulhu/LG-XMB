# Installation and recovery

This release targets an already rooted LG C5 with a working Homebrew Channel, root SSH, `/usr/bin/python3`, and the existing `/var/lib/webosbrew/init.d` startup mechanism. Root access must already work. The installer does not obtain it or change TV security measures.

The launcher itself is a normal web app. Its privileged features require the separate helper, access to Homebrew Channel's existing `org.webosbrew.hbchannel.service/exec` service, and the private webOS APIs used by that helper. App permissions alone do not grant these capabilities on webOS 10.

Keep a known working way to open LG Home and use SSH before changing the default launcher. Compatibility is established for the tested C5 environment, not every webOS release.

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

## Deploy the helper

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
