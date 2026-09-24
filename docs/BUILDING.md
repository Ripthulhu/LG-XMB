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

```sh
export PYTHON=/path/to/python3
```

In PowerShell:

```powershell
$env:PYTHON = 'C:\path\to\python.exe'
```

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

For optional local PS3 fonts and personal builds, see [Fonts](FONTS.md).

```sh
npm run preview
```

Open <http://127.0.0.1:8765>. The server binds to loopback. App launches and other
TV actions are simulated; previewing doesn't install a helper or change TV
settings. Keep this terminal running for tests that use the preview server.

## Unit tests

```sh
npm test
```

Run the Python suites on Linux, including WSL on Windows. The native helper tests
use Linux file descriptors, permissions and `/proc`; they don't run on native
Windows or macOS.

```sh
python3 -B -m unittest discover -s tests -p 'test_*.py'
python3 -B -m unittest discover -s tv-helper -p 'test_*.py'
python3 -B -m unittest discover -s tv-helper/recovery -p 'test_*.py'
```

Some helper ownership tests need Linux and root in an isolated test environment.
The JavaScript suite skips its symlink check when Windows denies link creation;
run it on Linux to cover that case. The other packaging checks still run.
Capture-comparison tests need private fixtures and skip when they're absent.
A skipped comparison isn't a passing accuracy check.

## Browser tests

Install a browser for Playwright:

```sh
npx playwright install chromium
```

On Linux, use `npx playwright install --with-deps chromium` if the browser's system
libraries are missing. Select the downloaded browser before running the tests:

```sh
export PLAYWRIGHT_CHANNEL=bundled
```

In PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'bundled'
```

`PLAYWRIGHT_EXECUTABLE_PATH` selects an existing browser by its full executable
path. It takes priority over the channel. Without either setting, some scripts
use installed Edge and others use downloaded Chromium.

| Command | Preview server |
| --- | --- |
| `npm run test:compat` | Not needed |
| `npm run test:helper` | Not needed |
| `npm run test:browser` | Start `npm run preview` first |
| `npm run test:music` | Start `npm run preview` first |
| `npm run test:menu` | Starts its own server; stop the preview first |
| `node tests/appearance-browser.cjs` | Starts its own server on an available port |
| `node tests/screensaver-browser.cjs` | Starts its own server on an available port |
| `node tests/clock-style-browser.cjs` | Starts its own server on an available port |
| `node tests/remote-settings-browser.cjs` | Starts its own server on port 8798 |
| `node tests/wave-performance-browser.cjs` | Starts its own server on an available port |

The preview uses port 8765. Run the tests from the same checkout as the server.
These groups don't cover every browser test in `tests/`.

Focused guides list tests for [item options](ITEM-OPTIONS.md),
[date and time](DATE-TIME-AND-OPTIONS.md) and [menu sounds](MENU-SOUNDS.md).
The native renderer's Python browser checks use separate Python dependencies
and research fixtures; see [renderer validation](WEBGL2.md#validation).

## Optional tools

`npm run tools:download` downloads a pinned, checksum-verified `ares-cli-rs`
archive into `.tools/`. It doesn't extract or run it, and the normal build
doesn't need it. `@webos-tools/cli` remains the IPK packager.

Don't commit `.build/`, `dist/`, browser recordings, credentials or TV state.

## Install and set up Home

Follow [Installation and removal](INSTALLATION.md) to install the verified IPK.
Installing it adds the standalone launcher. Follow [Replacing LG Home](HOME-TAKEOVER.md)
for the separate root-only setup that makes it the TV's Home screen.
