# Cargo workspace dependency graph

The active Rust graph is the root `Cargo.toml` workspace. Run
`bun run layering:check` to read `cargo metadata --no-deps --offline` and
validate its workspace crate graph. Each node is a crate directory such as
`crates/os/kernel/core`; each path dependency between workspace crates is an edge.
The command fails on a missing workspace target, metadata error, or crate
cycle. `--json` prints all nodes, edges, external path sources, and errors.
The test exercises both a fixture
graph and the current workspace. The ecosystem catalog reads the same Cargo
metadata, and `bun scripts/tools/workspace/ecosystem.ts --check` validates its generated view.

Cross-domain dependencies are allowed when the crate graph is acyclic. The
historical category repository layer numbers below do not govern the monorepo.

## Historical category repository layering

The following describes the former sibling checkouts and is retained as
migration history.

The `aphrody-*` category repositories (`aphrody-contracts`, `aphrody-native`, `aphrody-shell`,
`aphrody-compat`, `aphrody-os`, `aphrody-web`, `aphrody-koharu`, `aphrody-ui`, `aphrody-infra`, `aphrody-ai`) must
form a DAG: a repository may only depend on a sibling in a strictly lower layer, by relative
path (`../aphrody-<category>`), never the reverse. This keeps any subset of the checkout
buildable and stops a change in one repository from forcing a rebuild of every other one.

## Layer order

| Layer | Repositories | May depend on |
| --- | --- | --- |
| 0 | `aphrody-contracts`, `aphrody-native` | nothing (leaves) |
| 1 | `aphrody-shell`, `aphrody-compat` | layer 0 |
| 2 | `aphrody-os` | layers 0–1 |
| 3 | `aphrody-web`, `aphrody-koharu` | layers 0–2 |
| 4 | `aphrody-ui`, `aphrody-infra` | layers 0–3 |
| 5 | `aphrody-ai` | layers 0–4 (the only repository allowed to depend on everything) |

`aphrody-contracts` and `aphrody-native` never take a sibling path dependency (workspace
invariant). `aphrody-shell` and `aphrody-compat` are independent of each other; neither depends
on the other. `aphrody-os` depends on both (`aphrody-shell` for the embedded Nushell subsystem,
`aphrody-compat` for the offline Bun-docs subsystem and the shared `aphrody-toolchains`
Bun/uv/Nushell discovery crate) but nothing above `aphrody-os` links `aphrody-web` or
`aphrody-ui` directly: their subsystems (Obscura browser, 3D rendering) run as separate
`aphrody-*-mcp` binaries that `aphrody-kernel` spawns and proxies over stdio MCP
(`aphrody_kernel::mcp_proxy`), never as linked crates. `aphrody-ai` consumes every other
category repository by relative path and is never consumed by any of them (workspace invariant).

## Former enforcement

The former scanner read `cargo metadata --no-deps` in each sibling repository,
then rejected edges against the fixed category layer numbers. The current
scanner uses the root workspace's crate paths instead.

## 2026-09-25: breaking the `aphrody-compat` ↔ `aphrody-os` cycle

`aphrody-compat`'s `aphrody-n2b` crate started depending on `aphrody-os`'s
`aphrody-toolchains` (shell-free Bun/uv/Nushell discovery) the same day `aphrody-os`'s
`aphrody-kernel` started depending on `aphrody-compat`'s `aphrody-bun-docs` subsystem, forming a
two-repository cycle. `aphrody-kernel -> aphrody-bun-docs` is a valid layer-2-depends-on-layer-1
edge and was kept; `aphrody-n2b -> aphrody-toolchains` was the layer violation (layer 1
depending on layer 2). `aphrody-toolchains` has no dependency on the rest of `aphrody-os` (only
`serde_json`, `thiserror`, `toml`) and `aphrody-n2b` was already its heaviest consumer, so the
crate moved from `crates/compat/toolchains` to
`crates/compat/toolchains`; `aphrody-os`, `aphrody-ui` and `aphrody-ai` now
consume it as a sibling, the same way they already consume `aphrody-bun-docs`.

## Shared application integration repositories

`aphrody-discord` is a shared Bun/TypeScript integration repository, outside
the Rust category DAG above. It owns reusable Discord transport, framework
adapters and protocol lifecycle. It may be consumed by Achilléa
and Aphrody notifications through a published package or an explicit immutable
SHA. It must not own their commands, databases, auth policy or secrets, and
application repositories must not add a reverse dependency into the category
layer. Infra owns its release, systemd unit, Nginx route and external env.
