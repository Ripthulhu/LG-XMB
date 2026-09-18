# TV helper

The helper keeps recent HDMI pictures and prepares app-relative links to your
optional audio files. It uses an existing rooted Homebrew Channel environment.
It doesn't replace LG Home, assign remote buttons or stop background services.

The helper ships inside the IPK. See
[installation and removal](../docs/INSTALLATION.md) for normal use.

## Components

| Source | Role |
| --- | --- |
| `app/helper-startup.py` | Verify the bundle, prepare paths and start or reuse the worker |
| `tv-helper/thumbnail_cache.py` | Poll eligible HDMI sources and capture thumbnails |
| `tv-helper/recovery/stop_thumbnail_helper.py` | Stop recognised workers and remove recognised startup hooks |
| `tools/stage-helper.mjs` | Copy helper sources and generate package hashes |

The bootstrap runs through Homebrew Channel's existing `exec` service. It starts
one detached Python worker with `--allow-home-preview` and exits. It doesn't add
a listener or retry loop. The worker handles SIGTERM and exits cleanly.

`/var/lib/webosbrew/init.d/60-lg-xmb` is a link to the packaged bootstrap.
Removing the app leaves a broken link rather than an executable copy of old
helper code. Recovery accepts that exact root-owned link and recognised legacy
hooks; it leaves foreign entries alone.

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
```

Run from the repository root. Ownership tests need an isolated Linux root
environment and otherwise skip. Test packaged startup, reboot, capture and
recovery on the TV before claiming support for its firmware.
