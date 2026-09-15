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

For the existing full browser suite, start `npm run preview` in another terminal,
then run `npm run test:browser` and `node tests/wave-retention-browser.cjs`.
These use installed Edge by default; `PLAYWRIGHT_CHANNEL=chrome` selects Chrome.
CI installs the required browsers explicitly.

`npm run test:music` runs the focused background-music browser checks against the
preview server, using generated silent PCM for audio lifecycle checks. No recording is required.
Native launches
and HDMI playback are simulated; actual audio handoff still needs a TV test.

`npm run test:menu` runs the focused category-motion and wave-renderer checks
against a local preview server. It tests both UI sizes, interrupted transitions,
reduced motion, selection styling and renderer lifetime. It does not replace the
full browser suite or on-TV testing.

## Releases

Build with `npm run package`, then `npm run verify:package`. Review manifest
changes together with the helper's exact-byte pin. Keep the app ID and existing
preferences stable unless the change includes a migration.

A release needs a TV test record, including install, upgrade, removal and recovery.
List untested platforms as untested. Automated tests are not a substitute for
those checks. Preserve upstream licenses and provide matching source alongside
binaries.

Follow the [Homebrew publishing rules](https://www.webosbrew.org/develop/guides/publishing/rules/).
Disclose AI assistance in review or submission; a maintainer must understand and
review the code. Do not replace missing validation with generated descriptions
or compatibility claims.

### Publish a prerelease

Add notes in `docs/releases/<app-version>.md`, including known limitations.
In GitHub Actions, run **Publish prerelease** on `main` with the successful
**Checks** push run ID and its full source commit SHA. The workflow promotes
that exact IPK and matching source, verifies the files before and after upload,
and publishes a prerelease with SHA-256 checksums. It does not rebuild the app,
replace an existing release or tag, or publish automatically on normal pushes.
