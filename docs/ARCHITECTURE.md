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
| Menu content | `app/catalog.js`, `app/icons.js` | Default categories, app placement metadata and reusable SVG icons; inventory confirms which shortcuts exist |
| Desktop preview | `app/demo-data.js` | Example app/input snapshots, used only outside the TV |
| Item organisation | `app/app-categories.js`, `app/menu-order.js` | App/input categories and icon overrides, hidden apps, sorting and successful-launch history |
| App discovery | `app/app-refresh.js`, `app/tv-discovery.js` | Schedule inventory reads, select the native or elevated read transport and defer reconciliation during interaction |
| Physical inputs | `app/input-discovery.js`, `app/app-categories.js` | Validate reported input identities and reconcile actual sockets without resetting selection |
| Item options | `app/item-options.js`, `app/item-options.css` | Long-press panel, hide/restore, category and icon selection, uninstall confirmation |
| Input handling | `app/hold-gesture.js`, `app/directional-repeat.js`, `app/wheel-navigation.js`, `app/menu-focus.js`, `app/category-transition.js` | Hold state, key repeat pacing, wheel distance, focus/scroll and horizontal transitions |
| Shared settings controls | `app/settings-ui.js` | Option rows, choice groups and generic panel navigation |
| Appearance | `app/appearance-settings.js`, `app/wave-color-settings.js` | Theme, colour, background and advanced rendering controls |
| Wallpaper | `app/wallpaper.js` | Load the local image, retain a working background on failure and cancel stale loads |
| Clock display | `app/clock-view.js`, `app/clock.css` | Current and PS3 clock layouts, date formatting and analogue hands |
| Fonts | `app/fonts.css` | Optional local Rodin faces and system font fallback; see [Fonts](FONTS.md) |
| Screensaver | `app/screensaver.js`, `app/screensaver-view.js`, `app/screensaver.css` | Idle deadline, layer brightness targets, wake gestures, UI and wallpaper fades |
| Remote | `app/remote-settings.js`, `app/home-button.js`, `tv-helper/home_button.py`, `tv-helper/home_hook.py` | Verified saved Home choice and native Home hook; local Back preference |
| Other settings panels | `app/date-time-settings.js` | Clock formats and system date/time controls |
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

The TV outline follows the alpha channel of `icontex.qrc` texture `35n`, with
the DDS rows reversed for display. It retains the original 128 × 128 origin:
the screen sits on the icon column and the broadcast arcs extend up and right.
Its SVG allows that small overhang. Keep this origin when editing the symbol;
centring its full painted bounds moves the screen away from the label.

The `apps` icon is the controller for the category; `application` is the cube
for ordinary apps and the fallback for unknown icon names. A catalog shortcut
can choose its own icon. Discovered-app exceptions are assigned by
`iconForApp()` in `app/catalog.js`. Check category, list-row and detail sizes together.

`C5Icon.choices` in `app/icons.js` lists the symbols offered by the item icon picker.
Add a name and label there to make a plain icon selectable; keep wrench variants
out of that list. `app/app-categories.js` validates and saves overrides by item ID,
leaving each row's default `icon` intact. The view uses `customIcon` when present
and updates retained SVGs only when the choice changes.

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

The layout values at the top of `app/style.css` set the icon column (`--anchor`),
category and selection centres, row height, spacing and icon-to-label gap.
Keep the `--xmb-*` vertical values in `vh` and the anchor in percent.
`app/launcher-view.js` reads them on startup and resize, then uses the cached
values for row offsets, visibility and particle positions. A layout adjustment
therefore does not need a second set of coordinates in JavaScript.

Horizontal category spacing uses `LGXMBCategoryTransition.DISTANCE` in
`app/category-transition.js`. The bar and item track receive the same absolute
position in one render. Each retained list has a fixed category offset, so it
stays under its icon during repeats, reversals and jumps. Do not restart a
separate entry animation on the list: it would lose the bar's current position.
Gaps around the category bar and selected row
switch immediately; only the equal row steps animate, so Up and Down retain
the same motion. Navigation does not measure element bounds or computed styles.

