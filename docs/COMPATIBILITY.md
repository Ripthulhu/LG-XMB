# Compatibility

The interface targets **webOS 22–26**, with Chromium 87 as its browser baseline.
The hardware-tested target is the **LG C5 (OLED42C54LA), webOS 25 / 10.3.1**.
Native hardware tests have been on that TV. The standalone Home-button listener
has passed physical Home, arrow and wheel tests on the C5, plus restoration
after reboot while the TV stayed on Recent Input. The C4 still needs testing.

The **safer, recommended setup** is a normal webOS app alongside stock LG Home.
On rooted TVs, **Settings → Remote → Home button** can route Home to LG-XMB
with elevated Homebrew Channel, Python 2.7 or newer and compatible Linux input devices.

Choose by the installed platform, which can change through TV updates, rather
than the model's purchase year. LG publishes the
[platform and browser versions](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine):

| Installed platform | Chromium | Current validation |
| --- | --- | --- |
| webOS 6.x | 79 | Community report: launcher runs; performance limited, native features unverified |
| webOS 22 | 87 | Browser baseline; no current hardware test |
| webOS 23 | 94 | Browser target; no current hardware test |
| webOS 24 | 108 | Browser target; no current hardware test |
| webOS 25 | 120 | C5 / webOS 10.3.1 tested, including the 0.1.31 cold-boot fixes |
| webOS 26 | 132 | Browser target; native permissions need testing on this platform |

