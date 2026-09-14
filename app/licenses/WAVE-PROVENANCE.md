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
logos, debug panels or external resources are bundled. Particles and PS3
month/day/night presets are not included in this first wave pass.

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