Focus sizes use `--xmb-category-focus-scale` and `--xmb-item-focus-scale`.
PS3 3.01 uses an unfocused/focused ratio of 0.7 for categories and 0.42 for
ordinary Settings and shortcut icons. The selected scale multipliers are
1/0.7 (1.428571×) and 1/0.42 (2.380952×). These were checked against
the native size setters and settled objects in a saved firmware memory dump:
category setter `0x3b5fd0`, item scale defaults `0x3c8324`/`0x3c8350`, and item
size setter `0x3c0b40`. Media grids can use other ratios. Category icons blend
their prepainted faces and animate both SVG copies with the bar's transform
timing. Both copies therefore keep the same current scale, including during
reversals. Simple animations keep the instant size change. List icons use their
existing transform transition.

The horizontal bar also uses `--category-icon-scale` to account for different
padding in our 48px SVGs and the native 128px textures. The category rules in
`style.css` match visible symbol widths to the stock screenshot: at 4K, selected
Settings is 224px wide, Photo 134px, Music 121px, Video 166px, Apps 161px and
Browser 128px. This adjustment leaves the icon anchors, labels and vertical
list unchanged. Keep it separate from the focused/unfocused multiplier.
`tests/category-focus-browser.cjs` checks the visible sizes, zoom and reversals.

Run `tests/xmb-layout-browser.cjs`, `tests/vertical-navigation-browser.cjs` and
`tests/launcher-category-work-browser.cjs` after changing geometry. These cover
720p, 1080p and 4:3 placement, resizing, particle coordinates, matching Up/Down
motion and retained category rows.

Category names, icon highlights and incoming/outgoing lists retain their fades
when interrupted. The firmware uses focus and ShowItems/HideItems channels for
these changes. Our 400 ms movement curve approximates the native 200 ms approach
setting; `--fade-duration` is 320 ms so outgoing columns disappear while still
moving. CSS also shortens reversals, unlike the native timer.
Simple animations switch lists immediately. Reduced motion disables the fades
and movement. Fading-out lists ignore pointer input and are hidden from assistive
technology as soon as selection changes.

Vertical rows use the same 400 ms movement curve. Their text fades between
0.45 and 1, while ordinary icons stay opaque, matching the recovered Settings
item renderer. Horizontal icons blend a white copy over a fixed 0.7-alpha copy;
changing opacity avoids repainting their colour on every animation frame.

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

Directional navigation uses one filtered list of controls per key event. Hidden
and disabled choices must stay out of both row traversal and target selection.
When an asynchronous request finishes, update the current panel rather than a
control captured before the panel was reopened.

`app/appearance-settings.js` builds Appearance and its submenus. Audio and helper
status handling remain in the launcher, with playback in the audio modules.
Keep new feature-specific rendering in a module and let the launcher provide
its dependencies.

### Home routing and standalone discovery

`app/home-button.js` owns verified Home-button requests, including native
envelope and revision checks. `tv-helper/home_button.py` keeps the choice in
`/var/lib/lg-xmb/home-button.json`; `get` only reads saved state and worker
identity and native lease. An explicit change checks the revision, starts or
stops the separate worker and can clear an old native assignment only when it
names this exact LG-XMB app. Other apps' native assignments are preserved. The bootstrap verifies
the bundle before dispatch. This path does not run capture setup or alter
Home-replacement mounts. A failed or uncertain write requires a fresh read
before another explicit change.

`home_hook.py` copies the bootstrap's verified native bytes into
`/var/lib/lg-xmb/native/<build-id>/` and loads the hook into supported 32-bit ARM
LG input processes. It authenticates their events over a root-only Unix socket
and maintains a short lease. The hook handles Home only while that lease is
valid and event delivery succeeds; other input stays on LG's path. Disabling
removes the lease before stopping the worker. An older LG-XMB hook requires a
TV restart; other input hooks are reported as conflicts. The helper never
restarts LG services or stacks hooks.

Home launches once per press; native long-Home behaviour is unavailable while
enabled. The existing `60-lg-xmb` bootstrap restores the saved choice after
boot, without launching the app or changing Power On Screen. Recovery recognises
both this worker and the capture worker.

The bootstrap dispatches to a fixed Python path with environment and site imports
disabled, then removes the script directory from the import path. Its shared
bundle verification, Home commands and capture run on Python 2.7 and Python 3.
Capture timing uses a monotonic clock, falling back to Linux uptime on Python 2.
The native hook lease uses `CLOCK_BOOTTIME`, through `librt` on Python 2, so
time spent in standby counts toward expiry.
The capture worker retains the startup lock as stdin, which it never reads;
other setup descriptors are closed before execution. Filesystem operations use
held directory descriptors through `/proc/self/fd` so Python 2 does not need
`dir_fd` support.

