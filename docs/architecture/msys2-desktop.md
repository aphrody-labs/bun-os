# MSYS2 and Bun OS Desktop

Bun OS reuses the existing MSYS2 sources, package recipes and `cym` Bun CLI.
The distribution root owns assembly and release qualification; MSYS2 is a native
Windows development/package context. It is separate from the Arch/glibc Linux
rootfs and COSMIC/Gamescope compositions described in
[Arch distribution architecture](arch-distribution.md).

## Source and installation boundaries

The selected source layout is one physical checkout per repository under flat
`vendor/`, described by `vendor/sources.json`. Examples are `msys2-packages`,
`mingw-packages`, `msys2-runtime`, `kernel-patches`, `wgpu`, `winit` and `bevy`.
The registry owns repository identities and source paths. Similar names, a
shared upstream or a junction do not prove equal revisions or source roles.
The CachyOS Linux recipe repository must not be confused with a Linux kernel
source tree because a dirty worktree contains residual kernel files.

The installed MSYS2 root, native pacman path, optional development Home and
optional external Bun Engine workspace are independent configuration. Moving
sources into `vendor/` does not move `usr/bin`, `etc`, the pacman database or
the user's Home. Preserve dirty/unmerged sources, Git alternates and notices;
relocation requires Git identity, index and resolved-path read-back. Do not
import provider state, credentials, raw sessions, cookies or databases.

The completed source move retains 29 physical owners and 94 contained
dependencies. Root Git registers 66 unique vendor owners, including 37 lazy
Arch sources; six shared sources replace duplicate mount registrations.
All 45 Arch reference pins remain distinct from selected checkout revisions.
The root factory DAG represents all 66 owners and 43 unique Arch source edges;
it keeps the 45 reference pins as metadata rather than duplicating physical
source nodes. This is a read-only dependency plan, not an executable build.
Twelve moved repositories still use the external Bun Engine Git administration
store and retain active consumer junctions. Preserve that store until its owner
can migrate it independently; a root gitlink does not move Git administration.

The adapter takes explicit options and the existing inspector's
`APHRODY_MSYS2_SOURCE_ROOT`, `APHRODY_MSYS2_ROOT` and `APHRODY_MSYS2_HOME`
configuration. No machine-specific installation or Home path belongs in the
committed defaults. The root CLI is the public orchestration owner.

```sh
bun src/cli.ts factory msys2 plan --msys-root /path/to/installed/msys2
bun src/cli.ts factory msys2 doctor --config /path/to/local-config.json
bun src/cli.ts factory msys2 lock --msys-root /path/to/installed/msys2 --out /path/to/metadata-lock.json
```

The optional config has an `msys2` object with `sourceRoot`, `installationRoot`,
`pacmanPath` and `home`; its paths resolve relative to that file. The selected
workspace's `vendor/` is the default source root. Source inspection remains
available without an installed pacman and reports package metadata unavailable.
An absent optional Home or an unreadable source link is reported without
aborting the entire source inventory. Other `vendor/` content, including Cargo's
dependency snapshot, is outside this source registry's inspection scope.

## Native ABI contracts

| Contract                        | C/C++ runtime           | Intended use                                     |
| ------------------------------- | ----------------------- | ------------------------------------------------ |
| MSYS x64, `/usr`                | MSYS2/Cygwin, libstdc++ | POSIX development and package administration     |
| UCRT64 x64, `/ucrt64`           | UCRT, libstdc++         | MinGW native Windows libraries                   |
| CLANG64 x64, `/clang64`         | UCRT, libc++            | LLVM/MinGW native Windows libraries              |
| CLANGARM64 ARM64, `/clangarm64` | UCRT, libc++            | Separate native Windows ARM64 libraries          |
| MSVC x64/ARM64                  | UCRT, MSVC C++ runtime  | Existing Bun runtime and serialized Rust targets |

