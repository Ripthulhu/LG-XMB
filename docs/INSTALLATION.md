# Installation and removal

Installing the IPK adds a launcher named **Home**. It doesn't replace LG Home or
change the Home button. Root-only Home replacement is a separate procedure in
[HOME-TAKEOVER.md](HOME-TAKEOVER.md).

## Install over SSH

Use your existing root SSH connection. These steps assume you can transfer files
and run commands on the TV. Don't enable Developer Mode on a rooted TV.

Download the IPK and `SHA256SUMS` from
[Releases](https://github.com/Ripthulhu/LG-XMB/releases), or [build them](BUILDING.md).
The source ZIP isn't an installable app. Check the IPK against the matching
checksum before transferring it. On Linux, run `sha256sum -c SHA256SUMS`.
On macOS, use `shasum -a 256 -c SHA256SUMS`. On Windows, use
`Get-FileHash -Algorithm SHA256` and compare the result.

Copy the IPK to `/tmp/lg-xmb.ipk` on the TV. For example, from your computer:

```sh
scp org.local.openxmb.c5_0.1.32_all.ipk YOUR_TV_CONNECTION:/tmp/lg-xmb.ipk
```

Use the filename of your chosen release and your existing SSH alias or
`root@host`. If the TV has no SFTP server, use `scp -O` for the older SCP protocol.
Check that `/tmp/lg-xmb.ipk` isn't already being used for another install.

In the TV's root shell, check the transferred hash, then start installation:

```sh
sha256sum /tmp/lg-xmb.ipk
luna-send -i luna://com.webos.appInstallService/dev/install \
  '{"id":"org.local.openxmb.c5","ipkUrl":"/tmp/lg-xmb.ipk","subscribe":true}'
```

Wait for `details.state` to report `installed` or `SUCCESS`, with the expected
package ID. `returnValue: true` on the first reply only acknowledges the request.
A reply containing `FAILED`, `returnValue: false` or a nonzero `details.errorCode` means
installation failed. After the final success reply, press Ctrl+C to end the
subscription if it stays open.

Open **Home** from the TV's apps, or run:

```sh
luna-send -n 1 luna://com.webos.applicationManager/launch \
  '{"id":"org.local.openxmb.c5"}'
```

Check navigation, launch an app and return from HDMI before replacing LG Home.
If installation fails, keep the error output. Don't unpack the IPK over the app
directory or use `opkg` to bypass the TV's app registration.

You can also install with
[webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases),
using its root connection. A non-root TV with an existing Developer Mode setup
can install the standalone launcher through its usual tools. That doesn't give
it the root-only features below.

These native install commands have been used on the C5 with webOS 10.3.1. Read
[Compatibility](COMPATIBILITY.md) before testing another model.

## Helper setup

On a rooted TV with Homebrew Channel and Python 3.7 or newer, Home prepares the
bundled capture helper on launch. No separate helper download is needed.
**Settings → Input previews** shows its status and a retry option.

Check **Root status** in Homebrew Channel's settings. Its service must be
elevated; a working root SSH connection alone isn't enough. If it reports
`unelevated`, see [Homebrew Channel's recovery notes](https://repo.webosbrew.org/apps/org.webosbrew.safeupdate/).

The helper creates cached HDMI pictures and prepares links to optional user
audio. It doesn't assign Home, stop LG services or manage background apps.
The **Back button** setting only changes Back inside this launcher.
With no panel open, **Return to last app or input** uses the TV's recent-app
list. Back still closes an open panel or leaves the full-screen waves first.
Existing Back settings are kept when updating; new installs use Return by default.

A non-root installation can use the menu and permitted native APIs. The capture
helper and Home replacement require root.

Cached pictures appear after an eligible HDMI input has been viewed. An input
name appearing in the menu doesn't mean a picture has been captured.

## Update

If you use Home replacement, first follow
[Updating the payload](HOME-TAKEOVER.md#updating-the-payload) to restore LG Home.
For a standalone launcher, install the new IPK over the existing app and open
**Home**. Its package ID,
`org.local.openxmb.c5`, stays unchanged for in-place upgrades.

Setup verifies the installed bundle, stops a recognised worker from an older
bundle and starts or reuses the matching worker. Unknown hooks, foreign links
and untrusted files are left alone. Don't delete persistent state to get past
a failed check.

A copied Home-replacement payload is **not** updated by installing an IPK.
Update it separately from the same build, following
[the Home replacement guide](HOME-TAKEOVER.md#updating-the-payload).

## Files on the TV

| Path | Purpose |
| --- | --- |
| `/media/developer/apps/usr/palm/applications/org.local.openxmb.c5/` | Installed app and verified helper bundle |
| `/var/lib/lg-xmb/` | Helper setup record and lock |
| `/tmp/lg-xmb-thumbnails/` | Cached pictures and capture status |
| `/var/lib/webosbrew/init.d/60-lg-xmb` | Link to the packaged helper bootstrap |
| `/var/lib/webosbrew/lg-xmb-startup.log` | Bounded helper setup log |
| `/media/internal/lg-xmb/` | Your optional MP3 and sound files |
| `/var/lib/lg-xmb-home/` | Separate Home-replacement payload, when configured |

The user-audio directory is outside the package and remains after updates or
uninstallation. The picture cache is temporary.

## Troubleshooting

Check **Settings → Input previews** first. A missing Homebrew service, a non-root
execution result and an incomplete helper bundle are different failures.

From an existing root shell, read:

```sh
cat /var/lib/webosbrew/lg-xmb-startup.log
cat /tmp/lg-xmb-thumbnails/status.json
```

The setup log is root-only and limited to 16 KiB. It records setup errors, not
every worker message. A successful setup entry doesn't prove a capture worked.
An unsafe log path may prevent logging; use the error shown in the app too.

Reinstall the matching IPK for a missing or mismatched bundle. Don't disable
ownership or hash checks, and don't recursively change permissions on shared TV
directories. Sound-link problems are covered in [HOME-SOUND-REPAIR.md](HOME-SOUND-REPAIR.md).

## Remove

For a Home replacement, disable its boot hook and restore the stock Home mount
**before** removing the developer app. Follow the recovery steps in
[HOME-TAKEOVER.md](HOME-TAKEOVER.md#restore-lg-home).

On a rooted installation, stop the capture helper while its recovery script is
still installed:

```sh
APP=/media/developer/apps/usr/palm/applications/org.local.openxmb.c5
/usr/bin/python3 -I -B "$APP/helper/stop_thumbnail_helper.py"
```

Check the result before continuing. A refused identity or hook check needs
investigation, not forced deletion. Don't reopen Home before uninstalling,
because opening it starts normal helper setup again.

Remove the app using Dev Manager or the TV's app manager. A launcher-only
Developer Mode installation can be removed normally without the root command.

Older builds may have left saved LG settings or a separate Home assignment.
The current capture helper doesn't restore those settings. Keep any old recovery
records until you've checked the TV's configuration; don't run commands for a
controller that isn't in this package.

## Audio

[Background music](MUSIC.md) uses `/media/internal/lg-xmb/background.mp3`.
[Menu sounds](MENU-SOUNDS.md) use `/media/internal/lg-xmb/Sounds/`.
Both are optional and supplied by you.
