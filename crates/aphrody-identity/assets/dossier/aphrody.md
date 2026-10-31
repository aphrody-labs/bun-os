# Aphrody native dossier

This document is generated from the local Inazuma Eleven: Victory Road game data owned by the
repository. The native Rust exporter reads the decoded VFS files under `data/` and emits the
machine-readable dossier beside this document.

## Authority

The only gameplay authorities used by this dossier are:

- the character parameter files in `data/common/gamedata/character/`;
- the skill and aura configuration files in `data/common/gamedata/skill/`;
- the localized event files in `data/common/text/{ja,fr,en}/event/`;
- the embedded pet package in `crates/engine/nie-aphrody/assets/aphrody/`.

The `inagle_*` names are SQLite mirror schema names only. Rust owns the parser, projection,
lookup, export, and serving layers. No web application, Supabase project, remote API, CDN, wiki,
or external enrichment is read to produce this file.

## Native export

Run the Rust binary from the repository root:

```text
cargo run -p nie-aphrody --bin export_aphrody --features serde,std -- \
  --data "$NIE_GAME_DIR/data" --out crates/engine/nie-aphrody/assets/dossier/aphrody.json
```

When `--data` is omitted, the exporter uses `NIE_GAME_DIR/data` and then `data/`. The input is
never written. The output is written atomically by the caller when it is published.

## Identity

The dossier identifies Byron Love Aphrody (`Aphrody`, `亜風炉 照美 アフロディ`) and covers the
three native character codes exposed by the game data:

| Code | Game series | Face directory |
| --- | --- | --- |
| `c01001900` | Inazuma Eleven | `01_IE1` |
| `c05026590` | Inazuma Eleven GO | `05_GO2` |
| `c07080010` | Inazuma Eleven Ares | `07_ARES` |

The identity, element, positions, team, stats, learned techniques, learned auras, unresolved
skill hashes, and model paths are serialized from the native Rust data structures. A value is
absent when the VFS does not provide it; the exporter does not fill gaps with web content.

## Techniques and auras

Character skill slots are hashes in the native `chara_param` records. Rust resolves them against
the native `skill_config` and `aura_skill_config` records, preserving the original skill data,
learn levels, cut-in paths, aura commands, and unresolved hashes. This is a data join, not a
second catalog.

## Dialogues

The exporter scans the eleven known Aphrody story events in the Japanese event files and aligns
the French and English strings by their native text identifiers. The output keeps the event ID,
line ID, and localized strings. It does not infer a speaker from an unrelated subtitle table.

## Assets

Every character asset is represented by its VFS path. The site and desktop application resolve
and decode those paths through the Rust VFS/model owners. The dossier does not embed a duplicate
asset index or fetch a replacement from a CDN.

The separate pet package is embedded by `nie-aphrody` and is described from its native
`pet.json` and `animations.json` manifests. The runtime atlas remains the package source and is
validated by the Rust integration tests.

## Consumers

The following consumers use the same Rust-owned result:

- `export_aphrody` writes the dossier;
- `nie-site` serves the embedded JSON;
- `nie-cli wiki` exposes the mirror-backed wiki operations;
- `nie-ffi` exposes the typed JSON boundary to Bun;
- the pet and pixel pipeline is this crate's API (the Tauri facade of the retired `aphrody-app` is gone); IEVR queries stay in nie web;
- MCP tools call the native package rather than querying SQLite from TypeScript;
- the Blender bridge invokes the Rust CLI for local VFS searches.

No consumer is allowed to add a second IEVR query implementation. Changes to the data shape must
be made in the Rust owner and checked at every binding.

## Verification

The package tests validate the embedded JSON, the pet manifests, atlas hashes, and Markdown
identity. The export path is checked with the same Cargo workspace and lint policy as the rest of
the Rust engine.
