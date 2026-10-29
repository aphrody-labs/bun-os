> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bun 1.4.4 alignment dossier

Status on 2026-10-12: the pins moved to 1.4.4 (`yolo update pins apply bun 1.4.4`, `packageManager` `bun@1.4.4`,
engines `>=1.4.4`, `@types/bun` `npm:@aphrody/bun-types@1.4.4`). The release tag is `bun-v1.4.4`
(`scripts/build/container/aphrody-build.ts` derives it from a plain `X.Y.Z` pin). Hosts and images still follow G4-G6.
On 2026-10-11 the active runtime pin was `bun@1.4.3-aphrody.4` (`packageManager` in the root `package.json`). This dossier
records the evidence, the gates and the order of changes; the per-reference matrix is in [references.md](references.md).

## Naming rules

- `1.4.4` is the upstream base of the fork. A fork release is `aphrody-v1.4.4-aphrody.<n>`, and `bun --version`
  reports the base `1.4.4` while `bun --revision` reports `1.4.4-aphrody.<n>+<fork sha>`
  ([fork distribution](../../reference/upstream-bun/APHRODY-FORK.md)).
- `1.4.4-canary.1+4e3ddd04d` is a candidate build label. It is not a release, not a pin and never a stable 1.4.4.
  Do not relabel a canary, a stripped copy or a candidate as `1.4.4` or `1.4.4-aphrody.<n>`.
- Installed versions must be quoted from `bun --revision` on the host, with the SHA-256 of the executable.

## Evidence (read-only, 2026-10-11)

