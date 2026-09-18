# Navigation performance

The menu reuses its rows and category faces. Changing selection updates their
state rather than rebuilding the whole menu.

## Category and row changes

`app/category-transition.js` moves the category strip. Each category keeps its
selected row. Inactive row groups stay parked offscreen, and only the active
group owns the `item-N` accessibility IDs.

Up and Down don't change the horizontal bar's styles or interrupt its
transition. The controller changes row visibility, selection and accessibility
attributes only when their values change. Matching detail icons are reused.

Detail text updates 140 ms after navigation, so a burst of presses produces one
text update. The selected item changes immediately. HDMI preview routing also
changes immediately because leaving an input must stop its live preview.

Holding OK uses the same 650 ms gesture timer for keyboard and pointer input.
A short press launches on release. Launching on key-down would open the app
before the options hold could finish.

## What to check

Use stable catalog IDs in tests. `tests/support/menu-navigation.cjs` finds a
bounded route through the current menu rather than assuming a category or row
index. Returning to TV can restore an HDMI row; select Live TV explicitly when
a test needs a non-HDMI item.

```sh
node --test tests/category-transition.test.cjs tests/menu-navigation.test.cjs
node tests/category-transition-browser.cjs
node tests/upper-items-browser.cjs
```

For tests that load the preview URL, start `npm run preview` first. Browser
selection is described in [BUILDING.md](../BUILDING.md).

On the TV, test long traversals and immediate reversals with the normal waves
and particles enabled. Check rows above the category bar, focus, long presses,
preview release and return from apps. Keep quality settings identical when
comparing two builds. See [PERFORMANCE.md](../PERFORMANCE.md) for GPU and cache
checks.
