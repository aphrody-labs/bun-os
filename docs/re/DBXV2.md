# DBXV2 reverse engineering (bun-re, WASM)

One capability merges three former owners:

| Owner                                                           | Role now                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vendor/dbxv2` (Python toolkit, pinned submodule)               | Reference implementation and format catalogue (`formats.json`, `DATA.md`, `docs/`). Kept for `serve`, `rag`/`llm`/`caption` (Gemini), `tools clone` and `setup`, which have no Rust port. Its Python dependencies and lock remain owned by the toolkit; it is not a Bun workspace package. |
| `crates/re` (`bun-re`, feature `dbxv2`)                         | The port of every other Python pass: `bunre dbxv2 map                                                                                                                                                                                                                                      | reverse | extract | tex | audio | text | models | parse | index | classify | search | stats | sav | report`, with the gameplay readers (BAC/BCM/BCS/BDM/BSA/EAN/EMM/ESK) ported from pyxenoverse offset for offset. |
| `packages/re` (Bun fork of morluto/rea) + `packages/re/replica` | Binary-analysis tooling and the Replica skills; DBXV2 reuses it for the `reverse` pass only.                                                                                                                                                                                               |

## In-memory surface

`bun_re::game::api` (features `dbxv2` or `wasm`) works on bytes only:

- `identify(bytes, name)`: magic first, extension second, with the `formats.json` category.
- `cpk_list` / `cpk_extract`: plain `CPK ` archives through the canonical `aphrody-nie-formats` reader (CRILAYLA decompressed).
- `summarize(bytes, name)`: JSON for EMB, EMD (counts per part), ESK, CMS, CUS, PUP, MSG and the gameplay formats.
- `audio_to_wav(bytes)` (feature `dbxv2`): HCA, ADX, AWB and embedded-AWB ACB to PCM16 WAV, one per subsong.
- `xz_decode(bytes)` and `decode_asset(bytes, name)`: pure-Rust xz (`lzma-rs`, no C dependency, so also in the wasm build) and gzip decoding of stored assets; `read_asset(root, kind, cpk, path)` (feature `dbxv2`) reads from a local assets tree.

## Assets tree and origin

The private dump is reorganised by `scripts/aphrody/tools/infra/dbxv2-assets-layout.ts` into `<kind>/<cpk>/<path>` (`kind` = models, textures, audio, video, text, data) and served by the mesh-only nginx origin (`infra/config/host/nginx/private/dbxv2-assets.conf`, `10.200.77.1:8794`). Storage contract:

- `models`, `textures`, `data`, `text`: stored once as `<path>.xz` (`xz -9e --threads=1`, about 30% smaller than gzip -9 on EMD). Clients request `/<kind>/<cpk>/<path>.xz`; the origin returns the xz stream untouched as `application/x-xz` (no `Content-Encoding`, no gzip/gunzip) and the client decodes it. A `<path>.gz` can only remain while a conversion is unfinished; it is still served inflated.
- `audio`, `video`: raw, requested without suffix (`/video/` supports ranges).
- `meta/index.jsonl`: one line per file with `cpk`, `path`, `kind`, `size` (original bytes), `gzip` (true only for a leftover `.gz`), `compression` (`"xz"`/`"gzip"`, absent for raw) and `stored` (bytes on disk).
- Every `.xz` is decoded and its length compared with `size` before the previous copy is deleted.

Decoding: `bun_re::game::api::{xz_decode, decode_asset, read_asset}`, and `wasm_xz_decode` (wasm).

## WebAssembly

`wasm_identify_format`, `wasm_summarize`, `wasm_triage_cpk`, `wasm_extract_cpk_file`, `wasm_cpk_find` / `wasm_cpk_read` (synchronous `read(offset, len)` callback), `wasm_model_json`, `wasm_model_assembled_json`, `wasm_model_glb` (feature `wasm`) and `wasm_xz_decode`, `wasm_audio_to_wav`, `wasm_emb_to_png`, `wasm_usm_to_video` (adds `dbxv2`) live in `crates/re/src/game/wasm.rs`. `bun-re` itself is an rlib; a host crate must build it as a cdylib with the `wasm` feature to obtain a loadable module.

## AssembledModel adapter

`model_assembled_json(name, emd, emb?, esk?)` (`bun_re::game::api`, `wasm_model_assembled_json`) returns the field layout of `aphrody_nie_formats::assemble::AssembledModel`, the type `aphrody-nie-model-serve` exports to GLB. That struct has no serde derive, so the JSON mirrors its fields (snake_case); vectors are arrays, not `{x,y,z}` objects. Faithful: positions, normals, uv0, colors (when every vertex has one), indices, material and piece names, and the ESK skeleton (parent, local TRS, inverse bind, CRC32 of the bone name). Not mapped: `skin` stays `null` because the EMD parser does not read blend weights/indices; `component` is always `Generic`; `body_glb`, `face_glb`, `uniform_crc`, `texture_uri`, `aux_textures` and animation lists are empty; `embedded_textures` is empty (pixels via `embToPng`, raster metadata in `report.textures`).

## Readers and honest coverage

`msgRead` (`wasm_msg_read`) decodes the real MSG layout: per table the id, key name and lines, each string with its slot (`offset`, `chars`, `bytes`, `flag`) and the encoding chosen from it (`utf8` when `bytes == chars + 1`, `utf16le` when `bytes == chars * 2 + 2`). `acbInfo` returns the cue sheet (cue names). `support()` returns the per-format table (`full`, `header`, `unverified`, `convert`, `identify`) so a client never assumes more than exists:

- BAC, BDM, BCM, BCS, BSA, EAN, EMM: the gameplay loaders validate the whole file but only emit header-level fields; hitbox, frame and keyframe data are not decoded (EAN reads keyframes and discards them).
- EEPK, EMA, EMO: recognised by extension only; PS4 GNF textures inside EMB are not recognised.
- CMS, CUS, PUP: readers exist but were written against synthetic fixtures and never checked on game files.
- EMD: positions, normals and UVs only; blend weights, tangents and vertex colours are not read, so `modelAssembledJson` has no skin.
- `EmbFile::decode_rgba` is a placeholder raster, not the game pixels: use `embToPng`.
- Before this change `EskFile::parse` and `MsgFile::parse` fabricated their output (a bone count read from the wrong field; NUL-separated strings after byte 16); both now follow the real layouts.

## Not in scope

EEPK/EMP effects, USM video demux in the in-memory surface (the file-based export already remuxes USM), IDB and quest formats are catalogued only: the Python toolkit never parsed them either. Game assets are never committed; the private dump on the VPS is read-only verification data.
