# DBXV2 `.emo` objects and `.ema` motions

Readers: `crates/re/src/game/formats/{emo,ema}.rs`, exposed by `api::summarize` (WASM
`wasm_summarize`) and listed as `full` by `api::support`.
Established on 2026-10-22 from the game files themselves, then checked against the
`xgcore.dll` decompilation (Ghidra export of the installed game, read-only). No game byte is
committed: the tests encode their own fixtures and the real-data gates read a local corpus.

## Where they are used

The game ships 1,959 `.emo` and 5,116 `.ema` files across its CPKs. They are mostly skill and
stage effect props: `<name>.emo` with `<name>.obj.ema` (node transforms), `<name>.mat.ema`
(material parameters) and `<name>.light.ema` (light). Character cameras use `.cam.ean`, not
`.ema`.

## `.emo`

All offsets little-endian; "relative" means from the start of the enclosing structure.

| Structure | Layout |
| --- | --- |
| Header | `#EMO`, `u16 0xFFFE`, `u16 header_size` (0x20), `u32 version`, `u32 parts`, `u32 skeleton`, `u32 vertex_data` |
| Parts group | `u16 part_count, u16, u32 names, u32 part_offsets[part_count]`; names table: one `u32` string offset per part (all relative to the group) |
| Part | `u16 emg_count, u16, u32 emg_offsets[]` (relative to the part; 0 = empty) |
| EMG | `#EMG`, `u16, u16 mesh_count, u32 mesh_offsets[]` (relative to the EMG) |
| Mesh | `u32 vertex_flags, u32 texture_list_count, u32, u32 texture_lists, u16 vertex_count, u16 vertex_size, u32 vertices, u16, u16 submesh_count, u32 submeshes`, then a 48-byte AABB (center, min, max as vec4); offsets relative to the mesh |
| Texture list | `u16 sampler_count, u16`, then 12-byte samplers (`u8, u8 texture_index, u8 addressing, u8 filtering, f32 scale_u, f32 scale_v`, as in `.emd`) |
| Submesh | `vec4`, `u16 texture_list, u16 index_count, u16 bone_count, char name[32], u16 indices[index_count], u16 bones[bone_count]` |

Vertices follow the `.emd` attribute order: position (3 × f32), normal, tangent, uv, uv2,
color (4 × u8), blend indices (4 × u8) and three weights; normals, tangents, uvs and weights
are half floats when `vertex_flags & 0x8000`. `vertex_size` always equals the size computed
from the flags (checked on every mesh). The submesh name is also its EMM material name.

### Node tree (shared with `.ema`)

`u16 node_count, u16, u32, u32 nodes, u32 names, u32, u32, u32 node_extras, u32 ik, ...`,
`u64 skeleton_id` at `0x38`. Each node is 80 bytes: `i16 parent, i16 child, i16 sibling,
i16 part, i16`, padding to 16, then a row-major 4×4 transform (translation in the last row).
`-1` means none. The usual tree is `<object>` → `TRS` → one node per part.

## `.ema`

| Structure | Layout |
| --- | --- |
| Header | `#EMA`, `u16 0xFFFE`, `u16 header_size`, `u32 version`, `u32 skeleton` (node tree above, 0 when absent), `u16 animation_count`, `u16 kind`, then `u32 animation_offsets[]` at `header_size` |
| Animation | `u16 frame_count, u16 command_count, u32 value_count, u16, u16 value_flags, u32 name, u32 values, u32 command_offsets[]` (relative to the animation) |
| Name | 10 bytes, `u8 length`, characters (`StoredFcvPose`, `StoredFcvAction`, `MATERIAL_ANIMATION`, or a clip name) |
| Command | `u16 node, u8 target, u8 flags, u16 key_count, u16 indices` (relative to the command), then the key frames |

- `kind`: 3 object (target 0 translation, 1 rotation in degrees, 2 scale), 4 light, 8 material.
- Values are `f16` when `value_flags & 1` (object and light files) and `f32` otherwise
  (material files). `EmMotion::GetTailTranslation` branches on this bit.
- Key frames are `u8`, or `u16` when `flags & 0x20` (seen on a 260-frame clip); they never
  decrease, but a few material files repeat a frame. Value indices are `u16` masked by
  `0x3FFF`, or `u32` masked by `0x3FFF_FFFF` when `flags & 0x40`, used by motions with more
  than 16,384 values (`vfx/demo/D11_13/DRG_Ani.obj.ema`: 86,420 values, flags `0x40`/`0x60`).
- Half-float values can be ±infinity in the game data itself: that dragon cutscene stores
  translations beyond the f16 range (65,504) as `0x7C00`/`0xFC00`, referenced by 516 keys.
  The reader returns them as is; no value is NaN.
- The top bits of an index, when not zero, are the distance from the key value to its tangent
  value (`values[index + bits]`), exactly as the engine reads it.
- `flags & 3` is the animated component (x, y, z, w).

## Verification

- Unit tests encode a one-triangle object and a two-key motion, and reject out-of-range indices.
- Real data: `DBXV2_REAL_EMO_DIR=<dir> DBXV2_REAL_EMA_DIR=<dir> cargo test -p bun-re --lib -- game::formats::em`
  parses every file below the directories. On the factory, the corpus is every `.emo` and
  `.ema` of every CPK, fetched through the local DBXV2 CPK service into
  `/games/cache/dbxv2-ema-emo/corpus` (outside Git). Result on 2026-10-22: all 1,959 `.emo`
  and all 5,116 `.ema` files parse.

Unknown fields are kept unnamed above; nothing in the readers depends on them.
