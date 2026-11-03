# SPDX-License-Identifier: Apache-2.0
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.60.1", "brotli==1.1.0"]
# ///
"""Subset the @aphrody/m3-fonts sources into WOFF2 web fonts.

Run through `bun run subset` (which calls `uv run scripts/subset.py`). Reads the plan as JSON on
stdin, writes the WOFF2 files and prints the resulting faces (file + unicode-range) as JSON.

Plan entries:
  {"id", "source", "out", "ranges": [[lo, hi], ...], "pin"?: {axis: value}} -> one Latin face,
      with the `pin` axes instanced at fixed values first
  {"id", "source", "out", "ranges", "japanese": true, "chunk": N}         -> JP chunks: codepoints
      present in the font, restricted to kana/punctuation/full-width forms plus the ideographs of
      Windows-31J (JIS X 0208 levels 1-2 + NEC/IBM extensions), split into chunks of N codepoints.
  {"id", "source", "out", "symbols": true, "names": [...]}               -> Material Symbols subset:
      the icons `names` (resolved through their GSUB ligature), their Private Use Area codepoints
      and the characters spelling them. Layout closure is off, so only the ligatures of the kept
      icons survive; every variation axis (FILL, wght, GRAD, opsz) is kept.
"""

import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


def options(hinting: bool) -> subset.Options:
    o = subset.Options()
    o.flavor = "woff2"
    o.hinting = hinting
    o.name_IDs = ["*"]  # keep copyright and OFL license strings
    o.name_languages = ["*"]
    o.notdef_outline = True
    o.layout_features = ["*"]  # variable-font feature variations, kerning, tabular figures, ccmp
    o.drop_tables += ["DSIG"]
    o.recalc_timestamp = False  # deterministic output
    return o


def cmap_of(path: Path) -> set[int]:
    font = TTFont(path, lazy=True)
    return set(font.getBestCmap().keys())


def in_ranges(cp: int, ranges: list[list[int]]) -> bool:
    return any(lo <= cp <= hi for lo, hi in ranges)


def is_windows31j_ideograph(cp: int) -> bool:
    ch = chr(cp)
    if not (0x3400 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFAFF):
        return False
    try:
        ch.encode("cp932")
        return True
    except UnicodeEncodeError:
        return False


def to_unicode_range(cps: list[int]) -> str:
    out: list[str] = []
    cps = sorted(cps)
    start = prev = cps[0]
    for cp in cps[1:] + [None]:  # type: ignore[list-item]
        if cp is not None and cp == prev + 1:
            prev = cp
            continue
        out.append(f"U+{start:04X}" if start == prev else f"U+{start:04X}-{prev:04X}")
        if cp is not None:
            start = prev = cp
    return ", ".join(out)


def write(source: Path, out: Path, cps: list[int], hinting: bool, pin: dict[str, float] | None = None) -> int:
    opts = options(hinting)
    font = subset.load_font(str(source), opts)
    s = subset.Subsetter(opts)
    s.populate(unicodes=cps)
    s.subset(font)
    if pin:
        # Pinned axes are instanced at fixed values after subsetting; the remaining axes stay variable.
        font = instantiateVariableFont(font, pin, updateFontNames=False)
    out.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(out), opts)
    return out.stat().st_size


def ligatures_of(font: TTFont, names: list[str]) -> dict[str, str]:
    """Ligature glyph of each of `names` in the font's GSUB ligature substitutions."""
    cmap = font.getBestCmap()
    table: dict[tuple[str, ...], str] = {}
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            lig_table = getattr(sub, "ExtSubTable", sub)
            for first, entries in (getattr(lig_table, "ligatures", None) or {}).items():
                for lig in entries:
                    table.setdefault((first, *lig.Component), lig.LigGlyph)
    out: dict[str, str] = {}
    for name in names:
        key = tuple(cmap.get(ord(ch), "") for ch in name)
        if key in table:
            out[name] = table[key]
    return out


def write_symbols(source: Path, out: Path, names: list[str]) -> list[int]:
    font = TTFont(source)
    ligatures = ligatures_of(font, names)
    missing = [n for n in names if n not in ligatures]
    if missing:
        sys.exit(f"{source.name}: Material Symbols names without a ligature: {', '.join(missing)}")
    reverse: dict[str, int] = {}
    for cp, glyph in font.getBestCmap().items():
        if cp >= 0xE000:
            reverse.setdefault(glyph, cp)
    cps = sorted({ord(ch) for n in names for ch in n} | {reverse[ligatures[n]] for n in names if ligatures[n] in reverse})
    opts = options(hinting=False)
    opts.layout_closure = False
    s = subset.Subsetter(opts)
    s.populate(unicodes=cps, glyphs=[ligatures[n] for n in names])
    s.subset(font)
    out.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(out), opts)
    kept = ligatures_of(TTFont(out), names)
    lost = [n for n in names if n not in kept]
    if lost:
        sys.exit(f"{out.name}: ligatures lost by the subset: {', '.join(lost)}")
    return cps


def main() -> None:
    root = Path(sys.argv[1])
    plan = json.load(sys.stdin)
    result = []
    for entry in plan:
        source = root / entry["source"]
        if entry.get("symbols"):
            out = root / entry["out"]
            cps = write_symbols(source, out, entry["names"])
            result.append({"id": entry["id"], "file": entry["out"], "unicodeRange": to_unicode_range(cps), "bytes": out.stat().st_size})
            continue
        cmap = cmap_of(source)
        ranges = entry["ranges"]
        if not entry.get("japanese"):
            cps = sorted(cp for cp in cmap if in_ranges(cp, ranges))
            out = root / entry["out"].format(n="")
            size = write(source, out, cps, hinting=True, pin=entry.get("pin"))
            result.append({"id": entry["id"], "file": entry["out"].format(n=""), "unicodeRange": to_unicode_range(cps), "bytes": size})
            continue
        base = sorted(cp for cp in cmap if in_ranges(cp, ranges))
        ideographs = sorted(cp for cp in cmap if is_windows31j_ideograph(cp))
        chunks = [base] + [ideographs[i : i + entry["chunk"]] for i in range(0, len(ideographs), entry["chunk"])]
        for n, cps in enumerate(chunks):
            rel = entry["out"].format(n=f"-{n:02d}")
            size = write(source, root / rel, cps, hinting=False)
            result.append({"id": entry["id"], "file": rel, "unicodeRange": to_unicode_range(cps), "bytes": size})
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
