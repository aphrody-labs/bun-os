<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody AI

Agent runtime, model clients and local inference, RAG/memory, OCR/vision/voice,
training, MCP/A2A, app-server and the `aphrody` CLI.

The workstation targets one M3 desktop with Chat, Files, Web and Models. The
existing Tauri host drives a resident `aphrody app-server` over stdio JSON-RPC;
the [native UI migration](../../../m3/docs/plans/design/M3-MULTI-HOST-PLAN.md) preserves
that process boundary. Siblings never acquire a reverse dependency on AI.

<a id="sibling-repositories"></a>
<a id="build-and-test"></a>

## Start from source

Use the root [Cargo workspace](../../Cargo.toml) and
[Bun workspace](../../package.json) with their pinned toolchains.
Rust sources live under `crates/ai` and the CLI under `crates/infra/aphrody`; Python work
belongs to `../aphrody-py`. Follow the [active root plan](../../PLAN.md)
and [repository rules](../../AGENTS.md) for qualification and ownership.
Run the following commands deliberately from the repository root to build
and exercise source; installed consumers follow their artifact contracts.

```sh
cargo run -p aphrody -- --help
cargo run -p aphrody -- model list --json
cargo run -p aphrody -- app-server
```

The server requires a client handshake. A real model turn needs installed weights
or a configured provider; optional features need their declared Cargo flags.
The legacy `chat` path does not qualify the desktop runtime.

## Documentation

| Topic | Authority |
| --- | --- |
| Work remaining and release proof | [Active root plan](../../PLAN.md), [imported AI requirements](../../plans/ai/PLAN.md) |
| Processes and capability owners | [Architecture](../../architecture/ai/ARCHITECTURE.md), [source of truth](../../reference/ai/SOURCE_OF_TRUTH.md) |
| Wire subset and handshake | [App-server](../../../../crates/aphrody-app-server/README.md) |
| Setup, models and configuration | [Install](../../guides/ai/INSTALL.md), [local models](../../reference/ai/LOCAL-AI-MODELS.md), [config](../../reference/ai/config.md) |
| AI/LLM agent skills | Unified Aphrody plugin |
| All guides | [Index](./_source/README.md) |
| NHITL workflow and checks | [AGENTS.md](../../reference/ai/AGENTS.md) |

## Native consumers and release

See [FFI](./crates/aphrody-ffi/README.md) and manga for their actual contracts.

The CLI ships through GitHub Releases; this workspace uses `publish = false`.
First-party AI code is Apache-2.0. Preserve [Codex provenance](../../reference/ai/THIRD_PARTY_CODEX.md)
and independently qualify distributed dependencies, Drive/FSL sources and model
terms. Existing source and local checks do not establish an installed OSS release.

## Shared orchestration

[Infra/Workspace](../../../../packages/workspace/) owns inventories and
qualification orchestration. Use commands from the current root and owner
manifests; imported scripts and previous release checks require requalification.
