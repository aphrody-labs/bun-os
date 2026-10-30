# `aphrody-nie-wiki` IEVR surface

This crate owns read-only IEVR queries over the SQLite mirror. The Rust API now
covers the mirror-backed Azalée wiki surfaces for:

- `auras`: generic auras, Keshins, Souls, Miximax, awakenings and mode changes;
- `tactics`: `inagle_tactics` plus the optional `inagle_special_tactics` table;
- `passives`: `inagle_passives`, generation rules and the global scaling table.

The API exposes values present in the read-only `inagle_*` mirror and its raw
JSON columns. It never invents rows or asserts that an asset is reachable.
Texture, model, audio and video paths are returned only when they are present in
the game VFS indexes or in the corresponding `inagle_*` row. No Supabase client,
network database, CDN manifest or external join is used by this crate.

Older mirrors without `inagle_special_tactics`, `inagle_awakenings`, or the
passive rule tables remain readable; the corresponding result is empty rather
than a fabricated row. The mirror itself must have been produced from the game
VFS, `nie.exe`-read formats, or the verified `inagle`/`zukan` corpus.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `NIE_CDN_BASE` | `https://cdn.rosegriffon.fr` | Origin of the asset CDN used for menu images, emblems, faces and texture URIs (`aphrody-nie-wiki`, `aphrody-nie-formats`). No trailing slash. |
| `NIE_WIKI_BASE` | `https://azalee.rosegriffon.fr` | Origin of the NIE wiki whose `chara/<id>` links `aphrody-nie-data` accepts as avatar references. |
