# Native WebGL 2 background renderer

This implementation replaces LG-XMB's synthetic spline and analytic-seed particles
with the reconstructed PS3 3.01 numerical pipeline. Every active shader is native
GLSL ES 3.00. It is a working experimental replacement, not a pixel-identical PS3
renderer or a TV-tested release.

## Use

The separately distributed **private preview** archive includes the small local
reference pack. Open `preview.html` in a browser with WebGL 2, or serve this folder:

```sh
python -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/preview.html`. No network service is used by the
renderer itself. The preview has pause, particle, quality and diagnostics controls.

For LG-XMB, extract this package **beside**, not inside, a clean clone. The guarded
installer targets main commit `5d4163a7be213086e3d09f01c4fdee3a7490dda3`:

```sh
python tools/install-into-repo.py ../LG-XMB --with-local-data --with-fixtures
python tools/install-into-repo.py ../LG-XMB --with-local-data --with-fixtures --apply
```

The first command is read-only. The second creates the local branch
`feat/native-ps3-webgl2`, copies the implementation, changes the active script list
and wave-settings descriptions, and ignores private inputs. **It makes no commit,
push, release or TV connection.** It refuses a different base, a dirty clone, an
existing branch or an existing native pack. Do not reset other work to satisfy it;
rebase the small integration changes instead.

The installer does not alter app identity, app version, helper-startup code,
privileged helpers, input previews, remote-button code, or their pins. Existing
preference keys remain intact. The product Content Security Policy stays unchanged.
The old renderer was deleted in 0.1.31. Nothing from it is loaded by
`app/index.html` and no old shader is used in the new render path.

After installation, use the repository's existing preview and package commands.
An IPK generated from this local tree includes the ignored local pack; do not
publish that IPK as a source-only release. A build/install/upgrade/recovery test on
the target TV is still required before promotion.

## What is verified, and what is adapted

| Component | Basis / current status |
|---|---|
| 19 × 19 surface update | Reconstructed spring dynamics, damping, endpoint forcing and interpolation; captured interpolation and reference tests |
| Deformation field | Four reconstructed procedural functions; captured program, scale and offset, with the observed one-tick phase |
| Spline evaluation | Original basis/derivative samples, 128 × 128 row-major layout and unnormalized normals; compared on an actual WebGL 2 GPU pipeline against all 16,384 captured records |
| Particle update | Reconstructed forces, field sampling, random perturbation, age, quaternion update and retirement; one captured before/after update reproduced numerically |
| Particle packing | Original age envelope and half-float truncation; all 2,016 captured post-update quaternions pack identically |
| Particle shader calculations | GLSL ES 3.00 dataflow ports of the decoded body/glare vertex programs and previously validated fragment equations |
| Optical uniforms | Named retained QGL values recovered from this same RAM capture; not a GPU frame capture |
| Particle projection | Factored view/projection and camera inference; its complete live uniform binding is not independently captured |
| Wave material | Adapted linear Fresnel/density material with a documented exposure and edge envelope; not the original encoded-HDR material |
| Background / composition | LG-XMB theme colours, RGBA8 intermediate, adapted linear composition; not Sony's complete render-target chain |
| Birth / respawn | Explicit port policy: recycle retired particles using the captured seed distribution and restart their age |
| Navigation response | Numerical field/rotation inputs exist, but no invented mapping from the TV remote to the original PS3 interaction field |
| Clock-wrap transition | Explicit one-second smoothstep crossfade of deformation lattices, not a recovered PAF transition |
| Context selection | Starts from the captured program and settings. No claim that it recreates every original XMB/music/dialog profile |

The native shader syntax alone is not the accuracy claim. The useful evidence is
the captured numerical comparisons, together with the limits above. A matching
emulator frame is not proof of bit-exact physical PS3 behavior.

### Additional retained optical values

The body and glare program objects retained matching named parameters in the
supplied RAM dump. The extraction followed the Cg parameter-name pointer and
verified names before reading the corresponding QGL uniform storage. Notable
values differ from the root menu defaults:

- Middle particle size: `0.04647710174322128`.
- Near/far focus boundaries: `[6.12435007, 7.44365025, 12.20079994, 16.22814941]`.
- Focus curves: `[2.47205997, 1.83324003, 0.92502450943, 0]`.
- Darkness bounds: `[6.24028, 13.9, 0, 0]`.
- Glare: `[0.20136701, 5.44386005, 0.99, 4.44000006]`.

The private archive includes `private-data/particle-optics.json` and the compact
name/hash evidence in `evidence/retained-uniforms.json`. No whole RAM image is
included. These retained numbers improve the binding; they do not resolve the
remaining projection/compositing uncertainty.

