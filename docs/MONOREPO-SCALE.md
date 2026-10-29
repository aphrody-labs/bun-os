# Monorepo at scale

bun-os is one git repository of about 71,300 tracked files, 183 submodules (153 under `vendor/`), 635+ Cargo packages and 150+ Bun
workspaces, with a 1.4 GB `.git`. This page records which tools already existed, what was adopted, what was extended, the git
settings and why, and the numbers measured on the maintainer workstation (Windows 11, NTFS, git 2.55.0.windows.5, Scalar included).
No new package was created: every addition lives in `packages/bun-workspace` (`aphrody-bun git ...`).

## 1. What already existed

| Where | What it does | Relevant to scale? |
| --- | --- | --- |
| `crates/bun-os-git` (`bun_git`) | gix + octocrab: inspect a repository, history, hotspots, GitHub API, ingest | Read-only (gix); no sparse-checkout, maintenance or submodule writers, so mutations shell out to `git` |
| `crates/aphrody-infra` (`aphrody infra`) | infra orchestrator; its `maintenance` command is Cargo workspace upkeep | Not git maintenance |
| `packages/bun-workspace` (`aphrody-bun`) | `doctor`, `status`, `sync`, `list` over the pinned library modules | Extended below |
| `factory/bunos/workspace-graph.ts`, `check-components.ts` | Cargo/npm membership and component edges, from tracked files | Graph reused by turbo; not used for diffs |
| `scripts/workspace-manifests.ts` | one version and `workspace:*` ownership for `packages/*`, `apps/*` | Generates the `workspaces` list |
| `turbo.json` + `turbo` 2.11.8 (catalog) | task graph | Had a cyclic `typecheck` dependency, fixed |
| `scripts/setup.ts` | `git submodule update --init --depth 1` for every submodule not `update = none` | The lever: a profile marks the rest `none` |
| `.github/actions/setup-workspace` | full recursive submodule checkout in every job | Replaced by profiles (section 5) |

## 2. Tool survey and decision

Versions and dates read with `gh api` on 2026-10-29.

| Tool | Latest release (date) | Decision | Reason |
| --- | --- | --- | --- |
| Turborepo (vercel/turborepo) | v2.11.10 (2026-10-20); repo pins 2.11.8 | Adopt | `turbo run --affected` verified in 2.11.8 `run --help`; `turbo prune` available; local and remote cache |
| Scalar (in git; microsoft/git v2.56.0.vfs.0.4, 2026-10-26) | `scalar version` = git 2.55.0.windows.5 | Adopt | `scalar clone` = blobless + sparse + fsmonitor + maintenance; used by `aphrody-bun git clone` when present |
| git maintenance / fsmonitor / sparse-checkout / partial clone | git 2.55 | Adopt | Core git, documented below |
| `git backfill` | in git 2.55 (`git backfill -h` works) | Extend (doctor reports it) | Experimental per its manual; not run automatically |
| Nx (nrwl/nx) | 24.0.2 (2026-10-26) | Reject | Second task runner next to turbo; no gain for this repo |
| Sapling, jj, git-branchless | 0.2.20261028, v0.46.0, v0.11.1 | Reject | Change the client VCS; the problem is checkout size, solved inside git |
| VFSForGit | v2.0.26281.1 (2026-10-08) | Reject | Scalar is shipped in git and covers the same need |
| git-sizer | v1.5.0 (2021-11-16) | Defer | Diagnostic only, stale; run by hand if needed |
| git-filter-repo | v2.47.0 (2024-12-04) | Reject | History rewrite is forbidden here (no force-push) |
| git-lfs | v3.8.1 (2026-10-22) | Defer | No oversized binaries measured; revisit if `git-sizer` finds some |
| release-plz, changesets | 0.4.2, @changesets/cli 3.0.3 | Out of scope | `scripts/release.ts` already owns releases |
| ghq, mani, gita, vcstool, west | v1.11.2, v0.32.1, no release, no release, v1.5.0 | Reject | They manage many independent repositories; here the 183 submodules are pinned by one superproject |

## 3. Recommended per-clone configuration

`aphrody-bun git setup` writes these with `git config --local`, only when the value differs (idempotent, test-covered). Every entry is
from git's manual (Context7 `/git/git`, `git-config`, `git-maintenance`):

| Key | Value | Source and reason |
| --- | --- | --- |
| `core.fsmonitor` | true (Windows, macOS) | built-in daemon; only on those platforms |
| `core.untrackedCache` | true | `feature.manyFiles` doc; needs working mtime |
| `feature.manyFiles` | true | `index.version=4`, `index.skipHash`, untracked cache |
| `core.preloadIndex` | true | parallel index refresh |
| `core.longpaths` | true (Windows) | paths over MAX_PATH |
| `core.multiPackIndex` | true | the `incremental-repack` task skips itself with a warning when it is off (builtin/gc.c) |
| `fetch.writeCommitGraph` | true | commit-graph refreshed after fetch (default false) |
| `protocol.version` | 2 | partial clone and ref filtering |
| `submodule.fetchJobs` | 8 | parallel submodule clone/fetch (default 1) |
| `submodule.recurse` | false | no recursion into 183 submodules by default |
| `maintenance.strategy` | incremental | prefetch + commit-graph hourly, loose-objects + incremental-repack daily, no `gc` |
| `blame.ignoreRevsFile` | `.git-blame-ignore-revs` | mass-format commits |

