# Item-options presentation

The options panel shares the settings dialog's `.modal-backdrop`, `.modal`,
`.modal-top`, `.modal-intro` and `.option` styles. `app/item-options.css` adds
only the options-specific layout and transition rules.

The panel is transparent over the themed settings backdrop. Only its transform
animates during the 220 ms opening slide. The background shade stays still and
there is no blur. Long information scrolls inside the body while the header
stays fixed.

The controller prepares reusable action nodes during the hold timer. It allows
a presented frame for focus and preview cleanup before starting the slide, then
requests metadata after the slide completes. Reduced motion skips the animation.
Start and lifecycle exits close immediately.

Keep the transition-state checks when changing the styling. A closing
`transitionend` can arrive during a new opening; accepting it too early can
leave the panel offscreen.

## Tests

```sh
node tests/item-options-style-browser.cjs
node tests/date-time-options-browser.cjs
node tests/item-options-browser.cjs
```

The style test compares the panel with normal settings at 1280 × 720,
1920 × 1080 and 1024 × 768. It writes traces under `artifacts/item-options-style/`.
Browser paint counts aren't TV frame-rate measurements. Check transparency and
composition costs on the TV with the normal animated background running.
