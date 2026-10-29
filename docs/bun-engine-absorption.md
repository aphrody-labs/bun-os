> **Legacy fork notice (2026-10-29).** This document describes an absorption done against the abandoned `aphrody-labs/bun` fork (`toolchains/bun`). The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# bun-engine absorption

Source: `aphrody-labs/bun-engine` `main` @ `6afa5a7` (541 tracked files, 53 gitlinks, none initialized upstream-side). Target: this workspace, branch `os`.
Out of scope per owner direction: `bun-engine-android`, Shenron, and the Android parts of bun-engine (`crates/android-native`, `packages/android-*`, `packages/java-*`, `web/android`, `tools/android`, `docs/android`).

## First-party content

| bun-engine | Disposition in bun-os |
| --- | --- |
| `crates/bun-engine-core` (pkg `bun-engine`) | `crates/bun-engine-core` (+ `include/bun_engine.h`, `CMakeLists.txt`, `CMakePresets.json`; stale `src/gpu/*` include paths repointed to `vendor/directx-headers`, `vendor/cuda-cccl`) |
| `crates/nds` (pkg `bun-engine-nds`) | `crates/bun-engine-nds` (+ .NET Tinke AOT project) |
| `crates/nds/dust-core`, `emu-utils`, `emu-utils-macros` | deduplicated: canonical owners `crates/aphrody-dust-core`, `aphrody-emu-utils`, `aphrody-emu-utils-macros`; `bun-engine-nds` uses the workspace dependency |
| `crates/aphrody-aarch64`, `-switch`, `-wii`, `-wii-image` (GPL) | `crates/<same>`; consumers (`aphrody-wii-debug`, `aphrody-wii-runtime`, `ruzu-video-core`, `iecode-web-wii-wasm`, root `[workspace.dependencies]`) repointed from the `bun-engine.git` rev pin to path dependencies |
| `packages/bun-engine` | `packages/bun-engine` (own `package.json`; `@typesafe-ai/sdk` -> `@aphrody/typesafe-sdk`; `test/`, `plugins/consoles`, `config/workspace.json`, `web/app`, `types/` moved inside) |
| `packages/bun-engine/src/core/replica` (skill pack, Replica/Ghidra/Magika commands, now `re replica`, `re ghidra-win`, `re magika`) | `packages/re/plugin/skills/replica-*` (one RE plugin with the rea, Steam and Ghidra skills; MIT notice in `packages/re/third_party/replica`) |
| `packages/docs-sync` | `packages/docs-sync` |
| `docs/*.md`, `replica/*`, `crates/{EMULATION,THIRD_PARTY}.md`, README, LICENSE | `docs/bun-engine/` (licenses and provenance kept) |
| root `Cargo.toml`, `package.json`, `tsconfig.json`, `Makefile`, `vcpkg.json`, `bun.lock`, `Cargo.lock` | dropped: bun-os root owns workspace/toolchain/lockfiles (nightly per `rust-toolchain.toml`, Bun 1.4.4); `vcpkg.json` had no dependencies |
| `crates/bun-runtime` (`aphrody-labs/bun`) | deduplicated: `toolchains/bun` is canonical; script paths now use `toolchains/bun/scripts/build/rust/cargo-serial.ts` |

## Imported upstream gitlinks

Same URL and pinned commit, as `vendor/<name>` provenance submodules. Already present in bun-os with identical pin (skipped): melonds, dust, bevy, wgpu, winit, linux-cachyos, kernel-patches, proton-cachyos, wine-cachyos, chwd, pkg-manage-util, open-gpu-kernel-modules (`nvidia-open`), libctru, ctru-rs, wiki (`docs/vendor/cachyos`), bun (`bun-runtime`). `repo-manage-util` is deduplicated to `vendor/cachyos-repo-manage-util`.

Added (35): ares, azahar, calico, citro2d, citro3d, cuda-cccl, cuda-samples, directx-compiler, directx-headers, directx-samples, dolphin, ghidra, gopher64, jgenesis, libnds, libogc, magika, mame, ntr-ghidra, omarchy-windows, open-agb-firm, retroarch, retroboy, rustboyadvance-ng, starpsx, steamcmd, steamcmd-api, steamos-nvidia-installer, tetanes, zakuro, cmake, llvm, make, qemu, vcpkg.

Licenses: GPL (aarch64, switch, wii, wii-image, nds), MIT/Apache (bun-engine core), upstream licenses stay inside each pinned tree.

## Fixes

- Removed broken `tsconfig` references to uninitialized `crates/bun-runtime` types; `bun check` is clean for the absorbed packages under the root tsconfig.
- Removed the `android:inspect` command (depended on the out-of-scope `android-pipeline`).
- Fixed stale `Bun.Build.Target`, `verbatimModuleSyntax` import, `web/app`/`config` asset roots, magika and cargo-serial paths, console manifest/reference validators (`vendor/` accepted).
- `bun fmt` applied; `bun lint` clean on the absorbed packages.

## Remaining

- `ghidra-decompiler` (Apache-2.0, koute upstream) is inlined as `crates/ghidra-decompiler` (workspace member).
- `aphrody-labs` Rust forks kept as vendor gitlinks (tetanes, retroboy, rustboyadvance-ng, gopher64, jgenesis, starpsx, zakuro, magika) until deliberate migration.