`setup` also writes the commit-graph (`--changed-paths --split`) and runs `git maintenance register`; `--scheduler` runs
`git maintenance start` (installs the OS scheduler job). `--fast-status` sets `diff.ignoreSubmodules=dirty`: `status` stops scanning
initialised submodule work trees (measured below); it hides uncommitted edits inside submodules, so it is opt-in.

In `.gitmodules` (git manual: `update` accepts checkout, rebase, merge, none, never `!command`): `shallow = true` on all 183
submodules, `update = none` on the 11 kernel/LLVM/Wine/Proton sources that the Windows CI already skipped. `aphrody-bun git generate
gitmodules` re-applies it. Profiles that need an optional submodule override it locally.

## 4. Profiles (`packages/bun-workspace/config/git-profiles.json`)

`aphrody-bun git profile <name>` runs `git sparse-checkout set --cone <dirs>` (cone mode takes directories only; top-level files are
always present), then `git submodule update --init --depth 1 --jobs 8` for the profile's submodules. Gitlink paths are removed from the
cone because git rejects them. Commands: `doctor`, `setup`, `profile <name|list>`, `clone`, `status`, `prune`, `measure`,
`ci-prepare`, `affected`, `generate attributes|codeowners|ignore-revs|gitmodules`.

| Profile | Use |
| --- | --- |
| `core` | factory, scripts, docs, infra, tools: gates that read tracked files |
| `rust-workspace` | crates, vendor/cargo, apps, tools, bun-tauri, uutils + 12 shallow submodules; verified with `cargo metadata --offline --no-deps` |
| `web` | apps, packages, design system, fonts |
| `kernel-distro` | vendor, container, infra; `includeOptional` fetches the kernel/Wine/LLVM sources |
| `vendor-minimal` | crates + vendor/cargo only |
| `ci` | everything first-party plus the vendor trees Cargo and Bun workspaces reference; skips about 163 of 183 submodules |
| `all` | disables sparse-checkout |

`rust-workspace` was found by iterating `cargo metadata` against a sparse clone (it failed on missing `packages/bun-windows-winclean`,
`tools/bevy/ci`, gitlinked crates such as `crates/apkeep`, until each was added); the profile now loads all 635+ manifests.

## 5. CI

* `setup-workspace` takes `profile` (default `all` = the old full checkout, so `release.yml` and `aphrody-sites.yml` are unchanged; `ci.yml` passes `ci`). It runs
  `bun packages/bun-workspace/src/git-cli.ts ci-prepare <profile>` before `bun run setup`: cone for the profile and `update = none`
  for every submodule outside it, so the unchanged `scripts/setup.ts` fetches only the profile. The Windows long-path and
  skip-submodule step is kept.
* `ci.yml` checks out with `filter: blob:none` and a bootstrap sparse cone (`.github`, `packages/bun-workspace`).
* New `plan` job: `git diff <base>...HEAD` classified by path (`git-affected.ts`: js, rust, docs, distro, all). The `rust` job runs only
  when Rust paths or global files (`.github`, `turbo.json`, `.gitmodules`, toolchain) change; an unknown base runs everything.
* Caches: `.git/modules` (key from `.gitmodules` + `sources.lock.json`), plus the existing Bun and Cargo caches.
* Package-level selection: `bun run affected` = `turbo run typecheck lint --affected` (base from `TURBO_SCM_BASE`). Remote cache needs
  `TURBO_TOKEN` and `TURBO_TEAM` in the environment (not set; local cache only until the owner provides them).

## 6. Measurements (this workstation, before and after)

Source repository: local file clone of this repository (no network), median of 3.

| Measure | Before | After |
| --- | --- | --- |
| Clone, full checkout (71,312 files, `.git` 1.5 GB) | 122.7 s | blobless + sparse root: 29.8 s, 31 files, `.git` 70 MB |
| Then `profile core` (5,044 files) | | +11.0 s, `.git` 173 MB |
| Then `profile all` without submodules | | +102 s, `.git` 546 MB |
| `profile rust-workspace` incl. 12 shallow submodules | | 51 s first time (network), 10.6 s re-apply; `cargo metadata` OK |
| `git status`, full tree, settings off (`-c` overrides) | 3,618 ms | 224 ms (fsmonitor + untracked cache + manyFiles + preload) |
| `git status`, `core` profile | | 272 ms first, 82 ms warm |
| `git status`, 12 submodules initialised | 6,901 ms | 948 ms with `diff.ignoreSubmodules=dirty` (opt-in) |
| `git log -n 1000 -- crates` | 260 ms | 125 ms (commit-graph) |
| `git fetch --dry-run` no-op | 914 ms | 1,154 ms (noise; no gain claimed) |

Reproduce: `bun packages/bun-workspace/src/git-cli.ts measure`.

## 7. Only CI can confirm

* The `ci` profile and the new `setup-workspace` flow on ubuntu and windows runners (sparse + blobless checkout, `bun install
  --frozen-lockfile`, `scripts/setup.ts` with 163 submodules `update = none`, Cargo with the reduced vendor tree).
* GitHub-side clone and CI setup times (the 10 to 30 minute figures are network bound; here the source was local).
* `.git/modules` cache hit rate and size; `plan` job base resolution on push, PR and `workflow_dispatch`.
* That the `ci` profile is enough for every `ci.yml` step; `release.yml` and `aphrody-sites.yml` keep `profile: all` (default) but inherit the 11 `update = none` sources from `.gitmodules`.
* `CODEOWNERS` owners are a single placeholder (`@aphrody-dev`); GitHub validates them on push.
