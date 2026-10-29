> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# Bun in Aphrody: the aphrody-labs/bun fork

Canonical Aphrody page about Bun. Every other page that discusses the Bun runtime, its sources, its patches or
its updates links here. This directory holds only this page, the fork `LICENSE.md` and `SOURCE.json`, the commit of
`docs/` of the fork pinned by `bun run docs:bun:update`. The Bun docs are read in place in the fork checkout,
else fetched at the pinned commit (sparse `git clone` of `docs/` into the user data directory). Verified against
the fork checkout on 2026-10-10.

The public site of the fork is [aphrody.app](https://aphrody.app): home (what the fork is, its patches and
their tests, current versions, installation), the full Bun documentation under `/docs` with search, downloads,
release notes and the installers (`/install`, `/install.sh`, `/install.ps1`). The fork owns its generator,
`scripts/aphrody/site/` (test `test/internal/aphrody-site.test.ts`); `publish.ts` (user timer on the vps) deploys it
to Cloudflare as the static assets of the Worker `aphrody-app` (`packages/bun-cloudflare/app` of the fork, API under
`/api`). `bun.aphrody.com` answers a permanent redirect to the same path on aphrody.app
([`bun.aphrody.com.conf`](../../../../infra/config/host/nginx/aphrody/bun.aphrody.com.conf)). `aphrody.com` and
`aphrody.com/docs` stay the Aphrody app and its documentation; they do not duplicate the Bun docs.

## Rules

