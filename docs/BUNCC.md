# buncc: Bun C Compiler

`buncc` (`packages/buncc`, npm `@aphrody/buncc`, CLI `buncc`) is the one tool that finds, installs, pins and drives the native
toolchains of Bun OS, and builds the workspace with them. It is plain TypeScript on unmodified upstream Bun: it uses only
`Bun.spawn`, `Bun.which`, `Bun.file`, `Bun.TOML`, `Bun.Glob`, `Bun.CryptoHasher` and Node built-ins. It replaces the fork-only
`bun msvc exec` (the fork command does not exist on upstream Bun).

Run it as `bun buncc <command>` (root script), `bun packages/buncc/src/cli.ts <command>`, or `bunx @aphrody/buncc` once
published (not published yet: npm and crates.io publication needs the owner's approval; no crate exists because no measured
need for one has appeared).

## Commands

| Command | What it does |
| --- | --- |
| `buncc cc \| c++ \| ar \| link ...` | `cc`-compatible driver, usable as `CC`, `CXX`, `AR` |
| `buncc doctor` | toolchain report with fix hints, sccache health, stale environment variables, AOT-incompatible components |
| `buncc install <provider> [--run]` | prints the unattended install command; runs it only with `--run` |
| `buncc env <provider\|all> [--shims]` | environment overlay as JSON; `--shims` writes `cc`/`c++`/`ar`/`link` launchers and sets `CC`/`CXX`/`AR` |
| `buncc which <tool>`, `buncc pin` | locate a tool, show pinned minimums (`buncc.toolchain.json`, `rust-toolchain.toml`) |
| `buncc plan [-p crate] [--affected[=base]]` | workspace layers in dependency order, job budget |
| `buncc check \| build \| test \| clippy \| fmt [-p crate] [--affected[=base]] [--jobs N] [--release] [-- extra]` | cargo through the lock, slot and environment logic |
| `buncc exec -- <cargo args>` | any cargo command through the same logic (what `scripts/cargo.ts exec` uses) |
| `buncc lsp [--out dir]` | writes `compile_commands.json` from the driver's log, and `.clangd` |
| `buncc bundle`, `compile`, `aot`, `wasm` | `bun build` presets, `bun build --compile [--aot]`, wasm (delegates to `packages/wasm/src/buncc.ts` when present) |
| `buncc package <msix\|appx\|msi\|exe\|zip>`, `sign`, `store` | Windows packaging plans (dry run unless `--run`) |
| `buncc profile list\|show\|apply <id>`, `buncc bench aot-bun <entry>` | named build profiles and the measured Bun AOT benchmark |

## Adopt, extend or write

| Need | Decision | Why |
| --- | --- | --- |
| Cargo run, deadline, process-tree kill | **migrated** from `packages/bun-workspace` `serializedCargo` (`bun-workspace` now calls `buncc/cargo`) | one owner; the PowerShell mutex wrapper is replaced by lock files |
| Rust workspace graph for `plan` | **write** (small): `cargo metadata --no-deps` | it is the only source that knows build/dev dependency kinds; `factory/bunos/workspace-graph.ts` reads tracked files for component integration checks and stays the owner of that job |
| Cross-compile to windows-msvc | **adopt** `cargo-xwin` / `xwin` (provider by the toolchains agent) | not recoded |
| Compiler cache | **adopt** sccache; buncc only probes its health and bypasses it | not recoded |
| C dependencies | **adopt** vcpkg (provider), CMake presets are left to CMake | not recoded |
| .NET NativeAOT, winget, CMake, clang, make, ninja, gn, wix, MSIX | **adopt** the providers in `providers/toolchains.ts` (they replace the detect-only core ones of the same id) | verified downloads and argument builders |
| JS task cache / affected | **not done**: turborepo is not wired; `--affected` only covers Cargo crates | no measurement yet |
| `crates/bun-os-git`, `crates/aphrody-infra`, `infra/` | **not reviewed or reused yet**: buncc shells out to `git diff --name-only` for affected selection | listed so it is not mistaken for done |

## Environment (MSVC, sccache, stale paths)