The package declares 1920 × 1080. LG specifies 1920 × 1080 graphics for UHD
models and 1280 × 720 for Full HD models. There is currently no separate 720p
package. A desktop 720p layout check doesn't validate installation on a Full HD
TV. See [LG's resolution requirements](https://webostv.developer.lge.com/develop/specifications/app-resolution).

## Chromium 79 fallbacks

The webOS 6.x community report above did not identify the TV model.

The launcher was checked in desktop Chromium **79.0.3945.0** on
24 September 2026. The launcher started over local HTTP and directly from
files with its shipped CSP. WebGL 2 waves, remote-key navigation, settings,
long-press sorting, screensaver wake, PS3 fonts and the 720p preview layout
worked without JavaScript errors. The no-WebGL fallback remained usable.
This checks the browser engine, not webOS services or an older TV's frame rate.

- [`inset`](https://caniuse.com/mdn-css_properties_inset) starts in Chromium 87.
  Positioned layers use explicit top/right/bottom/left instead.
- [Flex gaps](https://caniuse.com/flexbox-gap) start in Chromium 84.
  `browser-compat.js` measures support once; `browser-compat.css` supplies margins
  for affected rows. Grid gaps stay native.
- [`min()`, `max()` and `clamp()`](https://caniuse.com/css-math-functions) work in
  Chromium 79, so responsive sizing remains unchanged.

Optional font metric overrides can still render differently on older engines.

## Browser and graphics behaviour

The Chromium 87 `aspect-ratio` fallback remains in `app/style.css`, so cached and
live previews retain their 16:9 shape without that CSS property. The bridge
accepts both `PalmSystem` and `webOSSystem`; optional `ResizeObserver` and newer
media-query event listeners have fallbacks.

Animated backgrounds require WebGL 2. The earlier WebGL 1 renderer is no longer
included. A missing context or failed shader setup leaves a static background;
navigation and settings remain usable. Optional floating-point render targets
fall back to ordinary colour targets, and allocation failures can lower the
requested wave resolution. Smooth animation still depends on the TV's GPU.

Run `npm run test:compat` with the [browser setup](BUILDING.md#browser-tests).
It checks normal and forced legacy layouts at 720p and 1080p, plus navigation
and Settings without WebGL. No preview server or TV connection is needed.

These checks use the installed desktop browser, not Chromium 79/87 emulation.
Native-service unit tests use synthetic replies; neither replaces TV testing.

## Check each feature separately

| Feature | Requirement or limit |
| --- | --- |
| Menu and desktop preview | Browser support for the app's JavaScript and CSS |
| Native app launching | The packaged app must be allowed to call the TV services |
| Installed apps and input discovery | Standalone reads through elevated Homebrew Channel; Home replacements use native access |
| Home button routing | Root, elevated Homebrew Channel, Python 2.7+ and matching Linux remote devices; requires physical testing on each model |
| Return to last app or input | Access to `com.webos.surfacemanager/getRecentsAppList`; verified under the stock Home identity on the C5; standalone permission is not guaranteed |
| Cached HDMI pictures | Rooted Homebrew environment, Python 2.7+ and compatible capture behaviour |
| Live HDMI preview | A working TV media pipeline; starting it can change HDR mode |
| Home replacement | Optional; only tested on the LG C5, webOS 25 / 10.3.1. See [Home setup](HOME-TAKEOVER.md) |
| App deletion and clock changes | Native service permission under the app's actual identity |
| User audio | Readable local files and a working audio path |

The capture worker has C5-specific geometry: a 3840 × 2160 panel and a
1920 × 1080 preview capture surface. Don't reuse those assumptions blindly on
a different model. OpenCV and NumPy are needed for its live-preview crop path,
not for ordinary full-input PNG capture.

The capture helper needs Linux, Python 2.7 or newer, root access,
Homebrew Channel's elevated `exec` service, and the expected app installation
paths. It uses private capture, video, power and foreground-app APIs. Unexpected
reply shapes skip capture. Audio recovery under the Home identity uses private media and
audio-routing APIs. The C5 cold-boot test covered helper startup, HDMI
video/audio, background music and fresh cached thumbnails; it is not evidence
for another model or a long-standby cycle.

On [webOS 26 Re:New, LG applies ACG permissions](https://webostv.developer.lge.com/develop/guides/acg-guide)
when `requiredACG` is present. The app declares `application.launcher` and
`application.query` for the public launch and installation-check APIs. That
does not grant the private app-list, input-label, capture, clock-write, removal,
recent-app or audio-routing methods. Test those from the installed app under
its actual identity; a successful root-shell call is not equivalent.

### Home-button routing

The Home-only Linux input listener follows
[Magic Mapper's device routing](https://github.com/andrewfraley/magic_mapper/blob/9e4161fecdcf602d3f6c5863d848ce2959b6e2f5/magic_mapper.py).
It requires `LGE M-RCU - Builtin [0]` for input. Output prefers
`LGE M-RCU - Builtin [1]` on webOS 10 and newer, then `[2]`, then another
numbered Builtin device. Through webOS 9 it tries `[2]` first. It discovers event
paths by name and rejects output aliases of the input device.
Missing devices or another app's exclusive grab are reported; competing apps
are not stopped.

Both workers run with Python 2.7 or Python 3. Startup checks the fixed paths
`/usr/bin/python3`, `/usr/bin/python`, then `/usr/bin/python2`. Home routing does
not depend on capture support; the saved choice is restored even if capture fails.

An enabled listener consumes Home presses and forwards other events. A Home
hold opens LG-XMB once and does not retain LG's native long-Home action. The
saved choice is restored by the existing `60-lg-xmb` bootstrap without opening
LG-XMB at boot or changing Power On Screen. Normal startup never enables it
without a saved choice. The setting is unavailable while a Home replacement
is active.

This route does not depend on the native default-app assignment for routing.
An explicit Home choice can clear a previous native assignment to this exact
LG-XMB app, while preserving other apps' assignments. The C5 standalone test
covered Home, arrows, the wheel and listener startup after reboot. Held Home,
Back, pointer, standby and disabling the listener still need physical checks.
Test the full set on other models before claiming support.

Home replacement is a separate root setup tested only on the C5 with
webOS 25 / 10.3.1. Other TVs need manual investigation of stock Home paths and
identity, native permissions, helper startup and recovery to determine whether
replacement is possible at all. Do not assume the C5 commands are portable.
Changing service permissions to force private APIs to work is not part of installation.

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
renderer or helper changes.
