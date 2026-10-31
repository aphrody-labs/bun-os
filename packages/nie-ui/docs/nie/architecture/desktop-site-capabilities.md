# Desktop and site capability bindings

> **Historical (2026-09-26):** the Inacord Tauri host (`apps/inacord`) described below was removed.
> The Bun OS desktop is the COSMIC session (the Tauri `aphrody-app` was retired on 2026-10-31); IEVR stays in nie web; see `PLAN.md`, Decisions 2026-09-26.

Source inventory, 2026-09-08. Implementation status below is source inspection, not a
record of passing build, browser, or deployment gates. The active gate ledger is `PLAN.md`.

The frontend now has one `apps/nie-web/src/main.tsx` entry and Vite configuration. The
`#nie-host` alias selects `BrowserHost` or the existing Inacord `DesktopHost`; desktop output
is `apps/nie-web/dist-desktop`. This consolidates entry/build ownership while preserving
different host shells. It does not establish equal navigation, UI coverage or runtime parity.

Root Cargo workspace integration is a separate migration. Release scripts now consume one
root lockfile and shared target directory, honoring `CARGO_TARGET_DIR` and
`CARGO_BUILD_TARGET`. Source evidence of the SQLite blocker is root `rusqlite 0.37.0` /
`libsqlite3-sys 0.35.0` versus the former desktop `tauri-plugin-sql 2.4.0` /
`sqlx-sqlite 0.8.6` / `libsqlite3-sys 0.30.1`. Both native dependencies declare the same
SQLite linkage. Reusing the existing rusqlite owner requires completing the desktop SQL
compatibility migration and validating the unified root lock; release-script changes alone
do not prove Cargo resolution or desktop behavior.

HTTP registration and user-interface consumption are separate milestones. Source inspection
of `apps/nie-web`, `packages/inacord-ui` and `packages/asset-source` found no consumers of the
new wiki-card/search, optional-export, related-resource, or growth-interpolation HTTP endpoints.
These entries document callable backend bindings, not completed browser flows. The related
endpoint therefore does not yet establish automatic companion preloading. Existing browser
Wasm calls may use the same native owners without calling these HTTP routes.