- The Bun of Aphrody is the fork [aphrody-labs/bun](https://github.com/aphrody-labs/bun) (checkout selected by
  `APHRODY_BUN_CHECKOUT`, or discovered as a sibling of the selected Aphrody workspace). Any change to Bun itself (runtime, built-in modules,
  `bun:*` APIs, bundler, package manager, types, build scripts) lands in the fork as a commit on `main`, with a
  test under `test/js/first_party/` or `test/internal/`. Its own [APHRODY.md](https://github.com/aphrody-labs/bun/blob/main/APHRODY.md)
  lists what Aphrody consumes from it.
- Aphrody keeps no Bun patch queue, no vendored Bun tree, no Rust copy of Bun crates and no second copy of the
  Bun docs. Bun API questions are answered from `docs/` of the fork or the MCP tools `bun_docs_search`,
  `bun_docs_read` and `bun_docs_list`.
- `oven-sh/bun` is reached only through the fork's `upstream` remote; it is not a direct source of Aphrody.

## Repository

- Remotes: `origin` = `aphrody-labs/bun`, `upstream` = `oven-sh/bun`. One working branch, `main` (also the
  default branch) = upstream `main` plus the Aphrody commits; the other remote branches are inherited from
  upstream and feed nothing. On 2026-10-08 `main` was 0 behind and 46 commits ahead of `upstream/main`
  (145 files, +8362/-316).
- Upstream arrives by merge only, never by rebase or force push. There is no `bun:aphrody` module; the Aphrody
  native libraries are not linked into this Bun.

## Fork patches (kept when merging upstream)

The list of patches with their sources and tests is owned by the fork:
[APHRODY.md, Patches](https://github.com/aphrody-labs/bun/blob/main/APHRODY.md#patches), published on
[bun.aphrody.com](https://bun.aphrody.com). Summary:

- Built-in replacements of npm packages in `src/js/thirdparty/`: `dotenv.ts` (+ `dotenv/config.ts`, logic in
  `src/js/internal/dotenv.ts`), `picocolors.ts`, `tiny-invariant.ts`, `uuid.ts`, registered in
  `src/resolve_builtins/HardcodedModule.rs`. Tests: `test/js/first_party/{dotenv,picocolors,tiny-invariant,uuid}/`.
- `bun:ffi` `dlopen(path, symbols, { global })` (RTLD_NOW | RTLD_GLOBAL): `src/js/bun/ffi.ts`,
  `src/runtime/ffi/{FFIObject.rs,ffi_body.rs}`, `src/sys/lib.rs`, `packages/bun-types/ffi.d.ts`; test
  `test/js/first_party/runtime/dlopen-global.test.ts`.
- argv0 aliasing: a `--compile` executable renamed `bun`, `bunx` or `node` acts as the engine itself
  (`src/runtime/cli/mod.rs`; test `test/js/first_party/runtime/argv0-bun-alias.test.ts`). The Yolo runtime
  relies on it ([yolo and the fork](../../plans/yolo-fork-unified/PLAN.md)).
- Rust native link propagation for the Linux linker: `scripts/build/rust/native-link.ts`,
  `scripts/build/{rust,bun,ninja,timings}.ts`; test `test/internal/build-rust-native-link.test.ts`.
- Windows: `scripts/vs-shell.ps1` finds a Build Tools-only Visual Studio installation.
- Packages: publishable npm packages renamed to the `@aphrody` scope, whose single source of truth is `scripts/aphrody/scope.ts` (`--check` lists remaining upstream
  names, `--write` rewrites them).
- Agent tooling: `.claude/settings.json` unrestricted; SessionStart hooks `scripts/dev/cloud-ssh.sh` and
  `scripts/dev/session-start.ts`; PostToolUse `.claude/hooks/post-edit-format.js`.

## Upstream synchronization

`bun scripts/aphrody/sync-upstream.ts [--push] [--dry-run] [--keep-conflicts] [--root <dir>] [--no-fetch]`, in
the fork, merges `upstream/main` into `main`, retries conflicts as a rename-aware three-way merge through
`scope.ts`, re-applies the `@aphrody` scope and stops (exit 2, merge aborted) on any real conflict. The workflow
`.github/workflows/aphrody-upstream-sync.yml` declares a 6-hour schedule, but GitHub Actions is disabled on the
fork, so maintainers run the sync by hand (fork `APHRODY.md`, 2026-10-10). After a merge, refresh the docs
pin here with `bun run docs:bun:update` and check it with `bun run docs:bun:check`.

## Distribution

| Artifact       | Producer in the fork                                                                | Published as                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime binary | `.github/workflows/aphrody-release.yml` (tag `aphrody-v*` or dispatch)              | GitHub release `aphrody-v<version>` (`bun-<os>-<arch>[-<libc>][-<profile>].zip`, `SHA256SUMS.txt`); first: `aphrody-v1.4.3-aphrody.1`                 |
| Runtime on npm | `scripts/aphrody/publish-runtime.ts`                                                | `@aphrody/bun-runtime` + `@aphrody/bun-runtime-<os>-<arch>`                                                                                              |
| npm packages   | `scripts/aphrody/publish-npm.ts`, `.github/workflows/aphrody-publish-npm.yml`       | `@aphrody/bun-types`, `@aphrody/bun-inspector-protocol`, `@aphrody/bun-debug-adapter-protocol`, `@aphrody/bun-plugin-svelte`, `@aphrody/bun-plugin-yaml` |
| Rust crates    | `scripts/aphrody/publish-crates.ts`, `.github/workflows/aphrody-publish-crates.yml` | crates.io `aphrody-bun-native-plugin`, `aphrody-bun-macro`                                                                                               |

Versions are `<base>-aphrody.<n>`; the binary reports `bun --version` = the upstream base (1.4.3) and
`bun --revision` = `<base>+<fork sha>`. Release `aphrody-v1.4.3-aphrody.2` includes linux-x64 and
linux-aarch64 builds for glibc and musl, x64 baseline builds, darwin-x64/aarch64 and windows-x64/aarch64.
Repository pin (2026-10-09): `package.json` `packageManager` is `bun@1.4.3-aphrody.3` (revision `d46f0ed6c69`,
`bun --revision` = `1.4.3-aphrody.3+d46f0ed6c`); `scripts/build/container/aphrody-build.ts` derives the release tag
`aphrody-v1.4.3-aphrody.3` from it. GitHub releases `aphrody-v1.4.3-aphrody.3` and `aphrody-v1.4.3-aphrody.4` are
published (2026-10-09); `.4` carries linux-x64 (glibc and musl), windows-x64, the Windows service host and
`SHA256SUMS`. The npm runtime is `@aphrody/bun-runtime` (`npm install -g @aphrody/bun-runtime`); the installers are
served by [bun.aphrody.com](https://bun.aphrody.com/install).
The Alpine Aphrody OS image consumes the musl archives through the checksum-verifying fork installer. The npm name
`@aphrody/bun` is not the fork runtime; never publish or install the runtime under it.

## Contributing

The fork's `CLAUDE.md` (also `AGENTS.md`), `src/CLAUDE.md`, `test/CLAUDE.md`, `REVIEW.md`,
`.claude/docs/landing-prs.md` and the skills in `.claude/skills/` (`verify`, `implementing-jsc-classes-rust`,
`implementing-jsc-classes-cpp`, `javascriptcore-garbage-collector`, `rust-system-calls`,
`writing-bundler-tests`, `writing-dev-server-tests`, `slowest-tests`) are authoritative. `bun bd` builds the
debug binary; `bun bd test <file>` runs a test with it; a new test must fail with
`USE_SYSTEM_BUN=1 bun test <file>` and pass with `bun bd test <file>`; platform-gated Rust needs
`bun run rust:check-all`.
