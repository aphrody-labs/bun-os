<!-- SPDX-License-Identifier: Apache-2.0 -->
# Unified release train

Owner directive (2026-10-07): every Aphrody site and binary follows one current
release train. Build each train once from a pinned, clean source closure; publish
one immutable train manifest; promote that same train to all declared sites and
binary channels. `latest` is one pointer to that train, never a separately
rebuilt artifact.

This means one **train version** (`release_id`) across the ecosystem, not one SemVer substituted into every component. The train manifest binds those identities and hashes to one release ID and one source closure. A site's content and every downloadable binary must report the same train ID after promotion.

## Current gap

The repository currently has independent publishers and current pointers:

- `scripts/release/publish-downloads.ts` builds/publishes Aphrody and Yolo
  binaries plus plugins under `/srv/aphrody-downloads/current`.
- `scripts/release/publish-creator.ts` independently builds and promotes the
  creator site under `/srv/aphrody-creator/current`.
- Other product sites may live in separately owned repositories and have their
  own source revisions and build owners.

These workflows do not yet share a release ID, artifact inventory, build
receipt, promotion coordinator, or ecosystem-wide `latest` manifest. Separate
site updates therefore do not currently prove one release train. This plan
supersedes the historical all-in-one Aphrody bundle as the target convergence
model; it does not reactivate retired Aphrody services or authorize bypassing
a site's owner or data gates.

## Contract

1. **One source closure.** A train pins Aphrody plus each participating owner
   repository to immutable full commit IDs, including required submodules and
   fork runtime/artifact revisions. Refuse dirty or moving source inputs.
2. **Build once, per target.** A single orchestrator prepares every enabled
   target artifact from those pins. Cross-compilation is still one build of the
   train; no site or download publisher may rebuild after staging. Store build
   receipts, toolchain identity, target, component version, source SHA, artifact
   SHA-256, and provenance in the train manifest.
3. **Immutable assembly.** Stage all site payloads and binaries beneath one
   `release_id`; scan for secrets, verify every hash, and run artifact/site
   smoke tests before any `current` pointer changes. Never mutate an existing
   train directory.
4. **One latest index.** Publish one canonical `latest.json` that identifies
   the active `release_id`, the pinned source closure, participating sites, and
   the complete platform/artifact matrix. Component-specific manifests may be
   compatibility views generated from this index; they cannot independently
   select another train.
5. **Prepare then promote.** Every target is staged and verified first. Promote
   sites and download channels through the Infra coordinator, record each
   activation result, then advance the public latest pointer. If any promotion
   fails, restore already-switched sites to their previous pointers and leave
   `latest` unchanged. Keep rollback releases according to the existing
   retention and protected-data contracts.
6. **One invocation.** The owner release command supports `plan`, `build`,
   `stage`, `promote`, `verify`, and `rollback`. A normal release executes the
   complete flow once; no per-site manual republishing is needed. `plan` is
   read-only, and promotion uses the declared Infra host adapters.
7. **Latest means complete.** Installers and site update checks resolve the
   canonical latest index, select their compatible component/target, and verify
   its hash and train ID. They never silently fall back to a separately tagged
   GitHub `latest` release.

A multi-site host cannot switch several filesystem symlinks in one hardware
atomic operation. The coordinator therefore makes the public `latest` pointer
the commit point: component sites can be promoted sequentially while users and
installers continue resolving the previous train, and latest advances only
when every required site is healthy. Rollback remains available if post-commit
probes fail.

## Implementation sequence

1. Inventory all publicly served Aphrody-owned sites, binaries, target matrices,
   owner repositories, update clients, current pointers, build factories, and
   rollback adapters. Exclude separately owned products unless their owner
   exposes a pinned build and promotion interface.
2. Define the train manifest schema and compatibility projections; add
   validation that every enabled catalog item has a pinned source, build/stage
   adapter, smoke gate, and rollback operation.
3. Refactor the existing downloads and creator publishers to accept a shared
   train ID and prebuilt staged artifacts.
4. Implement the Infra coordinator and simulated failure/rollback tests for
   prepare, transfer, checksum, each site promotion, latest-pointer update, and
   post-promotion probes. Test with Aphrody's Bun fork for Bun-owned code.
5. Migrate one non-production channel, then the authorized production sites;
   verify all `latest`/site responses and installed binary `--version` plus
   embedded train ID before making this the only release path.
6. Remove independent release entry points only after behavior, rollback,
   package compatibility, and owner interfaces are qualified.

## Acceptance

- One invocation from one clean source closure produces one train ID and one
  immutable artifact set; a repeated build request cannot replace its bytes.
- Every enabled site and binary in the manifest reports that train ID, with its
  own compatible component version, full source SHA, target, and artifact hash.
- No independent `latest` pointer can advertise a different train.
- A failed gate or promotion leaves the previous ecosystem-wide latest train
  active; simulated failures prove rollback for every switched component.
- Public probes, download checksum verification, install/upgrade checks, and
  each component's declared health smoke pass before the train is marked
  current.
- Evidence records source pins, toolchains, commands, target matrix, artifact
  hashes, site probes, activation state, rollback result, and limits.

Status: target architecture only. The existing publishers and service
adapters remain independent until the implementation sequence and acceptance
gates are complete.
