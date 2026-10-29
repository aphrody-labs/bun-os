> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# Tooling

One workspace, one set of commands (`just --list`).

| Task | Command |
| :--- | :--- |
| Status of submodules, vendored crates and the workspace | `just status` |
| TypeScript, oxlint, oxfmt, rustfmt, clippy | `just check` |
| Bun tests | `just test` |
| Rust tests (cargo-nextest, default members) | `just test-crates` |
| Minimal native core, strict Clippy | `just check-core`, `just clippy` |
| Optional provider gates | `just qualify-desktop`, `just qualify-browser`, `just qualify-python`, `just qualify-upstream` |
| Pinned provider build through Workspace | `just factory core\|bun\|desktop\|browser\|python\|tooling\|upstream <full-sha>` |
| Native Bun fork release, inside the declared factory | `just qualify-bun` |
| Everything | `just test-all` |
| The repository gates as one parallel, measured report (JSON or Markdown) | `yolo verify [--only a,b] [--changed] [--json|--md]`, `--list`, `--last` |
| Licenses / advisories / sources | `just deny` |
| Web frontend | `just web-build`, `just web-dev` |
| Desktop app | `just desktop-build` |
| Forked Tauri CLI (`cargo tauri`) | `just install-cli` |
| Native runtime (C ABI, SDK, artifact) | `just runtime-build`, `just runtime-test`, `just runtime-package` |
| Native JS/TS core: Oxc lint/format/parse/minify and n2b | `just qualify-tooling`, `just tooling-build`, `yolo n2b --help`; [ownership and limits](JS-TS-TOOLING.md) |
| awesome-bun browser (`oven-sh/awesome-bun`, no clone) | `just awesome stats|list|search|github|check` |
| Stack scaffold (`templates/stack.toml`, `templates/`) | `just create <dir> --with web,desktop --framework hono` |
| Curated awesome-bun for the Rust-based Bun | `just awesome-curate`, `just awesome search <words>` |
| Vendoring | `just import-scan`, `just import`, `just vendor-update`, `just import-check` |
| Linux server (audit, reclaim, archive, services, tune, net, mount; plan by default) | `just host audit --host vps`, see [SERVER.md](../../operations/infra/SERVER.md) |
| Docs | `just docs-build` |
| Publishing (dry run) | `just publish-dry` |

## Evidence for agents (`yolo verify`)

`yolo verify` runs the gates of `just check` and `just test` as a dependency graph: typecheck, lint, format,
Bun tests, rustfmt, the mdBook build, the import reproducibility check and `git diff --check`. Independent gates start
together, at most `--parallel` (default: the CPU count) run at once, and a gate whose dependency failed is skipped with
that reason. `--changed` selects only the gates whose file surfaces match the working tree, `--only a,b` picks gates,
`--list` prints the gates with their commands, dependencies and surfaces (`yolo.verify.gates/1`).

The report (`yolo.verify/1`, `--json`, or Markdown with `--md`, the default) holds, per gate, the status, exit code,
start offset and duration in milliseconds, the output tail of a failure and the reason of a skip, plus the commit,
whether the tree was dirty, the wall time, the summed gate time and their ratio. It is written to `var/verify/latest.json` (not in repo)
and a timestamped copy, and `yolo verify --last` prints it again. Exit code 0 means every selected gate passed, 1 that
one failed or was skipped, 2 a usage error.

Gates that were not run are listed, never omitted: the heavy checks that CLAUDE.md sends to the build factory
(clippy, nextest, `cargo check --workspace`, `cargo deny`, the native runtime build) appear under "Not run" with the
reason. Each gate runs in its own process group, so a timeout (`--timeout`, default 900 s) kills its children as well.
Measured on this repository: 13.1 s serial against 4.2 s with 16 in parallel, same results. Tests:
`test/verify.test.ts` (scheduler with a fake runner, dependency skips, the parallel bound, reports, real processes).

## Cargo workspace

- `Cargo.toml`: resolver 3, `members = ["crates/*"]`.
- `default-members` contains only `yolo-core` and `yolo-runtime`. All 117 members
  from the original inventory remain available through explicit provider/upstream recipes. The transferred tooling crates are additional members. Core commands use
  `--locked --no-default-features`; they do not enable desktop, browser or Python.
- Root Cargo recipes use `YOLO_CARGO_WRAPPER`, defaulting to Aphrody's installed
  `scripts/build/rust/cargo-serial.sh`. The wrapper keeps its shared lock, sccache
  and resource guard. `just factory <profile> <full-sha>` routes through the native
  Workspace owner; routing alone does not acquire missing toolchains or qualify an artifact
  merely by dispatching a job.
