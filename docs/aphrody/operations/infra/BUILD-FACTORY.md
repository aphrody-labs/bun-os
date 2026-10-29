<!-- SPDX-License-Identifier: Apache-2.0 -->

# VPS build factory

Owner: Infra. Policy: [`tools/config/build-factory.json`](../../../../tools/aphrody/config/build-factory.json).
Requested placement: [`production-topology.json`](../../../../infra/config/production-topology.json).

Current placement: Omar's Windows PC (`omar-pc`) is the native Windows build
factory, in addition to the SSH VPS factory. The Windows factory is scoped to
Windows native builds, packaging and smoke checks; x64 is native-qualified and
ARM64 is a cross-build until tested on native ARM hardware. Run one heavy build
at a time, preserve 6 GiB RAM and 20 GiB free disk, and do not enable automatic
cleanup. The local checkout is `C:/src/aphrody`.

The SSH VPS remains the serialized Rust/Bun/Linux and multi-platform factory,
with its shared lock and pinned-source checks. Use native SSH execution through
Infra for that work and recheck the separate `/home/ubuntu/build` volume before
dispatch. Windows capacity does not replace VPS receipts or qualify Linux builds.

## Authority and execution

VPS (`ssh vps`) owns heavy Rust, Bun and Python builds, tests and releases under
the current declared factory policy.
WSL and Windows retain sources, editing, help, plans and scoped static checks.
These are desired placements, not a claim that migration is complete.

Owner directive 2026-10-09 (« exploite nos deux VPS pour build et prod ») restores DBFR as a bounded secondary
Cargo host beside its production (`hosts.dbfr` of `tools/config/host/vps-cargo.json`): rustup 1.98.1 and
sccache 0.18.0 under `~ubuntu/.cargo`, checkout and caches under `/home/ubuntu/aphrody-build`, 3 jobs at most, nice
10, sccache 8G, no desktop libraries. `bun scripts/build/rust/vps-cargo.ts run --host dbfr -- <cargo args>`, or
`--host auto` to fall back there when the vps heavy lock is busy.

Use the Workspace factory facade and existing native Infra SSH operations.
Read their current help before running. Source transfer uses
`aphrody-infra ssh sync --host vps --source <clean-owner-checkout> --destination <repository-root>`;
review the dry run before adding `--apply`. Generated build trees and `.git/**` are excluded. Bootstrap each remote
first-party checkout through its private Git remote or a verified Git bundle
before source sync; sync alone cannot create revision provenance. The factory
works from the monorepo checkout only; the former superproject preparation script was
retired. Preserve
that remote Git metadata and require it to match the requested source revision.
The factory verifies a full requested Git revision and clean tracked source
before execution. Do not synchronize credentials, protected data, model weights
or another repository's generated artifacts into the build source.

Factory dispatch gives native SSH a finite six-hour deadline through
`APHRODY_SSH_COMMAND_TIMEOUT_SECS`; short inspections keep the thirty-second
default. The calling Infra binary must include this option. Both factory and
Cargo locks use `flock --close` so a persistent sccache daemon cannot retain
build locks after the owner command ends.

A single factory lock bounds heavy jobs across owners. Rust additionally uses
`scripts/build/rust/cargo-serial.sh`, at most six rustc jobs, incremental disabled
and sccache enabled. Bun heavy jobs run singly against the frozen lockfile.
Caches live outside source snapshots under `/home/ubuntu/build/cache`; immutable
artifacts under `/home/ubuntu/build/artifacts`. Provision directory ownership and
pinned toolchain through Infra before execution. Keep cache reuse and record
source revision, toolchain versions, command, exit status and artifact hashes.

## Completed VPS-to-DBFR migration

The one-shot migration adapters (shared state, private environment transfer, old-IP Nginx forwarder and Redis
cutover) were removed after the 2026-10-09 cutover: Redis, Nginx and the PostgreSQL tunnel are retired from the VPS
([migration record](migration-vps-dbfr-2026-10-09.md)). Git history keeps their sources.

## Single transient resource and targeted cleanup (2026-10-07)

