# Third-party notices

## OpenXMB

Source: https://github.com/phenom64/OpenXMB

Upstream revision: `84f153f441c5f860a07acd5b37bd90c4aaae82de`.

This web app adapts OpenXMB's interface concept and monthly colors from `config.json`. It also adapted `shaders/original.frag` up to 0.1.30; that renderer has since been removed, and `WAVE-PROVENANCE.md` records why the notice and source stay here. The original configuration credits Kavish Krishnakumar / Syndromatic Limited Bharat Britannia, with "™ & © 2025-2026. Syndromatic Ltd. All rights reserved." and a GPLv3 license.

The shader's original notice is retained:

> This file is a part of the OpenXMB desktop experience project.
> Copyright (C) 2025-2026 Syndromatic Ltd. All rights reserved
> Designed by Kavish Krishnakumar in Manchester.

`original.frag` is licensed under GNU GPL version 3 or, at your option, any later version. Its WebGL adaptation retains that permission. Changes made September 13, 2026 adapt Vulkan GLSL to WebGL with JavaScript-managed uniforms, bounded rendering, composition changes and motion controls. HTML, CSS and JavaScript replace the native desktop implementation.

The combined port is distributed under GNU GPL version 3; see `LICENSE`. Individual files expressly permitting later versions retain that permission. Source and build tools accompany the distribution; the IPK contains unminified runnable web source.

OpenXMB acknowledges XMBShell by JCM as an ancestor and RetroArch and dreamrender as contributors to its native codebase. This port does not include those native runtimes, RetroArch media/emulation code, or the separate RetroArch-derived `wave.vert` / `wave.frag`. The adapted shader is specifically `original.frag`; its original source and configuration are retained under `app/licenses/`.

## webOS platform reference

LG Electronics' official webOSTV.js 1.2.13 was consulted for the independent platform bridge:
https://webostv.developer.lge.com/develop/references/webostvjs-introduction

That library, LG native runtimes and firmware are not bundled. Product names identify their respective owners and do not imply sponsorship or endorsement.

## Development tools

`@webos-tools/cli` 3.2.6 builds and inspects IPKs. Playwright runs browser checks. These development dependencies are not bundled in the TV app and retain their own licenses in their installed packages.

## PlayStation 3 XMB wave reconstruction

Source: https://github.com/linkev/PlayStation-3-XMB

Revision: `1ec453a9dddec5448d615116ff428349f42d454e`.
Copyright (c) 2025 Mart. MIT License; the full permission and disclaimer are
included in `app/licenses/PS3-XMB-MIT.txt`.

Up to 0.1.30 `app/ps3-wave.js` adapted the synthetic spline displacement,
parameter values, mesh rendering and Fresnel-style shading from
`ps3xmbwave/spline-reverse.js`, `spline.js` and `spline-settings.js`. That
renderer was removed in 0.1.31. `app/wave-colors.js` still carries the monthly
gradient tables from the same project, so the MIT notice stays in this file and
the package. The combined app remains GPL version 3. The reference credits
Alphardex's CodePen as its starting point. See `WAVE-PROVENANCE.md` for the
removed renderer and `docs/WEBGL2-NOTICES.md` for the current one.

## FXAA edge-search shader

The FXAA edge search in `shaders/compositeFragment.frag` (bundled into
`app/ps3-native-shaders.js`) came in through the removed `app/wave-post.js`,
which adapted three.js `examples/jsm/shaders/FXAAShader.js` at
`caddbf4cd84b62d7edf6b9fc937ca709afdfe915` (MIT; Copyright 2010-2025 three.js
authors). Upstream credits NVIDIA's FXAA algorithm, Jasper Flick's implementation
and Dave Hoskins' GLSL port. The full MIT notice is in
`app/licenses/THREE-FXAA-MIT.txt`. No Three.js runtime dependency is included.
See `docs/WEBGL2-NOTICES.md` for the GLSL ES 3.00 changes.

## User-provided background music

No music recording is distributed. Users supply their own file separately; the
software licence does not grant rights to any recording.

The PS3-style particle layer also adapts Mart/linkev's `particles.js` and
`particles-settings.js` at the revision documented in WAVE-PROVENANCE.md; its
MIT notice is included as `app/licenses/PS3-XMB-MIT.txt`.

The monthly Day/Night colour tables and gradient interpolation in
`app/wave-colors.js` also adapt Mart/linkev's MIT-licensed reference at the
revision listed in WAVE-PROVENANCE.md. No DDS images or music recordings are
included. The depth-of-field particle extension is an LG-XMB adaptation.