| Item                                                                 | Observed                                                                                                                                                                                                                          | Source                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Stable fork release `1.4.4`                                          | Absent. `gh api repos/aphrody-labs/bun/releases/tags/aphrody-v1.4.4-aphrody.1` returns 404; no tag or release containing `1.4.4` in `aphrody-labs/bun`                                                                            | `gh release list`, `gh api` on `aphrody-labs/bun`                   |
| Latest fork release                                                  | `aphrody-v1.4.3-aphrody.4` (2026-10-09T17:23:58Z, marked Latest)                                                                                                                                                                  | `gh release list -R aphrody-labs/bun`                               |
| Repository pin                                                       | `bun@1.4.3-aphrody.4`                                                                                                                                                                                                             | root `package.json`, `tools/config/update/pins.json` (first target) |
| vps (`ubuntu`, `/home/ubuntu/.bun/bin/bun`)                          | `1.4.3-aphrody.4+41211b568`                                                                                                                                                                                                       | `aphrody infra ssh exec --host vps`, `bun --revision`               |
| dbfr (`/home/ubuntu/.bun/bin/bun` and `/home/ubuntu/.local/bin/bun`) | `1.4.3-aphrody.3+d46f0ed6c`, SHA-256 `60462d310373ce02e84c60535ed62d0e28edfdef11ed4dd0b16c30623977d2fc`                                                                                                                           | `aphrody infra ssh exec --host dbfr`                                |
| dbfr candidate, unstripped                                           | `bun-1.4.4-4e3ddd04d/bun`, `--revision` = `1.4.4-canary.1+4e3ddd04d`, SHA-256 `21024f109079656591908dce0140d1870de3f967b61fc05c53e0dba8ccccfb96`                                                                                  | `~/.local/share/aphrody/runtime-candidates/` on dbfr                |
| dbfr candidate, stripped                                             | `bun-1.4.4-4e3ddd04d-stripped/bun`, 138871072 bytes, SHA-256 `85c8f00b5d4a2f6519850df72aec6f893358894d20663e667a46487bf273ee87` (the owner's checksum). Its `--revision` was not run; the label comes from the unstripped sibling | same directory                                                      |
| dbfr candidate, other                                                | `bun-1.4.4-988d73b430a-stripped/bun`, SHA-256 `8bb9105153ce3742d14f9c04247782c5013d050813b00eae880d041ae9ceb8e3`, not run. Different revision label `988d73b430a`; not qualified and not the 4e3ddd04d candidate                  | same directory                                                      |

Consequences:

- dbfr runs `1.4.3-aphrody.3`, one fork build behind the repository pin `.4`. This is existing drift, recorded here
  and not corrected by this dossier (dbfr is administered by Omar, see Blockers).
- The vps already runs the pinned `.4` build (activation in [vps-bun-2026-10-10.md](../infra/vps-bun-2026-10-10.md)).

## Decision

1. No pin moves to 1.4.4 now. Moving `packageManager` or any `ARG BUN_VERSION` to a release that does not exist
   would break installs (`bun install`, container builds, the `aphrody-build` release tag derivation).
2. Pinned lines are rewritten by the pin manifest, not by hand: `yolo update pins apply`, driven by
   `tools/config/update/pins.json`, after a stable fork release is published and the Infra gate passes. The
   manifest's targets include the root `package.json`, `tools/config/host/toolchain.json`, the container Dockerfiles,
   `tools/config/system-packages.json`, the engines of `packages/**/package.json`, and three documentation files
   ([references.md](references.md)).
3. Docs that describe history (dated 2026-10-08 to 2026-10-10 records, including the VPS activation and release
   records) are not rewritten. They keep the version they were written with.
4. Container image tags, host runtimes and the DBFR candidate are changed only through their own published artifacts
   and host plans, never by editing a reference to a version that does not yet exist.

## Gates before the pins move

Each gate has a named owner. The pins move only when all are green.

| #   | Gate                                                                                                                                                                                                                                                                               | Owner                                                                              | Evidence required                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| G1  | Stable fork release `aphrody-v1.4.4-aphrody.<n>` published with `SHA256SUMS.txt` and the linux-x64 and windows-x64 archives                                                                                                                                                        | Bun fork release (Codex `release-1.4.4` worktree at `C:/bun/.coord/release-1.4.4`) | `gh release view aphrody-v1.4.4-aphrody.<n> -R aphrody-labs/bun`, checksum list |
| G2  | Qualification receipt of the same revision (the canary `4e3ddd04d` is the candidate, not the receipt)                                                                                                                                                                              | Codex                                                                              | receipt in the Bun `.coord`                                                     |
| G3  | Pin manifest consistent: `yolo update pins check` reports no disagreement, then `yolo update pins apply`                                                                                                                                                                           | Infra                                                                              | command output                                                                  |
| G4  | Hand-maintained literals updated in the same batch: `scripts/build/container/aphrody-build.test.ts` (expects `aphrody-v1.4.3-aphrody.4`), image tags in `tools/config/container/compose.yaml` and `toolbox/Dockerfile`, `aphrody-omar-bun` in `tools/config/host/vps/runtime.json` | Infra                                                                              | diff, lint-only check                                                           |
| G5  | Docs lint-only gate: `bun run docs:check` and `bun run docs:check-links` on the changed files, no build and no test run                                                                                                                                                            | docs owner                                                                         | command output                                                                  |
| G6  | Per host: plan, SHA-256 of the current executable, owner-only backup verified, staged executable checked with `--revision`, atomic rename, `--revision` after replacement, rollback to the verified backup on failure                                                              | Infra (vps); Omar (dbfr)                                                           | `aphrody infra ssh exec` output                                                 |

## Blockers

- B1: no stable fork release `1.4.4`. Blocks G1 and every pin change.
- B2: the candidate `1.4.4-canary.1+4e3ddd04d` exists only as a file on dbfr, not as a published artifact with a
  checksum list. It cannot be a pin, an image tag or a release label.
- B3: dbfr is administered by Omar. Read-only checks were run; no host change is authorised here.
- B4: `docs/reference/upstream-bun` is the only copy of the Bun docs. It is refreshed with `bun run docs:bun:update`,
  not edited by hand. The fork distribution section gets its 1.4.4 line from that flow after G1.
- B5: Shenron (`C:/shenron`, 34 occurrences in 21 files) and IECODE (`C:/IECODE`, 99 occurrences in 53 files) are
  separate repositories. Not every occurrence is the Bun runtime: many are dependency versions. Their references
  need their own claims and classification; nothing was edited there.

## Plan

| Step | Scope                                                                                                                        | State              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1    | This dossier and its matrix (docs only, claim `docs/operations/bun-1.4.4`)                                                   | Done in this batch |
| 2    | Codex publishes or refuses the stable fork release `aphrody-v1.4.4-aphrody.<n>` (G1, G2)                                     | Waiting on Codex   |
| 3    | Infra runs `yolo update pins check` and `apply` once, then updates the G4 literals in the same commit                        | After step 2       |
| 4    | Docs with current pins are refreshed by the same apply; history records stay as written                                      | After step 3       |
| 5    | Hosts: vps by plan and apply (G6); dbfr only after Omar's authority                                                          | After step 3       |
| 6    | Clean-up: the 1.4.3 executables kept as backups are removed only after step 5 is verified and the backup is no longer needed | After step 5       |

Not in scope: builds, tests, CI runs, tags that trigger a build, replacing registry content, and any edit outside
`docs/operations/bun-1.4.4`.
