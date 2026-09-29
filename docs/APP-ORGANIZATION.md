# App categories and refresh

Hold OK for 650 ms to open the [item options](ITEM-OPTIONS.md).

## Categories

Choose **Categories**, check one or more destinations, then choose **Apply
categories**. Plex can appear in Music and Video, for example. Photo, Music,
Video, TV, Apps, Browser and Network are available. OK/Enter, Space or a pointer
click toggles a choice without closing the picker. Toggling changes only the
pending selection; it does not move any shortcuts or write preferences.

Apply saves the complete selection once. Back, Cancel, clicking outside the panel,
or leaving Home discards pending changes. At least one category must be selected.
**Default locations** stages the original locations; Apply restores them. Platform
shortcuts use their catalog locations, while other apps default to Apps.

Assignments use native app IDs and category-ID arrays in `lg-xmb-app-categories-v1`.
The loader accepts older single-category strings; the next successful Apply saves
their normalized form. Invalid or empty values fall back to the original locations.
Export preferences before downgrading to the older single-category implementation,
which cannot read these arrays. See `app/app-categories.js` for storage and placement.

After applying, focus stays on that app in the current category when it is still
selected. Otherwise it follows the app to the first selected category in menu
order. Other categories retain their selections and sort preferences. A refused
storage write leaves both placements and selections unchanged, and keeps the
picker open with an error so the choice can be retried.

Inputs, local launcher settings and empty placeholders cannot be recategorized;
Settings is not offered for arbitrary apps. Recategorization changes only launcher
placement, not native app metadata or uninstall rights. Information lists all
current locations. **Delete remains a single native uninstall:** it removes every
shortcut for the app, not just the current placement. Uncheck a category and Apply
to remove only that shortcut.

Saved memberships survive uninstall/reinstall. Background refresh waits while the
picker is open, so an inventory reply cannot replace the pending selection.

## New and removed applications

Home reads the complete visible-app list on startup, visibility/pageshow return,
and webOS relaunch. A visible-only 30-second timer also discovers installations
completed while Home was already open. Repeated return events are coalesced;
there is one in-flight request and at least two seconds between read attempts.
**Refresh apps** in the options menu requests an earlier check.

Updates wait for 500 ms of settled navigation and no held OK/pointer, open modal
or pending launch/uninstall. New unassigned apps appear under Apps; removed apps
disappear from all assigned categories. Native platform shortcuts remain available
if a visibility-only reply omits them. Updates preserve surviving selections and
sort order; an unchanged inventory does not rebuild the menu.

Leaving Home cancels inventory reads, but cannot cancel a sent uninstall. Failed,
malformed or oversized (>1000 entry) snapshots do not empty the catalog. After a
confirmed local uninstall, stale entries stay suppressed until a full snapshot
observes absence; a subsequent presence is treated as reinstall.

See `app/app-refresh.js` and LG's
[lifecycle guide](https://webostv.developer.lge.com/develop/guides/app-lifecycle-management).

## Diagnostics

`C5App.getState().appRefresh` reports active/read/pending state, read/update counts,
last successful monotonic timestamp and the last error. `appCategories` reports
saved explicit assignments. These fields contain no app file contents.

Browser tests use simulated TV services/media and a static renderer. They exercise
the UI/controller/CSS; TV installation, uninstall and frame time need device checks.

Checkbox keyboard semantics follow the WAI-ARIA checkbox pattern:
https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/
