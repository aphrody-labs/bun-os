<!-- SPDX-License-Identifier: Apache-2.0 -->

# M3 production readiness — 2026-10-05

**Status: partially qualified.** Final source gates, dependency installation
and the local web showcase have verified receipts. Three native FFI
provenance comparisons still fail, and native release, installation and device
qualification remain open. The [machine receipt](production-readiness.json)
preserves the measured scopes and explicit limits.

M3 branch `main` was initially sampled at
`8f4b3a5177a5919c590066bc338be3d2e2fefd79`, integrated through base
`7fc818974191e0dac6e6a195eaeb1ee0a2006674`, and observed at source HEAD
`01615d40e6f1862c8f22f44784bcbd2da766bff0` for this receipt.
Artifact build IDs identify the measured outputs separately. The delivery
status is dated 2026-10-05 in Europe/Paris; browser receipt timestamps retain
their original UTC date of 2026-10-04.

The measured source batch was delivered privately as M3 commit `3043406`.
The canonical checkout is now `/home/aphro/aphrody/m3`, observed at
`3d8d4bf` after later owner commits. Those commits keep their own qualification;
they do not change the earlier source snapshot or measured artifact IDs.

## Delivery stages

| Stage                   | Final evidence                                                                                                                                                                      | Qualification still required                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Source                  | Theme validation, keyboard/focus behavior, reduced motion, controlled forms, adaptive Lit cleanup and runtime/API boundaries have scoped receipts; TypeScript and strict lint pass. | Native host compilation and installation.                                            |
| Tests                   | 1,412 outer passes, 3 FFI provenance failures and 6 skips. Design now passes.                                                                                                       | Current-source FFI parity; native check/test/Clippy gates.                           |
| Bundles                 | Owner pipeline: 14 built, zero failed. Final web build `8f185d9c3c427bfa` has verified hashes, 28/28 Chromium contracts and 90 captures.                                            | Native bundle and packaging.                                                         |
| Dependency installation | Normal frozen install: 257 ms; postinstall generates 493 source and 493 installed declarations.                                                                                     | Native product installation and platform lifecycle checks.                           |
| Activation              | Owner restarted the loopback showcase after the final build; its local fixture passes.                                                                                              | Installed desktop/mobile startup, offline behavior, permissions and process cleanup. |

Canonical source owners remain the [M3 source plan](../plans/design/M3-PLAN.md),
[host plan](../plans/design/M3-MULTI-HOST-PLAN.md) and
[app-ui package](../../packages/app-ui/package.json). Historical plan checkmarks
and older reports retain their dated scope. They do not establish current
artifact installation or activation.

## Final web artifact and browser results

The final showcase manifest, produced by the [build owner](../../scripts/build.ts),
identifies M3 3.3.3, Bun 1.4.2, full minification and build
`8f185d9c3c427bfa`. Native Bun file APIs verified all 629 declared
file sizes and SHA-256 values. The directory contains 630 files including
the manifest, totaling 16,727,744 bytes. Its manifest SHA-256 is
`12dbac69edbf27236c0b4160ab5ed98c1dd3194b30764deb03dfeff9176ee19d`.

The integrating owner restarted its server after the build, at PID 525521.
The final `browser-contract-delivery.json` receipt is timestamped
`2026-10-04T21:56:14.852Z`: **28/28 contracts pass** in Chromium
153.0.8010.12, with empty console-error, failed-HTTP and external-request
arrays. Checks cover destination links, skip-link focus, persisted theme/layout
choices, TV keyboard movement, local form/explorer/reader interactions and
the labelled AI fixture's Stop action. External requests were blocked.

The final `shots-delivery/capture.json` contains **90/90 captures**:
15 destinations × 3 viewport layouts × 2 light/dark schemes. Each capture
has an empty console-error array. The worker independently checked 90 unique
route/profile names and all error arrays. These captures belong to final
build `8f185d9c3c427bfa`.

