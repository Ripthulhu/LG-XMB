# Navigation and animation performance

The optimization keeps the spline geometry, normals, shaders, particle count,
render resolution, supersampling and antialiasing settings unchanged. It targets
CPU work shared with navigation, not GPU fill rate. The WebGL target remains
30 frames per second; the Canvas2D compatibility fallback remains 20.

## Changes

`ps3-wave.js` computes only the descriptor-table rows sampled by the current
kernel. Its 32 cursors need at most 64 of the 361 table rows. A per-update bitmap
prevents duplicate evaluation; the original arithmetic and smoothing order stay
intact. Column-only calculations run once per column and row-only calculations
once per row. Reused Float64 scratch retains JavaScript Number precision before
the existing Float32 vertex writes. No approximation or mesh decimation is used.

`app.js` leaves the horizontal category bar alone during vertical navigation.
Row accessibility/visibility state changes only when needed. Detached rows keep
their cached state and existing labels; matching detail icons reuse their SVG.
Selection and activation remain synchronous. CSS and transition timings are not
changed, and navigation does not stop the background animation.

`wave.js` retains a separate next-frame deadline. A late callback no longer
resets the target cadence to its arrival time. Missed deadlines are skipped with
at most one draw per callback; there is no catch-up loop. The animation clock
still uses elapsed time and the existing long-gap clamp. Cancellation resets
both the elapsed-time reference and the deadline.

## Regression checks

Run `npm test`. The frozen, attributed pre-optimization spline evaluator in
`tests/fixtures/ps3-spline-reference.cjs` comes from commit
`898024a9337268a503f31c73ad6e8739154cce67`. Tests compare vertex/normal, index,
height and kernel bytes and bounds at every mesh preset, including repeated
stills, running motion, long time gaps and rewinds. Another test checks that
transcendental-call counts decrease without reducing vertex count.

Frame-pacing tests cover jitter, late callbacks, long stalls, suspension and
both frame-rate targets. The category browser regression also verifies that
up/down navigation does not mutate the horizontal bar and that adjacent HDMI
items reuse their detail SVG without losing the selected item identity.

Use `npm run test:menu` for the focused browser checks, or the full checks in
CONTRIBUTING.md. Browser tests do not establish TV performance.

For a dependency-free CPU comparison:

```sh
node tools/benchmark-spline.cjs
```

The benchmark alternates old/new evaluation order, discards 40 warm-up frames,
and measures 180 updates per evaluator and mesh preset. It reports median and
95th-percentile CPU times, not animation FPS. Run it without other heavy work.
The fixture is a regression oracle, not production code.

## TV verification

Compare baseline and candidate at identical resolution, mesh, sampling, AA and
particle settings. Hold and alternate all four directions; cross categories,
reverse mid-transition and open/close settings. Verify upper-row labels, cached
input previews and immediate Enter activation. Check pause/resume, Home return
and reduced motion. Use remote Web Inspector to compare frame gaps and main
thread work. Repeat with 4000 particles and the highest settings the user runs;
do not lower settings to make the comparison pass. GPU-bound stutter may remain.

## Documentation

- LG web engine versions (webOS 22 uses Chromium 87):
  https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine
- Browser layout and interaction work:
  https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
- CSS animation costs and limited use of compositor promotion:
  https://web.dev/articles/animations-guide
- Animation callbacks and timestamp-based progress:
  https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame

AI-assisted change; numerical and automated checks are not a substitute for
maintainer review and an on-device test.
