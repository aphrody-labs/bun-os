> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

<!-- SPDX-License-Identifier: Apache-2.0 -->

# GPU hub, Aphrody OS image and WASM target

Cloud session of 2026-10-07, merged for local completion. Owner directives of the session:
native NVIDIA driver + CUDA + wgpu shared by Bun, Tauri and Obscura in one process; a GNU-free
Rust/Bun userland as a container; COSMIC Epoch as the native desktop; absorb container2wasm and
v86 so the final image is as WASM as possible; exploit Bun-in-Rust and `bun:ffi` to the maximum.

## Delivered (source + tested behaviour)

| Piece                                                                                                                                                       | Where                                                                                                    | Evidence (2026-10-07, cloud host, 2 CPU, no GPU, Mesa llvmpipe/lavapipe)                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Process-wide GPU hub: one wgpu 30 device (NVIDIA discrete first), adapter report, WGSL compute jobs, error scopes, no panics                                | `crates/native/gpu-backend` feature `hub` (`src/hub.rs`)                                                 | `cargo test -p aphrody-gpu-backend --features cuda`: 6 passed incl. 8-thread concurrency; clippy `-D warnings` clean (default and `cuda`) |
| CUDA through the official driver: `cudarc 0.19.10` (`driver`, `nvrtc`, `dynamic-loading`, `cuda-12080`), presence probes before any call, NVRTC CUDA C jobs | same crate, feature `cuda` (`src/cuda.rs`, `src/cuda_report.rs`)                                         | Builds without the toolkit; on this host reports `driverLoaded:false` and fails jobs cleanly. **Not run on an NVIDIA GPU yet.**           |
| C ABI 1.5: `yolo_gpu_call_start` (`gpu.info`, `gpu.wgsl`, `gpu.cuda`), bounded workers, cancellable before start                                            | `crates/engine/yolo-runtime` features `gpu`/`cuda` (`src/gpu.rs`, header)                                | `cargo test -p yolo-runtime` with no features / `gpu` / `cuda`: 33 / 36 / 36 passed                                                       |
| cdylib export                                                                                                                                               | `crates/interop/ffi` features `gpu` (now also `yolo-runtime/gpu`) and `cuda`                             | `cargo check -p aphrody-ffi --features cuda` started, **not completed** (interrupted); run it first                                       |
| Bun SDK: `GpuRuntime` (`info`, `wgsl`, `cuda`) on `bun:ffi`                                                                                                 | `packages/engine/runtime/src/gpu.ts`, export `./gpu`, `test/gpu.test.ts`                                 | `tsc --noEmit` clean, oxlint/oxfmt clean; tests skip without `YOLO_RUNTIME_LIB` (no GPU artifact built here)                              |
| Aphrody OS container: Alpine 3.24, uutils/sudo-rs/eza/Nushell+Starship/Ion/ripgrep/fd/bottom/Helix/Yazi/Zellij, Bun 1.4.2, `agent` yolo account             | `tools/config/container/aphrody-os/Dockerfile` (default target)                                          | `aphrody-selftest`: 25/25, image 284 MB                                                                                                   |
| COSMIC Epoch 1.0.15 desktop target, bash-free Bun launcher                                                                                                  | same Dockerfile `--target desktop`, `desktop/usr/local/bin/aphrody-desktop`                              | Nested session rendered headless (weston pixman + grim, `desktop-test/`): panel, applets, dock                                            |
| Bootable VM variant: Linux 7.2.9 `LLVM=1` + Rust, Bun as init, Rust PID 1 shim                                                                              | Replaced by the external Bun fork: [initramfs generator](https://github.com/aphrody-labs/bun/blob/main/scripts/aphrody/initramfs.ts) (`--bin`, ELF `DT_NEEDED` resolution) and [Bun init](https://github.com/aphrody-labs/bun/blob/main/scripts/aphrody/initramfs-init.ts); the `vm/` tree and the `aphrody_runtime` kernel patch were removed | Superseded; the earlier QEMU boot (9/11 checks) used the removed tree |

## Single process, today

Bun loads `libaphrody_ffi` (one cdylib). In it live the `yolo_*` runtime, the Obscura browser
(`yolo_browser_*`, feature `browser`, V8 owner thread per context) and the GPU hub
(`yolo_gpu_*`). Hub and Obscura share the process, so any Rust host linked into it, including a
Tauri plugin, gets the same `aphrody_gpu_backend::hub::wgpu_context()`. CEF keeps its own
GPU process for page WebGPU: that is Chromium's design, not something the hub can merge.

## Next (in order)

1. **Run on NVIDIA**: `cargo build -p aphrody-ffi --profile runtime --features cuda`, then
   `YOLO_RUNTIME_LIB=target/runtime/libaphrody_ffi.so bun test packages/engine/runtime/test/gpu.test.ts`
   on a host with the official driver (`nvidia-smi`). Record adapter, driver and CUDA versions in MEMORY.
2. **Tauri plugin and Obscura `navigator.gpu`**: tracked in the [desktop and web plan](../desktop-web/PLAN.md) (open items 8 and 9).
3. **JSC instead of V8** (fusion plan §11.3): the `JsEngine` seam is still to be written; Bun-in-Rust
   (`bun.com/blog/bun-in-rust`) and `bun:ffi` (`JSCallback`, `linkSymbols`, `cc`) are the binding path.
4. **NVIDIA in containers**: NVIDIA's userspace (libcuda, EGL/GBM, Vulkan ICD) is glibc-only, so the
   Alpine image cannot load it. Add a glibc variant (`nvidia/cuda` Ubuntu base, `--gpus all`,
   `NVIDIA_DRIVER_CAPABILITIES=all`); COSMIC on DRM/KMS (`--device /dev/dri`, seatd) belongs there.
5. **WASM image**: absorb `container2wasm` (OCI → WASM with an emulated CPU) and `v86` (x86 emulator,
   Rust core in `src/rust`, JIT to WASM) under one owner with provenance; the GitHub forks under
   `aphrody-labs` must be created by the owner (the session token was rejected). An emulated image has
   no GPU driver: WebGPU there comes from the host browser, CUDA never.
6. COSMIC polish: `LANG=en_US.UTF-8` in the desktop target (i18n rejects `C.UTF-8`), dock icon theme.

## Limits stated

Nothing here ran on an NVIDIA GPU. CUDA paths are compiled and their absent-driver behaviour tested.
Desktop rendering is software only. The VM image was not re-booted after its last fix.
