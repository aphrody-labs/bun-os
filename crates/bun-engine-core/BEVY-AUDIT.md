# Bevy 0.20 audit for Bun Engine

Scope: what Bevy 0.20 (crates.io `bevy` 0.20.1, wgpu 30) offers that `crates/bun-engine-core`
does not use yet. Each claim cites the Bevy source. Ratings are value / effort / risk
(H high, M medium, L low) against Bun Engine's needs: a console-grade home and quick menu, display
filters that work on native and web, controller handling and CI captures.

## What the engine uses today

`Cargo.toml` selects Bevy with `default-features = false` and a hand-picked list: `bevy_log`,
`bevy_asset`, `bevy_winit`, `bevy_window`, `bevy_render`, `bevy_core_pipeline`, `bevy_camera`,
`bevy_image`, `bevy_sprite(_render)`, `bevy_ui(_render)`, `bevy_text`, `default_font`, keyboard,
mouse, plus `bevy_audio` and `bevy_gilrs`/`gamepad`. Not enabled: `bevy_state`, `bevy_input_focus`,
`bevy_picking`, `bevy_ui_widgets`, `bevy_dev_tools`, `bevy_remote`, `bevy_post_process`,
`bevy_animation`, `file_watcher`, `asset_processor`, `bevy_clipboard`, `bevy_settings`. The
`default` profile of the `bevy` crate manifest (`2d`, `3d`, `ui`, `audio`) pulls most of these; the
engine opts out of all of them, so every item below is a deliberate opt-in.

## Findings

| # | Capability (source) | Fit for Bun Engine | Value | Effort | Risk |
|---|---|---|---|---|---|
| 1 | Custom `Material2d` + WESL shader (`bevy_sprite_render/src/mesh2d/material.rs`, `examples/shader/shader_material_2d.rs`): display filters over `MachineScreen`, portable to WebGPU. **Done**, `runtime::display_filter` | scanlines, CRT, LCD, sharp bilinear, integer scale | H | M | L |
| 2 | `bevy_state` (`bevy_state/src/state/`, `OnEnter/OnExit`, `DespawnOnExit`) for Home / Playing / QuickMenu. **Done**, `runtime::shell` | pause on menu, per-screen UI lifetime | H | L | L |
| 3 | `bevy_input_focus` directional navigation (`directional_navigation.rs`: `DirectionalNavigationMap`, `AutoDirectionalNavigation`, `AutoNavigationConfig`; `tab_navigation.rs`; `InputFocus`, `InputFocusVisible` in `lib.rs`) | D-pad focus for the native home grid, shelves and dialogs; geometric auto edges remove hand-wired maps | H | M | L |
| 4 | `bevy_ui_widgets` (`button.rs`, `list.rs` listbox with `ActiveDescendant`, `tabs.rs`, `dialog.rs`, `modal.rs`, `menu.rs`, `popover.rs`, `scrollarea.rs`, `slider.rs`) and `bevy_feathers` (themed widgets) | headless widgets give Activate events, a11y nodes and keyboard behaviour; Feathers carries its own look, so use `ui_widgets` and skin with M3 roles | H | M | M (widgets are new, API churn) |
| 5 | `bevy_picking` + `ui_picking` (`bevy/Cargo.toml` `picking`, `bevy_input_focus/pointer_focus.rs`) | mouse/touch hover and click on tiles, free with widgets | M | L | L |
| 6 | `bevy_ui_render` `UiMaterial` (`ui_material.rs`, `ui_material_pipeline.rs`), gradients (`gradient.rs`), box shadows (`box_shadow.rs`) | hero gradients, card elevation, rounded cover art without images | M | L | L |
| 7 | `bevy_dev_tools` (`fps_overlay.rs` `FpsOverlayPlugin` with frame-time graph, `diagnostics_overlay.rs`, `picking_debug.rs`, `easy_screenshot.rs`, `ci_testing/`) | ready perf overlay, but it pulls the whole dev-tools crate and its render debug pass; the shell uses `FrameTimeDiagnosticsPlugin` (`bevy_diagnostic`, always built) with a 1-line `bevy_ui` text instead | M | L | M (build cost, release-binary bloat) |
| 8 | `Screenshot` (`bevy_render/src/view/window/screenshot.rs`: `Screenshot::primary_window()`, `save_to_disk`) and `gpu_readback.rs` | captures of the composed window (UI + filter), for CI evidence; the machine-only capture already exists (`view::capture_rgb`) | M | L | L |
| 9 | Headless GPU render (`RenderCreation`, `WinitPlugin` disabled, render-to-`Image` target) | CI frame hashes of the filtered UI without a window; needs a Vulkan/lavapipe adapter on the VPS | M | M | M |
| 10 | `bevy_gilrs` rumble (`bevy_gilrs/src/rumble.rs`, `GamepadRumbleRequest::{Add, Stop}` in `bevy_input/src/gamepad.rs`) and hot-plug (`gilrs_system.rs` emits `Connected`/`Disconnected` per frame) | rumble on menu confirm and for cores exposing it; hot-plug already works, only the HUD "controller connected" toast is missing | M | L | L |
| 11 | `bevy_audio` (`PlaybackSettings`, `spatial`, `SpatialScale`, volume, `AudioPlayer`) | UI move/confirm sounds on a second sink next to `MachineAudio`; spatial is irrelevant for 2D UI | M | L | L (needs original sounds: no copied material) |
| 12 | `bevy_asset` hot reload (`file_watcher`, `embedded_watcher` in `bevy_asset/Cargo.toml`) and `asset_processor` | live-edit themes and shaders in dev; processor could precompute cover thumbnails | M | L | L (dev only; never in release) |
| 13 | `bevy_animation` (`animatable.rs`, `animation_curves.rs`, `transition.rs`, `animated_field!`) | curves for focus/scale transitions on tiles; heavy for UI-only tweens, a hand-rolled easing system is lighter | L | M | M |
| 14 | `bevy_remote` (BRP; `RemotePlugin`, default `http` feature, JSON-RPC `world.query`, `world.mutate_components`, `world.insert_resources`) | external control from `bun`: set `DisplayFilter`, `MachineStatus::paused`, read frame counters; HTTP server is native only, wasm needs another transport | H | M | M (open port: loopback only, token) |
| 15 | `bevy_post_process` `effect_stack` (`ChromaticAberration`, `Vignette`, `LensDistortion`; also bloom) | per-camera post effects as an alternative CRT building block; camera-bound, so it would also hit the UI; the machine-quad material is more precise | L | L | M |
| 16 | Multi-window (`Window` entities, `Screenshot::window`, camera `RenderTarget::Window`) | DS dual screens in two windows or a second window for the stream HUD; `MachineScreen` stacks both screens in one image today | M | H | M |
| 17 | `bevy_winit` window control (`WindowMode` in `bevy_window/src/window.rs`, `CursorOptions::visible`, `WinitSettings` reactive modes) | kiosk/gamescope: fullscreen borderless, hide the cursor during play, reactive redraw on the Home screen. Only the stream path sets `WinitSettings` today | M | L | L |
| 18 | Wayland/gamescope: `wayland` and `x11` features are on in `window`; `bevy_winit` forwards `winit/wayland` (+ CSD adwaita) | works as-is; the missing piece is a documented session recipe (WAYLAND_DISPLAY under gamescope, `WGPU_BACKEND=vulkan`) and a check that `present_mode` plus frame latency do not stutter nested | M | L | M (nested compositor behaviour is untested here) |
| 19 | `bevy_settings` / `bevy_world_serialization` | persist the filter, volume and last profile as a resource file | L | L | L |
| 20 | `bevy_a11y` / AccessKit (widgets create `AccessibilityNode`) | screen-reader names for the home; arrives with `ui_widgets` | L | L | L |

