# Recon map: COSMIC desktop (Pop!_OS), configured the Omarchy way

Scope: the full COSMIC desktop as shipped by Pop!_OS (cosmic-comp, cosmic-session, panel and applets, launcher, app library, workspaces overview, notifications, OSD, greeter, settings, settings daemon, files, terminal, text editor, store, player, screenshot) studied from its source, and the Omarchy principles layered on top of it for Bun OS. Omarchy itself is studied in [`../omarchy/`](../omarchy/); Redox Orbital in [`../redox/`](../redox/); System76 projects in [`../system76/`](../system76/). Integration decisions: [`integration.md`](integration.md).
For: the Bun OS desktop session (native image and the streamed VPS session behind aphrody.com).
Date: 2026-10-30

## Sources

All read as code, not marketing. Upstream heads shallow-cloned on the VPS (`~/.cache/replica-src`), forks are `aphrody-labs/*` pinned by `vendor/cosmic-epoch`.

| # | source | ref | what was read |
| --- | --- | --- | --- |
| 1 | pop-os/cosmic-comp | 9b4296b (2026-10-30); fork 4d14528 | `data/keybindings.ron`, `src/backend/mod.rs` (kms/x11/winit only), `src/shell/**` animation constants, `cosmic-comp-config/src/{lib,workspace}.rs` |
| 2 | pop-os/cosmic-panel | ca20ce3; fork 3ce6ce1 | `cosmic-panel-config/src/{panel_config,container_config}.rs`, `data/default_schema/**`, client protocol binds |
| 3 | pop-os/cosmic-applets | 582281f | applet ids, `cosmic-app-list/src/wayland_handler.rs`, `cosmic-applet-workspaces/src/wayland.rs` |
| 4 | pop-os/cosmic-launcher, cosmic-app-library | 528f7a5, e4c3d73 | layer-shell surfaces, overlap notify, pop-launcher service |
| 5 | pop-os/launcher (pop-launcher) | master | `plugins/src/scripts/mod.rs` (script plugin: name/icon/description/keywords headers), `scripts/session/*` |
| 6 | pop-os/cosmic-workspaces-epoch | cb953ea | wayland backend (toplevel info/management, ext-workspace, image capture) |
| 7 | pop-os/cosmic-notifications, cosmic-osd, cosmic-bg, cosmic-greeter, cosmic-idle | master | daemons, polkit agent, `cosmic-bg/config` (Entry, Source, ScalingMode) |
| 8 | pop-os/cosmic-session | 4b0a0a2 | `data/start-cosmic`, component spawn list, XDG autostart support, `data/cosmic-mimeapps.list` |
| 9 | pop-os/cosmic-settings | d678586 | `cosmic-settings/src/main.rs` page commands (`cosmic-settings <page>`), appearance import/export, page tree |
| 10 | pop-os/cosmic-settings-daemon | 655b14f; fork 9e4ae69 | `config/src/shortcuts/{mod,action,binding}.rs`, `data/system_actions.ron` |
| 11 | pop-os/libcosmic | 95236a9; fork dbc62f2 | `cosmic-theme/src/model/{theme,corner,spacing,dark.ron,light.ron,color}.rs`, `src/config/mod.rs` (CosmicTk, fonts), `src/widget/text.rs` (type scale), `src/theme/mod.rs` |
| 12 | pop-os/cosmic-files, cosmic-edit, cosmic-term, cosmic-store, cosmic-player, cosmic-screenshot | master / vendor | APP_IDs, `key_bind.rs`, nav pages, store backends (flatpak, packagekit, pkgar, rpm-ostree), CLI |
| 13 | pop-os/cosmic-protocols | c0cff4d | client-toolkit `toplevel_info`, `toplevel_management`, `workspace` (which globals are optional) |
| 14 | Bun OS repo | main | `factory/distro/cosmic.ts` (cosmic-config resolver, system defaults), `factory/distro/theme.ts`, `packages/m3-os-themes/src/cosmic.ts`, `apps/webos/src/themes.ts` (Aphrody M3 roles) |

