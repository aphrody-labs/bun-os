> **Legacy fork notice (2026-10-29).** This document describes the abandoned `aphrody-labs/bun` fork (`toolchains/bun`) and its packaging as `bun-aphrody`. The Bun OS runtime is now the unmodified upstream `bun` npm package pinned at `1.4.4-canary.20261028.1` (gitHead `11c367163a4b`, `bun --revision` prints `1.4.4-canary.1+11c367163`). Fork-only commands, APIs and modules named here (`bun mcp`, `bun n2b`, `bun agent-plugin`, `bun wasm`, `bun:windows`, `bun:linux`, `bun:nginx`, ...) are not available on upstream Bun. Read it as history, not as current instructions.

# Bun OS heavy components

Inventory of the heavy packages, crates, vendor trees, native libraries, model
weights and binaries of the `aphrody-labs/bun` fork (`toolchains/bun`) and of
the Bun OS members (`crates/`, `packages/`, `apps/`, `vendor/`), with their
place in the OS. The machine-readable source is
[`factory/bunos/components.json`](../factory/bunos/components.json); check it
with `bun factory/bunos/validate.ts` (no build).

The same file also holds the `runtime` pin (npm `bun`), the `registrationModes`
vocabulary and a `modules` list of every submodule, workspace package, crate and
crates.io workspace dependency with its registration mode and `aot` flag (AOT
executables ignore bunfig `preload` and reject `--preload` unless built with
`--aot-allow-code-from-disk`). `bun factory/bunos/check-components.ts` verifies
it against `.gitmodules`, `package.json`, `Cargo.toml` and `Cargo.lock`, and runs
in the CI Bun quality job.

Measured 2026-10-16 with `dust -b`. Submodules shown as "not initialized" are
declared in `.gitmodules` but not checked out on the workstation.

## Integration modes

- `pacman-bunos`: a PKGBUILD in `factory/bunos/pkgbuilds/<pkg>` built into the
  local `bunos` pacman repository.
- `pacman-system`: an Arch/CachyOS binary package is used instead of a vendored
  copy (shared system library).
- `overlay`: files placed in `/usr` by the `/usr` factory or a package.
- `image`: installed by an OCI image package list (`factory/images`).
- `static-in`: statically linked into another component.
- `excluded`: not part of the Linux `/usr` (build input, Windows-only).
- `remaining`: not integrated yet, with the reason.

## Totals

| Tree             | Size                                                               |
| ---------------- | ------------------------------------------------------------------ |
| `toolchains/bun` | 4.0 GiB (packages 3.3 GiB, of which `aphrody-migrated/m3` 2.9 GiB) |
| `vendor/`        | 13 GiB (`proton` 8.6 GiB)                                          |
| `crates/`        | 296 MiB                                                            |
| `apps/`          | 269 MiB                                                            |
| `packages/`      | 267 MiB                                                            |

## Runtime: fork `toolchains/bun`

