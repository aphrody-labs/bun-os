> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Binary analysis consumes the Bun fork

The owner's 2026-10-09 layer directive assigns generic native binary analysis
to the Bun fork. Aphrody's product CLI, MCP, WinClean and WebOS WASM consumers
retain the `aphrody-re` dependency name and `aphrody_re::` imports, but resolve
the `bun-re` package from `aphrody-labs/bun` at
`e4d57537cf3475e443eba9bda390366aa5d9d0a4`.

The receiver absorbed the original source from Aphrody
`5e55f4615a7d8ed5592839fc60e81067d0813a6a` into `packages/bun-re` (not in repo), an independent
Rust workspace with its Apache-2.0 licence. Its native implementation stays
outside the Bun executable. No Bun engine build or runtime activation is needed
for this Rust dependency change. The Git revision, rather than a workstation
path, determines the source on every qualified build host.

## Evidence

- The receiver revision exists on the configured Bun checkout's `origin/main`.
- Source review found the same public Rust interfaces and feature names;
  changes include crate-name references and equivalent LevelDB option struct
  initialization required by strict Clippy.
- Native Windows `scripts/dev/windows-cargo.ps1 check -p aphrody-command
-p aphrody-mcp -p aphrody-winclean -p aphrody-webos-wasm --locked` passed.
- Native Windows `scripts/dev/windows-cargo.ps1 test -p aphrody-webos-wasm
--lib --locked` passed all three tests, including string extraction through
  the fork dependency. The shell web library emitted a linker-message warning.
- Cargo generated the lock change: the four consumer dependencies now resolve
  `bun-re` at the full revision; unrelated dependency versions were preserved.

- Native Windows strict Clippy for the same four crates with
  `--all-targets --locked -- -D warnings` passed. An initial attempt stopped
  on concurrent SDK manifest/lock changes; the SDK owner completed that
  prerequisite before the successful invocation.
- All 15 original files matched the transfer manifest's SHA-256 and size;
  `git status --porcelain -- crates/os/kernel/comps/re` was empty before
  retirement. They were then removed, leaving the fork as the implementation
  owner. Git preserves the original source revision and history.

## Limits

Post-retirement strict all-target Clippy passed for the four consumers on the
regenerated lockfile. Cargo pruned the original package and seven orphaned
dependencies without upgrading dependency versions. The receiver reports Linux
tests and Windows/WASM checks in the coordination receipt; they were not rerun
by this batch. Physical CLI and MCP activation, optional Magika model execution
and runtime performance measurements are not proved by the dependency check.

A later attempt to repeat the WebOS tests stopped before compilation while the
concurrent native product-site owner introduced a new workspace member and had
not yet regenerated its lock entry. The earlier three passing tests and the
post-retirement Clippy invocation cover this migration; the site owner must
qualify its own completed batch.

The shared manifest/lock integration also includes the SDK owner's reviewed
`yolo-core` pin at Bun `6181424bc2fca4349560832161c07ba85c33e8ef` and its two
consumer manifest changes in `crates/infra/yolo` and `crates/ui/app`. The SDK
owner reports a native `aphrody-yolo` check and nine passing library tests.
This batch's Clippy invocation also checked that native consumer. The legacy
runtime and desktop engine are retained; no full desktop qualification is
claimed.
