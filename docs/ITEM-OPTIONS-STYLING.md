# Shared styling for item options

The long-press panel now uses the same `.modal-backdrop`, `.modal`, `.modal-top`,
`.modal-intro` and `.option` classes as Settings → Date & time. It no longer has
its own fixed blue background, font sizes, button borders or full-height layout.
The divider, inset, heading weight, action padding, focus marker, close button
and theme gradient follow `app/style.css`, including its 4:3 layout rule.

The options-specific sheet remains in `app/item-options.css`. Its shade is
stationary during opening; only the panel transform animates. Preparation during
the existing hold, reused action nodes, and metadata loading after the slide
are retained. Underlying menu dimming is applied in the setup frame without
animating its opacity. Long information stays inside a scrollable body while
the header remains fixed. There is no blur, shadow, new shader or new WebGL pass.

The panel is transparent over the same themed backdrop as settings, not the
opaque blue drawer used by the preceding performance update. This restores the
requested appearance. Transparency/composition costs still require measurement
on the TV; a clean browser main-thread trace is not a TV frame-rate guarantee.

A late closing `transitionend` is ignored while a fresh opening has not reached
its `shown` state. Otherwise that old event can cancel the two-frame preparation
and leave the newly opened dialog parked outside the viewport.

Sort, Start, Information, uninstall checks and Cancel-first confirmation are
unchanged. No clock, sound, helper, app identity, palette, wave or particle code
is changed.

## Test

```sh
node --test tests/item-options.test.cjs tests/system-time.test.cjs tests/catalog.test.cjs tests/menu-sounds.test.cjs
node tests/item-options-style-browser.cjs
node tests/date-time-options-browser.cjs
node tests/item-options-browser.cjs
```

The style comparison uses real Chromium CSS and the actual options controller,
with synthetic app metadata. It compares computed styling with a normal settings
panel at 1280×720, 1920×1080 and 1024×768 in two themes. The existing controller
suites use media/native-service/background fixtures and do not contact a TV.
The style test writes opening traces and measurements under
`artifacts/item-options-style/`. Trace paint counts are reported as measurements,
not used as timing-sensitive pass/fail criteria.

Use `PLAYWRIGHT_EXECUTABLE_PATH` to select an installed Chromium browser, or
install the project's Playwright Chromium normally. Automated tests do not
validate Magic Remote delivery, native uninstall behavior or TV performance.
