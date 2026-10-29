<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bun OS monorepo

Entry page for the canonical Bun OS workspace (`aphrody-labs/bun-os` (renamed from `aphrody-labs/bun-distribution` on 2026-10-25), branch `os`; forge
`bun-forge:aphrody-dev/bun-os`). It states the rules, the measured state and the open decisions, and links to
the pages that own the details. Generated data is not copied here: see
[`generated/component-inventory.json`](generated/component-inventory.json) (regenerate with
`bun run workspace:source --out docs/generated/component-inventory.json`) and
[`cargo-exceptions.json`](cargo-exceptions.json). The owner goal is
[bun-os-consolidation](agent-goals/bun-os-consolidation.md); unfinished delivery work is in the
[backlog](agent-goals/active-delivery-backlog.md).

## Layout

| Path | Holds |
| --- | --- |
| `apps/` | Applications: WebOS (`apps/webos`, `apps/webos-server`), the Craft studios and their `-cli`/`-web` pairs, Drive, desktop, Android hosts |
| `packages/` | Bun and TypeScript packages, one direct child per member (Bun Engine in `packages/bun-engine`) |
| `crates/` | Rust crates, one direct child per member, most of them flat Git submodules |
| `vendor/` | External pinned owners and third-party sources (Bazzite, Omarchy, CachyOS, ChimeraOS, RetroArch, emulators); not Cargo members |
| `toolchains/` | Legacy: held the abandoned Bun runtime fork (`toolchains/bun`, removed). The runtime is now unmodified upstream Bun, pinned by `packageManager` in `package.json` (`bun@1.4.4-canary.20261028.1`) |
| `factory/` | OS composition: Arch package profile, `/usr` composition, container images (`factory/images/*`), qualification |
| `infra/` | Routes, hosts, runtime pins, shared assets and deployment control |
| `docs/` | Documentation; this page, [architecture](architecture.md), [builds](APP-BUILDS.md), [qualification](NATIVE-QUALIFICATION.md) |
| `replica/` | Recon, screens and feature matrices for reference products (study only) |
| `scripts/`, `src/` | Root CLI (`bun src/cli.ts`), release and workspace tooling |

## Ownership rules

- One root Bun workspace: a single tracked `bun.lock`; no nested Bun lockfile (`workspace check` enforces it).
- One root Cargo workspace: one nightly (`rust-toolchain.toml`), one `Cargo.lock`, shared
  `[workspace.dependencies]`. Nested `[workspace]` manifests and `Cargo.lock` files are allowed only if
  listed in the [exceptions ledger](cargo-exceptions.md) (`migrate` entries are temporary).
- Product Rust crates are flat: `crates/<package-name>`, one level, each a pinned Git submodule that keeps its
  history and license notices. See [CRATE-MIGRATION](CRATE-MIGRATION.md) and [crate-submodules](crate-submodules.md).
- External owners stay external and pinned until a deliberate migration: Bazzite
  ([forks](bun-os/BAZZITE-FORKS.md)), Omarchy, CachyOS, ChimeraOS, RetroArch (`vendor/retroarch`), the Bun fork.
  Upstream licenses and histories are preserved; nothing is merged into the Arch factory.
- Workstation edits and synchronizes; builds and qualification run on the VPS only. No new worktrees.
  Commits are `aphrody-dev <contact@aphrody.com>`, explicit paths, fetch before push, never force-push.

## Build and check

Native Bun commands only; never `bunx`, `tsc`, ESLint or Prettier:

```sh
bun check          # type check (native)
bun lint           # native lint
bun fmt            # native format (use `bun run format:check` to only check)
bun src/cli.ts workspace check       # root invariants and the exceptions ledger
bun scripts/cargo.ts metadata        # members-contract workspace report
bun scripts/cargo.ts check           # serialized `cargo check --locked --workspace`
```

Use the serialized wrapper `scripts/cargo.ts` for Cargo, with at most four compiler jobs per lane
(`CARGO_BUILD_JOBS=4`). `bun scripts/cargo.ts exec -- <cargo args>` forwards arguments. Run builds and
qualification on the VPS (`ssh vps`, checkout `~/src/bun-os`); do not start WSL on the workstation.
On a fresh checkout `bun run setup` prepares the submodules and `build/packages/material-web.tgz` that the
root `bun.lock` expects, then `bun install --frozen-lockfile`.

## Consolidated and open

Measured on `origin/os` at `15d3c89088` (`bun src/cli.ts workspace check`: 0 violations).

