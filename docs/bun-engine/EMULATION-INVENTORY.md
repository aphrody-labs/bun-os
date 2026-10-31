# Bun Engine emulation, firmware and graphics inventory

Snapshot of the checked-in catalogs on 2026-10-25. This is an index into the
canonical registries, not a claim that every source is built, qualified or
cleared for redistribution.

## Canonical catalogs

| Scope | Source of truth | Current checked-in scope |
| --- | --- | --- |
| Console implementations and source ownership | [`plugins/consoles/manifest.json`](../../packages/bun-engine/plugins/consoles/manifest.json) | 30 implementation/SDK components; local Cargo crates and pinned vendor sources, with per-entry pins, license and publication gate. |
| Systems and launch routes | [`plugins/consoles/systems.json`](../../packages/bun-engine/plugins/consoles/systems.json) | 35 frontend system definitions, binary probes, native machine routes, libretro cores and DAT references. |
| Upstream release packages | [`plugins/consoles/releases.json`](../../packages/bun-engine/plugins/consoles/releases.json) | 18 packages with platform asset selectors; use the package-manager resolver and source/pin policy. |
| BIOS, keys and firmware | [`plugins/consoles/firmware.json`](../../packages/bun-engine/plugins/consoles/firmware.json) | 23 console families and 197 named firmware entries, including documented hashes and required/optional policy. These are identifiers and validation metadata, not payloads. |
| Redistributable firmware | [`plugins/consoles/free-firmware.json`](../../packages/bun-engine/plugins/consoles/free-firmware.json) | 2 importable open replacements. Their digest is checked before adding to the user firmware store. |
| Homebrew and test payloads | [`plugins/consoles/roms.json`](../../packages/bun-engine/plugins/consoles/roms.json) | 7 declared packs with source/license provenance. |
| Supported ROM and disc formats | [`plugins/consoles/formats.json`](../../packages/bun-engine/plugins/consoles/formats.json) | 79 formats according to [`FIRMWARE-AND-FORMATS.md`](FIRMWARE-AND-FORMATS.md). |

The canonical CLI, parsers, firmware import/catalog, validation and launch
implementation live in `packages/bun-engine`; native runtime ownership is
`crates/bun-engine-core`. Do not create a second catalog or move upstream
owners merely to make the tree look flat.

The 35 frontend system IDs are: `nes`, `snes`, `gb`, `gba`, `nds`, `3ds`,
`n64`, `gc`, `wii`, `wiiu`, `switch`, `psx`, `ps2`, `ps3`, `psp`, `psvita`,
`ps4`, `xbox`, `dreamcast`, `megadrive`, `atari2600`, `jaguar`, `vectrex`,
`amiga`, `scummvm`, `pce`, `saturn`, `virtualboy`, `ngp`, `wonderswan`,
`lynx`, `c64`, `arcade`, `arm`, and `x86`.

The 18 release-package IDs are: `melonds`, `pcsx2`, `duckstation`, `azahar`,
`cemu`, `mgba`, `rpcs3`, `ares`, `xemu`, `flycast`, `vita3k`, `shadps4`,
`ppsspp`, `mame`, `tetanes`, `gopher64`, `jgenesis`, and `retroarch`.

The 30 source-component IDs in the component registry are: `switch-aarch64`,
`switch-texture`, `wii-cpu-runtime`, `wii-image-parsers`, `devkitpro-libnds`,
`devkitpro-libogc`, `devkitpro-calico`, `devkitpro-libctru`, `devkitpro-citro3d`,
`devkitpro-citro2d`, `rust3ds-ctru-rs`, `open-agb-firm`, `ares`, `mame`,
`retroarch`, `tetanes`, `retroboy`, `rustboyadvance-ng`, `dust`, `gopher64`,
`jgenesis`, `starpsx`, `zakuro`, `melonds`, `azahar`, `dolphin`, `pcsx2`,
`gecko`, `oboromi`, and `nexium`. All 30 currently carry the
`deferred-review` publication gate; this is not production clearance.

## Emulator owners and coverage