| Desktop or Azalee capability                     | Existing shared owner                                                  | Site binding                                                      | Remaining distinction                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VFS browse and original bytes                    | `aphrody-nie-formats::vfs`                                             | `/b`, `/f/{path}`                                                 | Desktop filesystem destinations are host operations.                                                                                                                                                |
| Config and geometry decoding                     | `aphrody-nie-formats`, `aphrody-nie-data`                              | `/api/v1/formats/decode/{path}`, `/api/v1/donnees/famille/{key}`  | Config inspection preserves canonical `lists`/`entries`; desktop joined catalogue DTO parity is not established.                                                                                    |
| Sprite, font and menu inspection                 | `aphrody-nie-formats`                                                  | `/api/v1/inspect/*`                                               | Inspection is not native screen rendering parity.                                                                                                                                                   |
| Lua bytecode and menu callbacks                  | `aphrody-nie-lua`                                                      | `/api/v1/lua/*`, `/api/v1/menu/runtime/{screen}`                  | Bounded native replay; unrestricted evaluation and desktop process attachment are not exposed.                                                                                                      |
| ACB, AWB, UTF/ACF and USM metadata               | `aphrody-nie-explore::native_metadata`, `native_audio`, `native_video` | `/api/v1/formats/decode/{path}`                                   | Source size bounds apply; MPEG-2 playback, complex synth execution and synchronized USM playback remain unsupported here.                                                                           |
| Export formats, output names and conversion      | `aphrody-nie-explore::export`                                          | `/api/v1/export/formats/{path}`, `/api/v1/export/file/{path}`     | Explicit AWB waveform/USM channel selection; contextual GLB and named ACB cue export are not supplied by this route.                                                                                |
| Desktop related-file search                      | `aphrody-nie-explore::related::legacy_search`                          | Preserved Tauri compatibility facade                              | The historical substring search is not a dependency graph and is not used for automatic preloading.                                                                                                 |
| Native declared relationships                    | `aphrody-nie-explore::related::inspect`                                | `/api/v1/resources/related/{path}`                                | OBJBIN paths are exact declarations with explicit locale substitution. Same-stem model peers are separate naming candidates. Font atlas, material and motion target associations remain unresolved. |
| Motion clip inspection                           | `aphrody-nie-explore::motion`                                          | `/api/v1/motion/clips/{path}`                                     | Clip metadata does not establish a skeleton or runtime animation binding.                                                                                                                           |
| Assembled models                                 | Existing assembly and model service                                    | `/api/v1/3d/*`, `/model/*`                                        | These preserve existing service contracts; no complete desktop viewport parity claim.                                                                                                               |
| Character growth and comparison                  | `aphrody-nie-core`                                                     | `/api/v1/regles/*`, `/api/v1/growth/interpolate`                  | Interpolation requires explicit native control points.                                                                                                                                              |
| Joined Inagle character cards and learned skills | `aphrody-nie-wiki::cards` using existing `query` joins                 | `/api/v1/wiki/characters/{id}`                                    | Exact character ID; unknown skills and absent native anchors remain explicit. Raw merged mirror blobs are not public card fields.                                                                   |
| CLI cross-family wiki search                     | `aphrody-nie-wiki::query::search_all`                                  | `/api/v1/wiki/search?q=...`                                       | Existing per-family search limits are preserved; this is not an exhaustive paginated catalogue.                                                                                                     |
| Camera and navmesh previews                      | `aphrody-nie-explore::spatial_preview`                                 | `/api/v1/preview/camera/{path}`, `/api/v1/preview/navmesh/{path}` | Extracted desktop projections, not runtime scene playback.                                                                                                                                          |
| Zukan candidate ranking                          | `aphrody-nie-zukan::api`                                               | GET/POST `/api/v1/zukan/rank` and existing Wasm binding           | Ranking suggestions are not confirmed character identities. HTTP accepts a bounded request; the browser can retain its shared-owner Wasm path.                                                      |
| Azalee save roster resolution                    | Existing site save resolver                                            | `/api/v1/save/roster`                                             | Identifiers are resolved without uploading a complete local save.                                                                                                                                   |

Remaining portable gaps include joined video catalogue DTO parity. Desktop save/mod staging,
local disk discovery, clipboard, Blender/editor
launch, process tracing and MCP installation require a host context. They are not mapped to
public server operations. Azalee authentication, administration, VRoid, editorial publication
and RAG integrations remain separate services; their existence is not backend parity.

Related-resource responses expose only indexed logical game paths. Consumers may preload
resolved, readable `declared` references. They must not reinterpret `namingCandidates` as confirmed
material, texture, animation or font bindings. Missing and unresolved relationships remain
explicit instead of choosing an unrelated file by substring or basename.

Catalogue state now subscribes to the shared browser location snapshot and its query writes
preserve the host history state. Explorer links also use the host router and restore folder
selection on history traversal. These source fixes still require final interaction validation.

## Source-level sharing audit

The requested universal statement (site/backend, CLI, Inacord and MCP share **all** code) is not
currently true. The strongest source evidence is narrower:

- Browser and desktop share the mount entry and build owner: `apps/nie-web/src/main.tsx` imports
  `#nie-host`; `BrowserHost.tsx` mounts the browser application while
  `desktop/DesktopHost.tsx` mounts the retained Inacord application. This proves build/entry
  convergence, not a common application shell or common feature registry: the two host modules
  still import different `App` implementations.
- Tauri command registration and generated TypeScript bindings do have one list:
  `apps/inacord/src-tauri/src/lib.rs::specta_builder`. Runtime registration and
  `apps/nie-web/src/desktop/lib/bindings.ts` generation consume that list. This proves consistency
  inside the desktop IPC surface; it does not prove that HTTP, CLI or MCP expose the same commands.
