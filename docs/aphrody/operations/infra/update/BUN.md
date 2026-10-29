> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bun and npm updates (`yolo update bun`)

Owner: Infra (`packages/infra/update/src/ecosystems/bun.ts`, exported as `runBun`). It bumps everything that is Bun or
npm: the Bun runtime pin, the Tauri JS packages, the root `workspaces.catalog` and the literal ranges of every
first-party manifest (84 manifests plus the root). The pipeline overview is [UPDATE.md](../UPDATE.md). The Bun of Aphrody is
the fork `aphrody-labs/bun` (see [Bun fork](#bun-fork)).

## Policy

- Bun follows the latest published release (`tools/config/update/pins.json` rewrites every hardcoded version, see
  `yolo update tools`). The Tauri family follows the latest 3.0.0 alpha line and is owned by `tauri sync`.
  TypeScript is 7 and Oxc (`oxlint`, `oxfmt`) is pinned: both move through the same pin manifest, never by hand.
- Every other direct dependency follows its latest release. Minors and patches are applied automatically. A major (and
  a `0.x` minor, which is breaking by semver) needs the release notes read first (GitHub releases, the changelog or
  Context7), the repo's actual usage checked with a grep, and the consumers' typecheck and tests run afterwards. A major
  that cannot be fixed cheaply is not bumped: it goes in the hold table below and in `tools/config/deps/bun-holds.json`, with
  the reason and the condition that releases it.
- Security first: an npm advisory that a newer release fixes is bumped at once, even inside the age window (add the
  package to `minimumReleaseAgeExcludes`). An advisory no bump can fix goes in `tools/config/deps/advisory-holds.json`
  (shared with the Rust and Python inventory).
- A "direct" dependency is a `workspaces.catalog` entry or a literal range in one of the manifests. `catalog:` users are
  followed through the catalog. `workspace:`, `file:`, `link:`, git and `npm:` specs are not registry bumps and are skipped.

## Release age and excludes

`bunfig.toml` sets `install.minimumReleaseAge = 259200` (3 days): Bun refuses a release younger than that, which is the
supply-chain delay. `minimumReleaseAgeExcludes` lists the packages that must track the registry in real time:

| Excluded | Why |
| --- | --- |
| `next`, `@next/env`, `@next/swc-*` | Security fixes ship as patch releases and must land on the day. The platform binaries must follow `next`. |
| `nodemailer`, `undici` | Security fixes (SMTP and HTTP clients). |
| `@tauri-apps/cli`, `@aphrody/api`, `@tauri-apps/cli-linux-x64-gnu` | The 3.0.0 alphas must track the Rust crates (`tauri sync`). |

`yolo update bun` honours the gate: a release younger than the window is reported as `waiting`, and `apply` writes
the newest release that is old enough (`pickEligible` from `tauri/sync.ts`, prereleases ignored when the latest is
stable). `bun run bun:check` fails if the window drops below 3 days.

## Overrides

Root `package.json` `overrides` force one resolution for everything that depends on a package:

| Override | Why |
| --- | --- |
| `axios` `^1.20.0`, `qs` `^6.16.0`, `undici` `^7.30.0` | Floors for transitive consumers so the lockfile resolves the patched releases (2026-10-01 advisory pass). `undici` stays on 7: its dependents ask for `^7` (`@ai-sdk/provider-utils`, `cheerio`, `jsdom`, `shadcn`, `@dotenvx`), `miniflare` pins 7.29.0 and Discord's libraries are forced up from 6. |

`yolo update bun status` prints each override with the versions `bun.lock` resolves and the registry latest, so a
floor that no longer matters can be dropped.

## Commands

```bash
yolo update bun status [--offline] [--json] [--no-advisories]   # report only
yolo update bun plan   [--majors a,b]                            # what apply would do
yolo update bun apply  [--majors a,b] [--skip-tests]             # snapshot, bump, install, verify
yolo update bun verify [--skip-tests]                            # gates only
yolo update bun rollback                                         # restore the newest snapshot
```

(`bun packages/infra/update/src/ecosystems/bun.ts <sub>` runs the same module directly.)

- `status`: runtime installed vs pinned vs latest (bun, typescript, oxlint, oxfmt), direct dependencies behind latest
  (npm `/latest` with exponential backoff and `Retry-After`), overrides, the release-age excludes in force, npm
  advisories from OSV that no hold covers, and the Bun fork gap (`sources forks`).
- Buckets in `status` and `plan`: `in-range` (a newer release inside the range), `pinned` (an exact pin or range behind
  inside its major), `major` (needs `--majors`), `held` (this file), `waiting` (the newer release is younger than the
  window, nothing installable yet). Packages owned by `tauri sync` or `tools/config/update/pins.json` are listed but never
  edited here.
- `apply`: (1) snapshot of every manifest and `bun.lock` under `target/update/bun/<utc>/`; (2) the Bun pin through
  `tools bun` when behind; (3) `tauri-sync --apply` when its check reports drift (its own Cargo gate, serialised
  through `cargo-serial.sh`); (4) `bun update -r`; (5) spec edits: in-range and pinned specs are raised to the
  installable release, the majors named by `--majors` are rewritten (a family member pulls its behind siblings: react,
  next, tailwind, lexical, tiptap, radix, three, better-auth, vitest, ai-sdk, graphql); edits keep the range operator
  and the JSON formatting; (6) `bun install`; (7) `verify`.
- `verify`: `bun run bun:check`, `bun run monorepo:layout`, `bun run test` (workspace tests), then `typecheck` of every
  package whose resolved dependency specs differ from `HEAD` (a catalog edit reaches its `catalog:` users) plus
  `@aphrody/update`. Exit 1 on any failing step; the last lines of its output are printed.
- `rollback`: copies the snapshot files back, then run `bun install`. It works on the dirty tree that agents share,
  where `git checkout` would discard other people's edits.

## Majors, step by step

1. `yolo update bun plan` lists the candidates (`major` bucket) with the release-age-installable version.
2. For each candidate read the release notes between the current and the target version, `grep` the repo for the APIs it
   uses, and check `peerDependencies` and `engines` of the target against the repo (react, next, typescript 7, bun).
   Delegating this to read-only research agents works; the decision and the record stay here.
3. Verdict per package: SAFE (bump), FIX (bump plus a named code change), HOLD (do not bump).
4. `yolo update bun apply --majors a,b,c` for the SAFE and FIX ones, with the code fix applied before `verify`.
5. A failure that is not a cheap, real fix: `yolo update bun rollback` (or edit the one spec back), then add the
   package to `tools/config/deps/bun-holds.json` and to the hold table below.
6. Run `yolo update deps inventory` afterwards to refresh `docs/reference/workspace/DEPS-INVENTORY.md`.

## Rollback

`yolo update bun rollback` restores the newest snapshot (`target/update/bun/` (not in repo), not committed). A bump that was
committed is reverted with `git revert` of that commit. After either, run `bun install` to realign `node_modules`.

## Bun fork

`aphrody-labs/bun` (`main` = upstream `oven-sh/bun` plus the Aphrody commits) is the kernel Bun of Aphrody; the
monorepo keeps no Bun patch queue and no vendored Bun tree (both removed on 2026-10-08: every former patch is a
commit of the fork). Its own `APHRODY.md` lists what Aphrody consumes.

- Version pin: `tools/config/update/pins.json` takes `latest` from the fork releases (`aphrody-v<base>-aphrody.<n>`,
  the pin is `<base>`), so the workspace never moves past a Bun version the fork has released.
- Install: every Aphrody install of Bun runs the fork's installer, never bun.sh or winget `Oven-sh.Bun`:
  `curl -fsSL https://raw.githubusercontent.com/aphrody-labs/bun/main/scripts/aphrody/install.sh | bash -s <pin>`, or
  `install.ps1 -Version <pin>` on Windows (newest `aphrody.<n>` of the pin, SHA256-checked). Callers: `scripts/dev/bootstrap.*`,
  `cloud-setup.sh`, `toolchain-sync.*`, `bun-hygiene.*` (newest fork release at least 3 days old), `yolo update tools --apply`,
  `yolo ops system-packages` (Windows installer entry), the `tools/config/container/**` Dockerfiles (Alpine takes the
  `-musl` asset) and the CI workflows. `pins.json` keeps their version literals in step.
- Binaries: release assets and npm `@aphrody/bun-runtime` (`bunx @aphrody/bun-runtime`); types: `@aphrody/bun-types`;
  crates: `aphrody-bun-native-plugin`, `aphrody-bun-macro`. `@aphrody/bun` on npm is not ours.
- Upstream merges: the fork's `bun scripts/aphrody/sync-upstream.ts` (workflow `aphrody-upstream-sync.yml`, every
  6 hours). Drift report: `yolo update sources forks` (`tools/config/update/forks.json`).
- Docs: the MCP `bun_docs_*` tools read `docs/` of the fork checkout; `bun run docs:bun:update` pins its commit in `docs/reference/upstream-bun/SOURCE.json` (versioned download fallback) and copies `LICENSE.md`.
- Source checkout: `APHRODY_BUN_CHECKOUT`, else the sibling Bun checkout discovered from the selected Aphrody workspace.

## Held packages

Mirror of `tools/config/deps/bun-holds.json` (bumps refused) and the npm entries of `tools/config/deps/advisory-holds.json`
(advisories no bump can fix). Re-check each row on every bump and delete it when the blocker moves.

| Package | Held at | Reason | Released when |
| --- | --- | --- | --- |
| `undici-types` | 8.9.0 | `@types/node` 26.6.x depends on `undici-types ~8.9.0`; the catalog pin follows it so the workspace holds one copy (the old pin 7.24.6 made two). | `@types/node` moves |
| `@aphrody/canvas` | catalog entry unused | First-party (`../material/packages/canvas`); consumers resolve it through `workspace:*`. The registry copy is not a source of truth (publishing is an owner decision). | never bumped through the catalog |
| `jsdom` | 29.x | jsdom 30 declares `undici ^8.10.2` but the root override forces `undici ^7.30.0` (miniflare, `@ai-sdk/provider-utils`, `cheerio`, `shadcn` need 7). | the `undici` override can move to 8 |
| `msw` | 2.x | msw 3.0.x does not intercept Bun's native `fetch`: `setupServer().listen()` leaves `fetch` unpatched (`getaddrinfo ENOTFOUND` on a mocked host). `packages/rg/patreon-bun` (not in repo) goes from 174 passing tests to 8 failing, with requests reaching the real API. The renamed option `onUnhandledFrame` is not the cause. Tried 3.0.0 on 2026-10-02 and reverted. | a 3.x release that patches Bun's `fetch` (re-test on every 3.x) |
| `adm-zip`, `js-yaml`, `sharp` (advisories) | 0.6.0, 4.3.1, 0.33.5 | Pinned exactly by `@mintlify/*` (the `mint` docs tool of `@aphrody/koharu-docs`, dev only). Every other consumer already resolves a fixed release. | the next `mint` release that moves them |
| `esbuild`, `vite`, `uuid`, `basic-ftp`, `extract-zip`, `quill` (advisories) | see file | Transitive majors or no newer release; dev servers only. | see `advisory-holds.json` |

## Pending (release age)

A newer release exists but is younger than the 3-day window, so `apply` leaves it: they appear as `waiting` in
`status` and are picked up by the next run. Majors waiting on 2026-10-02:

| Package | Now | Target | Installable from | Prepared change |
| --- | --- | --- | --- | --- |
| `@stripe/stripe-js` | ^9.17.0 | 10.0.0 | 2026-10-04 | None (no importer). |

## Bump log

### 2026-10-02

Release notes were read per major (GitHub releases, changelogs, registry `peerDependencies`) and the repo's usage was
grepped before bumping. Gates: `bun:check`, `monorepo:layout`, workspace tests, typecheck of the touched packages,
plus `bun test` of every touched package (the only failures are environmental and unrelated: the `aphrody-ffi` native
library is not built, `DATABASE_URL` and a database are absent, and the `kit` and `patreon-bun/docs` typecheck
failures already present before the bump).

| Package | From | To | Note |
| --- | --- | --- | --- |
| `@testing-library/jest-dom` | ^6.10.0 | ^7.0.1 | Node 22+, `@testing-library/dom` peer already met. |
| `three` | ^0.184.0 | ^0.186.1 | Code fix: `PCFSoftShadowMap` was removed from `WebGLShadowMap` in r186 (runtime warning, falls back), `m3/packages/material-web/scene3d/scene-3d.ts` (not in repo) now sets `PCFShadowMap`. |
| `motion` | ^12.43.0 | ^13.4.4 | Only the removed emotion integration changed; unused. |
| `react-dropzone` | ^15.0.0 | ^20.1.2 | `useDropzone` call site unaffected. |
| `react-easy-crop` | ^5.5.7 | ^6.2.3 | Build-only breaks. |
| `@vueuse/core` | ^14.4.0 | ^15.0.0 | Only `useIntervalFn` in the patreon-bun docs. |
| `@colyseus/sdk` | ^0.17.43 | ^0.18.4 | Aligns the website client with the 0.18 server (core, schema 5). |
| `@ai-sdk/google` | ^3.0.122 | ^4.0.85 | The line that matches `ai` 7 and vertex 5; unused in source. |
| `@better-auth/agent-auth` | ^0.5.1 | ^0.6.2 | Revoke endpoint and hook scoping; plugin usage unchanged. |
| `@better-auth/passkey` (website) | 1.6.28 | 1.7.6 | Aligned with `better-auth` 1.7.6. |
| `@supabase/ssr` | ^0.10.3 | ^0.12.7 | Only `createBrowserClient` is used. |
| `googleapis` | ^173.0.0 | ^182.0.0 | Node 22+; drive, docs, calendar and sheets types diffed, nothing removed. |
| `firebase`, `firebase-admin` | ^10.13.0, ^12.4.0 | ^12.19.0, ^14.5.0 | Catalog-only entries, no importer. |
| `patreon-api.ts` | ^0.19.0 | ^0.20.0 | Catalog-only. |
| `http-proxy-middleware` | ^3.0.7 | ^4.2.0 | ESM-only, `httpxy` engine; a proxy smoke test through Express under Bun returns the upstream response. |
| `dotenv` | ^17.4.2 | ^18.0.4 | No workspace importer. |
| `tsdown` | ^0.22.14 | ^0.23.0 | `aphrody-messaging` and `kit` build ESM and `.d.mts` under TypeScript 7. |
| `typescript-json-schema` | ^0.67.4 | ^0.68.0 | Bundles its own TypeScript; catalog-only. |
| `web-tree-sitter` | ^0.26.9 | ^0.27.0 | No importer. |
| `undici-types` | 7.24.6 | 8.9.0 | Matches `@types/node` (see the hold). |
| minors and patches | | | `genkit` and `@genkit-ai/google-genai` 1.42.0, `@modelcontextprotocol/sdk` 1.31.0, `@sentry/nextjs` 11.1.0, `@shikijs/vitepress-twoslash` 4.4.3, `hono` 4.13.10, `valibot` 1.5.0, `@next/bundle-analyzer` 16.3.6, `@next/env` 16.3.8, `mint` 4.2.948, `next-intl` 4.14.7, `@ai-sdk/provider` 4.0.19, `postcss` 8.5.28, plus the lock refresh of `bun update -r`. |

Not part of this pass: the Bun runtime (1.4.2 is latest), TypeScript 7.0.2, oxlint 1.86.0 and oxfmt 0.71.0 (all
current), and the Tauri family (`tauri-sync --check` reports no drift; `@aphrody/plugin-opener` alpha.2 waits for the
age window). The non-workspace mirrors keep their own ranges and are out of scope of the first-party manifest scan.
