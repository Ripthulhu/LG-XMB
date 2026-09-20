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
See [Compatibility](docs/COMPATIBILITY.md) for the platform details and known limits.

Replacing LG Home requires root. Cached HDMI pictures also need Homebrew
Channel with an elevated service and Python 3.7 or newer on the TV. Animated
backgrounds need WebGL 2; otherwise the menu uses a static background.

Use your existing root SSH connection. **Don't enable Developer Mode on a rooted TV.**

## Install

Download an IPK from [Releases](https://github.com/Ripthulhu/LG-XMB/releases),
or build one below.

1. Follow [Installation](docs/INSTALLATION.md) to transfer the IPK and install it over SSH.
2. Open **Home** from the TV's apps. Test navigation, app launching and HDMI.
3. Follow [Replacing LG Home](docs/HOME-TAKEOVER.md) to make it the Home screen and keep it after a reboot.

Installing the IPK adds a standalone launcher. Replacing LG Home is a separate
manual setup using a copy of that installed app. The guide covers the startup
hook and restoring stock Home. Keep SSH access working throughout setup.

When updating, follow the [Home update steps](docs/HOME-TAKEOVER.md#updating-the-payload).
Installing a new IPK doesn't update the Home replacement copy.

## Customise

Open **Settings → Appearance**. Original includes sparkles; Classic leaves them
out. **Colour → Original** follows the season and time of day. The other colours
stay fixed. **Background** selects a [wallpaper and brightness](docs/BACKGROUND.md).
**Advanced** contains [animation and rendering options](docs/WEBGL2.md#settings).
**Screensaver** sets the idle delay and [background dimming](docs/SCREENSAVER.md).
**Clock** keeps the current display or switches to a PS3-style date/time bar.

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
