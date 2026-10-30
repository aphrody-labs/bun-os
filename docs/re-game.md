# Game-agnostic asset pipeline (`bunre game`, `re game`)

The NIE stack reverse-engineered one title, Inazuma Eleven: Victory Road (IEVR, Level-5, Steam
2799860). This pipeline reuses what in it is not specific to that title and runs it on any
installed game: detect the engine, mount the containers, index the content, export it to open
formats, serve it over the NIE HTTP API and view the models. IEVR is its first profile.

Scope: offline asset and format work for interoperability, modding and viewing. See
[Limits](#limits).

## Commands

Native (`crates/re`, feature `assets`):

```
bunre game detect   <appid|path>                  engine, containers, anti-cheat (report only), profile
bunre game profiles
bunre game mount    <appid|path>                  mount report + statistics
bunre game ls       <appid|path> [--prefix p] [--limit n] [--sniff-unknown n]   NDJSON
bunre game cat      <appid|path> <path> [--output new-file]
bunre game formats  <appid|path> <path>
bunre game convert  <appid|path> <path> --format raw|png|wav|glb|json|mp4|webm [--output new-file]
bunre game export   <appid|path> --out new-dir [--kinds texture,model,audio,table,video]
                    [--per-kind n] [--filter s] [--max-mb n] [--raw] [--converted-only]
bunre game worker   <appid|path>                  framed stdin/stdout protocol used by `re game serve`
options: --profile id  --only glob  --no-loose  --max-files n  --aes-key hex64  --hca-key n
```

Bun (`packages/re`, `re game <appid|path> <command>`): `detect`, `mount`, `index` (`bun:sqlite`
with FTS5, Magika labels for unrecognised files), `export`, `serve` (HTTP API below) and `view`
(native GLB renderer, CPU or wgpu). An app id resolves through the Steam owner
(`@aphrody/bun-steam` `installedGames()` in Bun, `bun-steam` `list_installed_games` in Rust).

Build: `bun scripts/cargo.ts exec -- build --release -p bun-re --bin bunre --features assets`.

### HTTP API (`re game serve`)

Same contract as `aphrody-nie-model-serve` for its title-independent routes:

| Route                                                                             | Content                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `/health`                                                                         | `ok`                                                                            |
| `/vfs/ls?path=&limit=&offset=`                                                    | `{dir, dirs[{name,count}], files[{name,path,size,...}], fileTotal, fileOffset}` |
| `/vfs/find?q=&ext=&limit=&offset=`                                                | `{query, count, total, offset, files}` (FTS5)                                   |
| `/vfs/stat?path=`                                                                 | entry + `readable` + export `formats`                                           |
| `/vfs/stats`                                                                      | counts per kind and container                                                   |
| `/raw/<path>`                                                                     | original bytes, `Authorization: Bearer $RE_GAME_RAW_TOKEN` only, else 404       |
| `/export/<path>?format=`                                                          | conversion; `raw` follows the `/raw` rule                                       |
| `/tex/<path>.png`, `/audio/<path>.wav`, `/model/<path>.glb`, `/table/<path>.json` | conversion aliases                                                              |

IEVR-only routes (`/model-*`, `/avatar/*`, `/menu-*`, `/ui/*`, `/icons/*`, `/story-scene`,
`/cfg/`, `/typed/`, `/lip/`, `/video/*`) stay in `aphrody-nie-model-serve`.

## Layers

`crates/re/src/game/assets/`:

| Module            | Role                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `source`          | positioned reads (no archive is loaded whole), bounded cursor                                                            |
| `archive/cpk`     | CRI `CPK ` over the canonical `aphrody-nie-formats` reader; plain headers only                                           |
| `archive/pak`     | Unreal `.pak` v1-v11: legacy index, v10+ encoded entries and full directory index; Zlib/Gzip/LZ4                         |
| `archive/iostore` | Unreal IoStore `.utoc`/`.ucas`: chunks, blocks, directory index, partitions                                              |
| `archive/unity`   | UnityFS 6-8: blocks info, nodes, LZ4/LZ4HC                                                                               |
| `archive/godot`   | Godot `GDPC` 1/2, standalone or embedded in the executable                                                               |
| `archive/rpa`     | Ren'Py `RPA-2.0`/`RPA-3.0` with a bounded, non-executing pickle reader                                                   |
| `archive/zip`     | ZIP/ZIP64, stored and deflate                                                                                            |
| `engine`          | bounded evidence-based detection (Unreal, Unity, CRI, Level-5, Ren'Py, Godot, Source, generic)                           |
| `profile`         | per-game profiles: mount order, loose exclusions, key policy, owner delegation                                           |
| `vfs`             | `GameVfs`: one view, profile rank order, first mounted path wins, shadow counting                                        |
| `classify`        | kinds from the extension table, then magic; leftovers go to Magika                                                       |
| `export`          | DDS/G4TX/EMB→PNG, CRI audio→WAV, USM→MP4/WebM, EMD/G4MD→glTF, tables→JSON; stratified batch export with SHA-256 manifest |

`packages/re/src/game/`: `native.ts` (target resolution, `bunre game` calls, worker client),
`index.ts` (`bun:sqlite` schema, FTS5, Magika), `server.ts` (HTTP API), `cli.ts` (`re game`).

### Profiles and keys

| Profile                   | Selection     | Mount                                                                       | Keys                                                                                       |
| ------------------------- | ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ievr`                    | Steam 2799860 | `aphrody-nie-formats::vfs` (cpk_list + packs) + loose outside `data/`       | delegated owner (`docs/licenses/iecode/nie/LICENSE`); never reachable from another profile |
| `dbxv2`                   | Steam 454650  | CPK: `data/` loose, `data2*`, `data_d*`, `data1`, `data0`, `data`, `movie*` | none (plain CPK, keyless HCA)                                                              |
| `unreal`                  | engine        | `*_P` patch containers first                                                | user-provided AES-256 only                                                                 |
| `unity`, `renpy`, `godot` | engine        | discovered containers                                                       | none                                                                                       |
| `cri`, `generic`          | engine        | discovered containers                                                       | user-provided only                                                                         |

Profiles hold no key material. Encrypted containers are listed in the mount report as refused
with the reason; `--aes-key`/`--hca-key` (or `BUNRE_GAME_AES_KEY`/`BUNRE_GAME_HCA_KEY`) apply to
one run and are never written or printed.

## NIE crate matrix

Generic = title-independent capability; Level-5 = specific to Level-5 formats or to IEVR.

| Crate                                                                                                                        | Generic part                                                                                                                                                                                                                                  | Level-5 / IEVR part                                                                                                                                                                                                                                           | In this pipeline                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aphrody-nie-formats`                                                                                                        | CRI: `cpk` (`@UTF`, TOC), `cpk_encode`, `crilayla`, `cri_audio` (HCA/ADX/AWB/ACB), `usm`; `mp4`/`webm`/`ivf` muxers; DDS decode and PNG encode (`g4tx_decode`), `image_out`, `raster2d`, `imgmetric`, `dxbc`; `vfs_remote` (HTTP Range, SFTP) | `cfgbin`/RDBN/T2B, all `g4*`, `objbin`, `mevbin`, `navm`, `nxtch`, `col`, `lip`, `event_script`, `menu*`, `planche`, `font`, `assemble`, `vfs` (cpk_list), CPK/cpk_list/USM key derivation, `IEVR_HCA_KEY`, `*_patch`, `str*`/`pathname` (nie.exe byte-exact) | canonical CRI and DDS readers consumed by `game::assets`; Level-5 decoders used for G4TX/G4MD/cfg.bin conversion; key derivation reachable only through the `ievr` profile |
| `aphrody-nie-explore`                                                                                                        | `listing` (folder view, search), `export` table, `raw_access` (bearer rule), `depot`                                                                                                                                                          | `folder_roles`, `cinema`, `menu*`, `vn`, `soundtrack`, `uniform_map`, `game_data`                                                                                                                                                                             | listing, export table and bearer rule re-expressed over the generic index (`re game serve`)                                                                                |
| `aphrody-nie-model-serve`                                                                                                    | `/health`, `/vfs/*`, `/raw/`, `/export/`, `/tex/`, `/audio/`                                                                                                                                                                                  | `/model-*`, `/avatar/*`, `/menu-*`, `/ui/*`, `/icons/*`, `/story-scene`, `/cfg/`, `/typed/`, `/lip/`, `/video/*`                                                                                                                                              | generic route contract served by `re game serve`                                                                                                                           |
| `aphrody-nie-render3d`                                                                                                       | GLB renderer, CPU rasteriser and wgpu path, turntable PNG/MP4                                                                                                                                                                                 | IEVR-tuned scenes (`scene`, `gizmo`)                                                                                                                                                                                                                          | `re game view`                                                                                                                                                             |
| `aphrody-nie-bevy`                                                                                                           | Bevy asset source over a VFS (`vfs_source`)                                                                                                                                                                                                   | G4TX/G4MD loaders                                                                                                                                                                                                                                             | not wired: exported glTF/PNG load in stock Bevy; the source is bound to the IEVR `Vfs` type                                                                                |
| `aphrody-nie-index`, `-seed`, `-queue`                                                                                       | SQLite RE knowledge index, BFS frontiers                                                                                                                                                                                                      | nie.exe anchors                                                                                                                                                                                                                                               | binary RE (`bun-re` feature `nie`), not assets                                                                                                                             |
| `aphrody-nie-sql`, `-tasks`, `-video`, `-geom`, `-bench`, `-pe-inspect`, `-computer-use`, `-mcp`, `-render`, `-editor`       | utilities (read-only SQL, jobs, RGBA video, geometry, bench, PE inspection)                                                                                                                                                                   | nie.exe probes, MCP tool surface                                                                                                                                                                                                                              | not needed by the pipeline                                                                                                                                                 |
| `aphrody-nie-headless`, `-cli`, `-ffi`, `-wasm`, `-lua-web`                                                                  | front-ends over the readers                                                                                                                                                                                                                   | IEVR commands and bindings                                                                                                                                                                                                                                    | replaced for other titles by `bunre game`/`re game`                                                                                                                        |
| `aphrody-nie-viola`, `-pg`, `-save`, `-launcher`, `-camera`, `-zukan`, `-wiki`, `-data`, `-identity-source`, `-ocgen`, `-ui` | —                                                                                                                                                                                                                                             | Level-5 modding, saves, launcher, camera, data, encyclopedia                                                                                                                                                                                                  | IEVR only                                                                                                                                                                  |
| `aphrody-nie-core`, `-app`, `-game`, `-play`, `-runtime`, `-net`, `-lua`, `-forge`, `-asm`, `-pe`, `-inventory`              | —                                                                                                                                                                                                                                             | reconstructed game logic, engine, netcode, binary forge                                                                                                                                                                                                       | IEVR only                                                                                                                                                                  |
| `aphrody-nie-trace`                                                                                                          | —                                                                                                                                                                                                                                             | live memory of `nie.exe`, `scripts/patch-eac.sh`                                                                                                                                                                                                              | **excluded** (see Limits)                                                                                                                                                  |
| `crates/re` `game` (DBXV2)                                                                                                   | —                                                                                                                                                                                                                                             | Dimps formats (BAC/BDM/CMS/CUS/EMB/EMD/EMM/ESK/MSG/PUP/SAV), catalog                                                                                                                                                                                          | Dimps converters used by the `dbxv2` profile (EMD→glTF, gameplay→JSON)                                                                                                     |
| `crates/re` `nie`                                                                                                            | MSVC RTTI/vtable recovery, call-graph labelling, `.pdata`                                                                                                                                                                                     | nie.exe anchors                                                                                                                                                                                                                                               | binary RE, not assets                                                                                                                                                      |
| `scripts/iecode`                                                                                                             | —                                                                                                                                                                                                                                             | IEVR data setup, Steam update hooks, RE loop scripts                                                                                                                                                                                                          | IEVR only                                                                                                                                                                  |
| `packages/re`                                                                                                                | `ml/magika` (file typing), `pipeline` runner, `bunre` lookup                                                                                                                                                                                  | —                                                                                                                                                                                                                                                             | Magika labels in `re game index`; `re game` dispatch                                                                                                                       |
| `packages/bun-engine/src/formats`                                                                                            | console ROM/BIOS/disc identification                                                                                                                                                                                                          | —                                                                                                                                                                                                                                                             | separate scope (console images), not merged                                                                                                                                |

### Moved and deleted

- Deleted from `crates/re/src/game/fs/`: `cpk.rs`, `crilayla.rs`, `cpk_extract.rs` (a second
  CPK/CRILAYLA implementation absorbed from an earlier DBXV2 tool, duplicating the canonical
  `aphrody-nie-formats` readers) and `vfs.rs` (`XenoverseVfs`, an in-memory DBXV2-only mount
  that loaded whole archives and looked for `data*.cpk` at the wrong level). Superseded by
  `game::assets::{archive::cpk, vfs}`. Callers updated: `game/wasm.rs` (canonical reader,
  plain headers only), `tests/dbxv2_inventory_cli.rs` (canonical `cpk_encode`).
- `game::convert::decode_audio_subsongs` (DBXV2) no longer decodes HCA with the IEVR key; it uses
  the keyless `game::assets::export::hca_to_wav`.
- `game::formats::emd::EmdFile::parse` read only its own mock layout and produced empty meshes
  for real files; it now reads the Xenoverse 2 layout (port of `vendor/dbxv2/dbxv2/emd.py`).
- `aphrody-nie-formats::cri_audio::Awb::parse` read 4-byte cue ids and ignored the bank
  alignment; real AFS2 headers (IEVR and DBXV2 alike) declare 2-byte ids at `[6:8]` and align
  entry starts, so multi-entry banks were mis-indexed. It now honours both (no-op where the old
  assumptions held).
- The CRI readers were not physically moved out of `aphrody-nie-formats`: they are `no_std`
  and `wasm32` code used by 26 crates, and `bun-re` already depends on them; moving them into
  `bun-re` would invert that dependency (cycle) and drop `no_std`. A dedicated CRI crate is the
  next controlled batch if the owner wants the split.

## Proof runs

Run 2026-10-17 from the workstation, read-only. VPS installs were read through a read-only
SFTP mount (`rclone mount vps:/games/SteamLibrary/steamapps R: --read-only --vfs-cache-mode off`),
so only container headers, indexes and the sampled entries crossed the network; the Steam app id
was resolved from the library's `appmanifest_*.acf` through `bun-steam`. Outputs live under
`target/tmp/re-game/` (build output, not tracked).

| Game                                                                        | Profile                                  | Detect / mount                                    | Entries                                                                                                                                                              | Exports                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IEVR (2799860)                                                              | `ievr`, owner `aphrody-nie-formats::vfs` | mount 17.5 s                                      | 255,498 = 255,308 owner + 190 loose; owner `assetCount` 255,308, `cpkCount` 936, `extraCount` 0, `looseCount` 5 — identical to the running NIE server's `/vfs/stats` | `cfg.bin`→JSON and ACB→WAV byte-identical to NIE `/export`; G4TX→PNG pixel-identical to NIE `/tex/` (PNG encoder settings differ); keshin G4MD→glTF through the generic G4MD+G4MG assembly (NIE `/model-full` adds its keshin texturing, 683 KB vs 611 KB) |
| DBXV2 (454650)                                                              | `dbxv2`, plain CPK                       | detect 9.4 s, mount 199 s (26 CPK TOCs over SFTP) | 139,036 (983 shadowed)                                                                                                                                               | 5 EMB→PNG, 5 tables→JSON, 5 animations→JSON; EMD→glTF (after the EMD fix, `HUM_000_Pants` 3 submeshes, 67.7 KB); ACB/AWB→WAV keyless (`PV_01`)                                                                                                             |
| Hogwarts Legacy mod files (Unreal 4.27 IoStore + pak v11, `%LOCALAPPDATA%`) | `unreal`                                 | 0.07 s                                            | 895 (893 shadowed duplicates in `UserData/`), real paths from the IoStore directory index; pak v11 font entry decodes to a TTF                                       | raw packages, fonts and tables; `re game index` (bun:sqlite + FTS5) and `re game serve` routes verified                                                                                                                                                    |
| Synthetic Unity install (no Unity title installed on the PC or the VPS)     | `unity`                                  | instant                                           | 5                                                                                                                                                                    | bundle nodes PNG and OGG exported                                                                                                                                                                                                                          |

No Unreal or Unity game is installed in the PC or VPS Steam libraries; the Unreal proof uses the
owner's mod files, the Unity proof a generated bundle.

## Limits

- No anti-cheat work: EasyAntiCheat/BattlEye directories are reported by `detect` and skipped by
  every walk; nothing patches, bypasses or loads them. `crates/aphrody-nie-trace/scripts/patch-eac.sh`
  is untouched and stays outside the generic owner.
- No live memory reading or writing of running games, no DRM removal, no network protocol work
  against game servers.
- No key is embedded or derived for any title. IEVR mounts through its owner under its own
  license; every other title gets only user-provided keys. Oodle and Zstd payloads, LZMA Unity
  blocks, encrypted Godot packs and keyed HCA without a user key are listed and refused.
- Unreal `.uasset`/Unity serialized files are exported raw: their object trees (textures,
  meshes inside packages) are not decoded yet.
