# Optional PS3 menu sounds

Copy your extracted, capital-S **Sounds** folder to:

```text
/media/internal/lg-xmb/Sounds/
  snd_cancel.wav
  snd_category_decide.wav
  snd_cursor.wav
  snd_decide.wav
  snd_error.wav
  snd_option.wav
  snd_system_ng.wav
  snd_system_ok.wav
  snd_trophy.wav
```

Enable **Settings → Navigation sound → On**. The existing saved sound toggle is
preserved; its default remains Off. Use **Reload sounds** after copying or replacing
files while the launcher is open. The status shows how many of the six menu clips
loaded. No sound files are included in the source or installation package.

## LG-XMB event mapping

| Accepted menu action | Clip |
| --- | --- |
| Move between horizontal categories | snd_category_decide.wav |
| Move between rows or controls | snd_cursor.wav |
| Confirm a setting or launch an app/input | snd_decide.wav |
| Open a settings panel/subpanel | snd_option.wav |
| Back/close a panel | snd_cancel.wav |
| App/input launch reports failure | snd_error.wav |

This is LG-XMB's event mapping, not a claim that the full original PS3 sound-event
routing has been recovered. The remaining system OK/NG/trophy files may be left
in the folder, but are not played: this launcher has no corresponding system or
trophy events. Merely moving focus onto a category does not launch its app.

Missing or undecodable navigation clips use the existing generated click.
Other missing clips are silent. Missing files are not retried on every press.
Partial packs work independently, and Reload sounds invalidates cached buffers
and uses a new resource query so replacement files can be reread.

## Local file access and packaging

After its existing developer-bundle/identity validation, `helper-startup.py`
prepares the fixed `user-sounds/*.wav` aliases in the developer installation and,
when present and verified, **`/var/lib/lg-xmb-home`**. The latter is the payload
mounted over LG Home, so the running Home app sees these aliases too.

Every normal helper `ensure` rechecks the aliases, even when the capture worker
is already running and the helper bundle is unchanged. A deployment that syncs
only regular files can continue doing so: after the updated developer app and
Home payload have both been synced, the next Home startup/helper setup recreates
missing aliases. It does not copy arbitrary deployment symlinks. Existing exact,
root-owned aliases (including manually created ones) are kept in place.

The Home payload is a separate data destination, **not a new executable trust
anchor**. `APP_DIR`, helper verification and worker execution stay on the existing
developer installation. Home setup requires a root-owned, non-writable directory
with the expected Home manifest identity/version and byte-matching helper,
index and sound-loader files. Missing, stale or unsafe Home payloads are not
created or repaired; they are logged and do not prevent developer sound setup or
the capture worker. No access to the stock Home directory, mount changes or
permission broadening is added. See [Home sound repair](HOME-SOUND-REPAIR.md).

Only the nine known names are exposed. Links may be dangling, so the Sounds
folder can be dropped in later. Foreign entries are never followed or overwritten.
The helper never reads, copies, edits, chmods or deletes the user WAV files.

Rebuild/install and sync the updated Home payload, then reopen Home. No manual
symlink creation is needed for a matching, safely installed payload. This is a
startup repair, not a filesystem watcher: changing the payload without restarting
Home needs another normal helper setup before Reload sounds can read missing
aliases. Existing music behavior, app identities, manifest pins and media-service
permissions are unchanged.

The frontend loads **only these fixed app-relative WAV resources**, using XHR
with a 512 KiB encoded-file limit, two concurrent requests, a bounded deadline,
and Web Audio decoding. It checks a RIFF/WAVE header and bounds the retained
clip duration/channel count. `connect-src 'none'` becomes **`connect-src 'self'`**
for this local loader; no HTTP service, external origin, wildcard or root RPC
is added. All other product CSP directives are unchanged.

## Playback and lifecycle

Decoded effects share one Web Audio context. There are no `<audio>` elements for
effects, no per-press file I/O, and no UMI connect/disconnect calls from this feature.
This avoids competing with the streamed background music/native HDMI media player.
At most four effect voices can overlap. Very tight cursor bursts are capped and
an asynchronous context resume keeps only the newest recent request, never a queue
of stale clicks. Sample loads completing late never replay previous navigation.
Turning sound Off, hiding/leaving the page, and destroying the app stop voices.
Foreground restoration does not play anything until another accepted action.
Launches and menu animation never wait for audio completion.

LG documents Web Audio for effects alongside media, but also warns of
platform-dependent Web Audio latency. No specific TV latency or audibility is
certified by browser tests. The installed Home-identity app still needs a TV check
with the user's actual WAV files, alone and with background music/HDMI preview.
Reference: https://webostv.developer.lge.com/develop/guides/multi-sound-playback

## Tests

```sh
node --test tests/catalog.test.cjs tests/menu-sounds.test.cjs
node tests/catalog-browser.cjs
node tests/menu-sounds-browser.cjs
python3 -B -m unittest discover -s tests -p '*sound_links.py'
```

The sound browser test starts a loopback-only server and uses generated test PCM,
not proprietary audio. Its normal mode checks XHR/Web Audio under the product CSP.
`OFFLINE_SOUND_TRANSPORT=1` uses an injected byte transport and CSP-bypassed source
injection when local HTTP navigation is unavailable; this retains real Web Audio
decoding/playback-node tests but does not verify actual XHR/CSP enforcement.
Helper ownership tests require a Linux root test container and otherwise skip.
Never run these tests against `/media/internal` or another real TV data directory.
