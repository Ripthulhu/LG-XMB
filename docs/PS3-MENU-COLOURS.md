# PS3 menu colours

The option menu does not reuse the background texture colours. Inspection of
the supplied PS3 3.01 firmware found a separate monthly palette and hourly blend
in `custom_render_plugin`.

The relevant link-time addresses are:

- `0xa51d0`: twelve RGB colours, January through December.
- `0xa5050`: twenty-four entries of `(0.30, 0.30, 0.32, blend)`.
- `0x8d47c..0x8d674`: linear interpolation between this month and next month,
  using `(day - 1) / daysInMonth`. February 29 uses February 28's fraction.
- `0x8d67c..0x8d7ec`: interpolation between hourly entries, then blending the
  seasonal colour toward the neutral grey.
- `0x8d7f4..0x8d8a0`: an additional colour override, clamping, and delivery to
  `system_plugin` interface 1, slot 3.

The hourly grey weights are:

| Hour | Weight |
| --- | --- |
| 00:00 | 1 |
| 01:00–05:00 | 0.9, 0.7, 0.5, 0.3, 0.1 |
| 06:00–17:00 | 0 |
| 18:00–22:00 | 0.1, 0.3, 0.5, 0.7, 0.9 |
| 23:00 | 1 |

VSH reads the colour through interface slot 2 in `0x308c58`, updating the menu
planes when it changes. In `basic_plugins`, the getter is `0x4a3c8`, the setter
is `0x4a3a0`, and their colour storage is `0x5a4e4`.

`system_plugin.rco` supplies white textures with varying alpha:
`tex_optionmenu_bg`, `tex_optionmenu_line`, and a separate black base. The panel
is brightest near its left edge and fades right. The background texture is
536 × 216 pixels; its vertical opacity also decreases slightly toward the edges.

Our colour calculation uses the recovered tables. Our CSS recreates the texture's
falloff with gradient stops and a vertical mask, scaled to our menu width. It is
not a pixel-exact copy of the PS3 texture. Firmware images are not bundled.
Manual colour choices use a fixed monthly tint, consistent with our appearance
settings. The firmware's additional colour-override transitions are not emulated.

Checks cover the silver night colour in all twelve months, daytime colours,
month and hour interpolation, manual choices, February 29, and menu focus while
the existing clock timer updates the gradient.
