> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Contributing

The distribution repository (aphrody-labs/aphrody) is private: changes come from members of the
[aphrody-labs](https://github.com/aphrody-labs) organization. The runtime
([aphrody-labs/bun](https://github.com/aphrody-labs/bun)) and the component forks are public GitHub repositories;
issues are disabled on aphrody-labs/bun. Security reports follow [SECURITY.md](SECURITY.md).

## Where code goes

| Kind | Location |
| --- | --- |
| Rust crates | `crates/<domain>/<crate>`; the general CLI is `crates/infra/aphrody` |
| Bun packages | `packages/<domain>/<package>` |
| UI | `m3/packages/app-ui` and `crates/ui/*` |
| Python application code | `py/` |
| Bun runtime changes (runtime, built-ins, types, bundler, package manager) | aphrody-labs/bun, as a commit with its test, never as a patch or copy in this repository |
| Documentation | `docs/<category>/<domain>` |
| Scripts | `scripts/{audit,build,dev,migration,release,tools}` |
| Host, build and release declarations | `tools/config/` |

The working rules are in [AGENTS.md](AGENTS.md); the architecture and open queue in [PLAN.md](PLAN.md).

## Before a commit

- Bun and TypeScript: `bun run typecheck`, `bun run lint`, `bun run format:check` and the tests of the touched
  packages (`bun test <path>`).
- Rust: scoped `cargo check`, `cargo test` and `cargo clippy` on the touched crates
  (`scripts/build/rust/cargo-serial.sh`).
- Generated files (`README.md`, `PLAN.md`, `MEMORY.md`, `docs/README.md`) are edited through their source
  (`tools/config/docs/root.json`) and regenerated with `bun run docs:gen`.

## Commits

- Conventional Commits (`type(scope): summary`), author `aphrody-dev <contact@aphrody.com>`, no co-author trailer.
- Commit only your own finished batch. Parallel sessions declare their paths in `.coord/claims/` and do not stage
  each other's work.
- Never commit secrets, credentials, private data, database contents, model weights or build output.

## Licences and upstream code

First-party code is Apache-2.0, with some crates `Apache-2.0 OR MIT`; each crate's `license` field and SPDX header
is authoritative. Integrated upstream code keeps its licence and notices, and its provenance is recorded in
`tools/config/upstream-sources.json`; the list of third-party licences is [THIRD-PARTY.md](THIRD-PARTY.md).
New dependencies follow the selection guidance in [AGENTS.md](AGENTS.md#sources-and-dependencies).
