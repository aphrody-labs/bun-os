# Web emulation build pipeline

Builds the emulators play.aphrody.app runs in the browser and publishes them in one fixed
layout. The site only integrates these artifacts; it does not build them.

| Path                                         | Role                                                                                                                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build.ts`                                   | Rust cores (`rust`), Qt cores through Docker (`qt`), index and firmware (`index`)                                                                                                                                                               |
| `qt/Containerfile`                           | Pinned Emscripten 5.0.5 + Qt 6.12.0 for WebAssembly (single- and multi-threaded kits) + third-party libraries                                                                                                                                   |
| `qt/build-melonds.sh`, `qt/patches/melonds/` | melonDS Qt 6 front end for WebAssembly                                                                                                                                                                                                          |
| `qt/build-azahar.sh`                         | Azahar (3DS) Qt 6 front end attempt; `build.ts qt azahar` records where it stops                                                                                                                                                                |
| `runtime/`                                   | Browser helpers shipped with the cores: `firmware.js` (open-source firmware fetch, OPFS/IndexedDB cache, local user files), `touch.js` (pointer to bottom-screen mapping), `melonds.js` (ES module wrapper of the Qt build with the common API) |
| `serve.ts`                                   | Local cross-origin-isolated server (COOP same-origin, COEP credentialless)                                                                                                                                                                      |
| `smoke.ts`, `smoke.html`                     | Headless Chrome smoke test per core over the DevTools protocol                                                                                                                                                                                  |
| `web-emulation.lock.json`                    | Every pinned input: toolchain, tool archives (sha256), image digests, Ubuntu snapshot, Qt, source commits, test content                                                                                                                         |

Builds run on the build host (the VPS, Linux x86_64), not on the workstation. `build.ts` picks
the pinned wasm-bindgen/Binaryen archive for the host (`linux-x64` or `win32-x64`), runs cargo
through `scripts/cargo.ts` (from a Visual Studio developer prompt on Windows), and waits for other Docker builds
before starting one.

```sh
bun packages/bun-engine/web-emulation/build.ts rust dust-nds zakuro-3ds   # Rust cores (Bevy facade)
docker build -f packages/bun-engine/web-emulation/qt/Containerfile -t bun-os/qt-wasm:6.12.0-emsdk5.0.5 packages/bun-engine/web-emulation/qt
bun packages/bun-engine/web-emulation/build.ts qt melonds                 # Qt cores in that image
bun packages/bun-engine/web-emulation/build.ts qt azahar                  # attempt; blockers in report.json
bun packages/bun-engine/web-emulation/smoke.ts dust-nds zakuro-3ds melonds
bun packages/bun-engine/web-emulation/serve.ts                            # http://localhost:8787/smoke/?core=...
```

## Artifact layout

```
dist/web-emulation/
  index.json                      qualified cores plus explicit pending reasons (served as /api/emulation)
  report.json                     build sizes and times per core and variant
  smoke.json                      last smoke results (frames, frame hash, timings, console errors)
  <core>/qualification.json       receipt binding runtime/core files, locked test content and browser result
  fixtures/<pack>/<file>          pinned open-source test ROMs included in qualified packages
  firmware/firmware.json          open-source firmware served with the cores (sha256, sha512, SRI, source order)
  firmware/<file>                 openbios.bin, normatt_gba_bios.bin
  runtime/{firmware,touch,melonds}.js
  <core>/manifest.json            the only mutable file of a core
  <core>/<hash>/bun_engine.js     wasm-bindgen --target web glue (Rust cores)
  <core>/<hash>/bun_engine_bg.wasm  wasm-opt -O3, stripped
  <core>/threads/<hash>/...       optional +atomics variant (`build.ts rust --threads`)
  melonds/<hash>/{index.js,melonDS.js,melonDS.wasm,qtloader.js,melonDS.html,build.json}
