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

LG can reset the developer app tree to mode `0777` during a cold boot. Setup
repairs its `user-sounds/` directory to `0755` only after verifying every existing
entry is one of our exact sound links. It preserves the links and WAV files.
The protected Home directory is never repaired this way.

Developer code used for the Home identity comparison may also have reset modes.
Setup reads those files without executing or changing them, checks that they
stay unchanged during the read, and compares their bytes with the protected
Home copy. Root ownership, regular files, single links, and strict Home
permissions are still required.

Then select **Settings → Sound → Reload sounds**. Reload clears audio
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
