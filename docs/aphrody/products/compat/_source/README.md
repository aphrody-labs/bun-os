> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-compat documentation

## Current reference

| Document                                                                     | Content                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PLAN.md](../../../plans/compat/PLAN.md)                                     | Decision ledger (historical crates.io release set of the `n2b` CLI closure).                                                                                                |
| [BUN.md](../../../reference/compat/BUN.md)                                   | Compat Bun workspace map, manifest rules, gates and the Bun upgrade procedure. The cross-repository map lives in [Infra](../../../reference/infra/APHRODY-BUN-PLATFORM.md). |
| [BUN-RUST-INTEGRATION.md](../../../reference/compat/BUN-RUST-INTEGRATION.md) | Existing Bun/Rust process and FFI boundaries; no runtime crate is linked into Bun.                                                                                          |
| [N2B.md](../../../reference/compat/N2B.md)                                   | n2b and the Oxc bridge, now in the Bun fork (`aphrody-labs/bun/packages/bun-n2b`, `aphrody-labs/bun/packages/bun-oxc`).                                                     |

## Research and audits (point-in-time)

These record findings at a given date. Paths and crate names in them may predate the category
split (for example `C:/src/aphrody`, `crates/interop/ffi` or `/tmp/bun`); the root
[README](../README.md) is authoritative for the current layout.

| Document                                                                                  | Content                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [APHRODY-FORK.md](../../../reference/upstream-bun/APHRODY-FORK.md)                        | Bun in Aphrody: the aphrody-labs/bun fork (canonical; Bun internals, `bun:ffi` and N-API are documented in the fork itself and in [its runtime/ffi.mdx page](https://github.com/aphrody-labs/bun/blob/main/docs/runtime/ffi.mdx)). |
| [aphrody-bun-napi-optimization.md](../../../apis/compat/aphrody-bun-napi-optimization.md) | napi-rs vs `bun:ffi` for Rust-to-TypeScript libraries on Bun.                                                                                                                     |
| [research/bun-vs-vite-2026.md](../../../research/compat/research/bun-vs-vite-2026.md)     | Bun vs Vite as frontend build toolchain, with benchmarks.                                                                                                                         |
