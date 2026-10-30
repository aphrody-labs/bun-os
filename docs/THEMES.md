# Themes

One token source, three themes, every app. Facts below are measured or cited; anything else is marked
**unverified** or **unknown**. Date of the checks: 2026-10-29.

## Source of truth

`packages/themes` (`@aphrody/themes`) reads three W3C design-token files and generates everything else:

| Token file (`packages/themes/tokens/`) | Theme id | Vendor source                                                     |
| -------------------------------------- | -------- | ----------------------------------------------------------------- |
| `m3-googlebook.tokens.json`            | `m3`     | material-color-utilities 0.4.0, @material/web 2.5.0, m3-tokens    |
| `fluent-win11.tokens.json`             | `fluent` | microsoft-ui-xaml @ 0a03f68d586d, Microsoft Learn, fluent2 9.2.2  |
| `apple-glass.tokens.json`              | `apple`  | Apple HIG (color, typography, materials), MacRumors iOS 27 report |

`bun packages/themes/src/build.ts` writes (and `--check` verifies):

| Output                                   | Consumer                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `generated/themes.css`                   | CSS variables `--t-*` per `data-skin`/`data-scheme`/`data-accent`, plus `.t-*` components |
| `generated/tailwind.css`                 | Tailwind v4 `@theme inline` mapping `--color-*`, `--radius-*`, fonts                       |
| `src/generated.ts`                       | TypeScript types and all palettes (`COLORS[theme][scheme][accent][slot]`)                  |
| `crates/aphrody-themes/src/generated.rs` | Rust palettes, shapes, type ramps, glass, window effects                                   |
| `generated/window-effects.json`          | Tauri window effects per theme and OS                                                      |
| `generated/resolved.json`                | Full resolved model (used by the Rust parity test)                                         |

Fluent web-component variables (`--colorBrandBackground`, ...) from `packages/fluent/tokens/fluent2.json` (owned by the
Microsoft track) are included in the Fluent theme blocks, with the brand ramp pointed at the Windows accent.

## Inventory and decision (existing theme code)

| Existing                                                       | Role now                                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/m3-tokens` (+ `crates/aphrody-m3-tokens`)            | M3 engine and static shape/motion/type owner. `@aphrody/themes` imports its type scale and checks shape and springs against it in tests; not duplicated. |
| `packages/m3-theme`, `m3-tailwind`, `m3-fonts`                 | Kept for the M3 component libraries (`--md-sys-*`); the M3 theme here also emits every `--md-sys-color-*` role.                                          |
| `packages/fluent`                                              | Fluent 2 web tokens, owned by the Microsoft track; consumed here, not copied.                                                                            |
| `packages/m3-os-themes`                                        | OS-level theme installer (Windows, GNOME, COSMIC, Chromium); separate concern.                                                                           |
| `crates/craft-ui/src/theme`                                    | egui palette adapter for the craft apps; `aphrody-themes::egui_theme` is the replacement.                                                                |
| `apps/webos/src/themes.ts` (desktop moods) and `appearance.ts` | Per-seed moods inside M3; the theme family switch is `@aphrody/themes/runtime`.                                                                          |

Nothing was deleted: consumers of the older packages are many and owned by other tracks.

## Verified facts

Run `bun packages/themes/src/verify-sources.ts` (network): it re-fetches the Apple HIG color and typography pages and
the WinUI theme resources and fails on any difference with the token files. Result on 2026-10-29: all match.

### Material 3 / Google Book OS

- Dynamic color: `SchemeTonalSpot` from `@material/material-color-utilities` 0.4.0, one scheme per accent seed; default seed
  `#6750A4` (M3 baseline). Roles mapped to the shared slots in `src/resolve.ts`.
- Shape, motion, Expressive springs and the 15+15 type styles come from `@aphrody/m3-tokens`.
- Googlebook (formerly Aluminium OS): press coverage of the 2026-09-22 launch states Material 3 Expressive, an Android
  base and a Linux kernel (PCWelt). The official page (googlebook.google, fr_FR) says nothing about UI, colors or type.
- **Unknown**: the shell's seed/accent colors, whether it uses blur or glass, its shell font, its window controls.
  This theme therefore has no glass (opaque surfaces) and M3 icon-button window controls.
- Fonts: Google Sans Flex and Roboto Flex, SIL OFL, shipped by `@aphrody/m3-fonts`.

### Windows 11 Fluent

- Surfaces, text, strokes, status colors: WinUI 3 `Common_themeresources_any.xaml` (Light and Default=dark dictionaries),
  checked by `verify-sources.ts`.
