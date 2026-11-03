# Themes

Bun OS has one theme: Material 3 (Expressive), generated from one seed by one engine. The normative rules are in
[DESIGN-SYSTEM.md](DESIGN-SYSTEM.md); this page only shows where each stack gets its colours, shape, type and motion.
There is no second palette, no W3C token JSON and no per-vendor theme family.

## Chain

| Step                | Owner                                                                                                                | Output                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine              | `crates/aphrody-m3-tokens`                                                                                           | HCT/CAM16, tonal palettes, scheme variants, contrast levels, shape, type, motion, materials, density, focus, `ThemeExport` and every sheet |
| Browser runtime     | `crates/libm3-wasm` through `@aphrody/m3-tokens/wasm`                                                                | dynamic colour from a seed at runtime                                                                                                      |
| Bun build time      | `@aphrody/bun` `m3Css` / `ThemeExport` FFI                                                                           | sheets and generated per-stack files                                                                                                       |
| Web sheets          | `packages/m3-tokens`, `packages/m3-theme`                                                                            | `--md-ref-*`, `--md-sys-*`, `--md-ext-*`, `--md-comp-*`; Tailwind v4 and SpaceUI mappings                                                  |
| Components          | `crates/aphrody-m3`, `packages/m3-react`, `packages/m3-baseui`                                                       | components bound to sys tokens only                                                                                                        |
| Native adapters     | `crates/libm3` (iced/libcosmic, Bevy), `crates/craft-ui/src/theme` (egui), `aphrody_identity::terminal_theme` (ANSI) | per-toolkit themes from the same roles                                                                                                     |
| OS and app emitters | `packages/m3-os-themes`                                                                                              | Flutter, Compose, COSMIC `.ron`, GTK, Windows, Hyprland, Rio, nushell, fed by `ThemeExport`                                                |
| WinUI 3             | `packages/fluent`                                                                                                    | `FluentTokens.xaml`, a Windows-native Fluent skin whose brand ramp is the M3 primary tonal palette                                         |
| Tauri windows       | `packages/tauri-themes-bridge` (`@aphrody/tauri-theme`)                                                              | native window effects and shape presets only                                                                                               |

The product seed is `aphrody_identity::design::pet_seed_hex()` unless the OS chrome follows the wallpaper seed. Dark and
light are generated from the same seed; contrast follows the user setting and `prefers-contrast`.

## Skins (Tauri window behaviour)

A skin never changes a colour. `@aphrody/tauri-theme` sets `<html data-skin="m3|fluent|apple">`, picks the native window
material from `src/window-effects.json` and applies a shape preset on the M3 corner scale:

| Skin           | Windows | macOS                                         | Linux and other | Corners                                |
| -------------- | ------- | --------------------------------------------- | --------------- | -------------------------------------- |
| `m3` (default) | opaque  | opaque                                        | opaque          | generated M3 scale                     |
| `fluent`       | `mica`  | opaque                                        | opaque          | 4px controls, 8px overlays and windows |
| `apple`        | opaque  | `liquidGlassRegular`, `underWindowBackground` | opaque          | one step up the M3 Expressive scale    |

Effect names are `tauri-utils::WindowEffect` values of the pinned tauri 3.0.0-alpha line. Under
`prefers-reduced-transparency: reduce`, `prefers-contrast: more` or `forced-colors: active` every skin falls back to an
opaque window, as DESIGN-SYSTEM.md requires for materials. The skin is chosen by `?skin=`, then localStorage `aphrody-skin`, then the platform.

## Proof

- `bun test packages/tauri-themes-bridge`: effect table, shape presets on the M3 scale, opaque fallback, skin selection.
- `cargo test -p aphrody-m3-tokens`: scheme, contrast floors and sheet emission.
