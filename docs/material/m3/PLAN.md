<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody M3 — integration plan

[GOAL.md](GOAL.md) owns the requested scope. [AGENTS.md](AGENTS.md) owns local
execution rules. [MEMORY.md](MEMORY.md) records dated validation and limitations.
The [Aphrody architecture](../PLAN.md) and [Yolo producer plan](../../yolo/PLAN.md)
remain authoritative for native runtime and installed hosts.

## One framework, explicit owners

| Surface                                                               | Owner                                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Plugin, theme modules, Bun web build and `m3` CLI                     | `packages/m3`; OS theme implementation is the `aphrody-m3-os-themes` owner submodule         |
| App API/file server, executable compiler and deployment configuration | `packages/m3-bun`                                                                            |
| Shared `Bun.build` preset and workspace build cache                   | `packages/m3-config`, `scripts/build.ts`                                                     |
| Tokens and theme renderers                                            | `packages/m3-tokens` owns the Rust export adapter; Aphrody `crates/aphrody-m3-tokens` owns colors |
| Package build/test orchestration                                      | `scripts/yolo.ts`, existing `$YOLO_ROOT/bin/yolo`                                            |
| Minimal web example / adaptive UI and API consumer                    | `apps/web` / `apps/m3-showcase`                                                                 |
| Native artifacts and installed desktop/mobile hosts                   | Aphrody integrator and declared build factory                                                |

See the [framework guide](docs/guides/FRAMEWORK.md),
[Bun application guide](docs/guides/M3-BUN.md),
[design plan](docs/plans/design/M3-PLAN.md) and
[host matrix](docs/plans/design/M3-MULTI-HOST-PLAN.md).

## Gates

Use the scripts actually declared by the selected checkout:

```sh
bun run check
bun run test
bun run lint
bun run typecheck
bun test ./packages/m3/qualification/check.test.ts
```

The root test task includes script tests, workspace package tests and integrity
gates. Its package exclusions and the narrower default build/lint/typecheck
scopes are documented in the framework guide. Qualify an affected package with
its own declared scripts when the root scope does not cover it. Use native Bun
`bun lint` and `bun fmt` on owned TypeScript files; use content/link/whitespace checks for documents.

Build, executable smoke and native installation are separate gates. Do not
rebuild or overwrite another active batch's outputs, install dependencies,
publish a package or claim cross-platform support to resolve a documentation
task. Run relevant artifact gates when owning the corresponding source batch.

## Finalization queue

1. Resolve `m3 check` against the nearest framework contract while preserving
   the existing Aphrody `bun:check` contract.
2. Align the package map, entrypoints, build pipeline and host matrix with source.
3. Record workspace checks and remaining source/platform dependencies with
   reproductions in [the finalization receipt](docs/reports/FRAMEWORK-FINALIZATION.md).
4. Deliver the completed owned batch; leave concurrent source batches and
   unqualified host milestones open until their integrator supplies evidence.

Successful timing, output generation or a source export alone never closes a
runtime, deployment, performance or installed host milestone.
