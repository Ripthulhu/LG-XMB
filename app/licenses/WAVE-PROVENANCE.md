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

- Evaluate displacement and smooth normals into a reusable 128-by-48-cell mesh.
  The WebGL 1 path needs neither float textures nor shader-derivative extensions.
  Fixed buffers replace the reference's per-frame temporary arrays.
- Apply temporal smoothing using elapsed animation time. Repainting a still,
  changing brightness or resizing cannot advance the spline simulation.
- Move the surface below the selected item, tint it with the existing theme,
  and soften its edges through a bounded RGBA8 surface and a nine-tap composite.
  The off-screen surface matches the drawing buffer up to 1920 by 1080
  (about 7.9 MiB for RGBA8), without a separate 720p cap.
- Share the existing 30 fps clock, speed/brightness controls, deferred shader
  compilation, hidden/paused suspension and reduced-motion still frame.
  GPU resources are released on destruction and rebuilt after context loss.

The PS3 renderer is the default when its module is present. Allocation,
compilation or framebuffer failures fall back once to the original WebGL
renderer; failure there falls back to Canvas2D. `getDiagnostics()` reports the
selected `pattern`, fallback reason and surface size. Scheduling gaps are not
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
- `setReducedMotion(boolean)`: freeze/unfreeze the current animation time.
- `setPaused(boolean)`: suspend/resume scheduled work.
- `getDiagnostics()`: renderer, pattern, resources and scheduling information.
- `destroy()`: release resources and event listeners.

Options include `quality: '1080p' | '720p' | '540p'`, `adaptive: false`,
`pattern: 'classic'` for renderer comparisons, and `renderer: 'canvas2d'`.
No network requests, device commands or persistent writes originate in a renderer.