The machine receipt separately retains the initial 90 captures at build
prefix `541de3` and the earlier 28 contracts at
`ad124607012eb510`. Their original artifact scopes remain intact.
The untracked `HOST-QUALIFICATION-2026-10-04.md` is a local historical
receipt, not a required link or a versioned release proof.

The font route preserves native `Response`/`Bun.file` behavior while DOM
tests run in a separate preload scope. The final source scope has **24
passing showcase tests: 21 native Bun units and 3 DOM tests**. Nine host
contract tests are included in the native Bun unit count. The historical font-harness failure was
superseded for this corrected scope.

These receipts qualify a local Chromium fixture. They do not establish
Obscura engine parity, installed native-host behavior, physical device
installation, exhaustive visual inspection or assistive-technology coverage.
[M3-NEXT-BUNDLE.md](M3-NEXT-BUNDLE.md) supplies historical bundle measurements
with its own baseline and limits, not a new performance comparison.

## Final gate ledger

| Scope                                               | Final receipt                                                                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root declared package/scripts tests                 | 1,412 outer passes, 3 FFI provenance failures, 6 skips.                                                                                               |
| AI / Primitives / React                             | 57 / 110 / 56 pass; zero failures.                                                                                                                    |
| Tokens / Reader / Front / Forms / Explorer / Motion | 129 / 10 / 12 / 13 / 16 / 80 pass in the owned scopes.                                                                                                |
| Design / Scripts                                    | 158 / 73 pass; script results are included in the outer total.                                                                                        |
| Theme brand and production contract                 | 6 pass; this scoped sample excludes the separately failing native stylesheet provenance comparison.                                                   |
| Material Web fork                                   | Commit `b3b566d821b738fef19e487b3bb6860944bd01ed`: 30 tests pass, TypeScript 7.0.2 passes, strict lint has zero errors or warnings across 13 sources. |
| M3 typecheck                                        | 27 targets pass; zero failures.                                                                                                                       |
| Existing checkout qualification                     | 7 tests pass; zero failures.                                                                                                                          |
| Global strict lint                                  | 603 files; zero errors or warnings.                                                                                                                   |
| Source integrity                                    | 43 packages, zero errors, 3 existing nie-ui WASM fixture warnings; asset and link gates have zero errors or warnings.                                 |
| Factory capability source                           | Commit `ead4a13b1`: 21 tests, 170 assertions, native TypeScript, strict lint and formatting pass.                                                     |

The regression sources cover
[components](../../packages/m3-primitives/test/production-contract.test.tsx),
[front](../../packages/m3-front/test/production-contract.test.ts),
[Material Web exports](../../vendor/material-web/test/production-exports.test.ts),
[controlled inputs](../../packages/m3-ai/test/production-contract.test.tsx)
and [runtime boundaries](../../apps/m3-showcase/test/runtime-api.test.ts).
Measured results are preserved in this versioned receipt; source links identify
their reproduction owners. Ignored coordination files and raw logs are not
required to read it and are not staged.

The raw summaries contain 1,417 passes and four failures. Five child passes
and one deliberate child failure inside the `m3` negative-test fixture
are excluded from the outer result; that package itself has 61 passes and
zero failures. All three remaining outer failures are native stylesheet
provenance comparisons. Design, AI and `m3-next-migrate` have zero failures.
The [framework finalization receipt](FRAMEWORK-FINALIZATION.md) retains its
historical scope and is not the final gate for this batch.

Separately, the integrating owner reports three TypeScript errors in the
installed Yolo `runtime-sdk/desktop` consumer. That owner scope is distinct
from the M3 target result and remains open.

## Reproducible dependency installation

The catalog selects `file:vendor/material-web`. The integrating owner
delivered fork commit `b3b566d821b738fef19e487b3bb6860944bd01ed`,
with 18 completed paths, a clean index/diff, the owner identity and a verified
normal push to the existing private origin.

