<!-- SPDX-License-Identifier: Apache-2.0 -->

# `scripts/` — repo automation inventory

Quick reference for scripts in this monorepo. This file began as an inventory
of the former split `aphrody-ai` checkout; each entry below should be treated
as current only when its path exists in this checkout. Cross-platform parity
follows root `AGENTS.md` and the workspace plans.

`scripts/release/deploy.sh` is the current compatibility entry point for installing
Rust workspace binaries. It delegates to
[`scripts/tools/ai/scripts/deploy.sh`](../../../../../scripts/aphrody/tools/ai/scripts/deploy.sh),
which builds with `scripts/build/rust/cargo-serial.sh`, requires `HEAD` to
match a clean `main` on the selected Git remote, then copies selected binaries
to `~/.local/bin`. Pass `--remote <name>` to choose explicitly; otherwise the
script uses `origin` when configured and falls back to `workspace` (the remote
in this checkout). Review `--help` and `--dry-run` before use; provenance is
fetched even in dry-run mode. This is local binary installation, not host/VPS
deploy.
Host deployment belongs to `crates/infra` and `packages/infra/workspace`.

## Build & deployment helpers

| Script | Platform | Purpose |
|---|---|---|
| [`scripts/release/deploy.sh`](../../../../../scripts/aphrody/tools/ai/scripts/deploy.sh) | Linux bash | Stable entry point for clean selected-remote `main` local binary installation; delegates to `scripts/tools/ai/scripts/deploy.sh`. |
| `run-qwen3-moe.sh` | Linux bash | Run local Qwen3 MoE inference with optional speculative decoding. |

## Benchmarks & Diagnostics

| Script | Purpose |
|---|---|
| `bun run runtime:check` | Central `yolo ops` gate for Bun and uv/Python runtime surfaces. |
| `bun run docs:check-links` | Central `yolo ops` gate checking relative Markdown documentation links. |
| `scan-repo.sh` | Shell scanner for repository tree, file sizes and manifests. |
| `gh-repo-intelligence.ts` | GitHub repository intelligence metadata extraction. |
| `github-account-audit.ts` | GitHub user/organization audit and repository discovery. |

## Ingestion, Databooks & OCR

| Script | Purpose |
|---|---|
| `databooks-autopilot.sh` | Autopilot pipeline runner for databook ingestion passes. |
| `databooks-ppocr-pass.sh` | PP-OCR pass for high-throughput character and block recognition. |
| `databooks-transcribe-all.sh` | Full batch runner for transcription across corpus targets. |
| `databooks-transcribe.ts` | Bun transcription worker with JSON audit logging. |
| `translate-jp-fr.ts` | Japanese-to-French translation and glossary alignment helper. |
| `merge_data.py` | Dataset merging and deduplication utility. |
| `download_gdrive.py` | Google Drive dataset download and verification helper. |

## Agent Sync & Cookies

| Script | Purpose |
|---|---|
| `../py/aphrody/scripts/autopilot.sh` | Legacy Linux PLAN-marker loop for Claude execution and Gemini review. |
| `sync-agent-home.ts` | Synchronize agent-home workspace rules and soul configuration. |
| `sync-agent-plugins.ts` | Sync plugin definitions and tool manifests across agent runtimes. |
| `build-grok-cookie-jar.py` | Convert exported session cookies to `~/.aphrody/cookies/grok.json`. |
| `test-xai-grok-bxc.sh` | Validation suite for xAI Grok and BXC web extraction. |
| *(host infra / VPS)* | VPS scrapers and network proxies live in `scripts/tools/infra/`; systemd templates live in the root `tools/config/host/systemd/` tree. |

The canonical ecosystem discovery is generated in [`docs/ecosystem/`](../../../ecosystem/)
from the active roots; check it with `bun scripts/tools/workspace/ecosystem.ts --check` and
regenerate it with `bun scripts/tools/workspace/ecosystem.ts`. The former `ecosystem:check`,
`ecosystem:sync`, `APHRODY_*_ROOT` and sibling-package instructions described a
split checkout layout and are not current monorepo commands.
