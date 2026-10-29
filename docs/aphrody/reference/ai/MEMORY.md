# Memory archive — aphrody AI layer (Claude Code)

> **Archive, not active runtime context.** Snapshot notes below are retained as
> historical evidence; paths, commands, versions and service states may be stale.
> Current authorities: [workspace rules](../workspace/AGENTS.md), [Infra
> authority map](../infra/UNIFIED-AGENT-CONTEXT.md), [Infra CLI and operations
> README](../../products/infra/README.md), [Infra plan](../../plans/infra/PLAN.md),
> [generated MCP catalog](../../ecosystem/MCP-TOOLS.md), and the current
> source under `crates/infra/`, root `config/` and `inventory/`. Confirm current
> command help and live host state before acting. Nothing below asserts a live
> runtime or currently configured agent environment.

Archived snapshot: **2026-09-25**. Historical project path: `~/src/aphrody-ai` (Linux) / `%USERPROFILE%\src\aphrody-ai` (Windows).

## Historical deployment notes (not live status)

- At snapshot time, deployment was recorded as owned by the separate `aphrody-infra` repository and the VPS service mix was recorded at that time. The repo boundary and production state must be checked against current Infra sources and live probes.

## Agent home (`~/.aphrody`)

- La mémoire curatée et la politique agent-home sous `~/.aphrody/workspace/` sont des fichiers d'exécution locaux, absents de ce checkout.
- Doc repo: `docs/dot-aphrody/README.md` (not in repo)

## Build rules (Linux & Windows)

- `export RUSTC_WRAPPER=` / `$env:RUSTC_WRAPPER=''` (sccache absent → build fail)
- Release bins: `target/release/{aphrody,aphrody-mcp}`
- **One** `cargo build --release` at a time (LTO)
- Install: `scripts/release/deploy.sh` or `install -m 755` (not `cp` while binary running)

## MCP

- Shared: `~/.config/aphrody/mcp.json` — `aphrody-mcp`, `bxc-mcp`; secrets in `~/.aphrody/.env`, not JSON
- Claude uses aphrody plugin + same binaries
- Dragon Ball tools are `dragonball.*` in `aphrody-mcp` (feature `dragonball`, default)

## Tooling / Bun & Python

- Shared baseline: Bun `1.4.2`, uv `0.12.17`, Rust nightly.
- Agent stack is Node-free; uv manages Python virtualenvs (`py/aphrody`).

## Cross-repo contracts (aphrody = AI layer)

- Architecture: `aphrody-ai` owns AI, agents, inference, RAG and models.
- System & Web: `aphrody-os` owns OS kernel, browser/BXC, GUI, Canvas and Tauri.
- Infra & Deploy: `aphrody-infra` owns targets, systemd services, releases and Nginx routes.
- `docs/reference/ai/rag-unified-pattern.md` — shared e5-small sidecar + RRF retrieval

## A2A (Rust)

- `aphrody a2a serve|tick|invoke`
- Manifest: `ai.json` · coord: `.coord/*.jsonl`

## Archived service snapshot (2026-06-04; not current health evidence)

| Unit | Port | Note |
| --- | --- | --- |
| `aphrody.service` | 8082 | Python `/opt/aphrody` — **not** Rust CLI |
| `aphrody app-server` | 8765 | Codex-compatible JSON-RPC & loopback HTTP (stdio/HTTP) |
| `aphrody gateway` | 8795 | OpenAI-compatible HTTP AI Gateway (SSE token streaming + models) |
| `aphrody-site` | 8083 | Single public origin, unbuffered proxy to :8765 and :8795 |
| `bxc.service` | 9222 | CDP (execs bxc standalone — restart after a `bxc` rebuild) |
| `bxc-crawler.service` | — | 24/7 worker |

Re-enable: `sudo systemctl enable --now bxc.service bxc-crawler.service aphrody.service`
Stop to free RAM: `sudo systemctl disable --now bxc-crawler.service bxc.service aphrody.service`

## Credentials

- Diagnostic local : `aphrody doctor`. Smoke xAI/Grok/BXC sans chat par défaut :
  `bash scripts/test-xai-grok-bxc.sh`. Tout chat potentiellement
  facturable exige `RUN_PAID_XAI_SMOKE=1`.
- Never commit `~/.aphrody/.env`, `~/.aphrody/x-session.json`, cookie jars
## Feedback (working style)

- [No questions, direct action](./memory/feedback-no-questions-direct-action.md) — execute, never ask for confirmation (user emphatic 2026-06-04)
- [No reflexive loops](./memory/feedback-no-reflexive-loops.md) — don't mechanically repeat bxc/workflow calls; think if the action is even needed (user said "infinite loop, pause et réfléchi" 2026-06-04)