- `rust-toolchain.toml`: stable with rustfmt and clippy. `rustfmt.toml` is the Tauri style and applies
  to our crates; every vendored crate carries the `rustfmt.toml` of its upstream repository.
- The default `rust-fmt` gate selects the two core crates. The former global
  format check remains `just rust-fmt-upstream-check` and in the optional CI job.
  `cargo fmt --all` can traverse external path dependencies even when they are
  excluded from workspace membership. On the concurrent tree examined on
  2026-10-05, it reports differences in 103 Obscura files; no engine is reformatted
  by this reorganization.
- `.cargo/config.toml`: `__TAURI_WORKSPACE__` and the macOS linker flags.
- `deny.toml`: cargo-deny policy.

CI separates the minimal Rust job from desktop/imported-source coverage. The
five-target runtime and release matrices select only the core. Browser and
compiler recipes require their producer sources and toolchains; GitHub workflow
definitions are not evidence that those jobs ran. The current Aphrody consumer
already verifies a pinned ABI 1.4 SDK/runtime without building the workspace.
Its desktop/browser replacement still requires qualified provider artifacts.

Bun is built in its own repository, the [aphrody-labs/bun fork](../../reference/upstream-bun/APHRODY-FORK.md)
(`bun bd` for debug, `bun scripts/build.ts --profile=release` or the fork workflow `aphrody-release.yml` for
releases). Aphrody carries no vendored Bun checkout. `just qualify-bun` qualifies the fork: with a local checkout
(`APHRODY_BUN_CHECKOUT`, default `../bun`) it runs the fork's `scope.ts --check`, reports the lag behind
`upstream/main` (merged by the fork's `sync-upstream.ts`) and has `yolo forge` build that checkout; without one,
forge clones the fork from GitHub.

## Layout

```
apps/        cli (yolo), web (frontend)
crates/      yolo-core, aphrody-* (dont aphrody-app, hôte desktop) (generated by `yolo import`)
vendor/      git submodules: pinned fork sources (+ bun, obscura, which stay standalone)
packages/    JS packages (`runtime` = @aphrody/runtime-sdk)
templates/   stack.toml and the `yolo create` templates
patches/     patches proposed to consumers
scripts/     vendor/ (upstream sync/tracker, npm publishing) and release/ (release, runtime artifact, SDK, ship_remote.sh)
test/        Bun tests
docs/        mdBook (this documentation)
```

## Building and releasing (`yolo ship`)

**Observed on 2026-10-04:** native SSH probes find Bun 1.4.2, Rust 1.98.1,
sccache 0.18.0 and uv 0.12.23 on `vps`. Workspace now declares the Yolo source
checkout at `/home/ubuntu/src/yolo`. Preparation and a scoped Cargo
check were dispatched under the shared heavy lock; completion is still pending.

The active committed-history workflow is `yolo ops repo-sync`: exactly Yolo
(`dev` to remote `main`), and Aphrody (`main` to remote `main`).
It watches Git refs with a 250 ms debounce and a 60 s fallback, fetches and checks
ancestry before a normal push, then prepares the exact synchronized SHA over
native Infra SSH. Pending builds retain the newest SHA per repository while a
live job keeps its handle. Dirty source files are never staged or committed.

```sh
yolo ops repo-sync plan --build --json
yolo ops repo-sync watch --apply --build --json
yolo ops repo-sync status --json
systemctl --user status aphrody-source-sync.service
```

The installed user service runs the owner CLI directly. `KillMode=process`
lets a stopped watcher release its lock while preserving active factory workers;
the next watcher adopts their handles. Private state and logs live in
`~/.aphrody/state/commit-sync/`, outside Git. Configuration and build profiles
belong to [Aphrody commit-sync](../../../../tools/aphrody/config/commit-sync.json).

Yolo's bounded profile is `bash scripts/release/factory-current.sh`: scoped native
check/test/strict Clippy, runtime build, artifact/SDK packaging, compiled CLI,
and install/deploy smoke. Cargo uses the declared serialization wrapper and
sccache. A queued build is not a successful build; current status belongs to the
live job receipt. Native status shows the watcher, safe lifecycle fields and the
pending SHA for each repository. Restart adoption requires a fresh response from
the matching worker; an ambiguous launch holds the queue for reconciliation.
Worker lifecycle receipts remain owned by their worker. Rollback acceptance
additionally requires a previous compatible
artifact. See the synchronization receipt.

The following describes the older full-engine `ship` pipeline. Its unlimited
job count and resource settings still require separate qualification before use.

`yolo ship [--apply] [--sha X] [--force] [--wait]` (refuses below the free-space floor of the build host, 20 % by default and variable, see [SERVER.md](../../operations/infra/SERVER.md)) is this repository's CI and release host: GitHub
Actions is not available to it (billing), so the Aphrody build factory runs the gates of
`.github/workflows/ci.yml` (not in repo), the runtime artifact, the release assets and the D0/D2 install/deploy
smoke instead, as `yolo/ship` commit statuses. Each build is a detached tmux session
(`yolo-ship-<sha12>`, survives an ssh disconnect) running `scripts/release/ship_unit.sh`, which
serializes behind the Aphrody heavy lock, checks the commit and its submodules out, then runs
`scripts/release/ship_remote.sh` as a transient systemd unit with the cgroup CPU/memory/swap
ceilings lifted. A build already running for a commit is left alone unless `--force`; `.coord`
gets a claim naming the lock and the session so another agent does not stop it by mistake. When
the built commit is the `v<VERSION>` tag and `main` contains it, `scripts/release/publish_remote.sh`
publishes the GitHub release the same way `.github/workflows/release.yml` (not in repo)'s `publish` job would.

```sh
bun run cli ship --apply --wait   # fetch HEAD, build, block until ok/failed/stopped
bun run cli ship status|log|attach|stop [--sha X]
```

Transport is git and `gh` only (the workspace is a clone on the build host, fetched and checked
out there, never pushed to from this machine); `yolo hooks install` runs it, detached, on every
push to `main`/`dev`. Tests: `bun test test/aphrody.test.ts` (pure functions: the commands it
would run, the `.coord` claim; no network, no remote access).

## Server management (`yolo host`)

`yolo host <audit|reclaim|archive|services|tune|net|mount|journal> --host vps|dbfr|local` manages a Linux
server through `aphrody-infra ssh exec` (the local host runs commands directly). Every subcommand is a plan
until `--apply`, applied steps are journaled in `var/host/<host>/journal.jsonl`, and the safety rules are
hard-coded in `packages/engine/yolo/src/host-safety.ts`. Policy lives in `host-policy.toml`. Full description, the Bun
feature map and the verification status are in [SERVER.md](../../operations/infra/SERVER.md); the decision is D26 in
[DECISIONS.md](../../decisions/runtime/DECISIONS.md). Tests: `bun test test/host.test.ts` (no network, no remote access; the
`--apply` paths run on `local` in temporary directories).


## Agent plugins

The private plugin store is the pinned `plugins` Git submodule. Each bundle keeps its private Git history and generated Claude/Codex/agy compatibility manifests. `~/plugins` is a compatibility alias; Workspace uses the physical store via `APHRODY_PLUGINS_ROOT`.

The canonical `yolo` plugin merges Bun/TypeScript and Yolo guidance, with both predecessor histories retained. `aphrody-web` routes to Rust Web/Obscura, and `aphrody-google` to Aphrody Google/M3 owners and selected official Google sources. There is no separate Bun/TS7 registration or legacy Web runtime fallback. Detailed documentation is loaded on demand.

Use `yolo workspace plugins status`, `facts` and `validate` for actual registrations and evidence. In the store, `bun scripts/sync.ts refresh --name yolo` updates source snapshots without staging or publishing concurrent edits; `once` and `watch` publish and require an owned, validated batch. Current upstream branches and installed versions remain separate evidence.

`yolo plugin status` inspects the bundle. The existing template generator lacks an overwrite guard; do not run `generate/create` against the curated submodule. Use an explicit temporary output for templates. This maintenance did not change excluded runtime source or qualify engine builds.


## Native dependency synchronization

The core `@aphrody/yolo-core/pm` owner exposes `planPackageSync` and `syncPackages`.
`aphrody-mcp` serves `yolo_package_sync`; `yolo api` serves the same tool through
`POST /api/tools/call`. Arguments are `path`, optional `managers` (`bun,uv,cargo`),
`offline`, `production`, `timeoutMs` and `apply` (false by default). HTTP contains
project paths within its configured root and applies its existing token policy.

Plans require installed global binaries and existing native locks. Apply runs
Bun frozen/without scripts, uv locked/without Python downloads, and serialized
Cargo fetch under the installed ABI 1.4 supervisor. No engine compilation is
performed. Missing/stale locks and failures remain explicit. The full manager
milestone stays open beyond this Linux x64 dependency-acquisition tranche.
See qualification and
[core API](../../../../packages/yolo-core/README.md).
