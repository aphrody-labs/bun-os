> **Product status lives in [`docs/PRODUCT.md`](../PRODUCT.md)** (owner order 2026-10-31: one product, the unified Bun OS image). This file is background only; where it disagrees with PRODUCT.md, PRODUCT.md wins.

> **Legacy fork notice (2026-10-29).** This document describes a plan written while the runtime was the `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# Bun OS canonical workspace consolidation

Status: active owner execution goal, 2026-10-14.

Active delivery details and unfinished owner requests are tracked in
[the delivery backlog](active-delivery-backlog.md). Keep unchecked work open
until its implementation and relevant qualification are complete.

Canonical execution repository: `aphrody-labs/bun-distribution`, branch `os`.

This is the canonical copy and was mirrored into the now abandoned `aphrody-labs/bun` fork and
`aphrody-labs/aphrody` so repository-local Codex sessions discover the same
cross-repository direction. The canonical implementation owner is
`bun-distribution`; the mirrors do not transfer runtime or product ownership
away from their existing repositories.

## Objective

Consolidate Bun OS into one canonical distribution workspace, comparable in
discipline to a modern Rust-heavy Linux distribution workspace:

- one authoritative root Bun workspace, lockfile, install and orchestration owner;
- one authoritative root Cargo workspace, lockfile, toolchain and build policy;
- many leaf Cargo manifests as workspace members where technically appropriate;
- pinned Git submodules for independently owned upstream/fork histories;
- one dependency/build graph;
- one build/cache ownership model;
- one target/profile model;
- one qualification and artifact receipt model;
- one release pipeline.

Do not interpret "one workspace" as "one source manifest". Cargo member crates
retain their own `Cargo.toml`; publishable or technically required Bun leaf
packages may retain minimal package metadata. The root is the only orchestration
owner.

## Execution mode

This is an implementation goal, not a design-only exercise.

Operate:

`discover -> model -> consolidate -> implement -> migrate -> build -> test -> qualify -> benchmark -> document -> continue`

Do not ask the owner questions that can be answered from the local repository,
Git history, submodules, existing documentation, current tests/receipts, GitHub,
Context7, or current upstream documentation.

Repository evidence and the newest explicit owner directive override assumptions
in this document.

Preserve concurrent and uncommitted work. Never force-push, hard-reset unrelated
work, expose secrets, or delete protected stores.

## Mandatory discovery

Before broad edits, read the repository instructions and inspect:

- `AGENTS.md`, `START-HERE.md`, `GOAL.md`, `PLAN.md`, `MEMORY.md`, `README.md`;
- all architecture, ownership, migration, build, qualification and provenance docs;
- every `Cargo.toml`, `Cargo.lock`, `rust-toolchain*`, and `.cargo/config*`;
- every `package.json`, Bun lockfile, `bunfig.toml`, and `tsconfig*`;
- every Git submodule and nested Git/workspace boundary;
- root build scripts, factory, packages, crates, libraries, toolchains, containers,
  infra, CI and release scripts;
- at least the recent architecture/migration commits, including runtime ownership,
  development-vs-release runtime pins, workspace consolidation, crate/package
  migration, native qualification, and shared build/cache ownership.

Build a machine-readable inventory containing at least:

`component, path, type, source repository, submodule, revision, upstream, Cargo owner, Bun owner, build owner, release owner, targets, qualification state, migration state`.

Use the inventory to drive changes.

## Repository roles

### aphrody-labs/bun (abandoned)

Superseded 2026-10-29: the fork is abandoned. The runtime is unmodified upstream oven-sh/bun, npm `bun@1.4.4-canary.20261028.1` (gitHead `11c367163a4b`). The paragraphs below are history.

Inspect its current implementation and instructions, including Rust/JSC/WebKit,
OXC/native check-lint-fmt, FFI, Windows/Linux system APIs, Python/.NET/native
integration, Obscura/Chromium surfaces, native build tooling, ThinLTO/cache
behavior, runtime packages and release artifacts.

Do not copy the runtime implementation into the distribution just to make the
tree appear monolithic. Consume it through the pinned toolchain/submodule and
artifact contracts defined by the distribution.

### aphrody-labs/bun-distribution

This is the canonical Bun OS product/distribution workspace.

The root owns assembly, workspace configuration, factory/build orchestration,
shared install/build/cache locations, target/profile definitions, packaging,
qualification, receipts and release coordination.

Complete the migration already in progress instead of creating parallel owners.

### aphrody-labs/aphrody

The owner's latest 2026-10-16 directive absorbs Aphrody Infra and Workspace into
Bun OS Infra and Workspace. AI, infrastructure and workspace orchestration
are capabilities of the same unified product. Bun owns the runtime, platform
and general capabilities; Bun Libraries
and this distribution own their library/product assembly. Move other Aphrody
capabilities through their existing canonical owners, preserving history,
licenses and consumers. Do not duplicate transfers already active in Bun.

Follow the current owner direction recorded in PLAN.md. External distribution
dependencies keep their existing pinned contracts. Preserve active sibling checkouts until their consumers and
canonical source owners qualify.

## Distribution product direction

Treat Bun OS as a real Linux distribution assembled by `bun-distribution`, not
as a renamed Arch installation and not as a Bun application layered onto an
unowned host image.

The current owner direction is to use the **Arch Linux family/model as the
primary distribution reference**. This direction is established by the owner;
implementation and qualification still require repository evidence. The reason
is the fit with a fast-moving Rust,
kernel, Mesa/Vulkan, LLVM/Clang, WebKit/JSC and gaming stack. Preserve Bun OS
identity, its own package/build/qualification policy and its own release cadence.

Produce at least two compositions from the same source/build graph:

- **Bun OS Server** — minimal, headless, fast and hardened, with an operational
  philosophy similar to Alpine/Debian minimal systems. Keep glibc as a supported
  primary option where compatibility requires it and retain Alpine/musl as a
  distinct qualification target rather than pretending libc differences are
  transparent.
- **Bun OS Desktop/Gaming** — glibc-oriented desktop/gaming composition with a
  modern graphics stack. Research and integrate only qualified components needed
  for Mesa/Vulkan, GPU drivers, Steam/Proton, Gamescope and the selected Bun OS
  desktop/session. Keep gaming dependencies out of the server composition.

Before finalizing implementation choices, use **GitHub MCP and Context7 rather
than generic web search** to deeply study current primary sources for:

- **CachyOS** — kernel/toolchain/package optimization, CPU targeting, scheduler
  choices, performance build infrastructure and server/desktop differentiation;
- **ChimeraOS** — reproducible distribution/image construction, immutable or
  image-based system design, update/rollback strategy, package composition and
  gaming appliance architecture;
- **SteamOS** — Arch-family gaming composition, Steam/Proton/Gamescope session,
  graphics/driver integration, system/update boundaries and recovery model;
- **Arch Linux** — package/build conventions, pacman/libalpm, repository
  metadata, bootstrap/rootfs construction and rolling-release implications;
- **COSMIC/System76** where useful — Rust component ownership, workspace/build
  organization and desktop integration patterns.

Do not copy these distributions wholesale. Produce a comparison matrix of
relevant mechanisms, licenses, update models, build systems, package managers,
immutability/rollback choices, kernel/toolchain policies and gaming integration.
For each mechanism explicitly decide: `adopt`, `adapt`, or `reject`, with
repository evidence.

Then finish the Bun OS architecture plan and implement the highest-value
compatible pieces through the existing root build graph.

The final distribution pipeline should converge on:

`pinned sources -> root workspace graph -> toolchains -> kernel/system/runtime -> profile composition -> rootfs/image/package -> qualification -> signed/hashed release -> update/rollback`

Discover and reuse existing Bun OS package conversion, APT/APK/ALPM metadata,
container, factory, source-integrity and receipt implementations before adding
new owners. If Arch becomes the selected primary base, make pacman/libalpm and
Arch package/repository handling first-class without deleting Debian/Alpine
qualification paths that provide useful portability evidence.

## Git submodules

Keep independent source projects as pinned Git submodules where that preserves
history, licensing, upstream synchronization and ownership.

Normalize and verify for each submodule:

- canonical repository and upstream;
- pinned revision;
- license/provenance;
- product owner;
- build participation;
- migration state.

Remove stale/duplicate relationships only after proving there are no consumers.

## Cargo target state

Target one authoritative root:

- `Cargo.toml`
- `Cargo.lock`
- `rust-toolchain.toml`
- `.cargo/config.toml`

Use one root `[workspace]` with shared package/dependency/lint/profile policy
where appropriate.

Migrate nested Rust workspaces in controlled batches. Preserve upstream
maintainability: do not blindly rewrite imported manifests merely to remove
workspace boundaries.

Inventory and rationalize nested lockfiles, target directories, toolchain files,
Cargo configs, patch sections, profiles and duplicate native-link owners.

A nested workspace/lockfile may remain only when it is genuinely required and
the exception is documented.

Route first-party Cargo operations through the existing serialized root Cargo
owner. Inspect and extend existing scripts such as `scripts/cargo.ts`,
`scripts/cargo-serial.ps1`, `scripts/cargo-build-proof.ts` and
`scripts/crate-inventory.ts` before adding another wrapper.

## Bun target state

Target one authoritative root Bun workspace:

- `package.json`
- `bun.lock`
- `bunfig.toml`
- root TypeScript configuration and catalogs.

Remove duplicate root-like installs, lockfiles, catalogs, scripts and competing
Bun versions where migration is safe.

Prefer Bun 1.4.4 and native Bun APIs when that remains the pinned project
contract.

Nested `package.json` files may remain only as technically necessary leaf
metadata. The root owns dependency policy, install, orchestration and quality
commands.

Use native `bun check`, `bun lint`, `bun fmt`, `bun test`, `bun build`,
`Bun.spawn` and `Bun.file` where appropriate and semantically correct.

## One build graph

Discover the actual dependency graph and make root orchestration own it.

Conceptually the graph should cover:

`bootstrap -> source/submodule verification -> toolchains -> workspace validation -> Rust/native libraries -> runtime -> packages -> desktop/apps -> containers/packages -> qualification -> release artifacts`

Do not hardcode that sequence if actual dependency evidence differs.

Inspect and consolidate existing owners such as:

- `src/cli.ts`
- `packages/bun-workspace`
- `scripts/setup.ts`
- `factory/`
- `justfile`

Avoid introducing a competing root CLI.

## Factory and targets

Treat `factory/` as a first-class owner.

Make builds reproducibly record:

- source revision;
- submodule revisions;
- toolchain versions;
- target and ABI/libc;
- profile/features;
- artifact hashes/sizes;
- tests and qualification results.

Use the repository target definitions (`distribution.json`,
`factory/native-targets.*`, `sources.lock.json`, runtime pins) as authority.

Distinguish source support, compilation, tests, runtime qualification and release
qualification. Compilation alone is not release support.

## Shared build/cache/storage policy

Use one policy for Cargo target/cache, Bun cache/install, native SDKs, ThinLTO,
toolchains, Git/worktrees, package artifacts, source exports and release staging.

Inspect existing cache/storage ownership first.

Add safe disk-pressure management only by extending canonical owners. Required
properties include dry-run, protected paths, active-build detection,
configurable quotas/retention, bounded reclamation and structured receipts.

Never blindly delete repositories, Git object databases, active build outputs,
protected user state or unclassified paths.

Evaluate sccache/cargo cleanup tools only when they improve the existing design,
and benchmark before claiming a performance benefit.

## Libraries migration

Fully compare `bun-libraries` with `bun-distribution`.

For every library actually present, determine source/fork/upstream, revision,
submodule ownership, Cargo migration, Bun integration, native build,
qualification and app packaging status.

Finish migrations already declared by repository plans. Do not duplicate an
engine merely because it came from a historical workspace.

## Dependency and vendor discipline

Use root-controlled Cargo metadata/tree diagnostics to find high-value duplicate
versions, feature conflicts, native-link conflicts and sys-crate duplication.
Do not update dependencies solely for cosmetic uniformity.

Treat `vendor/cargo` as generated/reproducible state. Inspect the vendor
generator, source replacement config, integrity receipts and licenses before
modifying it. Do not hand-edit third-party vendor source except through a
maintained, provenance-preserving patch process.

## GitHub and Context7

Use GitHub to inspect every important Aphrody fork/submodule and its upstream:
current pin, divergence, recent relevant commits, license and maintenance state.
Do not blindly sync every upstream.

Use Context7 for external APIs whose current behavior is uncertain, especially
Bun 1.4.4, Cargo workspace inheritance, Rust/Cargo tooling, Tauri v3, Tokio,
windows-rs, WebKit/JSC, OXC and other actually-used dependencies.

Pinned repository source remains the final API truth.

## CI, qualification and receipts

Consolidate CI around the root graph and avoid rebuilding the same dependency
graph through unrelated pipelines.

Keep separate evidence for source validation, format/lint/typecheck, Cargo
checks, tests, native builds, app builds, containers, qualification and release.

Every releasable native artifact should have an existing-compatible receipt with
source/submodule revisions, target, toolchain, feature/profile, artifact
hash/size and exact gates.

Preserve the explicit distinction between development runtime and immutable
release runtime pins.

## Migration sequence

Prefer bounded, reviewable batches:

1. Inventory and ownership graph.
2. Root invariant checks for duplicate workspace roots, locks, toolchains,
   installs and unowned outputs.
3. Bun workspace consolidation.
4. Cargo workspace consolidation in safe batches.
5. Complete Bun Libraries migration.
6. Route builds through one root graph.
7. Unify factory inputs/outputs and receipts.
8. Package from the same graph.
9. Run targeted then broad qualification.
10. Update canonical generated documentation and plans.

Do not rewrite the whole repository in one giant migration.

## Validation

This goal explicitly authorizes the relevant end-to-end tests and qualification
gates.

Use targeted tests after each bounded migration. Run broader gates after
integration. Never fabricate results or weaken tests merely to get green status.

Measure clean/incremental/no-op builds and disk/cache effects where the change
makes a performance or storage claim.

## Documentation and completion

Update documentation through canonical generators/sources where they exist.

Keep `GOAL.md`, `PLAN.md` and `MEMORY.md` synchronized with the real state,
without turning them into raw execution logs.

The desired architecture is:

```text
bun-distribution/
  root Bun workspace + lock/install owner
  root Cargo workspace + lock/toolchain owner
  apps/
  crates/
  packages/
  toolchains/
  factory/
  container/
  infra/
  one distribution build / qualification / release graph
```

Independent source owners remain pinned submodules.

When executable migration work remains, do not stop at recommendations.

Final reporting must distinguish discovered state, performed migrations, files
changed, exact tests/results, qualification achieved, measurements, blockers and
next executable batch. Do not report intent as completion.
