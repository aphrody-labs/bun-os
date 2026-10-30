# Bun Engine on Bevy

Bevy 0.20 (wgpu 30, crates.io `bevy` 0.20.1) is the runtime of Bun Engine: one `App`, one
window (`bevy_winit`), one input layer (`bevy_input`, gamepads through `bevy_gilrs`), audio
(`bevy_audio`), UI (`bevy_ui`), assets (`bevy_asset`) and the render schedules on the shared
wgpu 30 device. The engine owns no winit loop and no wgpu surface; `window.rs` only keeps the
XInput `Pad` layout that the stream protocol and Steam Input exchange.

The crate re-exports its Bevy as `bun_engine::bevy` (dependency key `bevy`: Bevy's derive macros
resolve `bevy::ecs` through the dependency named `bevy`).

## Features

| Feature       | Adds |
|---------------|------|
| `runtime`     | `bun_engine::runtime`: `BunEnginePlugin`, machine plugins, headless `MinimalPlugins` runner. No GPU, no system libraries. |
| `render`      | Target-neutral rendering: winit window, render schedules, sprites, UI, text, keyboard/mouse, FSR1. |
| `window`      | `render` for desktop: multi-threaded, X11/Wayland. |
| `audio`       | Machine audio on a `bevy_audio` sink (ALSA on Linux). |
| `gamepad`     | `bevy_gilrs` gamepads (libudev on Linux). |
| `runtime-web` | `render` on WebGPU in the browser (`examples/bevy_web.rs`). |
| `stream`      | `stream::session::StreamPlugin`: the Moonlight/GameStream client (Windows). |
| `steam`       | `steam::SteamPlugin` + `runtime::steam` glue. |
| `host`        | `host::DsHost`: deterministic Bevy scheduling of the DS core (wasm iecode). |

`default` = `window`, `audio`, `gamepad`, every machine, `stream`. CI builds `window` alone (no
ALSA, no libudev).

## Quick start

```rust
use bun_engine::{bevy::app::App, runtime::{BunEnginePlugin, NesPlugin}};

App::new()
    .add_plugins(BunEnginePlugin::windowed("Bun Engine"))   // first
    .add_plugins(NesPlugin::new("alter_ego.nes", rom))       // one machine at build time
    .run();
```

## `BunEnginePlugin`

- `windowed(title)`: `DefaultPlugins` (window, render, input, gilrs, audio, UI) with a
  nearest-filtered `ImagePlugin`, the `EngineCamera` 2D camera, Escape to exit, `Fsr1Plugin` and
  `MachineRuntimePlugin`. `headless()`: `MinimalPlugins` with an unthrottled
  `ScheduleRunnerPlugin`; machines advance one frame per `Update`.
