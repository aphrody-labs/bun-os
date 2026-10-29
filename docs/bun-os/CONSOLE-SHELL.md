# Bun OS console shell

The console shell is the full-screen, controller-first face of Bun OS on Windows: the SteamOS idea
rebuilt for an NVIDIA Windows PC, in Rust on Bevy 0.20 (wgpu 30) with a native Material 3
interface, the Bun Engine machines in the same App and Steam games through the Steam client.

| Item | Path |
| --- | --- |
| Crate (owner) | `crates/bun-os-shell` (lib + `bun-os-shell` binary) |
| Engine entry | `bun-engine shell [...]` (Rust CLI, runs the sibling `bun-os-shell`) |
| Bun entry | `bun packages/bun-engine/src/cli.ts shell [...]` (`packages/bun-engine/src/shell.ts`) |
| Route resolver | `bun-engine library command <id>` (`packages/bun-engine/src/frontend/cli.ts`) |
| Profiles (Bun half) | `packages/bun-engine/src/frontend/profiles.ts`; `bun-engine library profile [key [field=value...]]` |
| State | `usr/var/lib/bep/shell.db` (profiles, sessions, settings), `usr/var/lib/bep/shell/{states,captures}` |
| Art cache | `usr/var/cache/bun-os-shell/{steam,libretro}` |
| Art direction | `design-system/bun-os-play/DIRECTION.md`, tokens `MASTER.md` |

## Build and run

```sh
# sccache cannot spawn bevy_internal's rustc command line on Windows (os error 206):
# run the cargo wrapper with an empty RUSTC_WRAPPER.
RUSTC_WRAPPER= CARGO_BUILD_RUSTC_WRAPPER= bun scripts/cargo.ts exec -- build --release -p bun-os-shell
target/release/bun-os-shell                    # 1600x900 window
target/release/bun-os-shell --session          # borderless full screen, hidden cursor
target/release/bun-os-shell status             # JSON: library, NVIDIA, display, encoders, busy state
target/release/bun-os-shell --windowed 1920x1080 --script "wait:1500,right,shot:home,guide,shot:quick,exit" --shots DIR --stats FILE
```

`--script` drives the same intent pipeline as real input (`left|right|up|down`, `accept`,
`back`, `guide`, `prev`, `next`, `wait:MS`, `shot:NAME`, `play:KEY|TITLE`, `exit`). `--stats`
writes the frame-time report (mean, p50/p95/p99, max, frames over 16.7 ms) and the machine
counters.

## Session at sign-in (opt-in)

The shell never replaces Explorer and never changes a system or security setting. Session mode is
a per-user startup entry that the owner registers:

```sh
"C:\src\bun-os\target\release\bun-os-shell.exe" install-session     # HKCU\...\Run\BunOSConsoleShell = "<exe>" --session
"C:\src\bun-os\target\release\bun-os-shell.exe" uninstall-session
```

`bun-os-shell session-status` prints the entry and the opt-in line; Settings shows the line too.
"Return to the desktop" exits the shell; Explorer is still running underneath.

## Interface

Per DIRECTION.md: the focused game's real art runs full-bleed and the whole M3 scheme is
regenerated from it. Everything else stays quiet.

- **Dynamic color.** The art loader computes each picture's M3 source color
  (`aphrody_m3_tokens::image::source_color_from_rgba8`: Celebi quantization + score, the
  material-color-utilities algorithm) and the live `Theme` resource re-tints to the tonal-spot
  dark scheme of that seed. Every node carries a `Tint` role, so surfaces, text, the focus ring
  and the rail follow the game; the baseline seed #6750A4 (MASTER.md) applies when no art exists.
- **The one orchestrated moment.** On focus change, when the hero art is ready, the hero
  cross-fades and the scheme re-tints together in 300 ms on M3 emphasized easing
  (cubic-bezier(0.2, 0, 0, 1)). Other motion only answers input (focus spring, rail scroll, quick
  menu slide, toast). Reduced motion makes all of it an instant swap; "System" follows the
  Windows animation setting (`SPI_GETCLIENTAREAANIMATION`).
- **Type.** Google Sans Flex only (from `aphrody-m3-tokens`), variable weights through Bevy's
  parley text; the game title is display type, UI text is sentence case, M3 scale x1.25 for
  10-foot viewing.
- **Layout.** Home: top bar (tabs, NVIDIA summary, controller indicator, clock, power), the hero
  (platform, title, metadata, Play/Resume and Game hub), one Activity line of real entries, and
  the rail of capsules (focused capsule scales 1.08 with the ring). The quick menu is a side sheet
  over a scrim. Library is the full capsule grid with filters; Game hub holds the per-game profile;
  Downloads and Settings are lists. Shapes follow the M3 scale by hierarchy (capsules medium,
  panels large, chips and buttons full); no decorative gradients or shadows (the only gradients are
  the legibility scrims, re-tinted with the scheme).
