# WASM OS

Decision of 2026-10-29: Bun OS does not boot hardware. It is a WASM OS, in three senses that share one runtime
(unmodified upstream Bun canary, `1.4.4-canary.20261028.1`) and one browser target.

| Sense | What it is                                                                                                     | Status in this repository                                           |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A     | Machine-in-wasm: an x86_64 emulator compiled to wasm boots a disk image with Linux (Wine and ReactOS later)    | Alpine boots under Bun and is built in CI (this document, measured) |
| B     | Kernel and userland compiled to wasm / WASI                                                                    | Userland yes (`@aphrody/wasm`, `crates/aphrody-*-wasm`); kernel no  |
| C     | wasm / WASI applications with Bun as the kernel (syscalls = Bun APIs)                                          | Works for WASI command modules on `node:wasi`; no syscall ABI layer |

Code: `packages/wasmos` (runner, compositor host, tests), `packages/wasmos/compositor` (Rust crate, wasm32),
`factory/wasmos` (pins, Alpine build), `.github/workflows/wasmos.yml`. Recipes: `just wasmos-compositor`,
`just wasmos-alpine`, `just wasmos-boot`.

## Measured results (2026-10-29)

Build and boot on the VPS (12 cores, `nice`, Docker 29.7.2 buildx 0.36.1), Bun `1.4.4-canary` revision
`11c367163` (the pinned canary), no Bun modification.

| Fact                                                                 | Value                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Artifact `alpine:3.24.2` x86_64 through container2wasm v0.8.4        | 109,946,972 bytes (105 MiB), 41,215,646 bytes gzipped                                          |
| sha256 of that build                                                 | `50f844ac0943772941786193e5b3fae3d4c9f4fc9bdb0d1fb72cbccbeef449f8` (not reproducible: embeds a kernel build date) |
| c2w build time (cold Docker cache)                                   | 668 s                                                                                          |
| Boot to a finished `sh -c "dmesg \| head -3; uname -a; apk --version"` under Bun | 3.67 s and 3.70 s (two runs, wall clock including the Bun child process start)    |
| Serial log                                                           | `Linux version 6.1.0 ... #1 PREEMPT_DYNAMIC Thu Oct 29 05:19:13 UTC 2026`, `Linux localhost 6.1.0 ... x86_64 Linux`, `apk-tools 3.0.8-r0, compiled for x86_64.`, `3.24.2` |

The 3.7 s is short because container2wasm pre-boots the kernel at build time with wizer (README, "Packaging"), so
the module starts from a memory snapshot of an already booted guest. It is not a cold boot of Linux on Bochs.

Browser boot (Chromium, `@bjorn3/browser_wasi_shim`): see the CI section for the recorded result; a boot is claimed
only where a serial log exists.

## Facts from source (clones under `C:\Users\aphro\src\ref`)

1. container2wasm `3f0f9be4d5e` (2026-06-09), release v0.8.4 (2026-03-16): converts an OCI image to one wasm file.
   Emulators: Bochs for x86_64, TinyEMU for riscv64, QEMU for `--to-js` (Emscripten). `container2wasm/README.md`.
2. The x86_64 guest kernel is Linux **6.1** (`Dockerfile`: `git clone -b v6.1 torvalds/linux`), configured by
   `config/bochs/linux_x86_config` with `CONFIG_SMP` unset: single CPU, no 7.x kernel is produced by c2w.
3. Bochs runs with `cpu: ips=40000000, model=corei7_haswell_4770` and `display_library: nogui`
   (`config/bochs/bochsrc.template`): a headless, serial-console (`console=hvc0`) machine, no framebuffer device.
4. Build pins (Dockerfile): Bochs fork `ktock/Bochs@a88d1f687ec8`, TinyEMU `e4e9bd198f9c`, qemu-wasm
   `8604ed49a3cd`, wasi-sdk 19, binaryen 114, wizer `04e49c98`, emsdk 3.1.40/4.0.10.
5. **Upstream bit-rot found by building it:** the embedded Dockerfile uses `rust:1.74.1-bullseye`; Debian 11 security
   packages return 404, so `apt-get` fails in the tinyemu/bochs tool stages. It also clones
   `ktock/container2wasm@v0.8.4`, a tag that does not exist there (the project moved to `container2wasm/container2wasm`).
   `factory/wasmos/pins.json` records both patches, `build-alpine.ts` applies them and fails if they stop applying.
6. WASI imports of the Alpine module include `poll_oneoff`, `sock_accept`, `sock_recv`, `sock_send`
   (all other `fd_*` and `path_*` calls are standard preview1).
