# Omarchy source study (2026-10-30)

Supersedes the clean-room stance of `recon.md` / `architecture.md` (2026-10-21): the owner ordered Omarchy's real style, design and principles layered on top of Pop!_OS + full COSMIC. Omarchy is MIT (Copyright David Heinemeier Hansson); its configs and themes are reused with attribution. Applied result: [`../cosmic/integration.md`](../cosmic/integration.md); tokens and keymap side by side: [`../cosmic/tokens.md`](../cosmic/tokens.md), [`../cosmic/keybindings.md`](../cosmic/keybindings.md).

## Sources read

| ref | what |
| --- | --- |
| basecamp/omarchy v3.8.4 (8fcc9d6) | last waybar/walker/mako/swayosd/hyprlock release: `config/hypr/*.conf`, `default/hypr/{looknfeel,envs,input,windows,autostart}.conf`, `default/hypr/bindings/{tiling-v2,utilities,media,clipboard}.conf`, `default/hypr/apps/*.conf`, `config/waybar/{config.jsonc,style.css}`, `config/walker/config.toml`, `default/walker/themes/omarchy-default/{layout.xml,style.css}`, `config/elephant/*.toml`, `default/mako/core.ini`, `config/swayosd/*`, `config/hypr/{hyprlock,hypridle}.conf`, `default/themed/*.tpl`, `bin/omarchy-{menu,theme-set,theme-set-templates,launch-walker,launch-webapp,launch-or-focus}` |
| vendor/omarchy quattro (51bfd1d, 2026-10-15) | v4 layout: Hyprland Lua config (`default/hypr/*.lua`), one Quickshell process (`shell/`, plugins: bar, menu, notifications, OSD, lock, dock, clipboard, emojis, image picker, polkit, idle, night light...), `docs/theming.md` canonical `colors.toml`, 23 themes |

## Stack (3.8.4) and its COSMIC counterpart

| Omarchy piece | role | COSMIC counterpart in Bun OS |
| --- | --- | --- |
| Hyprland (dwindle, gaps 5/10, border 2, rounding 0, blur, easeOutQuint curves, workspaces 1..10) | compositor | cosmic-comp with autotile, gaps (10, 10), active hint 2, Square radii |
| waybar (26 px; menu glyph + workspaces / clock + indicators / tray, bluetooth, network, audio, cpu, battery) | bar | cosmic-panel XS top bar, same three groups, no dock |
| walker + elephant (Super+Space; prefixes `.` files, `:` symbols, `=` calc, `@` web, `$` clipboard; dmenu mode for menus) | launcher and menus | cosmic-launcher + pop-launcher (files, calc `=`, web, terminal `:`), scripts plugin for the menu |
| omarchy-menu (Apps, Learn, Trigger, Style, Setup, Install, Remove, Update, About, System) | hotkey menu tree | pop-launcher `bunos/*.sh` entries prefixed Theme / Style / Setup / Install / Update / Learn / Capture / Trigger, plus pop session scripts for System |
| mako (top-right, 420 px, 5 s, DND mode) | notifications | cosmic-notifications + applet DND |
| swayosd | volume/brightness OSD | cosmic-osd |
| hyprlock + hypridle (lock 150 s screensaver, 152 s lock) | lock and idle | cosmic-greeter lock + cosmic-idle |
| omarchy-theme-set (colors.toml -> templates for hyprland, waybar, walker, mako, swayosd, hyprlock, terminals, btop; background; restarts) | theme system | `factory/distro/cosmic-themes.ts` + `bunos-theme-set` (COSMIC RON, icons, Rio, wallpaper) |
| omarchy-launch-webapp / launch-or-focus | web apps as apps | `bunos-launch-webapp URL APP_ID` |
| Default apps on Super+Shift+letter | opinionated hotkeys | cosmic-comp Spawn bindings for Bun OS apps |

## Principles kept

Keyboard first (every action has a key, menu reachable by key), tiling by default, minimal chrome (one thin bar, no dock, no window buttons needed), one theme switch restyles everything, opinionated defaults with plain-text configs a user can edit, web apps treated as first-class apps.