| Item | Target | Now |
| --- | --- | --- |
| Cargo workspace members | one root workspace | 682 declared, 693 resolved by `cargo metadata --locked` (11 path dependencies join automatically); 36 excluded paths |
| Nested `[workspace]` manifests | 0 | 24 tracked: 22 outside `vendor/`/`toolchains/` (ledger: 5 `migrate`, 6 `example`, 3 `fixture`, 8 `fuzz`) and 2 inside |
| Nested `Cargo.lock` | 0 | 21 ledgered outside `vendor/`/`toolchains/` (8 `migrate`); 447 tracked in all, mostly vendored |
| Bun lockfiles | one `bun.lock` | one |
| Git submodules | pinned, initialised on demand | 168 declared at the root; 155 initialised on the VPS checkout, 65 on the workstation |
| Flat members | every member `crates/<name>`, `apps/<name>`, `packages/<name>` | 19 formerly non-flat: 6 `tools/bevy/*` are flat now; `tools/bevy/ci` and 12 `crates/bevy*` members remain |

Still open: the four `migrate` workspaces (`apps/desktop/src-tauri`,
`apps/figcraft/plugins`, `apps/m3-published-consumer`, `packages/bun-tauri`), `crates/sqlite_tasks`,
unflattened Bevy members, active Cargo vendor source replacement, native qualification of the whole
graph ([NATIVE-QUALIFICATION](NATIVE-QUALIFICATION.md)), and the Aphrody/Bun unification as a whole.

## Products

- **WebOS** at https://aphrody.com: `apps/webos` (Cloudflare Worker plus shell), Craft studios, Drive.
  See [webos/README](webos/README.md). The Worker deploys from `.gitea/workflows/aphrody-sites.yaml` on every
  `os` push and hourly, and needs the protected `CLOUDFLARE_API_TOKEN` of that environment.
- **Bun Engine** (`packages/bun-engine`, `crates/bun-engine-core`, [docs](bun-engine/README.md)): emulation and
  console runtime, with the console-style library UI (covers, profiles, gamescope session) and
  libretroarch embedded through `bun:ffi`. [Homebrew showcase](bun-engine/HOMEBREW.md).
- **Factory images** (`factory/images/*`): `bunos-gaming`, `bunos-omarchy`, `bunos-alpine`, `bunos-ubuntu`,
  `bunos-disk`; server, COSMIC desktop and Gamescope gaming stay separate compositions. No image is built
  from the Bazzite fork set yet. See [factory/README](../factory/README.md).
- **Bun site** on `bun.aphrody.com` and `bun.aphrody.app`: Worker `aphrody-app`, owned by the Bun repository,
  not routed by the WebOS catalog.

## Domains and redirects

https://aphrody.com is the canonical origin; product hosts answer a 301 to a path of it, from
`infra/config/routes.catalog.json`. Hosts, Cloudflare state and the `aphrody.app` redirect rule to
`bun.aphrody.app` are recorded in [APP-DOMAINS](APP-DOMAINS.md). Cloudflare changes go through the
Cloudflare MCP.

## Release process

`bun scripts/release.ts <verify|plan|npm|crates|all> [--apply]` is the one entry point; nothing publishes
without `--apply`. Stages: `verify` (check, lint, format check, docs check, manifests), `plan` (what npm and
crates.io lack), `npm` (dependency order, owned scope `@aphrody`), `crates` (dependency
order, `--limit`, `--pause`). Stages are idempotent: a published version is skipped. Credentials come from the
environment only (`NPM_CONFIG_TOKEN`, `CARGO_REGISTRY_TOKEN`). `.github/workflows/release.yml` runs verify,
binaries, npm and crates on a `v*` tag or a manual dispatch (dry run unless `publish` is set).
Change history: [CHANGELOG](../CHANGELOG.md).

## Release state

Measured on 2026-10-22 and 2026-10-23 on the VPS, read-only toward registries and CI (nothing published, no
workflow triggered, no tag). Tree: `origin/os` at `56018b4aa7`, plus the `bun.lock` fix described below.

**`bun scripts/release.ts verify`** (Bun 1.4.5 on the VPS; the repo pins 1.4.4):

| Gate | Result |
| --- | --- |
| `check` | pass, 464 files, no type errors (the commits before `4c89f254ec` failed on a missing `cover` in `frontend/cli.ts`) |
| `lint` | pass, 5923 files |
| `format:check` | fails: 141 files differ (85 `packages/`, 19 `factory/`, 17 `scripts/`, 7 `src/`). `verify` stops here. Not reformatted: `bun fmt` would rewrite whole files, so it needs its own reviewed commit |
| `docs:check` | pass, 53 pages (54 with this page), links resolve |
| manifests | `scripts/workspace-manifests.ts` is a generator, not a check: it exits 0 and rewrites the root `package.json`, `tsconfig.json` and about twenty member manifests (adds a package to the workspaces, which then breaks `check`). The rewrite was reverted; the gate proves nothing and needs a `--check` mode |

