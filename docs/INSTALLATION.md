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
Home-button assignment require the in-app TV integration setup below.

**Existing helper installation?** Use **TV integration → Stop helper for update**
before upgrading the IPK. After the update, use **Repair TV features**. This
preserves your settings while replacing the matching helper modules.

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

When upgrading from an older build without the TV integration screen, use its
guarded recovery stop utility once before installing this build. Do not run
`process-control.py restore` during an ordinary upgrade; that resets your choices.

## Set up TV integration (C5 only)

The IPK includes the helper. No separate download, SCP transfer or manual
startup-link creation is needed. This requires an already rooted LG C5 on
webOS 25, Homebrew Channel running with **Root status** enabled, and the TV's
existing Python 3.7 or newer. The app does not root the TV or install Python.

Open **Settings → TV integration → Enable TV features**. The same setup screen
is accessible from **Input previews** and from **Remote buttons** when its helper
is unavailable. Opening the screen checks status only; the Enable action installs
and starts the bundled helper and creates its app-owned boot symlink.

Setup leaves the Home-button assignment unchanged. A new configuration starts
with every background control on **Allow**. Existing `background.json` choices
and saved restoration values are preserved. To change Home later, select
**Settings → Remote buttons → Our Home**.

After setup, use **Check status** to confirm the worker is running. View an HDMI
input and return to Home for a cached picture. Protected or muted sources may
not produce a picture. The helper still uses the C5-specific capture and process
checks; other models or unreadable model information are refused, not guessed.

Use **Enable TV features** when helper files are missing, or **Repair TV features**
when the helper is stopped or outdated. This uses the
bundled guarded recovery code before replacing the modules, so it also works
when the old helper was removed or the installed recovery script is outdated.
It recognizes reviewed legacy copied hooks and the current symlink, but refuses
foreign files or links. Do not reset a configuration or loosen permissions to
bypass a refusal. A timed-out setup is not retried automatically; check status
before trying again.

The executable modules remain under `/var/lib/openxmb-c5`; the boot entry links
to `helper-startup.py` inside the app. Uninstalling the app breaks that link and
prevents subsequent boot starts. Saved settings and inactive helper files remain
outside the app. Restore TV settings as described below **before uninstalling**.

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

## Removal and leftovers

Restore LG Home and background settings before uninstalling. webOS has no app
uninstall hook; deleting the app cannot undo those settings automatically.

Uninstalling removes `helper-startup.py` with the app container, so the `init.d`
symlink becomes broken and cannot launch the helper at the next boot. If the
app is deleted while the worker is running, its existing readiness checks stop
native work when the missing app is observed and end the worker after the
90-second grace period, plus any in-flight operation and polling delay.
This is not a substitute for restoring settings first.

The updated recovery utility can remove our broken symlink without following
its target. It also works when the hook is already absent. It leaves other
symlinks and unrecognized copied scripts untouched.

After successful recovery, `/var/lib/openxmb-c5/` contains inert helper files
and saved state. Keep it until restoration is confirmed. The small
`/var/lib/webosbrew/lg-xmb-startup.log` may be removed then. Runtime directories
`/tmp/openxmb-c5-controls` and `/tmp/openxmb-c5-thumbnails` disappear on reboot.
Do not remove shared Homebrew directories.

## Updating the manifest

The packager stages the helper sources with an exact-byte bundle manifest. It
checks those bytes again inside the IPK in CI. The controller also pins exact
`app/appinfo.json` bytes. A version or metadata change requires a reviewed update to `PIN_APPINFO_SHA256` in `tv-helper/process_control.py`, followed by tests and packaging. Preserve LF line endings. Deploy the matching app and helper together, with the worker stopped during replacement.

Do not copy device credentials, captured HDMI pictures, firmware backups or runtime configuration into the repository.