The [bootstrap owner](../../vendor/material-web/scripts/bootstrap-types.ts)
rebuilds an isolated `types/` tree from already versioned public
`.d.ts` files, preserving notices and declaration maps. It needs Bun
and no compiler dependencies. Only the existing ambient declaration remains
tracked; generated declaration output and temporary dependency links are
not staged.

The [root manifest](../../package.json) runs that owner in `postinstall`
for both the source package and the actual installed artifact resolved from
the Front consumer. Final normal `bun install --frozen-lockfile`
passes in **257 ms**, preparing **493 declarations in each target**.
Installs with `--ignore-scripts` deliberately skip this lifecycle.
Production exports select JavaScript plus the separate declaration tree;
the source condition remains an explicit tooling choice.

## Prepared native work, still unqualified

Native host source `crates/ui/m3-showcase/src/lib.rs` exists and inherits
parent workspace dependencies; `config/tauri-apps.json` registers it.
The host source remains uncommitted inventory in this audit. It is not
versioned release evidence.

The integrating owner's serialized
`cargo metadata --locked --offline --no-deps` inventory passes for the
registered host workspace. The owner-generated lock addition is the ten
intended lines for the new member. An earlier full offline metadata attempt
stopped on an uncached `actix-codec` dependency. Neither metadata scope
compiles a Rust engine or qualifies an artifact. Native check, test, strict
Clippy, packaging, installation and device qualification remain open.

The [factory owner](../../../packages/infra/workspace/src/build-factory.ts)
prepared fresh VPS Aphrody sources at
`d06d00738a8f26857d8c057609a182a1e81e9994`. Native durable jobs were
qualified and privately delivered in Aphrody commit `2c541bbd2`:
36 tests, 363 assertions, TypeScript, strict lint and format passed.
The [job contract](../../../docs/operations/infra/BUILD-FACTORY-JOBS.md)
retains the existing locks and source pin.

The old attached SSH client exited with code 255. Its orphaned waiter
`3305254` was still waiting without children; the integrator verified its
boot ID, start ticks, exact command and isolated process group, then stopped
only that owned group. No other session's job was signalled.

Replacement job `m3-ffi-release-d06d007-20261005` was accepted at
`2026-10-04T22:30:28.512Z`. It runs the existing `bun-native --gpu`
release owner, including library, provenance manifest and strict consumer
smoke. A later SSH observation confirmed supervisor `3309655` alive,
private 0700 directories/0600 files and identical submission returning
`existing`. Active includes waiting for leases; no terminal receipt or
new artifact exists at this observation. Yolo source-preparation supervisor
`3303970` still holds the heavy lock, with Git fetch child `3304542`.
Its owner was notified through native agent coordination. No ETA is established.

The installed FFI artifact dated 2026-10-01 emits the older
`crates/ui/aphrody-m3-tokens/src/sheets.rs` provenance. Current source
correctly uses `crates/aphrody-m3-tokens/src/sheets.rs`. Three exact stylesheet
parity tests still fail on that source-path comment. Observed numeric token
parity does not close those failures. The current owner artifact must be
built and installed, then parity rerun without erasing provenance or
rewriting sheets to the obsolete owner path.

Android SDK/NDK and macOS/Xcode are unavailable in this audit. Mobile
activation also requires the canonical mobile API adapter; its guard rejects
activation without it. Responsive screenshots do not qualify an adapter or
device. Desktop qualification still needs a pinned artifact, installed/offline
startup, permissions, cancellation, child-process cleanup and platform
accessibility.

Local AI/MCP demonstrations use labelled sample data. This audit establishes
no authenticated provider API, installed model, private product conversation
or replacement rendering engine. Protected stores and authentication were
preserved; no publication or native activation occurred in this documentation
batch.

The final source gates and local web installation/browser receipts are
recorded. Native work is prepared and queued, with no qualified native
artifact, installation or device. Overall release readiness remains partial.