- The Rust source shortlist and exact research pins are in
  [`RUST-EMULATORS.md`](RUST-EMULATORS.md): TetaNES (NES), RetroBoy (GB),
  RustBoyAdvance-NG (GBA), dust (DS), Gopher64 (N64), Zakuro (3DS), jgenesis
  (multi-console), and StarPSX (PS1). These are selected source owners, not a
  certification matrix.
- Local runtime pieces include NES/GBA/DS machines in `bun-engine-core`,
  `aphrody-dust-core` and `aphrody-dust-wgpu`, plus Wii/GameCube loaders and
  Switch CPU/texture primitives. The local Wii/GameCube and Switch code is
  explicitly not a complete emulator.
- The external system catalog and `factory/images/bunos-gaming/emulation.packages`
  cover a much broader package set: RetroArch/libretro, MAME, ares, Mednafen,
  melonDS, DeSmuME, Dolphin, Azahar, Cemu, mGBA, SameBoy, Mupen64Plus/RMG,
  Snes9x, bsnes, Nestopia, FCEUX, PCSX2, DuckStation, RPCS3, PPSSPP, Vita3K,
  shadPS4, Flycast, xemu, DOSBox Staging, ScummVM, 86Box and QEMU/OVMF, plus
  Waydroid. A package declaration does not prove it is available in the
  configured signed repositories or that its binary is qualified.
- Web builds and their qualification flow are under
  [`web-emulation/`](../../packages/bun-engine/web-emulation/). The active
  delivery backlog still requires every supported WASM variant to be built and
  qualified before publication.

See [`EMULATION.md`](EMULATION.md) for runtime architecture and known limits.

## Firmware, BIOS and payload policy

`firmware.json` inventories both open replacements and proprietary hardware
dumps, with hashes for recognition. BIOS, firmware, keys and commercial games
are not included in the gaming package list. Users import dumps they are
authorized to use; freely licensed firmware is handled through the separate
`free-firmware.json` importer. Preserve each source license and copyright
notice in any build or publication.

One publication blocker is already documented in
[`FIRMWARE-AND-FORMATS.md`](FIRMWARE-AND-FORMATS.md): jgenesis contains 32X boot
ROM bytes matching retail Sega BIOS hashes. Resolve that provenance/licensing
issue before distributing any artifact containing the affected implementation.
Other firmware entries must retain their per-entry source and license review;
catalog presence is not redistribution permission.

## GPU and low-level device libraries

- Emulator GPU ownership is split between the console's device model, the
  `wgpu`/Bevy renderer, and platform graphics backends. DS's internal GPU is in
  `aphrody-dust-core`; its accelerated presentation is in
  `aphrody-dust-wgpu`. Switch texture primitives are in `aphrody-switch`.
- The broader portable graphics and driver ownership map is
  [`GPU.md`](GPU.md). It names wgpu/winit, DirectX/DXC, NVIDIA open modules,
  CUDA/CCCL and Bun runtime GPU/FFI owners. These are separate capability and
  target owners, not all emulator dependencies.
- Real-hardware GPU and Gamescope qualification remains distinct from software
  rendering. The delivery backlog records the Dust WGPU 30 renderer and
  gaming-session gates as incomplete; VPS software-renderer results do not
  establish hardware GPU readiness.
- No dedicated embedded-controller (EC) firmware/emulator component appears in
  the console component registry or the targeted source inventory. EC work
  should not be folded into console BIOS handling without an identified source
  owner and hardware contract.

## Readiness and delivery gates

Current source evidence supports an integrated catalog and product assembly
path. It does not establish a production-qualified emulator release. Remaining
gates include source/submodule closure, license review, signed repository
availability for every requested package, per-variant WASM builds, native
binary probes, GPU-backed rendering, real gamepad/session behavior, artifact
receipts, and public deployment checks. See
[`active-delivery-backlog.md`](../agent-goals/active-delivery-backlog.md).

Do not label the product production-ready or deploy a new gaming release until
those gates have passing evidence bound to the source revision and artifacts.