## Runtime architecture

```text
CPU / retained typed arrays                         WebGL 2

19 × 19 spring-grid simulation
    -> 8 × 4 × 4 procedural field
    -> 11 × 7 × 7 padded lattice
    -> 361 deformed control points  -- 5,776 bytes --> RGBA32F vertex texture
                                                      -> texelFetch + spline
                                                      -> indexed 128 × 128 mesh
                                                      -> RGBA8 wave target
                                                      -> optional MSAA resolve
                                                      -> FXAA + theme composite
2,048 particle slots
    -> tested update / retire / pack -- <=65,536 B --> instanced body quads
                                                      -> instanced glare quads
```

The animation clock targets 60 simulation updates per second. Particle integration
uses the captured parameter block at that cadence; the original host's varying
particle interval still needs validation from a multi-frame sequence. Rendering is capped
at 30 draws per second. Rendering fewer frames does not select an arbitrary slower
simulation. Hidden/paused time is discarded; a delayed callback has at most 0.1
seconds of catch-up before the selected speed multiplier. Turning particles off
also suspends their simulation; re-enabling resumes their state without catching
up unseen time.

The 19 × 19 CPU deformation is small; the 128 × 128 spline is evaluated on the
GPU. There is no full CPU vertex-mesh rebuild/upload and no per-frame GPU readback.
The two particle passes share one compact instance buffer and one four-corner
quad. No transform-feedback simulation, float render-target extension, compute
shader, framework, WebAssembly module or Three.js runtime is required.

`RGBA32F` is **sampled** with `NEAREST`/`texelFetch` in the vertex stage. It is not an
attached colour render target. This avoids requiring `EXT_color_buffer_float`.
Static index buffers, VAOs, shader programs, textures and simulation scratch arrays
are retained. Vertex/instance data uploads are skipped on repeated frozen redraws.
GPU readbacks appear only in the regression test.

All GPU sources start with `#version 300 es` and use `in`/`out`, explicit fragment
outputs, `texture`/`texelFetch`, `gl_VertexID` and instancing. The implementation
never asks for a WebGL 1 context and does not rewrite GLSL 1.00 at runtime. Missing
WebGL 2 or a missing local pack yields a static backdrop and an explicit diagnostic
rather than the old inaccurate renderer.

## Quality controls and resource limits

- `standard` / `low`: 64 × 64 samples chosen from the original 128 × 128 grid.
- `high`: the original 128 × 128 sample grid. The legacy `fine` preference is an
  alias of `high`, explicitly identified in diagnostics.
- Supersampling: 1, 1.25, 1.5 or 2 times the selected output size, on the **wave**.
- MSAA: request 0/2/4; negotiate only supported RGBA8 counts not above the request.
  A failed target allocation falls back transactionally; diagnostics report the
  actual result rather than the requested count.
- The offscreen wave colour target plus optional MSAA colour buffer is limited to
  96 MiB. This is **not** a cap on the browser's total GPU memory; canvas buffers,
  static assets and driver overhead are additional. Replacement allocation may
  temporarily coexist with the previous target.
- FXAA and coverage-guided Wave FXAA use the existing three.js-derived edge-search
  method ported to GLSL ES 3.00. They run at output resolution. Optional softness
  is a separate small filter. Text and particles are not filtered by this pass.
- Particle body/glare rendering happens at output resolution after the wave
  composite. Both passes use additive `ONE, ONE` blending. That matches the
  recovered particle blend factors, but this pass ordering and RGBA8 composition
  are an adaptation of the original larger rendering pipeline.
- The reference pack has 2,048 slots, of which 2,025 start active. A 4,000 request
  does not invent more seed particles: the actual count is clamped and reported.

The default standalone preview uses 1× wave sampling, original mesh detail and
subtle Wave FXAA. LG-XMB's saved 1.5× / high / 0.75 / strong preferences remain
recognized. Sampling/MSAA costs must be measured on the target LG TV; previous
measurements of the old renderer are not measurements of this implementation.

## Retention and lifecycle

The existing public `C5Wave` API remains:

```js
const wave = new C5Wave(canvas, { quality: '1080p', onRenderStatus });
wave.setTheme(theme);
wave.setStyle({ speed: 1.5, brightness: 1 });
wave.setQuality({ sampling: 1.5, detail: 'high', particles: true });
wave.setReducedMotion(true);
wave.setPaused(true);
const diagnostics = wave.getDiagnostics();
wave.destroy();
```

