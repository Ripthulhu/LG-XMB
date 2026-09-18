# Third-party notices

LG-XMB's project code is distributed under GPL version 3; see `LICENSE`.
Individual files marked `GPL-3.0-or-later` retain that permission. The notices
below cover the third-party code and data still used by this checkout.

## OpenXMB

Source: https://github.com/phenom64/OpenXMB
Revision: `84f153f441c5f860a07acd5b37bd90c4aaae82de`.

LG-XMB's interface originated from OpenXMB, and the Seasonal palette in
`app/app.js` uses its `config.json` monthly colours. The current WebGL 2 wave
renderer isn't OpenXMB's wave shader.

The upstream configuration credits Kavish Krishnakumar / Syndromatic Limited
Bharat Britannia and declares GPLv3. Its copyright notice is:

> ™ & © 2025-2026. Syndromatic Ltd. All rights reserved.

The original project also identifies its design as Kavish Krishnakumar's work
in Manchester. No OpenXMB native runtime is included.

## Monthly gradient presets

Source: https://github.com/linkev/PlayStation-3-XMB
Revision: `1ec453a9dddec5448d615116ff428349f42d454e`.

`app/wave-colors.js` adapts the monthly Day/Night gradient tables and their
interpolation from this project. Copyright (c) 2025 Mart. MIT licence,
reproduced in `app/licenses/PS3-XMB-MIT.txt`.

This credit covers the presets still in use. It doesn't describe the current
wave or particle renderer.

## FXAA

The edge search in `shaders/compositeFragment.frag` derives from three.js
`examples/jsm/shaders/FXAAShader.js`, revision
`caddbf4cd84b62d7edf6b9fc937ca709afdfe915`.

Copyright 2010-2025 three.js authors. MIT licence, reproduced in
`app/licenses/THREE-FXAA-MIT.txt`. Upstream credits NVIDIA's FXAA algorithm,
Jasper Flick's implementation and Dave Hoskins' GLSL port. No Three.js runtime
is included.

## Particle-birth reconstruction

`app/ps3-particle-birth.js` is supplied under the MIT licence.
Copyright (c) 2026 Contributors to the PS3 particle-motion reconstruction.
The full notice is in `app/licenses/PARTICLE-BIRTH-MIT.txt`.

## PS3 reference data

The committed `app/ps3-native-data.js` and `app/ps3-background-data.js` contain
selected state, tables and textures extracted from PS3 resources. They aren't
relicensed as new GPL project assets. No complete firmware executable or RAM
dump is included. See `docs/WEBGL2-NOTICES.md` for their origin and the
reconstructed renderer's technical references.

## Platform and development tools

LG's webOSTV.js 1.2.13 was consulted when writing the platform bridge. That
library and LG's native runtimes aren't bundled.

`@webos-tools/cli` builds and inspects IPKs. Playwright runs browser tests.
These development dependencies aren't installed in the TV app and keep their
own licence files in `node_modules/`.

## User audio and product names

No music or menu-sound recording is distributed. Users supply those separately;
the software licence doesn't grant rights to a recording.

LG, PlayStation and other product names identify their owners. LG-XMB isn't
affiliated with or endorsed by LG or Sony.
