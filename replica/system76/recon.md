# System76 / Pop!_OS projects relevant to the Bun OS desktop

Date: 2026-10-30. Inventory of the System76 (pop-os GitHub organisation) projects around COSMIC, what each does, and its role in Bun OS. Forks already in this repo are noted; the rest are upstream references.

| project | what it is | Bun OS role | in repo |
| --- | --- | --- | --- |
| cosmic-epoch | meta-repository pinning every COSMIC component | the COSMIC source owner; pointers carry the Bun OS default patches | `vendor/cosmic-epoch` (aphrody-labs, `a19510c` upstream of this change) |
| cosmic-comp | Smithay-based Wayland compositor (kms, x11, winit backends; tiling, stacks, workspaces) | session compositor; fork holds the Omarchy keymap, autotile, focus-follows-cursor, horizontal workspaces | fork `8fb0fd4` |
| cosmic-session | session launcher (`start-cosmic`), component supervisor, XDG autostart | session start on native and streamed targets | fork |
| cosmic-panel + cosmic-applets | layer-shell panel embedding applets (time, workspaces, status area, audio, network, bluetooth, battery, notifications, power, tiling, input sources, app list) | Omarchy-style top bar, no dock | fork `4533fdf` |
| cosmic-launcher + launcher (pop-launcher) | launcher UI + plugin service (desktop entries, windows, files, calc, web, terminal, scripts, session) | Super+Space; Bun OS menu entries as pop-launcher scripts | `vendor/pop-launcher` |
| cosmic-app-library, cosmic-workspaces-epoch, cosmic-notifications, cosmic-osd, cosmic-bg, cosmic-idle, cosmic-greeter, cosmic-initial-setup | shell services | unchanged | forks via cosmic-epoch |
| cosmic-settings, cosmic-settings-daemon | settings app (page commands, theme import/export), settings daemon (shortcuts, system actions, brightness/volume D-Bus) | Super+I; daemon fork sets Terminal = rio | daemon fork `af9f503` |
| libcosmic (+ cosmic-theme, cosmic-config, iced fork) | toolkit and theme engine for every COSMIC app | Aphrody built-in dark theme, Omarchy geometry | fork `de9353a` |
| cosmic-files, cosmic-edit, cosmic-term, cosmic-store, cosmic-player, cosmic-screenshot, cosmic-text | applications and text engine | default apps; Store on Bun OS repos | forks via cosmic-epoch |
| cosmic-protocols | COSMIC Wayland extensions + client toolkit (toplevel info/management, workspace v2, overlap notify, corner radius) | needed by panel, app list, overview | fork |
| xdg-desktop-portal-cosmic | portal backend (file chooser via cosmic-files, screenshot, screencast) | required for sandboxed apps and screenshots | fork |
| system76-power | power profiles daemon and graphics switching | laptop power profiles (battery applet) | `vendor/system76-power` |
| system76-scheduler | CFS/EEVDF tuning daemon boosting the focused app | could: complements CachyOS-style scheduler settings already in `factory/distro/overlay` | upstream |
| system76-firmware / firmware-manager | firmware updates for System76 hardware, fwupd front end | System > Firmware page on supported hardware | `vendor/system76-firmware` |
| pop-upgrade | release upgrade and recovery partition daemon | reference for Bun OS update/recovery flow | `vendor/pop-upgrade` |
| distinst, pop-installer | installer library and GTK installer | reference; Bun OS has its own disk installer (`factory/images/bunos-disk`) | upstream |
| kernelstub | systemd-boot kernel option manager | reference | upstream |
| system76-keyboard-configurator | keyboard layout/LED tool (Launch keyboards) | could, hardware specific | upstream |
| pop-shell | GNOME tiling extension (predecessor of cosmic-comp tiling) | historical reference for the tiling keymap | upstream |

Licences: COSMIC apps and services GPL-3.0, libcosmic and cosmic-text MPL-2.0, system76-power GPL-3.0, pop-launcher MPL-2.0. Preserve them in every fork and image.
