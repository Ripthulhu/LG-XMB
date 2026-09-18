# Renderer notices

## Project implementation

The WebGL 2 controller, numerical core, shaders and build tools were developed
for LG-XMB in 2026. Newly authored files marked `GPL-3.0-or-later` permit GPL
version 3 or later. The combined project is distributed under GPL version 3.

The reconstruction uses PS3 3.01 resources, disassembly and captured runtime
state. It doesn't include a VSH executable, a whole RAM dump or an emulator.
The material and composition contain adaptations; see `docs/WEBGL2.md` for the
implementation's limits.

## Extracted data

`app/ps3-native-data.js` contains selected numerical seed state, spline tables
and lookup textures from the supplied resources. `app/ps3-background-data.js`
contains 24 monthly background textures, each 64 × 32 RGBA8, from
`textures/month_bg` in `lines.qrc`.

Both files are committed and included in normal builds. They aren't newly
licensed project assets. The project's GPL licence doesn't grant rights to
Sony's extracted data. Their presence in Git isn't a statement of permission
to redistribute them under GPL.

`shaders/monthlyBackground.frag` reconstructs `back_colours0.fpo`.
`app/ps3-background-clock.js` reconstructs calendar and day/night arithmetic from
`custom_render_plugin.sprx` 3.01. Bicubic upsampling stands in for the original
`bg_copy.fpo` lookup, which hasn't been recovered.

## Particle births

`app/ps3-particle-birth.js` comes from the PS3 3.01 particle-motion
reconstruction. It covers candidate generation, velocity-dependent births,
slot reuse, icon wind, field decay and directional-input response.

Copyright (c) 2026 Contributors to the PS3 particle-motion reconstruction.
MIT licence, reproduced in `app/licenses/PARTICLE-BIRTH-MIT.txt`.
That licence covers the reconstructed code, not Sony's firmware.

LG-XMB supplies the mesh sampling, emitter scheduling and menu-position
integration in `app/ps3-native-core.js`.

## FXAA

The edge-search code in `shaders/compositeFragment.frag`, bundled into
`app/ps3-native-shaders.js`, derives from three.js `FXAAShader.js` at revision
`caddbf4cd84b62d7edf6b9fc937ca709afdfe915`.

Copyright 2010-2025 three.js authors. MIT licence, reproduced in
`app/licenses/THREE-FXAA-MIT.txt`. The upstream shader credits NVIDIA's FXAA
algorithm, Jasper Flick's implementation and Dave Hoskins' GLSL port.
LG-XMB adapts the shader to GLSL ES 3.00. No Three.js runtime is included.

Source: https://github.com/mrdoob/three.js/blob/caddbf4cd84b62d7edf6b9fc937ca709afdfe915/examples/jsm/shaders/FXAAShader.js

## Technical references

RPCS3 instruction definitions and reciprocal-estimate behaviour were consulted
at revision `e13ee157918ed0402bd2befa1920202d63b3e8dc`. The numerical core retains
a 32-entry reciprocal-estimate table. No RPCS3 runtime, compiler or emulator
library is embedded in the app.

Reference files are `SPUInterpreter.cpp`, `SPUThread.cpp`,
`RSXVertexProgram.h`, `VertexProgramDecompiler.cpp` and `RSXFragmentProgram.h`
under RPCS3's `rpcs3/Emu/` tree.

Source: https://github.com/RPCS3/rpcs3/tree/e13ee157918ed0402bd2befa1920202d63b3e8dc/rpcs3/Emu

Other current attributions, including the colour presets, are in
`THIRD-PARTY-NOTICES.md`. Raw research captures aren't build dependencies.
