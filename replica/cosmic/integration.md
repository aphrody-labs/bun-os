# Integration spec: the Bun OS desktop session (Pop!_OS base, full COSMIC, Omarchy principles)

Owner direction 2026-10-30 (final): the base is Pop!_OS with the full COSMIC desktop; Omarchy's style, design and principles are layered on top (keyboard-first tiling, Omarchy keymap, thin bar and no dock, Omarchy theme system, opinionated default apps and hotkey menus, Omarchy geometry). COSMIC, Rio and the other upstream projects are patched forks built by the Bun OS factory, not installed distro packages, so the defaults live in the forks.

## 1. Session composition

| layer | Bun OS choice | source of truth |
| --- | --- | --- |
| Base system | Pop!_OS 24.04 userland (apt.pop-os.org repos for non-forked packages), Bun OS kernel/runtime per the root factory | `container/cosmic-packages.json`, `factory/` |
| Compositor | cosmic-comp, Bun OS fork | aphrody-labs/cosmic-comp `8fb0fd4` via `vendor/cosmic-epoch` |
| Session | cosmic-session (`start-cosmic`), XDG_CURRENT_DESKTOP=COSMIC | aphrody-labs/cosmic-session |
| Bar | cosmic-panel, one top "Panel", no Dock | aphrody-labs/cosmic-panel `4533fdf` |
| Launcher / menu | cosmic-launcher + pop-launcher, Bun OS script entries | `factory/desktop/cosmic-session/rootfs/usr/lib/pop-launcher/scripts/bunos/` |
| App library, overview, notifications, OSD, wallpaper, idle, greeter, settings daemon | COSMIC components unchanged | aphrody-labs forks |
| Shortcut defaults and system actions | cosmic-comp `data/keybindings.ron` (Omarchy keymap), cosmic-settings-daemon `data/system_actions.ron` (Terminal = rio) | forks `8fb0fd4`, `af9f503` |
| Theme default | Aphrody = `ThemeBuilder::dark()` / `Theme::dark_default()`; Omarchy geometry in `ThemeBuilder::default()` | aphrody-labs/libcosmic `de9353a` |
| Theme set | 25 COSMIC themes generated from the Omarchy themes + Aphrody + Bun | `factory/distro/cosmic-themes.ts` -> `rootfs/usr/share/bunos/themes/` |
| Terminal | Rio (fork), COSMIC Terminal second | Super+Return / Super+Alt+Return |
| Apps | COSMIC Files, Edit, Term, Store, Player, Settings, Screenshot; Rio; Spacedrive; Craft apps (Wordcraft and siblings); Aphrody Chat and Search; RetroArch and the emulators of `factory/images/bunos-gaming/emulation.packages`; browser (Chromium family) | see section 4 |

All fork pointers: `vendor/cosmic-epoch` -> aphrody-labs/cosmic-epoch `a19510c` (cosmic-comp, cosmic-panel, cosmic-settings-daemon, libcosmic bumped). Every COSMIC app that links libcosmic must be rebuilt against the fork to get the Aphrody default.

## 2. Two targets

### 2a. Native image (installed Bun OS)

1. Build the COSMIC forks on the VPS factory (four compiler jobs per lane), install into the image rootfs with each project's `just install` (this places `keybindings.ron` as `/usr/share/cosmic/com.system76.CosmicSettings.Shortcuts/v1/defaults`, `system_actions.ron`, the panel default schema under `/usr/share/cosmic/`).
2. Stage cosmic-config system defaults: `bun factory/distro/cli.ts cosmic install --out <root>/usr/share/cosmic` (AppList favorites, Mode is_dark).
3. Copy `factory/desktop/cosmic-session/rootfs/` into the image root (theme set, `bunos-theme-set`, `bunos-launch-webapp`, launcher scripts, Aphrody Chat/Search desktop entries). Make the scripts executable (mode is in Git).
4. Theme wallpapers: `bun factory/distro/cosmic-themes.ts --themes vendor/omarchy/themes --themes factory/distro/themes --out <root>/usr/share/bunos/themes --backgrounds` (regenerates the committed text files identically and adds the Omarchy backgrounds).
5. Default session: `cosmic.desktop` (cosmic-session) in `/usr/share/wayland-sessions`, greeter cosmic-greeter on greetd.
6. Fonts and icons: install JetBrainsMono Nerd Font (terminal), Yaru icon variants named by the Omarchy themes (`theme.json` `icons`), cosmic-icons as the default.

