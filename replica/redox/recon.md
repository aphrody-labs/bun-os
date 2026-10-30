# Recon map: Redox OS desktop (Orbital and its apps)

Scope: the Redox OS graphical stack read from source: the Orbital display server / window manager / compositor, the orbutils launcher bar, login and viewer, orbdata assets, orbclient, and how Redox ships COSMIC apps and even cosmic-comp. Purpose: a Bun OS Redox target that looks and behaves like the Bun OS COSMIC session.
Date: 2026-10-30

## Sources

| # | repository (gitlab.redox-os.org/redox-os) | ref | read |
| --- | --- | --- | --- |
| 1 | orbital | a6132b1 (2026-09-29) | `README.md`, `src/{core,window,config,scheme,window_order}.rs`, `src/widget/shortcuts.rs`, `src/compositor/*` |
| 2 | orbutils | 77d4a56 (2026-10-04) | `launcher/src/{main,package,theme}.rs`, `orbutils/src/{orblogin,background,viewer}` |
| 3 | orbdata | 58d1140 | `usr/share/ui/orbital.toml` and decoration images, `usr/share/applications/mimeapps.list` |
| 4 | orbclient | e9573da (2026-10-25) | window/event API used by apps and Orbital |
| 5 | orbterm | 5cc7a2d | legacy terminal (`orbterm = "ignore"` in desktop config) |
| 6 | redox (build system) | 9007d0a (2026-10-30) | `config/{desktop-minimal,desktop,wayland,x11}.toml`, `recipes/cosmic/*` |

## Architecture as read

- Orbital is one process: display server (scheme `orbital:`), window manager and compositor. Clients talk to it through orbclient (SDL1/2, winit-orbital, softbuffer and iced/libcosmic have Orbital backends). No Wayland or X protocol in Orbital itself.
- Window decorations: title bar 28 px (`TITLE_HEIGHT`), title text 16 px, 8 px resize border (`BORDER_WIDTH`), images for corners/sides, close and maximize buttons (focused/unfocused PNGs). Colours from `/usr/share/ui/orbital.toml` (`background_color`, `bar_color`, `bar_highlight_color`, `text_color`, `text_highlight_color`, ARGB u32); defaults bar #1B1B1B at alpha 224, highlight #363636, text #E7E7E7.
- Session (`desktop-minimal.toml` init script `20_orbital`): `orbital orblogin launcher` on VT3: Orbital starts, orblogin asks for credentials, then the launcher bar runs.
- Launcher (orbutils `launcher`): bottom bar with a start button (`start-here` icon) opening a categorised menu built from `/usr/share/ui/apps/*` manifests and freedesktop `.desktop` entries (icons via freedesktop-icons, SVG through resvg), plus pinned apps and the running-window list; theme constants equal Orbital's defaults (`launcher/src/theme.rs`).
- Desktop config (`desktop.toml`): COSMIC Edit, COSMIC Files, COSMIC Term, cosmic-icons, pop-icon-theme, netsurf browser, installer-gui; orbterm ignored. `recipes/cosmic/` also builds cosmic-monitor, cosmic-reader, cosmic-settings, cosmic-store (`--features desktop,pkgar`, the pkgar backend is Redox's package format) and cosmic-text. Each recipe installs an Orbital app manifest (`/usr/share/ui/apps/20_cosmic-files`: name, binary, icon, author, description) and the upstream `.desktop` + metainfo.
- Wayland experiment (`wayland.toml`): Redox runs `orbital orbital-wayland`, a script that starts cosmic-comp with `COSMIC_BACKEND=winit` inside Orbital, plus cosmic-app-library, libcosmic-wayland, iced-wayland, mesa, smallvil. This is the same nested-winit technique Bun OS uses for the streamed COSMIC session.
- Default file associations (orbdata `mimeapps.list`): text types -> com.system76.CosmicEdit.desktop, the same list as COSMIC.

## Screens and surfaces

| ID | surface | how to reach | purpose | process | states |
| --- | --- | --- | --- | --- | --- |
| R01 | Login | boot | user + password | orblogin | idle, wrong password |
| R02 | Desktop | after login | background image (`/usr/share/ui/background.jpg`) | orbutils background / Orbital | — |
| R03 | Launcher bar | always, bottom | start menu, pinned apps, running windows | launcher | idle, hover highlight, menu open |
| R04 | Start menu / chooser | start button | categorised app list with icons | launcher | category view, app list |
| R05 | Window | any app | Orbital decorations, move, resize, maximize, close | Orbital | focused, unfocused, maximized, tiled half/quarter |
| R06 | Shortcuts overlay | hold Super | lists all Orbital shortcuts | Orbital `widget/shortcuts.rs` | shown while Super held |
| R07 | Files / Edit / Term / Store / Settings / Monitor / Reader | launcher | COSMIC apps on Orbital (libcosmic Orbital backend) | cosmic-* | as on COSMIC, without Wayland-only features |
| R08 | Image viewer | open an image | view | orbutils viewer | — |
| R09 | Browser | launcher | web | netsurf | — |
| R10 | Installer | launcher | install Redox | installer-gui | — |

## Keyboard (Orbital `src/widget/shortcuts.rs`)

Super+Q quit window · Super+Tab cycle windows · Super+{ / } / \ volume down/up/mute · Super+Shift+arrows tile left/right/top/bottom · Super+arrows move window · Super+C/X/V clipboard · Super+M or Super+Enter toggle maximize · Super+Numpad0 mouse keys · Super+F10 damage borders · Super+F12 FPS counter. Hold Super to see the list.

Bun OS mapping: Super+Q close and Super+Tab are already compatible with the Bun OS COSMIC keymap; Super+Enter differs (maximize on Orbital, terminal on Bun OS COSMIC). Changing Orbital's map needs an Orbital patch (`core.rs` key handling), to be done in an aphrody-labs fork when the Redox target is scheduled.

## Flows

```
RF1 Boot -> desktop: init 20_orbital -> orbital -> orblogin -> launcher bar
RF2 Launch: start button -> category -> app (or pinned icon)
RF3 Arrange: Super+Shift+Left/Right halves, Super+M maximize, Super+Tab cycle
RF4 COSMIC on Redox (experimental): orbital-wayland -> cosmic-comp (winit) inside an Orbital window -> COSMIC shell pieces
```

## Bun OS deliverable

`factory/desktop/redox/usr/share/ui/orbital.toml`: Orbital colours set to Aphrody (background #0C0E17, bar #11131D at 224 alpha, highlight #2E3F95, text #E1E3F2, highlight text #A9B8FF). The COSMIC apps on Redox pick up Aphrody automatically once built against the aphrody-labs/libcosmic fork (built-in dark theme). The launcher bar's colours are compile-time constants (`launcher/src/theme.rs`), so matching them needs an orbutils fork patch.

## Out of scope

Redox kernel, relibc and drivers (system layers, not UI); Redox branding and artwork.
