# Publishing crates and npm packages

First-party Rust crates go to crates.io (owner `aphrody-dev`), first-party Bun packages to npm (user `yohan971`).
Versions are the repository's current versions (one workspace version, [RELEASES.md](RELEASES.md)); a version that is
already on a registry is never published again. Publication runs on the build host (`ssh vps`), which holds both
logins (`~/.cargo/credentials.toml`, the npm token read by `bun pm whoami`).

## How to publish

```sh
ssh vps
cd ~/src/bun-os
bun scripts/publish-plan.ts                      # docs/generated/publish-plan.json: what is publishable and why not
bun scripts/publish.ts crates --dry-run          # package every crate (with its unpublished siblings), no upload
bun scripts/publish.ts npm --dry-run             # bun publish --dry-run for every package
systemd-run --user --unit=bunos-publish-crates --slice=build.slice --working-directory=$PWD \
  -p StandardOutput=append:$HOME/build/publish/logs/publish-crates.log \
  -p StandardError=append:$HOME/build/publish/logs/publish-crates.log \
  "$(command -v bun)" scripts/publish.ts crates     # real upload, in the background, resumable
bun scripts/publish.ts npm
```

`--only external|members` limits a crates run to one phase, `--limit N` stops after N uploads. Every run is
resumable: per-item outcomes are kept in `~/.local/state/bunos-publish/{crates,npm}.json` (`published`, `exists`,
`taken`, `private`, `staged`, `verified` by a dry run, `failed` with the first errors). `failed` and `verified` items
are retried by the next run; the others are final.

## Order

1. **External first-party workspaces** (`crates.external` in the plan): crates the members need that live outside the
   root workspace and are missing from crates.io. Today `bun-obscura` (the aphrody-labs Obscura fork patched in from
   git, published from its default branch in a clone under `~/build/publish/bun-obscura`) and
   `crates/bunos-nt-client` (its own Windows workspace). Each is published in its own dependency order.
2. **Workspace members** in `crates.order`: a topological order over normal, build and versioned dev-dependencies.
3. **npm packages**, in any order (they depend on each other through registry versions).

crates.io accepts a burst of new crates and then about one new crate every ten minutes (new versions of existing
crates have a far larger allowance). The publisher waits out each 429 until the time crates.io returns and carries on,
so a full first publication of a few hundred new crates takes days; leave it running.

## Gates and rules

- A crate is publishable when it is a first-party member under `crates/`, `apps/`, `packages/` or `cloud/`, is not
  `publish = false`, has a license and a description, and every normal and build dependency is a registry crate, a
  publishable member, or a crate the registry has in a matching version. `cargo package` resolves everything against
  crates.io: a `[patch.crates-io]` entry, a git dependency or an out-of-tree path dependency counts only when crates.io
  has a matching version, and one without a version cannot be published at all.
- Per crate the publisher checks the registry (version present: `exists`; name owned by someone else: `taken`), then runs
  one `cargo publish`: package, verification build against the crates.io dependencies (published just before it), and
  upload; a retry after a 429 skips the verification. A failed verification uploads nothing and is recorded as
  `failed`. A dry run packages the crate together with its unpublished workspace dependencies so cargo can resolve
  them before anything is uploaded, without the verification build.
- Every cargo invocation walks the checkout's git status (382 submodules): about four minutes per crate on `vps`, so
  keep large untracked trees out of the checkout or in `.gitignore`. That cost sits inside the crates.io wait anyway.
- A package must stay under the crates.io 10 MB limit: large assets are left out with `exclude` and loaded from the
  checkout or the system (as `bun_browser_render` does with its colour emoji face).
- npm: a package is publishable when it is named, not `private` and licensed, with registry-only dependencies. The
  account enforces npm staged publishing: `bun publish` puts the version in the staging queue and it is installable
  only after a maintainer approves it with 2FA on npmjs.com (or `npm stage approve <id>`). Those are recorded as
  `staged`.

## What stays unpublished

`publish = false` stays on members that must not be published, and the plan lists them with their reasons:

- forks and ports of upstream projects (`ruzu-*`, `rdynarmic`, `aphrody-dust-*`, `aphrody-ctr-*`, `bun-engine-core`,
  `bunos-utils`, the `artcraft*`/storyteller crates and their API clients, `simdutf`, `rfb-encodings`, `libm3`);
  their sources and licenses belong upstream, and many carry git dependencies with no crates.io release;
- tooling and fixtures: every `*-xtask`, `*-testkit`, `*-golden`, `capture_harness`, the wasm hello examples;
- applications and services: the `apps/*` desktop, CLI and web shells, the WebOS server, sessions and client, the
  Tauri plugins and apps tied to this repository;
- npm: `private` packages and the vendored `@storyteller/*` packages (upstream scope, no license field).