- Accent: AccentFillColorDefault is `SystemAccentColorDark1` in light and `SystemAccentColorLight2` in dark (same file).
  The default accent palette was read from `HKCU\...\Explorer\Accent\AccentPalette` on Windows 11 10.0.28120:
  `99EBFF 4CC2FF 0091F8 0078D4 0067C0 003E92 001A68`. Other accents are **derived** in HCT from the tone offsets of that
  palette (Windows' own algorithm is not published); Dark1 is capped so white text keeps >= 4.5:1. The seven non-default
  accent base colors are presets, **unverified** against a Microsoft source.
- Radii: 4px controls, 8px windows and flyouts (Microsoft Learn, Geometry). Type ramp 12/16 .. 68/92 (Learn, Typography).
- Materials: Mica for the window base, Acrylic for transient surfaces (Learn, Materials). The CSS acrylic blur (30px,
  125% saturation) is **our approximation**; Microsoft publishes no value.
- Font: Segoe UI Variable is **not redistributable** (ships with Windows 11). The stack is
  `Segoe UI Variable Text, Segoe UI Variable, Segoe UI, Selawik, system-ui`. Selawik is Microsoft's open-source,
  metrically compatible fallback; no font file is bundled by this package.

### Apple (iOS/iPadOS 27, macOS 27 "Golden Gate")

- Released 2026-09-14 (OSNews). Darwin: an iOS 27 beta 1 kernel string reads `Darwin 27.0.0` (MacRumors forum, **unverified**
  for the shipping macOS; no Apple source found).
- Liquid Glass (WWDC25, 26 generation) is refined in 27: transparency slider from ultra clear to fully tinted, darker edge,
  brighter specular highlights (MacRumors, 2026-06-10). The slider is implemented as `transparency` (0..1) in the shared selection.
- System colors: HIG Color page values (default light/dark, the iOS 26 set where blue is `#0088FF`), checked by `verify-sources.ts`.
- Text styles: HIG Typography, Large (default) iOS table and macOS built-in table, checked by `verify-sources.ts`.
- Materials guidance from the HIG: two variants (regular, clear); over bright content under clear glass add a 35% dark dim.
- **Unverified numbers**: neutral backgrounds and label colors are the commonly observed UIKit dynamic colors (the HIG names
  them without numbers). Blur radius, saturation, tint alpha, specular alpha and corner radii are **our approximations**.
- Font: SF Pro is not redistributable. Stack `-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, system-ui`; Inter
  (SIL OFL) is the open fallback; nothing bundled here.
- Traffic-light controls are in `components.css`; iOS-style switch is `.t-switch`.

## Window effects (Tauri 2.12.5)

Names are `tauri-utils::WindowEffect` (camelCase), from the `dev` branch of tauri-apps/tauri: `mica`, `acrylic`, `tabbed`,
`liquidGlassRegular`/`liquidGlassClear` (macOS 26+), `underWindowBackground` and the rest. `windowEffects.interactive`
is macOS 27+ and affects Liquid Glass only. One Liquid Glass style plus one visual-effect material may be listed so
macOS 15 and older fall back to the latter.

| Theme  | Windows   | macOS                                         | Linux and other                     |
| ------ | --------- | --------------------------------------------- | ----------------------------------- |
| m3     | none      | none                                          | none                                |
| fluent | `mica`    | none                                          | none                                |
| apple  | CSS glass | `liquidGlassRegular`, `underWindowBackground` | transparent window + CSS `.t-glass` |

`aphrody_themes::window_settings(theme, os)` returns the JSON (transparent, windowEffects, titleBarStyle).

## Delivery

- **Web**: `@import "@aphrody/themes/themes.css"`; `<html data-skin data-scheme data-accent>`; `bootScript()` in `<head>`
  prevents a flash; `createThemeController()` persists (localStorage) and follows the system scheme live.
- **Live sync**: `BroadcastChannel("aphrody-theme")` between same-origin apps, the Tauri event `aphrody://theme` between
  webview windows, and the selection file `theme.json` (see `aphrody_themes::config`) for native apps. The controller's
  `endpoint` option POSTs the selection to a server that writes the file.
- **egui**: `aphrody_themes::egui_theme::apply(ctx, &selection, system_dark, touch)`; re-apply on `config::watch`.

## Proof

- `bun test packages/themes`: generated files equal the generator output; CSS and Rust snapshots; vendor parity with
  m3-tokens; WCAG and APCA floors; runtime (attributes, auto scheme, persistence, BroadcastChannel, Tauri bridge, boot script).
- `cargo test -p aphrody-themes --features egui`: every Rust slot equals the TypeScript build (3 themes x 2 schemes x 8
  accents x 33 slots), window settings, the selection file watcher, egui Visuals.
- Screenshots: `docs/themes/` (see below).
