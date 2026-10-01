# TV helper

The helper keeps recent HDMI pictures, prepares app-relative links to your
optional audio files and runs the optional Home-button listener. It needs root,
an elevated Homebrew Channel service and Python 2.7 or Python 3. It does not
replace LG Home or stop background services.

The helper ships inside the IPK. See
[installation and removal](../docs/INSTALLATION.md) for normal use.

## Components

| Source | Role |
| --- | --- |
| `app/helper-startup.py` | Verify the bundle, prepare paths and restore enabled workers |
| `tv-helper/thumbnail_cache.py` | Poll eligible HDMI sources and capture thumbnails |
| `tv-helper/home_button.py` | Read/save the Home choice and launch LG-XMB on Home |
| `tv-helper/home_hook.py` | Verify, load and monitor the native Home hook |
| `tv-helper/native/` | Home-only input hook, pinned dependencies and ARM32 build artifacts |
| `tv-helper/recovery/stop_thumbnail_helper.py` | Stop recognised workers and remove recognised startup hooks |
| `tv-helper/bundle-sources.json` | Shared source inventory for packaging and verification |
| `tools/stage-helper.mjs` | Copy helper sources and generate package hashes |

The bootstrap runs through Homebrew Channel's existing `exec` service. It starts
or reuses the detached capture worker with `--allow-home-preview`, restores the
Home-button listener only if previously enabled, then exits. The workers handle
SIGTERM and release their resources.

`/var/lib/webosbrew/init.d/60-lg-xmb` is a link to the packaged bootstrap.
Removing the app leaves a broken link rather than an executable copy of old
helper code. Recovery accepts that exact root-owned link and recognised legacy
hooks; it leaves foreign entries alone. The same bootstrap restores the saved
Home choice after boot without launching LG-XMB or changing Power On Screen.

## Home button

