# LG-XMB

An XMB-style launcher for LG webOS TVs, based on [OpenXMB](https://github.com/phenom64/OpenXMB).
The installed app is called **Home**.

![Home screen](docs/images/home.png)

Navigate apps and inputs with the remote or pointer. Choose a background theme,
adjust the animated waves, and open LG Home from Settings whenever needed.
HDMI pictures are cached by an optional root helper; live previews are opt-in
because they can change HDR mode. Optional background music loops your own MP3 while Home is open. There is no general-purpose media player or emulator.

HDMI names follow the TV's input labels when its input service allows the read.
Names refresh at startup and when returning to Home; the port number remains
visible in the details. Unavailable reads keep the default or last known name.
This feature does not need the root helper or change names on the TV.

## Menu motion

Switching categories slides the horizontal bar and the incoming vertical column
on the same 180 ms timeline. Only the new column fades in; outgoing labels do not
overlap it. Rapid reversals keep the bar's current position instead of queuing
animations. Menu rows are reused when revisiting a category.

Selection and launching remain immediate. Reduced motion disables the effect.
Selected icons stay larger and brighter, without a background glow.

## Wave antialiasing

Settings → Waves has **MSAA: Off / 2× / 4×**, separate from supersampling and
FXAA. MSAA requires WebGL 2; the menu reports the applied count and any fallback.
It is off by default and does not change existing supersampling preferences.
For a lower-shading-cost comparison, try **4× MSAA with supersampling Off**.
Do not enable every quality setting assuming it is free: combining MSAA with
supersampling adds work. The cropped wave target retains full sample density.
The older WebGL 1 path remains available when WebGL 2 cannot be created.

## Wave particles

Settings → Waves includes **Particles: On / Off** and **Particle density:
Low / Normal / High** (500 / 2,000 / 4,000). Normal follows the reference's count.
The sparkle layer follows Wave speed, brightness, and animation settings; it
stops with the renderer when Home is hidden. Classic/Canvas fallback omits it.

## Background music

No recording is included in the repository or IPK. Open Home once to prepare
`/media/internal/lg-xmb/`, then copy your own MP3 there as `background.mp3`.
Open **Settings → Background music → On**. The menu shows the path and volume
controls. Music is off by default, starting at 25% volume when enabled.

The file stays outside the installed app and survives upgrades. Playback loops
while Home is visible and releases its player for live HDMI previews and app
launches. Missing music does not affect the launcher or helper.
See [music setup](docs/MUSIC.md) for file transfer and replacement instructions.

## Compatibility

Development targets **webOS 22–26**. Version 0.1.11 was tested on an **LG C5 with
webOS 10.3.1**; the target range is not a claim that every version works.
See the [compatibility and test matrix](docs/COMPATIBILITY.md).

The launcher can be installed through Developer Mode or an existing homebrew
setup. Home-button assignment, cached pictures and background controls require
the bundled helper, prepared automatically through Homebrew Channel. Its native
integrations are still C5-specific; a working menu is not a compatibility test.

## Install

Download the `.ipk` from [Releases](https://github.com/Ripthulhu/LG-XMB/releases),
then follow [Installation](docs/INSTALLATION.md) to install it with **webOS Dev
Manager**. Installing the launcher alone does not change the Home button.
Rooted installations prepare their helper on first launch. Recovery is covered in
the same guide.

Releases include the installable IPK, SHA-256 checksums and matching source.
**0.1.12 is a C5 prerelease**, not a stable or broadly compatible release; read its
known limitations before installing. Unpublished development builds remain in
GitHub Actions as `lg-xmb-candidate` after **Checks** succeeds.

## Develop

Use Node.js 20 or newer. The Node requirement is for your computer, not the TV.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run preview
```

Open <http://127.0.0.1:8765>. Desktop TV actions are simulated.

```sh
npm test
npm run package
npm run verify:package
```

The package is written to `dist/`. Nothing is installed on a TV by these commands.
For the tools linked by webOS Homebrew, `npm run tools:download` downloads a
pinned, checksum-verified `ares-cli-rs` archive into `.tools/`. It does not extract
or run it. The existing `@webos-tools/cli` remains the release packager.

See [Contributing](CONTRIBUTING.md) for browser tests, Python tests and change
review. The native C/C++ SDK is not needed for this HTML/JavaScript application.

## License

GNU GPL v3; files permitting later versions retain that permission. Upstream
copyright and license notices are retained in [LICENSE](LICENSE),
[third-party notices](THIRD-PARTY-NOTICES.md), and [wave provenance](WAVE-PROVENANCE.md).
This project is not affiliated with LG or Sony.

The wave background uses a PS3-style spline surface with an OpenXMB/Canvas fallback.
See [renderer provenance](WAVE-PROVENANCE.md) for sources and limitations.

## Wave colours

Open **Settings → Waves → Wave colours**. **Current theme** keeps the existing
Appearance palette. **Monthly presets** provides January–December and explicit
Day/Night variants from the reference project. **Original (RGB Sliders)** exposes
red, green, blue, top intensity and bottom intensity. Choices apply immediately
and are saved independently of quality settings. Day/Night is a manual choice,
not an automatic schedule. Back returns to Waves.

Particles now form a narrower field on the left that spreads towards the right.
Depth-dependent movement, size and soft focus create a floating-space effect;
this is a visual approximation, not an audio-reactive effect.
