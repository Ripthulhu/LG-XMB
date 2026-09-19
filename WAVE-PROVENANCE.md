# Background source map

The active background is the WebGL 2 renderer loaded by `app/index.html`.
Its simulation and resource handling are in `app/ps3-native-core.js` and
`app/ps3-native-renderer.js`. Editable shaders live under `shaders/` and are
bundled by `tools/bundle-ps3-shaders.py`.

The renderer reconstructs parts of the PS3 3.01 background from disassembly
and runtime state. Particle births and navigation fields use the recovered
module in `app/ps3-particle-birth.js`. The final material and composition include
LG-XMB adaptations rather than a complete reproduction of the console pipeline.

The wave's edge taper follows the recovered 128×128 coordinate stream: linear
10% ramps on both axes, evaluated at the sampled vertices and interpolated into
the light calculation. The coordinate bytes match the saved RSX capture and
guest-memory dump. The original vertex program passes input 8.y into TEX1.w;
the fragment program applies it before the light-response lookup. LG-XMB keeps
its adapted exponential response and 0.30 per-sheet ceiling. Guard vertices
inherit the zero taper at the sheet endpoints. Both 64×64 and 128×128 paths are
checked by `tests/wave-edge-browser.cjs` using GPU transform feedback.

## Data and attribution

| Component | Source |
| --- | --- |
| Seed state, spline tables and lookup textures | Extracted resources in `app/ps3-native-data.js` |
| Monthly PS3 textures | Extracted `month_bg` data in `app/ps3-background-data.js` |
| Calendar and monthly colour pass | Reconstructed PS3 3.01 calculations |
| Seasonal theme palette | OpenXMB configuration |
| Monthly gradient presets | Mart's MIT-licensed colour tables in `app/wave-colors.js` |
| FXAA edge search | MIT-licensed three.js shader |
| Particle-birth module | MIT-licensed PS3 particle-motion reconstruction |

The extracted data files are committed so a checkout builds the animated
background. They aren't relicensed by the project. Raw dumps and comparison
fixtures remain outside the build.

`THIRD-PARTY-NOTICES.md` records the upstream revisions and copyright notices.
`docs/WEBGL2-NOTICES.md` covers renderer provenance and the extracted data.
`docs/WEBGL2.md` describes the current controls, architecture and validation.

Retired renderer implementations can be found in Git history. They aren't
runtime dependencies or extra installation steps.
