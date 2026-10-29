# Product Cargo source vendor

`vendor/cargo` is **not committed**. It used to hold 543 crates.io sources (674 MB) but never fed a build:
`.cargo/config.toml` has no `[source]` replacement, CI and `release.yml` build with `--locked` against the registry,
and the snapshot covered 543 of the 2805 registry packages in `Cargo.lock` (and `cc-1.8.0` lacked its `src/target/*`
files). Builds resolve from `Cargo.lock`. The directory is gitignored; the commands below regenerate it
with `cargo vendor` when an offline or audited snapshot is wanted.

`scripts/vendor-cargo.ts` owns the root Cargo source snapshot. It uses the
existing native admission wrapper, root nightly and shared process deadlines.
It does not create another workspace, modify root manifests/lockfiles, compile
Rust, activate source replacement, or clean external caches. The separate
`cargo-build-proof.ts` entry point uses the same native owner to qualify builds.

## Prepare and qualify

From the root, with its exact configured Bun runtime:

```sh
bun scripts/vendor-cargo.ts plan
bun scripts/vendor-cargo.ts prepare
bun scripts/vendor-cargo.ts verify
```

Each action is serialized by `runNative`. Plan is bounded to 30 seconds;
prepare and verification have a 180-second limit. Plan
captures the root manifest/lock and each flat member manifest. It inventories
cached compressed registry archives before downloads. Prepare requires that
exact snapshot and runs `cargo vendor --locked --versioned-dirs --no-delete`
into `vendor/cargo`. Partial copies remain resumable; caches remain intact.

Verify supplies a temporary absolute source configuration only to
`cargo metadata --locked --offline --all-features`. It compares every package name, version,
and original source identity to Cargo.lock, checks archive checksum identities
and manifest/license/notice file digests, rejects extra packages and escaped
source paths, and limits expanded sources to 2 GiB. Inventory preserves upstream
license identities; it does not substitute the root license.

## Staged configuration

Cargo's emitted table becomes `source-replacement.toml` here. Merge it into
root `.cargo/config.toml` only after offline metadata and the root compilation
gate both pass. This is a snippet for root configuration, not a portable standalone
configuration. Verification uses a generated absolute test configuration under
`build/vendor`; the active source table remains untouched.

`cargo-inventory.json` is written only after source verification. Its `compiled`
flag comes from a revalidated build receipt; its `activeSourceReplacement` flag
comes from the actual root configuration. Neither flag is inferred from a
source plan or an old successful check. Actual source sizes and package counts
belong to that inventory; cached archive size is preflight evidence only.

## Native build proof

```sh
just cargo-build-plan
just cargo-build-status
just cargo-build
```

Plan reads and hashes sources within 30 seconds. Status reports `missing`,
`invalid` or `valid` build evidence. Build captures inputs before and after,
runs Cargo directly under the native mutex with a 300-second deadline, and
requires exit 0, Cargo's successful `build-finished` message and hashed artifacts
for every root member. It builds offline with the lockfile and all features.
Cargo also emits build-script executables and `.rmeta` paths beneath the
configured `build/rust` intermediate directory. These intermediate outputs are
excluded from the receipt; each member must
still supply a final artifact beneath `target`, whose bytes are hashed. Other
artifact locations remain rejected.
Capture phases each have a separate 30-second deadline. Run this command as a
bounded background build on an admitted host; partial Cargo outputs stay in
the shared cache and do not produce a successful receipt.

The local `build/vendor/cargo-build-receipt.json` binds member source trees and
revisions, manifests, lockfile, vendor bytes, source configuration, execution
scripts, Bun/Cargo/rustc binaries and hashed build flags. Subsequent input or
artifact changes invalidate it. Parent commits that change only unrelated
documentation do not invalidate the source key; Git ancestry is still checked.
No credential values are recorded. A successful check is separate from this
full build proof. The current 28-member build receipt validates successfully.
The receipt and execution owner share Rust cache-wrapper normalization, so
validation binds the effective compiler environment in either calling context.

## Scope and upstream integrity

This snapshot covers the current root product Cargo members. Runtime native
vendors, nested library workspaces, npm modules and protected application stores
are separate open migration work. Existing source locks, Git pins and license
owners remain unchanged. Different locked upstream versions remain distinct
package identities. Editing upstream sources requires their normal patch/source
owner; replacement assumes equivalent sources.

References: [Cargo vendor](https://doc.rust-lang.org/cargo/commands/cargo-vendor.html)
and [Cargo source replacement](https://doc.rust-lang.org/cargo/reference/source-replacement.html).

## Qualified snapshot

The 2026-10-14 snapshot contains 28 root members and 543 remote packages
(542 registry packages plus the Git-pinned winprint source). Offline metadata
with all root features resolves exactly the 571 lockfile package identities.
Cargo nightly-2026-09-15 is recorded in the generated inventory. Source content
is 671768402 bytes across 28572 checksum-listed files. Manifest, notice and
declared license files are independently checked. The complete root Cargo check
and offline build with all features pass, producing 28 hashed final artifacts
(see [native qualification](../NATIVE-QUALIFICATION.md)). Source replacement is
supplied explicitly to this root build; global activation remains pending
compatibility qualification of the nested library and runtime workspaces.
The active source configuration, toolchain, source lock and Git module ledger
hashes are recorded in the inventory.
