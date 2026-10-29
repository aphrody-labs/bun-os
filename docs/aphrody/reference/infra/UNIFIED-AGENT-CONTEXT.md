<!-- SPDX-License-Identifier: Apache-2.0 -->
# Unified agent context

> **Historical split-repository guide.** Its ownership examples below predate
> consolidation into the active `<repo>` monorepo and must not be
> used to choose current source paths. Start from root [`AGENTS.md`](../../AGENTS.md),
> [`PLAN.md`](../../PLAN.md), the package owner in this checkout, and the
> sibling `aphrody-py` / `iecode` rules where relevant. The root `config/`
> catalogues and current generated `docs/ecosystem/` describe this monorepo;
> historical category names are context only.

This page is the Infra entry point for cross-repository work. The workspace
superproject is the canonical source for repository ownership and dependency
boundaries: [`../../docs/ARCHITECTURE.md`](../../architecture/workspace/ARCHITECTURE.md). Follow its
links to the owning repository and read that checkout's `AGENTS.md`,
`CLAUDE.md` and `README.md` before changing files. The compact cross-agent
preferences live in `%USERPROFILE%\.agents\SHARED-AGENT-CONTEXT.md`.
The host CLI inventory and Nushell/Cargo setup are documented in the global
Codex reference at `~/.codex/CLI.md` (linked from `~/.codex/AGENTS.md`).

## Infra-owned facts

`aphrody-infra` owns host and target inventory, service and route catalogs,
deployment/release procedures, remote operations, and live infrastructure
evidence. Use its current `config/`, `inventory/`, runbooks and operational
commands for those facts. Application repositories own their business logic,
schemas and domain workflows; do not copy their registries or plans here.

Use the generated ecosystem index for discovery, then confirm capabilities in
the current source and command help:

- [`ECOSYSTEM.md`](../../ecosystem/ECOSYSTEM.md) — repositories, packages and crates.
- [`CLI.md`](../../ecosystem/CLI.md) — generated CLI tree.
- [`MCP-TOOLS.md`](../../ecosystem/MCP-TOOLS.md) — generated MCP catalog.

Regenerate these files with the Infra-owned generator; never edit generated
catalogs by hand. A catalog, checkout or passing local gate does not prove a
service is deployed or healthy.

## Cross-repository rules

- `aphrody-ai` owns agent/runtime, model, inference, RAG, AI MCP/A2A, app-server
  and the `aphrody` CLI. The category repositories are separate: OS, UI, Web,
  Compat, Contracts, Shell, Native and Infra have their own boundaries.
- The desktop is owned by `aphrody-ui`; it connects to `aphrody-ai` through
  `aphrody app-server` over stdio JSON-RPC. It does not link AI crates.
- `aphrody-os`, UI, Web, Shell, Native, Contracts and Compat do not depend on
  `aphrody-ai`. Shared contracts and relative sibling dependencies express
  supported integration.
- NIE and IECODE retain domain ownership. Do not infer a migration,
  service retirement or data/schema move from a plan or historical audit.
- Keep one document per authority. Treat dated plans and memories as leads;
  verify current source and live state with the actual owner.
- Keep credentials, cookies, `.env` values, database dumps and runtime artifacts
  out of source control and agent memory.

## Agent entry points

The workspace [`AGENTS.md`](../workspace/AGENTS.md) defines shared execution rules;
the root [`PLAN.md`](../../plans/workspace/PLAN.md) coordinates cross-repository work. Each child repo's
own agent files apply within that checkout. Authenticated YOLO/NHITL markers
remove approval prompts for reversible authorized work, not engineering gates,
secret handling, ownership boundaries or the need for observable evidence.
