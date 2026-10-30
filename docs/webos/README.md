<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bun OS Web OS (aphrody.com)

One site for the whole product: a desktop that runs in the browser. Owner: `apps/webos`
(the WebOS Bun service in `services/` plus a vanilla TypeScript shell, being replaced by a thin client
for the native Hyprland desktop; see [ARCHITECTURE.md](ARCHITECTURE.md)). Build and run it with `bunos webos <build|craft|serve|deploy>`.

## What runs where

| Piece | Implementation | Verified |
| --- | --- | --- |
| Window manager, ten workspaces, dwindle/scrolling/floating layouts, scratchpad, directional focus | `src/wm.ts`, `src/keys.ts`; keyboard model of the Omarchy manual (04-navigation), Alt plays Super | local browser, tiling and workspace switch |
| Files | Rust VFS (`aphrody-shell-vfs`) compiled to wasm, persisted in OPFS (`packages/webos-wasm`) | local browser |
| Terminal | Rust shell (`aphrody-shell-session`/`aphrody-shell-web`, Rio VT state) on the same VFS | typed `echo`, `cat`, `ls` |
| Browser | tabs; pages fetched by the service (`/api/browse`), scripts removed, sandboxed | production |
| Inspector | `aphrody-re` triage compiled to wasm | wired, not exercised in a browser |
| App Store / package manager | `src/pkg.ts`: registry, sha256-verified installs into Cache Storage, offline use through the service worker, update and removal | install, launch, cache |
| Games | Dust and melonDS builds from `packages/bun-engine/web-emulation`, packaged by `packages.ts` | GodMode9i homebrew booted in Dust |
| Craft apps | egui/eframe wasm builds of `apps/*-web` via `build-craft.ts` | PdfCraft opens in the browser |
| Alpine Linux | v86 (x86 JIT to wasm) booting Alpine 3.24.2 x86; ISO in R2, served with Range by the service | booted to login, `uname -a` |
| Calculator, Media, Disk Usage, Activity, Web Apps | `src/apps/*` | typecheck |
| Materials | `@aphrody/m3-tokens`, `@aphrody/m3-fonts`, `@aphrody/material-web` elements, file icons from `packages/assets` | local browser |

## Honest limits

* **Bun does not run in the browser.** The Engine app runs JavaScript in a worker; Bun's own APIs are not
  exposed. `bun_wasm` (semver, shell parse, markdown) and `src/quality` (fmt, lint) are the wasm candidates.
* **Alpine is 32-bit x86** (v86), so the 64-bit musl Bun binary cannot run in it. container2wasm
  (Bochs x86_64, TinyEMU riscv64) would give 64-bit guests but is experimental and slow.
* **Nushell** is native-only; its wasm build was a compile-level spike.
* **Steam** needs a local Steam install; `crates/bun-steam` has no browser path.
* `effectcraft-web` does not compile for wasm32: its Cargo manifest lost its browser dependencies in the import.

## Merged routes

The WebOS Bun service (`apps/webos/services/serve.ts`) serves `aphrody.com`. Old product
hosts (`app-*.aphrody.app`, `*craft.aphrody.app`, `aphrody.app`, `www`) answer with a 301 to the Web OS.
`/api/health`, `/api/catalog` (every app, package and crate), `/api/browse` and `/vm/alpine.iso` are native.

## Sources consulted (2026-10)

* [container2wasm](https://github.com/container2wasm/container2wasm): x86_64 (Bochs), riscv64 (TinyEMU), QEMU in the browser; experimental.
* [v86](https://github.com/copy/v86): x86 emulator with a wasm JIT, actively maintained; npm `v86`.
* [Alpine Linux 3.24](https://www.alpinelinux.org): current release; x86 virt ISO used here.
* [Bun FFI](https://bun.com/docs/runtime/ffi): marked experimental; Node-API is the stable path for native modules.
* [OS.js](https://github.com/os-js/OS.js) and [Puter](https://github.com/HeyPuter/puter): JavaScript web desktops; none is wasm-first.
* libcosmic has no web target; wgpu/winit run in the browser through eframe, which the Craft apps use.
* Rust build speed: sccache, mold (ELF only), cargo `--timings`; this repo needs sccache disabled for web-sys-heavy wasm builds on Windows (command line limit).
