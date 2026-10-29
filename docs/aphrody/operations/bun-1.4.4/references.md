> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bun references to align on 1.4.4

Inventory taken on 2026-10-11 in `C:/aphrody` (`main` at `aad58c6537`). Pins stay on `1.4.3-aphrody.4` until the gates
in [README.md](README.md) pass. Kinds:

- **pin**: rewritten by `yolo update pins apply` (`tools/config/update/pins.json`).
- **literal**: hand-written value that the pin manifest does not cover; updated in the same batch as the pin move (G4).
- **image**: container image tag; changes only when the image is published.
- **host**: live host runtime or inventory; changes only through the host plan (G6).
- **fixture**: test data that encodes an old version on purpose; kept.
- **history**: dated record; kept as written.

## Source and configuration

| Path                                                       | Line          | Current text                                                                     | Kind    | Action at the gate                                                                       |
| ---------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `package.json`                                             | 283           | `"packageManager": "bun@1.4.3-aphrody.4"`                                        | pin     | `pins apply` (G1, G3)                                                                    |
| `tools/config/update/pins.json`                            | 5-40          | pin manifest, source of truth for Bun                                            | pin     | unchanged; it drives the others                                                          |
| `tools/config/host/toolchain.json`                         | 27            | `"bun": "1.4.3"`                                                                 | pin     | `pins apply`                                                                             |
| `tools/config/system-packages.json`                        | 7, 150        | `"version": "1.4.3"`, `"-Version", "1.4.3"`                                      | pin     | `pins apply` (two targets)                                                               |
| `tools/config/container/Dockerfile`                        | 55            | `ARG BUN_VERSION=1.4.3`                                                          | pin     | `pins apply`                                                                             |
| `tools/config/container/aphrody-os/Dockerfile`             | 21            | `ARG BUN_VERSION=1.4.3`                                                          | pin     | `pins apply`                                                                             |
| `tools/config/container/desktop/Dockerfile`                | 12            | `ARG BUN_VERSION=1.4.3`                                                          | pin     | `pins apply`                                                                             |
| `tools/config/container/toolbox/Dockerfile`                | 8             | `BASE=ghcr.io/aphrody-labs/bun:1.4.3-aphrody.3`                                  | image   | after the 1.4.4 image is published (G4)                                                  |
| `tools/config/container/compose.yaml`                      | 51            | `APHRODY_BUN_IMAGE:-ghcr.io/aphrody-labs/bun:1.4.3-aphrody.3`                    | image   | after the image is published (G4)                                                        |
| `packages/*/package.json`, `packages/infra/*/package.json` | `engines.bun` | `">=1.4.3"` (cli-wasm, ovh, update, product, paths, workspace, sql)              | pin     | `pins apply`; check each minimum against the installed fork before the apply             |
| `scripts/build/container/aphrody-build.test.ts`            | 16, 29        | expects `aphrody-v1.4.3-aphrody.4`; fixture `aphrody-v1.4.2-aphrody.1`           | literal | update line 16 to the new release tag in the same batch (G4); line 29 is a fixture, keep |
| `scripts/build/container/aphrody-build.ts`                 | 66            | derives `aphrody-v${bun}` from the pin                                           | derived | no change                                                                                |
| `scripts/tools/bun-hygiene.ts`                             | 57            | comment `` `1.4.3-aphrody.3` ``                                                  | literal | update the comment at G4                                                                 |
| `scripts/tools/bun-hygiene.test.ts`                        | 52-66         | tags `aphrody-v1.4.3-aphrody.N`, and `isNewer` cases including `1.4.4-aphrody.1` | fixture | keep                                                                                     |
| `packages/infra/update/test/pins.test.ts`                  | 65, 69        | `install(ctx, "bun", "1.4.3")`                                                   | fixture | keep                                                                                     |
| `packages/infra/update/test/deps.test.ts`                  | 86-89         | changelog fixture `1.4.2 -> 1.4.3`                                               | fixture | keep                                                                                     |
| `packages/infra/workspace/test/bun-workspace.test.ts`      | 25-60         | `minimumBun("bun@1.4.3-aphrody.4")` cases                                        | fixture | keep; they test parsing                                                                  |
| `packages/infra/workspace/test/system-packages.test.ts`    | 27, 94        | `-Version 1.4.3`                                                                 | fixture | keep unless the test reads the manifest (check at G4)                                    |
| `packages/infra/product/test/setup/r2.test.ts`             | 23            | `version: "1.4.3-test"`                                                          | fixture | keep                                                                                     |
| `tools/config/host/vps/runtime.json`                       | 90            | `aphrody-omar-bun:1.4.3-aphrody.3` (dockerImages)                                | host    | host plan, not a source edit                                                             |
| `tools/config/host/dbfr/LAYOUT.md`                         | 72            | keep image `ghcr.io/aphrody-labs/bun:1.4.3-aphrody.3`                            | host    | Omar's host; no change here                                                              |
| `tools/config/disk-reclaim.json`                           | 247           | `.local/bin/bun.bak-1.4.3-aphrody.2`                                             | host    | reclaim candidate; not touched by this batch                                             |
| `tools/config/docs/root.json`                              | 343           | factory build note, "Bun 1.4.3"                                                  | history | keep                                                                                     |