| Component                                                                            | Size                            | Origin                                           | OS integration                                                                                                                          | Build                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `bun` binary                                                                         | 4.0 GiB source, ~193 MiB binary | aphrody-labs/bun `46709d6993`                    | `pacman-bunos` `bun-aphrody` (`factory/usr/pkgs`, `/usr` basePackages) → `/usr/bin/bun`                                                 | fork release asset; source: `bun scripts/build.ts --profile=release` |
| WebKit/JSC                                                                           | ~80 MiB prebuilt                | aphrody-labs/WebKit autobuild (fallback oven-sh) | `static-in` bun-aphrody                                                                                                                 | downloaded by the build                                              |
| ICU                                                                                  | ~35 MiB                         | unicode-org via WebKit prebuilt                  | `static-in` bun-aphrody                                                                                                                 | bundled in the prebuilt                                              |
| lol-html                                                                             | small                           | oven-sh fork (`vendor/lolhtml`)                  | `static-in` bun-aphrody                                                                                                                 | cargo                                                                |
| BoringSSL, mimalloc, libuv, tinycc, lsquic                                           | ~60 MiB sources                 | oven-sh forks, litespeedtech                     | `static-in` bun-aphrody                                                                                                                 | build deps                                                           |
| zlib-ng, zstd, brotli, libdeflate, c-ares, libarchive, sqlite, image codecs, highway | ~40 MiB sources                 | upstreams                                        | `static-in` bun-aphrody                                                                                                                 | build deps                                                           |
| brave, mullvad, uv vendor                                                            | 134 MiB                         | brave, mullvad, astral forks                     | `static-in` bun-aphrody                                                                                                                 | cargo path deps                                                      |
| windows-rs                                                                           | Windows only                    | microsoft                                        | `excluded`                                                                                                                              |                                                                      |
| CEF (`vendor/cef-rs`)                                                                | ~250 MiB download               | chromiumembedded                                 | `remaining`: extra/cef is 152.0.6, cef-rs pins 154.5.0 (major-versioned API); build with `CEF_PATH=/usr/lib/cef` once extra reaches 154 |                                                                      |
| `bun-video-native`                                                                   | 324 MiB package tree            | fork                                             | `pacman-bunos` `bun-video-native` → `/usr/lib/bun`                                                                                      | cargo-serial `--features libav`                                      |

### Shared-library choices

- WebKit/JSC, ICU, BoringSSL, mimalloc, libuv, tinycc stay bundled: they are
  patched forks or ABI-coupled to JSC (`webkit2gtk` and system `openssl` are not
  substitutes). System ICU is used only by local WebKit builds.
- zlib, zstd, brotli and sqlite: `bun scripts/build.ts --system-deps=zlib,zstd,brotli,sqlite3`
  (linux-gnu only) skips their pinned build and links `-lz`, `-lzstd`,
  `-lbrotli*`; `sqlite3` turns off `staticSqlite` so bun:sqlite dlopens the
  system library. Default builds stay static; the option is not yet exercised
  by a full build. libdeflate, c-ares, libarchive and the image codecs stay
  bundled.
- `bun-video-native` uses `ffmpeg-sys-next` without its `build` feature, so it
  links system `ffmpeg` (extra) through pkg-config: no vendored ffmpeg.

## Aphrody: `crates/`

| Component                                     | Size             | Origin                | OS integration                                                                                                    | Build                                                |
| --------------------------------------------- | ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `aphrody` (CLI, MCP, infra, kernel libraries) | 296 MiB sources  | bun-distribution      | `pacman-bunos` `aphrody` → `/usr/bin/aphrody`, `/usr/lib/aphrody`, `/usr/share/aphrody`                           | cargo-serial `-p aphrody`                            |
| `aphrody-llama-sys`                           | 304 KiB bindings | llama.cpp, dynamic    | `pacman-system` optdepend `llama-cpp` (extra)                                                                     | bindgen only; `libllama` loaded at runtime           |
| ONNX Runtime (`ort` load-dynamic)             | ~60 MiB          | microsoft/onnxruntime | `pacman-system` optdepend `onnxruntime-cpu` (extra), `ORT_DYLIB_PATH` in `/usr/lib/environment.d/60-aphrody.conf` |                                                      |
| whisper.cpp (`aphrody-voice`)                 | ~5 MiB           | ggml-org              | `pacman-system` optdepend `whisper-cpp` (extra)                                                                   | fallback: first-run fetch to `$APHRODY_RUNTIMES_DIR` |
| wgpu (`vendor/wgpu`, 25 crates)               | 66 MiB           | aphrody-labs/wgpu     | `static-in` aphrody; system Vulkan loader and mesa                                                                |                                                      |
| bevy                                          | 171 MiB          | aphrody-labs/bevy     | `static-in` apps                                                                                                  |                                                      |
| `bunos-utils`                                 | multicall        | uutils fork           | `overlay` `/usr/bin/bunos-utils` (`factory/usr` `multicall`)                                                      | owned by the `/usr` factory                          |

## Model weights