```

## Qualified installable packages

Run the browser smoke qualification on the VPS, then regenerate `build.ts index`
and build the superapp. WebOS discovers every built core and publishes only those
whose qualification receipt still matches the complete artifact set, runtime,
lock file and test content. A successful run requires at least 120 frames, a lit
frame, a frame hash and no browser errors. A build manifest alone is insufficient.
The receipt source revision identifies the qualification harness checkout.

Each installable emulator carries the receipt and its pinned open-source ROMs
and required free firmware, with hashes and provenance. GodMode9i and FBI are the
currently pinned source-licensed ROMs. Other cores remain pending until their WASM
build and source-licensed test content are qualified; freeware labels and empty
placeholder ROMs do not qualify. Existing upstream licenses and corresponding
source obligations remain applicable to each emulator and fixture.

`<hash>` is the first 12 hex digits of the wasm's SHA-256: every file under it can be served
with `Cache-Control: public, max-age=31536000, immutable`; `manifest.json` (which names the
current `<hash>/...` paths) must be `no-cache`. Older hash directories are removed when a core is
republished. `application/wasm` for `.wasm`; the page sends COOP `same-origin` and COEP
`credentialless`. melonDS's wrapper is `index.js` because `melonds.js` and Emscripten's
`melonDS.js` collide on case-insensitive file systems.

## Manifest schema (`<core>/manifest.json`, `schemaVersion` 1)

| Field              | Type                          | Meaning                                                                                |
| ------------------ | ----------------------------- | -------------------------------------------------------------------------------------- |
| `id`               | string                        | Directory name under `/emulation/`                                                     |
| `name`             | string                        | Display name                                                                           |
| `kind`             | `"rust"` \| `"qt-emscripten"` | Build path                                                                             |
| `systems`          | string[]                      | bun-engine system ids the core boots (`nds`, `3ds`, `ctr`, `nes`, `gba`, `psx`)        |
| `extensions`       | string[]                      | Accepted image extensions                                                              |
| `module`           | string                        | ES module, relative to the core directory                                              |
| `wasm`             | string                        | WebAssembly binary, relative to the core directory                                     |
| `start`            | string                        | Export that boots a game (default `start`)                                             |
| `threads`          | boolean                       | Whether `module`/`wasm` need SharedArrayBuffer (cross-origin isolation)                |
| `renderer`         | string                        | `webgpu` (Rust cores: Bevy on wgpu 30) or `qt-raster` (Qt software raster in a canvas) |
| `engine`           | string?                       | `bevy` for the Rust cores                                                              |
| `touch`            | boolean                       | `handle.set_touch(x, y, down)` is meaningful (bottom-screen pixels)                    |
| `audio`            | string                        | `bevy_audio` (Rust) or `sdl2-webaudio` (Qt/SDL)                                        |
| `firmware`         | string[]                      | Open-source components from `firmware/firmware.json` the core can use                  |
| `license`          | string                        | SPDX expression of the core                                                            |
| `version`          | string                        | Crate version or pinned source commit                                                  |
| `sha256`           | object                        | Digests of `module` and `wasm`                                                         |
| `variants.threads` | object?                       | `{ module, wasm, threads: true, sha256 }`: the shared-memory build                     |

## JavaScript API (every core)

```js
const mod = await import(`/emulation/${core}/${manifest.module}`);
await mod.default({ module_or_path: `/emulation/${core}/${manifest.wasm}` });
const handle = await mod[manifest.start ?? "start"](canvas, rom, {
  system,
  bios,
  firmware,
});
handle.set_input(keys); // A=1 B=2 SELECT=4 START=8 RIGHT=16 LEFT=32 UP=64 DOWN=128 R=256 L=512 X=1024 Y=2048
handle.set_touch(x, y, down); // bottom screen: DS 256x192, 3DS 320x240 (manifest.touch)
handle.stop();
handle.free?.();
// diagnostics: handle.frames, handle.frame_hash, handle.lit, handle.first_frame_ms,
// handle.renderer, handle.audio, handle.stopped
```

Rust cores: `start` builds the same Bevy `App` as `bun-engine run` (`crate::web` is a thin
wasm-bindgen facade over `bun_engine::runtime`): Bevy's web window bound to the canvas (an id is
assigned when it has none; `fit_canvas_to_parent`), WebGPU through wgpu 30, `bevy_input`
keyboard (Z/X/A/S/Q/W, Enter, Backspace/Right Shift, arrows) and `bevy_gilrs` gamepads folded
into `EngineInput`, machine audio on `bevy_audio`, the machine in `FixedUpdate` at its own refresh
rate (DS 59.826 Hz, 3DS 59.831 Hz) on Bevy's `requestAnimationFrame` loop. `set_input` bits are
an `ExternalPads` source OR-ed with keyboard and gamepads; `set_touch` overrides the mouse touch
point while held. Options: `system` (required), `bios` (`Uint8Array`), `firmware` (registry id
`bios` must match; without it `bios` is a local user file). One machine per module instance:
winit cannot recreate its browser event loop, so switching games needs a reload.

Rust cores also export `systems()`, `firmware_registry()` and `FirmwareVerifier` (streamed
sha256/sha512/size check with gzip and Zstandard decoding, shared with native hosts through
`bun_engine::firmware`).

`runtime/touch.js` exports `bindTouch(canvas, handle, system)` and `bottomScreenPoint(...)`.

## Firmware

Only open-source components are listed (`packages/bun-engine/plugins/consoles/free-firmware.json`):
PCSX-Redux OpenBIOS (PlayStation, MIT) and Normmatt's GBA BIOS. `runtime/firmware.js`
`loadFreeFirmware(id, { Verifier })` tries the same-origin copy, then the registry URL, then the
mirror order from `mirrors.json`, each with Subresource Integrity (sha512); the bytes are checked
again by `FirmwareVerifier` and cached in OPFS (IndexedDB fallback). The Libreboot mirrors send no
CORS headers, so in practice the same-origin copy is the one a browser can use; the others stay
for hosts that proxy them. `readUserFirmware(file)` / `acceptUserFirmware(element, cb)` read a
user's own dump locally: it is never uploaded or cached. DS cores need no firmware (Dust HLE
BIOS, melonDS FreeBIOS); Zakuro is HLE. Proprietary BIOS files and console keys are never
fetched or shipped; Azahar's built-in key blob is disabled (`ENABLE_BUILTIN_KEYBLOB=OFF`).

## Builds

Rust: `cargo build -p bun-engine --lib --target wasm32-unknown-unknown --profile wasm-release
--no-default-features --features web,<core>` (profile `wasm-release`: opt-level 3, fat LTO,
one codegen unit, `panic=abort`, stripped) with `+simd128,+bulk-memory,...`, without sccache
(its re-spawned rustc command lines exceed the Windows limit on web-sys/Bevy). Then
`wasm-bindgen --target web` and `wasm-opt -O3` (Binaryen) with debug info, producers and
target-feature sections stripped. Bevy's `webgpu` and `webgl2` features are exclusive, so the
artifacts are WebGPU only (Chrome/Edge 113+, Firefox 141+, Safari 26). `--threads` adds an
`+atomics`/shared-memory variant (`-Zbuild-std`); it is not built by default because Bevy runs
its schedules single-threaded in browsers, so it buys nothing today.

Qt: `qt-cmake` from the `wasm_multithread` kit, `-O3 -flto -msimd128`, `ALLOW_MEMORY_GROWTH`,
pthreads. Closure Compiler is off: with Emscripten 5.0.5 and this Qt kit it fails on the glue
(`JSC_UNDEFINED_VARIABLE setTempRet0` in the C++ exception helpers); `MELONDS_CLOSURE=1` retries
it. melonDS runs its emulation on a `QThread`, so only the multi-threaded kit applies. The JIT is
off (WebAssembly has no writable executable memory). The OpenGL renderer is compiled (the front
end needs its symbols) but never selected: the patched GL context factory returns no context on
Emscripten (WebGL2 is not desktop GL 3.2 and Qt for WebAssembly does not support GL contexts on
secondary threads), so melonDS falls back to its software renderer and QPainter screen panel.

## Cores and limits

| Core                                               | Path                         | State                                                                                                    |
| -------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `dust-nds`                                         | Rust, Bevy on WebGPU         | built candidate; fresh VPS receipt required before packaging                                             |
| `melonds`                                          | Qt 6 + Emscripten (pthreads) | built candidate; browser smoke must pass before packaging                                                |
| `zakuro-3ds`                                       | Rust, Bevy on WebGPU         | Zakuro ported to wasm32 (in-memory images, no Vulkan/Cranelift/libloading, browser clock); build pending |
| `azahar`                                           | Qt 6 + Emscripten            | recipe written (interpreter CPU, software renderer, no key blob); not yet run                            |
| `tetanes-nes`, `rustboyadvance-gba`, `starpsx-psx` | Rust, Bevy                   | recipes in `build.ts`; after DS/3DS                                                                      |

- DS cores need no firmware: Dust has an HLE BIOS and boots plaintext homebrew without the ARM7
  BIOS; melonDS uses its built-in FreeBIOS. Commercial cartridges with an encrypted secure area
  need the user's own BIOS (local file).
- Historical workstation timings are not VPS qualification evidence. Software WebGPU on the
  shared VPS may require `smoke.ts dust-nds --timeout-ms=600000`; the 120-frame threshold remains
  unchanged. Receipts identify the exact tested single or threaded variant.
- mGBA is not vendored; DuckStation is CC BY-NC-ND since 2024 (no derivative builds allowed), so
  neither is built here.
- container2wasm (v0.8.4) runs a whole Linux container on an emulated CPU (Bochs for x86_64,
  TinyEMU for riscv64, QEMU-wasm for `--to-js`): an Alpine shell is realistic for the Linux
  machine, console emulators are not (an emulator inside an emulated CPU). Its CLI ships only for
  Linux; build it on the VPS with `c2w --to-js alpine:3.22 out/htdocs` when the Linux machine is
  scheduled.
