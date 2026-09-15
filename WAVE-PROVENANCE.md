# Wave renderer

## PS3-style surface

`app/ps3-wave.js` adapts `ps3xmbwave/spline-reverse.js`, `spline.js` and
`spline-settings.js` from [linkev/PlayStation-3-XMB](https://github.com/linkev/PlayStation-3-XMB)
at revision `1ec453a9dddec5448d615116ff428349f42d454e`.
Copyright (c) 2025 Mart; MIT permission is in `app/licenses/PS3-XMB-MIT.txt`.

The port retains the synthetic descriptor/table/kernel flow, cubic B-spline
basis, travelling displacement, free-form deformation and Fresnel-style surface
lighting. These are the reference project's reconstruction, not Sony code or a
complete reproduction of its runtime data. No firmware, extracted textures,
logos, debug panels or external resources are bundled. PS3 month/day/night presets are not included.

Changes for LG-XMB:

- Evaluate displacement and smooth normals into reusable meshes: 128-by-48
  (Standard), 256-by-96 (High, app default), or 384-by-128 (Fine).
  All presets fit 16-bit indices. Mesh changes retain the current spline kernel.
  The WebGL 1 path needs neither float textures nor shader-derivative extensions.
  Fixed buffers replace the reference's per-frame temporary arrays.
- Apply temporal smoothing using elapsed animation time. Repainting a still,
  changing brightness or resizing cannot advance the spline simulation.
- Move the surface below the selected item, tint it with the existing theme,
  and soften its edges through a bounded RGBA8 surface and a nine-tap composite.
  The output remains at most 1920 by 1080. The internal surface can use 1×,
  1.25×, 1.5× (app default), or 2× supersampling, capped at 3840 by 2160
  and the reported texture/viewport limits. A 2× RGBA8 texture is about 31.6 MiB;
  during replacement both the old and candidate textures may coexist (at most
  about 63.3 MiB, excluding the canvas and other GPU resources).
  Allocation failure steps down through smaller sample factors once per request.
  The selected preference stays intact and diagnostics report the effective size.
  Linear filtering and the composite filter operate on premultiplied RGBA together.
  Edge softness is expressed in output pixels: 0 (Sharp), 0.75 (Subtle, default),
  or 1.5 (Soft); supersampling retains a half-pixel resolve even at Sharp.
- Share the existing 30 fps clock, speed/brightness controls, deferred shader
  compilation, hidden/paused suspension and reduced-motion still frame.
  GPU resources are released on destruction and rebuilt after context loss.

The PS3 renderer is the default when its module is present. Allocation,
compilation or framebuffer failures fall back once to the original WebGL
renderer; failure there falls back to Canvas2D. `getDiagnostics()` reports the
selected `pattern`, requested/applied sample factor, fallback reason and surface size.
Quality choices are local appearance preferences, not privileged TV operations. Scheduling gaps are not
GPU timing measurements, and desktop rendering does not establish TV performance.

## Original renderer and Canvas fallback

Derived from OpenXMB's [`shaders/original.frag`](https://github.com/phenom64/OpenXMB/blob/84f153f441c5f860a07acd5b37bd90c4aaae82de/shaders/original.frag)
at revision `84f153f441c5f860a07acd5b37bd90c4aaae82de`.
Original SHA-256: `700eb219cb1a5050824934cffe74899a6f4f960f0d4548799663e371760aa578`.
Copyright 2025–2026 Syndromatic Ltd.; designed by Kavish Krishnakumar in Manchester.
The original GPL-3.0-or-later permission and source remain under `app/licenses/`.

Its five ribbon equations, noise, crossing modulation and glow are retained in
`app/wave.js`. Canvas2D approximates these curves at 540p/20 fps. The application
requests 1080p on both TV and desktop, with adaptive downscaling disabled.
Smaller previews and actual GPU limits can still reduce the backing size;
renderer and Canvas fallbacks remain available. The reusable renderer still
supports lower quality caps and opt-in adaptive scaling for other callers.
These are app-local resolutions, not TV display-mode changes.

## API

Create `new C5Wave(canvas, options)`.

- `setTheme({background, wave})`: background and wave colors.
- `setStyle({speed, brightness})`: speed `0.5`, `1.5`, `2.25`; brightness `0.6`, `1`, `1.5`.
- `setQuality({sampling, detail, softness})`: validated presets above; resource changes
  are deferred while hidden/paused and applied on the next draw.
- `setReducedMotion(boolean)`: freeze/unfreeze the current animation time.
- `setPaused(boolean)`: suspend/resume scheduled work.
- `getDiagnostics()`: renderer, pattern, resources and scheduling information.
- `destroy()`: release resources and event listeners.

Options include `quality: '1080p' | '720p' | '540p'`, `adaptive: false`,
`pattern: 'classic'` for renderer comparisons, and `renderer: 'canvas2d'`.
No network requests, device commands or persistent writes originate in a renderer.

## Output-space post-process (0.1.19)

`app/wave-post.js` adapts the directional edge-search and subpixel blending in
[three.js FXAAShader.js](https://github.com/mrdoob/three.js/blob/caddbf4cd84b62d7edf6b9fc937ca709afdfe915/examples/jsm/shaders/FXAAShader.js).
NVIDIA developed FXAA; that implementation credits Jasper Flick and Dave
Hoskins. The three.js MIT notice is packaged in `licenses/THREE-FXAA-MIT.txt`.
The Three.js runtime is not used. This is an adapted FXAA quality algorithm,
not the unmodified NVIDIA FXAA 3.11 reference shader.

The port uses GLSL ES 1.00, fixed search bounds, `texture2D`, selectable contrast
and subpixel thresholds, and the actual output pixel spacing. The complete
background is resolved into display RGB at output resolution before filtering;
its alpha channel carries wave coverage for the experimental Wave FXAA mode.
The shared background function prevents theme drift between direct and filtered
paths. The output alpha is one. Filtering the already composited RGB avoids
unpremultiplication and dark transparent borders. No additional gamma conversion
is applied, and browser-composited text/icons are not sampled.

Reference: [NVIDIA FXAA sample documentation](https://docs.nvidia.com/gameworks/content/gameworkslibrary/graphicssamples/d3d_samples/fxaa311sample.htm).
The original nine-tap resolve/softness pass, mesh, temporal spline and sampling
factors are unchanged in this increment, to isolate the post-process comparison.
This spatial filter cannot correct a genuinely irregular mesh contour and uses
no previous-frame history. The final texture has one sample per output pixel;
the selected supersampling factor affects the preceding wave surface only.

## Particles (0.1.22)

`app/ps3-particles.js` adapts `ps3xmbwave/particles.js` and
`particles-settings.js` from the same Mart/linkev revision and MIT licence above.
It retains the drifting point-sprite trajectories, twinkling opacity and soft
radial sparkle profile. This is that project's approximation, not recovered Sony
particle code or assets. The normal preset uses its 2,000 particles, 0.75 opacity,
2.6/1.5 size parameters and 0.18 flow factor. Low/High select 500/4,000 points.

The WebGL 1 port replaces VAOs with ordinary attributes, seeds one deterministic
48,000-byte static buffer, clamps point sizes to GPU limits, and shifts the band
to match LG-XMB's spline. Size is relative to 1080p output, not supersampling.
Particles add light after the wave post-process, without modifying canvas alpha
or filtering the menu. Wave speed/brightness and the existing animation clock
also control particles. Off/reduced motion freezes them, hidden Home draws
nothing, and context restoration rebuilds identical seeds. An optional particle
shader/buffer failure leaves the waves usable and is not retried every frame.
The classic and Canvas2D fallbacks intentionally omit particles.

## Band placement (0.1.23)

The spline and particle band move up by 0.20 clip-space units (10% of output
height: 108 pixels at 1080p), towards the PS3 menu reference. The classic shader
and Canvas2D fallback move by the same fraction. Geometry, sampling, lighting,
FXAA, timing and particle trajectories are unchanged.

## Band placement (0.1.24)

Move the spline and particles up another 0.20 clip-space units: 10% of the output
height relative to 0.1.23, 20% relative to 0.1.22. Both now add 0.03 to their Y
coordinate. Classic WebGL and Canvas2D use a 0.03 lookup offset instead of 0.23.
Sampling, geometry, colours and filtering are unchanged.

## Monthly gradients and particle depth (0.1.25)

`app/wave-colors.js` adapts the exact 24 endpoint colours and angles from
`ps3xmbwave/background-gradients-day.js` and `background-gradients-night.js` at
reference commit `1ec453a9dddec5448d615116ff428349f42d454e`. It preserves the
reference's top-down UV projection, corner normalization and smoothstep blend
from `spline.js`. Original mode preserves RGB defaults 37/89/179, top/bottom
multipliers 0.09/0.62 and the top blue-channel factor 1.2. The source project's
MIT notice is retained. No extracted DDS assets are included.

Current theme is the upgrade default. Explicit Day/Night selection is manual;
there is no time-based switching. Preset/RGB modes replace only the renderer's
background and softly tint its waves/particles. The settings panel stays dark
for readability. Both backdrop and FXAA's composited background use the same
uniforms. Classic WebGL also uses them; Canvas2D approximates the same smoothstep
with 17 stops. Changing a colour does not recreate geometry or framebuffers,
advance a frozen clock, or override stored quality settings.

The particle extension is our approximation of the requested left-to-right fan
and depth-of-field, not recovered PS3 particle code. It retains the upstream seed
layout and twinkle, but adds depth-scaled drift/size, horizontal density shaping,
a widening vertical envelope, and analytically soft, dimmer out-of-focus discs.
No blur textures, sound effects, audio analysis or second animation loop are
added. The inherited extra 10% upward shift and synchronized 180 ms menu timeline
from 0.1.24 remain unchanged.


## Cropped surface and optional MSAA (0.1.27)

The 0.1.26 source-only crop has been corrected to preserve the full virtual
sample grid (including fractional supersampling). A shifted, full-sized virtual
viewport renders into the cropped texture; output UVs map back to the original
screen coordinates. The band has a 20-output-pixel guard and grows in buckets,
never shrinking/reallocating as animation oscillates. Its location may change;
that does not change the sample grid. Particles regain the full output viewport.
The optional FXAA pass once again sees display RGB plus wave coverage, as in
0.1.25, not a wave-only RGB edge signal. Postprocessing remains cropped.

MSAA is Off by default. WebGL 2 is tried first, with WebGL 1 and Canvas fallbacks.
The existing GLSL ES 1.00 shaders are supported by both WebGL versions.
`wave-msaa.js` queries RGBA8's supported renderbuffer sample counts, accepts
Off/2/4, and never silently rounds upwards. A color-only multisample renderbuffer
is resolved with a same-size NEAREST blit into an RGBA8 texture. Supersampling
and FXAA are independent later stages; combining them adds cost. The menu reports
requested versus applied sampling when support/allocation/resolve fails.
Refusal disables only MSAA, reuses the single-sample path, and is not retried
per frame. Off releases storage. Context restoration builds new resources.
No native service, recording, theme, mesh or animation-timing change is involved.

For visual/performance comparison start with supersampling Off and MSAA 4x.
This is not a guarantee of lower GPU time or identical SSAA appearance on a TV.
The sample-count query is format-specific; MAX_SAMPLES alone is not sufficient.

Reference: Khronos WebGL 2 specification, framebuffer/renderbuffer objects and
GLSL ES 3.00 support (which also documents GLSL ES 1.00 compatibility):
https://registry.khronos.org/webgl/specs/latest/2.0/
