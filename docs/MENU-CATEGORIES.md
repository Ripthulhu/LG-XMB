# Menu categories

The horizontal order is Settings, Photo, Music, Video, TV, Apps, Browser,
Network. Users and Friends are not included. Inputs and Library
are replaced by the relevant TV and media categories, not added as extra tabs.
The selected category remains anchored and the bar scrolls; the eight icons are
not squeezed into the old five-category width.

| Category | Shortcuts |
| --- | --- |
| Settings | Existing launcher settings and native TV Settings |
| Photo | LG Gallery+ and Media Player |
| Music | Native Music and Media Player |
| Video | Media Player |
| TV | Live TV, LG Channels, HDMI 1–4 |
| Apps | Home Hub, then other apps returned by installed-app discovery |
| Browser | Web Browser |
| Network | Homebrew Channel and LG Apps |

Only existing curated application IDs are reused. Media Player deliberately
appears in all three media categories: it is the shared native media browser,
not a verified photo/music/video-specific deep link. This change does not add a
media indexer, new player, subscription, or remote service. Other discovered
apps remain under Apps; there is no title-based guessing of app genres.

Homebrew Channel and the LG store share the Network category. Browser remains separate. Selecting a
category does not launch anything. OK/Enter on its item uses the existing
application manager path. Native app availability is still model/firmware
specific; existing launch-error handling remains in place.

Startup selects TV by its category ID, not an array index. HDMI preview routing
uses each item's input action and physical app ID, not the old Inputs tab.
Label refresh ignores TV's non-input entries and updates the existing HDMI
nodes in place. Each category keeps its own selected row. Curated apps are
still excluded from the discovered Apps list to avoid duplicates.

Wave/particle code, animation timing, app identity and preference keys remain
unchanged. Optional local sound playback is described in MENU-SOUNDS.md. Its
same-origin loader is the only reason connect-src now allows 'self'.

## Focused tests

```sh
node --test tests/catalog.test.cjs
node tests/catalog-browser.cjs
```

The browser test uses the app controller, HTML, local CSS, catalog, icons and
category-transition module, with explicit doubles for the TV bridge, media
previews, music and background renderer. It loads local source strings without
a server. CSP bypass is only a test-harness setting for injection; the product
CSP is not changed. Use PLAYWRIGHT_EXECUTABLE_PATH to select a local Chromium.
The project Playwright dependency is sufficient; no new production dependency
is added.

The focused tests cover category order, native targets, discovery/deduplication,
startup, category boundaries, rapid reversal, selected-row retention,
accessibility IDs, cached/live HDMI routing, label changes, error recovery,
and reduced motion at 1280×720, 1920×1080 and 1024×768.

These do not certify TV launches, HDMI playback, GPU performance or the entire
repository test suite. Older browser scenarios that assume Watch/Inputs or
fixed column indices need their navigation routes updated to this new catalog;
the stable data attributes should be used instead of positional selectors.
