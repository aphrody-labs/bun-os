> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bun and Rust integration boundaries

This repository does not link a Rust crate into the Bun executable. Bun is
discovered and launched as an installed program through the shared
`aphrody-toolchains` crate. The
Bun source lives in the aphrody-labs/bun fork checkout next to this repository
(`../bun`), and its documentation is mirrored in `docs/reference/upstream-bun`; neither
is a member of this Cargo workspace.

## Existing interfaces

- `aphrody-n2b-native` exports a versioned C ABI. Its `node2bun_scan_json`
  function runs the N2B scanner in check mode and returns an owned JSON result;
  `node2bun_string_free` releases it. Consumers load this dynamic library
  through `bun:ffi`; the [Bun fork](../upstream-bun/APHRODY-FORK.md) has no `bun:aphrody` module. The library must be
  supplied separately; the Rust scanner is not linked into the Bun executable.
- `aphrody-ffi` in `aphrody-ai` exposes Aphrody's command surface through a
  separate C dynamic library and `bun:ffi`.
- `aphrody-bun` and `@aphrody/bun` in `aphrody-ui` expose UI Rust hot paths to
  Bun through `bun:ffi`; UI owns their lifecycle and API.
- Bun's experimental `bun-native-plugin` supports a Rust/N-API bundler
  `onBeforeParse` hook. It is a build transform API, not a runtime module or a
  general way to add `Bun.*` APIs.

These interfaces let Bun programs call native Rust code. The N2B scan ABI calls
the Rust scanner in-process without spawning the `n2b` CLI. These libraries are
separate dynamic artifacts, each with its own ABI and release boundary.

For the cross-repository crate/package map and the staged plan for a native
Aphrody Bun runtime, see [Infra's Aphrody Bun platform document](../infra/APHRODY-BUN-PLATFORM.md).
