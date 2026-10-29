# Bun OS C

A complete, reproducible, open C/C++ environment for Windows and Linux hosts and targets, defined as data
(`factory/c/c-env.json`) plus a tool (`buncc c`). Observed 2026-10-29.

```
buncc c targets | doctor | env <triple> | sysroot <triple> | build <triple> <file.c> | test
just c-doctor | c-targets | c-test | c-bench
```

## Target matrix

| Triple | Compiler / linker | libc | Headers (source) | Runner for the smoke binary |
| --- | --- | --- | --- | --- |
| x86_64 / aarch64 / i686 `-pc-windows-msvc` | clang-cl 23.1.x, lld-link | UCRT + vcruntime (Microsoft) | MS SDK via xwin / cargo-xwin, or the user's own Visual Studio. Opt-in, see Licences | native Windows, Wine on Linux |
| x86_64 / aarch64 `-w64-mingw32` | llvm-mingw 20261020 clang, lld | UCRT (mingw-w64-crt) | mingw-w64 (open) | native Windows, Wine on Linux |
| x86_64 / aarch64 `-unknown-linux-gnu` | clang, lld | glibc | Arch glibc sysroot | native Linux, qemu-user (aarch64) |
| x86_64 / aarch64 `-unknown-linux-musl` | clang, lld | musl | Arch / Alpine musl | native, qemu-user |
| `x86_64-unknown-bunos-gnu` | clang, lld (clang triple `x86_64-unknown-linux-gnu`) | glibc, Bun OS (Arch based) | bunos sysroot | native on Bun OS |
| `i686-reactos`, `x86_64-reactos` | llvm-mingw clang with `-lmsvcrt-os` | msvcrt (ReactOS CRT derives from Wine msvcrt) | ReactOS PSDK / NDK, Wine headers | Wine, or a ReactOS VM |

Tools (all pinned with sha256 in `c-env.json`): clang/lld/llvm-* 23.1.4, llvm-mingw 20261020, cmake 4.4.5, ninja 1.13.2,
sccache 0.19.0; meson, make, pkgconf from the distribution; debug: lldb, llvm-symbolizer, winedbg. gcc and
mingw-w64-gcc are optional and only used by the benchmark.

Wine and Proton are providers inside Bun OS, not a second system: one meta-package `bunos-compat` (wine-cachyos, proton-cachyos,
dxvk, vkd3d-proton) owns them. For C they supply the LGPL header set (`include/`, 1108 paths in the 11.0 tree) and the tools
`winegcc`, `winebuild`, `widl`, `wrc`.

## Packaging

* `factory/c/PKGBUILD`: Arch split package `bunos-c` (open toolchain) and `bunos-c-windows-sysroot` (xwin splat built on
  the installing machine; it refuses to build unless the installer exports `BUNOS_C_ACCEPT_MS_LICENSE=1`).
* `factory/c/windows/bundle.json` + `bundle.ts`: Windows portable bundle (clang, llvm-mingw, cmake, ninja, sccache), every
  asset verified against its sha256, unpacked under one directory, no PATH or registry change. Dry run by default.