## Core loop

Log in (cosmic-greeter or the browser session picker) -> cosmic-session starts cosmic-comp and the shell -> press Super+Space and type to launch, Super+1..0 to change workspace, windows tile automatically -> switch the theme from the launcher (`Theme: …`) and every surface follows.

## Screens and surfaces

| ID | surface | how to reach | purpose | component / process | states |
| --- | --- | --- | --- | --- | --- |
| S01 | Greeter (login) | boot, log out | pick user, password, session, power | cosmic-greeter (greetd greeter on its own cosmic-comp) | idle, typing, wrong password (shake), caps lock hint, multiple users, session menu, power menu |
| S02 | Lock screen | Super+Ctrl+L, idle, lid | unlock the current session | cosmic-greeter lock mode via ext-session-lock (cosmic-idle triggers) | locked, typing, failed, battery/network status |
| S03 | Top panel | always | menu button, workspaces, clock, tray, quick settings | cosmic-panel (layer-shell) hosting applets | normal, popup open, autohide (off by default), overlap/frosted |
| S04 | Panel applet popups | click an applet | audio, network, bluetooth, battery/power profile, notifications centre, power/session, input sources, tiling | cosmic-applet-* (one process each) | closed, open, empty (no devices), error |
| S05 | Dock | Bun OS: not in default entries | pinned/running apps | cosmic-panel "Dock" + cosmic-app-list | removed by default (Omarchy: no dock); Settings > Desktop > Dock re-adds it |
| S06 | Launcher | Super+Space, Super alone, Super+Alt+Space | search apps, windows, files, calculator, web, shell, session actions, Bun OS menu scripts | cosmic-launcher (layer-shell) + pop-launcher service and plugins | empty, typing, results, no results, Alt+Tab mode (window switcher) |
| S07 | App library | Super+A, panel menu button | grid of all apps, folders/groups, search | cosmic-app-library (layer-shell) | all apps, group view, edit groups, search, drag to dock |
| S08 | Workspaces overview | Super+` (grave), XF86LaunchA | live thumbnails of workspaces and windows, drag to move | cosmic-workspaces | open, dragging, multi-output |
| S09 | Window switcher | Alt+Tab | cycle windows | cosmic-launcher `alt-tab` | open, cycling |
| S10 | Notifications | events | toast top-centre, notification centre in the applet | cosmic-notifications + notifications applet | toast, grouped, do-not-disturb, action buttons, critical persistent |
| S11 | OSD | volume/brightness keys, display toggle | transient level indicator, polkit auth dialog, logout/shutdown confirm | cosmic-osd | volume, brightness, airplane, polkit prompt, power dialog countdown |
| S12 | Wallpaper | always | background per output or all | cosmic-bg | image, slideshow (rotation_frequency), colour/gradient |
| S13 | Settings | Super+I, applet links, `cosmic-settings <page>` | system configuration | cosmic-settings | sections below |
| S14 | Files | Super+Shift+F | file manager | cosmic-files (also the file chooser via xdg-desktop-portal-cosmic, `com.system76.CosmicFilesDialog`) | grid/list, tabs, sidebar, search, gallery/preview, operations progress, trash, networks |
| S15 | Terminal | Super+Alt+Return (Rio on Super+Return) | terminal | cosmic-term | tabs, split panes, profiles, find, colour schemes |
| S16 | Text editor | Super+Shift+N | editor | cosmic-edit | tabs, project sidebar, git diff, find/replace, settings |
| S17 | Store | Super+Shift+I, launcher `Install:` | install/update apps | cosmic-store | Explore, categories (Create, Work, Develop, Learn, Game, Relax, Socialize, Utilities, Applets), Installed, Updates, search, app detail |
| S18 | Screenshot | Print, Super+Shift+S | region/window/screen capture | cosmic-screenshot via portal | selecting, saved, copied |
| S19 | Initial setup | first boot | language, keyboard, network, user, appearance | cosmic-initial-setup | step pages |
| S20 | Media player | files, Super+Shift+V | video/audio | cosmic-player | playing, paused, fullscreen |

Settings page tree (S13, `cosmic-settings` page commands): Network (wired, wireless, VPN) · Bluetooth · Personalization (Appearance with Import/Export of theme RON, Wallpaper, Panel, Dock, Window management, Workspaces) · Input (Keyboard with Shortcuts and Custom shortcuts, Mouse, Touchpad) · Displays · Sound · Power · Time & Language (Date & time, Region & language) · Applications (Default apps, Startup apps, Legacy X11 apps) · Accessibility (Magnifier, OSK) · System (About, Users, Firmware).

## Flows

```
F01 Login -> desktop
    S01 greeter -> password -> cosmic-session: start-cosmic exports XDG_CURRENT_DESKTOP=COSMIC, runs
    cosmic-session (dbus-run-session if needed) -> cosmic-comp, then panel, bg, osd, notifications,
    settings-daemon, idle, workspaces, app-library/launcher services, XDG autostart -> S03 panel + S12 wallpaper
    streamed variant: browser session picker -> start-cosmic-headless (cage + cosmic-comp winit) -> same
    edge: wrong password, no session, failed component (cosmic-session restarts it), GPU-less host (nested only)

