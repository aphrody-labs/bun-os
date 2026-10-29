<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->

# Drive backend migration workspace

This nested Cargo workspace contains the additive OS-owned copy of the
Spacedrive Drive backend. Its imported source is licensed under
[FSL-1.1-ALv2](LICENSE), separate from the Apache-2.0 Aphrody OS workspace.
The original import came from Aphrody UI commit
`0511c85ae556b888d349fcf9af275ed926d141d1`. The original project is
[`spacedriveapp/spacedrive`](https://github.com/spacedriveapp/spacedrive).
The import keeps its crate names, API, data layout, migrations, CLI, daemon,
native patches and bundled data-source adapters. The current daemon source lives
in this nested workspace; its build path is
`apps/aphrody-drive/core/Cargo.toml`. The Tauri plugin supervises a staged daemon
next to the app executable or one on `PATH`, but installed-bundle startup and data
parity remain unqualified.

## Boundaries

- `core/` owns Drive's operations, persistence, indexing, sync and `sd-daemon`.
- `crates/`, `crates/infra/aphrody/`, `xtask/`, `patches/` and `adapters/` stay beside core
  because core and CLI use them at build or runtime.
- The HTTP site belongs to `aphrody-web/crates/aphrody-site` and is absent here.
- `packages/app-ui` owns the active Files UI, `packages/m3-explorer` the shared
  M3 file controls, and `packages/drive-client` the active TypeScript contract.
  They are already consumed by the Bun OS product; the preserved upstream
  interface snapshot under `docs/material/m3/reference/drive/` is not a second
  active application.
- `sd-images` retains SVG rasterization using `resvg 0.47`, system fonts,
  dimensions and straight-alpha RGBA equivalent to the current
  `aphrody-svg::raster` call. This local adapter avoids an OS to UI Cargo edge;
  the four changed imported files and `svg_raster.rs` are the only backend
  source differences from the UI copy at import.

`bun scripts/aphrody/build/rust/cargo-serial.ts check --manifest-path
apps/aphrody-drive/core/Cargo.toml -p sd-core --bin sd-daemon` checks daemon
compilation. It does not prove data migration, service startup, feature parity,
or that the release bundle contains the daemon. Keep those delivery gates open
until they are verified on the installed product.

## Known safety gap

[`crates/archive/src/safety.rs`](crates/archive/src/safety.rs) is a stub whose
batch screening returns score 0 and safe for every record. The archive engine
currently logs “safety screening model loaded (Prompt Guard 2 22M)” after
constructing that stub. The fallback in `engine.rs` can also mark unscreened
records safe. Therefore active prompt-injection screening is **not** proven
and must not be advertised as protection. Resolve this with the AI-owned
model service and an explicit contract before claiming that capability.

See the OS architecture for repository ownership.