### 2b. Streamed session (aphrody.com, VPS without GPU)

cosmic-comp backends are kms, x11 and winit only (`src/backend/mod.rs`); there is no headless backend. Decision: nest it.

- Host: `cage` (wlroots kiosk) on `WLR_BACKENDS=headless`, `WLR_RENDERER=pixman`; cage shows cosmic-comp's winit window full screen and exposes wlr-screencopy and virtual input to the streamer (wayvnc or the WebOS capture).
- Guest: `COSMIC_BACKEND=winit start-cosmic`; Mesa llvmpipe (`LIBGL_ALWAYS_SOFTWARE=1`) for cosmic-comp's EGL on the Wayland host; when the render-node query fails cosmic-comp logs and continues (`init_egl_client_side`).
- Resize: `wlr-randr --output HEADLESS-1 --custom-mode WxH` on cage's socket; cosmic-comp's winit output follows the window size.
- Files: `factory/desktop/cosmic-session/headless/start-cosmic-headless` (install as `/usr/libexec/bunos/start-cosmic-headless`) and `bunos-cosmic-headless.service` (systemd user unit, conflicts with the old `aphrody-hyprland.service`).
- The COSMIC binaries on the VPS come from the same fork builds (factory output), not Ubuntu packages.
- Keys: the browser client must forward Super; cage passes all keys to the nested compositor.

## 3. Omarchy principles mapped onto COSMIC

| Omarchy principle | COSMIC mechanism | where |
| --- | --- | --- |
| Tiling by default | `autotile: true` (Global) | cosmic-comp-config `Default` |
| Super+Return / Space / W / T / F / J / L / O / G, 1..0, Tab | `keybindings.ron` | cosmic-comp fork, map in [`keybindings.md`](keybindings.md) |
| Focus follows mouse | `focus_follows_cursor: true` | cosmic-comp-config `Default` |
| Thin bar, menu + workspaces left, clock centre, status right; no dock | panel default schema + container default | cosmic-panel fork |
| Omarchy menu (walker dmenu) | cosmic-launcher + pop-launcher scripts plugin entries (`Theme:`, `Style:`, `Setup:`, `Install:`, `Update:`, `Learn:`, `Capture:`, `Trigger:`) and pop session scripts (Lock, Log Out, Suspend, Restart, Shut Down, BIOS) | `rootfs/usr/lib/pop-launcher/scripts/bunos/` |
| Theme system (one colors.toml -> every app) | one COSMIC ThemeBuilder per theme + Rio theme + icon theme + wallpaper set; `bunos-theme-set` | generator + switcher |
| Sharp corners, gaps 10, border 2 | `CornerRadii::from(Roundness::Square)`, `gaps: (10, 10)`, `active_hint: 2` | libcosmic `ThemeBuilder::default` |
| Opinionated apps on hotkeys | Spawn actions in `keybindings.ron` | cosmic-comp fork |
| Animations off for workspaces | not configurable in cosmic-comp (200 ms constants) | kept upstream |
| Scratchpad, universal copy/paste | no cosmic-comp action | not provided (features.csv "could") |

## 4. Default apps

