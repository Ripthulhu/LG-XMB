# Code map

LG-XMB is a plain JavaScript web app. There is no framework, transpiler or runtime
module loader. `app/index.html` loads local scripts in dependency order, then
`app/app.js` connects them to the page. Packaging copies these sources without
minifying them.

Start with `app/catalog.js` for the menu contents and `app/index.html` for the
page structure. Read the controller only when a change crosses feature boundaries.

## Responsibilities

| Area | Files | Responsibility |
| --- | --- | --- |
| Launcher | `app/app.js` | Create features; coordinate selection, launch, focus and page lifecycle |
| Launcher view | `app/launcher-view.js` | Cache category, item and detail DOM; position menu rows |
| Preferences | `app/launcher-preferences.js` | Defaults, themes, saved-value migration, persistence and quality options |
| Menu content | `app/catalog.js`, `app/icons.js` | Default categories and shortcuts; reusable SVG icons |
| App organisation | `app/app-categories.js`, `app/menu-order.js` | Category assignments, hidden apps, sorting and successful-launch history |
| App discovery | `app/app-refresh.js` | Schedule inventory reads and defer reconciliation while the user interacts |
| Item options | `app/item-options.js`, `app/item-options.css` | Long-press panel, hide/restore, category selection and uninstall confirmation |
| Input handling | `app/hold-gesture.js`, `app/directional-repeat.js`, `app/menu-focus.js`, `app/category-transition.js` | Hold state, repeat pacing, focus/scroll and horizontal transitions |
| Shared settings controls | `app/settings-ui.js` | Option rows, choice groups and generic panel navigation |
| Appearance | `app/appearance-settings.js`, `app/wave-color-settings.js` | Theme, wave quality and colour controls |
| Other settings panels | `app/remote-settings.js`, `app/date-time-settings.js` | Feature-specific controls and keyboard navigation |
| TV APIs | `app/tv-bridge.js`, `app/app-manager.js`, `app/system-time.js` | Bounded native requests for launch/input/audio, app information/removal and clock settings |
| HDMI pictures | `app/thumbnail.js`, `app/input-preview.js` | Cached images and optional live video; separate lifecycles |
| Audio | `app/background-music.js`, `app/menu-sounds.js` | Playback, availability, suspension and recovery |
| Helper client | `app/helper.js` | Verified setup, capture health reads and bounded resume recovery |
| Page styling | `app/style.css`, `app/date-time-settings.css` | Layout, typography, shared controls and date/time controls |

Feature modules expose a small `C5…` or `LGXMB…` browser global. Modules that can
run independently also export through CommonJS for Node tests. Keep private
state inside the module. Pass callbacks, storage and service adapters through
the existing constructors rather than reaching into launcher state.

The catalog is the initial menu, not an immutable snapshot: app discovery and
saved organisation update its lists. The launcher owns selection; the view owns
DOM caches. Native application IDs identify apps; titles are display text.

## Common changes

### Shortcuts and categories

Edit `app/catalog.js`. A native shortcut uses an app ID; an internal setting or
input uses an `action` handled by the launcher. Keep IDs stable so saved sorting,
hidden apps and category assignments still refer to the same items.

Discovered apps are normalised in `app/app-categories.js`. A new destination
category also needs that module's destination list. Use
`tests/catalog.test.cjs`, `tests/app-categories.test.cjs` and
`tests/catalog-browser.cjs` for these changes. Test empty categories as well as
populated ones.

### Icons

Add or edit a named SVG body in `app/icons.js`. `C5Icon(name)` supplies the
48 × 48 view box, `currentColor`, even-odd filling and accessibility attributes.
Paths should contain only trusted local markup. Labels are separate text nodes.

The `apps` icon is the controller for the category; `application` is the cube
for ordinary apps and the fallback for unknown icon names. A catalog shortcut
can choose its own icon. Discovered-app exceptions are assigned by
`iconForApp()` in `app/catalog.js`. Check category, list-row and detail sizes together.

Settings icons are composed in `app/icons.js` from the `settingsIcons` table:

- `body` holds the symbol's SVG or reuses a plain icon, such as `paths.hdmi`.
- `transform` sizes and places that body within the 48 × 48 view box.
- `badge` optionally moves the wrench centre. `settingsBadgeLayout.radius`
  controls its size for every settings icon; `settingsBadgePath` defines its shape.

Add one table entry and assign its name in the catalog. Composition and the
`settings-symbol` class are automatic; there is no second list to update.
Adjust `--settings-icon-scale` in `app/style.css` to enlarge all settings row
icons together. Their slot and text alignment stay fixed, and the detail icon
keeps its own size. Tune individual body transforms only for optical balance;
do not compensate for a small body by shrinking the shared wrench.

### Layout

Edit `app/style.css` for page layout and `app/launcher-view.js` for row offsets
and visibility. Horizontal category spacing uses
`LGXMBCategoryTransition.DISTANCE` in `app/category-transition.js`.

The view's `menuObjects()` supplies numeric icon positions to the particle
simulation. If menu geometry changes, update those positions too; they avoid
measuring DOM layout on every frame. Check both 720p and 1080p layouts, plus
rapid navigation and parked categories, before changing the row cache.

### Settings

Keep a setting's stored value, allowed values, control and runtime effect
consistent. Add it to `app/launcher-preferences.js` before adding its control.
Preserve old stored keys or supply a migration; changing a visible label does
not require renaming its saved value.

