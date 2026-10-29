> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody Bun platform

Current source ownership, checked on 2026-10-02. The root
[Cargo workspace](../../Cargo.toml) and [Bun workspace](../../package.json)
own first-party dependencies. Retired split repositories are not build inputs.
The [ecosystem catalogue](../../ecosystem/ECOSYSTEM.md) is the generated inventory.

## Owners

| Capability           | Source owner                                                                                                                                 | Boundary                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun runtime fork     | [aphrody-labs/bun](../upstream-bun/APHRODY-FORK.md)                                                                                          | JavaScriptCore runtime, bundler, package manager and tests; every Bun change lands there. Releases `aphrody-v*`, npm `@aphrody/bun-runtime`. |
| Toolchain discovery  | [aphrody-toolchains](../../../../crates/aphrody-toolchains/)                                                                                     | Installed executable discovery and version pins.                                                                                             |
| Node-to-Bun analysis | [n2b in the Bun fork](../compat/N2B.md) (`aphrody-labs/bun/packages/bun-n2b`, crates `aphrody-n2b*`)                                         | Static analysis, migration rules and reports; source analysis does not execute remote JavaScript.                                            |
| Bun N2B consumers    | [`@aphrody/bun-plugin-n2b`](../compat/N2B.md)                                                                                                | Bun plugin, CLI (`bunx @aphrody/bun-plugin-n2b`) and report types, published from the fork.                                                  |
| N2B native ABI       | [aphrody-n2b-native](../../../../crates/aphrody-ffi/src/n2b_native.rs)                                                                          | Versioned C ABI with owned-string release.                                                                                                   |
| Oxc tools            | [Oxc bridge in the Bun fork](../compat/N2B.md) (`aphrody-labs/bun/packages/bun-oxc`, crate `aphrody-oxc-bridge`)                             | Parser, formatter, linter and minifier dependencies; inspect the actual pinned revisions.                                                    |
| Offline Bun docs     | [aphrody-bun-docs](../../../../crates/aphrody-bun-docs/), [Bun reference](../upstream-bun/APHRODY-FORK.md)                                                      | Version-matched documentation and Node compatibility lookup.                                                                                 |
| Runtime C ABI        | [aphrody-ffi](../../../../crates/aphrody-ffi/)                                                                                                  | In-process native calls through an explicit versioned ABI.                                                                                   |
| Web acquisition      | [aphrody-web-crawl](../../../crates/web/web-crawl/), [web service](../../../crates/web/web-service/), [CLI](../../../crates/web/web-engine/) | One native crawl frontier and shared browser/network owners.                                                                                 |
| Bun web consumers    | [WebService](../../../packages/web/agent-browser/src/service.ts)                                                                             | Thin bindings; no independent fetch fallback, frontier or scraper engine.                                                                    |
| RG game packages     | [Pinned IECODE contract](https://github.com/aphrody-labs/iecode/blob/main/docs/rg/decisions/ievr-packages-from-iecode.md)                    | Producer-owned private archives; no copied game package or external Bun workspace member.                                                    |

## Runtime evidence

The Bun runtime is the [aphrody-labs/bun fork](../upstream-bun/APHRODY-FORK.md), released as
`aphrody-v*` binaries and `@aphrody/bun-runtime`. It has no `bun:aphrody` module: Aphrody native
libraries load through `bun:ffi`.

The module binds separately built Aphrody, N2B and Oxc dynamic libraries through
`bun:ffi`. It does not establish static linkage, replacement of Bun's parser,
minifier or test runner, or a cross-platform release. Revalidate exact library
and runtime revisions before making those claims.

## Single web owner

Only `aphrody-web*` owns crawling and scraping infrastructure. RG, Shenron and
IECODE retain domain parsing, indexing and caller configuration behind thin
bindings. Retired BXC or split-repository implementations must not be kept as
fallback engines. Preserve rendered-page acquisition and bounded-response
behavior when migrating a consumer; a static crawl is not rendered-page parity.

## Validation and delivery

Use root workspace commands and the owning package's scoped checks. Native
Cargo commands are serialized through `scripts/build/rust/cargo-serial.sh`.
The WSL build family remains parked until Aphrody deployment, following the
[Infra handoff](../../plans/infra/sql-convergence-handoff.md).

Private source archives and manifests carry revisions and SHA-256 evidence.
A successful install, static typecheck or narrow test does not establish live
service behavior or deployment. Repositories and packages remain private;
no registry publication is authorized.
