# LG-XMB

An XMB-style launcher for LG webOS TVs, based on [OpenXMB](https://github.com/phenom64/OpenXMB).
The installed app is called **Home**.

![Home screen](docs/images/home.png)

Navigate apps and inputs with the remote or pointer. Choose a background theme
and adjust the animated waves.
HDMI pictures are cached by an optional root helper; live previews are opt-in
because they can change HDR mode. Optional background music loops your own MP3 while Home is open. There is no general-purpose media player or emulator.

HDMI names follow the TV's input labels when its input service allows the read.
Names refresh at startup and when returning to Home; the port number remains
visible in the details. Unavailable reads keep the default or last known name.
This feature does not need the root helper or change names on the TV.

## Menu motion

Left/right uses the same CSS transform transition as up/down, shaped like the
PS3's own position curve (95% of the way at 200 ms, settling by 400 ms). The
horizontal bar glides to the selected category; its icon scales into focus.
The vertical list stays anchored instead of sliding sideways or fading as a
whole. Repeated input retargets the current transition, without queuing effects
or resetting the final position. Reduced motion disables menu transitions.

## Wave particles

Settings → Waves includes **Particles: On / Off** and **Particle density:
Low / Medium / High** (1,000 / 2,000 / 4,000). Medium is the count the console ran.
Particles are born on the moving wave and leave along its local motion, the way
the console's emitter does it, so they gather around the sheet. Moving up and
down the menu blows a short local wind through them and a left or right press
makes them jitter for a moment. The sparkle layer follows Wave speed, brightness,
and animation settings; it stops with the renderer when Home is hidden. Without WebGL 2 there's no wave
and no particles, only the static backdrop.

**Settings → Waves → Show waves full screen** hides the menu and leaves only the
waves. Back or Home brings the menu back.

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
Releases are C5 prereleases, not stable or broadly compatible ones. Read the notes
for the version you download in [docs/releases/](docs/releases/), cause the known
limitations differ between them. There's no CI build right now; development
builds come from `npm run package` on a computer.

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

The wave is a WebGL 2 reconstruction of the PS3's own renderer, see
[docs/WEBGL2.md](docs/WEBGL2.md) and [its notices](docs/WEBGL2-NOTICES.md).
Without WebGL 2 it falls back to a static gradient.
[Wave provenance](WAVE-PROVENANCE.md) covers the renderer shipped up to 0.1.30.

## Wave colours

Open **Settings → Waves → Wave colours**. **Current theme** keeps the existing
Appearance palette. **PS3 original** draws the console's own monthly background,
following the TV clock (the month, and day or night by the hour) or pinned to a
month under **Clock**. **Monthly presets** provides January–December and explicit
Day/Night variants from the reference project. **Original (RGB Sliders)** exposes
red, green, blue, top intensity and bottom intensity. Choices apply immediately
and are saved independently of quality settings. Back returns to Waves.
