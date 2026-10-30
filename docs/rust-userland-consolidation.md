# Rust userland and desktop consolidation

Status: 2026-10-30. Upstream merges done; Cargo workspace migration pending.

## Pinned forks (all merged with upstream, no force-push)

| Mount | Fork | Upstream | Cargo state |
| --- | --- | --- | --- |
| `vendor/uutils/coreutils` | `aphrody-labs/uutils-coreutils` (`aphrody`) | `uutils/coreutils` | nested workspace, excluded from root; consumed by path in `crates/bunos-utils` |
| `vendor/uutils/{findutils,diffutils,util-linux,procps}` | `aphrody-labs/uutils-*` | `uutils/*` | nested workspaces, consumed by `crates/bunos-utils` |
| `vendor/nushell` | `aphrody-labs/nushell` | `nushell/nushell` | nested workspace, external pinned owner |
| `vendor/cosmic-epoch` | `aphrody-labs/cosmic-epoch` | `pop-os/cosmic-epoch` | 31 component submodules, no single workspace; stable Rust |
| `vendor/pop-os` | `aphrody-labs/pop` | `pop-os/pop` | meta/index repo, no Rust code |
| `vendor/{distinst,system76-power,system76-firmware}` | `aphrody-labs/*` | `pop-os/*` | nested workspaces, external pinned owners |

Add a remote named `upstream` in each fork checkout and merge from it; never
force-push.

## Qualification

- `cargo check -p bunos-utils` on the VPS (nightly-2026-09-15) passed against
  the merged uutils pins.
- nushell, cosmic-epoch and the Pop crates have not been built through the
  root graph yet.

## Remaining migration

Nested workspaces stay until their manifests migrate in controlled batches.
`vendor/uutils` is still in the root `exclude` list. COSMIC builds on stable
Rust, so it remains a separate composition from the nightly root toolchain.
