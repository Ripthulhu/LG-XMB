# Installation and removal

The **safer, recommended setup** is to install LG-XMB as a normal webOS app,
keeping stock LG Home. The IPK adds a launcher named **Home** without changing
the Home button. After testing the app, rooted TVs can enable a Home-button
listener in **Settings → Remote** with elevated Homebrew Channel, Python 2.7+
and compatible remote devices. This route needs testing on each TV model.

[Replacing LG Home](HOME-TAKEOVER.md) is a separate, optional procedure tested
only on the LG C5 with webOS 25 / 10.3.1. Other TVs need manual investigation
to determine whether replacement is possible; do not assume those commands apply.

## Install through Homebrew Channel

This is the recommended method on a rooted TV with
[Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) installed.

1. Open Homebrew Channel and go to **Settings → Add repository**.
2. Enter this URL and confirm with **Add repository**:

   ```text
   https://raw.githubusercontent.com/Ripthulhu/LG-XMB/main/repo.json
   ```

3. Return to the app list, select **LG-XMB** and choose **Install**.
4. Open **Home** from the TV's apps. Check navigation, app launching and HDMI.
5. To make the Home button open LG-XMB, choose **LG-XMB** under
   **Settings → Remote → Home button**.

The package includes the helper. See [Helper setup](#helper-setup) for its requirements.
You can also use Homebrew Channel to install updates.

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
scp org.local.openxmb.c5_0.1.38_all.ipk YOUR_TV_CONNECTION:/tmp/lg-xmb.ipk
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

Check navigation, launch an app and return from HDMI before enabling Home-button routing.
If installation fails, keep the error output. Don't unpack the IPK over the app
directory or use `opkg` to bypass the TV's app registration.

You can also install with
[webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases),
using its root connection. A non-root TV with an existing Developer Mode setup
can install the standalone launcher through its usual tools. That doesn't give
it the root-only features below.

These native install commands have been used on the C5 with webOS 10.3.1. Read
[Compatibility](COMPATIBILITY.md) before testing another model.

## Remote settings and standalone use

Open **Settings → Remote**. Under **Home button**, choose **LG-XMB** to enable
the direct remote listener or **LG Home** to disable it. The listener opens
LG-XMB once per Home press, including a hold, and forwards other remote events.
LG's native long-Home action is unavailable while it is enabled.

Reading the setting is read-only. The check mark shows the saved choice, not
proof that the listener is running. A stopped listener shows an explanation;
select the checked **LG-XMB** choice to retry. After an uncertain change, use
**Retry** to read the saved state before trying again. If another app has
exclusive control of the remote, LG-XMB reports the conflict without stopping it.

This requires root, an elevated Homebrew Channel service, Python 2.7 or newer
and the remote devices listed in [Compatibility](COMPATIBILITY.md#home-button-routing).
The choice is saved in `/var/lib/lg-xmb/home-button.json`. The existing
`60-lg-xmb` bootstrap restores an enabled listener after boot; it does not
launch the app at boot or change Power On Screen. An old native Home assignment
to this exact LG-XMB app is cleared only when you explicitly select a Home
choice. Assignments belonging to other apps are preserved.

If you already replaced LG Home with a bind mount, first follow
[Restore LG Home](HOME-TAKEOVER.md#restore-lg-home). Choosing LG Home while a
replacement is mounted would still open that replacement, so Remote refuses
this change until stock Home is restored. It does not remove the mount for you.

**Back button** changes Back inside this launcher. **Return to last app or
input** reads the TV's recent-app list when no panel is open. The standalone
app reads it through elevated Homebrew Channel, using the same route as app
and input discovery. **Stay in Home** and
**Show exit prompt** remain separate choices. Back closes an open panel first.
Updating preserves your saved Back setting; new settings use Return by default.

The standalone launcher reads apps and physical inputs through Homebrew
Channel's elevated service. This does not need Python, capture setup or Home
replacement. A Home replacement uses LG Home's native inventory access.
It does not change service permissions. A root SSH connection alone does not
grant the running app access; Homebrew Channel must also be elevated.

The TV category uses the TV's reported physical inputs instead of assuming
four HDMI sockets. Disconnected sockets remain listed. AV and component
inputs appear when the firmware reports a recognised input app. Failed reads
keep the last valid list. Analog inputs can be opened, but do not have previews.

## Helper setup

On a rooted TV with Homebrew Channel and Python 2.7 or newer, Home prepares the
bundled capture helper on launch. No separate helper download is needed.
**Settings → Input previews** shows its status and a retry option.

The helper uses the TV's installed Python. Capture still depends on the TV's
native capture service; Python support alone does not establish model support.
A saved Home-button choice is restored even if capture setup fails.

Check **Root status** in Homebrew Channel's settings. Its service must be
elevated; a working root SSH connection alone isn't enough. If it reports
`unelevated`, see [Homebrew Channel's recovery notes](https://repo.webosbrew.org/apps/org.webosbrew.safeupdate/).

Normal helper startup creates cached HDMI pictures, prepares links to optional
user media and restores an already enabled Home-button listener. It does not
enable Home routing by itself, stop LG services or manage background apps.
Changing the Home choice uses a separate verified command from Remote settings.

A non-root installation can use the menu and permitted native APIs. App and input
discovery, Home-button routing, the capture helper and Home replacement
require root.

Cached pictures appear after an eligible HDMI input has been viewed. An input
name appearing in the menu doesn't mean a picture has been captured.

## Update

If you use Home replacement, first follow
[Updating the payload](HOME-TAKEOVER.md#updating-the-payload) to restore LG Home.
For a standalone launcher, select **LG-XMB** in Homebrew Channel and choose
**Update** when a newer version is available. Then open **Home**.
If you installed manually, you can install the new IPK over the existing app instead.
Its package ID, `org.local.openxmb.c5`, stays unchanged for in-place upgrades.

The IPK updates the helper files too; there is no separate helper to copy over
SSH. Opening Home verifies the new bundle and restarts the capture worker if
the bundle changed. An unchanged worker is reused, and an enabled Home-button
listener is restored. Your music, sounds,
wallpaper and fonts remain in `/media/internal/lg-xmb/`.

Unknown hooks, foreign links and untrusted files are left alone. Don't delete
persistent state to get past a failed check.

A copied Home-replacement payload is **not** updated by installing an IPK.
Update it separately from the same build, following
[the Home replacement guide](HOME-TAKEOVER.md#updating-the-payload).

## Files on the TV

| Path | Purpose |
| --- | --- |
| `/media/developer/apps/usr/palm/applications/org.local.openxmb.c5/` | Installed app and verified helper bundle |
| `/var/lib/lg-xmb/` | Helper setup record and lock |
| `/var/lib/lg-xmb/home-button.json` | Saved Home-button choice |
| `/var/lib/lg-xmb/home-button-status.json` | Home-button listener status |
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

If you enabled Home-button routing, first select **Settings → Remote →
Home button → LG Home** and confirm the button no longer opens LG-XMB.

For a Home replacement, disable its boot hook and restore the stock Home mount
**before** removing the developer app. Follow the recovery steps in
[HOME-TAKEOVER.md](HOME-TAKEOVER.md#restore-lg-home).

On a rooted installation, stop the recognised capture and Home-button workers
while their recovery script is still installed:

```sh
APP=/media/developer/apps/usr/palm/applications/org.local.openxmb.c5
/usr/bin/python3 -I -B "$APP/helper/stop_thumbnail_helper.py"
```

On a Python 2-only TV, use `/usr/bin/python -E -s -S -B` in place of
`/usr/bin/python3 -I -B` above (or `/usr/bin/python2` if that is its installed path).

Check the result before continuing. A refused identity or hook check needs
investigation, not forced deletion. Don't reopen Home before uninstalling,
because opening it starts normal helper setup again.

Remove the app using Dev Manager or the TV's app manager. A launcher-only
Developer Mode installation can be removed normally without the root command.

Recovery stops recognised workers and removes recognised startup hooks. It
does not restore native settings or remove another app's Home assignment.
Keep any earlier recovery records until you've checked the TV's configuration.

## Audio

[Background music](MUSIC.md) uses `/media/internal/lg-xmb/background.mp3`.
[Menu sounds](MENU-SOUNDS.md) use `/media/internal/lg-xmb/Sounds/`.
Both are optional and supplied by you.