| role | app | launch |
| --- | --- | --- |
| Terminal | Rio | Super+Return (system action Terminal) |
| Terminal (COSMIC) | cosmic-term | Super+Alt+Return |
| Files | cosmic-files (also file chooser via xdg-desktop-portal-cosmic) | Super+Shift+F (HomeFolder) |
| Second file manager / sync | Spacedrive | Super+Shift+D |
| Editor | cosmic-edit | Super+Shift+N; `cosmic-mimeapps.list` text types |
| Documents | Wordcraft (ai.storyteller.wordcraft) and the Craft family | Super+Shift+W |
| Chat / Search | Aphrody Chat, Aphrody Search (`bunos-launch-webapp`, app ids com.aphrody.Chat / com.aphrody.Search) | Super+Shift+A, Super+Shift+/ |
| Store | cosmic-store on Bun OS repositories (packagekit / flatpak backends) | Super+Shift+I |
| Games | RetroArch + emulators | Super+Shift+G |
| Browser | system default (xdg) | Super+Shift+Return / B |
| Video | cosmic-player | files |
| Settings | cosmic-settings | Super+I |
| Monitor | btop in Rio | Super+Ctrl+T |

## 5. Delivered files

| path | content |
| --- | --- |
| aphrody-labs/cosmic-comp `8fb0fd4` | Omarchy keymap (`data/keybindings.ron`), autotile, focus follows cursor, horizontal workspaces |
| aphrody-labs/cosmic-panel `4533fdf` | Omarchy-style default panel, no Dock entry |
| aphrody-labs/cosmic-settings-daemon `af9f503` | Terminal system action = rio |
| aphrody-labs/libcosmic `de9353a` | Aphrody built-in dark theme; Omarchy geometry |
| aphrody-labs/cosmic-epoch `a19510c` | pointers to the four commits above |
| `factory/distro/cosmic-themes.ts` | Omarchy theme -> COSMIC RON + Rio theme + theme.json generator |
| `factory/distro/themes/aphrody/{colors.toml,cosmic.ron}` | Aphrody in Omarchy format and as COSMIC RON |
| `factory/distro/cosmic/defaults/com.system76.CosmicAppList/v1/favorites` | Bun OS favorites (used if the dock is re-added) |
| `factory/desktop/cosmic-session/rootfs/usr/share/bunos/themes/*` | 25 themes: cosmic.ron, rio.toml, theme.json, index.json |
| `factory/desktop/cosmic-session/rootfs/usr/bin/bunos-theme-set` | theme switcher |
| `factory/desktop/cosmic-session/rootfs/usr/bin/bunos-launch-webapp` | web app launcher with own app_id |
| `factory/desktop/cosmic-session/rootfs/usr/lib/pop-launcher/scripts/bunos/*.sh` | Omarchy menu entries (38) |
| `factory/desktop/cosmic-session/rootfs/usr/share/applications/com.aphrody.{Chat,Search}.desktop` | app entries |
| `factory/desktop/cosmic-session/headless/{start-cosmic-headless,bunos-cosmic-headless.service}` | streamed session |
| `factory/desktop/redox/usr/share/ui/orbital.toml` | Aphrody palette for Redox Orbital |

Verification done: the Aphrody RON parses as a ThemeBuilder with the patched libcosmic, builds, writes v2 config entries and equals `ThemeBuilder::dark()` up to f32 rounding; `Theme::dark_default()` yields accent #A9B8FF, radius 2, gaps (10, 10); all 122 keybindings parse with cosmic-settings-config; cosmic-comp-config, cosmic-panel-config and libcosmic cosmic-theme compile. Not yet done: full fork builds, image boot, streamed session qualification.

## Appendix: COSMIC shell on Hyprland (studied before the direction change)

Read from code: cosmic-app-list (dock) calls `ToplevelManagerState::new` which unwraps `zcosmic_toplevel_manager_v1` and panics on Hyprland; cosmic-workspaces needs `zcosmic_toplevel_info` to place windows on workspaces; cosmic-panel binds its COSMIC protocols optionally and the workspaces applet works over `ext-workspace-v1` (Hyprland 0.56 exposes it); cosmic-launcher and cosmic-app-library are layer-shell clients and run anywhere. COSMIC apps (xdg-shell) run on any compositor. This is why the full COSMIC session (cosmic-comp) was retained instead of a mixed Hyprland shell.
