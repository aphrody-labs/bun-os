# Aphrody v2 — embedded package

Runtime subset of the package validated on 2026-09-04 by the `hatch-pet` pipeline. The source
gate reports 74 validated frames, four validated cardinal directions, and a lossless VP8L WebP
atlas whose decoded pixels match the canonical PNG.

Admission source:
the `hatch-pet` pipeline output package (`aphrody-v2`).

| Fichier | SHA-256 |
|---|---|
| `pet.json` | `1a458332b408f168cfedf43bffe1c79418168d86a534663e96a8fdcfb28f6067` |
| `animations.json` | `511da87b80816cedcc83654806e7f363ba392c67e0d4d370728f0a1b6fd51741` |
| `sprites/spritesheet.png` | `bc48f3e2a4d3086234062b9175d58f2caaec39f6afeb53ab8b222513fe964037` |
| `sprites/spritesheet.webp` | `93238150de5b86b5977f8409800a91637dfcc3b70b3b0d6d617f6563fa54389b` |

The 74 individual PNGs and QA artifacts are not duplicated: `animations.json` keeps their
rectangles and hashes, and the integration test reconstructs the complete atlas from those
cells. Usage is covered by the commercial agreement documented at the repository root.

## Native dossier

`../dossier/aphrody.json` and `../dossier/aphrody.md` contain the native Aphrody data: game VFS
records exported by Rust, localized event lines, native asset paths, and the embedded package
described above. Each block identifies its local source.

The two files are embedded with `include_str!` (`BUNDLED_DOSSIER_JSON`, `BUNDLED_DOSSIER_MD`) and
read by `Dossier::bundled()` without a runtime file, database, or network dependency. Regenerate
the JSON with the native exporter:

```bash
# from the nie checkout: the exporter reads game files, so it stays in nie-aphrody-gisement
cargo run -p nie-aphrody-gisement --bin export_aphrody -- \
  --data "$NIE_GAME_DIR/data" \
  --out crates/ui/identity/assets/dossier/aphrody.json
```

After regeneration, `cargo test -p aphrody-identity` verifies that the dossier parses, its pet block
describes the embedded package, and the hashes in the table above are exact.

`sprites/idle.webp` is the idle track alone (atlas row 0, six 192×208 cells, 1152×208), cut from `sprites/spritesheet.png`
with `magick spritesheet.png -crop 1152x208+0+0 +repage -quality 92 -define webp:alpha-quality=100 -define webp:method=6 idle.webp`.
Pages that only show the idle pet load it (55 KB) instead of the full 1.5 MB atlas.
