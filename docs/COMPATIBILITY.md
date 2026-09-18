# Compatibility

The development target is the **LG C5 (OLED42C54LA) running webOS 10.3.1**.
Other TVs aren't confirmed compatible just because they run webOS.

The interface targets the webOS 22-era browser and newer. The package declares
1920 × 1080, and its animated background requires WebGL 2. A missing or failed
WebGL 2 context leaves a static background rather than preventing navigation.
A desktop layout check at another resolution isn't a test on that TV model.

## Check each feature separately

| Feature | Requirement or limit |
| --- | --- |
| Menu and desktop preview | Browser support for the app's JavaScript and CSS |
| Native app launching and HDMI names | The packaged app must be allowed to call the TV services |
| Cached HDMI pictures | Rooted Homebrew environment, Python and compatible capture behaviour |
| Live HDMI preview | A working TV media pipeline; starting it can change HDR mode |
| Home replacement | Root access and a manually managed bind mount |
| App deletion and clock changes | Native service permission under the app's actual identity |
| User audio | Readable local files and a working audio path |

The capture worker has C5-specific geometry: a 3840 × 2160 panel and a
1920 × 1080 preview capture surface. Don't reuse those assumptions blindly on
a different model. OpenCV and NumPy are needed for its live-preview crop path,
not for ordinary full-input PNG capture.

The helper doesn't provide Home remapping or background-service controls.
Changing an LS2 manifest or a service permission isn't part of installation.

## Read-only diagnostic

From a POSIX shell on your computer, using an existing TV SSH connection:

```sh
ssh YOUR_TV_CONNECTION '/usr/bin/python3 -I -B -' < tools/tv-diagnostics.py
```

Replace `YOUR_TV_CONNECTION` with your SSH alias or `user@host`. The script
requires Python 3.7 or newer and the TV's `luna-send`.

It reports SDK information, command availability and the shapes of selected
native replies. It doesn't capture pictures, start the helper or change TV
settings. Nothing is uploaded automatically.

A successful shell read doesn't establish permission for the packaged app.
`service_refused` can mean a missing method, denied access or different firmware
behaviour. The diagnostic doesn't guess which one.

## Reporting a test

Record the TV model, installed firmware/SDK, app commit, installation method and
whether root was used. Test native calls from the running app, not just SSH.
Check navigation, app and HDMI return, standby, upgrade and removal. For Home
replacement, also test [restoring LG Home](HOME-TAKEOVER.md#restore-lg-home).

Earlier test records apply to their recorded builds. They don't validate later
renderer or helper changes. Browser and synthetic-service tests don't establish
TV frame pacing, native permissions or capture compatibility.
