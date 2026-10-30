# Design tokens: COSMIC (upstream), Omarchy, and the Bun OS result

Values are copied from source, with the file they come from. "Bun OS" is what the forks now default to (aphrody-labs/libcosmic `de9353a`, cosmic-comp `8fb0fd4`, cosmic-panel `4533fdf`) and what `factory/distro/themes/aphrody/cosmic.ron` holds.

## Colour

### COSMIC upstream default dark palette (`libcosmic/cosmic-theme/src/model/dark.ron`)

| token | value | token | value |
| --- | --- | --- | --- |
| neutral_0..10 | #000000 #030303 #161616 #2E2E2E #484848 #636363 #808080 #9E9E9E #BEBEBE #DEDEDE #FFFFFF | gray_1 / gray_2 | #1B1B1B / #262626 |
| accent_blue (default accent) | #63D0DF | accent_indigo | #A1C0EB |
| accent_purple | #E79CFE | accent_pink | #FF9CB1 |
| accent_red | #FDA1A0 | accent_orange | #FFAD00 |
| accent_yellow | #F7E062 | accent_green | #92CF9C |
| accent_warm_grey | #CABAB4 | bright_red / green / orange | #FFA09A / #5EDB8C / #FFA37D |

Light palette (`light.ron`) mirrors it (accent_blue #00525A, neutral ramp inverted).

### Aphrody (Bun OS default dark), from the WebOS M3 roles (`apps/webos/src/themes.ts`)

| ThemeBuilder field | M3 role | value |
| --- | --- | --- |
| bg_color | surface | #11131D |
| primary_container_bg | surface-container | #1B1E2B |
| secondary_container_bg | surface-container-high | #232736 |
| neutral_tint | surface-variant / highest | #2C3142 |
| text_tint | on-surface | #E1E3F2 |
| accent, window_hint | primary | #A9B8FF |
| success | (Aphrody green) | #8FD694 |
| warning | (Aphrody yellow) | #F0C674 |
| destructive | error | #FFB4AB |
| (Omarchy colors.toml) tertiary / selection / muted | tertiary / primary-container / outline-variant | #7FD6C6 / #2E3F95 / #353A50 |

### Omarchy (default Tokyo Night, `themes/tokyo-night/colors.toml`, quattro)

background #1a1b26, dark #13141c, darker #0e0e14, lighter #24283b; foreground #a9b1d6, dark #565f89, light #b4bee6, bright #c0caf5; accent #7aa2f7, selection #292e42, muted #414868; red #f7768e, yellow #e0af68, green #9ece6a, cyan #449dab, blue #7aa2f7, magenta #ad8ee6. Hyprland default border gradient rgba(33ccffee) -> rgba(00ff99ee) 45deg, inactive rgba(595959aa).

All 23 Omarchy themes plus Aphrody and the Bun cream theme are generated into COSMIC RON by `factory/distro/cosmic-themes.ts` (mapping: background -> bg_color, lighter_background -> primary_container_bg, +5 % foreground -> secondary_container_bg, muted -> neutral_tint, foreground -> text_tint, accent -> accent/window_hint, green/yellow/red -> success/warning/destructive, `mode` -> Dark/Light palette).

## Typography

| | COSMIC (`libcosmic/src/config/mod.rs`, `src/widget/text.rs`) | Omarchy | Bun OS |
| --- | --- | --- | --- |
| UI face | Open Sans | system sans for apps; JetBrainsMono Nerd Font in bar/menus | Open Sans (COSMIC default) in apps and panel |
| Mono face | Noto Sans Mono | JetBrainsMono Nerd Font everywhere (terminal, waybar 12 px, walker 18 px) | JetBrainsMono Nerd Font for terminals (Rio, cosmic-term) |
| Scale | title1 35, title2 29, title3 24, title4 20, heading 14 (bold), body 14, caption_heading 12, caption 12, monotext 14 | waybar 12 px, walker 18 px, mako 14 px, swayosd 11 pt, hyprlock input 650x100 | COSMIC scale unchanged |

## Spacing (`cosmic-theme/src/model/spacing.rs`, Standard density)

none 0, xxxs 4, xxs 8, xs 12, s 16, m 24, l 32, xl 48, xxl 64, xxxl 128. Compact: 0 4 4 8 8 16 24 32 48 64. Spacious: 4 8 12 16 24 32 48 64 128 160. Bun OS keeps Standard.

## Corner radii (`corner.rs`)

| preset | xs | s | m | l | xl |
| --- | --- | --- | --- | --- | --- |
| Round (upstream default) | 4 | 8 | 16 | 32 | 160 |
| SlightlyRound | 2 | 8 | 8 | 8 | 8 |
| Square (Bun OS default, Omarchy `decoration:rounding = 0`) | 2 | 2 | 2 | 2 | 2 |

## Window geometry

| | COSMIC upstream | Omarchy (`default/hypr/looknfeel.conf`) | Bun OS |
| --- | --- | --- | --- |
| gaps (outer, inner) | (0, 8) | gaps_out 10, gaps_in 5 (10 between windows) | (10, 10) |
| active window outline | active_hint 3 px, accent | border_size 2, gradient | 2 px, accent |
| tiling | autotile off | dwindle always | autotile on (Global) |
| focus | click | follow_mouse = 1 | focus_follows_cursor on (250 ms delay) |
| workspaces | vertical, per output | horizontal 1..10, persistent 1..5 | horizontal, per output |

## Panel (`cosmic-panel-config`)

Panel size table: XS bar 24 px (icons 16), S 32 (20), M 40 (28), L 48 (32), XL 56 (48). Default top panel XS, opacity 1.0, padding 0, no radius; Dock L, radius 12, padding 4. Omarchy waybar: height 26, font 12 px, modules left menu + workspaces, centre clock, right tray/bluetooth/network/audio/cpu/battery. Bun OS: XS top bar, left app-library button + workspaces applet, centre clock, right status area, tiling, input sources, bluetooth, network, audio, battery, notifications, power; Dock not in `entries`.

## Motion

| | COSMIC (`cosmic-comp/src/shell/**`) | Omarchy (Hyprland beziers) |
| --- | --- | --- |
| window move/tile | 200 ms ease-in-out cubic | windows 3.79 ds easeOutQuint (0.23,1,0.32,1); windowsIn 4.1 popin 87 %; windowsOut 1.49 linear |
| minimize | 320 ms | n/a |
| fullscreen | 200 ms | — |
| workspace switch | 200 ms | disabled (`workspaces, 0`) |
| stack tabs | 150 ms tab, 200 ms scroll, ease-out cubic | groupbar |
| layers / fades | — | layersIn 4 easeOutQuint fade; fadeIn 1.73 almostLinear (0.5,0.5,0.75,1); fade 3.03 quick (0.15,0,0.1,1) |
| cursor magnify | 200 ms ease-in-out cubic | — |
| panel autohide | 200 ms transition, 1000 ms wait | — |

cosmic-comp timings are compile-time constants; Bun OS keeps them (no runtime knob), so the Omarchy "snappy" feel comes from tiling defaults and keyboard flow, not curves.
