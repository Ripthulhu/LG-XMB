# Contributing

Keep changes small enough to review. Describe the problem, the change and how
you tested it. Bug reports should include the app version, TV model, installed
webOS version and steps to reproduce; do not include device credentials or
captured HDMI pictures.

## Code

Target Chromium 87 for the web app (webOS 22). Use the existing plain JavaScript
modules; a new framework or dependency needs a concrete reason. Follow
`.editorconfig`. Do not mix whole-file formatting with behavior changes.
Comments should explain platform constraints or non-obvious decisions, not
repeat the code. Keep user-facing text short and describe only implemented
features.

Optional TV APIs must fail independently. A successful read from a root shell
does not establish permission to write from the packaged app. Do not loosen
process identity, path, manifest or restoration checks to make another model
appear supported. Add evidence and tests for the new behavior instead.

## Performance guardrails

The C5 rendering budget is tight. Follow [the performance notes](docs/PERFORMANCE.md)
and run the focused cache/layer tests after changing rendering or menu code.

- Keep composite colour, tone mapping and output `mediump`; use `highp` for
  addressing and the dither hash. Cached colour generation may use `highp`.
- Cache constant spatial work. Do not rebuild gradients, lookup tables, or
  serialized cache keys every animation frame.
- No `will-change` in any app stylesheet, and no opacity on text or its
  containers. Dim with colour alpha; animate transforms, not text colours.
- Closed overlays must leave the painted layer tree. Reuse their DOM, not
  permanent full-screen GPU surfaces.
- Full-size render targets stay 32-bit UNORM. Floating-point render targets
  require an explicit tiny-size exception, not a default format switch.

## Tests

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
python3 -B -m unittest discover -s tests -p 'test_*.py'
python3 -B -m unittest discover -s tv-helper -p 'test_*.py'
python3 -B -m unittest discover -s tv-helper/recovery -p 'test_*.py'
```

The isolated layout test starts no TV connection or preview server:

```sh
npx playwright install chromium
npm run test:compat
```

It checks native CSS and forces the aspect-ratio fallback at 720p and 1080p.
Forcing a fallback is not emulating Chromium 87 or testing a TV. To use an
installed browser, set `PLAYWRIGHT_CHANNEL=chrome` or
`PLAYWRIGHT_EXECUTABLE_PATH` to its executable.

For the full browser suite, start `npm run preview` in another terminal, then
run `npm run test:browser`. It uses installed Edge by default;
`PLAYWRIGHT_CHANNEL=chrome` selects Chrome. The WebGL checks rely on
`app/ps3-native-data.js` and `app/ps3-background-data.js`, which are committed.

`npm run test:music` runs the focused background-music browser checks against the
preview server, using generated silent PCM for audio lifecycle checks. No recording is required.
Native launches
and HDMI playback are simulated; actual audio handoff still needs a TV test.

`npm run test:menu` runs the focused category-motion checks against a local
preview server: both UI sizes, interrupted transitions, reduced motion and
selection styling. It does not replace the full browser suite or on-TV testing.

## Releases

Build with `npm run package`, then `npm run verify:package`. Review manifest
changes together with the helper's exact-byte pin. Keep the app ID and existing
preferences stable unless the change includes a migration.

There's no CI and no release workflow at the moment, on purpose. The renderer is
still being tested on the TV, so builds are made on a computer and installed by
hand (see [Installation](docs/INSTALLATION.md)). When a build is worth
publishing, attach the IPK, `SHA256SUMS` and matching source from `dist/` to a
GitHub release yourself, with notes in `docs/releases/<app-version>.md` that
include the known limitations.

A release needs a TV test record, including install, upgrade, removal and recovery.
List untested platforms as untested. Automated tests are not a substitute for
those checks. Preserve upstream licenses and provide matching source alongside
binaries.

Follow the [Homebrew publishing rules](https://www.webosbrew.org/develop/guides/publishing/rules/).
Disclose AI assistance in review or submission; a maintainer must understand and
review the code. Do not replace missing validation with generated descriptions
or compatibility claims.