F02 Launch an app
    Super+Space -> type -> Enter                     (3 actions)
    or Super+A -> click icon / type -> Enter
    or the app's own key (Super+Return Rio, Super+Shift+F Files, Super+Shift+B browser, ...)
    edge: no results (launcher offers web search / shell `:`), app already open (launcher lists the window)

F03 Switch workspace / move window
    Super+3 -> workspace 3; Super+Shift+3 -> move focused window there; Super+Shift+Alt+3 -> send silently
    Super+Tab / Super+Shift+Tab -> next/previous; Super+Ctrl+Tab -> last; Super+` -> overview, drag windows
    edge: workspace mode per output vs global, empty trailing workspace (COSMIC keeps one empty at the end)

F04 Tile / float / stack
    windows auto-tile (Bun OS default autotile on) -> Super+arrows focus, Super+Shift+arrows move,
    Super+J flip split orientation, Super+T float the window, Super+L tiling on/off for the workspace,
    Super+G stack (tabs), Super+O sticky (pop out), Super+F fullscreen, Super+Alt+F maximize,
    Super+- / Super+= resize mode
    edge: tiling exceptions (dialogs, cosmic-comp data/tiling-exceptions.ron), fullscreen games

F05 Notifications
    app -> org.freedesktop.Notifications -> toast (S10) -> click action or expire -> notification centre in applet
    do-not-disturb toggle in the applet; critical urgency stays
    edge: many from one app (grouped), DND, app closed (actions inert)

F06 Change a setting
    Super+I (or launcher "Setup: Sound") -> page -> toggle -> cosmic-config writes ~/.config/cosmic/<id>/v<N>/<key>
    -> every subscribed process updates live (no apply button)
    edge: key invalid -> component falls back to default and logs

F07 Theme switch (Omarchy theme system on COSMIC)
    Super+Space -> "theme tok" -> "Theme: Tokyo Night" -> bunos-theme-set tokyo-night ->
    cosmic-settings appearance import cosmic.ron (builder + built theme, GTK if enabled) + icon theme +
    Rio colours + wallpaper set -> all COSMIC apps repaint live
    or Super+Shift+Ctrl+Space -> Settings > Appearance (accent, mode, roundness, Import/Export)
    edge: icon theme not installed (kept), light theme on dark wallpaper set, user custom theme (export first)

F08 Install an app
    Super+Shift+I (or launcher "Install: App Store") -> Explore / search -> app page -> Install ->
    progress -> Open; updates under Updates
    edge: backend unavailable (flatpak/packagekit missing), auth needed (polkit via cosmic-osd), failed transaction

F09 Screenshot
    Print / Super+Shift+S -> region/window/screen chooser -> saved to Pictures, notification
```

