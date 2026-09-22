# Compatibility

The interface targets **webOS 22–26**, with Chromium 87 as its browser baseline.
The hardware-tested target is the **LG C5 (OLED42C54LA), webOS 10.3.1**.
Native features have only been tested on that TV.

Choose by the installed platform, which can change through TV updates, rather
than the model's purchase year. LG publishes the
[platform and browser versions](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine):

| Installed platform | Chromium | Current validation |
| --- | --- | --- |
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

webOS 6.x uses Chromium 79. The UI includes fallbacks for that engine, but has
not been validated on a webOS 6.x TV. The hardware support claim is unchanged.

Checked against Can I Use on 22 September 2026:

- [`inset`](https://caniuse.com/mdn-css_properties_inset) starts in Chromium 87.
  Positioned layers use explicit top/right/bottom/left instead.
- [Flex gaps](https://caniuse.com/flexbox-gap) start in Chromium 84.
  `browser-compat.js` measures support once; `browser-compat.css` supplies margins
  for affected rows, including reordered clock contents. Grid gaps stay native.
- [`min()`, `max()` and `clamp()`](https://caniuse.com/css-math-functions) work in
  Chromium 79, so responsive sizing remains unchanged.

The layout test forces legacy spacing and aspect-ratio paths at 720p and 1080p,
checking previews, full-screen layers, choice rows and both clock styles.
It does not emulate Chromium 79 or validate LG's native APIs. Optional font
metric overrides can still render differently on older engines.

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

Run `npm run test:compat` after installing the development dependencies. It
checks normal and forced legacy preview layout at 720p and 1080p, then loads the
full app without WebGL and navigates into and out of Settings. It uses the same
browser selection as the other browser tests in [BUILDING.md](BUILDING.md).
No preview server or TV connection is needed.

This test runs the installed desktop browser. It is **not Chromium 87 emulation**
and doesn't replace a webOS 22 test. The native-service unit tests exercise
denied calls, malformed replies, timeouts and missing bridges, using synthetic
responses rather than a TV.

## Check each feature separately

| Feature | Requirement or limit |
| --- | --- |
| Menu and desktop preview | Browser support for the app's JavaScript and CSS |
| Native app launching and HDMI names | The packaged app must be allowed to call the TV services |
| Return to last app or input | Access to `com.webos.surfacemanager/getRecentsAppList`; verified from Home on the C5 |
| Cached HDMI pictures | Rooted Homebrew environment, Python and compatible capture behaviour |
| Live HDMI preview | A working TV media pipeline; starting it can change HDR mode |
| Home replacement | Root access and the matching stock Home layout; follow [Home setup](HOME-TAKEOVER.md) |
| App deletion and clock changes | Native service permission under the app's actual identity |
| User audio | Readable local files and a working audio path |

The capture worker has C5-specific geometry: a 3840 × 2160 panel and a
1920 × 1080 preview capture surface. Don't reuse those assumptions blindly on
a different model. OpenCV and NumPy are needed for its live-preview crop path,
not for ordinary full-input PNG capture.

The helper needs Linux, Python 3.7 or newer at `/usr/bin/python3`, root access,
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

The helper doesn't assign Home or manage background services. Home replacement
is a separate root setup, not part of installing the IPK. Its stock Home paths
and app type must match the target TV. Changing service permissions to force
private APIs to work is not part of installation.

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
