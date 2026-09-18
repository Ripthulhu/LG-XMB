# LG-XMB

LG-XMB replaces the home screen on an LG webOS TV with an XMB-style menu for apps and inputs.

![Home screen](docs/images/home.png)

The app is called **Home** on the TV. You can install it as a separate launcher,
or use a root-only bind mount to replace LG Home. Installing the IPK alone doesn't
replace the Home screen.

## What you need

The development target is the **LG C5 running webOS 10.3.1**. Other models and
firmware versions need separate testing. See [Compatibility](docs/COMPATIBILITY.md).

You need an existing Developer Mode or rooted connection to install the IPK.
Replacing LG Home requires root. The optional HDMI capture helper also needs a
rooted TV with Homebrew Channel and Python 3.7 or newer.

## Install

Download an IPK from [Releases](https://github.com/Ripthulhu/LG-XMB/releases) and
install it with [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases).
Open **Home** to test navigation and app launching.

[Installation and removal](docs/INSTALLATION.md) covers the standalone app.
[Replacing LG Home](docs/HOME-TAKEOVER.md) covers the bind mount, its limitations
and recovery. Keep a working SSH connection before changing the Home screen.

## Use

Left and Right change categories. Up and Down select an item. Press OK to open
it, or hold OK to open [item options](docs/ITEM-OPTIONS.md). Pointer navigation
works too.

**Settings** contains appearance, wave, audio and Back-button options. The waves
use WebGL 2. Without it, the menu uses a static background. There's no media
player or emulator built into LG-XMB; media shortcuts open the TV's apps.

HDMI names follow the TV's input labels where its service permits the read.
Cached pictures need the helper and appear after an eligible input has been
viewed. Live previews are optional because they can change HDR mode.

You can add your own [menu sounds](docs/MENU-SOUNDS.md) and
[background MP3](docs/MUSIC.md). Neither is required, and no recordings are
included. See [Menu categories](docs/MENU-CATEGORIES.md) for the shortcuts and
[Wave settings](docs/WEBGL2.md#settings) for the renderer controls.

## Build

Use Node.js 20 or newer and Python 3.10 or newer on your computer.

```sh
git clone https://github.com/Ripthulhu/LG-XMB.git
cd LG-XMB
npm ci --ignore-scripts --no-audit --no-fund
npm run package
npm run verify:package
```

The IPK and `SHA256SUMS` are written to `dist/`. These commands don't install
anything on a TV.

All application source, shaders and runtime data needed to build the waves are
in this repo. You don't need a firmware dump, a separate renderer archive or an
import step. `npm ci` installs the pinned development tools.

For a desktop preview, run `npm run preview` and open
<http://127.0.0.1:8765>. TV actions are simulated there.
[Building and testing](docs/BUILDING.md) covers the remaining commands.

## Notes

The package ID is still `org.local.openxmb.c5` so existing installations can
upgrade in place. It isn't the project name.

The Home bind mount is separate from IPK installation. Updating the IPK doesn't
update that copied payload automatically. The two installations need to match
for helper-managed sound links to work.

Don't treat a browser test as proof that native TV services work. App launches,
HDMI capture, standby and recovery need testing on the actual firmware.

## Licence

Project code is distributed under GPL version 3. Files marked
`GPL-3.0-or-later` retain that permission. Third-party code and extracted
reference data have separate notices in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
The project licence doesn't relicense Sony's extracted data.

LG-XMB isn't affiliated with LG or Sony.
