> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Update pipeline (`yolo update`)

Owner: Infra (`packages/infra/update`, package `@aphrody/update`, also reachable as `yolo ops update` and
`yolo ops deps-sync`). One entry point for toolchains, dependencies, the Cargo lock, user systemd units and the
dev-env checks. Bun, uv and the Tauri family follow the latest published release; see the policy below.

| Module | Command | What it does |
| --- | --- | --- |
| gate | `bun run update` | pins agree everywhere, user units linked, `/etc/wsl.conf` matches `tools/config/wsl/wsl.conf` (exit 1 on drift) |
| pins | `yolo update pins [check\|apply <tool> <version>]` | every hardcoded version of bun, uv, rust, nushell, oxlint, oxfmt, typescript (manifest: `tools/config/update/pins.json`, one regex capture per target, 30+ `engines` ranges included) |
| tools | `bun run update:tools` (`--apply`) | installed vs pinned vs latest (GitHub, PyPI, npm, crates.io); `--apply` installs the exact version (`uv self update <v>`, bun installer, `rustup toolchain install`, `cargo binstall nu@<v>`) and re-pins |
| cargo | `bun run update:cargo` (`--apply`) | `cargo update --dry-run`, or the lock refresh inside manifest ranges through `cargo-serial.sh`; snapshot in `target/update/` (not in repo) |
| deps | `bun run update:deps`, `yolo update deps <sub>` | `plan`, `apply` (Tauri family + `bun update -r`), `facts`, `fix`, `baseline`, `changelog`, `memory`, `inventory`, `run` |
| systemd | `bun run update:systemd`, `yolo update systemd install\|restart` | write the units rendered from the yolo unit catalog (`packages/engine/core/src/units/catalog.json` of the aphrody checkout, `APHRODY_YOLO_ROOT` or `~/src/aphrody`) into `~/.config/systemd/user` (differing copies are kept as `*.pre-update-<ts>`), `daemon-reload`, `try-restart` units that run bun or aphrody binaries |
| sources | `bun run sources` (status), `sources:verify`, `sources:sync`, `bun run update:sources` (drift), `yolo update sources <sub>` | the one owner of `~/source` checkouts, upstream pins, forks and git state, see below |
| tauri | `yolo ops tauri-sync [--check\|--apply]` (also run by `deps plan\|apply`) | the one owner of the Tauri crates, npm packages, mirrors (`../material/packages/m3/packages/scaffold/src/pins.ts`) and `$schema` URLs; honours `minimumReleaseAge`; its Cargo gate goes through `cargo-serial.sh` |
| rust | `bun run update:rust`, `yolo update rust status\|plan\|apply [--majors a,b]\|verify` | structured Rust bump: toolchain, lock refresh in range, majors one at a time, advisories vs `tools/config/deps/rust-holds.json`; every Cargo call goes through `cargo-serial.sh`. Doc: [update/RUST.md](./update/RUST.md) |
| rust doctor | `bun run rust:doctor`, `bun run rust:fix`, `yolo update rust doctor\|fix [--only a,b] [--skip a,b] [--strict] [--allow-dirty]` | one action for the whole Cargo workspace: lock, format, compile and lints, every member feature, wasm32 and Windows MSVC targets, tests, advisories and bumps; `fix` repairs lock pins, formatting and machine-applicable suggestions first, never in vendored or already-modified crates. Report: `target/update/rust-doctor/report.json` (not in repo). Doc: [update/RUST.md](./update/RUST.md#doctor-one-action-for-the-whole-workspace) |
| bun | `bun run update:bun`, `yolo update bun status\|plan\|apply [--majors a,b]\|verify\|rollback` | structured Bun/npm bump: runtime pins, release-age aware plan, majors after release notes, holds in `tools/config/deps/bun-holds.json`, snapshot and rollback under `target/update/bun/` (not in repo). Doc: [update/BUN.md](./update/BUN.md) |
| uv | `bun run update:uv`, `yolo update uv status\|plan\|apply [--upgrade-package a,b]\|verify\|rollback` | structured Python bump for `~/aphrody-py` (three `uv.lock` files), holds in `tools/config/deps/uv-holds.json`. Doc: [update/UV.md](./update/UV.md) |
| upstream | `bun run upstream`, `yolo update upstream list\|drift\|refresh\|fetch\|prune\|docs` | the reference upstream catalogue, see "Sources" below |
| all | `bun run update:run` | tools, cargo, deps, systemd restart, then the gate |

Everything except `check`, `pins` and `systemd check` is report-only until `--apply`.

## Dependency steps

- `facts [--all]`: GitHub release notes plus Context7 docs for the libraries in `tools/config/deps/watch.json` that changed
  -> `docs/research/workspace/deps/<date>.md`.
- `fix [--apply-fixes]`: runs the consumer gates (tsc, `cargo check`), subtracts `tools/config/deps/baseline.json`, matches
  `tools/config/deps/fix-rules.json`, writes `.coord/shared/deps-fix-<date>.md`. Only `kind: script` rules edit files.
- `inventory`: whole-repo scan (about 45 s, six-hour cache in `target/deps-inventory/cache` (not in repo) (generated or machine-local artifact; presence depends on the build host)) of `Cargo.lock` vs the
  crates.io sparse index, git remotes via `git ls-remote` (any host), `bun.lock` vs npm, Python pins vs PyPI, and one
  OSV.dev batch for advisories -> `docs/reference/workspace/DEPS-INVENTORY.md`.
- `changelog`: `CHANGELOG.md` from conventional commits (`tools/config/changelog.json`) and the journal.
- `memory`: managed block in each `~/.aphrody/workspaces/*/BOOT.md` and `memory/deps-state.md`.

Registries: crates.io, npm, GitHub (token from `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`), PyPI, Context7
(`https://context7.com/api/v1`, optional `CONTEXT7_API_KEY`), OSV.dev. No Go, Maven or other registry exists in the
repository; add a collector in `src/deps/inventory.ts` when one appears.

## Automation

- the `aphrody-update.timer` catalog entry (Mondays 06:00, `Persistent=true`): runs `tools`, `deps facts`, `check`
  and never applies. Only the pinned `rust-toolchain.toml` channel is installed (no floating `stable`/`nightly`); it
  moves through `tools --apply`. Cargo tools are installed as prebuilt binaries with `cargo binstall`.
- `.github/workflows/update.yml`: weekly report-only run on GitHub Actions.

## Rules

- Cargo is never bulk-updated to remove duplicate versions (repo rule). `cargo` refreshes the lock within the manifest
  ranges; majors need the manifest edited and the consumers fixed. The Tauri family is rewritten by `deps apply`.
- uv and bun: the release tag can precede the installer, so `tools --apply` pins what is actually installed.
- `portable-pty` stays on 0.8 (0.9.0 breaks headless Windows clients, see the desktop PTY note).
- Verification stays with the lead through `scripts/build/rust/cargo-serial.sh`; workers never run Cargo.
- `docs/ecosystem/CLI.md` is generated from code; do not edit it by hand.

## Sources, upstreams, forks and git

Manifest: `tools/config/upstream-sources.json`, two parts. `sources` (4 entries) are the only checkouts kept under `~/source`:
Cargo path dependencies with local patches (`git` or `crate`, `pinned`, optional `hold`, patches with a marker file).
`reference` (17 entries, tier `reference` or `build`) are upstreams that are never cloned by default; they are read live.
Overview, generated: [UPSTREAMS.md](../../reference/infra/UPSTREAMS.md). The native `aphrody git source` command reads
`sources`, read only. `tools/config/update/forks.json` lists the forks the repository depends on, each with the reason it stays.

| Command | What it does |
| --- | --- |
| `sources status\|verify\|sync [--apply] [--only <id>]` | restore and inspect the vital checkouts (clone or extract, apply missing patches; never touches an existing checkout's history). `sync --only <id>` also restores a `build`-tier reference (WSL build inputs) |
| `sources drift` | every pin against its remote head, newest tag or crates.io version (a `hold` is reported, not proposed), plus the Cargo git remotes of `Cargo.lock` classified as `rev`, `tag`, `branch` or `transitive` (only `rev` and `branch` can be "moved") |
| `sources forks` | each fork against its parent (GitHub compare API, or head comparison for detached forks) |
| `sources repo` | local repository: branch, ahead/behind, changed paths, stashes, remotes (also printed by `check`) |
| `sources bump [--only <id>] [--apply]` | move a pinned source to the newest head or version; held and unpinned entries are skipped. A scratch clone first proves the patches still apply; a failure writes `.coord/shared/sources-bump-<id>.md` and changes nothing. `--apply` rewrites the manifest, keeps the old checkout as `<id>.pre-bump-<ts>`, restores the new one, and rolls everything back if the result is not `ok`. Then check the Cargo consumers it prints |
| `sources pull [--apply] [--deps]` | fast-forward tracked, clean checkouts and record the new head as the manifest `commit`; Cargo path dependencies only with `--deps` |
| `sources prune [--apply]` | remove the `*.pre-bump-*` checkouts |
| `upstream list\|drift\|refresh\|fetch <id>\|prune\|docs` | the reference catalogue, see below |

Reference upstreams (codex, ollama, mistral.rs, vllm, WSL, ...) are accessed three ways, none of which clones:

- CLI: `aphrody git upstream list|info|tree|read|search <id> [path|query]` (native, `crates/infra/git/src/upstream.rs`).
- MCP: `upstream_list`, `upstream_info`, `upstream_tree`, `upstream_read`, `upstream_search` (`crates/ai/mcp`).
- Skill: `~/plugins/aphrody/skills/upstreams`.

`yolo update upstream drift` compares the observed commit of each entry with the remote head; `refresh --apply` records
the heads; `fetch <id> [--path <dir>]` makes a disposable shallow clone in `~/.cache/aphrody/upstream/<id>`;
`prune --apply [--cache]` removes every non-vital directory of `~/source` (clean ones only) and the cache; `docs --apply`
regenerates UPSTREAMS.md. The WSL build inputs (tier `build`) are restored only for a build
(`sources sync --only <id> --apply`) and pruned afterwards; build outputs live in `~/.local/share/aphrody/wsl-artifacts`
(`tools/config/os/wsl-build.json`), not in `~/source`.

`update run` reports `sources drift`, `upstream drift` and `forks` (or restores missing vital checkouts with `--apply`).
Bun: the runtime is the fork `aphrody-labs/bun`, updated from `oven-sh/bun` inside the fork; see [Bun in Aphrody](../../reference/upstream-bun/APHRODY-FORK.md). It has no `bun:aphrody` module.

## Advisories, holds and release age

- `tools/config/deps/advisory-holds.json`: advisories that cannot be fixed yet (`ecosystem`, `name`, `reason`). `inventory` splits
  OSV findings into Open (a newer release exists), Open (no newer release) and Held, so only the first two need work.
  Current holds: yara-x pinned `=1.7.0` (1.19-1.21 need wasmtime 43-45 whose advisories are fixed only in 46.0.3+).
- `bunfig.toml` `minimumReleaseAge` delays new npm releases; `minimumReleaseAgeExcludes` lists the packages that follow
  the latest immediately (Tauri JS, Next and its `@next/*` binaries, nodemailer, undici). `tauri-sync` honours the list.
- `tools/config/upstream-sources.json` `hold`: a pin that must not move and why.
- The npm collector of `inventory` retries on HTTP 429 with the `Retry-After` delay and runs 8 requests at a time.
