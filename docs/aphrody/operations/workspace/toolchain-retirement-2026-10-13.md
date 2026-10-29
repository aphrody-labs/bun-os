<!-- SPDX-License-Identifier: Apache-2.0 -->
# Windows toolchain retirement — 2026-10-13

The owner requested removal of old Bun/Python/toolchains and retired local and
GitHub repositories. This batch preserves concurrent work, provider stores and
the toolchains required by the selected repositories.

## Applied

- The configured user Bun installation now runs `1.4.4`, revision
  `1.4.4-canary.1+2ae8fc65f`, from the previously qualified native owner build.
  SHA-256 was checked before and after installation:
  `a6f79203a9601914e86479f103c7f695330d54442169566f64e29328440d9c89`.
  This is local build activation, not a checksum-verified public download.
- `bunx`, `node`, `npm`, `npx`, `uv` and `uvx` aliases reference that same
  executable. Native alias probes passed; `uv` and `uvx` report `0.12.24`.
  Seven retired executable names were removed; no `.exe.old-*` file remained.
  Existing processes were not terminated or deprived of their open resources.
- Rust `1.97.1-x86_64-pc-windows-msvc` was uninstalled through rustup after checking
  its resolved store path and absence of active compiler processes using it.
  Rust 1.98.1 remains pinned by Aphrody and IECODE. Bun requires
  `nightly-2026-09-15`; the newer default stable installation reports 1.99.0.
- Bun hygiene now recognizes a current base version when comparing historical
  fork releases, preventing a 1.4.4 installation from being downgraded to 1.4.3.
  Four tests, native types, lint and formatting passed.

The managed Python inventory showed one qualified Aphrody CPython 3.12.15
installation under three executable aliases. Windows uninstall metadata showed
no additional Python installation. The qualified interpreter, environments and
native Python host remain in their existing stores; no old Python removal is
claimed. Compiler/toolkit installations still used by current contracts remain.

## Repository qualification

The native authenticated GitHub owner inspected 218 Aphrody Labs repositories.
Age, archive state and reported size alone do not establish retirement.

`aphrody-labs/aphrody-runtime-sdk` was qualified as an obsolete reservation:
one branch, one initial commit, one 59-byte README, no tags, releases, issues,
workflow runs, repository secrets, variables or environments. Its public wiki
Git endpoint does not exist. No current source/config dependency was found.
The active SDK is published as `@aphrody/bun-runtime-sdk@1.4.4`; generated
Material projects preserve the former import identity using an npm alias.
Their real registry installation and native typecheck passed.

The first native deletion request returned GitHub HTTP 403. The active
`aphrody-dev` account administers the repository but lacks `delete_repo` in its
stored OAuth scopes. The stored `aphrody-code` account has that scope but its
actual repository permission is read-only; it was not used for deletion.
Deletion remains unqualified until administrator authentication supplies the
required scope and the repository snapshot is rechecked.

Other repositories and clones were not deleted solely from names or age.
The temporary TypeSafe clone's earlier automatic deletion rejection remains in
effect; this batch does not retry that operation through another mechanism.
