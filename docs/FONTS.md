# Fonts

Home uses the system font unless you supply converted PS3 Rodin fonts. Copy
these three files into `/media/internal/lg-xmb/Fonts/` (capital F):

- `SCE-PS3-RD-L-LATIN2.TTF` - light
- `SCE-PS3-RD-R-LATIN2.TTF` - regular
- `SCE-PS3-RD-B-LATIN2.TTF` - bold

Use the browser-compatible copies, not the raw firmware files. No conversion
runs on the TV. Keep the folder readable (`0755`) and files readable (`0644`).
Open Home after copying them. If Home was already running, close and reopen it.
On a rooted TV, helper setup creates `media-fonts` links in the installed app
and matching Home replacement. Fonts stay in internal storage across updates;
setup does not copy, change or delete them. Missing or unreadable fonts use the system font. The old app-local
`user-fonts` directory is no longer read. No fonts are included in normal IPKs.

## Preparing your own copies

They are in `dev_flash/data/font/` in an extracted PS3 firmware installation.
The [PS3 font reference](https://www.psdevwiki.com/ps3/XMB_Fonts) identifies
Rodin Regular as the Original font. LATIN2 adds Greek and Cyrillic coverage.
Other characters fall back to the system fonts.

The raw fonts have an inconsistent glyph-name table that Chromium rejects.
The importer removes that optional name table, preserving glyph outlines,
character mappings and spacing. It writes browser-compatible copies to
`app/user-fonts/` and leaves the originals untouched. FontTools is only needed
for this import, not for normal builds. Copy its output files into the TV folder above:

```sh
python -m pip install fonttools
python tools/import-ps3-fonts.py "/path/to/dev_flash/data/font"
```

Use `python3` where appropriate. Copy the prepared files from `app/user-fonts/`
to `/media/internal/lg-xmb/Fonts/`. The importer output is only a staging folder;
Home never loads fonts from that old app-local path.

Font files are not included in Git or normal builds. The firmware fonts are not
part of this project's licence.

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
