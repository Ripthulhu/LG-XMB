#!/usr/bin/env python3
"""Prepare local Rodin fonts for browser use. Never modifies the source files."""
import argparse
from pathlib import Path
import struct


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="PS3 dev_flash/data/font directory")
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parents[1] / "app" / "user-fonts")
    args = parser.parse_args()
    try:
        from fontTools.ttLib import TTFont, newTable
    except ImportError:
        parser.error("Install the optional fonttools package: python -m pip install fonttools")

    names = ["SCE-PS3-RD-{}-LATIN2.TTF".format(weight) for weight in ("L", "R", "B")]
    for name in names:
        source = args.source / name
        if not source.is_file():
            parser.error("Missing font: {}".format(source))
        if source.resolve() == (args.output / name).resolve():
            parser.error("Output must be separate from the original font directory")

    args.output.mkdir(parents=True, exist_ok=True)
    for name in names:
        with TTFont(args.source / name, recalcTimestamp=False) as font:
            # The firmware's post v2 glyph-name count disagrees with maxp.
            # Browsers reject it. Version 3 omits names; cmap and outlines stay
            # intact. Preserve the fixed 32-byte header's metrics and flags.
            header = font.reader["post"][:32]
            post = newTable("post")
            post.decompile(struct.pack(">I", 0x00030000) + header[4:], font)
            font["post"] = post
            font.save(args.output / name)
        print("Prepared {}".format(name))


if __name__ == "__main__":
    main()
