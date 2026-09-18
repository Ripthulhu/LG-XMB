# App categories, refresh and instant options

Hold OK for 650 ms to open the options menu. The panel now appears and closes
immediately, with no transform, opacity, frame staging or transition completion
handler. The reusable DOM is hidden when closed, so it has no panel/shade bounds
or dedicated painted layers. Settings styling, short-press-on-release, sound
mapping and uninstall confirmation remain intact.

## Categories

Choose **Categories**, check one or more destinations, then choose **Apply
categories**. Plex can appear in Music and Video, for example. Photo, Music,
Video, TV, Apps, Browser and Network are available. OK/Enter, Space or a pointer
click toggles a choice without closing the picker. Toggling changes only the
pending selection; it does not move any shortcuts or write preferences.

Apply saves the complete selection once. Back, Cancel, clicking outside the panel,
or leaving Home discards pending changes. At least one category must be selected.
**Default locations** stages the original locations; Apply restores them. Platform
shortcuts use their catalog locations, while other apps default to Apps. There is
no Plex/store-ID special case.

Assignments are saved by native app ID under `lg-xmb-app-categories-v1`, not by
localized title or row position. Values are now arrays of category IDs. The loader
also accepts existing single-category string values and normalizes them in memory,
without writing storage during startup. The next successful Apply saves the
normalized map. Invalid or empty saved values fall back to the original locations.
The earlier single-category implementation does not understand the new arrays;
export preferences before intentionally downgrading to that implementation.

There is one shortcut per app per selected category, with a distinct row object
and button in each. The existing per-category button cache cannot share a button
between Music and Video. Unchanged app enumeration retains surviving row objects,
list arrays and selections, so it does not rebuild the menu. App-title updates are
copied into every placement without replacing the surviving row objects.

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

All saved memberships survive uninstall/reinstall and are restored when the app
is seen again. Background refresh remains deferred while the picker is open;
an incoming inventory reply cannot replace the pending selection. The panel keeps
its instant open/close behavior and existing settings styling.

## New and removed applications

Home reads the complete visible-app list on startup, visibility/pageshow return,
and webOS relaunch. A visible-only 30-second timer also discovers installations
completed while Home was already open. Repeated return events are coalesced;
there is one in-flight request and at least two seconds between read attempts.
**Refresh apps** in the options menu requests an earlier check.

Reconciliation waits until navigation has settled for 500 ms, no OK/pointer hold
is pending, no modal is open, and no launch/uninstall is pending. A queued result
does not change the target of an open options panel. New unassigned apps appear
under Apps. Deleted discovered apps disappear from whichever category they were
assigned to. Native platform anchors remain available even if a visibility-only
reply omits them. Surviving selections, sorting and DOM row objects are retained;
a semantically unchanged reply triggers no menu render or row mutations.

Hide/pagehide cancels native enumeration and invalidates its callbacks. Errors,
malformed and oversized (>1000 entry) snapshots are not interpreted as an empty
catalog. A confirmed local uninstall invalidates earlier reads and suppresses a
stale positive entry until a full snapshot has observed absence; a later presence
is treated as reinstall. Cancellation changes only read requests, not an uninstall
already dispatched to the native service.

The implementation reuses `C5TV.listApps()` and does not add a private subscription
protocol or assume webOS OSE's install-change event schema is present on TV.
LG's lifecycle documentation: https://webostv.developer.lge.com/develop/guides/app-lifecycle-management

## Diagnostics and scope

`C5App.getState().appRefresh` reports active/read/pending state, read/update counts,
last successful monotonic timestamp and the last error. `appCategories` reports
saved explicit assignments. These fields contain no app file contents.

No shaders, particle simulation, wave coverage cap, assets, sound files, helper,
Home manifest, application ID or permissions are changed. The 8-category layout
and existing horizontal/vertical navigation animation are unchanged. No per-frame
inventory work, new backdrop filter or extra WebGL pass was added.

Tests use Chromium with simulated TV services/media and a static renderer
fixture. They exercise the real UI/controller/CSS, not TV installation/uninstall
or C5 frame time. First-open layout/paint still has a cost; the multi-frame sliding
animation has been removed rather than made faster.

Checkbox keyboard semantics follow the WAI-ARIA checkbox pattern:
https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/
