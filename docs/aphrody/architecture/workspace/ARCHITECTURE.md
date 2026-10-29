> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Workspace architecture

This is the active Rust + Bun monorepo at `<repo>`.
The root [plan](../../../../PLAN.md) defines qualification order and remaining
acceptance gates. [Repository rules](../../../../AGENTS.md) define placement,
ownership and migration safety. Source presence does not establish runtime,
packaging or deployment readiness.

The previous superproject architecture is retained as an unmodified
historical snapshot.
Its sibling-checkout paths and deployment statements describe the earlier
layout; they are not current checkout instructions.

## Active roots and workspaces

Bun OS is one product, including its runtime, AI, UI, Infra, Workspace and
imported application domains. These capability names do not reserve separate
products or exclude Shenron from integration. Canonical members belong to the
root `crates/`, `packages/` and `apps/` graph; imported histories, licenses and
service-specific contracts remain with their actual source owners until their
migration is qualified. Host and production permissions remain explicit and
host-specific. Product unification does not establish a completed physical
migration, an installed artifact or an activated deployment.

The root [Cargo manifest](../../../../Cargo.toml) and
[Bun manifest](../../../../package.json) define active members. Explicit exclusions
and nested manifests are not qualified workspace members merely because they
exist on disk. Upstream forks retain pinned revisions and their own workspace
history under `upstream/`.

## Capability owners

| Owner | Source and responsibility |
| --- | --- |
| Runtime source | [Bun source](../../../../toolchains/bun): managed runtime history; source presence does not establish completion of root Cargo migration |
| Interop | [Rust FFI](../../../../crates/aphrody-ffi), [Bun native adapter](../../../../packages/aphrody-bun): shared library boundary |
| CLI | [Command owner](../../../../crates/aphrody-command): argument handling and invocation of capability owners |
| Infra and Workspace | [Workspace implementation](../../../../packages/bun-workspace), [root Infra configuration](../../../../infra/config): inventories, orchestration and operations within Bun OS |
| UI | [M3](../../../../packages/m3), [App UI](../../../../packages/app-ui): canonical flat source owners, not a sibling product |
| RG contracts | [Auth](https://github.com/aphrody-labs/rosegriffon/tree/main/packages/rg-auth), [DB](https://github.com/aphrody-labs/rosegriffon/tree/main/packages/rg-db): owned by the separate Rose Griffon workspace |
| Shenron contracts | [Auth](../../../../packages/shenron-auth), [DB](../../../../packages/shenron-db), [Admin UI](../../../../packages/admin-ui): restored owners; missing host adapters and production qualification remain explicit |

This is a verified source navigation subset, not an exhaustive qualification
matrix. The root manifests and source inventory resolve all other capability
owners, including AI and Web. Legacy nested paths and sibling checkouts in
dated reports do not define current product boundaries.

New Rust package placement follows the
[crate naming rules](../rust-crate-naming.md). Existing public crate/package
names, APIs, CLI arguments and schemas remain compatibility contracts when
folders move. Reusable behavior belongs to one library owner; application
entry points retain configuration and startup.

## Boundaries to qualify

Contracts must remain pure; operational networking, process and timeout behavior
belongs to operational owners. Protocol contracts define vocabulary, while
implemented handlers and recorded scenarios establish
supported behavior. A2A and app-server are separate protocols.

The FFI must consume library logic rather than depend on the CLI application.
Native discovery, loading, lifetime and ABI/version behavior need one owner.
Installed production services must not compile implicitly or depend on a
`target` directory. The plan tracks Linux/Windows and development-mode proof.

Browser component imports must stay free of native Bun bindings and server
startup effects. Deterministic RAG calculations belong to the Rust core;
Python is an adapter to that owner. Application rules and shared registries
belong to domain packages rather than site entry points. These are required
boundaries, with outstanding implementation and verification in the root plan.

OS owns durable jobs and process resources. Infra owns placement and deployment
policy. Long operations expose a handle, bounded progress, cancellation and an
authoritative terminal state; a planned adapter is not proof of a delivered
runtime path. Native buffers must be released by their owning allocator and
respect runtime threading and lifetime rules.

## Infrastructure, data and provenance

Infra configuration is canonical: [services](../../../../infra/config/service-catalog.json),
[topology](../../../../infra/config/production-topology.json),
[`host routes`](../../../../infra/config/host/nginx/routes.json) and
[local AI](../../../../tools/aphrody/config/local-ai.json). Current release records and live
probes establish deployed state; manifests and historical catalogues do not.
Migration tools may intentionally read legacy archives, while active service
configuration must use active roots and installed runtime paths.

Applications retain authentication contracts, database schemas and migrations.
Infra owns placement, backup and recovery. Secrets, game datasets, model weights,
caches, generated binaries and user databases remain in protected stores.
Do not erase a source checkout before mapped consumers pass from a clean clone.

Preserve licenses, upstream notices and source-to-target evidence. The root
license does not relicense imported source, fonts, models or assets.
Packaging copies need consumer and license verification before deduplication.

## Qualification and product delivery

Qualification follows actual dependency edges and the root plan across runtime,
interop, CLI, Infra, UI, AI/Web and application domains within one Bun OS product.
The [generated pipeline](../../../../infra/config/pipeline.json)
records declared commands; actual exit codes, logs and coverage establish
passing gates. Missing qualification scripts need real checks.

The root plan requires owner checks, real FFI tests, browser import/build
qualification, RAG parity, application smoke tests and assembled Shenron
validation. A production deployment is a separate operation. Record scope and
limits with every result; document edits alone do not qualify the runtime.