## Documentation (current pins)

| Path                                          | Line           | Current text                                               | Kind          | Action at the gate                                                           |
| --------------------------------------------- | -------------- | ---------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------- |
| `docs/plans/workspace/PLAN.md`                | pin target     | `utilise Bun 1.4.3`                                        | pin           | `pins apply`                                                                 |
| `docs/reference/workspace/CLI.md`             | pin target (2) | `` Bun `1.4.3` `` and the `bun`/`bunx` table rows          | pin           | `pins apply`                                                                 |
| `docs/reference/web/web/BUILD-WINDOWS.md`     | pin target     | Bun version                                                | pin           | `pins apply`                                                                 |
| `docs/reference/upstream-bun/APHRODY-FORK.md` | 74-84          | distribution table; pin line "Repository pin (2026-10-09)" | history + pin | add a dated 1.4.4 line only after G1, through `bun run docs:bun:update` (B4) |
| `docs/operations/infra/TOOLCHAIN-SYNC.md`     | 14, 36         | `Bun 1.4.2` (pre-existing drift, older than the 1.4.3 pin) | literal       | outside this claim; correct at G4 with a claim on that file                  |
| `docs/operations/infra/update/BUN.md`         | 1              | policy text about the fork and pins                        | no version    | keep                                                                         |

## Documentation (history, kept as written)

| Path                                                                         | Kind                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `docs/operations/infra/vps-bun-2026-10-10.md`                                | history; VPS activation of `1.4.3-aphrody.4` (claim `codex-vps-bun4`)                      |
| `docs/operations/workspace/registry-release-2026-10-09.md`                   | history                                                                                    |
| `docs/operations/infra/r2-native-install-2026-10-09.md`                      | history                                                                                    |
| `docs/operations/infra/fleet-release-2026-10-09.md`                          | history                                                                                    |
| `docs/operations/infra/cutover-resume-2026-10-10.md`                         | history                                                                                    |
| `docs/operations/infra/r2-domains-2026-10-10.md`                             | history                                                                                    |
| `docs/operations/agent-tooling/claude-native-unblock-2026-10-10.md`          | history                                                                                    |
| `docs/operations/forge-yolo-consolidation.md`                                | history                                                                                    |
| `docs/operations/infra/OMAR-CODEX-PROMPT.md`, `-UNBLOCK.md`, `-CONTAINER.md` | instructions given to Omar's session; review at G6, do not rewrite before Omar's host plan |
| `docs/plans/fusion/bench/*.json`, `FACTS.md`, `METHOD.md`                    | benchmark records of 2026-10-05; history                                                   |

## Other repositories (not edited here)

| Repository   | Count (files with `1.4.3` or `1.4.2` matches) | Note                                                                                                                                                      |
| ------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C:/shenron` | 34 occurrences in 21 files                    | mostly `package.json` engines and `bun.lock`; `Dockerfile` in `deploy/docker/all-in-one`; `docs/operations/*`                                             |
| `C:/IECODE`  | 99 occurrences in 53 files                    | many are unrelated dependency versions (`pnpm-lock.yaml`, forks); `.github/workflows/ci.yml` (not in repo) and `deploy.yml` (not in repo); `PLAN.md` (not in repo); `docs/development/WORKSPACE.md` (not in repo) |

Each repository needs its own claim and a classification pass (Bun runtime vs. unrelated dependency version) before
any edit. These counts are file matches, not Bun-specific references.