## Components (shared UI from libcosmic)

| component | variants | states | used on |
| --- | --- | --- | --- |
| Header bar (CSD) | title, start/centre/end widgets, window controls | focused, unfocused, maximized | every app |
| Nav bar (sidebar) | items with icons, collapsible on narrow | selected, hover, condensed | Files, Settings, Store, Edit |
| Settings section / item | title + description + control | default, disabled | Settings, app settings pages |
| Button | standard, suggested (accent), destructive, text, icon, link | hover, pressed, focus ring, disabled | everywhere |
| Toggler, checkbox, radio, slider, spin button, dropdown, segmented control | — | on/off, focus, disabled | Settings, apps |
| Text input / search input | plain, search, password, inline edit | focus, error, disabled | launcher, library, Files, Store |
| Context menu / menu bar | items, submenus, accelerators | hover, disabled | Files, Edit, Term |
| Tab bar | closable, draggable | active, hover | Files, Term, Edit |
| Dialog | info, confirm, destructive | open | Files, Settings |
| Popover / applet popup | panel popups | open | applets |
| Toast | text + action | shown, expired | Files, Store |
| Card / list column | grouped rows | — | Settings, Store |
| Icon (named, cosmic-icons symbolic) | sizes 16/24/32/48 | — | everywhere |

Detailed per-component specs with tokens: [`components.md`](components.md).

## Inferred data model (configuration, no database)

```
cosmic-config key   ~/.config/cosmic/<AppId>/v<N>/<key> (user), /usr/share/cosmic/<AppId>/v<N>/<key> (system default);
                    one RON value per file; watched with inotify; user wins, then user v(N-1), then system vN
ThemeBuilder        com.system76.CosmicTheme.{Dark,Light}.Builder/v2: palette, spacing, corner_radii, tints, accent,
                    success/warning/destructive, gaps, active_hint, window_hint, frosted*
Theme (built)       com.system76.CosmicTheme.{Dark,Light}/v2: derived containers/components; written by cosmic-settings
ThemeMode           com.system76.CosmicTheme.Mode/v1: is_dark, auto_switch
CosmicTk            com.system76.CosmicTk/v1: icon_theme, header_size, interface_density, interface_font, monospace_font,
                    show_minimize, show_maximize, apply_theme_global
Compositor          com.system76.CosmicComp/v1: workspaces, autotile, autotile_behavior, active_hint, focus_follows_cursor,
                    xkb_config, input_*, accessibility_zoom, ...
Shortcuts           com.system76.CosmicSettings.Shortcuts/v1: defaults (from cosmic-comp data/keybindings.ron),
                    custom (user), system_actions (system: Terminal, Launcher, ... commands)
Panel               com.system76.CosmicPanel/v1 entries + com.system76.CosmicPanel.<Name>/v1/<every CosmicPanelConfig field>
Background          com.system76.CosmicBackground/v1: all | <output>, same-on-all, backgrounds
App list            com.system76.CosmicAppList/v1: favorites
```

## Feature matrix

See [`features.csv`](features.csv) (priority must/should/could; `original` = Pop!_OS COSMIC, `clone` = Bun OS state).

## Out of scope

- System76 and Pop!_OS marks, the Pop!_OS name for the product, Pop wallpapers as Bun OS branding (COSMIC code and configs are reused under their licenses: GPL-3.0 for most apps, MPL-2.0 libcosmic).
- Reimplementing COSMIC in the browser: the browser is a thin client of the real session.

## Size

20 surfaces, 9 flows, 9 config record types. Hard parts: streaming a compositor that has no headless backend (solved by nesting, see integration), keeping the forks' default patches rebased on upstream epochs, and theme parity across COSMIC, GTK, Qt (CuteCosmic) and the terminal. Size: L (configuration and fork patches over an existing desktop), not XL.