Panels use the shared modal markup, styles and `app/settings-ui.js` controls.
Reuse `LGXMBMenuFocus` and the existing directional handlers; do not add another
document-level key listener for each panel. Back closes or returns to the parent
panel. Opening a panel must set a predictable initial focus, and later status
replies must not move it.

`app/appearance-settings.js` builds Theme and Appearance. Audio and helper
status handling remain in the launcher, with playback in the audio modules.
Keep new feature-specific rendering in a module and let the launcher provide
its dependencies.

### Helper lifecycle and status

`app/helper.js` owns native setup and capture health; `app/app.js` owns the
Settings text and focus. Setup readiness is not proof that the capture worker
is still running. Read `captureHealth` separately from `ready` and the last
setup result's `captureRunning` value.

The launcher calls `resume()`, `suspend()` and `destroy()` with its page
lifecycle. Resume events are deduplicated. A previously confirmed worker gets
10 seconds to refresh its heartbeat before one recovery attempt for a stopped,
stale or explicitly missing status file. Uncertain setup failures require
manual Retry; they must not become an automatic setup loop. Suspension cancels
health reads and delayed recovery, and late responses cannot update a new session.

Input preview Settings uses `watchCapture(true)` for five-second, read-only
health checks and turns it off when the panel closes. Health changes emit
`lg-xmb-helper-status`. Successful recovery separately emits
`lg-xmb-helper-recovered`, which refreshes the selected cached picture and audio
links once. Ordinary heartbeat reads must not reload media or move focus.
When Retry disappears, move focus off that button before hiding it.

Run `npm run test:helper` for the helper and thumbnail unit tests plus the
Settings/lifecycle browser checks. These use local fixtures, not a TV. Native
capture and recovery still need device validation.

### Background and animation

| Source | Edit it for |
| --- | --- |
| `app/launcher-preferences.js` | Theme definitions and launcher quality defaults |
| `app/wave-colors.js` | Monthly presets, colour normalisation and interpolation |
| `app/ps3-background-clock.js` | Calendar and day/night calculations |
| `app/ps3-native-core.js` | CPU wave/particle simulation |
| `app/ps3-particle-birth.js` | Particle-birth equations |
| `app/ps3-native-renderer.js` | WebGL resources, draw passes and the `C5Wave` interface |
| `shaders/*.vert`, `shaders/*.frag` | Shader behaviour |

`app/ps3-native-shaders.js` is generated. Edit `shaders/`, then run
`python3 tools/bundle-ps3-shaders.py` and its `--check` mode. Commit both the
source and regenerated bundle. See [Building](BUILDING.md) for Windows commands.

`app/ps3-native-data.js` and `app/ps3-background-data.js` are committed numerical
and texture data, not UI code. Their long encoded strings are intentional.
Do not format them by hand or replace them with a private firmware dependency.
The optional import tool and research fixtures are not part of a normal build.
See [WebGL 2](WEBGL2.md) and [provenance](../WAVE-PROVENANCE.md) before changing
the recovered arithmetic or source data.

## Behaviour to preserve

- Keep the selected app and surviving row objects when inventory changes. The
  launcher uses object identity to reuse buttons and painted rows.
- Hide and recategorise affect shortcuts. Uninstall is a separate confirmed
  native operation; successful app launches alone update recently used history.
- Cancel or invalidate stale reads on hide, relaunch and teardown. An old reply
  must not reopen a preview, overwrite a newer selection or resume audio.
- Cached thumbnails must not start live HDMI video. Live video stops when its
  eligible row or page is left. Playback and background animation pause when
  Home is hidden.
- Keep service timeouts, app-ID validation and helper ownership/hash checks.
  Missing optional services must not prevent ordinary menu navigation.
- Avoid DOM measurement, whole-list reconstruction and storage writes on each
  animation frame. Test held directions and opening menus, not just single taps.

## Sources, packages and installed copies

`app/` is the editable frontend. `tv-helper/` is the editable Python worker and
recovery code. `app/helper-startup.py` is the bootstrap; packaging stages the
worker and fills its bundle pin. Do not edit the generated helper bundle.

`.build/package/app` is temporary staging and `dist/` contains build outputs.
Neither is a source directory. The packaged manifest, helper pin and version
checks are described in [Building](BUILDING.md).

On the TV, the standalone IPK and a copied Home replacement are separate
installations. Updating one does not update the other. The optional bind mount
and its recovery belong to [Home takeover](HOME-TAKEOVER.md), not to the normal
build. Tests and preview must not deploy, mount or change TV files automatically.

## Validate at the boundary you changed

Use unit tests for data normalisation, migrations, ordering and cancellation.
Use browser tests for focus, remote input, layout and the connection between
modules. `C5App.getState()` exposes diagnostics for those tests.

`npm test` does not include browser or Python tests. The browser commands in
`package.json` run selected groups, not every script in `tests/`. Some older
fixtures provide their own script list and mock services; update them when
adding a runtime dependency to `app/index.html`. Check their preview port and
browser options before running a standalone script.

Start with [Building and testing](BUILDING.md), then the relevant feature guide.
A browser fixture proves UI behaviour with its mocks. Native playback, HDMI,
standby and recovery still need the affected path tested on a TV.
