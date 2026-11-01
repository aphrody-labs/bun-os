# Bun OS repository map

This page is the orientation index for the Bun OS checkout: first-party
products, shared libraries, build/factory code, infrastructure, and imported
sources. It records what is present in source control; it does not imply that
every directory is a build target or that every source has been qualified.

## Start here

1. Read [`AGENTS.md`](../AGENTS.md) for current owner decisions and tools.
2. Read [`docs/PRODUCT.md`](PRODUCT.md) for the single product and its live
   checklist. Use [`docs/architecture.md`](architecture.md) for repository
   ownership boundaries and [`START-HERE.md`](../START-HERE.md) for the CLI.
3. Find the component owner before editing: [`docs/ARCHITECTURE-MAP.md`](ARCHITECTURE-MAP.md) lists
   source owners, entry commands, docs, CI, pins, and status; `sources.lock.json`
   and `.gitmodules` describe imported source.
4. Determine whether source belongs to the root Bun/Cargo workspace, an
   excluded target, a nested workspace, or an intentionally absent submodule.
   Directory presence alone is not membership or qualification evidence.
5. Use the owning build gate on its supported host. Preserve unrelated
   checkout changes. See [`docs/VPS-BUILD.md`](VPS-BUILD.md) and
   [`docs/SYNC.md`](SYNC.md).

## First-party source

| Path                                  | Owner boundary                                                                 | Entry point                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `src/`                                | Distribution, factory, source planning and operations CLI                      | `bun src/cli.ts --help`                                                         |
| `apps/`                               | User-facing desktop, WebOS, craft, mobile, and development applications        | Each app README and manifest; WebOS status is in `docs/PRODUCT.md`              |
| `crates/`                             | Rust libraries, binaries, server, search, crawl, system and media capabilities | Crate `Cargo.toml`/README; root membership is in `Cargo.toml`                   |
| `packages/`                           | Bun/TypeScript packages, tools, adapters and shared UI                         | Root `package.json` workspaces and package README                               |
| `factory/`                            | Image, OS package, native app and release assembly                             | `factory/README.md`, `factory/images/README.md`, `factory/images/manifest.json` |
| `infra/`                              | Desired host state, services, topology and build/deploy config                 | `infra/config/` and service catalogs                                            |
| `scripts/`, `tools/`, `bin/`          | Developer tooling and supported command wrappers                               | Root `package.json`, `justfile`, command help                                   |
| `docs/`                               | Product truth, architecture, operations and component guides                   | `docs/index.mdx`, `docs/PRODUCT.md`                                             |
| `assets/`, `fonts/`, `design-system/` | Licensed product resources and design tokens                                   | Nearby NOTICE/README and `ATTRIBUTION.md`                                       |

The root Bun workspace is declared by `package.json` and `bun.lock`. The root
Cargo workspace is declared by `Cargo.toml` and `Cargo.lock`, but also lists
exclusions, and imported repositories retain nested workspaces. No single
manifest makes every source tree one workspace. `distribution.json` describes
package compositions and targets; it is configuration, not build evidence.

## Imported source and vendor

`vendor/` contains pinned external sources, submodule checkouts, local source
trees, and vendored dependencies. Check `sources.lock.json`, `.gitmodules`, the
source owner's manifest, and the upstream license together. A parent gitlink
pins a submodule revision; `.gitmodules` maps paths to fetch URLs. Nested
submodules are separate pins and may intentionally remain uninitialized.

Read-only inventory commands (do not initialize every vendor submodule just
to browse the map):

```sh
git submodule status --recursive
git ls-files -s
rg --files vendor
```

`git submodule status --recursive` prefixes `-` for an uninitialized checkout,
`+` for a revision that differs from its parent pin, and a space for a matching
checkout. Use `git -C <path> status --short` to inspect local changes inside a
submodule. Do not recursively update, reset a nested checkout, replace a
gitlink, or remove ignored data as an inventory shortcut. Some submodules are
intentionally absent, large, host-only, or needed by one factory lane. Build
and setup scripts select their exact inputs.

Avoid treating `node_modules/`, `target/`, `build/`, `.local/`,
`.playwright-mcp/`, `toolchains/`, or other ignored/untracked directories as
first-party source without checking ownership and status. They may contain
caches, local checkouts, generated artifacts, or user data. Do not clean them
during an audit.

## Product and subsystem routes

| Work                                                           | Canonical guide                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bun OS scope and completion evidence                           | [`docs/PRODUCT.md`](PRODUCT.md)                                                                                                                        |
| Bootable image and streamed session                            | [`docs/UNIFIED-IMAGE.md`](UNIFIED-IMAGE.md), [`docs/webos/ARCHITECTURE.md`](webos/ARCHITECTURE.md)                                                     |
| Aphrody Search: CLI, REST/MCP, SQLite/FTS/vector/RAG and Redis | [`docs/aphrody/SEARCH-SERVER-ARCHITECTURE.md`](aphrody/SEARCH-SERVER-ARCHITECTURE.md), [`docs/aphrody/WEB-CRAWL-STACK.md`](aphrody/WEB-CRAWL-STACK.md) |
| Reusable Rust crawl/search client                              | [`crates/aphrody-web/README.md`](../crates/aphrody-web/README.md)                                                                                      |
| Reusable Bun and Fetch JS client                               | [`packages/aphrody-web/README.md`](../packages/aphrody-web/README.md)                                                                                  |
| Aphrody Search agent interaction                               | [`docs/aphrody/SEARCH-AGENT.md`](aphrody/SEARCH-AGENT.md)                                                                                              |
| Dragon Ball source ingestion                                   | Shenron's own repository and operational docs; Aphrody supplies generic crawl/search transports                                                        |
| Host build and qualification                                   | [`docs/VPS-BUILD.md`](VPS-BUILD.md), [`docs/VPS-TUNING.md`](VPS-TUNING.md), [`docs/AUTOMATION.md`](AUTOMATION.md)                                      |

For web work, keep owners clear: Google and SearXNG are discovery providers;
Obscura is the pinned Chromium/CDP engine; Playwright controls its loopback
bridge; `aphrody-web` is the Rust API; `@aphrody/web-crawl` is the Bun and Fetch
adapter; `aphrody-rag` owns local SQLite retrieval; Shenron owns Dragon Ball
policy and provenance. These are separate APIs and deployment inputs, not one
bundled browser or public search service.

## Read-only inventory snapshot

Workstation checkout observed 2026-11-01. This is a navigation aid, not a bill
of materials or a claim that each submodule is available on every host.

| Measure                                                                                                           |                                                      Observed value |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------: |
| Top-level directories in `crates/`, `packages/`, `apps/`, `factory/`, `infra/`, `scripts/`, `docs/`               |                                          571, 139, 62, 30, 7, 5, 19 |
| `.gitmodules` entries / parent-index direct gitlinks                                                              |                                                           346 / 346 |
| Recursive submodule-status entries                                                                                | 520: 161 matching checkouts, 358 uninitialized, 1 revision mismatch |
| Tracked manifests, READMEs, container recipes, service/timer units and agent guidance found by the snapshot query |                    5,619 paths, including nested vendor and tooling |

Review the revision mismatch and any modified vendor checkout before a release
that consumes it. Recursive counts can change with nested sources and pins.
Re-run the commands above for current inventory; do not use this snapshot as a
release claim.