Remote renders once per opening. Asynchronous reads and writes update existing
controls without rebuilding the panel or moving focus. Closing it invalidates
pending replies. The check mark reflects the saved choice; `running` and an
allowlisted reason describe runtime failure separately. A selected LG-XMB
choice can be selected again when `running` is explicitly false. Back remains
usable when Home routing is unavailable.

`app/tv-discovery.js` owns app, input and recent-app list reads. The standalone app
uses fixed read-only Homebrew commands directly. A Home replacement uses the
native services under the Home identity. Each request makes one call through
the matching transport; neither path retries through the other. Both share
response validation, with catalog normalisation in `app/tv-bridge.js`.
Capture setup is not a dependency.

### Helper lifecycle and status

`app/helper.js` owns native setup and capture health; `app/app.js` owns the
Settings text and focus. Read `captureHealth` separately from setup `ready` and
`captureRunning`: setup success does not prove the worker is running. See the
[helper guide](../tv-helper/README.md#verification-and-state) for recovery and tests.

Pair `resume()`, `suspend()` and `destroy()` with page lifecycle. Suspension
cancels reads and recovery and invalidates late replies; uncertain setup needs
manual Retry. Use `watchCapture(true)` only while Input preview Settings is open.
`lg-xmb-helper-status` updates status; `lg-xmb-helper-recovered` refreshes assets
once. Heartbeats must not reload media or move focus. Move focus off Retry before
hiding it.

[Home registration](HOME-TAKEOVER.md#mount-and-check) is a separate setup
transaction, never a page-resume or standby-recovery action.

### Background and animation

See the [renderer file map](WEBGL2.md#runtime-files) for simulation and shaders.
`app/wave-colors.js` owns colour normalisation, interpolation and menu gradients;
[PS3 menu colours](PS3-MENU-COLOURS.md) explains their separate palette and clock updates.

`backgroundTheme()`, `waveStyle()` and `waveQuality()` derive the renderer inputs
from saved preferences. Original and Classic control particles; colour is either
the native calendar-driven background or a fixed month at daytime. Keep these
decisions in preferences rather than adding competing switches to the renderer.

Rendering controls also live in `launcher-preferences.js`. Keep their allowed
values consistent with the renderer's allocation and frame pacing. Resolution,
mesh detail, particle count and frame rate are separate costs. Changing one
must preserve the other controls and existing saved choices.

The launcher pauses WebGL while a wallpaper is visible. Brightness dims the
rendered background or image, leaving the menu unchanged. The wallpaper module
preloads replacements, invalidates cancelled requests and reports failures to
the existing panel without moving focus. Its fixed runtime link is optional;
the helper must not read or overwrite the user's image.

The screensaver controller owns one idle deadline; cursor events update its
timestamp without replacing the timer. The view captures wake gestures before
normal navigation and fades whole UI layers with CSS. Keep idle dimming separate
from the saved background brightness. The launcher enables it only while Home
is active, stops live previews while asleep and resets it when returning from
another app. Cursor movement and lifecycle events must not rebuild the menu.

The clock refreshes every ten seconds while Home is visible and immediately
when it returns. Hiding Home stops the clock, app-inventory polling and pending
detail updates. The clock view only updates changed text and hand positions;
it has no animation loop or TV service calls. Keep display style separate from
the Date & time editor, which changes the TV's system clock.

`tests/page-lifecycle-browser.cjs` checks hidden startup, duplicate wake events
and pending detail cancellation with the actual launcher. The settings focus
and wallpaper completion checks live in `tests/settings-focus-browser.cjs` and
`tests/appearance-async-browser.cjs`.

Follow [Building](BUILDING.md#included-runtime-data) to regenerate shaders;
commit both source and bundle. Keep the committed numerical and texture data
intact, without hand-formatting or adding a private firmware dependency. Read
[provenance](../WAVE-PROVENANCE.md) before changing recovered arithmetic or data.

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

## Build, test and installed copies

Use [Building and testing](BUILDING.md) for source/staging paths, helper pins and
test commands. Edit sources, not generated bundles. `C5App.getState()` supplies
browser-test diagnostics; update fixtures with explicit script lists when adding
a runtime dependency. Browser mocks do not establish native TV behaviour.

The standalone IPK and copied Home replacement are separate installations;
updating one does not update the other. Follow [Home takeover](HOME-TAKEOVER.md)
for the latter. Tests and preview must not deploy, mount or change TV files.
