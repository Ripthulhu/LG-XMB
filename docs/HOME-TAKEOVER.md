# Becoming the home screen on webOS TV

Makes your own app *be* `com.webos.app.home`, so the Home button and the app-exit
return both land on it. Tested on an LG C5 (OLED42C54LA) running webOS 10.3.1.

Setting `defaultApps.home` only claims the Home key. Closing a fullscreen app
takes a different path: `StarfishFullscreenController.qml` calls
`LS.applicationManager.launch(profile.idleApp)`, and `profile.idleApp` is pinned
to `com.webos.app.home` in a product layer on the read-only rootfs. `setConfigs`
returns `true` and writes nothing there, cause configd has no writable `profile`
category. So the only way to own that path is to own the app id.

## What doesn't work

SAM scans five app roots, listed in `ApplicationPaths` in `/etc/palm/sam-conf.json`:

    system_builtin    /mnt/otycabi/usr/palm/applications
    system_builtin    /mnt/otncabi/usr/palm/applications
    system_builtin    /usr/palm/applications
    system_updatable  /media/system/apps/usr/palm/applications
    store             /media/cryptofs/apps/usr/palm/applications
    dev               /media/developer/apps/usr/palm/applications

`system_updatable` really does shadow a built-in id, and LG uses it: on this TV
`com.webos.app.lgchannels` is `1.2.0` built-in and `2.3.0` updatable, and SAM
serves the updatable one. It picks by **version**, not by root order, so your
`appinfo.json` needs a version above the built-in's or it loses silently.

That still fails at launch though. Apps in that root get a DRM check and you get
`{"errorCode":-302,"errorText":"Failed to identify a proper DRM file"}`. Do note
this leaves the TV with no working home screen until you remove the directory,
cause SAM resolves the id to an app it then refuses to start.

The `dev` root skips the DRM check but won't shadow a built-in at all, whatever
version you give it.

## What works

Bind mount your app over the built-in path. SAM then reads it as
`system_builtin`, which isn't DRM checked.

```sh
APP=/var/lib/lg-xmb-home                       # your payload, anywhere writable
TARGET=/usr/palm/applications/com.webos.app.home

# appinfo.json id has to match the directory you are mounting onto
python3 - <<'PY'
import json
p = '/var/lib/lg-xmb-home/appinfo.json'
d = json.load(open(p))
d['id'] = 'com.webos.app.home'
json.dump(d, open(p, 'w'), indent=4)
PY

# LG resets modes to 0777 at boot and several checks reject group/other write
find "$APP" -type d -exec chmod 0755 {} +
find "$APP" -type f -exec chmod 0644 {} +

mount --bind "$APP" "$TARGET"
systemctl restart sam
```

Check it took. `folderPath` stays the built-in path, but `type` and `version`
become yours:

```sh
luna-send -n 1 -a com.webos.surfacemanager \
  luna://com.webos.applicationManager/getAppInfo '{"id":"com.webos.app.home"}'
```

To undo it:

```sh
umount /usr/palm/applications/com.webos.app.home && systemctl restart sam
```

## Copy the stock manifest's declarations, not just its id

Shadowing the id gets you the app slot. It does not get you anything the system
infers from the stock `appinfo.json`, and some of that is load-bearing.

Wake-on-LAN is the one that caught us. `tvpowerd` decides whether to arm
quick-start standby, which is the shallow sleep that leaves the network
interface powered, and it decides by asking SAM about the home app:

    strings /usr/sbin/tvpowerd | grep -i quickstart
    _ZN13QuickBootdMgr21check_quickStartValueEv
    {"properties":["id", "supportQuickStart", "defaultWindowType"]}
    %s=appId : %s,  supportQuickStart : %d
    read-[var/luna/preference/option] quickStartMode - %s

Stock Home declares `"supportQuickStart": true`. Ours did not, so SAM answered
`"notSpecified":["supportQuickStart"]`:

    luna-send -n 1 -a com.webos.surfacemanager       luna://com.webos.applicationManager/getAppInfo       '{"id":"com.webos.app.home","properties":["id","supportQuickStart"]}'

`quickStartMode` was already `on` in the TV's own settings. The setting was
never the problem, the app just wasn't claiming support, so `tvpowerd` skipped
arming it and the TV slept deep enough to stop answering the magic packet.
Adding the flag makes SAM answer `"supportQuickStart":true` and wake works
again.

Do note this is a class of bug, not one field. Diff both manifests before you
trust the mount, cause anything only the stock one declares is silently gone.
On this C5 that listed 14 keys. Tracing each one against the extracted rootfs
found these with a real consumer:

| key | read by |
| --- | --- |
| `supportQuickStart` | `/usr/sbin/tvpowerd`, arms quick-start standby |
| `handleScreenRemoteKey` | `qml/KeyFilters/appLaunch.js`, screen remote keys |
| `noSplashOnLaunch` | `WebOSCompositorBase` `ViewStateController.qml` |
| `splashBackground` | `StarfishFullscreenController`, `StarfishRecents` |
| `requiredPermissions` | `com.webos.service.secondscreen.gateway` interfaces |

The first three are worth declaring. `nativeLifeCycleInterfaceVersion` is read
by `flutter-client`, so it does nothing for a `type: "web"` app, and
`enablePigScreenSaver` is read by a library inside the stock app you just
shadowed. `mediumIcon` and `hasAccountService` had no consumer at all.

`class`, `visible` and `transparent` are declared by LG but I could not find
what reads them. They are not in `sam` and not in the compositor QML.

Only `supportQuickStart` has a confirmed symptom and a verified fix behind it.
The rest of this table is which files mention the key, not proof of what they do
with it.

## Gotchas

- The mount doesn't survive a reboot. That's useful while you're testing, cause
  a power cycle gets you back to stock. To keep it, re-apply from a Homebrew
  startup hook in `/var/lib/webosbrew/init.d/`.
- Don't ask `mount` whether your bind is up. Busybox prints a bind using the
  source *device*, so yours shows as `/dev/mmcblk0pNN on /usr/palm/...` and
  reads exactly like the stock partition being mounted there. It also can't
  tell your payload from a stale bind left by an earlier attempt. A bind makes
  the two paths the same directory, so compare them instead:

  ```sh
  [ "$TARGET" -ef "$APP" ] && exit 0   # already ours, nothing to do
  ```

  `/proc/self/mountinfo` is the other honest source: its fourth field is the
  subtree root, so your bind appears there as `/var/lib/lg-xmb-home` rather
  than `/`.
- The real LG Home becomes unreachable while the mount is up. Anything that
  launches `com.webos.app.home` gets your app, including your own "open LG Home"
  menu entry if you have one.
- Your app runs under the built-in's LS2 identity from
  `/usr/share/luna-service2/`, not a developer policy. You inherit the stock
  home's permissions rather than your own.
- `type: "web"` works fine even though the stock home is `"flutter"`. You supply
  the whole `appinfo.json`.
- The stock app is never modified. It's on read-only SquashFS underneath the
  mount and comes back the moment you unmount.
- This needs root, so a rooted TV with Homebrew Channel. It won't work on a
  stock set.
