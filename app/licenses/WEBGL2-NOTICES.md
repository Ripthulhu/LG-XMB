# Native renderer provenance and notices

## Project code

The native controller, numerical ports, shaders, bundler and tests were developed
for lg-xmb in 2026 with AI assistance. Newly authored code is supplied under
GPL-3.0-or-later, matching the project. A maintainer still needs to review the
implementation before merging or releasing it.

The numerical reconstruction was based on the user's supplied PS3 3.01 resources,
PowerPC/SPU disassembly and the runtime capture timestamped
`2026-09-17T00:10:27.504Z`. It follows the earlier `ps3-live-state-analysis` and
`ps3-renderer-reverse-engineering` reports. It does not bundle or execute Sony
firmware, emulate VSH, or distribute a complete RAM dump.

The particle vertex shaders are direct, readable dataflow reconstructions of the
decoded worker rendering programs. Their temporary-register names reflect that
origin. Their projection binding and complete visual output remain subject to the
limitations recorded in WEBGL2.md; successful compilation is not visual proof.

RPCS3's publicly maintained instruction definitions and reciprocal-estimate
implementation were used as technical references at commit
`e13ee157918ed0402bd2befa1920202d63b3e8dc`. The 32-entry reciprocal estimate table in
the numerical core records the instruction's estimate values. No RPCS3 runtime,
JIT compiler or emulator library is embedded in this web application.

Technical reference paths:

- RPCS3/rpcs3, `rpcs3/Emu/Cell/SPUInterpreter.cpp` and `SPUThread.cpp`.
- RPCS3/rpcs3, `rpcs3/Emu/RSX/Program/RSXVertexProgram.h` and `VertexProgramDecompiler.cpp`.
- RPCS3/rpcs3, `rpcs3/Emu/RSX/Program/RSXFragmentProgram.h`.
- Khronos WebGL 2 specification and OpenGL ES Shading Language 3.00.

## FXAA

The composite shader's FXAA edge search is adapted from LG-XMB's earlier
`wave-post.js` (removed in 0.1.31), itself derived from three.js `FXAAShader.js`,
revision
`caddbf4cd84b62d7edf6b9fc937ca709afdfe915`.

Copyright 2010-2025 three.js authors. MIT license, reproduced in
`app/licenses/THREE-FXAA-MIT.txt`. The GLSL ES 3.00 syntax and local integration were
adapted here. This does not introduce a Three.js runtime dependency.

## Existing LG-XMB work

The optional `app/wave-colors.js` in the private standalone preview is an unchanged
copy matching current-main blob `1ae14dd29269d61acded937ca6a446aeda3e14d1`; it is not installed over
the target repository's current copy. Preserve the repository's existing
THIRD-PARTY-NOTICES, WAVE-PROVENANCE and upstream licenses. Removing an old script
from the active page does not justify deleting unrelated historical attribution.

## Private reference inputs

The seed pack contains selected data and textures extracted from the user's
resources. These original inputs are **not** relicensed as new project source.
They are excluded from the source-only archive and ignored by the installer.
The private preview is for this user's local research and comparison; it is not a
public asset release. Keep whole RAM dumps and account/session data out of Git.

## Monthly background (ps3-gradient-backgrounds pack)

`shaders/monthlyBackground.frag` is the constant-folded port of `back_colours0.fpo`
and `app/ps3-background-clock.js` the recovered calendar and day/night arithmetic
from `custom_render_plugin.sprx` 3.01, both from the ps3-gradient-backgrounds
research pack, checked there against the decoded instructions to float32.
`app/ps3-background-data.js` holds the 24 `textures/month_bg` top levels (64x32
RGBA8) out of `lines.qrc`. It is local data, gitignored, and not relicensed as
project source. The bicubic upsample in `compositeFragment.frag` is a stand-in
for `bg_copy.fpo`, whose lookup table is not recovered.