Shaders compile after the initial menu paint; `KHR_parallel_shader_compile` is
used when available. CPU state survives WebGL context loss and is uploaded into
new GPU resources after restoration. Hidden/paused resizes are deferred so a
paused frame is not erased by changing canvas dimensions. Reduced-motion settings
retain a still frame. Destroy is idempotent and removes observers/listeners and
pending animation callbacks.

The canvas is requested without `preserveDrawingBuffer`. On the C5's Mali the
preserved buffer made every tile load the previous frame and the compositor copy
the canvas each frame, half of all fragment work. A paused launcher keeps showing
the last presented frame because nothing draws over it; what the webOS compositor
retains across a native app or HDMI handoff still needs a TV test.

## Reference data

`app/ps3-native-data.js` is committed, so a clone builds the real waves. It
isn't a newly licensed project asset though. It holds selected numerical seed
state, basis tables and two small lookup textures from the supplied resources,
and no firmware executable or whole RAM image. The raw captures and test
fixtures under `private-data/` stay out of Git. Python 3.10+ is required for
the importer and guarded installer.

To regenerate it from the earlier analysis packages:

```sh
python tools/import-ps3-reference.py \
  --live ../ps3-live-state-analysis.zip \
  --lines ../ps3-lines-reverse-engineering.zip \
  --optics private-data/particle-optics.json \
  --out app/ps3-native-data.js
```

On PowerShell, put the command on one line or use PowerShell's continuation
character instead of shell backslashes. `--optics` is optional, but omitting it
uses less complete root-menu optical defaults and reports provisional bindings.
Input hashes are checked for the numerical fixtures. Asset provenance and code
attributions are in `WEBGL2-NOTICES.md`.

Shader files are reviewable under `shaders/`. To keep the product's `connect-src
'none'` CSP, they are bundled into a local JavaScript module at development time:

```sh
python tools/bundle-ps3-shaders.py
python tools/bundle-ps3-shaders.py --check
```

There is no shader fetch at runtime. Do not edit the generated bundle directly.

## Validation

```sh
node --test tests/ps3-native-core.test.cjs
node tools/validate-native.cjs --long-run --out evidence/numerical-results.json
python tools/bundle-ps3-shaders.py --check
python -m pip install numpy playwright
python -m playwright install chromium
python tests/ps3-native-browser.py
python -B -m unittest discover -s tests -p test_native_installer.py
```

After installing in a clone, exercise the launcher's real appearance and wave
settings with:

```sh
python tests/ps3-native-launcher-browser.py --repo ../LG-XMB
```

The recorded launcher integration used byte-verified current-main `app.js`,
`index.html` and `wave-colors.js`, with auxiliary UI assets from the earlier
project artifact. The test records hashes of all assets it uses. It passed five
checks, but is not a claim that the entire latest project test suite ran.
`docs/INTEGRATION.patch` shows the two existing app-file changes for review; the
installer also copies new files and ignores local data.

The browser tool accepts `--browser /path/to/chromium` or
`PLAYWRIGHT_EXECUTABLE_PATH`, plus `--software` for an explicit SwiftShader run.
Some Linux software-renderer installations also require an X server/Xvfb.

The source-only Node run explicitly skips capture-dependent cases when local data
is missing. Skips are not accuracy passes. The browser capture tests require the
private pack and `private-data/fixtures`; `PS3_FIXTURES` selects another fixture
folder for Node, and `--fixtures` does so for the browser tool.

The recorded browser run uses modern Chromium and ANGLE SwiftShader. It validates
real WebGL 2 compilation, rendering and lifecycle behavior, not Chromium 87's
exact implementation or LG TV performance. Its in-memory test harness starts no
TV/preview service and does not modify the product CSP.

The GPU geometry test enables transform feedback **only in the test**, captures
all positions/normals, and compares them with the supplied runtime mesh. These
readbacks are deliberately absent from the production renderer. The lifecycle
suite checks frozen redraws, FXAA, MSAA negotiation, resize, pause, context loss,
visibility, theme changes, destruction and missing-capability fallbacks.

Before merging: run the project's full tests on the actual integrated tree, then
check the target TV at its normal resolution and preferences. Record steady-state
frame pacing, native app/HDMI handoff, memory pressure, context recovery and return
to Home. Do not infer those results from SwiftShader timing or desktop Node timing.

## Remaining fidelity work

Finish the original host emitter/respawn and navigation-field generation, verify
particle projection with a correlated draw capture, recover the wave's original
material coordinates and encoded-HDR composition, and validate original context
and program transitions over multiple frames. The current private fixtures are a
stable baseline for that work, not a reason to retune the recovered geometry by eye.
