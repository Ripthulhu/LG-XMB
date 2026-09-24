# Replacing LG Home

This is optional. For normal use, keep stock Home installed and assign the
Home button in [Remote settings](INSTALLATION.md#remote-settings-and-standalone-use).
The standalone launcher can discover apps without this replacement.

A bind mount makes LG-XMB run as `com.webos.app.home`. On the development C5,
this covers both the Home button and the return path after closing an app.
Installing the developer IPK alone doesn't do this.

This is a **manual, root-only setup**, tested on the LG C5 running webOS 10.3.1.
The webOS 22–26 browser target doesn't guarantee Home replacement on other TVs.
Keep working SSH access and test recovery before adding a startup hook.
Don't enable Developer Mode on a rooted TV.

Run the commands below in the TV's root shell, one block at a time. Check each
result before continuing. No computer-side installer or credentials file is
needed. The stock app files stay underneath the temporary mount.

## Before mounting

Start with the Home button opening stock LG Home. Undo an earlier launcher
assignment or bind mount first. Don't change the read-only system partition.

[Install the IPK](INSTALLATION.md) and test the standalone app first. Keep it
installed: the helper checks its original manifest and bundle. You can use a
release IPK or your own build. The copy below comes from that installed package.

Check the paths and current mount:

```sh
APP=/var/lib/lg-xmb-home
TARGET=/usr/palm/applications/com.webos.app.home
DEV=/media/developer/apps/usr/palm/applications/org.local.openxmb.c5

id
/usr/bin/python3 --version
/usr/bin/python3 -I -B -c 'import os, signal; fd = os.pidfd_open(os.getpid()); signal.pidfd_send_signal(fd, 0); os.close(fd)'
command -v mount
command -v systemctl
cat "$DEV/appinfo.json"
cat "$TARGET/appinfo.json"
awk '$5 == "/usr/palm/applications/com.webos.app.home" { print }' /proc/self/mountinfo
```

You need root, Python 3.9 or newer, `mount`, `systemctl` and Homebrew Channel.
The Python capability check must exit successfully; the refresh tool uses it
to reconnect LG's capture service without risking a signal to a reused process ID.
The last command must print nothing. If it shows a mount, restore that setup
first. The stock manifest must identify `com.webos.app.home`. Keep a copy of it
on your computer for reference.

Copy the installed app into a **new** directory:

```sh
(set -eu
  umask 022
  [ -f "$DEV/appinfo.json" ]
  mkdir -m 0755 "$APP"
  for source in "$DEV"/* "$DEV"/.[!.]* "$DEV"/..?*; do
    [ -e "$source" ] || [ -L "$source" ] || continue
    case "${source##*/}" in
      user-music.mp3|user-wallpaper.jpg|user-sounds|thumbnails) continue ;;
    esac
    cp -R "$source" "$APP/"
  done
)
```

`mkdir` must succeed. If the directory exists, follow
[Updating the payload](#updating-the-payload) instead. The excluded entries
are runtime links or link directories, not app code. Don't copy the source
repo's `app/` directory here: its helper hasn't been staged or pinned.

## Prepare the payload

Run these commands in the TV's root shell, while stock LG Home is still visible
at its original path:

```sh
/usr/bin/python3 -I -B - <<'PYTHON'
import json
from pathlib import Path

payload = Path('/var/lib/lg-xmb-home/appinfo.json')
stock = Path('/usr/palm/applications/com.webos.app.home/appinfo.json')
app = json.loads(payload.read_text(encoding='utf-8'))
original = json.loads(stock.read_text(encoding='utf-8'))
if app.get('id') != 'org.local.openxmb.c5' or app.get('type') != 'web':
    raise SystemExit('Expected a fresh staged LG-XMB payload.')
if original.get('id') != 'com.webos.app.home':
    raise SystemExit('Restore stock LG Home before preparing the payload.')
app['id'] = 'com.webos.app.home'
for key in ('supportQuickStart', 'handleScreenRemoteKey',
            'noSplashOnLaunch', 'splashBackground'):
    if key in original:
        app[key] = original[key]
payload.write_text(json.dumps(app, indent=2) + '\n', encoding='utf-8')
PYTHON
```

Check that the Python command succeeded before continuing. It changes only the
payload manifest. Don't copy that manifest back into the developer app, because
its helper verifies the original manifest bytes.

The stock Home declarations matter. On the C5, omitting `supportQuickStart`
prevented Wake-on-LAN from working despite the TV's Quick Start setting being on.
Other firmware may need different declarations; copying just the app ID isn't
a general compatibility guarantee.

Set modes only inside this new payload, then add its fixed data links:

```sh
find "$APP" -type d -exec chmod 0755 {} +
find "$APP" -type f -exec chmod 0644 {} +
chmod 0755 "$APP/helper-startup.py"
ln -s /media/internal/lg-xmb/background.mp3 "$APP/user-music.mp3"
ln -s /media/internal/lg-xmb/wallpaper.jpg "$APP/user-wallpaper.jpg"
ln -s /tmp/lg-xmb-thumbnails "$APP/thumbnails"
/usr/bin/python3 -I -B "$DEV/helper-startup.py" ensure
```

The links may point to files that don't exist yet. Don't force replacement if
`ln` reports an existing entry. The bootstrap prepares `user-sounds/` and creates
the wallpaper link in a matching Home payload. See [Wallpaper](BACKGROUND.md).
Check its JSON result and `/var/lib/webosbrew/lg-xmb-startup.log`. The log should
include `sound_paths_ready` for `home`; capture setup can succeed while sound
setup fails. Fix errors before mounting.

## Mount and check

Copy [refresh-home-registration.py](../tools/refresh-home-registration.py) to
`/var/lib/lg-xmb/refresh-home-registration.py` on the TV. Keep it owned by root,
mode `0644`. Open Home and stop any recording or casting session before this
step. The script refreshes the app registration and reconnects the media
server to it; it does not mount files or change settings.

```sh
(set -eu
  if awk '$5 == "/usr/palm/applications/com.webos.app.home" { found=1 }
          END { exit !found }' /proc/self/mountinfo; then
    echo 'Home already has a mount. Restore it before continuing.' >&2
    exit 1
  fi
  for file in helper-startup.py index.html app.js input-preview.js tv-bridge.js menu-sounds.js; do
    cmp "$APP/$file" "$DEV/$file"
  done
  mount --bind "$APP" "$TARGET"
  /usr/bin/python3 -I -B /var/lib/lg-xmb/refresh-home-registration.py
)

[ "$TARGET" -ef "$APP" ] && echo 'LG-XMB payload is mounted.'
luna-send -n 1 -a com.webos.surfacemanager \
  luna://com.webos.applicationManager/getAppInfo '{"id":"com.webos.app.home"}'
```

The app's `folderPath` stays the built-in path, but its type and version should
match the payload. Test the Home button, closing a native app and returning from
HDMI. The stock Home app can't be launched while this mount is active: anything
that opens `com.webos.app.home` opens LG-XMB instead.

The refresh interrupts Home and its audio. Check its JSON result for
`"returnValue": true` and `"mediaObserver": true`. If it fails, the mount is
still active. Keep the reported error and use the recovery commands below.

Do not replace this step with `systemctl restart sam`. On the C5, that restart
can leave the media server without app lifecycle updates. The TV may look fine
at first, then wake to black HDMI with no sound. The refresh stops media before
restarting the app manager and checks that the media subscription is restored.
If LG's capture service was already running, it reconnects that service too.
It runs only during this setup step; it is not a wake-up watchdog.

Don't rely on the device name printed by `mount` to identify the bind.
`[ "$TARGET" -ef "$APP" ]` compares the directories, and `/proc/self/mountinfo`
shows the mounted subtree.

The stock files remain underneath the bind mount. A full restart removes this
mount unless a separate startup hook reapplies it. The TV can also reboot in
the background while in standby, so the hook must handle that boot too.
The helper's `60-lg-xmb` hook starts capture; it doesn't mount the Home payload.

## Keep it after a reboot

First [restore LG Home](#restore-lg-home) and check that Home and app-exit return
work. Then repeat the mount check above. Only add the hook after both paths work.

Create `/var/lib/webosbrew/init.d/61-lg-xmb-home` with the following contents.
Use a text editor over SSH or transfer the file yourself. Save it with LF line
endings, owned by root, mode `0755`. Inspect an existing hook before replacing
anything. Keep its previous copy outside `init.d`.

```sh
#!/bin/sh
set -eu
APP=/var/lib/lg-xmb-home
TARGET=/usr/palm/applications/com.webos.app.home
DEV=/media/developer/apps/usr/palm/applications/org.local.openxmb.c5

[ -f "$APP/appinfo.json" ] || exit 0
[ ! -L "$APP" ]
[ ! -L "$TARGET" ]
mounts=$(awk '$5 == "/usr/palm/applications/com.webos.app.home" { n++ }
              END { print n+0 }' /proc/self/mountinfo)
if [ "$mounts" -eq 1 ] && [ "$TARGET" -ef "$APP" ]; then
  exec /usr/bin/python3 -I -B /var/lib/lg-xmb/refresh-home-registration.py --startup
fi
if [ "$mounts" -ne 0 ]; then
  echo 'Home already has a different mount. Leaving it alone.' >&2
  exit 1
fi

/usr/bin/python3 -I -B "$DEV/helper-startup.py" ensure
for file in helper-startup.py index.html app.js input-preview.js tv-bridge.js menu-sounds.js; do
  cmp "$APP/$file" "$DEV/$file"
done
mount --bind "$APP" "$TARGET"
exec /usr/bin/python3 -I -B /var/lib/lg-xmb/refresh-home-registration.py --startup
```

This hook leaves the copied app's manifest and permissions as you prepared them.
It refuses an existing foreign mount.
The helper check also runs here because startup hooks may run concurrently.
`--startup` also handles a boot that restores HDMI before the hook runs. It
reopens that input after refreshing Home, provided the TV is still active and
you haven't switched to another app. Recordings and casting still block refresh.
If LG has already fallen back to Home, the hook reads `general.homeAutoLaunch`.
When it is `off` (Recent Input), it restores the saved physical HDMI input or
Live TV after the refresh. It leaves Home selected when Home Auto Launch is on
or the setting is unavailable. A standby boot never launches the saved input.
Settings changes during the refresh cancel that restoration. An already
registered payload remains a no-op; this is not a watcher for ordinary wakes.

Test the saved hook from SSH before rebooting. If the matching payload is
registered and the media subscription is healthy, it should report
`"changed": false` without restarting services. Then cold boot
and check SSH, Home, app exit, HDMI video/audio, music and a fresh cached preview.
Keep your recovery copy outside `init.d`; changing a hook's filename there may
not disable it.

## Updating the payload

Follow [Restore LG Home](#restore-lg-home) first. This moves the hook out of
`init.d` and unmounts the old payload. Then move the unmounted copy aside:

```sh
backup=/var/lib/lg-xmb-home-backup-$(date +%Y%m%d-%H%M%S)-$$
(set -eu
  if awk '$5 == "/usr/palm/applications/com.webos.app.home" { found=1 }
          END { exit !found }' /proc/self/mountinfo; then
    echo 'Unmount Home before moving its files.' >&2
    exit 1
  fi
  [ ! -e "$backup" ]
  [ ! -L "$backup" ]
  mv /var/lib/lg-xmb-home "$backup"
)
```

Install the new IPK, test the standalone app, then repeat the copy, manifest,
link and mount steps with the newly installed files. Restore your saved hook
only after the new copy works. Keep the previous IPK and payload for rollback.

The two copies must have matching versions and matching helper, index and
sound-loader files. An in-place file sync doesn't reload a running JavaScript
instance. Reopen Home after updating; **Reload sounds** alone doesn't rerun
privileged setup. See [Home sound repair](HOME-SOUND-REPAIR.md).

## Restore LG Home

Move the Home-mount hook out of `init.d` first, if you created it:

```sh
saved_hook=/var/lib/lg-xmb-home-hook-$(date +%Y%m%d-%H%M%S)-$$
(set -eu
  [ ! -e "$saved_hook" ]
  [ ! -L "$saved_hook" ]
  mv /var/lib/webosbrew/init.d/61-lg-xmb-home "$saved_hook"
)
```

If you used a different hook name, disable that one instead. Leave the capture
helper's `60-lg-xmb` hook alone. To restore your saved Home hook after a tested
update, move it back to its original path, checking that the path is unused.

Check that our payload is the one mounted, then unmount it:

```sh
(set -eu
  [ /usr/palm/applications/com.webos.app.home -ef /var/lib/lg-xmb-home ]
  umount /usr/palm/applications/com.webos.app.home
)
```

With the Home-mount hook safely outside `init.d`, reboot the TV from SSH:

```sh
reboot
```

This lets LG's services start in their normal order with the stock manifest.
Check that the Home button and app-exit return reach stock LG Home. Don't remove
the developer app or its recovery helper until that works.

Don't delete the mounted payload to try to restore stock Home. Unmounting is
what exposes the original files again.

If there's no mount, stock Home is already exposed. If unmounting fails, keep
the payload in place and inspect `/proc/self/mountinfo`. Don't stack another
mount or use forced unmounting. With the Home hook disabled, a full restart
also clears the temporary mount.

## Audio

LG Home's identity can create a media pipeline without connecting it to the
speakers. `connectMusicAudio` in `app/tv-bridge.js` connects background music
when playback starts. A player reporting “playing” doesn't prove audible output.
Menu effects use Web Audio instead; their file links are described in
[MENU-SOUNDS.md](MENU-SOUNDS.md).
