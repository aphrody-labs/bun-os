<!-- SPDX-License-Identifier: Apache-2.0 -->
# Changelog

Notable changes to the Bun OS distribution workspace, newest first. Details live in the linked pages and in
`git log`; this file only points to them. Entry page for the workspace: [docs/MONOREPO.md](docs/MONOREPO.md).
Nothing listed here has been published to npm or crates.io yet (see
[Release state](docs/MONOREPO.md#release-state)).

## 2026-10-22 - Monorepo consolidation

### Workspace

- Bevy comes from crates.io (0.20.1): the in-tree copies (`crates/bevy*`, `vendor/bevy`, `docs/bevy`, `tools/bevy`, their six build tools), the
  uncompiled `vendor/cargo` snapshot and the `ghidra-decompiler` copy are removed; `simdutf`, `rfb-encodings` and the PdfCraft vendor crates stay as patched copies.
- Standalone fuzz, fixture and example workspaces are excluded from the root Cargo graph (`9250e43294`).
- `bun src/cli.ts workspace check` enforces one root `bun.lock`, the nested Cargo workspace/lock ledger and the
  persisted component inventory (`867501bc0e`). Ledger: [cargo-exceptions](docs/cargo-exceptions.md).
- `bun scripts/cargo.ts metadata` runs under the members contract (`60d0480174`).
- The root `bun.lock` records the `@aphrody/identity` and `@aphrody/m3` workspace links of the ArtCraft frontend
  packages so that `bun install --frozen-lockfile` passes.
- Migration record: [CRATE-MIGRATION](docs/CRATE-MIGRATION.md#consolidation-state-2026-10-22).

### Bun Engine

- libretroarch binding: RetroArch runs in process through `bun:ffi` (`884eecd951`), is one launch route of the
  product (`ba4a71751f`) and streams to a WebGPU page (`de9f208ff9`).
- Wayland and Win32 WebGPU driver, Vulkan cores, slang on WebGPU, right-sized readback: `vendor/retroarch`
  bumps `86720cf47a`, `db949409e3`, `8ead476afa`, `8e88e643ca`.
- WASM build with JSPI, WebGPU through emdawnwebgpu and WASM audio (`52efed70cd`);
  see [EMULATION](docs/bun-engine/EMULATION.md).
- Homebrew showcase, per-system captures and library covers (`077033c4c1`):
  [HOMEBREW](docs/bun-engine/HOMEBREW.md).
- Swiss loader hang on GameCube explained (SI set-game-ID retry loop) and the Dolphin patch kept
  (`5def8b4089`); NDS, 3DS, GameCube and Wii cores verified (`b82ab5c3e4`).
- Console-style library UI bound to M3 role tokens (`0d637d1758`, `8ffdbc1aaa`) and a gamescope session that
  plays embedded games (`1fcf2c35aa`).

### WebOS

- Product hosts redirect to paths of https://aphrody.com from one catalog (`dcb3436c24`); see
  [APP-DOMAINS](docs/APP-DOMAINS.md).
- The WebOS shell is bundled with `NODE_ENV=production` so Lit leaves dev mode (`15d3c89088`).
- Craft studios integrated into the WebOS workspace (`4ceeaed72b`); hourly site reconciliation
  (`085b4d37ea`, `.gitea/workflows/aphrody-sites.yaml`).

### Domains

- `bun.aphrody.com` is left to the Bun site; `aphrody.app` install, docs and API paths redirect to
  `bun.aphrody.app` (`c020de4118`, `0e9ae96b01`). Details: [APP-DOMAINS](docs/APP-DOMAINS.md#applied-on-cloudflare-2026-10-22).

### Factory

- Bazzite fork set in `aphrody-labs` as external pinned owners (`7db04e4b6f`, `392eb79efd`):
  [BAZZITE-FORKS](docs/bun-os/BAZZITE-FORKS.md). No image has been built from it.