Other findings: `bun install --frozen-lockfile` failed because `bun.lock` lacked the `@aphrody/identity` and
`@aphrody/m3` links of `packages/artcraft-frontend` and `apps/artcraft-web-app`; fixed (4 lines). A fresh
checkout also needs `build/packages/material-web.tgz` (ignored; `bun run setup` builds it). `bun scripts/cargo.ts
exec -- metadata ...` exits 1 without output; plain `cargo metadata --no-deps --locked` resolves 693 members.

**`plan`** (same logic as `release.ts plan`, plus the missing set by dependency layer; one request at a time):

| Registry | Local | Unpublished | Notes |
| --- | --- | --- | --- |
| npm | 434 public packages in `@aphrody` (`packages/*`, `apps/*`) | 2 | `@aphrody/paths`, `@aphrody/canvas`; both have no unpublished dependency. Other scopes (for example `@storyteller`) are skipped by design |
| crates.io | 574 publishable crates (693 members, the rest `publish = false`) | 486 | 12 dependency layers of 130, 76, 66, 65, 52, 32, 22, 16, 13, 8, 4 and 2 crates. Layer 0 includes `aphrody-patch`, `aphrody-a2a`, `aphrody-config`, `aphrody-secrets`, `aphrody-guard`, `aphrody-agent-proto`, `aphrody-sql`, `aphrody-http-error`, `aphrody-app-protocol`, `aphrody-subsystem`; layer 1 starts with `aphrody-toolcall-repair`, `aphrody-a2a-pb`, `aphrody-models`, `aphrody-mcp-client`, `aphrody-nie-core` |

At the workflow default (`--limit 5 --pause 600`) the crates stage publishes five crates per run, so 486 crates
need about 100 runs and, with crates.io's new-crate rate limit, days of wall time. `release.yml` also rebuilds
the workspace in a runner without VPS caches. Credentials were not available or sought; no publish was tried
(`cargo publish --dry-run` was not run either).

**GitHub mirror**: `aphrody-labs/bun-os` (private, default `main`, last push 2026-10-18) has no `os` branch
(`gh api repos/aphrody-labs/bun-os/branches/os` returns 404); its `main` is at `4958106d85` (2026-10-13). The
`github` remote of this checkout is `aphrody-labs/bun-distribution`, whose `os` is at `72de9550bc`
(2026-10-22 17:00 UTC): it diverged from forge `os` at `8bd8125be5`, with one commit
(`pdfcraft-preflight`) that forge `os` lacks and 57 commits behind it. Neither mirror is current.

**Verdict**: not ready to release. Blockers: `format:check` (141 files), the manifests gate that does not
verify, the 486 unpublished crates (12 layers) and the two npm packages, absent publish credentials in the
workflow environment (not checked), and non-current GitHub mirrors, on which `release.yml` runs.

## Open decisions

1. **`crates/sqlite_tasks`**: SQLx 0.7 cannot join the root graph (`links = "sqlite3"` conflict). Decide:
   rewrite onto the `aphrody-sql` rusqlite owner (preserve the `_sqlx_migrations` history), or move the
   root to a shared SQLx. It stays excluded meanwhile.
2. **Bevy member names**: no owner rule names the flat form of `tools/bevy/ci` (the only member outside
   `apps/`, `packages/`, `crates/`) or of the 12 nested members (`bevy_derive|ecs|reflect/compile_fail`;
   `crates/bevy/{benches,errors,examples/*}`). Options: split each into a `crates/<name>` submodule (needs
   history splits and collision-free names), or keep them nested inside the pinned `crates/bevy` owner and
   record the exception. No name is chosen here.
3. **WebOS Worker deploy** runs only from `.gitea/workflows/aphrody-sites.yaml`; the first run proving the
   protected token is configured is still pending, and GitHub `release.yml` does not deploy it.
4. **GitHub mirror**: `aphrody-labs/bun-os` has no `os` branch (see Release state); decide whether it is a
   mirror of `os` or a separate repository, because the `github` remote of this checkout is
   `aphrody-labs/bun-distribution`. Resolved 2026-10-25: `aphrody-labs/bun-distribution` was renamed
   `aphrody-labs/bun-os` (default branch `os`) and the former `aphrody-labs/bun-os` became the archived
   `aphrody-labs/bun-os-legacy`.
5. **Migrate-class workspaces** (five) and the `Cargo.lock` stanza of the removed `aphrody-rg-server`
   package (see `PLAN.md`).