## Recommended order

1. Items 1 and 2 (implemented this session; compile-checked, see the report).
2. Item 3 + 4 + 6 + 5: the native home (tiles, hero Play, system shelf, hints) on `ui_widgets`
   with `AutoDirectionalNavigation`, 3 px accent focus ring, M3 role colours. Gate it behind
   `home`; read the library through a small trait first, the SQLite owner second.
3. Item 14 (BRP loopback) so `bun` and CI can drive the filter, menu and captures.
4. Items 8, 10, 17: screenshot of the composed window, rumble on confirm, kiosk cursor and
   fullscreen flags on the CLI.
5. Items 11, 12 when original UI sounds and themes exist.

## Caveats

- Everything above was read in the published `bevy` 0.20 sources; only items 1 and 2 were compiled.
- The filter shader is validated by wgpu/naga when the pipeline is first built, i.e. at runtime
  on a machine with a GPU adapter.

## Status after phase 2 (verified on the VPS: Xvfb, lavapipe software Vulkan, no GPU)

| # | Status | Evidence |
|---|---|---|
| 1 | Done, run | WESL `display_filter` builds a real pipeline; six filters and integer scale captured (`docs/bun-engine/screens/machine-*.png`). No shader fix was needed. |
| 2 | Done, run | F1 opens the quick menu (state QuickMenu, machine paused, frame counter frozen), pause via BRP freezes frames, F2 cycles, Screenshot action writes PPM + window PNG. |
| 3 | Partly | Focus + directional navigation (`AutoDirectionalNavigator`), 3 px accent ring, hints, hero/shelf/tiles, Loading/Empty/Error/Ready: done and run with real key events and a real `library.db`. Not done: `ui_widgets` (plain Nodes), cover art, scrolling, gamepad input is untested (no device; same code path as keys via `HomeCommand`). |
| 5, 6 | Not done | picking, UiMaterial/gradients |
| 8 | Done, run | composed-window `Screenshot` over BRP and from the menu. |
| 10 | Implemented, not verified | rumble request sent on confirm; no gamepad on the VPS. |
| 14 | Done, run | BRP loopback with `bun/*` methods; no token (BRP has none). |
| 17 | Partly | flags set `BorderlessFullscreen` and `cursor_visible=false` (read back over BRP). Under Xvfb without a window manager the window stayed at its requested size, so real fullscreen is not verified; reactive Home redraw not done. |
| 4, 7, 9, 11-13, 15, 16, 18-20 | Not done | unchanged |
