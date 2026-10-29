<!-- SPDX-License-Identifier: Apache-2.0 -->
# Rust builds on the VPS factory

Rust compilation, tests and release assembly belong on the VPS build host.
WSL and Windows remain editing and orchestration clients. Infra and Workspace
own source transfer, pipeline selection and release delivery; this document
does not introduce a second SSH or deployment orchestrator.

## Serialization and caches

Every Cargo command runs through `scripts/build/rust/cargo-serial.sh` from
the selected source owner. One command holds the host lock at a time, with
at most six compiler jobs and incremental compilation disabled. Use two jobs
initially for memory-heavy native inference builds; choose a higher limit only
after observing memory headroom. Do not start parallel target builds or give
each pipeline its own lock.

The lock supervisor uses `flock --close`: child Cargo processes and sccache
daemons do not inherit the lock descriptor. The outer factory lock must use
the same policy, otherwise a long-lived cache daemon can retain a completed
job's lock and stall the queue.

The wrapper accepts these host settings:

| Setting | Behavior |
| --- | --- |
| `APHRODY_CARGO_JOBS` | Integer 1–6; default 6. |
| `APHRODY_CARGO_LOCK_TIMEOUT_SECS` | Nonnegative integer seconds; default 1800. |
| `APHRODY_CARGO_LOCK_DIR` | Shared lock directory; default `$HOME/.cache/aphrody`. Configure the same directory for every factory runner account. |
| `APHRODY_CARGO_TARGET_DIR` | Optional absolute Cargo artifact directory, isolated per source owner; conflicts with `--target-dir` are rejected. |
| `RUSTC_WRAPPER` | Existing configuration is preserved, including an explicit empty opt-out. When unset and installed, `sccache` is selected. |
| `APHRODY_BUILD_HOST` | Factory dispatch sets `vps`; enabled factory policy rejects unmarked heavy Cargo execution before acquiring the Cargo lock. |
| `APHRODY_LOCAL_CARGO` | Explicit `1` permits a deliberately selected scoped diagnostic; never set globally or use for ordinary builds. |

Help requests and commands such as metadata, formatting and dependency-tree
inspection remain usable locally. Build-producing Cargo plugins (`nextest`,
`xwin`, `zigbuild`) follow the same guard as build, check, Clippy and tests.
The host marker routes operational policy; it is not an authentication boundary.

Keep registry, Git and sccache stores outside temporary release snapshots.
Use persistent source-owner target directories when the owner's packaging
contract supports them. Retain toolchain, target, features and build profile in
run provenance; the presence of a cached binary alone is not release proof.
Do not erase reusable caches as part of normal successful release cleanup.

## Native consumers and target ordering

Native SSH inspection commands default to thirty seconds. Factory dispatch
sets `APHRODY_SSH_COMMAND_TIMEOUT_SECS` on its local Infra subprocess to select
a longer finite execution deadline (1–86400 seconds); setting it only in the
remote shell does not extend the calling SSH deadline. Connection timeout
remains separate. On cancellation the native owner kills its local SSH child;
this does not prove all remote descendants have terminated. Preserve the
factory job log and result under its artifact owner.

IECODE's current authority is `docs/development/INAGLE-NIE-FFI.md` (not in repo) in its
own checkout. Its Cargo configuration and native packaging expect root
`target/`; AppImage packaging explicitly refuses redirected target directories.
Do not apply the optional target override globally to these owners. Build the
actual ABI producer before native consumer tests; fallback tests and explicit
native skips do not qualify the compiled ABI.

Run scoped Linux gates first. Run Windows MSVC only with its actual SDK/linker
or the owner's declared cross toolchain; run WASM only for declared WASM
consumers. Missing toolchains are skipped prerequisites, not successful checks.
Cross targets share the same lock. Maintain separate gate results for check,
Clippy, tests and release linking, even when compiled dependencies are reused.
Do not merge feature-specific release commands when their feature union would
change a binary's behavior.

IECODE depends on paths in its Aphrody sibling. Its primary repository pin
alone therefore does not identify the compiled source graph. Check the expected
full Aphrody revision and clean tracked state inside the acquired factory lock,
immediately before Cargo; capture both revisions in the job evidence. Repeat
the sibling revision and cleanliness assertions after the command. If a queued
job encounters a changed sibling revision, fail that job rather than describing
its output as qualification of the earlier pair. Source synchronization must
respect the same factory lock. Reconciliation of an IECODE lock against a newer
sibling is a separate recorded operation with its lock diff retained.

## Migration boundary

The service catalog distinguishes repository templates from operating-system
units with `unitSource`: omitted or `repository` requires a file under
`systemd/` (including `.example` templates); `system-package` names a unit
provided by a host package. Unknown values fail validation. This distinction
does not exempt package units from target-host systemd and health checks.
For example, DBFR's `redis-server.service` must be verified on DBFR instead
of adding a fabricated Redis template to this repository.

Keep production inputs, databases and credentials in their protected stores.

On Windows `cargo-serial.ts` (Bun, kernel32 through `bun:ffi`) holds the
`LocalAphrodyCargoBuild` session mutex and passes its build environment to the
Cargo child only. It is not a cross-host lock or a
permission to resume local builds alongside the VPS queue.

## Evidence — 2026-10-03

The native Infra factory gates passed. The separate NIE check used the actual
pair Aphrody `98a728a9fe31c76526e566341d752ec9bcad942c` and IECODE
`c832e6c553a99ccad92cc64e4ff5b952f7c28c42`. After scoped lock reconciliation,
compilation reached `aphrody-nie-wiki` and failed on six ignored compile-time
inputs under IECODE's `data/azalee/` (not in repo) (external IECODE data store):

- `menu-gallery-manifest.json`
- `item-enrichment.json`
- `item-image-manifest.json`
- `menu-asset-manifest.json`
- `emblem-crc-map.json`
- `character-face-manifest.json`

All six local copies contain empty collections and cannot serve as verified
production metadata. No completed NIE compilation, native artifact or Bun ABI
qualification follows from this run. These missing inputs are distinct from
the successful Infra qualification.

The current IECODE authority, `docs/nie/game-data/root-manifests.md` (not in repo), assigns
these generated indexes to verified VFS/native exports and Inagle
materialization. An executable owner pipeline generating these exact six
files has not been identified. The narrow prerequisite is a genuine generated
metadata snapshot for these names, with source provenance, hashes and private
read-only provisioning. Do not replace them with empty JSON to satisfy Cargo.
ROMs, complete game VFS resources, databases and protected data stores remain
in their existing stores and are not transferred for this qualification.

This change updates wrapper configuration and documents owner constraints.
No Cargo command, native build or product test was run by the worker. Bash
syntax validation, PowerShell parser validation and scoped `git diff --check`
passed on 2026-10-03. Build speed
and cross-platform qualification require measured remote runs; neither is
inferred from these configuration changes.
