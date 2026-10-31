# WebAssembly toolchain and runtimes

Owner order of 2026-10-30: the best WebAssembly repositories live in Bun OS as patched aphrody-labs forks, mounted
as pinned shallow submodules under `vendor/wasm/<name>` and built from source on the VPS. Registration:
`.gitmodules`, `vendor/sources.json`, `sources.lock.json`, `factory/bunos/components.json`; the inventory
(`crates/aphrody-inventory`) reads them from `.gitmodules`. Selection by GitHub stars, push activity on 2026-10-30
(`gh api repos/...`) and fit with the Bun OS stack.

## Mounted (28)

Runtimes: `wasmtime` (WASI 0.2/0.3, components; 51.0.0-dev), `wasmer` (WASIX), `wasmi` (interpreter), `wamr`
(bytecodealliance/wasm-micro-runtime: interpreter, fast JIT, AOT).

Toolchain: `wasm-tools`, `wit-bindgen`, `wasm-pack`, `wasm-bindgen`, `cargo-component`, `wac`, `jco`,
`componentize-js`, `binaryen`, `wabt`, `emsdk`, `wasi-sdk`, `wasi-libc`.

Browser layers: `v86`, `container2wasm` (container2wasm/container2wasm, the live home of ktock's project; the
WASM OS Alpine build in `factory/wasmos` still uses its v0.8.4 release binary), `pyodide`, `ruby-wasm`, `php-wasm`
(seanmorris), `ffmpeg-wasm`, `sqlite-wasm` (sqlite.org official), `duckdb-wasm`, `wasm-git`, `opencv`
(OpenCV.js via `platforms/js`), `onnxruntime` (onnxruntime-web: wasm SIMD/threads and WebGPU providers).

Bun OS patches: `jco` adds `JCO_NO_OPT=1`, which keeps release components unoptimised so the build needs no pnpm,
tsc or node. The other forks track upstream at their pin.

Not mounted: leaningtech CheerpX (proprietary), WordPress Playground (its php-wasm is covered by seanmorris/php-wasm,
13 GB repository), wizer (upstreamed into Wasmtime as `crates/wizer`).

## UI and graphics verdicts

- wgpu: already mounted (`vendor/wgpu`), the WebGPU layer of Bun Engine. Keep.
- Bevy: already mounted (`vendor/bevy`, `crates/bevy*`). Keep.
- egui: in use from crates.io (0.36.2, pdfcraft, with a vendored egui-wgpu patch). No submodule.
- Leptos: aphrody-labs fork exists, no consumer in the workspace. Not mounted.
- Dioxus, Makepad, Slint: duplicate the bun-ui / COSMIC (iced) UI layers; Slint adds a GPL/royalty licence split.
  Not mounted.

## Build (VPS only)

`scripts/aphrody/build/wasm/build-toolchain.sh [step...]` builds wasm-tools, wasmtime, wit-bindgen, wasm-pack,
wasm-bindgen, wac, cargo-component, wabt, binaryen and the plugin host into `~/build/toolchains/wasm/bin`, at most
four compiler jobs, `nice -n 15`, sccache. Sources come from the initialized submodule, otherwise from a shallow
fetch of the gitlink pin into `~/build/src/wasm`.

## Plugin host

`crates/aphrody-wasm-host`: runs WASI 0.2 command components (`wasi:cli/run`) in Wasmtime from the aphrody-labs
fork (same revision as `vendor/wasm/wasmtime`) with fuel, epoch timeout, memory ceiling and explicit directory
preopens; no inherited environment, sockets or ambient filesystem. Library (`Host::run`) and CLI
(`aphrody-wasm-host run [--fuel N] [--timeout-ms N] [--max-memory B] [--dir HOST::GUEST[:rw]] [--env K=V]
<component.wasm> [args...]`; exit 124 timeout, 125 out of fuel, 126 trap). Own Cargo root: the root lock carries
wasmtime 38 (yara-x).