- Core calls are genuinely shared where adapters invoke library owners. Examples include
  `aphrody_nie_explore::listing::{ls_paged,find,find_paged}`, `aphrody_nie_explore::related::legacy_search`,
  `aphrody_nie_explore::spatial_preview`, `aphrody_nie_core::growth::calculate_stats`, `aphrody_nie_viola`, `aphrody_nie_trace`,
  `aphrody_nie_save` and `aphrody_nie_formats`. The table above records the corresponding HTTP surface where one
  exists.
- The MCP server is not an independent complete surface: `crates/nie/aphrody-nie-mcp` is a package
  wrapper, while the tool implementations and router live in `crates/nie/aphrody-nie-cli/src/mcp.rs`.
  That is direct CLI/MCP code sharing, but it says nothing about commands absent from that router
  or from the site.

### Current counterexamples to complete sharing

| Counterexample                                 | Source evidence                                                                                                                                                                                            | Required convergence                                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Separate browser and desktop application trees | `apps/nie-web/src/BrowserHost.tsx` imports `./App`; `apps/nie-web/src/desktop/DesktopHost.tsx` imports `./App` in the desktop directory.                                                                   | Extract one application shell/view registry into shared presentation and inject host capabilities.                                                                 |
| Desktop game-data orchestration and DTOs       | `apps/inacord/src-tauri/src/game_data.rs` implements the joins and flattened IPC DTOs for skills, items, characters, teams, movies, music, dictionary, drops and other families.                           | Move reusable joins/DTO contracts to `aphrody-nie-data`/`aphrody-nie-explore`; leave only IPC conversion in Tauri, then bind the same functions from site/CLI/MCP. |
| Explicitly copied conversion                   | `game_data.rs::t2b_value_to_json` documents that `aphrody_nie_explore::bridge::t2b_value_to_json` is private and therefore reproduced locally.                                                             | Make the shared conversion public (or expose a higher-level shared operation) and delete the copy.                                                                 |
| Desktop-only save and mutation lifecycle       | `apps/inacord/src-tauri/src/lib.rs` owns `SaveState`, save open/blob/export commands, loose override writes and disk destinations.                                                                         | Separate portable save/mod operations into `aphrody-nie-save`/`aphrody-nie-explore`; retain file pickers and destination writes as explicit native capabilities.   |
| Desktop-only raw archive session               | `RawCpkState` and `raw_cpk_*` commands in `apps/inacord/src-tauri/src/lib.rs` keep an open archive and implement extraction/preview lifecycle.                                                             | Extract reusable session/read/export operations; keep native destination selection as an adapter.                                                                  |
| Desktop-only media catalogue orchestration     | `apps/inacord/src-tauri/src/video.rs` and the `video_*` commands assemble catalogue, preload and playback data around shared format/soundtrack primitives.                                                 | Give catalogue and media resolution a library owner used by HTTP/CLI/MCP as well as Tauri.                                                                         |
| Native-only process/tool integration           | `re_trace.rs`, `live_mod.rs`, `scene_editor.rs`, Blender commands, clipboard, trash and MCP installation require local OS/process authority.                                                               | Keep these as native host capabilities; do not claim public-site parity or expose unsafe mutations merely to equalize surfaces.                                    |
| Site routes without mounted desktop consumers  | Wiki cards/search, optional export, declared relationships, motion clips and growth interpolation are registered by `nie-site`, but the inspected frontend packages have no consumers for several of them. | Add host-neutral contracts and actual shared-UI consumers, followed by adapter and interaction tests.                                                              |

Consequently, the machine-verifiable completion proof cannot be a route/command name count. A
valid proof must map each portable capability to one library function and show tests from every
applicable adapter (HTTP, CLI, MCP, Tauri and Wasm), while separately marking OS-only capabilities.
It must also prove that both host builds mount the same feature registry and run non-zero
interaction tests. Until those conditions hold, this file is an inventory of proven sharing and
explicit counterexamples, not a parity certificate.
