> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork (`toolchains/bun/src/coreutils`, `bun_coreutils`). The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# System utilities inventory (coreutils, util-linux, binutils, ...)

Status: 2026-10-16. Scope: `crates`, `packages`, `apps`, `vendor`, `toolchains` of this
checkout, sibling repositories in `C:\src\*` (`android`, `blender`, `iecode`, `rea`,
`bun-engine`, `shenron`, `aphrody`, `bun`) and `~/.cargo/registry`.

## Implementations found

| Implementation                                                       | Path                                                                                                                                        | Language | License      | Consumers                                                                                                                                                 | Notes                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun_coreutils` (uutils multicall, 79 `uu_*` applets)                | `toolchains/bun/src/coreutils`                                                                                                              | Rust     | MIT (uutils) | `bun` runtime (`src/runtime/cli/mod.rs` argv0 dispatch, `src/runtime/shell/states/Cmd.rs` Bun Shell fallback), cargo feature `coreutils` (off by default) | Sources fetched from `aphrody-labs/uutils-coreutils` by `scripts/build/deps/uutils.ts`; not checked out (`vendor/uutils` absent). Excludes Bun Shell builtins by design. |
| Same `bun_coreutils`                                                 | `C:\src\bun\src\coreutils`                                                                                                                  | Rust     | MIT          | standalone `aphrody-labs/bun` clone                                                                                                                       | Same repository as `toolchains/bun` (another checkout, not a source duplicate).                                                                                          |
| Bun Shell builtins (20)                                              | `toolchains/bun/src/runtime/shell/builtin/*.rs`                                                                                             | Rust     | MIT (Bun)    | Bun Shell `$\`...\``                                                                                                                                      | `basename cat cd cp dirname echo exit export false ls mkdir mv pwd rm seq test touch true which yes`; async, in-process, cross-platform.                                 |
| `aphrody-nu`                                                         | `crates/aphrody-nu`                                                                                                                         | Rust     | Apache-2.0   | Aphrody kernel shell subsystem                                                                                                                            | Spawns an external `nu`; embeds no Nushell command crates.                                                                                                               |
| `aphrody-proc`                                                       | `crates/aphrody-proc`                                                                                                                       | Rust     | Apache-2.0   | llama supervisor, sandbox, training runner                                                                                                                | Process groups, kill, liveness; not a `ps`/`kill` CLI.                                                                                                                   |
| `aphrody-fsindex`                                                    | `crates/aphrody-fsindex`                                                                                                                    | Rust     | Apache-2.0   | Aphrody search                                                                                                                                            | FTS5 index; not a `find`/`locate` CLI.                                                                                                                                   |
| PE/ELF inspection (`goblin`, `object`)                               | `crates/aphrody-nie-pe-inspect`, `aphrody-nie-re`, `aphrody-nie-cli`, `crates/re`, `crates/ghidra-decompiler`, `C:\src\iecode\crates\nie\*` | Rust     | per crate    | RE tooling                                                                                                                                                | Domain RE analysis (PE recovery), not `nm`/`readelf` CLIs.                                                                                                               |
| `vendor/cachyos-*`, `vendor/cachyos-linux`                           | `vendor/`                                                                                                                                   | mixed    | upstream     | `/usr` factory                                                                                                                                            | Packaging/kernel sources; no utilities. Previous `vendor/llvm`, `vendor/make`, `vendor/cmake` entries are deleted in the working tree by a concurrent agent.             |
| GNU coreutils, util-linux, binutils, procps-ng, findutils, diffutils | Arch `core` packages                                                                                                                        | C        | GPL          | `/usr` factory (`base`, `base-devel`)                                                                                                                     | Pulled by pacman, not vendored.                                                                                                                                          |

Siblings `android`, `blender`, `rea`, `bun-engine`, `shenron`, `aphrody`: no coreutils,
util-linux, binutils or Nushell implementation. `~/.cargo/registry`: `object` 0.36/0.37/0.39,
`gimli`, `addr2line`, `goblin`, `sysinfo`, `similar`, `rustc-demangle`; no `uu_*` crate was
cached before `bunos-utils`.

## Canonical owners

| Suite                                             | Canonical owner                                                                      | Applets                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| In-process `bun` multicall and Bun Shell fallback | `toolchains/bun/src/coreutils` (`bun_coreutils`)                                     | unchanged                                                                                        |
| Bun Shell builtins                                | `toolchains/bun/src/runtime/shell/builtin`                                           | unchanged; the builtin set stays in Bun Shell, every other command falls back to `bun_coreutils` |
| System `/usr` multicall                           | `crates/bunos-utils`                                                                 | see `bunos-utils --list`                                                                         |
| coreutils                                         | `vendor/uutils/coreutils` (aphrody-labs fork, branch `aphrody`), feature `coreutils` | 66 portable + 13 unix applets                                                                    |
| findutils                                         | `vendor/uutils/findutils` (aphrody-labs fork), feature `findutils`                   | `find`, `xargs`                                                                                  |
| diffutils                                         | `vendor/uutils/diffutils` (aphrody-labs fork, branch `aphrody`), feature `diffutils` | `diff`, `cmp`                                                                                    |
| procps                                            | `vendor/uutils/procps` on Linux, `sysinfo` elsewhere, feature `procps`               | `ps`, `top`, `free`, `pgrep`, `pkill`, `pidof`, `pmap`, `sysctl`, `vmstat`, `w`, `watch`, ...    |
| util-linux                                        | `vendor/uutils/util-linux` (Linux), feature `util-linux`                             | `dmesg`, `lscpu`, `lsmem`, `cal`, `hexdump`, `setsid`, `uuidgen`, ...                            |
| binutils                                          | `bunos-utils::binutils{,_write}` on `object`, `addr2line`, `ar`, feature `binutils`  | `nm`, `size`, `readelf`, `objdump`, `strings`, `addr2line`, `strip`, `objcopy`, `ar`             |

All uutils sources are flat submodules under `vendor/uutils`, excluded from the root Cargo
workspace and consumed by path. `toolchains/bun/scripts/build/deps/uutils.ts` pins the same
coreutils fork commit, so `bun_coreutils` and `bunos-utils` share one source; the former
`toolchains/bun/patches/uutils` patches are now commits on the fork branch.

## Duplicates

The `bun_coreutils` patch series was retired into the fork. The Bun Shell builtins and
`bun_coreutils` split command names (one implementation per name inside `bun`); no
`aphrody-*` crate reimplements a utility CLI. `aphrody-nu` keeps delegating to `nu`.

## `/usr` integration

`factory/usr/manifest.json` key `multicall` declares the crate, target, features and link
directory. The overlay ships `usr/share/bun-os/bunos-utils.applets` and
`usr/lib/bun-os/install-bunos-utils <root>`, which links every applet to
`/usr/bin/bunos-utils` under `/usr/lib/bunos-utils/bin`. Pacman keeps owning the GNU names in
`/usr/bin`; prepend the link directory to `PATH` to prefer the Rust applets.

## Remaining

- Build the Linux `bunos-utils` binary in the factory and call `install-bunos-utils` from
  `factory/usr/builder.sh` (owned by the `/usr` agent).
