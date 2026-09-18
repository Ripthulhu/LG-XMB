# Background source map

The active background is the WebGL 2 renderer loaded by `app/index.html`.
Its simulation and resource handling are in `app/ps3-native-core.js` and
`app/ps3-native-renderer.js`. Editable shaders live under `shaders/` and are
bundled by `tools/bundle-ps3-shaders.py`.

The renderer reconstructs parts of the PS3 3.01 background from disassembly
and runtime state. Particle births and navigation fields use the recovered
module in `app/ps3-particle-birth.js`. The final material and composition include
LG-XMB adaptations rather than a complete reproduction of the console pipeline.

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
