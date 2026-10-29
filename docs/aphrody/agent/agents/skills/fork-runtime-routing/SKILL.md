---
name: fork-runtime-routing
description: Unblock Aphrody Bun fork, Windows native APIs and release work using installed Codex skills, canonical MCP tools and exact runtime qualification. Use when a fork pin, installed binary, container image or npm publication differs.
---

> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# Native fork and Codex routing

Read repository AGENTS.md, START-HERE.md, GOAL.md and PLAN.md. Preserve concurrent
claims and protected provider stores. Load `aphrody:bun-doctrine`,
`aphrody:bun-upstream` and `aphrody:mcp-integration` from the enabled Aphrody plugin.
Do not start WSL or modify another session's dirty Bun checkout.

## Prove the selected runtime

Run `bun --version` and `bun --revision`, resolve the binary with native
`Get-Command bun`, and compare the **complete** version against package.json's
packageManager (remove only its `bun@` prefix). Fork suffixes such as
`-aphrody.3` and `-aphrody.4` differ. Older runtime resolver binaries normalized
suffixes; the qualified canonical MCP now preserves exact fork pins. Still read
the full version and pin together: `aphrody update tools bun` may report only the
numeric version and does not prove exact fork parity.

The repository owns a checksum-verified native installer in
`scripts/tools/bun-hygiene.ts` (`install(tag, binDir, log)`). Inspect it before
applying an authorized exact update. Verify the official fork release and its
Windows asset plus SHA256SUMS.txt; never replace the fork with upstream Bun.
The installer preserves running processes by renaming the old executable and
relinks owned aliases. Existing running publishers keep their original runtime;
do not restart them merely because the PATH version changed.

## Use the actual connected MCP

`Codex plugin list` must show the configured Aphrody plugin enabled.
`Codex mcp list` must report `plugin:aphrody:aphrody` connected to
`aphrody-mcp.exe`. There is one canonical local server; do not add yolo,
aphrody-kernel or a second local server.

For Bun signatures, call the plugin's `bun_docs_search`, `bun_docs_read` and
`bun_node_equivalent` tools. For hosts, use `infra_exec` and its advertised
schema, or `aphrody infra ssh exec --host vps|dbfr` after current help. Plan
before host apply. A missing tool in the current agent is a coverage gap, not
proof that Codex's connected server lacks it. Inspect tools/list and use the
capability-owner CLI when necessary. `aphrody mcp list --config <configured
Aphrody plugin>/.mcp.json` probes that same server without changing registration.

## Separate release dependencies

Repository docs and fork source do not prove an installed API. Probe optional
modules with a bounded native command, for example:
`bun -e 'try { await import("bun:windows"); console.log("available") } catch(e) { console.error(e.message); process.exit(1) }'`.
Keep the existing owner implementation until the selected published binary
actually exposes the required behavior. An unpublished icon package is not a
reason to add a dependency that no consumer uses.

A GitHub binary release does not prove a GHCR container tag. Keep qualified
container pins until their actual registry manifest exists. npm publication and
version commits belong to the active publisher; inspect its live process/job
and exact registry versions, and preserve its manifests and dirty work.

Report installed, callable, built, published and deployed evidence separately.