The native hook observes Home inside LG's input services. It replaces the old
exclusive remote-device grab; other buttons, pointer movement and wheel events
stay on LG's input path. It handles infrared and Magic Remote Home events; see
[Compatibility](../docs/COMPATIBILITY.md#home-button-routing) for the tested TVs
and remotes.

The shipped payload supports 32-bit ARM input processes. Other process
architectures are reported as unsupported. The Python controller verifies the
payload before copying it to `/var/lib/lg-xmb/native/<build-id>/`, then loads it
without restarting an LG service. An older LG-XMB hook already loaded into the
process requires a TV restart. Other input hooks are reported as conflicts;
hooks are not stacked.

Home opens LG-XMB once per press, including a hold. LG's native long-Home action
is unavailable while enabled. Choosing **LG Home** removes the controller's
lease immediately. The hook also stops intercepting when its lease expires
after two seconds or it cannot deliver a Home event. Its code can remain loaded
until the LG process exits, but without a valid lease Home follows the stock path.

`/var/lib/lg-xmb/home-button.json` stores the choice. Reading it is read-only
and does not start a worker or call the native assignment API. The check mark
shows this choice; running status also requires a live native lease. Select
the checked **LG-XMB** choice to retry. Only an explicit choice can clear an old
native Home assignment to `org.local.openxmb.c5`; other apps' assignments are
preserved. An active Home replacement blocks this setting until restored.

Recovery recognises both the capture worker and the exact
`helper-startup.py home-button-worker` process. It checks process identity
before stopping either and removes only recognised startup hooks. Stopping the
Home worker removes its lease; it never kills or restarts an LG input service.

The bootstrap selects `/usr/bin/python3`, `/usr/bin/python`, then
`/usr/bin/python2`. Environment, site and script-directory imports are disabled.
Home routing and capture use the same code on both Python versions.
The capture process loads installed system packages for its optional crop path
only after removing its script directory from the import path. Directory operations
stay anchored to open descriptors through `/proc/self/fd`, including on Python 2.

## Capture

The worker polls every five seconds. A source must remain stable for five
seconds, and capture attempts are limited to once per source/context per minute.
It uses the TV's `VIDEO` capture API and publishes 480 × 270 PNGs.

The optional live-preview crop path uses installed OpenCV and NumPy. Its output
geometry is specific to the C5. The helper doesn't start an HDMI pipeline or
bypass capture protection. A black PNG isn't proof that capture protection was
absent.

Pictures and `status.json` live in `/tmp/lg-xmb-thumbnails`, linked into the
developer app as `thumbnails`. The cache is temporary. Changed, disconnected or
muted sources aren't published. Atomic replacement preserves an earlier picture
when a new attempt fails.

Live previews can also be captured when LG-XMB runs as `com.webos.app.home`.
The worker verifies that the active Home mount is our protected payload, with
the same version and preview code as the pinned developer app. Matching the
app ID alone is insufficient. File identities are rechecked after capture and
cropping; a changed mount or file discards the pending picture.

## Verification and state

The bootstrap verifies root ownership, anchored paths, file types and the
package's hashes. `thumbnail_cache.py` also pins the exact developer manifest in
`PIN_APPINFO_SHA256`. Don't broaden these checks when porting to another model.

LG can reset app-tree modes at boot. The helper repairs only verified entries
it owns, using held file descriptors. It doesn't change shared installation
ancestors. A missing app is given a bounded readiness wait; rejected metadata
stops the worker.

`/var/lib/lg-xmb/installed.json` records the installed bundle. Setup and worker
locks prevent overlapping starts. The root-only startup log is
`/var/lib/webosbrew/lg-xmb-startup.log`, bounded to 16 KiB. Check capture status
as well as that log: a launch request isn't proof that a picture was captured.

The frontend checks the heartbeat when Home resumes. A previously confirmed
worker gets ten seconds to wake; a stale, stopped or explicitly missing status
then permits one setup attempt. Ambiguous read or setup failures require manual
Retry. Input preview settings refresh health while open and stop polling when
closed or hidden. Recovery refreshes the selected cached picture once.

To add a packaged helper module, update `bundle-sources.json`. The packager
generates the hashes and pins the complete manifest into the bootstrap. The
bootstrap verifies every listed file before loading its named entry points.
Native files and their build metadata use the same pinned inventory. The
packager rejects native artifacts whose source or binary hashes have changed;
see [rebuilding the Home hook](../docs/BUILDING.md#rebuild-the-native-home-hook).

## Audio links

Music uses the developer app's `user-music.mp3` link to
`/media/internal/lg-xmb/background.mp3`. Sound effects use fixed `user-sounds/`
links to files in `/media/internal/lg-xmb/Sounds/`.

Sound-link setup also handles a verified `/var/lib/lg-xmb-home` payload. This
is a data destination, not a second executable trust anchor. It doesn't update
or mount the payload. Read [Home sound repair](../docs/HOME-SOUND-REPAIR.md) for
its matching-file checks.

Audio setup doesn't read, replace or change permissions on your recordings.
A failure in optional audio preparation doesn't block capture setup.

## Tests

```sh
python3 -B -m unittest discover -s tests -p 'test_*.py'
python3 -B -m unittest discover -s tv-helper -p 'test_*.py'
python3 -B -m unittest discover -s tv-helper/recovery -p 'test_*.py'
npm run test:helper
```

To check the older Home path, run `python2.7 -E -s -S -B tests/check_home_python.py`
as root in a local Linux test environment. It uses a temporary directory under
`/root`; it does not call TV services or open remote devices. The same check runs
on Python 3. `tests/check_capture_python.py` checks capture, setup and recovery
in the same local environment. Physical Home, pointer and capture behaviour
still need a TV test.

Run from the repository root. Ownership tests need an isolated Linux root
environment and otherwise skip. Test packaged startup, reboot, capture and
recovery on the TV before claiming support for its firmware.
