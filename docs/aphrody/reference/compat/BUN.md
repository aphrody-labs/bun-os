> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bun layer of aphrody-compat

> Path reconciliation (2026-10-07): `crates/compat/n2b-native` (not in repo) → `crates/interop/ffi/src/n2b_native.rs`. Original dated observations below retain their historical scope.

This page maps every part of `aphrody-compat` that runs on Bun, provides Bun, or documents Bun,
and states the rules they follow.

## Map

| Layer           | Where                                                                                 | Role                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime         | system `bun`, pinned by root `package.json` `packageManager` (and `mise.toml`)        | The only JS runtime and package manager. Its source is the [aphrody-labs/bun fork](../upstream-bun/APHRODY-FORK.md); Aphrody keeps no Bun source checkout.                                                                                                                                                                                                       |
| Workspace       | root `package.json` `workspaces`, `bun.lock`, `turbo.json`                            | One install and lockfile for `packages/*`. Shared versions live in the root `workspaces.catalog`.                                                                                                                                                                                                                                                                |
| Native FFI      | `../crates/ui/bun` (cdylib `bun_rs`) and UI `@aphrody/bun`                            | Rust hot paths loaded through `bun:ffi`: M3 color and schemes, Sass (grass), spec validation, M3 CSS, icons, 3D rendering. The UI repository owns and consumes this library.                                                                                                                                                                                     |
| Runtime access  | `crates/compat/toolchains`                                                            | Resolve installed Bun, repository version pins and launch environment without a shell. Compat owns this crate and OS consumes it; the [Bun fork](../upstream-bun/APHRODY-FORK.md) supplies the runtime and the docs mirror, not a linked library. See [BUN-RUST-INTEGRATION.md](./BUN-RUST-INTEGRATION.md).                                                      |
| Node to Bun     | crates.io `aphrody-n2b*`, npm `@aphrody/bun-plugin-n2b`                               | Scanner, rule registry, codemods and reports. Sources and docs live in the Bun fork: see [N2B.md](./N2B.md). `aphrody n2b` links the published crates.                                                                                                                                                                                                           |
| N2B native scan | `crates/interop/ffi/src/n2b_native.rs`                                                | ABI v2 keeps the read-only `node2bun_scan_json` and adds `node2bun_scan_with_options_json` for `mode`, `ignore` and `dry_run`; callers release reports with `node2bun_string_free`. Fix and aggressive modes can write project files. Consumers bind the library through `bun:ffi`; the [Bun fork](../upstream-bun/APHRODY-FORK.md) has no `bun:aphrody` module. |
| Documentation   | `crates/compat/bun-docs` (`bun_docs` kernel subsystem, registered by `../aphrody-os`) | Offline `bun_docs_search`, `bun_docs_read`, `bun_docs_list` and `bun_node_equivalent` over `APHRODY_BUN_DOCS`, else `docs/` of the fork checkout (`APHRODY_BUN_CHECKOUT`, `C:/bun` on Windows), else a versioned download at the commit pinned in `docs/reference/upstream-bun/SOURCE.json` and the n2b registry.                                                                                                                                                                |

The repository-wide ownership and target integration plan are in [Infra's Bun platform map](../infra/APHRODY-BUN-PLATFORM.md).
The n2b crate, package, schema and CLI documentation is in the Bun fork ([N2B.md](./N2B.md)).

## Rules for the manifests in `packages/*`

1. Only the root declares `packageManager`.
2. `engines.bun` equals the root minimum derived from `packageManager`.
3. No `engines.node`.
4. A dependency listed in the root catalog uses `catalog:`. Add a new shared dependency to the
   catalog first.
5. Scripts use `bun`, `bunx`, `cargo` or direct binaries. They never use `npm`, `npx`, `pnpm`,
   `yarn` or `node`.
6. A package with a `tsconfig.json` exposes `typecheck` and extends `tsconfig.base.json`. A
   package referenced through TypeScript project references (`n2b-types`, `n2b-client`, `n2b-shims`)
   also exposes `build` (`tsc -b`), so turbo emits its declarations before dependents typecheck.
7. A `test` script that needs a native artifact builds it first:
   `@aphrody/n2b-core` builds the debug `n2b` binary. Test builds do not pass
   `--locked` (see the CI note in the root README).

## Gates

```sh
bun install --frozen-lockfile
bun run typecheck      # turbo, every @aphrody/* package
bun run lint           # oxlint (.oxlintrc.json)
bun run test           # turbo; builds the native artifacts it needs
```

## Upgrading Bun

1. Merge upstream in the fork and release it there (see [Bun in Aphrody](../upstream-bun/APHRODY-FORK.md)).
2. Set the root `packageManager`, the `mise.toml` pin and the `@types/bun` catalog entry.
3. Refresh the docs pin: `bun run docs:bun:update` (from the local fork checkout), then `bun run docs:bun:check`.
4. Run `bun install`, then the gates above and the Rust gates in the root README.

The `bun_docs` tools read `APHRODY_BUN_DOCS`, else the fork checkout, else the versioned download (`APHRODY_BUN_DOCS_FETCH=0` turns it into an explicit error). There is no index to rebuild.