MSYS and MinGW are different targets. Shared UCRT use does not establish C++
binary compatibility; object/static libraries from incompatible environments
must not be mixed. A DLL boundary requires a defined C ABI and ownership rules
that avoid sharing CRT-owned objects. MinGW Rust targets require their own
qualified toolchain; the adapter does not infer them from a prefix.
These distinctions follow the [MSYS2 environment contracts](https://www.msys2.org/docs/environments/).

`factory/msys2/config.ts` describes these contracts. MSVC x64 is the selected
default, preserving the existing Bun Windows runtime and root serialized Cargo
owner. The adapter does not replace either owner or select a second engine.

## Plan, doctor and metadata lock

The root can import the following APIs from `factory/msys2/index.ts`:

```ts
planMsys2Desktop({ root, sourceRoot, installationRoot, pacmanPath, home, abi });
doctorMsys2Desktop({ root, sourceRoot, installationRoot, pacmanPath, abi });
captureMsys2DesktopLock(inspection, abi);
inspectMsys2DesktopLock(previousLock, currentLock);
```

The caller can supply one `inspection` snapshot to the plan/doctor during
relocation. Its source root must match the selected source root. Planning
reuses the existing MSYS2 inspector, runtime provenance evaluator and hash
owner. It does not execute package recipes, link sources, fetch repositories,
install packages, build artifacts or launch another pipeline.

Native pacman `-Q` and `-V` queries describe the installed package inventory,
following [MSYS2's pacman ownership](https://www.msys2.org/docs/package-management/).
The lock sorts package identities and source revisions/remotes, records tracked
dirty state, and hashes both metadata arrays. Comparison reports installed
package/source drift and rejects malformed or tampered metadata. It does not
lock archive contents or prove package signatures, dependency closure, exact
replay, executable/source parity, builds or activation. Such receipts remain
explicitly false. Untracked source content is outside the inspector's tracked
Git status scope.

The doctor distinguishes metadata readiness from release qualification. It
reports native host metadata, required pacman/runtime/cym packages, vendor
registration, broken views, unmerged sources, Desktop source availability,
runtime pin and missing ABI/toolchain receipts. Source presence is useful
evidence even when the target remains unqualified.

## Existing cym modernization

`vendor/msys2-packages/cachyos-msys2/cym.ts` remains the CLI implementation;
its PKGBUILD compiles TypeScript with Bun. The installed `cym.exe` is a separate
artifact. Package release 8 passed its archive identity/payload checks and was
installed through native pacman. Installed help/plan and package integrity
read-back pass; the inventory remains 100 and the other 99 packages and existing
configuration remain unchanged. This qualifies the CLI cutover, not Desktop.
Do not introduce another runner, process manager, Cargo wrapper or private
desktop workspace.

The inherited source manifest used `src/kernel`, `src/platform` and
`src/compat` paths while live external owners had moved to `crates/`. It also
derived sources from the MSYS2 installation and discovered workspaces by
enumerating Home. Those assumptions must be replaced with explicit source,
installation and workspace contracts and registry-selected physical owners.
The schema 2 source now implements that separation, loads the selected vendor
registry, and delegates Desktop inspection and bounded processes to root APIs.
Its `--help` works without selecting an installation or workspace. The inherited
`pipeline plan`/`validate` called `linkSources()` before inspection; that source
mutation has been removed. `link` now validates the flat source bindings without
creating duplicate junctions. The installed release now uses this contract.

The eight old CachyOS junctions under the installed source-view root were
removed on 2026-10-16; their vendor targets are intact. The inspector reads
only canonical vendor repositories, so no duplicate or external path enters the
metadata lock.

Explicit synchronization, packaging and publishing retain their existing
commands and permission boundaries. Synchronization fetches registered,
initialized owners without cloning missing repositories or rewriting remotes.
The external engine build requires its explicit workspace and delegates to that
owner's existing package build script. Its eight inherited emulator names resolve
first through the vendor registry, then through `crates/<name>` in an explicitly
selected external engine workspace; no Home discovery or source duplication is
required. Missing external selection remains visible in the plan.
Package release 8 records exact hashes
for its four public source inputs and uses a neutral compiled help qualification.
Native Linux package recipes and graphics
source catalogs are not permission to install Linux payloads on Windows.
Build processes must use the root's bounded process owner and serialized Cargo
owner with the selected workspace and target.

## Qualification still required

The native Bun formatting, lint and type gates qualify adapter code only.
Before Desktop release, require the selected Bun executable/source hash,
toolchain/SDK/CRT receipt, signed native package archive closure and hashes,
versioned DLL contracts, existing graphics/windowing artifacts, Windows
display/input/audio/process qualification, package notices and activation
evidence. Neither a source fork, a compiled CLI nor a pacman inventory proves
these Desktop runtime properties.
