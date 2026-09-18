# Missing sounds after a Home update

The developer app and the bind-mounted Home payload are separate copies.
Updating only one can leave the running Home without valid sound links.

## Check the two copies

Install the developer IPK and copy the Home payload from the **same build**.
Keep the Home payload at `/var/lib/lg-xmb-home`. Its manifest must declare
`com.webos.app.home`, `type: web`, `main: index.html` and the developer app's
version.

These files must match the developer installation byte-for-byte:

- `helper-startup.py`
- `index.html`
- `menu-sounds.js`

The Home manifest intentionally differs. Don't replace the developer manifest
with it or change the helper's `APP_DIR`: privileged verification and execution
must stay anchored to the developer installation.

## Recreate the links

Reopen Home after both copies are updated. Normal helper setup rechecks
`user-sounds/` even if the capture worker is already running. It creates missing
links to the nine recognised filenames under `/media/internal/lg-xmb/Sounds/`.
Existing exact, root-owned links are kept.

Then select **Settings → Navigation sound → Reload sounds**. Reload clears audio
buffers and rereads clips; it doesn't run filesystem repair. A still-running
page after an in-place file sync needs normal helper setup before reloading
missing links can help.

The payload directory must be root-owned, not writable by other users, and
reachable without symlink ancestors. The helper leaves an unsafe, stale or
missing payload alone. It doesn't mount anything or change the WAV files.

## Read the failure

The bounded log is `/var/lib/webosbrew/lg-xmb-startup.log`.
`sound_path_unavailable` with `destination: home` means payload setup was refused.
Check its identity, file versions and ownership rather than bypassing the checks.
A rejected Home destination doesn't prevent developer-app links or capture setup.

For deployment and recovery, use [HOME-TAKEOVER.md](HOME-TAKEOVER.md).
For filenames and event mappings, use [MENU-SOUNDS.md](MENU-SOUNDS.md).

## Tests

```sh
python3 -B -m unittest discover -s tests -p '*sound_links.py'
node --test tests/menu-sounds.test.cjs tests/menu-navigation.test.cjs
```

The ownership tests use temporary paths in an isolated Linux root environment.
Never point them at a live TV filesystem. Browser navigation helpers use catalog
IDs, because HDMI entries aren't fixed row numbers.
