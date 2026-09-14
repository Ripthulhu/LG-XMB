# TV helper

The helper adds cached HDMI pictures, background controls and Home-button assignment to the web app. It uses an existing rooted Homebrew Channel environment; it creates no listener, root shell endpoint, service ACL change or firmware modification. See [installation and recovery](../docs/INSTALLATION.md).

## Components

| Source | Installed path |
| --- | --- |
| `thumbnail_cache.py` | Installed app's `helper/thumbnail_cache.py` |
| `process_control.py` | Installed app's `helper/process_control.py` |
| `../app/helper-startup.py` | App container; `init.d/60-openxmb-thumbnails` symlinks to it |
| `recovery/stop_thumbnail_helper.py` | `/var/lib/lg-xmb/stop-helper.py` |

The packaged startup entry starts one detached Python worker with
`--allow-home-preview --process-controls`, then exits without blocking boot.
It checks app presence and helper ownership before launching. The worker retains
its existing exact-manifest checks and lifetime lock. SIGTERM stops it cleanly;
there is no automatic restart loop.

Only the symlink belongs in `/var/lib/webosbrew/init.d`. Removing the app breaks
that link, preventing subsequent boot starts. The updated recovery utility
handles both the exact link (including a broken one) and reviewed legacy copies;
it never follows the link to remove the packaged script. Unrecognized hooks are
left alone. Restore settings before uninstalling; see the removal instructions.

`/var/lib/webosbrew/lg-xmb-startup.log` records the last launch request or spawn
failure. A new start replaces the small record; a duplicate start does not erase
it. Runtime status remains in the bounded JSON files under `/tmp/lg-xmb-*`.
The startup log alone does not confirm that the worker initialized successfully.

## Pictures

The capture worker polls at five-second intervals, requires a stable active HDMI source, and limits refreshes to one per input per minute. It uses the TV's existing VIDEO capture API, producing 480×270 PNGs. A live Home preview may be cropped using the TV's installed OpenCV and NumPy. The worker does not start an HDMI pipeline or disable content protection.

Files live under `/tmp/lg-xmb-thumbnails`, linked into the app as `thumbnails`. They disappear on restart and rebuild after an eligible input is viewed. Muted, disconnected or changed sources are not published. Atomic file replacement preserves a previous valid image if a capture fails. Capture protection decisions come from the TV; a valid PNG alone cannot establish whether an all-black picture is intended.

## Background controls

The fixed app list is LG Home, Web Browser, Search, HDMI 1–4 and Live TV. Selected apps have their preload temporarily disabled and close when this Home is active. Explicit launches receive a short lease; foreground apps and active live previews are protected. Returning to Home allows selected apps to close again.

Privacy entries control only:

- **Usage history & AI nudges:** `user-context-manager.service` and `nudge.service`.
- **LG voice commands:** `voiceconductor.service`.
- **LG advertising service:** the verified `admanager` process.

Allow restores saved preload settings and services that were previously active. Privacy services may need Allow before their features work again. Restart attempts are bounded; no unit is masked, and no SIGKILL is used. Security, DRM, networking, audio, casting and microphone muting are outside this controller.

Persistent choices and rollback values are stored in root-owned `/var/lib/lg-xmb/background.json`. Status and short launch leases use `/tmp/lg-xmb-controls`. Configurations are revisioned, locked and atomically replaced. Existing configurations are preserved during upgrades.

## Fixed command interface

Run the bundled `helper/process_control.py` with `/usr/bin/python3 -I -B`:

| Command | Purpose |
| --- | --- |
| `get` | Read choices and current status |
| `set <key> <0\|1> <revision>` | Change one fixed background choice |
| `prepare <app-id>` | Protect one known app's explicit launch |
| `remote-get` | Read actual Home assignment and revision |
| `remote-set <custom\|stock> <revision>` | Assign Home to this app or LG Home |
| `restore` | Restore all saved background settings; recovery only |

The web app uses a fixed adapter over the existing Homebrew Channel `exec` service. It accepts no arbitrary paths, commands, service names or app IDs. Requests return bounded JSON, and writes are not automatically retried after timeouts.

Stock Home assignment first allows LG Home and restores its saved preload. Other background choices remain unchanged. Custom assignment does not automatically re-enable LG Home cleanup. Readback verifies that unrelated default apps and the last-app policy remain unchanged. Unknown third-party Home assignments are left untouched.

Back behavior stays in the web app. It either keeps the main menu open or invokes the normal platform Back handler after closing any open panel.

## Startup integrity

The controller verifies root ownership, anchored paths, file type, link count and exact app-manifest bytes. Its `PIN_APPINFO_SHA256` must match the packaged `app/appinfo.json`. If webOS resets this app directory and manifest to writable modes at boot, the helper repairs only those two verified entries to 0755/0644. Changed metadata or unsafe paths fail closed; shared ancestors are never modified.

A temporarily missing app gets up to 90 seconds to become available. The same checks run on subsequent polls. An ordinary full-system restart verified automatic startup of this repair mechanism in 0.1.11. The new packaged startup entry still needs a C5 reboot/removal test. Physical power removal and broad cross-model compatibility have not been established.

## Maintenance

Stop the helper before replacing either module or the app. Review any manifest change and update its pin together with the release. Keep old user configurations and saved restoration values. Run the unit tests and verify actual helper status, input pictures and Home routing on the target firmware before enabling startup.

Fresh defaults allow every background entry and contain no assumed rollback values. Automatic setup migrates existing choices and saved values without resetting them. Helper code ships in the IPK and is not copied into the persistent settings directory.
