# Rendering and menu performance

The target is the LG C5, not a desktop GPU. A desktop browser passing a timing
check does not establish TV performance. Keep shader precision, raster work,
layer lifetime and memory bandwidth explicit in reviews.

## Background pipeline

All WebGL background modes use one full-resolution 32-bit cache. The original
PS3 mode retains its 64x32 RGBA16F colour pass with RGBA8 fallback. The cache
uses RGB10_A2 with RGBA8 fallback. Theme, Monthly presets and RGB generate their
colour, halo and vignette in that same cache pass, not every animation frame.
The cache compares its inputs by value; changing source mode, palette, clock or
size invalidates it. A quality, brightness or particle change alone does not.
The original clock's coordinates are evaluated once per whole-second change
(or a changed fixed month/period), not sixty times per second.

Cache generation is high precision. The recurring composite is `mediump` for
colour, samplers, tone mapping and output. Addressing and the single fixed
spatial dither hash remain `highp`. Do not use the default `lowp` sampler for
cached colour, or promote the complete composite to high precision. Keep the
existing wave-only FXAA search and texture-coordinate precision intact.

The cache includes ambient decoration before quantization. Moving that
back into a post-canvas CSS gradient reintroduces banding. The final dither
remains screen-fixed, bounded to one 8-bit code either way; the single-hash
uniform distribution is not identical to the former two-hash triangular one.

Tone mapping originally preceded decoration. Wave-covered pixels use a tiny
read-only transmission/halo lookup to preserve that order. It is a 64x32 RG16F
texture (8 KiB), created once, not a render target. The composite reads it only
where it needs the ambient coefficients. Over-range RGB settings use an
explicit scaled cache representation, so values above white are not discarded
before the original highlight compression. These rare settings also need the
lookup on their background-only pixels.

The particle and glare fragments no longer evaluate the halo/vignette.
Their vertices read the same transmission lookup and interpolate one scalar;
fragments multiply RGB by it, leaving alpha/discard and the original optical
calculations intact. This is an approximation to spatial attenuation across
large sprites, not a change to spawning, motion or interaction. PS3-original
mode does not apply this decoration.

## Cost and verification

No added per-frame render pass, full-size floating-point target, blur, readback,
noise texture, resolution reduction or density reduction. This is **not** zero
cost: cached colour adds about 7.91 MiB at 1920x1080 in non-PS3 modes that did not
previously allocate a backdrop. PS3-original mode already had that cache. The
8 KiB lookup and its reads replace repeated spatial arithmetic. A lookup read
per particle corner, and one under decorated wave fragments, is intentional.
Driver allocations can exceed logical pixel-storage sizes.

Do not infer a C5 speedup from desktop instruction counts or llvmpipe timings.
Compare the same source, resolution, sampling, FXAA strength, particle count
and input sequence on the TV. Record frame-time percentiles and GPU load,
including repeated options opens and rapid category reversals. Keep the full
reference pack local; synthetic rendering tests are not firmware comparisons.

## Menu layers

No `will-change` in any app stylesheet or inline options code. Closed options
are `display:none`/hidden and cannot remain permanently promoted. The DOM and
main buttons are reusable; the existing setup frames establish the visible
panel before its transform transition. Closing removes it after transition end
or a bounded fallback; lifecycle/reduced-motion closes are immediate.

Text and its containers keep opacity 1. Modal dimming changes colour alpha
once, before the slide. The allowed opacity declarations in the guard are
non-text SVG containers and decorative markers, not text or text ancestors.
No animated colour/opacity is added. The shared settings styling remains intact.

The eight-category row/face prepainting policy and the 650 ms hold gesture
are unchanged. Neighbour-only painting is a possible separate memory trade-off,
but can create cold raster work during rapid traversal. Measure it independently
before replacing an optimization already verified on the TV. Launch-on-release
is the necessary short/long-press distinction, not a frame-rate regression.

## Checks

```sh
node --test tests/category-transition.test.cjs tests/performance-cache.test.cjs tests/gradient-banding.test.cjs tests/gradient-output.test.cjs tests/gradient-pipeline.test.cjs
node tests/performance-layers-browser.cjs
python3 tools/bundle-ps3-shaders.py --check
```

The stylesheet guard scans nested CSS under `app/`, not only `style.css`.
The allocation guard refuses full-size floating-point targets. Cache tests
exercise unchanged frames, mutable palettes, source transitions, resized or
recreated targets and refused formats. The browser layer test uses real DOM/CSS
and CDP, but synthetic services and no background-renderer timing claim.
