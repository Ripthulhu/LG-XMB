# Fonts

Home uses the TV's system font by default. To use the PS3's Original Latin font,
the importer needs these three files from your local firmware:

- `SCE-PS3-RD-L-LATIN2.TTF` — light
- `SCE-PS3-RD-R-LATIN2.TTF` — regular
- `SCE-PS3-RD-B-LATIN2.TTF` — bold

They are in `dev_flash/data/font/` in an extracted PS3 firmware installation.
The [PS3 font reference](https://www.psdevwiki.com/ps3/XMB_Fonts) identifies
Rodin Regular as the Original font. LATIN2 adds Greek and Cyrillic coverage.
Other characters fall back to the system fonts.

The raw fonts have an inconsistent glyph-name table that Chromium rejects.
The importer removes that optional name table, preserving glyph outlines,
character mappings and spacing. It writes browser-compatible copies to
`app/user-fonts/` and leaves the originals untouched. FontTools is only needed
for this import, not for normal builds:

```sh
python -m pip install fonttools
python tools/import-ps3-fonts.py "/path/to/dev_flash/data/font"
```

Use `python3` where appropriate. `npm run preview` uses the prepared files as
soon as they are present. For a personal IPK:

```sh
npm run package -- --personal-fonts
```

The font files are not included in Git or normal builds. Keep personal builds
separate from releases; the firmware fonts are not part of this project's
licence. A normal `npm run package` still excludes them, even when they are
present locally.

`app/fonts.css` owns the font faces and fallback order. Buttons and both clock
styles inherit the same family. The files load once, with no per-frame work;
missing files leave the existing system font in place. Diagnostic text keeps
its monospace font.

The font faces also set their line metrics explicitly. Rodin's capitals and
numbers are 780 units tall in a 1000-unit em; its original browser metrics
leave them visibly high in centred controls. The shared ascent/descent split
centres them without offsets on individual labels or changes to glyph shapes.

Run `node tests/fonts-browser.cjs` to check rendering at 1080p and 720p and
fallback with missing fonts. Without local files it only checks the fallback.
