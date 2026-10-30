# Emulation

One stack, measured. Everything in the matrix below comes from `crates/bun-engine-core/tests/rom_suite.rs`,
which boots free homebrew and test ROMs headless (no window, no GPU), and from nothing else. A console that
the suite does not exercise says so. No commercial ROM, BIOS, firmware or key is stored in this repository or
fetched by CI: the user supplies their own.

Older notes about the RetroArch fork, screenshots and the Arch gaming image stay in
[`docs/bun-engine/EMULATION.md`](bun-engine/EMULATION.md); they describe manual checks, not CI.

## The stack

| Layer                      | Owner                                                                                                                                                                   | What it is                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract                   | `crates/bun-engine-core` (`bun-engine`)                                                                                                                                 | one `machine::Machine` trait (frame, screens, audio, input, save state), one CLI: `bun-engine run <system> <image>`                           |
| In-tree cores (Rust)       | `vendor/tetanes`, `vendor/rustboyadvance-ng`, `vendor/starpsx`, `vendor/zakuro`, `crates/aphrody-dust-core`, `crates/aphrody-wii-runtime`, `crates/ruzu*` + `rdynarmic` | cores that compile into `bun-engine` and also build for wasm32 where their dependencies allow                                                 |
| libretro host (Rust)       | `crates/bun-engine-core/src/machine/libretro.rs` (feature `libretro`)                                                                                                   | loads any `*_libretro.so/.dll/.dylib` with `libloading` and drives it as a `Machine`: `bun-engine run libretro <rom> --core mgba_libretro.so` |
| Packaged emulators         | `factory/images/bunos-gaming/emulation.packages`                                                                                                                        | RetroArch, Dolphin, Azahar, PCSX2, RPCS3, PPSSPP, Flycast, xemu, MAME, QEMU, ... installed from Arch repositories; not run by this suite      |
| Windows and Linux PC games | `factory/images/bunos-gaming/gaming.packages`, `bunos-compat`                                                                                                           | Steam, Proton (CachyOS), Wine, DXVK, gamescope: the distribution side, not emulation                                                          |

Decision rule for a console: if a maintained Rust core already runs in-tree and passes its homebrew tests
(NES, GBA, DS, 3DS), it stays; every other console goes through the libretro host so that the mature C/C++
cores (mGBA, Snes9x, Genesis Plus GX, Mupen64Plus, PPSSPP, Flycast, ...) are reused instead of rewritten.
mGBA is the first one built from source in CI (MPL-2.0, tag 0.10.5, commit pinned in
`scripts/emulation/pins.json`); it doubles as an independent second opinion on the Rust GBA core.

## Console matrix (generated, measured)

Regenerate with `bun scripts/emulation/matrix.ts <results.json> --write`. "Needs" lists what the user supplies.

<!-- matrix:start -->
Not generated yet: the first CI run of `emulation.yml` produces `results.json`; run
`bun scripts/emulation/matrix.ts results.json --write` to fill this block and `docs/emulation-results.json`.

Measured by hand on Windows (2026-10-29, release build, hashes not yet pinned for libretro cases):

- NES (TetaNES): nestest, instr_basics, instr_abs, vbl_nmi_basics pass; deterministic; save-state round trip ok.
- GBA (RustBoyAdvance-NG): gba-tests arm, thumb, memory, nes pass; bios fails test 002 (free BIOS); sram and flash64 fail test 004 while mGBA passes them.
- DS (Dust): GodMode9i draws its UI (clock masked in the hash).
- 3DS (Zakuro): FBI 3dsx and CIA reach the main menu on both screens (clock masked); about 75-85 ms per frame.
- GameCube (Gekko interpreter): Swiss AUTOEXEC.DOL runs but draws nothing (blank).
- Switch (Ruzu): nx-hbmenu draws "launchInit() failed"; picture differs between boots.
- Game Boy and GBA via the libretro host with a local mGBA build: mooneye ROMs pass, host loads, runs, saves and restores states.
- PlayStation: not measured (the OpenBIOS pin in free-firmware.json answers 404; CI builds OpenBIOS from source).
<!-- matrix:end -->

## What the suite checks

For every case: the final-frame SHA-256 over all screens must equal the pinned hash, a second boot must give
the same frame hash and audio hash (determinism), the picture must not be blank, and a save state taken
half-way must restore to the same final picture. The verdict (`pass`, `fail`, `blank`) is read by a human from
the dumped screens (`BUN_ENGINE_RECORD=1` writes PPMs) and kept in `rom-suite.json`; a hash alone proves
stability, not correctness. The DS and 3DS guests draw the host clock, so their hash masks the clock rectangle.

```sh
bun scripts/emulation/fetch-roms.ts target/rom-suite/downloads        # pinned, sha256-verified free ROMs
cargo test -p bun-engine --release --no-default-features \
  --features nes,gba,psx,wii,nds,ctr,libretro --test rom_suite          # BUN_ENGINE_ROMS_REQUIRED=1 in CI
bun scripts/emulation/matrix.ts target/rom-suite/results.json --check  # same statuses as docs/emulation-results.json
```

CI: `.github/workflows/emulation.yml` (OpenBIOS built from source, mGBA built from source, the suite, and
TetaNES's own accuracy suite).

## Not available, and why

- Xbox 360: no emulator is packaged.
- PS3 (RPCS3), Switch retail titles (Ruzu or Ryujinx-class cores), Vita (Vita3K), Xbox (xemu): they need a
  powerful native host and the user's own firmware, keys or BIOS. Only Switch homebrew (NRO) runs in-tree.
- Commercial games of every console: the user supplies the dump; nothing here ships or downloads one.
