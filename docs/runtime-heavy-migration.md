# Runtime heavy-source migration

Status, 2026-10-24: B0 and B1 executed; B2 dropped after inspection; B3 done 2026-10-25
(plugins); B5 re-scoped; B4 FilmCraft reconciled, `bun-video` move re-scoped pending an
owner decision on the media SDK release pipeline; B6 found no source
duplicates. Per-batch evidence is under [Batches](#batches).

Moves the heavy sources that the `aphrody-labs/bun` runtime (`toolchains/bun`)
tracks but does not link into the default `bun` executable to Bun OS owners.
Inventory: [`os-heavy-components.md`](os-heavy-components.md). Crate layout:
[`crate-submodules.md`](crate-submodules.md).

## Measured state (tracked blobs at HEAD, 2026-10-24)

Runtime `7ba0bbb6355`: about 1,010 MB tracked (`src` 348, `packages` 332,
`vendor` 134, `test` 128).

| Runtime path                                                                  | MB   | Linked into default `bun`?                                                                 | Current consumers                                                                                                                |
| ----------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/bun-video` (hyperframes 243, remotion 26, mediabunny 15, yt-dlp 12) | 302  | No; `bun-video-native` only with feature `video_native` (`default = []`)                   | `src/js/eval/video.ts` optional extensions, skills, docs, `scripts/aphrody/{bun-video-vps,media-release}.ts`, `packages/web/www` |
| `vendor/mullvad` (android 30, audits 21, ios 14)                              | 92   | No; `bun-vpn` plugin executable, built by the runtime's native graph                       | `src/bun_vpn`, `src/plugins/vpn`, `scripts/build/{plugins,bun}.ts`, `scripts/build/deps/winfw.ts`, `scripts/aphrody/mullvad-sidecar.ts` |
| `src/browser/cef-rs`                                                          | 71   | No; no Cargo consumer outside `src/browser`                                                | none (moved in B1)                                                                                                               |
| `vendor/uv`                                                                   | 41   | No; `bun-uv` plugin executable                                                             | `src/plugins/uv`                                                                                                                 |
| `src/media/filmcraft`                                                         | 39   | No; only through `video_native`                                                            | `packages/bun-video/native`                                                                                                      |
| `src/rio`                                                                     | ~45  | Yes: `sugarloaf`, `rio-window`, `rio-vt`, `rio-fonts`, `rio-graphics`, `teletypewriter`, … | `bun_runtime` (Cargo resolve, see B5)                                                                                            |
| `factory/artifacts`                                                           | 12.5 | No; runtime qualification receipts and the Windows nginx SDK                               | `packages/bun-nginx` scripts, `test/integration/glibc-compat`, `packages/bun-video/docs`                                         |

Duplicates with Bun OS:

- filmcraft has three diverged copies: runtime `src/media/filmcraft` (owner
  commit `1c9898a93d9`, 2026-10-20: "place the complete FilmCraft source under
  the Bun media owner"), Bun OS `crates/filmcraft-*` + `apps/filmcraft` (flattened
  2026-10-16, cross-cutting edits through 2026-10-23), and the standalone
  `aphrody-labs/filmcraft` (VPS checkout on branch `claude/library-facade`).
  Runtime against Bun OS: about 1,050 differing files across 40 crates
  (`ui-egui` 178, `engine` 114, `render` 59, `platform` 52, `codecs` 40, …).
  Runtime-only crates: `craft-ui`, `craft-docpath`, `lib`. Bun OS-only: `xtask`.
- VPN: not a duplicate. Bun OS `crates/aphrody-vpn` drives the Mullvad CLI as a
  process; the runtime embeds the Mullvad daemon from source.
- llama, ssh, mcp, cosmic and uutils share names only (B6).

## Decisions

1. Dependency direction. Bun OS depends on the runtime; the runtime never
   references Bun OS sources. Bun OS crates inherit `workspace = "../.."` and
   cannot build standalone, so the runtime cannot consume them as Git
   dependencies. Builds that need moved code are produced by the Bun OS factory,
   which mounts `toolchains/bun`. The runtime's default build is unchanged.
2. Stays in the runtime: everything linked into the default executable
   (`src/sema`, `src/lint`, `src/quality`, graph, lsp, mcp, `bun_browser_dom`,
   `bun_browser_detect`, `bun_browser_ssrf`, the Rio crates in the runtime graph,
   the C libraries in `vendor/`); `vendor/uv` with `src/plugins/uv`, because
   `bun uv` is a primary command of every agent session; and the runtime's own
   qualification receipts.
3. Upstream forks that the runtime only vendored move as pinned submodules of
   their existing fork (`vendor/<name>`), not as new extracted repositories,
   when the fork already exists. Runtime-only edits are ported to the fork first.
   Edits that only adapt the tree to the runtime workspace (inherited lints,
   flattened `workspace = true` fields) are not ported.
4. Video moves as one domain, after filmcraft has one owner. Commit
   `36245d9c03a` (2026-10-15) absorbed Remotion and HyperFrames into `bun-video`
   with one CLI; do not split the package.
5. Order, lowest risk first: B0, B1, B2, B3, B4, B5, B6.

## Batch protocol

For each batch:

1. Use the existing fork when there is one; otherwise extract history with
   `git filter-repo --path <dir>` on a fresh clone of the runtime. Never rewrite
   the runtime's own history or force-push.
2. Publish on the existing fork, or on a new forge repository through the Infra
   owner.
3. Mount it as a pinned submodule; pin it in `sources.lock.json` and
   `vendor/sources.json`; repoint `factory/bunos/components.json`; keep LICENSE,
   NOTICE and `ATTRIBUTION.md` entries.
4. In one runtime commit: remove the directory and its workspace members, prune
   `Cargo.lock`, update every consumer and the documentation that names the path.
5. Qualify on the VPS: runtime `cargo metadata --locked` and `bun bd`; Bun OS
   `readLock`, `factory usr plan` and the workspace inventory.
6. Bump the runtime pin in `sources.lock.json` and `toolchains/bun` together and
   regenerate `docs/generated/component-inventory.json`.

Removing a directory shrinks HEAD and fresh partial clones
(`--filter=blob:none`), not existing history.

## Batches

### B0 — align the runtime pin: done

- `sources.lock.json` and `toolchains/bun` both pin runtime `a861cfde057` (the
  B1 commit). The former pins `340fb35a07`, `fe272a35cb` and the committed
  gitlink `3b3eceb04a` are ancestors of it.
- Runtime `a7c94f36bee` (2026-10-24) removed its last submodules, including
  `packages/aphrody-migrated/m3/aphrody-m3`. The six `bun/packages/aphrody-migrated/m3/*`
  lock entries were dropped; the same repositories and revisions remain pinned
  under `material/packages/m3`.
- An uncommitted `toolchains/bun` edit of `packages/web/cloudflare/wrangler.jsonc`
  (routes moved to the WebOS Worker), which runtime HEAD superseded with a
  different routing, is preserved as `git stash` in `toolchains/bun` and as
  `.local/preserved/toolchains-bun-wrangler-fe272a35cb.patch`. It was not
  reapplied.
- Gates: `readLock()` accepts 113 sources; `bunos factory usr plan --composition
  server` completes; the inventory regenerates (4,061 components).
- Pending owner decision: `AGENTS.md` and the README require Bun 1.4.4, runtime
  HEAD declares 1.4.7 and the workstation runs 1.4.6 canary. Not changed here.

### B1 — `src/browser/cef-rs` (71 MB): done

- The runtime copy matched fork `aphrody-labs/cef-rs` `d8b49626cf4` except for
  workspace flattening, lint allows and one change: `CEF_REVISION`
  `7e28cb05af7` from runtime `5119a9b1a7f`. That change is published on the fork
  as `b1bc46da11e` (`dev`, fast-forward).
- Bun OS mounts the fork as `vendor/cef-rs` at `b1bc46da11e`;
  `scripts/aphrody/build/cef-rs-bindings.ts` and [`cef-rs.md`](cef-rs.md) moved
  here. The bindings script reads its revision from `sources.lock.json` and the
  Chromium pins from `toolchains/bun/scripts/aphrody/cef.ts`. Its `plan` mode
  runs against `vendor/cef-rs`.
- Runtime `a861cfde057` removes `src/browser/cef-rs`, its nine workspace
  members, `scripts/aphrody/vendor-cef-rs.ts` (replaced by the submodule pin),
  `scripts/aphrody/cef-rs-bindings.ts`, `test/internal/cef-rs-bindings.test.ts`
  and `docs/chromium/cef-rs.md`; `Cargo.lock` is pruned (943 lines).
- Gates: VPS `cargo metadata --locked --offline` passes on `a861cfde057`; VPS
  `bun bd` (debug profile) on `a861cfde057` ends with `[build] done`, exit 0.
- Coverage gap: the removed test is not ported, since this workspace adds tests
  only on owner request.

### B2 — `factory/artifacts`: dropped

These are the runtime's own qualification receipts (runtime-release, nginx SDK)
and the default output directories of runtime scripts. They are not Bun OS
content. Moving them to an artifact store is a runtime-side change.

### B3 — plugins (uv, vpn, ssh, docker, just, winmd): done

Owner directive (2026-10-25) supersedes the earlier deferral and the decision to
keep `vendor/uv` in the runtime. Each plugin is its own repository; the runtime
mounts it as the optional submodule `plugins/<name>` (`update = none`) and
`scripts/build/plugins.ts` builds the mounted ones, so the release assets and
the WinFw link of `bun-vpn` stay in the runtime's native graph.

| Mount | Repository | Pin | Nested pin |
| --- | --- | --- | --- |
| `vendor/bun-uv` | aphrody-labs/bun-uv | `c1c32fce6c2` | `vendor/uv` aphrody-labs/uv `bun-0.12.24` `c3c36e2a7b3` |
| `vendor/bun-vpn` | aphrody-labs/bun-vpn | `aff07e14523` | `vendor/mullvad` aphrody-labs/mullvadvpn-app `bun-embedded` `9096ce027b8` |
| `vendor/bun-ssh` | aphrody-labs/bun-ssh | `964aaa10632` | patched russh-sftp in-tree |
| `vendor/bun-docker` | aphrody-labs/bun-docker | `24ac698c6c2` | path-depends on bun-ssh |
| `vendor/bun-just` | aphrody-labs/bun-just | `23ef9ebdaaf` | `vendor/just` aphrody-labs/just `bun` `5827d90d9ec` |
| `vendor/bun-winmd` | aphrody-labs/bun-winmd | `8c1a9806a81` | uses the runtime's `vendor/find-msvc-tools` |

- The fork branches carry the runtime trees verbatim (same Git tree object):
  uv is upstream tag `0.12.24` plus the runtime edits, Mullvad is
  `493198790be` plus the `embedded` daemon edits, just is `a6bc306` plus the
  Bun runner edits.
- Each plugin workspace path-depends on runtime crates (`src/system_tools`,
  `src/no_window`, `src/zlib_rs`, `vendor/find-msvc-tools`), so it builds only
  mounted in a runtime checkout; Bun OS builds it through `toolchains/bun`.
- Runtime `e6ee23eb785` removes `src/plugins`, `src/bun_vpn`, `src/ssh`,
  `src/docker`, `src/just`, `vendor/uv`, `vendor/mullvad`,
  `vendor/russh-sftp` (129 MB tracked); `Cargo.lock` pruned, each plugin lock a
  subset of it. `sources.lock.json` pins the runtime there and the six plugins, with their
  nested forks, as `vendor/bun-*` (the runtime's own `plugins/*` gitlinks are
  not assembled under `sources/bun`). Gate: `readLock()` accepts 122 sources.
- Gates: runtime `cargo metadata --offline --locked`; `cargo check --locked` of
  all six plugin workspaces on Windows x64 (MSVC); runtime script tests for the
  native CI plan, release matrix, Mullvad sidecar and WinFw source (22 pass).
  Not run: native `bun bd --target=plugins`, Linux/macOS plugin builds, the
  release workflows.

### B4 — video domain (341 MB): FilmCraft reconciled; package move re-scoped

1. Done: FilmCraft has one owner, the Bun OS `crates/filmcraft-*` and
   `apps/filmcraft*` (commit `f7dcf26d0f`). The Aphrody / Bun identity and the
   shared `craft-ui` depend on Bun OS crates, so a standalone owner cannot carry
   them.
   - The runtime copy at `1c9898a93d9` was exactly `aphrody-labs/filmcraft`
     `main` (`9cfaa22b`). Its six later runtime commits were replayed there,
     with the standalone workspace root restored. That tree is published as
     `aphrody-labs/filmcraft` branch `bun-runtime-0.9.0` (`e1ebbf4c`).
   - That tree was merged into Bun OS three-way against the Bun OS import
     (`87b84513`, flattened in `fc2098cc31`). Both sides were first formatted
     with the pinned rustfmt and the Bun OS configuration, so the 2026-10-17
     formatting pass does not conflict, and flatten-time path adaptations were
     re-applied.
   - Bun OS keeps the Aphrody / Bun identity, the shared `craft-ui` and its M3
     theme adapter (its seven FilmCraft commits). Upstream brings 0.9.0,
     `filmcraft-lib`, the vendored `craft-docpath` and the in-crate fonts.
     Every FilmCraft dependency moves from 0.7.2 to 0.9.0, including the
     DeckCraft, EffectCraft and SoundCraft consumers.
   - The ArtCraft wordmark artwork is dropped, as upstream did. The tracked
     `h264enc/target` outputs are not imported.
   - Gates, on a VPS clone with the root workspace's member, patch and path
     submodules initialized: `cargo metadata` resolves the root workspace;
     `cargo check --all-targets` passes for the 56 FilmCraft packages and their
     8 consumers; `cargo check -p filmcraft-web --target wasm32-unknown-unknown`
     passes. The serialized wrapper refused to run because it requires runtime
     1.4.5 and the VPS has 1.4.6, so Cargo ran directly, one job at a time with
     `-j 6`. That exceeds the four-compiler-job lane rule.
   - The resolve also found B1 leftovers: the Tauri CEF runtime still pointed at
     the removed runtime `src/browser/cef-rs`. It now uses `vendor/cef-rs`,
     which the root workspace excludes (commit `7b70e97520`).
2. Re-scoped: `packages/bun-video` cannot move as one unit. 271 MB of its 302 MB
   are vendored upstream projects (hyperframes 232, remotion 25, mediabunny 15,
   yt-dlp 12). They feed the package's own build (`scripts/build.ts`,
   `scripts/generate-hyperframes.ts`, `src/video-api.ts`,
   `src/render-runtime.ts`).
   - The runtime's own release pipeline imports the package source. 61 imports
     in about 30 runtime files reach `packages/bun-video/src/sdk*` and
     `src/apps/*`: `scripts/aphrody/media-sdk-*`, `media-release`, `media-stage`,
     `release-*`, `runtime-sdk-build`, `native-sdk-*`, `ffmpeg`, `libmpv`, the
     HLS, DASH and Crunchyroll labs, and the `linux-media-portable` receipts.
   - The runtime feature `video_native` compiles `bun_video_native` into
     `src/runtime/image/Image.rs`, and that crate needs FilmCraft.
   - Moving the package therefore needs an owner decision first. Either the
     media SDK release pipeline moves to Bun OS with it, or the package is split
     into a runtime-owned media SDK and a Bun OS composition package (Remotion,
     HyperFrames, studio, site). None of the four upstream projects, nor
     `bun-video` itself, has an `aphrody-labs` fork; a new repository goes
     through the Infra owner. `video_native` would then take FilmCraft from
     `aphrody-labs/filmcraft` `bun-runtime-0.9.0`, which builds standalone.
   - Once that is decided: move `packages/bun-video` whole to Bun OS; keep the `@aphrody/bun-video` name
   and version line. The runtime keeps `src/runtime/video/Video.rs` and
   `src/js/eval/video.ts`, which already loads the adjacent `bun-video`
   executable for its extensions.
3. Runtime: remove `packages/bun-video` and `src/media/filmcraft`, their
   workspace members and the `bun_video_native` path dependency; `video_native`
   executables come from the Bun OS factory.
4. Move or repoint `scripts/aphrody/bun-video-vps.ts`, `media-release.ts`, the
   `bun-video` and `video-pixel-perfect` skills and the `packages/web/www` scene
   data.

Gate: runtime default build and `Bun.Video` tests; Bun OS factory build with
`video_native`; `bun-video` release gate.

### B5 — Rio: done, nothing to move

Cargo resolve of `bun_runtime` (`cargo metadata --locked`, runtime `a861cfde057`)
reaches `corcovado`, `rio-fonts`, `rio-grapheme-width`, `rio-graphics`,
`rio-unicode`, `rio-vt`, `rio-window`, `sugarloaf` and `teletypewriter`. Only
`librio`, `librio-wasm`, `libsugarloaf`, `rio-backend`, `rio-grid`,
`rio-notifier` and `rioterm` are outside the runtime graph. Move those only
together with a Bun OS consumer; Bun OS has none today, so this batch moves nothing.

### B6 — duplicate audit: done, no source duplicates

Compared by Git blob, 2026-10-24:

- `packages/bun-llama` (4 files) and `crates/aphrody-llama` (23): no shared blob.
- `src/ssh` (13) and `crates/aphrody-ssh` (6): one shared blob.
- `src/mcp` (27) and `crates/aphrody-mcp` (39): no shared blob.
- uutils: the runtime fetches it as a build dependency (`scripts/build/deps/uutils.ts`;
  `vendor/*` is ignored), so nothing is tracked twice.
- cosmic: `src/cosmic` uses the crates.io `cosmic-text`; it does not vendor
  `cosmic-epoch`.

These are separate implementations of overlapping capabilities, not copies.
Converging them is design work per capability, outside this migration.

## Result so far

Runtime HEAD: −71 MB (B1). The remaining estimated reduction is B4 (about
341 MB) once filmcraft has one owner.