7. **Bun `node:wasi` gaps (1.4.4):** (a) no `sock_accept` import, instantiation fails with `LinkError` -> stub returning
   ENOSYS (52), networking unused; (b) `poll_oneoff` reports every `fd_read` subscription ready, so the emulator then
   blocks forever in `read(0)` on an idle stdin, and with stdin at EOF it exits at once with code 1 and no output ->
   `packages/wasmos/src/poll.ts` is a clock-honouring `poll_oneoff` (Atomics.wait) that never reports stdin ready.
   `bun x.wasm` itself runs WASI command modules (checked with a Rust `wasm32-wasip1` hello; exit code and argv pass
   through), but cannot boot c2w images without the two fixes above.
8. copy/v86 `cc37f35c43b` (2026-10-18): x86 **32-bit** JIT to wasm; README states "64-bit kernels are not supported".
   Linux (32-bit), Alpine, Arch32, ReactOS, Windows 9x/NT, Haiku, KolibriOS work. Rust core in `src/rust/`
   (`jit.rs`, `codegen.rs`). This repository already stages it for the browser: `apps/webos/vm.ts`,
   `apps/webos/vm.lock.json` (v86 0.5.471, SeaBIOS, `alpine-virt-3.24.2-x86.iso`).
9. v86 is much faster than Bochs-in-wasm for 32-bit guests because it JIT-compiles guest basic blocks to wasm; Bochs
   interprets. Neither runs a 64-bit Linux 7.3 with a JIT: that is the gap (see table).
10. Wine/ReactOS in 32-bit x86 fit v86 (ReactOS is listed as working); Wine needs an x86_64 or i386 Linux userland, so
    on c2w it runs interpreted (Haswell model, ips 40M) — functional, slow.
11. Linux 7.3 was released on 2026-10-18 (one report, OSTechnix; not checked on kernel.org). A 7.3 guest needs our own
    kernel build and config (`CONFIG_X86_64`, virtio, no SMP, 9p) packed with the c2w `--assets`/Dockerfile route; it is
    not produced by any upstream tool today.
12. Vulkan to WebGPU: nothing production-grade exists. The Mesa Venus driver serializes Vulkan to a *host*
    virglrenderer (docs.mesa3d.org/drivers/venus) and needs a native host GPU stack, not a browser. wgpu and Dawn go
    the other way (WebGPU API on top of Vulkan/Metal/D3D12). Naga translates shaders (SPIR-V/WGSL/GLSL) but not an API.
    A guest-GL path to a browser has to be written (virtio-gpu 2D/3D command stream in JS/Rust -> WebGPU), see table.
13. `aphrody-labs/bun-ui` (pushed 2026-10-25) is a Material 3 token/theme/component stack with adapters for egui, iced,
    bevy, GTK, Qt and `aphrody-m3-wasm`; it has no compositor and no wasm display surface. The compositor here takes
    its colours from M3 baseline tokens only; a bun-ui window decorator is a later step.
14. Existing in-repo wasm pieces: `packages/wasm` (`@aphrody/wasm`: build/optimize/run on `node:wasi`),
    `packages/webos-wasm` + `crates/aphrody-webos-wasm` (OPFS file system, shell, terminal), `apps/webos`. The fork-era
    Alpine images (`scripts/aphrody/alpine/` in tag `final-fork-2026-10-29`) are native/WSL root file systems, not wasm.
15. Headless Chromium on the VPS (Google Chrome 155) and on Windows exposes **no WebGPU adapter** with
    `--enable-unsafe-webgpu --use-angle=swiftshader`; the compositor test therefore asserts the canvas 2D path and
    only asserts the WebGPU readback when an adapter exists.

## Architecture and decision table

