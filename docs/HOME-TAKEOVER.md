# Replacing LG Home

A bind mount makes LG-XMB run as `com.webos.app.home`. On the development C5,
this covers both the Home button and the return path after closing an app.
Installing the developer IPK alone doesn't do this.

This is a **manual, root-only setup** for the LG C5 running webOS 10.3.1. The repo
doesn't include an automatic Home-mount installer. Keep working SSH access and
test recovery before adding a persistent startup hook.

## Before mounting

Start with the Home button opening stock LG Home. Undo an earlier launcher
assignment or bind mount first. Don't change the read-only system partition.

[Build the package](BUILDING.md) and install its IPK normally. Keep the developer
app installed: its original manifest and helper bundle remain the trust anchor.
The Home payload is a copy, not a replacement for that installation.

Copy the **contents** of `.build/package/app/` to a new root-owned directory,
`/var/lib/lg-xmb-home/`, on the TV. Use the staged app from the same build as the
installed IPK, not the unstaged source `app/` directory.

For a fresh destination, a POSIX shell on your computer can do this:

```sh
TV=root@192.0.2.10  # Replace with your TV's existing SSH connection.
ssh "$TV" 'test ! -e /var/lib/lg-xmb-home' &&
scp -r .build/package/app "$TV":/var/lib/lg-xmb-home
```

The check refuses an existing destination. For an update, use the procedure
below rather than copying a second `app/` directory inside the payload.

## Prepare the payload

Run these commands in the TV's root shell, while stock LG Home is still visible
at its original path:

```sh
APP=/var/lib/lg-xmb-home
TARGET=/usr/palm/applications/com.webos.app.home
DEV=/media/developer/apps/usr/palm/applications/org.local.openxmb.c5

/usr/bin/python3 -I -B - <<'PYTHON'
import json
from pathlib import Path

payload = Path('/var/lib/lg-xmb-home/appinfo.json')
stock = Path('/usr/palm/applications/com.webos.app.home/appinfo.json')
app = json.loads(payload.read_text())
original = json.loads(stock.read_text())
if app.get('id') != 'org.local.openxmb.c5' or app.get('type') != 'web':
    raise SystemExit('Expected a fresh staged LG-XMB payload.')
if original.get('id') != 'com.webos.app.home' or original.get('type') == 'web':
    raise SystemExit('Restore stock LG Home before preparing the payload.')
app['id'] = 'com.webos.app.home'
for key in ('supportQuickStart', 'handleScreenRemoteKey',
            'noSplashOnLaunch', 'splashBackground'):
    if key in original:
        app[key] = original[key]
payload.write_text(json.dumps(app, indent=2) + '\n')
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
ln -s /tmp/lg-xmb-thumbnails "$APP/thumbnails"
/usr/bin/python3 -I -B "$DEV/helper-startup.py" ensure
```

The links may point to files that don't exist yet. Don't force replacement if
`ln` reports an existing entry. The verified bootstrap prepares `user-sounds/`
links in the payload separately. Check its result before mounting.

## Mount and check

```sh
mount --bind "$APP" "$TARGET"
systemctl restart sam

[ "$TARGET" -ef "$APP" ] && echo 'LG-XMB payload is mounted.'
luna-send -n 1 -a com.webos.surfacemanager \
  luna://com.webos.applicationManager/getAppInfo '{"id":"com.webos.app.home"}'
```

The app's `folderPath` stays the built-in path, but its type and version should
match the payload. Test the Home button, closing a native app and returning from
HDMI. The stock Home app can't be launched while this mount is active: anything
that opens `com.webos.app.home` opens LG-XMB instead.

Don't rely on the device name printed by `mount` to identify the bind.
`[ "$TARGET" -ef "$APP" ]` compares the directories, and `/proc/self/mountinfo`
shows the mounted subtree.

The stock files remain underneath the bind mount. A full restart removes this
mount unless a separate startup hook reapplies it. Standby isn't a full restart.
The helper's `60-lg-xmb` hook starts capture; it doesn't mount the Home payload.

## Updating the payload

Disable any Home-mount startup hook you added, then restore LG Home as below.
Install the new developer IPK, move the old payload aside and copy a fresh staged
payload from that same build. Repeat the manifest and link preparation, then
mount and test it before re-enabling your hook.

The two copies must have matching versions and matching helper, index and
sound-loader files. An in-place file sync doesn't reload a running JavaScript
instance. Reopen Home after updating; **Reload sounds** alone doesn't rerun
privileged setup. See [Home sound repair](HOME-SOUND-REPAIR.md).

## Restore LG Home

Disable the Home-mount startup hook first, if you installed one. Then, from the
TV's root shell:

```sh
umount /usr/palm/applications/com.webos.app.home && systemctl restart sam
```

Check that the Home button and app-exit return reach stock LG Home. Don't remove
the developer app or its recovery helper until that works.

Don't delete the mounted payload to try to restore stock Home. Unmounting is
what exposes the original files again.

## Audio

LG Home's identity can create a media pipeline without connecting it to the
speakers. `connectMusicAudio` in `app/tv-bridge.js` connects background music
when playback starts. A player reporting “playing” doesn't prove audible output.
Menu effects use Web Audio instead; their file links are described in
[MENU-SOUNDS.md](MENU-SOUNDS.md).
