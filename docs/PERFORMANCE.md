# Rendering and menu performance

Measure performance on the TV with the settings the user actually runs.
Desktop timing doesn't establish C5 frame pacing.

## Background cache

The renderer caches background colour at output resolution. It requests
`RGB10_A2` and falls back to `RGBA8`. A palette, source, clock or size change
invalidates the cache; wave brightness, particle density and quality changes
don't invalidate it by themselves.

PS3-original colour first uses a 64 × 32 `RGBA16F` pass where supported, with
an `RGBA8` fallback. Theme, monthly presets and custom RGB generate their
colour, halo and vignette directly into the background cache.

Cache generation uses high precision. The recurring composite uses `mediump`
colour calculations while keeping coordinates and the screen-fixed dither
hash `highp`. Keep sampler precision explicit. Moving decoration back into a
CSS overlay or quantising it too early can reintroduce banding.

A 64 × 32 `RG16F` lookup holds transmission and halo coefficients. Particle
vertices sample it and interpolate attenuation across each sprite. This is an
approximation for large sprites. PS3-original colour doesn't use that decoration.

The full-size cache uses four bytes per pixel, about 7.91 MiB at 1920 × 1080.
That's pixel storage, not total GPU allocation. The lookup adds 8 KiB. Wave
supersampling uses a separate target; see [the renderer](WEBGL2.md).

## Menu work

Vertical navigation leaves the category bar alone. Rows and category faces are
reused, and the detail text follows navigation after 140 ms so it doesn't paint
in the same frame as every key press. Preview lifecycle changes remain immediate.

Options prepare their reusable nodes during the OK hold, open without animation,
and defer metadata until after opening. Closed panels are hidden rather than permanently promoted.
Keep text opacity at 1; dim text through colour alpha without animating that
colour. Don't add `will-change` across the interface as a blanket fix.

Held arrows use a 60 ms minimum interval for vertical main-list navigation and
100 ms in settings panels or horizontal navigation, with one pending event. Dropping every
event that arrives too soon turns an 80 ms remote cadence into 160 ms navigation;
the pending event instead runs at the next deadline. There is no backlog or
repeat without incoming input. Release, reversal, blur, suspension and menu
changes cancel pending movement. Separate taps remain immediate.

Main-list rows and icons settle over 240 ms rather than the category bar's
400 ms. This reduces visual lag during repeated Up/Down presses; it does not
change the renderer's frame rate or the particle simulation.

Settings and options focus with `preventScroll`, then reveal the nearest edge.
Default browser focus can recenter a partly hidden row and jump several rows.
Up/Down stop at list boundaries; Tab retains its focus loop. Moving beyond the
last choice row does not switch focus to that row's selected value.

On the C5, a short 80 ms repeat-input comparison traversed 40 Appearance rows
versus 24 before the coalescer, with roughly 52–54 animation callbacks per second
in both runs. Some intervals remained 33 ms, so this is an input/scrolling fix,
not a claim of locked 60 fps while navigating.

[Navigation details](performance/navigation.md) describe the row and category
state. Keep that work separate from changing mesh detail or reducing particles.

## Compare a change

Use the same build inputs, colour source, resolution, sampling, antialiasing
and particle limit for both runs. Compare idle animation, rapid reversals,
repeated options opens and app/HDMI return. Record frame-time percentiles and
GPU load, not just average frames per second.

Use the committed renderer data for normal tests. Private capture fixtures are
for numerical comparisons; they aren't required to build the app. Don't claim
an optimisation from software-renderer timing alone.

## Checks

```sh
node --test tests/category-transition.test.cjs tests/performance-cache.test.cjs tests/gradient-banding.test.cjs tests/gradient-output.test.cjs tests/gradient-pipeline.test.cjs
node tests/performance-layers-browser.cjs
node tests/menu-focus-browser.cjs
node tests/menu-repeat-browser.cjs
python3 tools/bundle-ps3-shaders.py --check
```

The tests cover cache invalidation, allocation fallbacks, nested stylesheet
rules and panel layers. The browser layer check uses synthetic services and
doesn't measure the TV's renderer workload.
