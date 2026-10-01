# Navigation performance

The menu reuses its rows and category faces. Changing selection updates their
state rather than rebuilding the whole menu.

## Category and row changes

Appearance → Advanced → Menu animations offers Simple and PS3. PS3 moves the
lists with their categories and lets previous columns fade out; Simple swaps lists immediately while retaining the category
bar and vertical scrolling animations. The choice is saved, and PS3 remains the
default. The Animation Off setting disables motion in either style.

`app/category-transition.js` enables the category transition or settles it
immediately on lifecycle changes. Each category keeps its selected row. Inactive
row groups fade to zero opacity in PS3 mode; only the active group
owns the `item-N` accessibility IDs.

The category bar and item track share a 400 ms CSS transform transition and
receive the same target in one render. Each list keeps its category's fixed
offset. This prevents repeats, reversals and skipped rendering intervals from
separating the column from its icon. Independent entry keyframes cannot do that:
they restart at a full spacing while the bar continues from its current position.

Lists, category names and highlights fade over 320 ms, finishing before movement
ends even when several changes overlap. Small retained category surfaces keep opacity layers ready;
this reduced paints on the C5 compared with promoting them on every press.
Blending several lists still has a frame cost with a busy background. Simple
mode avoids it. Inactive rows ignore pointer input immediately, and their click
handler rejects activation even while they are still fading. No frame callbacks
or animation-end cleanup timers drive navigation.

Switching categories updates only the outgoing and incoming rows. Catalog
membership is reconciled when apps, ordering or categories actually change.
The 726-row browser fixture produces the same DOM and particle targets while
avoiding all 726 membership reads on each category switch. Incoming labels are
still refreshed, including renamed inputs.

Up and Down don't change the horizontal bar's styles or interrupt its
transition. The controller changes row visibility, selection and accessibility
attributes only when their values change. Matching detail icons are reused.

Vertical rows animate by one row spacing in either direction. The gap above the
category bar is a separate layout offset, so selecting an upper row does not
make it travel four times farther than a lower row. Up and Down share the repeat
interval and animation curve, including when held or reversed mid-animation.

Rows and their icon scaling use the same 400 ms transition as the category bar.
All held directions share a 100 ms minimum
repeat interval, both on the main screen and in settings panels. This is
responsiveness tuning, not an increase to the background frame rate. Particle
interaction keeps its original position approach curve.

Detail text updates 140 ms after navigation, so a burst of presses produces one
text update. The selected item changes immediately. HDMI preview routing also
changes immediately because leaving an input must stop its live preview.

Holding OK uses the same 650 ms gesture timer for keyboard and pointer input.
A short press launches on release. Launching on key-down would open the app
before the options hold could finish.

Wheel navigation has its own controller in `app/wheel-navigation.js`. The C5
reports 120 pixel units per notch and can combine fast notches into 240 or 360.
The first step is immediate; additional events within a frame update the final
selection together. Small deltas accumulate, and reversal clears pending motion.
There is no timed repeat or inertia after the wheel stops. Row transitions use
90 ms while scrolling with the wheel; keyboard input restores the 400 ms curve.
Settings panels and application information retain native browser scrolling.

## What to check

Use stable catalog IDs in tests. `tests/support/menu-navigation.cjs` finds a
bounded route through the current menu rather than assuming a category or row
index. Returning to TV can restore an HDMI row; select Live TV explicitly when
a test needs a non-HDMI item.

```sh
node --test tests/category-transition.test.cjs tests/menu-navigation.test.cjs
node tests/category-transition-browser.cjs
node tests/upper-items-browser.cjs
node tests/launcher-category-work-browser.cjs
node tests/settings-traversal-browser.cjs
node tests/vertical-navigation-browser.cjs
node tests/launcher-repeat-browser.cjs
node tests/wheel-navigation-browser.cjs
```

For tests that load the preview URL, start `npm run preview` first. Browser
selection is described in [BUILDING.md](../BUILDING.md).

On the TV, test long traversals and immediate reversals with the normal waves
and particles enabled. Check rows above the category bar, focus, long presses,
preview release and return from apps. Keep quality settings identical when
comparing two builds. See [PERFORMANCE.md](../PERFORMANCE.md) for GPU and cache
checks.
