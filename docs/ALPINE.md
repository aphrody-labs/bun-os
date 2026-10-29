# Bun OS Alpine line (work in progress)

Alpine 3.24.2 plus an overlay APK repository (`factory/alpine/aports/bunos`), images per capability
(`factory/alpine/images`), a compose suite (`factory/alpine/compose.yaml`, `factory/alpine/tests`) and the
`bunos run <file>` dispatcher (`packages/bunos-run`). Status: WIP branch `claude/wip-alpine`, not merged.

## Decision: overlay, not an aports fork
`alpinelinux/aports` on GitHub is a read-only mirror (608 MB); canonical is gitlab.alpinelinux.org/alpine/aports.
Alpine 3.24 already ships the Rust userland (uutils owns /bin/cat, sudo-rs owns /usr/bin/sudo, nushell, ripgrep, fd,
eza, bat, zoxide, starship, rust, cargo, wasmtime, wasm-tools, binaryen, wasi-sdk, wine 11, dotnet10-sdk, android-tools,
alien, dpkg). Only Bun (no musl package in Alpine) is missing, so the delta is APKBUILDs: `bun` (npm musl binary,
sha512-pinned, canary 1.4.4-canary.20261028.1) and meta packages `bunos-*`. The repo is signed by an ephemeral abuild
key generated in the build (never committed).

## Measured on the VPS (docker 29, compose 2.40, x86_64), 2026-10-29
Passing: base (uutils, sudo-rs, nushell, rg, fd, eza, bat, zoxide, starship, Bun revision 11c3671, Bun.serve, `apk add`
from the signed repo over HTTP), rust (cargo build/run, wasm32-wasip1 build), wasm (wasmtime, wasm-tools, wasm-opt,
`bunos run` through wasmtime and through Bun node:wasi), dotnet 10 (managed assembly through `bunos run`),
Wine (mingw hello.exe 7.2 s first run, 7-Zip x64 round trip, Python 3.14 embeddable, Notepad window under Xvfb).
Image sizes: base 304 MB, wasm 923 MB, dotnet 1.19 GB, wine 1.61 GB, rust 1.65 GB.

Measured limits: Alpine wine has no 32-bit (i386 unix side) support, so 32-bit PE (7zr.exe) is refused by the
dispatcher with exit 3. Android: `adb` and APK detection work; running an APK needs redroid and the host kernel module
binder_linux. The VPS kernel (7.3.0-9) has binder as a module, not loaded, and there is no sudo, so redroid is NOT
tested here; CI job `android` loads the module on the runner. In the container2wasm guest (Bochs plus Linux 6.1) no
Android runtime is possible without binder in the guest kernel config.

Not yet done: container2wasm conversion of `bunos/base` and its boot test (`packages/wasmos/test/bunos.test.ts`
is written, never run), the CI run of `.github/workflows/alpine.yml`, the `.deb` route re-test after adding dpkg to
bunos-base, components.json / `just map` registration.
