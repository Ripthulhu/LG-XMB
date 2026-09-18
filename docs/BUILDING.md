# Building and testing

Run these commands from the repository root. Building doesn't connect to a TV.

## Requirements

Use Node.js 20 or newer and Python 3.10 or newer. The TV helper has a separate
requirement of Python 3.7 or newer on the TV.

`package-lock.json` pins the Node dependencies. The packager uses
`@webos-tools/cli` 3.2.6; browser tests use Playwright. You don't need a native
webOS SDK for this HTML/JavaScript app.

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

Packaging calls `python3` on Linux and macOS, or `python` on Windows. Set `PYTHON`
to another interpreter path when needed.

## Make an IPK

```sh
npm run package
npm run verify:package
```

Output is in `dist/`: the versioned IPK, `SHA256SUMS` and `package-info.txt`.
The second command inspects the existing IPK; it doesn't rebuild it.

The packager stages `app/` under `.build/package/app`, copies the helper from
`tv-helper/`, writes its hash manifest and fills the bootstrap's bundle pin.
It checks the helper bytes and permissions inside the finished IPK. The CLI's
writable directory modes are corrected before checksums are written.

Don't package `app/` directly with `ares-package`: that skips helper staging and
verification. Don't edit files under `.build/`; rebuild from their sources.

The app ID remains `org.local.openxmb.c5`. Version values in `package.json`,
`app/appinfo.json` and `tools/package.mjs` must agree. A manifest edit also needs
the matching `PIN_APPINFO_SHA256` in `tv-helper/thumbnail_cache.py`.

## Included runtime data

`app/ps3-native-data.js` and `app/ps3-background-data.js` are committed and used
by the current renderer. The shader sources are under `shaders/`; their generated
JavaScript bundle is committed as `app/ps3-native-shaders.js`.

A normal build needs no private archive, firmware dump or import command.
`private-data/` contains optional research fixtures and isn't part of the build.
The licence distinction for extracted data is covered in
[renderer notices](WEBGL2-NOTICES.md).

After editing shaders, regenerate and check the bundle:

```sh
python3 tools/bundle-ps3-shaders.py
python3 tools/bundle-ps3-shaders.py --check
```

Use `python` instead of `python3` on Windows when that's the installed command.

## Desktop preview

```sh
npm run preview
```

Open <http://127.0.0.1:8765>. The server binds to loopback. App launches and other
TV actions are simulated; previewing doesn't install a helper or change TV
settings. Keep this terminal running for tests that use the preview server.

## Unit tests

```sh
npm test
python3 -B -m unittest discover -s tests -p 'test_*.py'
python3 -B -m unittest discover -s tv-helper -p 'test_*.py'
python3 -B -m unittest discover -s tv-helper/recovery -p 'test_*.py'
```

Some helper ownership tests need Linux and root in an isolated test environment.
Capture-comparison tests need private fixtures and skip when they're absent.
A skipped comparison isn't a passing accuracy check.

## Browser tests

Install a browser for Playwright:

```sh
npx playwright install chromium
```

`npm run test:compat` runs the isolated layout checks. With the preview server
running, `npm run test:browser`, `npm run test:music` and `npm run test:menu` run
their respective browser groups. These scripts don't cover every browser test
in `tests/`.

Browser selection differs between older and newer test scripts. Some default to
installed Edge, while others use Playwright's Chromium. Use
`PLAYWRIGHT_EXECUTABLE_PATH` where supported, or `PLAYWRIGHT_CHANNEL=chrome` for
scripts that select a browser channel. Read the script's launch options when
setting up a machine without Edge.

Focused guides list tests for [item options](ITEM-OPTIONS.md),
[date and time](DATE-TIME-AND-OPTIONS.md) and [menu sounds](MENU-SOUNDS.md).
The native renderer's Python browser checks use separate Python dependencies
and research fixtures; see [renderer validation](WEBGL2.md#validation).

## Optional tools

`npm run tools:download` downloads a pinned, checksum-verified `ares-cli-rs`
archive into `.tools/`. It doesn't extract or run it, and the normal build
doesn't need it. `@webos-tools/cli` remains the IPK packager.

Don't commit `.build/`, `dist/`, browser recordings, credentials or TV state.