- MSVC: `vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json -utf8`
  (vswhere lives at `%ProgramFiles(x86)%\Microsoft Visual Studio\Installer`, see Microsoft Learn,
  "Tools for detecting and managing Visual Studio instances"), then `VC\Auxiliary\Build\vcvarsall.bat <arch>` is run in a temp
  batch file and its `set` output diffed against the current environment. The diff is cached in
  `%LOCALAPPDATA%\buncc\vcvars\<key>.json`, keyed by the path and mtime of `vcvarsall.bat` and its arguments.
- Stale paths: `sanitizeEnv` drops single-path variables (`PROTOC`, `PROTOC_INCLUDE`, `LIBCLANG_PATH`, `VCPKG_ROOT`, ...) whose path
  is gone, removes missing entries from list variables (`INCLUDE`, `LIB`, `C_INCLUDE_PATH`, `PKG_CONFIG_PATH`, ...) and drops program
  variables (`RUSTC_WRAPPER`, `CC`, ...) whose program is missing. On this machine it removed a `PROTOC_INCLUDE` pointing into a
  deleted checkout and four WinLibs include paths.
- sccache: only used when `RUSTC_WRAPPER` already names it or `BUNCC_SCCACHE=on`. Before use, `sccache --show-stats` must succeed;
  otherwise the wrapper is removed from the environment for this run (`BUNCC_SCCACHE=off` forces that).
- Cargo locking: one global slot by default (`BUNCC_SLOTS=N` for N parallel builds; slot N builds into `target/slot-N`), plus a
  lock file per target directory under `%LOCALAPPDATA%\buncc\locks`. A dead holder or a lock older than 4 hours is broken. The
  deadline (default 30 minutes) covers waiting plus the build, and kills the whole process tree (`taskkill /T /F` on Windows).

## The cc driver

`buncc cc|c++|ar|link` picks the tool (`cl` then `clang-cl` then `clang` on a Windows MSVC target; `clang` then `gcc` for gnu
targets or on Linux), translates flags between dialects, enters the MSVC environment when `cl`, `lib` or `link` is chosen, wraps
compiles in sccache when it is healthy, and appends a `compile_commands.json` entry to `$BUNCC_COMPILE_COMMANDS` (JSONL, merged by
`buncc lsp`). `BUNCC_COMPILER=cl|clang-cl|clang|gcc` overrides the choice.

Translated GNU to MSVC: `-c -o -I -D -U -isystem -include -O0/-O1/-Os/-O2/-O3 -g -std= -Wall -Werror -w -fexceptions
-fno-exceptions -frtti -fno-rtti -shared -x -L -l`; dropped on purpose: `-fPIC -pthread -pipe -static -MD -MF ...`. MSVC to GNU is the
reverse for `/c /Fo /Fe /I /D /U /O* /Z7 /std: /W* /WX /EH* /FI /LD /link ...`. Unknown flags pass through and are listed on stderr.
Use `cc-rs`/CMake through the shims (`buncc env --shims`, or `BUNCC_DRIVER=1` for cargo); it is opt-in because it adds one Bun start
(about 0.4 s measured for `cc -c` of a one-line file) per compiler call.

Boundary with upstream Bun: `cc` from `bun:ffi` compiles C with TinyCC inside the runtime for small JIT/FFI cases (upstream
`docs/runtime/c-compiler.mdx`). It is not a build tool: it targets the running process, has no linker or MSVC ABI, and is not
used by buncc for workspace builds. buncc only drives real compilers.

## Providers

Each provider has `detect`, `install`, `env` and `pin` (`packages/buncc/src/providers`). Present: `msvc` (vswhere, vcvarsall, Windows
SDK), `rust` (rustup toolchain from `rust-toolchain.toml`, currently `nightly-2026-09-15`), `vcpkg` (root and toolchain file; manifest
mode flags are not wired), `winget` (installs use `--exact --silent --accept-package-agreements --accept-source-agreements
--disable-interactivity`), `cmake`, `ninja`, `make`, `clang`, `clang-cl`, `lld`, `clangd`, `gcc`/`g++` (MSYS2 ucrt64), `protoc`,
`sccache` and `sccache-health`, `cargo-xwin`, `cargo-zigbuild`, `zig`, `mold`, `gn`/`depot_tools` (detection only), `dotnet`,
`makeappx`, `signtool`, `wix`, `iscc`, `makensis`, `readelf`. Install commands are printed and only run with `--run`.
`cargo-xwin` downloads the Microsoft SDK, which carries a licence: buncc does not accept it for you.

## Profiles and measured numbers