* `.github/workflows/bunos-c.yml`: ubuntu (Linux ELF, mingw PE under Wine, ReactOS-flavoured PE, qemu aarch64, gcc/clang
  benchmark), alpine (musl), windows (MSVC ABI with the runner's Visual Studio, llvm-mingw, benchmark); artifacts uploaded.

## Exploration (from source, shallow clones under `C:\Users\aphro\src\ref`)

* cargo-xwin 0.23.1 (`6aa7da9`, 2026-10-25), fork `aphrody-labs/cargo-xwin`, identical to upstream at fork time.
  * Two backends, chosen by `--cross-compiler` / `XWIN_CROSS_COMPILER` (`src/options.rs`): `clang-cl` (default, xwin crate 0.10.0
    downloads the MSVC CRT and Windows SDK manifest from Microsoft: `src/compiler/clang_cl.rs`) and `clang` using the
    third-party prebuilt `trcrsired/windows-msvc-sysroot` tarball (`src/compiler/clang.rs`, `XWIN_MSVC_SYSROOT_DOWNLOAD_URL` override).
  * clang-cl backend injects `CL_FLAGS`, `CFLAGS_<t>`, `CXXFLAGS_<t>`, `LIB`, `-C linker-flavor=lld-link`, a CMake toolchain
    file (`<cache>/<target>-toolchain.cmake` with `CMAKE_C_COMPILER clang-cl`, `CMAKE_LINKER lld-link`, `CMAKE_AR llvm-lib`), and
    symlinks `clang-cl`, `lld-link` (rust-lld), `llvm-lib`, `llvm-dlltool` into the cache (`compiler/common.rs`).
  * Cache: `XWIN_CACHE_DIR` (default the user cache dir), `<cache>/xwin` for the clang-cl backend, `<cache>/windows-msvc-sysroot`
    with a `DONE` marker for the clang backend. Options: `XWIN_ARCH` (x86, x86_64, aarch, aarch64; default x86_64+aarch64), `XWIN_VARIANT`, `XWIN_VERSION`
    (default 17), `XWIN_SDK_VERSION`, `XWIN_CRT_VERSION`, `XWIN_INCLUDE_ATL`, `XWIN_HTTP_RETRIES` (default 3).
  * Case folding: the splat layout uses symlinks except on macOS (`enable_symlinks: !cfg!(target_os = "macos")`), and the generated CMake
    toolchain clears `CMAKE_C_STANDARD_LIBRARIES` rather than adding case-correcting symlinks.
  * Licence: there is no acceptance flag in cargo-xwin; consent is implied by use (README: "By using this software you are
    consented to accept the licence" at the Microsoft link). The xwin binary itself does require `--accept-license`.
    Bun OS wraps this behind an explicit opt-in (below).
* wine-cachyos: the fork's default branch `proton_9.0` is Wine 9.0 at `f80ddae` (2024-06-17), identical to CachyOS. The current
  CachyOS patchset lives in branches `cachyos_11.0_<date>/main`; latest `cachyos_11.0_20261014/main` at `cd14106` (2026-10-20,
  Wine 11.0), now also a branch of the fork. The delta is expressed as merged feature branches (`cachyos_11.0_release/_staging`, `_dualsense`,
  `_em_upstream_pipewire`, ...), not a patch directory. Present in the tree: `dlls/ntdll/unix/fsync.c`, `server/fsync.c`, `ntsync_tmp.h` (ntsync
  staging), `dlls/winewayland.drv`, `dlls/wow64`, `wow64cpu`, `wow64win`, `tools/{winegcc,winebuild,widl,wrc}`, 676 headers under `include/`
  (LGPL-2.1+, `COPYING.LIB`). A diff against wine-mirror/wine is not available through the GitHub API (separate repository networks): unverified.
* proton-cachyos (`cachyos_main`, fast-forwarded to `55e9191` on 2026-10-29): the repository contains `BUILDING.md`, docs and the
  changelog (Proton 11.0-20261015); sources are pulled as submodules (Wine, DXVK, vkd3d-proton) at build time. Latest upstream releases read:
  DXVK v3.1.1 (2026-09-15), vkd3d-proton v3.1 (2026-10-28).
* ReactOS (`e46f4bb`, 2026-10-25, release feed 0.4.16-release): `sdk/include/{psdk,ddk,ndk,wine,ucrt,vcruntime,crt,c++,reactos,dxsdk,...}`;
  `psdk` is the MinGW w32api lineage whose README grants a permissive licence, `sdk/include/wine` carries Wine's LGPL headers, ndk/reactos
  parts are GPL/LGPL: check each file header. `sdk/lib/crt` is built from Wine's msvcrt implementation (`sdk/lib/crt/README.txt`).
  `toolchain-clang.cmake` targets `<arch>-w64-mingw32`, so llvm-mingw's triple is the right cross compiler; `sdk/cmake/` (gcc.cmake, msvc.cmake,
  host-tools.cmake), `boot/freeldr`, RosBE as the supported build environment. `media/doc/WINESYNC.txt` lists the code shared with Wine.

## Decision table

| Need | Decision | Why |
| --- | --- | --- |
| clang/lld/llvm-* toolchain | adopt (LLVM 23.1.x) | single compiler for every row |
| Windows-gnu cross | adopt llvm-mingw | open headers and CRT, native Windows and Linux binaries, ARM64 included |
| MSVC ABI cross from Linux | extend: xwin via `buncc c sysroot`, cargo-xwin fork for Rust | only Microsoft's SDK provides the MSVC ABI; opt-in gated |
| Open Windows headers | adopt mingw-w64, Wine `include/`, ReactOS PSDK | licence-clean alternatives to the MS SDK |
| Linux glibc / musl sysroots | adopt Arch packages | same base as Bun OS |
| Catalog, doctor, smoke matrix | write (`buncc c`) | data + one small tool, nothing existing covers all targets |
| Windows PE runner on Linux | adopt Wine (wine-cachyos inside `bunos-compat`) | CI installs Wine on the runner only |
| ReactOS target | extend: msvcrt-linked mingw PE now; real ReactOS build through its CMake/RosBE later | unverified |
| gcc | optional | benchmark comparison only |

## Licences

* LLVM: Apache-2.0 with LLVM exception. llvm-mingw: mixed, see `LICENSE.TXT` of the archive. mingw-w64 headers: ZPL-2.1 / public domain.
* Wine and wine-cachyos: LGPL-2.1+ (headers and tools such as widl are reusable for linking; library changes stay LGPL). GPL parts of the
  ReactOS tree (kernel, drivers) do not touch compiled user programs, only code copied from there.
* ReactOS: GPL-2.0+ overall, with per-directory exceptions; PSDK headers are permissive MinGW-lineage; verify before copying headers.
* Microsoft MSVC CRT / Windows SDK (xwin, cargo-xwin): licensed by Microsoft, not redistributable here. `buncc c sysroot <msvc triple>` runs `xwin --accept-license splat`: the owner accepted all licences in chat on 2026-10-29 (opt out with `--decline-ms-license` or `BUNOS_C_ACCEPT_MS_LICENSE=0`). The workflow still does not download
  the SDK unless a job asks for it.
  Binaries produced with a Microsoft-licensed sysroot are governed by those terms for the redistributable parts.

## Measured (Windows 11 workstation, x86_64, shared with other running builds, so noisy)

Same generated project (`factory/c/bench/bench.ts`: 120 files of 40 functions plus `main.c`, `-O2`, serial, 3 cold runs, compile + link, median):

| Compiler | Median | Best | Executable |
| --- | --- | --- | --- |
| MSVC `cl` 19.51 | 22.99 s | 20.75 s | 258,048 B |
| clang-cl 23.1.4 (local Visual Studio SDK, not xwin) | 24.58 s | 24.50 s | 166,912 B |
| llvm-mingw clang 23.1.4 (ucrt, x86_64) | 66.02 s | 46.75 s | 1,965,056 B (unstripped) |
| gcc / mingw-w64 | not measured on this host (no gcc); the CI job prints it on ubuntu |  |  |

llvm-mingw was much slower and very noisy (min 46.7 s vs median 66.0 s) while other builds ran on the machine; the cause was not isolated, so do not read it as a
compiler speed ranking. Smoke runs on the workstation: x86_64-pc-windows-msvc, x86_64-w64-mingw32 and i686-reactos binaries built and executed
(`bunos-c hello` printed), aarch64-w64-mingw32 built and header-checked only.

## Measured in CI (run 40826191891, GitHub-hosted runners, same project, 3 runs, median)

| Runner | Compiler | Median | Executable |
| --- | --- | --- | --- |
| windows-latest | MSVC `cl` 19.51 | 37.15 s | 258,048 B |
| windows-latest | clang-cl 23.1.4 (runner Visual Studio SDK) | 33.49 s | 166,912 B |
| windows-latest | llvm-mingw clang 23.1.4 | 24.19 s | 1,965,056 B |
| windows-latest | mingw-w64 gcc | 56.56 s | 1,968,115 B |
| ubuntu-latest | llvm-mingw clang 23.1.4 | 21.48 s | not recorded |
| ubuntu-latest | mingw-w64 gcc | 45.37 s | not recorded |
| ubuntu-latest | clang (glibc) | 35.29 s | 1,978,048 B |
| ubuntu-latest | gcc (glibc) | 40.14 s | 1,937,088 B |

Sizes of the mingw rows on ubuntu are 0 in the log because the benchmark looked for `bench` while the linker wrote `bench.exe`. The sizes of PE files are unstripped
for mingw. The workstation ranking of llvm-mingw above (slowest) was therefore load noise: on clean runners it is the fastest of the Windows rows.

CI smoke matrix (same run): ubuntu built and ran x86_64 and aarch64 glibc (qemu), built and ran the mingw and ReactOS-flavoured PE through Wine (i686 and x86_64), musl built and ran on
alpine; windows built and ran the msvc-ABI, mingw and ReactOS-flavoured binaries. Skipped on purpose: msvc targets on Linux (no Microsoft opt-in), bunos (no sysroot), musl via `buncc` (covered by the alpine job).

## Verified and not verified

Verified here: catalog loads; `buncc c test` builds x86_64-pc-windows-msvc (local VS), x86_64/aarch64-w64-mingw32, i686/x86_64-reactos (imports `msvcrt.dll`),
parses PE headers and runs the x64/i686 ones natively; `components.json` checks pass; llvm-mingw archive sha256 matched GitHub's digest.

Not verified: the bunos target (needs the Bun OS sysroot); aarch64 musl; aarch64 MSVC and mingw execution; xwin sysroot
build (no Microsoft opt-in given); ReactOS runtime execution; a diff of wine-cachyos against wine-mirror; ReactOS built through RosBE.
