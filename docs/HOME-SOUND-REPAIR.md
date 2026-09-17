# Home-takeover sound aliases and category-aware tests

## Runtime repair

`/media/internal/lg-xmb/Sounds/` remains the only source of optional PS3 WAVs.
The developer helper prepares nine fixed app-relative links in both destinations:

- `/media/developer/apps/usr/palm/applications/org.local.openxmb.c5/user-sounds/`
- `/var/lib/lg-xmb-home/user-sounds/`, when the Home payload is present and verified.

The second directory is inside the payload bind-mounted over
`/usr/palm/applications/com.webos.app.home`. Preparing the payload rather than
writing through the mount also works before the bind is installed at boot and
never writes into the stock Home tree.

Every `ensure` repairs missing aliases after regular-file-only payload sync.
It runs after bundle verification, even with an unchanged bundle and an already
running capture worker. Exact existing root-owned aliases are accepted without
replacement. User WAVs are never opened by the helper, modified, copied, or
required to exist while aliases are created.

Do not replace the executable `APP_DIR` with a path supplied by the caller or
resolved from `__file__`. The developer install remains the trust anchor. The
optional Home destination must be root-owned and not group/other writable,
with no symlink ancestors. Its manifest must be a `web` app named
`com.webos.app.home`, with `main: index.html` and the same version as the verified
developer app. `helper-startup.py`, `index.html` and `menu-sounds.js` must match
the developer copy byte-for-byte. The manifest itself intentionally differs
because takeover changes the app identity and preserves LG declarations.

A missing Home payload is left missing. Conflicts, unsafe paths, stale code or
mismatched identity fail closed and are recorded as `sound_path_unavailable`
with `destination: home` in the bounded startup log. Developer setup and capture
continue independently. This code does not chmod/chown a refused payload, start
a mount, alter app identities, change WAV playback, or add a new root API.

## Upgrade order

1. Build/install the updated developer app as usual.
2. Sync the same updated code into the Home payload, retaining the existing
   Home manifest transformation and the deployment's safe file permissions.
3. Reopen Home so normal helper setup runs. Enable Navigation sound or use
   Reload sounds after setup completes.

During an in-place sync that leaves the existing JavaScript instance alive,
startup does not rerun by itself. Reopening Home, or the existing helper setup
operation in the normal deployment path, is required. Reload sounds refreshes
buffers; it deliberately does not invoke a privileged filesystem repair.

## Browser regression repair

Tests now select categories and rows by their catalog IDs using the real
keyboard handler. HDMI items live under `tv`, alongside Live TV and LG Channels.
There is no `inputs` category, and HDMI 2 is not assumed to own `item-1`.

`tests/support/menu-navigation.cjs` resolves a bounded route through the current
catalog, sends arrow keys, and verifies the destination. It refuses unknown
IDs and navigation through an open modal. Row identity checks use the active
list and `data-item`; they still check DOM reuse, selected item, focus, live
preview release, stale reply rejection, media identity and label sanitization.

Returning to a non-HDMI TV row in the music tests explicitly selects Live TV;
just changing to `tv` can restore a remembered HDMI row and keep music paused.
The animation tests retain their 400 ms timing and pixel checks. Hidden/resize
tests now navigate right from Settings so they exercise a transition rather
than clamping at the leftmost category.

## Reproduce

```sh
node --test tests/catalog.test.cjs tests/menu-sounds.test.cjs tests/menu-navigation.test.cjs
python3 -B -m unittest discover -s tests -p '*sound_links.py'
```

The filesystem suites require a disposable Linux root test environment. They
create fixtures under `/root`, patch every TV data/destination path, and never
run against the actual device filesystem. Other platforms skip these suites.

For the normal browser suite, start `npm run preview` and run
`npm run test:browser`. The existing local PS3 renderer data packs are still
required for the WebGL assertions. `PLAYWRIGHT_CHANNEL=bundled` or
`PLAYWRIGHT_EXECUTABLE_PATH` is supported by the repaired standalone runners.
This repair does not downgrade WebGL assertions or replace the renderer in the
normal suite.

The supplied validation report distinguishes the source-injected menu tests
run here from the full URL-loaded renderer/media suite, which was not run here.
Actual Home bind mounting, installation, speaker output and latency still need
a TV check. No original PS3 sound data is included.
