# Codex in Bun OS

Bun OS runs OpenAI Codex (Apache-2.0) three ways: the **real Codex binary** (CLI, app-server, `codex exec` workers), the
**Codex Luna sub-agents** that automation delegates to, and the **Aphrody crates** that re-implement parts of the Codex
protocol natively. The fork `aphrody-labs/codex` (upstream `openai/codex`, branch `main`) is pinned as the submodule
`vendor/codex`; its `LICENSE` and `NOTICE` stay in the tree.

## What runs on the VPS

| Piece | Where | Notes |
| --- | --- | --- |
| Codex binary | `~/.codex/packages/standalone/current/bin/codex` | login (ChatGPT) and `~/.codex/config.toml` are shared by every consumer: model `gpt-6-luna`, `model_reasoning_effort = "medium"` |
| App-server | `aphrody-codex-app-server.service` | `codex app-server --listen ws://127.0.0.1:4500`, loopback, `build.slice` (CPUWeight 20, nice 10), `Restart=always`; probes `/readyz`, `/healthz` |
| Sub-agent dispatcher | `aphrody-codex-agent.service` | `factory/codex-agent/dispatch.ts`, see [AUTOMATION.md](AUTOMATION.md#codex-luna-sub-agents) |
| `aphrody codex exec/resume/fork` | `crates/aphrody-command/src/codex_cmd.rs` | dispatch to the real binary (`CODEX_BIN`, then `$CODEX_HOME/packages/standalone/current/bin/codex`, then PATH; never itself) |
| `aphrody codex agent …` | same file | runs the dispatcher on Bun |
| `aphrody codex doctor` | same file | reads `~/.codex/config.toml`, probes binary version, login and the app-server |
| `aphrody a2a invoke codex` | `crates/aphrody-a2a-coord/src/peer.rs` | `codex exec --dangerously-bypass-approvals-and-sandbox --json -C <cwd>`; `CODEX_BIN` set in `aphrody-a2a.service` |

`aphrody codex app-server --http …` is the separate native Aphrody app-server (`aphrody-app-server`); the Codex one on
:4500 is the real upstream server.

## Crate map: Aphrody crate to upstream `codex-rs` crate

Status values: **reimplemented** (own code, Codex-shaped types, checked against upstream), **inspired** (same idea,
different design), **reusable** (the upstream crate could replace ours with a Cargo `[patch]`/path pin once the
toolchain gap is closed), **native** (no upstream owner).

| Aphrody crate | Upstream (`vendor/codex/codex-rs/…`) | Status |
| --- | --- | --- |
| `aphrody-app-server` | `app-server`, `app-server-transport` | reimplemented: Codex-shaped subset (threads, turns, streaming lifecycle) driving `aphrody-agent-runtime`; the real server runs in the service above |
| `aphrody-app-protocol` | `app-server-protocol` | reimplemented, wasm32-safe v2 JSON-RPC types; reusable for the Tier-1 pairs when `codex-app-server-protocol` builds for wasm32 |
| `aphrody-agent-proto` | `protocol` (Submission/Event queues, `Op`, `EventMsg`) | inspired subset, NDJSON, wasm |
| `aphrody-guard` | `process-hardening`, `shell-command` | inspired (pre-main hardening and safe-command classification) |
| `aphrody-engine` | `core` (turn loop), `thread-manager-sample` | inspired: unified turn loop over `ModelClient` streams mapped to SQ/EQ events |
| `aphrody-config` | `config`, `config-schema`, `model-provider-info` | reimplemented shape of `ConfigToml`; reads `~/.codex/config.toml` through `load_codex_compat_layer` |
| `aphrody-patch` | `apply-patch` | inspired: same `*** Begin Patch` format; reusable: `codex-apply-patch` |
| `aphrody-rollout` | `rollout`, `rollout-trace` | reimplemented JSONL recorder, `SessionMeta` fields mirrored |
| `aphrody-session` | `state`, `thread-store`, `message-history` | native tracker; imports Codex, Claude and Antigravity session logs |
| `aphrody-toolcall`, `aphrody-toolcall-repair` | `tools` | reimplemented schema model (`ToolDefinition`, executor trait); repair is native |
| `aphrody-train` | none | native (P10 of `docs/plans/codex-oss.md`) |
| (not yet in Aphrody) | `execpolicy`, `linux-sandbox`, `bwrap`, `codex-mcp`, `rmcp-client`, `exec`, `exec-server`, `sandboxing`, `skills`, `hooks` | reusable directly through the real binary today |

Upstream crates that Aphrody should consume rather than copy, in order: `codex-apply-patch`, `codex-process-hardening`,
`codex-execpolicy`, `codex-app-server-protocol`, `codex-linux-sandbox`. The blockers are the toolchain (the fork pins
Rust 1.95.0; the root workspace uses its own nightly) and the nested Cargo workspace of the fork, so each swap is a
separate batch behind `cargo check` on the VPS lane wrapper. Until then `aphrody codex exec` and the dispatcher use the real
binary, which carries all of them.

## Fork and binary

- `vendor/codex` is a pinned gitlink; `factory/rustbase/forks.json` lists it (`codex`, ref `main`) so the daily fork
  refresh in [AUTOMATION.md](AUTOMATION.md) merges `openai/codex` into the fork and bumps the pin (a merge, never a force push).
- Build on the VPS only, through the serialized wrapper:
  `RUSTUP_TOOLCHAIN=1.95.0 APHRODY_BUILD_HOST=vps APHRODY_CARGO_JOBS=4 APHRODY_CARGO_TARGET_DIR=~/build/target/codex bash scripts/aphrody/build/rust/cargo-serial.sh build --release --manifest-path vendor/codex/codex-rs/Cargo.toml -p codex-cli --bin codex`
  (log: `~/build/logs/codex-fork-build.log`). The standalone binary under `~/.codex` stays the one in use until the fork
  build is qualified (`codex --version`, `aphrody codex doctor`, one `agent run`); then point `CODEX_BIN` at it in
  `aphrody-codex-agent.service` and `aphrody-a2a.service`.
