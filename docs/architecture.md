# Repository architecture

This page records repository structure visible in the checked-in manifests and
entry points. It does not claim that declared products or target combinations
have been built, deployed or qualified.

## Owners and entry points

| Area             | Repository evidence                                                | What that evidence establishes                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Distribution CLI | `src/cli.ts`, `src/cli/`                                           | Command routing and CLI implementation are present.                                                                                                                                                                                        |
| Bun workspace    | Root `package.json`, `bun.lock`, `bunfig.toml`                     | A root Bun workspace and dependency lock are declared.                                                                                                                                                                                     |
| Cargo workspace  | Root `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`             | A root Cargo workspace and toolchain are declared; exclusions and nested workspaces mean it is not the sole Rust workspace.                                                                                                                |
| Runtime          | `package.json`, `sources.lock.json`, `toolchains/bun` when present | The checked-in product guidance selects Aphrody Bun; verify the selected executable and source pin against current checkout state. A local `toolchains/bun` directory may be untracked and is not evidence of a parent-repository gitlink. |
| Factory          | `factory/`, `src/distribution.ts`, `distribution.json`             | Factory code and configuration are present. A manifest entry alone does not prove an image was produced.                                                                                                                                   |
| Product sources  | `apps/`, `crates/`, `packages/`                                    | Source directories exist. Membership and ownership must be checked from manifests and source inventory.                                                                                                                                    |
| Imported sources | `vendor/`, `sources.lock.json`, `.gitmodules`                      | Some external sources and pins are declared. Inspect each source's provenance and status independently.                                                                                                                                    |

## Declared product configuration

`distribution.json` declares the `full` and `perf` profiles; targets
`linux-x64`, `linux-arm64`, `windows-x64`, `macos-arm64` and `wasm`; and the
`server`, `desktop` and `gaming` compositions. It selects `pacman/libalpm` and
the Arch Linux family for the Linux distribution configuration. The file labels
qualification as `development`. These values define configuration; they are
not build or release receipts.

## Migration boundaries

The root Cargo manifest explicitly excludes source trees, and some Rust
projects retain nested workspaces. Therefore the repository does not yet have
one authoritative Cargo workspace. Do not infer consolidation from a crate
directory or a root manifest entry alone.

The root package manifest declares Bun workspaces. Nested `package.json` files
may serve as leaf package metadata or remain with independently owned source.
Use the root manifest, lockfile and package inventory to establish actual
workspace membership; do not infer it from directory counts.

Imported projects keep their own histories, licenses and source boundaries
until a documented migration changes those boundaries. Root-level product
assembly does not transfer upstream source ownership.

## Qualification evidence

Keep source inventory, package resolution, compilation, tests, runtime checks,
image assembly, boot/hardware validation and release qualification distinct.
Report a stage only when its current receipt or command output establishes it.
`PLAN.md` tracks migration work; `factory/` and `docs/NATIVE-QUALIFICATION.md` describe
factory and qualification interfaces.

For the first-party/vendor navigation map, submodule inventory commands, and
Aphrody Search API entry points, see [`docs/REPOSITORY-MAP.md`](REPOSITORY-MAP.md).
