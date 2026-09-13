# Wave renderer

Derived from OpenXMB's [`shaders/original.frag`](https://github.com/phenom64/OpenXMB/blob/84f153f441c5f860a07acd5b37bd90c4aaae82de/shaders/original.frag) at revision `84f153f441c5f860a07acd5b37bd90c4aaae82de`.

Original SHA-256: `700eb219cb1a5050824934cffe74899a6f4f960f0d4548799663e371760aa578`.

Copyright 2025–2026 Syndromatic Ltd.; designed by Kavish Krishnakumar in Manchester. Original GPL-3.0-or-later permission and notices are retained in `app/licenses/UPSTREAM-original.frag`.

## Adaptation

Vulkan push constants become WebGL 1 uniforms. The renderer retains the five ribbon equations, noise, crossing modulation, masks and layered glow, with TV-menu composition, colors and brightness. Dust and the separate full-screen noise pass are omitted.

Initialization is deferred until after the menu can paint. The WebGL context requests no depth, stencil or antialiasing, and preserves its drawing buffer to retain the last frame when the app returns. The C5 uses a 720p wave surface at 30 fps beneath a 1080p interface; desktop preview starts at 1080p. Sustained scheduling pressure can reduce the wave surface to 720p, then 540p. Canvas2D provides an approximate 540p/20 fps fallback.

Hidden or paused rendering stops. Unchanged dimensions do not clear the canvas. Resize work is deferred while hidden, and reduced motion renders a still frame. These are app-local rendering choices, not TV display-mode changes.

## API

Create `new C5Wave(canvas, options)`.

- `setTheme({background, wave})`: background and wave colors.
- `setStyle({speed, brightness})`: bounded speed values `0.5`, `1.5`, `2.25`; brightness `0.6`, `1`, `1.5`.
- `setReducedMotion(boolean)`: toggle a still frame.
- `setPaused(boolean)`: suspend or resume scheduled work.
- `getDiagnostics()`: renderer capabilities, dimensions, timing, quality and settings.
- `destroy()`: release resources and event listeners.

Options include `quality: '1080p' | '720p' | '540p'`, `adaptive: false`, and `renderer: 'canvas2d'`. The renderer makes no network requests or persistent writes.
