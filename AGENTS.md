# Bun OS workspace

## Branches — 2026-10-29

- main is the only branch. Source is plain git plus GitHub `aphrody-labs/bun-os`; there is no self-hosted forge (retired 2026-10-30). The GitHub `os` ref is stale and no longer maintained: never push to it.
- Push with a normal git push origin HEAD:main, never forced. Synchronisation of the workstation, GitHub and the VPS: [docs/SYNC.md](docs/SYNC.md); VPS build and recovery: [docs/VPS-BUILD.md](docs/VPS-BUILD.md).

## Owner workflow update — 2026-10-18

- No new Git worktrees. Consolidate existing branches and worktrees into the
  canonical checkout after preserving their source changes in Git.
- Run builds and qualification on the VPS only, including Git qualification
  hooks. The Windows workstation edits and synchronizes sources.
- Commit source checkpoints and synchronize PC/VPS at delivery boundaries;
  fetch before normal pushes and never force-push.
- Share the existing VPS factory slots between runtime, OS and web builds,
  with at most four compiler jobs per concurrent lane and shared owner caches.

## Development tools — 2026-10-30

- Develop Bun OS with its own stack: Bun scripts, the Bun OS plugins and CLIs, and Rust tools (`rg`, `fd`, `sd`, `nu`, `bat`, `eza`,
  `dust`, `procs`, `hyperfine`, `just`, `tokei`; uutils coreutils and sudo-rs on the VPS). Do not use PowerShell or GNU tools;
  PowerShell only where a Windows-only API leaves no other way.

## Bun OS consolidation goal

Before workspace, Cargo/Bun ownership, build-factory, packaging, cache, target,
qualification or release changes, read
[`docs/agent-goals/bun-os-consolidation.md`](docs/agent-goals/bun-os-consolidation.md).
It is the active owner execution goal for consolidating this repository as the
canonical Bun OS distribution workspace. Repository evidence and newer explicit
owner directives still take precedence.

This checkout is the Bun OS distribution workspace. The broader Aphrody/Bun
unification is an owner goal and is not complete. Read `GOAL.md`,
`PLAN.md`, `MEMORY.md` and `START-HERE.md` before changes. Preserve concurrent
work, repository history, first-party attribution, and every imported license
and notice. Keep product documentation and collaboration in English.

Owner direction (2026-10-16): deliver one unified Bun OS product. Absorb
Infra and Workspace into the existing Bun OS owners; integrate capabilities
and consumers rather than reserving separate product layers. Android owners:
`apps/bun-android`, `apps/java-ffi`,
`crates/android-native`, `packages/bun-android`, `packages/android-pipeline`
and `packages/android-web`. Merge product members into one root `crates/`,
`packages/` and `apps/`, one direct child per member. Nested source imports
are not completed flattening. Reuse canonical implementations and preserve
history, licenses and consumers before retiring source duplicates.

Expanded OS direction (2026-10-16): integrate CachyOS, ChimeraOS and Omarchy
catalogs through the root factory. Pacman/libalpm is the primary Linux package
manager. Keep Server, COSMIC Desktop and Gamescope Gaming compositions separate;
preserve upstream kernel/Rust histories and licenses. Imported source projects
remain external pinned owners until deliberate Cargo/member migration.

Use the upstream Bun canary `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`; `bun --revision`
prints `1.4.4-canary.1+11c367163`) and Bun APIs for JavaScript and TypeScript. The
`aphrody-labs/bun` fork is abandoned: do not call fork-only commands or APIs
(`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`,
`bun:nginx`, `Bun.Video`). Use the quality commands directly: `bun check`,
`bun lint` and `bun format` (the repo wrapper around `bun fmt` with `bun-format.json` and its ignore list; bare `bun fmt` scans vendored trees and fails). Do not route these commands through subprocess backends,
`bunx`, standalone OXC tools, `tsgo`/`tsc`, ESLint or Prettier. Fix native Bun
failures in place instead of adding a fallback. Use Rust's serialized wrapper
for Cargo.
Do not start WSL on the workstation. Resolve paths from this checkout or
explicit configuration, never a hard-coded workstation path.

The root owns product assembly, shared setup, workspace configuration and
release coordination. Capability source remains in managed Git submodules
until its history can be migrated without data loss. Keep one root Bun
workspace and shared install/build/cache locations. Do not claim a single Cargo
workspace while imported crates still belong to nested workspaces; migrate
their manifests and references in controlled batches before removing those
boundaries. Keep upstream license notices intact.

The owner's target contract is flat Git submodules for product Rust crates in
`crates/<package-name>`, inherited from one root Cargo workspace and nightly
toolchain. This target is not complete: root Cargo exclusions and nested
workspace boundaries remain. Credentials stay in protected secret stores.
Verify each crate's current owner and migration state from the source inventory.

Preserve protected `.local` stores, credentials, sessions, databases, model
weights and concurrent work. Bound long commands and serialize native builds.
Use Cloudflare MCP for account/domain mutations. Do not add or run tests unless
the owner requests them; explicit end-to-end qualification requests authorize
the relevant gates.

Commit owned paths as `aphrody-dev <contact@aphrody.com>`, without co-authors.
Fetch and verify ancestry before pushing. Never force-push.
