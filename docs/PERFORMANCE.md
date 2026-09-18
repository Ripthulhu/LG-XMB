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
supersampling and MSAA use separate targets; see [the renderer](WEBGL2.md).

## Menu work

Vertical navigation leaves the category bar alone. Rows and category faces are
reused, and the detail text follows navigation after 140 ms so it doesn't paint
in the same frame as every key press. Preview lifecycle changes remain immediate.

Options prepare their reusable nodes before sliding in and defer metadata until
after the slide. Closed panels are hidden rather than permanently promoted.
Keep text opacity at 1; dim text through colour alpha without animating that
colour. Don't add `will-change` across the interface as a blanket fix.

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
python3 tools/bundle-ps3-shaders.py --check
```

The tests cover cache invalidation, allocation fallbacks, nested stylesheet
rules and panel layers. The browser layer check uses synthetic services and
doesn't measure the TV's renderer workload.