The only weight file in the checkout is a Proton/Piper test voice
(`vendor/proton/piper/etc/test_voice.onnx`). Other `.gguf`/`.onnx`/`.safetensors`
names are test fixtures or catalog references. Weights are never packaged:
`aphrody` ships an empty `/usr/share/aphrody/models` for administrator-shared
weights, and `aphrody model pull` fills `$APHRODY_MODELS_DIR` (user state) on
first launch.

## Heavy vendor trees

| Component                      | Size            | OS integration                                                         |
| ------------------------------ | --------------- | ---------------------------------------------------------------------- |
| `vendor/proton`                | 8.6 GiB         | `image` `proton-cachyos` (bunos-gaming)                                |
| `vendor/gamescope`             | 1.4 GiB         | `image` `gamescope`                                                    |
| `vendor/vkd3d-proton`          | 328 MiB         | `image` `vkd3d-proton-bin`                                             |
| `vendor/dxvk`                  | 172 MiB         | `image` `dxvk-bin`                                                     |
| `vendor/wine-cachyos`          | not initialized | `pacman-system` `wine-cachyos`, added to the `/usr` gaming composition |
| `vendor/omarchy`               | 378 MiB         | `image` omarchy pacman repository pin                                  |
| `vendor/linux-cachyos`         | not initialized | `pacman-system` `linux-cachyos` (base)                                 |
| `vendor/pacman`                | not initialized | `pacman-system` `pacman` (base)                                        |
| `vendor/bash`                  | 326 MiB         | `pacman-system` `bash` (via `base`)                                    |
| `vendor/fonts`                 | not initialized | `pacman-bunos` `bun-os-fonts` → `/usr/share/fonts/bun-os`              |
| `vendor/material-design-icons` | not initialized | `pacman-bunos` `material-design-icons-bunos`                           |
| MSYS2, mingw, Cygwin trees     | 1.0 GiB         | `excluded`: Windows factory                                            |
| `vendor/powershell`            | 102 MiB         | `remaining`: no repo package, no consumer                              |

## npm packages and apps

| Component                                               | Size         | OS integration                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toolchains/bun/packages/aphrody-migrated/m3`           | 2.9 GiB      | `excluded`: dev workspace output                                                                                                                                                                                                 |
| `apps/` static web apps (artcraft, m3-showcase, m3-web) | 269 MiB tree | `pacman-bunos` `bun-os-webapps`: `/usr/share/bun/apps/<id>`, `/usr/bin/bunos-webapp` (Bun.serve on 127.0.0.1 + Chromium `--app` or xdg-open), `/usr/share/applications/bunos-<id>.desktop`; list in `factory/bunos/webapps.json` |
| Next.js apps, rg-bot, iecode-web                        |              | `remaining`: need a server or wasm launcher contract                                                                                                                                                                             |

## Licences

Every `bunos` PKGBUILD installs its licence, and upstream `LICENSE`/`NOTICE`/
`COPYING` files, in `/usr/share/licenses/<pkg>`. `validate.ts` rejects a
PKGBUILD that does not.

## Remaining gaps

- The `/usr` builder does not consume `bunos.compositionPackages` yet.
- CEF, PowerShell and the server-side web apps, for the reasons above.

## System runtimes first

`aphrody` resolves llama.cpp (binaries and `libllama.so`), ONNX Runtime and
whisper.cpp from `/usr/bin`, `/usr/local/bin`, `/usr/lib`, `/usr/lib64` and
`/usr/local/lib` after the explicit environment overrides and before
`$APHRODY_RUNTIMES_DIR` (`crates/aphrody-infer/src/llama.rs`,
`crates/aphrody-infer/src/runtime.rs`,
`crates/aphrody-voice/src/stt/whisper_cpp.rs`).

## Qualification

`bun-os-fonts` built on the vps in `archlinux:base-devel`:
`bun-os-fonts-r1-1-any.pkg.tar.zst`, 1.1 GB, 3900 font files, licences
installed under `/usr/share/licenses/bun-os-fonts`.