- Fields: `title`, `size` (physical px; `None` = twice the first machine's screen), `headless`,
  `default_plugins` (set `false` when the host already added `DefaultPlugins`), `escape_exits`,
  `low_latency` (no pipelined rendering, reactive winit updates), `present_mode`,
  `frame_latency`, `backends` (Windows default DX12; `WGPU_BACKEND` overrides), `camera`.
- Resources: `EngineInput { keys, touch }` (machine bitmask, rebuilt in `PreUpdate`), `KeyMap`
  (keyboard -> `machine::keys`, stick dead zone), `ExternalPads` (bits from other sources by name,
  e.g. `"steam"`), `EngineExit { failure }`, `EngineMode`.
- System sets `EngineSystems`: `Input` (PreUpdate), `Machine` (FixedUpdate windowed / Update
  headless), `Present` (PostUpdate).

## Machines

`machine::Machine` is unchanged and stays the core abstraction (`run_frame`, `screens`,
`set_input`, `audio`, `sample_rate`, `refresh_rate`, `console`, `diagnostic`, `save_state`,
`load_state`).

Install a machine:

- at build time: `NesPlugin::new(name, rom)`, `GbaPlugin::new(rom, bios)` (empty bios = free BIOS),
  `NdsPlugin::new(rom)`, `PsxPlugin::new(bios, disc)`, `WiiPlugin::new(dol)`,
  `GameCubePlugin::new(dol)`, `ArmPlugin::new(image)`, `CtrPlugin::new(path, image)` (`ctr`),
  `SwitchPlugin::new(path)` (`switch`), `X86Plugin::new(image)` / `LinuxPlugin::new(kernel,
  cmdline)` (Windows `x86`); `MachinePlugin::new(factory)` for anything else;
  `App::insert_machine(Box<dyn Machine>)` (`MachineAppExt`) for a built one;
- at runtime (launch, switch): `commands.queue(NesPlugin::new(..).command())` or
  `commands.queue(InsertMachine::new(factory).with_options(MachineOptions { spawn_view,
  exit_on_stop, paused }))`; `commands.queue(RemoveMachine)`; from exclusive systems
  `world.insert_machine_with(machine, options)` / `world.remove_machine()` (`MachineWorldExt`).
  Inserting replaces the running machine; its image, sprite and audio sink are recreated.

While a machine is installed (all systems gated by `resource_exists::<MachineStatus>`):

- `MachineSlot` (non-send) holds it; `run_frame` runs in `FixedUpdate` at `refresh_rate()`
  (`Time<Fixed>` follows the machine).
- `MachineStatus`: `frames`, `last` step, `paused` (suspend, menus, overlays), `frame_limit`,
  `out` (screens written on exit), `exit_on_stop`, `stopped`.
- `MachineScreen { image, size, first_height }`: every `screens()` image stacked vertically in one
  RGBA8 sRGB `Image` (nearest sampler), refreshed in `PostUpdate` after each new frame. With
  `spawn_view` a `Sprite` (`MachineView`) shows it letterboxed (`ScalingMode::AutoMin`) on the
  engine camera; UI hosts use the handle in an `ImageNode` instead. `view::capture_rgb` returns
  the RGB8 picture (screenshots).
- Touch: the left mouse button on the second screen sets `EngineInput::touch` (DS).
- Messages: `SaveState { path }` / `LoadState { path }` -> `MachineStateResult`;
  `MachineEvent::{Inserted, Failed, Removed, Shutdown}`.
- Audio (`audio`): `Machine::audio` samples go to `MachineAudioQueue` (bounded, ~60 ms) drained by
  the `MachineAudio` `Decodable` source of one `AudioPlayer` (`MachineAudioSink`).

## FSR1 (`render`)

`runtime::fsr1::Fsr1` is the raw wgpu core (EASU + RCAS + HUD; NV12 planes or an sRGB RGB texture
via a pipeline-overridable constant; sRGB or linear targets). `Fsr1Plugin` (added by
`BunEnginePlugin`) runs it from the `Fsr1Upscale { image, sharpness_stops, target }` resource:

- `target: None`: post-process of every 2D camera after Bevy's upscaling (draws over `bevy_ui`);
  `bun-engine run ... --fsr [--sharpness STOPS]`.
- `target: Some(handle)`: rendered letterboxed into that image (create it with
  `Fsr1Upscale::target_image(w, h)`), cameras untouched; show it in an `ImageNode` under menus.

## Stream (`stream`, Windows)

`stream::session::StreamPlugin::new(options, codec, feed)`, with `plugin.engine()` as the
`BunEnginePlugin` (DX12, `AutoNoVsync` or `AutoVsync` with `--vsync`, frame latency 1, no pipelined
rendering, reactive updates). Decode/receive/loopback threads start once `RenderDevice` exists, on
its adapter LUID; decoded frames wake the loop through `EventLoopProxyWrapper`. A `Core2d` system
after upscaling imports the NT-shared NV12 ring into Bevy's wgpu device, waits on the decode fence
on the queue and runs EASU (NV12 -> RGB fused) + RCAS + HUD straight into the camera output: zero
copy, no intermediate RGB texture. A `Render` cleanup system fences each presented frame for the
latency statistics. Input comes from Bevy messages (keyboard, raw mouse motion, buttons, wheel,
focus, gamepads).

## Steam (`steam`)

`steam::SteamPlugin::new(steam::RunOptions, system, rom)` wraps steamworks-rs (bevy-steamworks
0.17 targets Bevy 0.19). `runtime::steam` binds it: overlay -> `MachineStatus::paused`, Steam Input
-> `ExternalPads["steam"]`, screenshots from `MachineScreen`, Deck layout on the primary window.

## CLI

`bun-engine run <system> <image>` builds the same app (`runtime::run::machine_app`); `--fsr`,
`--sharpness`, `--frames`, `--out`, `--steam*`. `--headless` keeps the direct `run_frame` loop
(scripted `--input`, `--trace` digests) used by CI and replay. `bun-engine stream` runs
`StreamPlugin`.

## Web

`examples/bevy_web.rs` (`--target wasm32-unknown-unknown --no-default-features --features
runtime-web,nes`): the NES machine on Bevy's WebGPU backend in `<canvas id="bun-engine">`.

## Display filters and shell (`display-filter`, `shell`; both in `default`)

- `runtime::display_filter`: `DisplayFilter { kind, strength, integer_scale, cycle_key }` resource
  (kinds off, plain, scanlines, crt, lcd, sharp). A `Material2d` quad with `display_filter.wesl`
  replaces the nearest sprite while the kind is not `off`. `F2` cycles; CLI `--filter NAME
  [--integer-scale]`.
- `runtime::shell`: `ShellState` (`Home`, `Playing`, `QuickMenu`), quick menu on `F1` / gamepad
  Mode (Resume, Save state, Load state, Screenshot, Stop; pauses the machine), `F3` performance
  overlay. States and screenshots go under `ShellConfig::state_dir`.
- Audit of the Bevy capabilities not used yet: `BEVY-AUDIT.md`.

## Native home, BRP and kiosk (`home`, `remote`; phase 2)

- `runtime::home` (`home`, in `default`): `bun-engine home [--library DB|mock|mock:empty|mock:error|mock:loading]`.
  Hero with one Play, system shelf (filter), tiles, controller-hints footer; D-pad, left stick or arrows move
  `bevy_input_focus` focus through the geometric `AutoDirectionalNavigator`; Enter/South plays or selects, Backspace/East goes
  back. The focus ring is 3 px in the accent role; all colours are the M3 roles of `docs/bun-engine/design/tokens.json`
  (`runtime::theme`, embedded and parsed once). States: Loading, Ready, Empty, Error (Retry). Library: trait
  `LibrarySource` with `MockLibrary` and `SqliteLibrary` (rusqlite, the workspace pin with `bundled`, opened READ_ONLY; reads
  `$BEP_ROOT/var/lib/bep/library.db` table `games`, default `usr/var/lib/bep/library.db`). Playing writes a `HomeLaunch` message;
  starting the machine is the host's job. Not done: cover art, scrolling (the grid shows what fits, the shelf filters),
  mouse/touch picking.
- `runtime::remote` (`remote`, native only, not in `default`): `--remote[=PORT]` serves BRP on 127.0.0.1:15702 (and Bevy's render
  sub-app server on 15703). No authentication exists in BRP: loopback is the only control. Methods `bun/status`, `bun/filter`,
  `bun/pause`, `bun/menu`, `bun/capture` (composed-window PNG), `bun/home`, `bun/exit`; Bevy's reflection methods also work.
- Shell: the Screenshot action also saves the composed window PNG (`Screenshot::primary_window`); confirming a menu entry
  sends a `GamepadRumbleRequest` to every gamepad (`ShellConfig::rumble`).
- Kiosk: `--kiosk` = `--fullscreen` (BorderlessFullscreen, primary monitor) + `--hide-cursor` (`CursorOptions::visible`); also
  `--size WxH`, `--state-dir DIR`.
- Build note: the VPS filesystem was under pressure, so the verification build used rlib-only and stripped debuginfo in an
  uncommitted overlay; the committed `Cargo.toml` keeps `crate-type = ["rlib","cdylib","staticlib"]`.