- **Real assets.** Icons are Material Symbols Rounded from the pinned font in `packages/m3-fonts`,
  drawn as vector glyphs through the font's ligatures at the 20/24/40 icon tokens. Steam art comes
  from the client cache (`appcache/librarycache/<appid>`) and otherwise the public Steam CDN;
  emulated games use libretro-thumbnails (box art for capsules, snaps/titles for the hero) matched
  through the DAT names in `library.db`, from `LIBRETRO_THUMBNAILS`/`usr/share/bun-engine/thumbnails`
  or thumbnails.libretro.com; a suspended machine game shows its real last frame. Without art, a
  capsule is a typographic tile of the real title and system name. Downloads are cached, 404s are
  remembered (`*.missing`).
- **Words.** Every string is a message key (`src/text.rs`, temporary English catalog until the
  platform Fluent catalogs land); actions are plain verbs ("Play", "Resume", "Restart", "Open in
  Steam") and toasts reuse them.
- **Accessibility.** Every control carries an AccessKit button node named by its action (icon-only
  controls included); focus targets are at least 48 px (56 px icon buttons, 64 px buttons); focus
  feedback is a transform and a ring, so it never shifts layout.
- **Sounds.** None: the repository has no free-licensed UI sound set (the Spacedrive sounds in
  `packages/assets` are FSL-1.1). Machine audio plays through the engine's `bevy_audio` sink.

## Input

Controller first through Bevy (`bevy_gilrs`), keyboard and mouse as fallbacks; navigation is
Bevy's automatic directional navigation, only the active layer is navigable.

| Action | Pad | Keyboard | Mouse |
| --- | --- | --- | --- |
| Move (repeat 380 ms, then 85 ms) | D-pad, left stick | arrows, WASD | wheel |
| Accept | A (South) | Enter, Space | click |
| Back | B (East) | Escape, Backspace | |
| Quick menu | Guide when reported, View in menus, View+Menu in game | Home, F1, Escape in game | |
| Previous / next tab | LT / RT | Q / E, PageUp / PageDown | |

In game the engine's `EngineInput` maps keyboard (`KeyMap`) and pads to the machine. Windows does
not report the Xbox Guide button to desktop apps (and Game Bar owns it), hence View+Menu.

## Games and "Gamescope for Windows"

| Source | Launch | Window and focus | Frame limit | Scaling | Resume |
| --- | --- | --- | --- | --- | --- |
| Bun Engine machines (NES, GBA, DS, PS1 from `library.db`) | `InsertMachine` into the engine runtime of the shell's App | inside the shell (engine `MachineScreen` image) | profile value | Sharp (nearest), Smooth (bilinear), FSR 1 (engine EASU + RCAS into an image) | instant: `MachineStatus.paused` in memory; state + last frame on disk via `Machine::save_state` |
| Release emulators and RetroArch (`usr/`) | `bun-engine library command <id>`, spawned and owned by the shell | window found in its process tree, made borderless on its monitor (profile), focused; shell minimized, restored on exit | emulator's | emulator's | emulator's |
| Steam (installed) | `steam://rungameid/<id>` after checking `RunningAppID` and streaming processes | game focused, shell minimized while `RunningAppID` is set and restored after | game / NVIDIA app | DLSS / NIS where the game exposes them | Steam's |
| Steam (owned, not installed) | `steam://nav/games/details/<id>` | | | | |
| Web cores (`dist/web-emulation`) | `serve.ts` + browser (WebGPU) | browser | | | |

Leaving a machine game (quick menu Home, or any screen change) pauses it and writes its state and
last frame; Resume continues from memory, or from disk after another game or a restart of the
shell. Launching another machine saves the current one first (`InsertMachine` replaces it). Close
game discards the state. `Machine::save_state`/`load_state` exist for NES (TetaNES) and GBA
(RustBoyAdvance-NG); other cores report that they cannot save.

## NVIDIA and display (read-only)

- NVAPI (`nvapi64.dll` through `nvapi_QueryInterface`): GPU name, driver and branch, temperature,
  core and memory clocks, load, G-SYNC/VRR state of the primary display, Reflex API presence.
  NVML (`nvml.dll`): board power, enforced power limit, VRAM. Polled at 1 Hz on a thread.
- HDR passthrough information: DXGI `IDXGIOutput6::GetDesc1` of the shell's monitor (G2084/P2020
  color space = HDR on, peak luminance, bits per color).
- Capture: screenshots through Bevy's `Screenshot`; recording of Bun Engine games through the Media
  Foundation sink writer with hardware transforms enabled, which selects the vendor H.264 MFT
  (NVIDIA H.264 Encoder MFT = NVENC); the encoder in use is reported.
- Nothing writes driver profiles (DRS), global NVIDIA settings or Windows settings. Volume in the
  quick menu is the same per-user action as the taskbar slider.

## Platform layer hand-off

Strings (`src/text.rs`), the theme roles and tokens (`src/theme.rs`) and the art fetch
(`assets::download`, the system curl) are the seams the platform layer (docs/bun-os/PLATFORM.md:
Fluent catalogs, M3 theme schema, transfer service) replaces.