`tools/config/build-factory.json` declares one factory scratch root:
`/home/ubuntu/build/transient`, mode 0700 and owned by the build user. All
Workspace factory commands, including detached jobs, the exact-worktree VPS
Cargo route and direct VPS Cargo/Forge routes share the existing
`/home/ubuntu/build/locks/heavy.lock`. They set `TMPDIR` to that root and empty
its contents before and after qualified foreground execution. Forge uses its
`forge/` subtree instead of creating another loop device or tmpfs. Cargo target
directories, global sccache, Bun/uv caches, source snapshots, retained artifacts
and protected stores remain outside this transient resource.

Direct-route reentry verifies the kernel FLOCK's device, inode and owner against
the inherited process ancestry. Setting `APHRODY_FACTORY_RESOURCE` alone cannot
skip the heavy lock. The direct-route supervisor also retains the lease after
an abruptly terminated owner while a surviving build child uses the resource;
a fixture verified that the competing lock stays blocked until that child exits,
then the temporary contents are removed and the lease released. Foreground
EXIT/INT/TERM cleanup preserves the original command status.

Removal checks every visible process's cwd, executable, open descriptors,
arguments and environment, plus mount points and running Docker bind mounts.
A process proved by `/proc/locks` to be waiting on this exact heavy-lock inode
may mention the resource in queued arguments/environment; actual cwd, executable
and descriptor references still preserve it. This prevents a queued follower
from blocking the current lease's terminal cleanup. Other queued references remain
protected. Unreadable observations or live references preserve the resource; no live
process is terminated. The resource is not reused while those references remain.
These routes use the existing `/usr/bin/sudo-rs` on VPS and DBFR (observed
0.2.13-0ubuntu1.2); local tests use the host's existing sudo without replacing it.
An abrupt host failure retains contents for the next qualified cleanup.

Use the existing Workspace/Infra owner to plan before apply:

```sh
bin/yolo ops build-factory cleanup
bin/yolo ops build-factory cleanup --apply
```

Only declared retired immediate-child Cargo target directories are eligible.
Each requires a regular terminal receipt, canonical directory identity, absence
of nested mounts and fresh process/container isolation checks. Apply additionally
holds the heavy lock. Missing targets are reported as absent, not reconstructed.
Do not substitute the broad historical VPS reclaim target for this allowlist.

The retained native apply receipt records 8,509,566,976 allocated bytes removed
from `obscura-fork`, `vu-uv`, `vu-ruff` and `vu-wsl`; source and runtime receipts
were retained. A subsequent read-only native observation found those four paths
absent, transient allocation 4096 bytes and `/srv` availability 26,408,816,640
bytes (92% use). These observations include intervening concurrent builds and do
not establish an isolated before/after filesystem delta. The new transient
route's native probe acquired the existing lock, wrote a payload and confirmed
the root empty after terminal cleanup.

Qualification: 90 scoped tests / 424 assertions passed across factory planning,
cleanup, exact-worktree Cargo routing and Forge suites; Workspace and Yolo
TypeScript checks, strict scoped oxlint, oxfmt and Bash syntax passed. Fixtures
cover failure exit preservation, symlinks, live children, queued arguments,
environment references, Docker bind mounts, inherited lease proof and owner
termination. This receipt proves these declared host routes; it does not turn
persistent compiler caches into disposable scratch or migrate arbitrary
independently invoked container builds.

The follow-up fifth allowlisted retirement removed the terminal `cargo/aphrody`
target (30,700,023,808 allocated bytes). Its isolated native apply observed
`/srv` availability rise from 24,378,413,056 to 55,078,424,576 bytes and use fall
from 93% to 83%; concurrent `aphrody-wsl` builds, global caches and the existing
sccache server remained live. The total allocated output removed in the two
recorded batches is 39,209,590,784 bytes. See the
[2026-10-07 retirement receipt](srv-reclaim-20261007.md). Process path checks
match complete path tokens/descendants, so the active sibling `aphrody-wsl` is
preserved without creating an exception for compiler daemons.
