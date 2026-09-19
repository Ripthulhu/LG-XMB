# Menu sounds

Menu sounds are off by default. Copy your WAV files into
`/media/internal/lg-xmb/Sounds/`, then enable
**Settings → Sound → Navigation sound → On**. Names are case-sensitive.

| Action | File |
| --- | --- |
| Change category | `snd_category_decide.wav` |
| Move between rows or controls | `snd_cursor.wav` |
| Confirm a setting or launch an item | `snd_decide.wav` |
| Open a settings panel | `snd_option.wav` |
| Back or close a panel | `snd_cancel.wav` |
| App or input launch fails | `snd_error.wav` |

The status reports how many of these six clips loaded. Select **Reload sounds**
after copying or replacing files. No recordings are included or downloaded.

`snd_system_ng.wav`, `snd_system_ok.wav` and `snd_trophy.wav` may also be left in
the folder, but LG-XMB doesn't play them. There are no matching system or trophy
events in this launcher.

Missing category and cursor clips use a generated click. Other missing clips
stay silent. A failed load doesn't retry on every button press.

## File access

The rooted helper prepares fixed `user-sounds/` links inside the developer app.
It also prepares them in `/var/lib/lg-xmb-home` when that payload passes its
identity and file checks. Normal startup rechecks the links even when the
capture worker is already running.

The Home payload and developer app need matching versions and matching
`helper-startup.py`, `index.html` and `menu-sounds.js` bytes. Installing a new IPK
without updating the copied Home payload leaves them mismatched.
See [Home sound repair](HOME-SOUND-REPAIR.md).

Only the nine known filenames can be linked. The helper doesn't modify your
recordings or replace unknown entries. Links can exist before the WAV files do.
A missing or rejected Home payload doesn't prevent developer-app sound setup
or the capture worker from starting.

The browser reads app-relative WAV files with same-origin XHR. Each encoded
file is limited to 512 KiB. Two loads can run at once, with bounded timeouts and
checks on decoded duration and channel count. `connect-src 'self'` permits this
local loader; it doesn't allow an external audio service.

## Playback

Effects use one Web Audio context, not a media pipeline per clip. Up to four
voices can overlap. Cursor bursts are limited, and late loads don't replay old
button presses. Navigation doesn't wait for playback.

Turning sounds off or leaving Home stops active effects. Returning doesn't play
anything until another accepted action. Background music uses a separate player;
its Home-identity audio connection is covered in [MUSIC.md](MUSIC.md).

## Tests

```sh
node --test tests/menu-sounds.test.cjs
node tests/menu-sounds-browser.cjs
python3 -B -m unittest discover -s tests -p '*sound_links.py'
```

The browser test uses generated PCM rather than recordings. Its normal mode
checks XHR and Web Audio under the product's CSP. `OFFLINE_SOUND_TRANSPORT=1`
substitutes the transport, so it doesn't verify XHR or CSP enforcement.
Ownership tests need an isolated Linux root environment. Check actual audibility
and latency on the TV with your files.
