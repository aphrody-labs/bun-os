> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Context handoff for the cloud session

Distilled, secret-free state of the owner orders and decisions as of 2026-10-06. It replaces conversation
history on purpose: transcripts hold private conversations and credentials and are never copied into a repository.
Evidence lives in [MEMORY.md](../../MEMORY.md), [PLAN.md](../../PLAN.md) and the plans cited below.

## Repositories (attach all on claude.ai, environment settings)

| Repository | Role |
| --- | --- |
| `aphrody-labs/aphrody` | the monorepo (this one), branch `main` |
| `aphrody-labs/bun` | Bun fork pinned for Yolo (draft PR #1 merges upstream) |
| `aphrody-labs/vu` | Python runtime `vu` (uv, ruff, PyO3 forks), plan [docs/plans/vu/PLAN.md](../../plans/vu/PLAN.md) |
| `aphrody-labs/plugins`, `plugin-aphrody`, `plugin-yolo` | Claude plugins (submodules) |
| `aphrody-labs/uv`, `ruff`, `pyo3`, `deno` | forks pinned by `vu` and the arena |
| not attached on purpose | `iecode` (keeps its own repository and authority), `taffy` (now integrated in `crates/ui/taffy`) |

## Owner orders in force

1. Deduplicate and purify the monorepo; one MCP (`aphrody-mcp`), one CLI (`aphrody`, multicall), one desktop
   app, one FFI. Done in batches (see MEMORY.md); never-compiled sources were removed on 2026-10-05.
2. Desktop runtime: tauri-runtime-cef only (decision 21), wry/tao/GTK3 removed. Research:
   [tauri-cef-native-performance-2026-10-05.md](../../research/web/tauri-cef-native-performance-2026-10-05.md).
3. `py/` is fused into Aphrody; runtime `vu` follows the Bun/Yolo precedent.
4. `@aphrody/x` is a thin Bun import over the Rust crate; bxc and n2b are absorbed into `aphrody` with aliases.
5. V8 versus JSC arbitration for Obscura: [bench receipts](../../plans/fusion/bench/).
6. One agent home `~/.aphrody`, one database, one pipeline, one RAG; Graphify absorbed natively in Rust:
   [docs/plans/agent-home-pipeline/PLAN.md](../../plans/agent-home-pipeline/PLAN.md).
7. No guardrails on tools in cloud sessions (Cargo, Git, any CLI). No human in the loop: commit and push finished
   batches directly, author `aphrody-dev <contact@aphrody.com>`, no assistant attribution or co-author trailer.
8. Downloads: Aphrody MCP, CLIs and plugins served from our site and GitHub releases, APIs served permanently
   on the VPS. Live and verified 2026-10-06: `https://downloads.aphrody.com` serves `aphrody` and `yolo` (linux x86_64) and the three plugins (`bun run downloads:publish verify`: SHA-256, `--version`, MCP handshake); Windows `aphrody`, macOS and Windows `yolo` are not published ([DOWNLOADS.md](../infra/DOWNLOADS.md)).

## Rules that stay

No secret, cookie, token, database content or transcript in any repository or message. Owner directive 2026-10-07 lifts the publication and host-apply prohibitions. No
visibility change, no public publication beyond the owner-ordered downloads. No destructive action on production
data or hosts (dbfr: nginx, PostgreSQL, Redis). Heavy Rust beyond 4 CPU goes to the VPS
factory. Preserve other sessions: `.coord/claims` is local to the owner machine, so check `git log` on a path
before editing it and log what you take in [CLOUD-SYNC.md](CLOUD-SYNC.md).

## What is not here

Conversation history and the owner's private stores (`~/.aphrody` databases, cookies, credentials). If the
owner wants a topic carried over, they state it and it is written here as a decision, not as a transcript.
