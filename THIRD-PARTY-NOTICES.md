# Third-party notices

## OpenXMB

Source: https://github.com/phenom64/OpenXMB

Upstream revision: `84f153f441c5f860a07acd5b37bd90c4aaae82de`.

This web app adapts OpenXMB's interface concept, monthly colors from `config.json`, and `shaders/original.frag`. The original configuration credits Kavish Krishnakumar / Syndromatic Limited Bharat Britannia, with "™ & © 2025-2026. Syndromatic Ltd. All rights reserved." and a GPLv3 license.

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
