# LG-XMB

A clean XMB-style home screen for LG webOS TVs, based on [OpenXMB](https://github.com/phenom64/OpenXMB). The TV app is named **Home** and has no visible project branding on its main screen.

![Home screen](docs/images/home.png)

## Features

- Remote and pointer navigation across Inputs, Watch, Library, Apps and Settings.
- Animated waves, nine background themes, and controls for animation, speed and brightness. Text, icons and dividers stay white.
- One-click HDMI launch, cached input pictures, and optional live previews.
- Configurable Home-button assignment and Back behavior under **Settings → Remote buttons**.
- Optional **Background activity** controls for LG Home, Browser, Search, HDMI 1–4, Live TV, usage history and AI nudges, LG voice commands, and LG's advertising service.
- LG Home remains available from Settings. Selecting it as the default Home also allows it to run; other background choices remain unchanged.

The interface renders at 1920×1080. On the C5, the wave renderer starts at 1280×720 and 30 fps with adaptive quality. Wave animation speed is independent of the rendering frame rate.

## Compatibility

Version **0.1.11** was developed and tested on an LG C5 running webOS 10.3.1. It is a web adaptation, not the upstream native C++/Vulkan program. Library entries do not provide a media player or emulator.

The app can be previewed on a desktop. Home-button assignment, cached HDMI pictures and background controls require the separate root helper and an existing compatible Homebrew Channel setup. This repository does not provide a rooting method or modify firmware, secure boot, DRM or the TV compositor. Other models and firmware versions need their own compatibility checks.

Live previews can trigger an HDR mode change. Cached mode is the default: it keeps a still picture and opens the input directly when selected. Pictures are held in RAM and rebuild after a restart when an input is viewed.

Privacy controls stop selected LG services; they do not block every tracker or ads inside streaming apps. The voice setting does not mute microphones. Built-in streaming apps and casting are outside the controller's fixed service list.

## Preview and build

Requires Node.js 20 or newer.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run preview
```

Open [localhost:8765](http://127.0.0.1:8765). TV actions are simulated in the desktop preview.

```sh
npm run package
npm run verify:package
```

The unminified IPK is written to `dist/org.local.openxmb.c5_0.1.11_all.ipk`. Packaging does not install it or change the TV's Home-button assignment.

See [installation and recovery](docs/INSTALLATION.md) for deployment. The [helper reference](tv-helper/README.md) explains its fixed operations and safeguards.

## Controls

| Control | Action |
| --- | --- |
| Left / right | Change category |
| Up / down | Select an item |
| OK / Enter / click | Open the selection |
| Back / Escape | Close the current panel; at the main menu, use the saved Back setting |
| Home | Open the assigned Home app |

**Stay in Home** is the default Back setting. **LG behavior** delegates Back to the TV's normal platform handler from the main menu; webOS controls its exit prompt. This preference applies only inside this app.

## Tests

```sh
npm test
python -m unittest discover -s tv-helper -p 'test_*.py'
python -m unittest discover -s tv-helper/recovery -p 'test_*.py'
```

With the preview server running and Microsoft Edge installed:

```sh
npm run test:browser
node tests/wave-retention-browser.cjs
```

Set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome instead. Browser tests write disposable screenshots and results to ignored `qa/`. Icon regeneration with `python tools/make-icons.py` optionally requires Pillow.

The 0.1.11 app passed 89 unit tests and 52 browser checks; the controller, capture helper and recovery guards passed 91, 41 and 6 tests respectively. Installation and button behavior were also manually checked on the C5. Local tests use simulated native dependencies and do not establish compatibility with every TV or protected HDMI source.

## License

GNU GPL v3; individual files that permit later versions retain that permission. See [LICENSE](LICENSE), [third-party notices](THIRD-PARTY-NOTICES.md), and [wave provenance](WAVE-PROVENANCE.md). This project is not affiliated with LG or Sony.
