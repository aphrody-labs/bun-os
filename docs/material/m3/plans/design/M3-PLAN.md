<!-- SPDX-License-Identifier: Apache-2.0 -->
# M3 plan: contracts and qualification

Source review and scoped UI checks: 2026-10-04. The canonical product architecture and
execution rules remain in Aphrody's [PLAN](../../../../PLAN.md),
[GOAL](../../../../GOAL.md), [AGENTS](../../../../AGENTS.md) and
[MEMORY](../../../../MEMORY.md). Yolo owns runtime production under its
[PLAN](../../../../../yolo/PLAN.md). This document scopes the M3 framework;
it does not close those repositories' runtime or installation milestones.

Use the [framework guide](../../guides/FRAMEWORK.md) for the package map and
[host plan](./M3-MULTI-HOST-PLAN.md) for the qualification matrix.

## Ownership and repository boundary

`aphrody-m3` is the private design repository consumed through the
`m3/` submodule in Aphrody. Its Bun packages, apps, templates, examples and
forks live here; Rust UI crates remain in Aphrody's `crates/ui/*`. Root workspace
exclusions keep host-bound packages under their product integrator. Preserve
private repositories, fork histories, licences and protected stores. Package
exports are consumer APIs; they do not authorize public npm publication.

| Owner | Contract |
| --- | --- |
| Aphrody `crates/aphrody-m3-tokens` (`aphrody-m3-tokens`) | Canonical Rust tokens, HCT, palettes, role sets and generated sheets. |
| Aphrody `crates/ui/bun` (`aphrody-bun`), `@aphrody/bun` | Native bindings, including `m3Css`, rendering and the icons module. Native artifact qualification belongs to the parent workspace. |
| `@aphrody/m3-tokens`, `@aphrody/m3-theme`, `@aphrody/m3-tailwind` | TypeScript/CSS projection, dynamic colour, theme providers and Tailwind v4 aliases. |
| `@aphrody/material-web`, `@aphrody/m3-front`, `@aphrody/m3-react` | Lit components, custom-element registration and React wrappers. |
| `@aphrody/m3-primitives`, `m3-forms`, `m3-explorer`, `m3-ai`, `m3-reader`, `m3-motion` | React components and motion; Base UI owns headless component behaviour. |
| `@aphrody/m3`, `m3-bun`, `m3-config`, `m3-next`, `m3-next-migrate`, `scaffold` | Bun build/serve/compile, package presets, Next integration, bounded migration and one scaffolder. |
| `apps/web`, `apps/m3-showcase` | Framework examples. The adaptive showcase has local fixture data and its own Bun API. |

Lit and React DOM consume the same roles while retaining separate rendering
implementations. Product RPC and platform privileges remain at their host boundary.
The workspace catalog and lockfile define dependency versions; package manifests
define API compatibility. No absent `aphrody.m3Version` or `bun:check` gate is assumed.

## Current implementation decisions

- Build, serve and compile route through [scripts/yolo.ts](../../../scripts/yolo.ts)
  and the installed Yolo `bin/yolo` entry point. The wrapper sets `YOLO_HOME` to
  this repository for `apps/web`.
- [scripts/build.ts](../../../scripts/build.ts) orchestrates package builds,
  declarations and scoped typechecks with the shared `m3-config` presets and cache.
  Root workspace scripts exclude the product-bound packages named in the manifest.
- Next uses `m3-next`, with separate server/client entries, cookie identity checks,
  static-export configuration and an on-demand colour engine. Its runner and tests
  are described in the [package guide](../../../packages/m3-next/README.md).
- Migration uses the same scaffolder as new apps. Generated shells use the
  [TAURI_3 pins](../../../packages/scaffold/src/pins.ts); installed host versions
  must be checked separately. [Migration requirements](../../../packages/m3-next-migrate/src/requirements.ts)
  reject activation when request, action, font or route adapters are missing.
- `m3-design` now uses Material Color Utilities HCT in
  [hct.ts](../../../packages/m3-design/src/hct.ts). This source observation does
  not replace a cross-language parity test.
- Font and icon packages retain their source/provenance records. Asset gates check
  references; they do not establish that every native application is installed.

## Verified UI batch

Checks ran on Linux with Bun 1.4.2 on 2026-10-04 against the current worktree.
These counts cover the named suites, not every package or platform.

| Scope | Receipt | Limit |
| --- | --- | --- |
| React, primitives, motion, AI, forms, explorer production contracts | 19 pass across six `production-contract.test.tsx` files | DOM checks cover lifecycle, reduced motion, focus, controlled state and keyboard access. |
| Next unit contracts | 49 pass, 1 skip (`bun test ./test/` in `packages/m3-next`) | The native Rust renderer comparison is conditional and was skipped. |
| Next client DOM | 10 pass in its isolated `test-dom/` suite | A grouped run failed at the seed-role assertion after a fixed 50 ms delay; deterministic waiting still needs qualification. |
| Next migration | 103 unit/host pass; 7 DOM pass | Local HTTP tests required sandbox escalation; unsupported adapters remain explicit activation blockers. |
| Adaptive showcase | 20 unit/API/host pass; 3 D-pad DOM pass | Host tests verify source/configuration contracts, not an installed desktop or mobile app. |
| Total | **211 pass, 1 skip** in the scoped successful runs | Not a receipt for cross-host delivery, native builds or deployment. |

## Remaining qualification

1. Complete the framework batch's manifest/import, asset, docs, lint, format,
   TypeScript and applicable build gates; retain the exact results in a receipt.
2. Stabilize the Next asynchronous DOM check and qualify native token parity when
   the verified native artifact is available.
3. Qualify browser interactions and the installed hosts separately using the
   [host matrix](./M3-MULTI-HOST-PLAN.md). Record unsupported capabilities explicitly.
4. Measure bundle/build/interaction performance against comparable baselines.
   Source choices alone establish no gain, zero-copy claim or latency budget.

## Existing gates

From this repository, use the declared commands for the relevant owned batch:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run check
bun run build
```

Documentation-only changes use scoped link checks and `git diff --check` without
native compilation. Rust changes use the parent integrator's serialized scoped
check/test/strict Clippy through `scripts/build/rust/cargo-serial.sh` and its factory.
Do not replace that admission path with workspace-wide Cargo or an unrelated checkout.
