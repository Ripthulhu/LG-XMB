# LG-XMB

LG-XMB is an XMB-style home screen for LG webOS TVs, inspired by the PS3.

![LG-XMB running on an LG C5](docs/images/home.png)

## Features

- Launch installed apps and switch between TV inputs.
- Choose which categories apps appear in, sort by name or recent use, and hide apps without uninstalling them.
- Show cached HDMI pictures, with optional live previews.
- Choose Original or Classic waves, seasonal or fixed colours, and your own wallpaper.
- Use your own navigation sounds and background music.

Left and Right change categories. Up and Down select an item. Press OK to open
it, hold OK for options, and press Back to return. The Magic Remote pointer
works too.

## TV support

The interface targets **webOS 22–26**. Hardware testing has been on the
**LG C5 running webOS 10.3.1**. Native features still need testing on other TVs.
A community user has also reported the launcher running on webOS 6; that does not validate all TV features.
See [Compatibility](docs/COMPATIBILITY.md) for the platform details and known limits.

Run it alongside stock LG Home. **Settings → Remote** can assign the Home
button to LG-XMB on supported rooted TVs. This needs an elevated Homebrew
Channel service and Python 3.7 or newer, as do cached HDMI pictures. Animated
backgrounds need WebGL 2; otherwise the menu uses a static background.

## Install

Download an IPK from [Releases](https://github.com/Ripthulhu/LG-XMB/releases),
or build one below.

1. Follow [Installation](docs/INSTALLATION.md) to transfer the IPK and install it over SSH.
2. Open **Home** from the TV's apps. Test navigation, app launching and HDMI.
3. Open **Settings → Remote → Home button** and choose **LG-XMB** if you want
   the Home button to open it. Choose **LG Home** to restore the stock assignment.

Installing the IPK leaves stock LG Home in place. The standalone launcher uses
elevated Homebrew Channel to read installed apps and physical inputs.
Home-button assignment does not change the TV's Power On Screen setting.

[Replacing LG Home](docs/HOME-TAKEOVER.md) is an optional advanced setup tested
only on the LG C5 with webOS 25. Existing replacement users must follow its
[update steps](docs/HOME-TAKEOVER.md#updating-the-payload); an IPK update does not
update the replacement copy.

## Customise

Open **Settings → Appearance**. Original includes sparkles; Classic leaves them
out. **Colour → Original** follows the season and time of day. The other colours
stay fixed. **Background** selects a [wallpaper and brightness](docs/BACKGROUND.md).
**Advanced** contains [frame-rate, resolution and rendering controls](docs/WEBGL2.md#settings)
for adjusting the background load.
**Screensaver** sets the idle delay and [background dimming](docs/SCREENSAVER.md).
**Clock** defaults to the PS3-style date/time bar. The plain clock is still available;
updates preserve your saved choice.

Hold OK on an app to change its category, sorting or visibility.
[Item options](docs/ITEM-OPTIONS.md) covers those controls and restoring hidden apps.

**Settings → Sound** controls [menu sounds](docs/MENU-SOUNDS.md) and
[background music](docs/MUSIC.md). Supply your own audio files; recordings aren't included.

**Settings → Input previews** selects cached pictures or live video.
Cached pictures appear after you've viewed an eligible HDMI input.
Live previews can trigger HDR mode changes.

## Build

Use Node.js 20 or newer and Python 3.10 or newer on your computer.

```sh
git clone https://github.com/Ripthulhu/LG-XMB.git
cd LG-XMB
npm ci --ignore-scripts --no-audit --no-fund
npm run package
npm run verify:package
```

The IPK and `SHA256SUMS` are written to `dist/`. The repository includes the
shaders and wave data needed for a normal build.

[Building and testing](docs/BUILDING.md) covers platform setup, package checks
and the test suites.

## Development

For a desktop preview, run `npm run preview` and open
<http://127.0.0.1:8765>. TV actions are simulated there.

The app uses plain JavaScript, CSS and SVG icons. The [code map](docs/ARCHITECTURE.md)
shows where to change the menu, settings, icons and renderer.
Read [Contributing](CONTRIBUTING.md) before submitting changes.

The package ID remains `org.local.openxmb.c5` so existing installations can upgrade in place.

## Licence

Project code is distributed under [GPL version 3](LICENSE). Files marked
`GPL-3.0-or-later` retain that permission. Third-party code and extracted PS3
data have separate terms in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

LG-XMB isn't affiliated with LG or Sony.