`buncc profile list` names six profiles: `aot-bun`, `aot-dotnet10`, `aot-dotnet11`, `win32-msvc`, `win32-clang`, `glibc-gnu`.
`profile show <id>` prints the commands, the sources the flags come from and what is unmeasured.

Measured on the dev machine (Windows 11, Bun 1.4.4-canary, 24 cores), `buncc bench aot-bun` on a one-line `console.log` program,
one build each, start-up median of 7 runs:

| | build ms | size MiB | start median ms |
| --- | ---: | ---: | ---: |
| `bun build --compile` | 937 | 142.1 | 17.1 |
| `... --aot` | 628 | 80.2 | 15.6 |
| `... --aot --minify` | 1595 | 80.2 | 13.6 |

A trivial program, one build per row: build times are noisy. Re-run on your own entry point before relying on it. Not measured: .NET 10/11 NativeAOT, Win32 `/LTCG` vs clang-cl,
glibc profiles (no Linux host here), so those profiles make no size or speed claim.

Rust compiler options, `cargo check -p bun-steam` from a cold target directory, 3 runs of whole seconds each: default 3 to 5 s,
`-Zthreads=8` 3 to 5 s, sccache off or on 3 to 5 s. Differences are inside the timer resolution, so none is adopted. Cranelift, lld,
mold, wild and cargo-zigbuild were not measured and are not enabled.

Bun AOT facts used (upstream canary `bun build --help`, `docs/compiler`): `bun compile` is `bun build --compile --aot`, but buncc
calls the long form because a `compile` script in `package.json` would shadow the alias; `--aot-allow-code-from-disk` needs `--aot`;
AOT executables ignore `bunfig.toml` preload and reject `--preload` unless built with `--aot-allow-code-from-disk`, so `buncc doctor`
lists components of `factory/bunos/components.json` with `aot:false` (or a preload/`Bun.plugin` registration without `aot:true`).
`-baseline` and `-modern` targets are accepted by Bun and resolve to the same x64 binary; buncc normalises them away.
`--windows-icon/-title/-publisher/-version/-description/-copyright` need a Windows host; only `--windows-hide-console` works in a
cross-compile (buncc refuses the others). Bun removes the Authenticode signature when it rewrites an exe: sign after compiling.

## Packaging (dry run by default)

Preference order: MSIX, Inno Setup exe, WiX msi, portable zip + winget manifest. `buncc package msix` writes a minimal full-trust
`AppxManifest.xml` (`runFullTrust`, `uap10:RuntimeBehavior="packagedClassicApp"`) and runs `makeappx pack`. The Store re-signs an MSIX, so an
MSIX is submitted unsigned (this does not hold for MSI or EXE installers, which must already be signed); the package `Publisher` must match the signing certificate subject for sideloading. WiX needs the OSMF EULA
accepted: buncc marks that step "needs explicit owner approval", refuses to run it, and never runs `wix eula accept wix7` itself.
Signing and `msstore publish` are printed, never executed, `msstore publish` takes a project directory by default, so a ready package is submitted with `msstore publish -i <package> --appId <id>`
after `msstore reconfigure` with Microsoft Entra credentials; the WACK steps (`appcert reset`, `appcert test`) are optional because Learn marks
WACK deprecated. These command lines are dry-run output and not yet exercised here. The MSIX manifest targets Windows 10 19041+ because
it uses `uap10` attributes; vcpkg is cloned in full because manifest-mode baselines need history.

## CI

`.github/workflows/ci.yml` runs `bun test packages/buncc`, `buncc doctor`, and uses `buncc check`, `buncc exec -- check ...` and
`buncc exec -- clippy ...` for the Rust jobs. `scripts/cargo.ts` keeps its interface and calls the same code, so `release.yml`
and the docs that name it keep working. `packages/bun-workspace` re-exports `runCargo` and `prepareCargoEnvironment` from buncc
and its `serializedCargo` now delegates to it.

## Tests

`bun test packages/buncc`: flag translation, environment sanitising, compiler choice, workspace layering and affected-crate selection,
job limits, cargo argument lists, lock files, compile-target parsing, Bun compile arguments, packaging manifests, vswhere/vcvars helpers,
install plans, glibc floor parsing. Only CI can confirm the Linux and Windows runner behaviour and the frozen `bun install` with the
hand-edited `bun.lock` entry.
