> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Identity

Aphrody is a user-space operating system developed by the aphrody-labs GitHub organization. It is built from the
private monorepo aphrody-labs/aphrody and runs on its own JavaScript runtime, aphrody-labs/bun, a fork of Bun.
Its products, by owner directive of 2026-10-06, are the runtimes (the Bun fork, `vu`, Yolo); the AI services are a
backend serving the apps, and M3 and app-ui are frameworks.

## Names and accounts

| Item | Value | Source |
| --- | --- | --- |
| Name | Aphrody | |
| GitHub organization | [aphrody-labs](https://github.com/aphrody-labs) | [GITHUB-OWNERSHIP.md](../infra/GITHUB-OWNERSHIP.md) |
| Owner account | `aphrody-dev` | [GITHUB-OWNERSHIP.md](../infra/GITHUB-OWNERSHIP.md) |
| Commit identity | `aphrody-dev <contact@aphrody.com>` | [AGENTS.md](../../AGENTS.md) |
| Web | aphrody.com (product site and runtime documentation), downloads.aphrody.com (artifacts) | `tools/config/downloads.json` |
| npm scope | `@aphrody` | package manifests |
| Container images | `ghcr.io/aphrody-labs/*` | release scripts |
| Licence | Apache-2.0 for first-party code; forks keep their upstream licence | `Cargo.toml`, [THIRD-PARTY.md](../../THIRD-PARTY.md) |

`contact@aphrody.com` has no mailbox attached ([MAIL-STACK.md](MAIL-STACK.md)).

## Visual identity

- Design system: Material Design 3, implemented in `m3/` (`@aphrody/m3*` packages) and `crates/ui/m3*`.
- Product UI seed colour: `#8c6c88`, measured on the pet sprite (`pet_seed_hex` in `crates/ui/identity/src/design.rs`);
  the M3 schemes of the apps, the OS themes and aphrody.com derive from it.
- Brand assets (icons, favicon, webmanifest, palette, animated pet sprite): `crates/ui/identity` and
  `@aphrody/identity`.

## Tone

Documentation and product text state what a component does, where its source is and what was verified, with dates
for changing facts. No superlatives, no unmeasured performance claims, no promises about unreleased work.