| Component                              | Decision  | Why                                                                                                                                       |
| -------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| container2wasm (Bochs/TinyEMU) as the Alpine/Linux runner (A)  | **Adopt, pinned, patched** | Works today under Bun after two host shims; one file, WASI, no JS glue. Linux 6.1 only, no framebuffer.        |
| copy/v86 for 32-bit guests and ReactOS (A) | **Adopt**   | Already staged in `apps/webos`; JIT speed; keyboard/VGA/network devices; fits ReactOS.                                                  |
| x86_64 Linux 7.3 guest with a JIT (A)  | **Write / extend** | No wasm JIT for x86_64 exists. Options: extend v86 to x86_64 (large), or custom kernel on Bochs (cheap, slow), or riscv64 Linux 7.3 on TinyEMU/own emulator (cheap, different ISA). |
| QEMU-wasm (Emscripten TCG)             | **Evaluate** | c2w `--to-js` path; TCG JIT in the browser; needs SharedArrayBuffer/COOP-COEP; not WASI so not runnable by Bun.                          |
| Bun WASI host fixes (`poll.ts`, stubs) | **Write (done)** | Minimal, in userland; upstream issues should be filed for `sock_accept` and `poll_oneoff` readiness.                                |
| Browser WASI host                      | **Adopt `@bjorn3/browser_wasi_shim` + own `poll_oneoff`** | c2w ships a patched copy with xterm-pty; we use the npm shim 0.4.2 and our poll.                         |
| Wayland compositor (full wasm)         | **Write (Rust, done as subset)** | See below: weston/smithay do not build for wasm32 without porting libwayland, epoll, unix sockets, DRM/GBM.                            |
| Vulkan/GL to WebGPU for guests         | **Write** | virtio-gpu command decoder in Rust/JS to WebGPU; reuse Naga for shaders; no upstream.                                                    |
| Wine / ReactOS fused into the kernel   | Other agent | Out of scope here.                                                                                                                       |
| (B) kernel to wasm                     | **Research** | Linux has no wasm target; options are a Rust microkernel to wasm32 (exists as userland crates only) or the emulator route (A).         |
| (C) Bun as kernel for WASI apps        | **Extend** | `node:wasi` + Bun APIs is the syscall layer; missing sockets, `poll_oneoff`, threads (wasi-threads) block real daemons.                 |

### Compositor choice

Evidence for the fallback: Weston and Smithay need `libwayland`/`wayland-backend` over Unix sockets, `epoll`/`calloop`,
and a DRM/GBM/EGL or pixman backend; `wasm32-unknown-unknown` has none of these and `wasm32-wasip1` has no Unix
domain sockets or epoll. Weston's headless backend (clones at `C:\Users\aphro\src\ref\weston-*`) still links
libwayland-server, whose `wl_event_loop` is epoll-based (not verified in this lot). A port is a project of its own; it is not feasible in one lot.

What was built instead (`packages/wasmos/compositor`, 60 KB wasm, no dependencies): a software compositor that speaks
the Wayland **wire format** for `wl_display`, `wl_registry`, `wl_compositor`, `wl_shm` (+ pool, buffer),
`wl_surface` (attach, frame, commit), `xdg_wm_base`, `xdg_surface`, `xdg_toplevel`, with window stacking, borders and
title bars, composed into an RGBA framebuffer. Differences from real Wayland: no fd passing (pool memory is written
through `pool_ptr`), no input events, no damage tracking, ARGB/XRGB8888 only. Transport is a function call in the same
process; a WebSocket/virtio carrier is the next step.

Tests (`packages/wasmos/test`):

- `compositor.test.ts` (Bun): a protocol client creates two toplevels, checks configure/release/frame events, then
  asserts exact pixels (background, title bar, border, content, overlap order, red/blue pixel counts) and robustness to
  malformed messages.
- `browser.test.ts` (headless Chromium via playwright-core): the same wasm and client run in the page, the frame is put
  on a canvas and read back with `getImageData`; when `navigator.gpu` has an adapter the frame is also uploaded to a
  `rgba8unorm` texture and read back bit-identical.

## Feasibility and performance expectations

| Goal                                         | Feasible now                            | Expectation                                                                                         |
| -------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Alpine x86_64 console in Bun/browser         | Yes (measured)                          | ~3.7 s to a command result from the pre-booted snapshot; interpreter speed afterwards (ips 40M model) |
| Alpine with the 105 MiB image in a browser   | Yes, size is the cost                   | 41 MB gzipped download; instantiate time in Chromium: see CI receipt                                |
| Linux 7.3 kernel                             | Needs our kernel build                  | Bochs path: x86_64 config in `config/bochs/linux_x86_config` rebased to 7.3; boot with real kernel init would be tens of seconds to minutes (no snapshot trick unless we rerun wizer) |
| Graphical Alpine (X/Wayland in the guest)    | Not with c2w                            | Bochs has no display in this build; would need v86-style VGA or virtio-gpu; 32-bit only on v86     |
| Full-wasm compositor                         | Subset done; real Wayland needs a port  | Software blit at 640x400 is trivial; 1080p software compositing in wasm is estimated at a few ms per window (not measured) |
| Wine/ReactOS                                 | ReactOS on v86 (32-bit); Wine on Bochs  | ReactOS boot minutes in the browser; Wine on interpreted x86_64 is slow                            |
| Vulkan from the guest                        | No                                      | Needs the virtio-gpu to WebGPU translator written                                                    |

## Unverified

- Browser (Chromium) boot of the Alpine wasm: the test is written; result in the CI receipt only.
- Run time on Windows (this workstation) was not measured: the Alpine build runs on Linux only.
- WebGPU readback of the framebuffer: no adapter in headless Chrome here.
- Linux 7.3 release date comes from a single secondary source.
- Reproducibility of the wasm: the sha256 differs per build (kernel build timestamp).
