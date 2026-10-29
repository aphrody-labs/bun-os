> **Legacy fork notice (2026-10-29).** This document predates the move to the unmodified upstream `bun` npm package (`1.4.4-canary.20261028.1`). The abandoned Bun fork, its fork-only commands, `bun:*` modules and `toolchains/bun` named here are history, not current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Agent tooling brief (subagents included)

Every agent, subagent included, starts from the owners below before generic shell. Checked against the
installed binaries on 2026-10-06; confirm a command with `--help` before scripting it.

Execution context (2026-10-09): develop and build on any qualified native, SSH or Docker host. Select tools, checkout, target and resource limits from the current context. The current owner workstation uses native Windows; its WSL workflow is retired. See [execution context](workspace/windows-native.md). Load the configured Aphrody/Yolo plugins and canonical `aphrody-mcp`.

## 1. Load the context first

- Skills: `yolo:yolo` (execution), `yolo:bun-doctrine` (Bun), `yolo:code-intel` (navigation),
  `yolo:rust-target-check` (Rust gates), `aphrody:ecosystem` (what already exists),
  `aphrody:optimize-workspace` (dedup/migration), `aphrody:deploy` (hosts), `aphrody:upstreams` (upstream code
  without cloning), `yolo:docs` (versioned docs).
- MCP: load the Aphrody tools with `ToolSearch` (`select:mcp__plugin_aphrody_aphrody__<tool>`), for example
  `yolo_scan`, `yolo_parse`, `yolo_verify`, `yolo_n2b_scan`, `yolo_vector_search`, `docs_auto_search`,
  `bun_docs_search`, `upstream_search`/`upstream_read`, `infra_exec`, `infra_git_status`, `nu_eval`,
  `coord_read_status`/`coord_report_status`.
- Code graph: `graphify query "<question>"`, `graphify explain "<node>"`, `graphify path "A" "B"` before broad
  `rg` sweeps (`graphify-out/graph.json` exists at the repository root). The native owner `aphrody graph
  query|explain|path` and the agent home search `aphrody home query` (MCP `aphrody_home_query`) take over as the
  parity of the agent-home pipeline plan lands.

## 2. Command owners

| Need | Owner |
| :-- | :-- |
| What exists (crate, command, MCP tool) | skill `aphrody:ecosystem`, `aphrody scan manifests`, `yolo scan --json` |
| Search, replace, rename across files | `yolo workspace code-edit search\|replace\|rename` (`--engine ast --lang rust\|ts`), `yolo rename` |
| AST and tokens of one file | `yolo parse <file> --json` |
| Bun type check | `bun check <paths>` (or `bun check -p <tsconfig>` for one package) |
| Bun lint | `bun lint <paths>` |
| Bun format | `bun fmt --check <paths>` / `bun fmt <paths>` |
| Bun tests | `bun test <paths>` |
| Declared quality stages | `aphrody infra quality <stage> --repo aphrody --run`, `aphrody infra pipeline`, `aphrody infra workflow <stage>` |
| Cargo on the selected context | Native scoped gates, qualified Docker or `bun scripts/build/rust/vps-cargo.ts run -- <cargo args>` for an allocated SSH factory; preserve locks and sccache |
| Cargo in a cloud session | `scripts/build/rust/cargo-serial.sh <cargo args>` |
| Hosts, services, probes | `aphrody infra ssh exec\|status\|logs`, `aphrody infra service`, `aphrody infra probe`, `yolo host … --host vps\|dbfr` |
| Factory build of pushed main | `yolo ship` |
| Docs | `yolo docs <query>` (Bun), `aphrody docs search`, MCP `docs_auto_search` |
| Git and GitHub | `aphrody git inspect\|api\|repo\|search`, `aphrody infra git` |
| Web fetch and crawl | `aphrody web`, MCP `universal_web_fetch` |
| Memory, RAG, models | `aphrody memory`, `aphrody model`, skills `aphrody:aphrody-rag`, `aphrody:aphrody-train` |
| Coordination | `.coord/claims`, MCP `coord_*`, `aphrody a2a` |
| Discord (post, file, status) | `aphrody discord send <channel> -m <text> [-f <file>]`, `aphrody discord status`; on the vps `sudo -n ~/.local/bin/aphrody discord … --env-file /etc/aphrody-discord.env` (token never read by the agent) |
| WireGuard tunnel wg1 | `aphrody infra wg plan\|up\|down\|show\|render\|syncconf\|keygen\|pubkey\|driver` (`--root <repo>` for the inventory) |
| Remote desktop, remote computer use | `aphrody infra remote serve\|open\|status`, MCP HTTP `aphrody mcp-server http` (bearer), `RemoteComputerBackend` |
| Windows control (services, tasks, power, registry, network, windows, screen) | `aphrody winclean`, `aphrody os`, MCP `list_services`, `list_scheduled_tasks`, `get_network_adapters`, `list_listening_ports`, `computer_observe` + one `computer_*` action |
| WSL | MCP `wsl_list_distributions`, `wsl_execute`, `aphrody wsl` |
| Shell session | `aphrody shell status\|start\|eval\|serve` |
| Library choice | `aphrody git search <query>`, `aphrody awesome`, crates.io API (licence, downloads, last release) |

