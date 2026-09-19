# WebGL 2 background

LG-XMB renders the waves and particles with WebGL 2 and GLSL ES 3.00. The
simulation reconstructs parts of the PS3 3.01 background. The final material,
projection and composition include adaptations; this isn't a pixel-identical
PS3 renderer.

Everything needed for the normal build is committed. Run `npm run preview` for
the desktop launcher or follow [Building and testing](BUILDING.md) to make an
IPK. There's no separate renderer installer or preview archive to apply.

## Settings

Open **Settings → Appearance**. The launcher defaults to 60 fps, 1.5× supersampling,
Original mesh detail, Subtle edge softness and Strong FXAA;
particles are on at Medium density.

| Control | Behaviour |
| --- | --- |
| Animation | Freeze or animate the background |
| Speed | Change simulation speed independently of the draw rate |
| Brightness | Low, Medium and High apply gains of 0.3, 0.6 and 1 |
| Frame rate | Target 30 or 60 draws per second |
| Supersampling | Render the wave surface at 1×, 1.25×, 1.5× or 2× output size |
| Mesh detail | Reduced uses 64 × 64 samples; Original uses 128 × 128 |
| Edge softness | Sharp, Subtle (the former Soft amount), or Soft (wider, stronger smoothing) |
| Particles | Enable or disable particle drawing and simulation |
| Particle density | Limit the population to 1,000, 2,000 or 4,000 |
| Post-process antialiasing | Off or coverage-guided FXAA |
| Smoothing strength | Select the post-process filter thresholds |

Stored `fine` mesh settings migrate to Original. Both previous FXAA modes use
the coverage-guided filter, now labelled FXAA. MSAA settings are discarded.
The brightness keys retain their older names for saved settings: `dim` is Low,
`low` is Medium and `normal` is High.

Supersampling affects the wave surface. The composite filter doesn't
filter menu text or particles. Particles and glare are drawn afterwards at output
resolution. Renderer diagnostics are available through `C5App.getState()`.

**Wave colours** selects the theme, monthly gradient presets, custom RGB or
**PS3 original**. The last option uses the recovered monthly background with the
TV clock. Both PS3 original and monthly presets have separate Month selection
(Automatic or Fixed month) and Time of day (Automatic, Day or Night) controls.
A fixed month can still follow the local day/night cycle. Monthly presets are
separate gradients, not the extracted PS3 textures.

Current theme has an optional Day/night effect, off by default. It dims the
selected theme at night without changing its colour. Seasonal also refreshes
its month colour when the month changes. Custom RGB stays fixed.

Clock-driven colours refresh once a second even with Animation off; wave and
particle motion remain frozen. Background updates stop when Home is hidden and
resume using the current local time. Fixed month plus fixed time needs no clock
timer. Existing fixed presets retain their settings.

The PS3 path retains the recovered calendar arithmetic, including February 29
using February 28's month coordinate. Day/night parameters match the supplied
RPCS3 background object. Preset interpolation and optional theme dimming are
launcher features rather than a claim of exact PS3 output in those modes.

**Show waves full screen** hides the menu without changing its selection.
Back or Home returns to the menu.

## Runtime files

| File | Role |
| --- | --- |
| `app/ps3-native-core.js` | Wave and particle simulation, emitters and interaction |
| `app/ps3-native-renderer.js` | WebGL resources, draw passes and the `C5Wave` interface |
| `app/ps3-particle-birth.js` | Recovered particle-birth and navigation-field equations |
| `app/ps3-native-data.js` | Committed seed state, spline tables and lookup textures |
| `app/ps3-background-clock.js` | Calendar and day/night calculations |
| `app/ps3-background-data.js` | Committed monthly background textures |
| `shaders/` | Editable shader sources |
| `app/ps3-native-shaders.js` | Generated shader bundle loaded by the app |

The CPU updates a 19 × 19 control grid. A vertex texture carries those controls
to the GPU, which evaluates the spline mesh. Particle state is packed into one
instance buffer shared by the body and glare passes. The emitter creates new
particles on the moving sheet; the pool has 4,096 slots, so High isn't capped
at the original captured population.

Navigation updates the interaction field using numerically animated menu
positions. It doesn't read DOM geometry every frame. Initial orientations for
extra slots and the scheduling of emitter calls are port choices. Recovered
birth equations don't establish that every original host behaviour is reproduced.

The background is cached until its inputs change. The PS3 monthly colour pass
uses a small optional floating-point target; full-size targets remain 32 bits
per pixel. See [Rendering and menu performance](PERFORMANCE.md) for formats,
precision and memory costs.

## Lifecycle and limits

Simulation advances in bounded steps separately from the selected draw rate.
Hidden time isn't replayed when the app returns. Pausing keeps a still frame,
and turning particles off also suspends their simulation.

CPU state survives WebGL context loss. GPU resources are rebuilt on restoration.
A missing WebGL 2 context or invalid reference data produces a static backdrop
and a diagnostic. There's no WebGL 1 renderer or runtime shader translation.

The wave-target allocation budget is 96 MiB. It isn't a limit on total browser
or GPU memory. Canvas buffers, cached backgrounds and driver allocations are
additional. Allocation failures can reduce sampling; inspect the reported result
rather than assuming a requested setting was applied.

## Editing shaders

Edit the files under `shaders/`, then run:

```sh
python3 tools/bundle-ps3-shaders.py
python3 tools/bundle-ps3-shaders.py --check
```

The generated JavaScript bundle avoids fetching shader files at runtime.
Don't edit the generated copy directly.

## Validation

`npm test` runs the Node tests. Focused renderer tests cover the numerical core,
particle emitter, gradient pipeline, wave coverage and stored settings.

The Python tools `tests/ps3-native-browser.py` and
`tests/ps3-native-launcher-browser.py` exercise WebGL rendering and launcher
integration. Their capture comparisons need private research fixtures and the
Python NumPy/Playwright packages. Use each script's `--help` for its paths and
browser options. Those fixtures aren't needed to build or run the app.

`tools/import-ps3-reference.py` regenerates native seed data from the original
research archives. It isn't a setup step for a checkout. Keep raw dumps and
capture fixtures out of Git.

A numerical fixture match doesn't prove the full image matches a physical PS3.
Browser tests also don't establish C5 frame pacing, HDMI return or standby
behaviour. Test those on the TV with the same settings being documented.

Code attribution and the separate status of extracted data are recorded in
[WEBGL2-NOTICES.md](WEBGL2-NOTICES.md).
