# Spacedrive in Bun OS: provenance and resynchronisation

Spacedrive is the file manager and file service of Bun OS. This repository carries the
upstream source under `apps/spacedrive`; it is a copy, not a submodule, so that its Rust
crates and JS packages are members of the root Cargo and Bun workspaces.

## Origin

| Item | Value |
| --- | --- |
| Upstream | https://github.com/spacedriveapp/spacedrive (default branch `main`) |
| Fork that tracks it | https://github.com/aphrody-labs/spacedrive (no local commits; `main` is fast-forwarded from upstream) |
| Imported commit | `4d41a379f612e23ac43a66ffd67df52ca77f57d4` ("Fix the macOS build (Volume.locked) and gate main on a macOS cargo check (#3154)", pushed 2026-10-13) |
| Import date | 2026-10-29 |

## Licence

The whole upstream tree is Apache-2.0: `LICENSE` (Apache License 2.0) and `NOTICE`
("Copyright 2026 Spacedrive Technology Inc.") at the root; there is no other licence file in
any subcomponent. `NOTICE` records that releases published before 2026-03-24 were AGPL-3.0
and stay available under that licence. The code imported here is newer than that date, so it is
Apache-2.0. `LICENSE` and `NOTICE` are kept byte for byte in `apps/spacedrive/` and in
`docs/spacedrive/`; source headers are untouched.

Run `grep -rli "agpl" apps/spacedrive` to re-check after a resync (the only hits are the
`NOTICE` sentence above, a podspec and a plan document, never a licence grant).

## Layout

| Upstream path | Here |
| --- | --- |
| `core`, `crates/*`, `apps/{server,cli,tauri,web,mobile,native}`, `packages/*`, `adapters`, `extensions`, `xtask` | `apps/spacedrive/<same path>` (layout kept so that relative paths, `include_str!` and build scripts work unchanged) |
| `docs/` | `docs/spacedrive/upstream/` |
| `LICENSE`, `NOTICE` | `apps/spacedrive/` and `docs/spacedrive/` |
| root `Cargo.toml`, `Cargo.lock`, `package.json`, `bun.lockb` | `apps/spacedrive/.upstream/*.orig` (reference only; merged into the Bun OS root manifests) |

Cargo workspace members and Bun workspaces are listed in the root `Cargo.toml` and
`package.json`. `apps/spacedrive/apps/native` (GPUI, git dependency on a Zed fork) is excluded
from the Cargo workspace, as are the extensions, which are WASM crates built on their own.

## Edits to the imported tree

Only manifests are changed, by `scripts/spacedrive/sync.ts`, and nothing else:

1. `Cargo.toml`: `x.workspace = true` for an upstream workspace dependency that the Bun OS root
   pins differently (axum 0.7, tokio 1.42, base64 0.22, rand 0.9-alpha, toml 0.8, strum 0.26,
   reqwest 0.12, specta git fork and others) is expanded to the upstream requirement, so
   upstream code compiles against the APIs it was written for. Requirements that are semver
   compatible resolve to one crate in `Cargo.lock`; the incompatible majors remain duplicated
   until the Spacedrive code is ported (listed by `bun scripts/spacedrive/sync.ts <checkout> --check`).
   Package-field inheritance (`edition`, `license`, `repository`, `rust-version`) is made
   explicit because the root `[workspace.package]` belongs to Bun OS.
2. `package.json`: dependencies that the root Bun `catalog` pins become `catalog:`.
3. Dependencies the root did not pin (`sqlx`, `iroh`, `lancedb`, `ort`, ...) are added to the
   root `[workspace.dependencies]` with the upstream requirement.

## Resynchronising with upstream

```sh
gh repo sync aphrody-labs/spacedrive --branch main          # fast-forward the fork (never force)
git clone --depth 1 https://github.com/aphrody-labs/spacedrive.git /tmp/sd
bun scripts/spacedrive/sync.ts /tmp/sd                        # replaces apps/spacedrive and docs/spacedrive/upstream
bun scripts/spacedrive/sync.ts /tmp/sd --check                # lists expanded and missing workspace deps
```

Then update the commit hash above, add any new `[workspace.dependencies]` the script reports
as missing, rebuild `Cargo.lock`, and run the gates (`.github/workflows/spacedrive.yml`).
Integration code (webos bridge, packaging) lives outside `apps/spacedrive` so a resync never
touches it. Upstream history stays in the fork; this repository records only the imported hash.

## Not imported or not built

- Copied but not built here: `apps/mobile` (React Native, iOS and Android toolchains),
  `apps/native` (GPUI), the WASM extensions.
- The previous M3-refactored copy (`apps/aphrody-drive`, `crates/aphrody-drive`,
  `packages/drive-client`) is deleted; its last commit is tagged `legacy/aphrody-drive-last`
  and its unique features are in [UNIQUE-FEATURES.md](UNIQUE-FEATURES.md).