## 3. Habits

- Start each task by loading the matching skill (`Skill` tool) and the MCP tools it needs (`ToolSearch`), then the
  owner CLI with `--help`. Generic shell, ad hoc Python or `curl` only for a gap no owner covers, and say so in the
  report (a gap is a bug to file against the owner).
- GitHub: `aphrody git` reads the `gh` login (hosts file or keyring); set `APHRODY_GITHUB_USER=aphrody-dev`.
  `aphrody-code` is the owner's former account: never use it.
- Hosts: `aphrody infra ssh exec --host vps|dbfr '<cmd>'` (or MCP `infra_exec`); `APHRODY_SSH_COMMAND_TIMEOUT_SECS`
  raises the 30 s default for long commands. Plain `ssh vps` only for interactive or streamed transfers.

- Batch reads with `bun -e` / `Bun.Glob` or `nu_eval`; avoid chains of `cd`, `sed -n` and `cat`.
- Wait for a long command with a single blocking call (or a background run with notification), not `until`/`sleep`
  polling loops.
- Report gates with the owner's evidence (`--json`) and name skipped checks.

## 4. Fast edit loop

- `APHRODY_CARGO_INCREMENTAL=1 scripts/build/rust/cargo-serial.sh check -p <crate>` unsets `CARGO_INCREMENTAL`
  instead of forcing 0. sccache refuses only the environment variable. The dev profile stays incremental for
  workspace members, and sccache still caches dependencies. Factories and CI keep the default (0). Measured on vps
  with `aphrody-identity`, one-line edit then `check`: median 3.23 s down to 2.40 s. Measured on PC with `bun_core`:
  median 2.44 s down to 1.24 s.
- Local `git config core.fsmonitor true` and `core.untrackedCache true` cut `git status` from 66.5 to 40.0 ms
  (bun) and from 50.2 to 32.0 ms (aphrody).
- Rejected: `-Zthreads=8` (1.24 to 1.82 s), `rust-lld` for `test --no-run` (no measurable gain), and mold or tmpfs
  for `check` (it does not link, and the vps has 45 GiB of RAM with swap in use). Defender, the power plan and
  indexing are already neutral. No Dev Drive exists.
- Remaining (2026-10-09):
  - On the PC, remove `incremental = false` from `~/.cargo/config.toml` and remove `CARGO_INCREMENTAL` from the
    user environment, after re-measuring aphrody `check`, `test --no-run` and `clippy` with
    `CARGO_BUILD_INCREMENTAL=true`.
  - Give rust-analyzer flycheck its own target directory (`initializationOptions`
    `{"cargo":{"targetDir":true},"check":{"workspace":false}}` in the aphrody plugin's `lspServers`). Its
    `cargo check --workspace` holds the build lock and stalls agent commands for 30 to 66 s.
  - Use Bun-native `bun check`; do not invoke external TypeScript compilers as quality gates.
