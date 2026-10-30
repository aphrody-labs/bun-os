# Bun OS heavy components

Inventory of the heavy sources, native libraries and binaries of Bun OS and how each one reaches the
OS. [`factory/bunos/components.json`](../factory/bunos/components.json) is the only source of truth;
this page only explains it. The runtime is the unmodified upstream Bun canary
(npm `bun@1.4.4-canary.20261028.1`, gitHead `11c367163a4b`).

## Checks

- `bun factory/bunos/validate.ts` and `bun factory/bunos/check-components.ts` verify the file against
  `.gitmodules`, `package.json`, `Cargo.toml` and `Cargo.lock`; `just components` runs the consistency
  check (`buncc doctor --repo`) and `just map` regenerates [`ARCHITECTURE-MAP.md`](ARCHITECTURE-MAP.md).
- `modules` lists 1529 entries (277 submodule, 154 npm-package, 9 app, 723 crate, 350 crate-dependency, 16 factory-module),
  each with a registration mode and an `aot` flag. AOT executables ignore bunfig `preload`.

## Integration modes

- `pacman-bunos`: a PKGBUILD in `factory/bunos/pkgbuilds/<pkg>` or `factory/usr/pkgs`, built into the `bunos` repository.
- `pacman-system`: an Arch/CachyOS package replaces a vendored copy.
- `overlay`: files placed in `/usr` by the `/usr` factory or a package.
- `image`: installed by an OCI image package list (`factory/images`).
- `static-in`: statically linked into another component.
- `excluded`: not part of the Linux `/usr` (build input, Windows-only).
- `remaining`: not integrated yet, with the reason in the manifest.

## Components (34)

| Component | Kind | Mode | Package or reason |
| --- | --- | --- | --- |
| `bun` | binary | `pacman-bunos` | bun-canary |
| `webkit-jsc` | vendored-static | `static-in` | bun-canary |
| `icu` | vendored-static | `static-in` | bun-canary |
| `lol-html` | vendored-static | `static-in` | bun-canary |
| `boringssl-mimalloc-libuv-tinycc-lsquic` | vendored-static | `static-in` | bun-canary |
| `zlib-zstd-brotli-libdeflate-cares-libarchive-sqlite-image...` | vendored-static | `static-in` | bun-canary |
| `cef` | native-sys | `remaining` | extra/cef is 152.0.6 while cef-rs pins CEF 154.5.0; CEF API is major-versioned, so keep download-cef until extra/cef reaches 154, then build with CEF_PATH=/usr/lib/cef |
| `aphrody` | binary | `pacman-bunos` | aphrody |
| `aphrody-llama-sys` | native-sys | `pacman-system` | llama-cpp |
| `onnxruntime` | native-sys | `pacman-system` | onnxruntime-cpu |
| `whisper-cpp` | runtime | `pacman-system` | whisper-cpp |
| `wgpu` | vendored-static | `static-in` | aphrody |
| `bevy` | vendored-static | `static-in` | aphrody |
| `models` | model-weights | `overlay` | aphrody |
| `bunos-utils` | binary | `overlay` | - |
| `fonts` | data | `pacman-bunos` | bun-os-fonts |
| `material-design-icons` | data | `pacman-bunos` | material-design-icons-bunos |
| `proton` | vendor | `image` | proton-cachyos |
| `gamescope` | vendor | `image` | gamescope |
| `dxvk` | vendor | `image` | dxvk-bin |
| `vkd3d-proton` | vendor | `image` | vkd3d-proton-bin |
| `wine-cachyos` | vendor | `pacman-system` | wine-cachyos |
| `cargo-xwin` | vendor | `reference` | bunos-c-windows-sysroot |
| `reactos` | vendor | `reference` | reactos |
| `omarchy` | vendor | `reference-catalog` | Omarchy recipe and configuration catalog |
| `linux-cachyos` | vendor | `pacman-system` | linux-cachyos |
| `pacman` | vendor | `pacman-system` | pacman |
| `bash` | vendor | `pacman-system` | bash |
| `vendor-cargo` | build-input | `excluded` | Build-time offline registry, not installed |
| `msys2-mingw-cygwin` | vendor | `excluded` | Windows MSYS2 factory (factory/msys2), not Linux /usr |
| `powershell` | vendor | `remaining` | Only AUR powershell-bin exists; no composition requires it |
| `npm-apps` | npm | `pacman-bunos` | bun-os-webapps |
| `bun-engine` | binary | `pacman-bunos` | bun-engine |
| `linux-desktop` | vendor | `pacman-system` | gnome-shell,mutter,plasma-workspace,kwin,qt6-base |
