# Installation and recovery

## Install

1. Download the `.ipk` asset from [Releases](https://github.com/Ripthulhu/LG-XMB/releases).
   Read that release's requirements and limitations. Prereleases are test builds;
   the source-code ZIP is not installable on the TV.
2. In [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases),
   connect to your TV using its existing Developer Mode or rooted connection.
3. Install the IPK and open **Home**. Test navigation and launching an app.

On a rooted TV with working Homebrew Channel and Python 3.7 or newer, Home
prepares its bundled helper automatically. No separate file transfer or SSH
installation is needed. The helper code is inside the IPK; it is not downloaded
or installed into `/var/lib`.

A fresh setup leaves the Home-button assignment unchanged and all background
controls on **Allow**. To change them, use **Settings → Remote buttons** and
**Settings → Background activity**. Setup does not root a TV or change service
permissions. The helper's native integrations remain C5-specific; see
[Compatibility](COMPATIBILITY.md) before enabling them on another TV.

**Settings → Input previews** shows helper setup status and a retry button when
setup fails. Missing files, unavailable Homebrew execution and an explicit
non-root result are different errors. Cached images appear only after an eligible
HDMI input has been viewed; an input label is not evidence that a picture exists.

Developer Mode-only installations can use the launcher and native input names
where the firmware permits the read. Helper features stay unavailable, with icon
fallbacks for cached pictures. Keep Developer Mode active according to
[Homebrew's guide](https://www.webosbrew.org/devmode/).

## Upgrade

Install the new IPK over the existing app, then open **Home**. Setup stops a
recognized old worker before migrating its settings or starting new code. It
removes only the exact reviewed old startup hook. It will not overwrite an
unknown script, a foreign symlink, or conflicting configurations.

Settings and saved restoration values from `/var/lib/openxmb-c5/background.json`
are migrated to `/var/lib/lg-xmb/background.json` when present. The old file is
preserved, and a migration record prevents later upgrades from importing stale
choices again. Do not delete configuration files as an upgrade step: they may
contain the only record of settings that need restoring.

The installed application ID remains `org.local.openxmb.c5` solely to preserve
in-place upgrades and existing Home assignments. Project and runtime names use
`lg-xmb`; changing the installation ID would create a different app.

## Files on the TV

| Path | Purpose |
| --- | --- |
| Installed app's `helper/` directory | Matching controller, capture worker and recovery code |
| `/var/lib/lg-xmb/background.json` | Choices and saved restoration values |
| `/tmp/lg-xmb-thumbnails` | Volatile HDMI pictures and capture status |
| `/tmp/lg-xmb-controls` | Volatile controller state and launch leases |
| `/var/lib/webosbrew/init.d/60-lg-xmb` | Symlink to the app's `helper-startup.py` |
| `/var/lib/webosbrew/lg-xmb-startup.log` | Bounded startup record |

The app owns the startup target. Removing the app breaks that link, preventing
future boot starts. Removing it does not restore LG settings automatically.

## Return to LG Home and remove

In **Settings → Remote buttons**, select **LG Home**. In **Background activity**,
set any managed entries to **Allow** and confirm restoration before uninstalling.
The Back preference is local to this menu and does not remap other applications.

For a rooted installation, the guarded recovery commands below stop the worker,
remove its startup links and restore saved background values. Run them before
removing the app. A launcher-only installation can be removed normally in the
TV's app manager or Dev Manager.

```sh
APP=/media/developer/apps/usr/palm/applications/org.local.openxmb.c5
/usr/bin/python3 -I -B "$APP/helper/stop_thumbnail_helper.py"
/usr/bin/python3 -I -B "$APP/helper/process_control.py" restore
luna-send -n 1 luna://com.webos.applicationManager/setDefaultApp '{"category":"home","appId":"com.webos.app.home"}'
luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}'
```

Check each result. Do not force removal past a refused identity or restoration
check. Saved files remain for recovery; there is no recursive cleanup of unknown
files. Do not reopen Home between stopping its helper and uninstalling it, since
normal startup prepares the helper again.

## Build

Use Node.js 20 or newer on your computer:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run package
npm run verify:package
```

The IPK and checksum are in `dist/`. The packager stages the helper from its
reviewed sources without putting generated files in `app/`. CI also checks the
bytes and permissions of every helper module inside the actual IPK:

```sh
python3 tools/verify-helper-package.py dist/org.local.openxmb.c5_0.1.12_all.ipk
```

A manifest change requires updating the controller's reviewed manifest pin in
the same commit. Packaging rejects a mismatched pin. Keep matching source with
each build, and do not commit device credentials, cached pictures or TV state.
