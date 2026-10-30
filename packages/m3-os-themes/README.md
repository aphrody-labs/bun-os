<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/m3-os-themes

Generates and installs Material 3 OS themes (Windows 11, GNOME Shell, COSMIC, Chromium browsers) from a seed colour, with the colour roles of `@aphrody/m3-tokens/dynamic-color`.

```sh
bun add -d @aphrody/m3-os-themes
```

```sh
bunx --bun m3-os-themes generate --target all --seed '#6750a4' --mode auto --out ./m3-os-themes-out
```

License: Apache-2.0 (`LICENSE`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

Full usage (in the Aphrody checkout `yolo m3 os-themes` takes the same arguments):

```sh
m3-os-themes <install|generate|uninstall> \
  --target windows|gnome|cosmic|chromium|all --seed '#6750a4' --mode light|dark|auto \
  [--name Aphrody] [--variant tonalSpot] [--out dir] [--icons dir] [--dry-run] [--apply]
```

- `generate` writes only into `--out` (default `./m3-os-themes-out`).
- `--icons <dir>` (GNOME and COSMIC) also installs a freedesktop icon theme into `~/.local/share/icons` and
  selects it (gsettings `icon-theme`; COSMIC `com.system76.CosmicTk/v1/icon_theme`); `--uninstall` restores the
  previous icon theme. Build the full Material Symbols theme with
  `bun packages/material-design-icons/scripts/export-theme.ts --out dist/icons`, then pass
  `--icons dist/icons/freedesktop/Aphrody-M3`.
- `install` and `uninstall` print the plan and change nothing unless `--apply` is given.
  `--apply` generates the files, then runs the target script for the host OS.

| Target   | Artifacts                                                                                                                                                                                                 | Installer                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| windows  | `M3-<name>-{light,dark}.theme`, wallpapers, registry values (`Themes\Personalize` `AppsUseLightTheme`/`SystemUsesLightTheme`/`ColorPrevalence`, DWM `AccentColor`/`ColorizationColor`, `Explorer\Accent`) | `install-windows.ps1` (snapshot on first run, `-Uninstall` restores, `-WhatIf`)                  |
| gnome    | `~/.local/share/themes/M3-<name>/{gnome-shell,gtk-3.0,gtk-4.0}` CSS, `~/.config/gtk-4.0/gtk.css`                                                                                                          | `install-gnome.sh` (gsettings: gtk-theme, color-scheme, accent-color, user-theme; `--uninstall`) |
| cosmic   | cosmic-theme ThemeBuilder RON keys under `~/.config/cosmic/com.system76.CosmicTheme.{Dark,Light}.Builder/v2/` and `M3-<name>-<mode>.ron`                                                                  | `install-cosmic.sh` (snapshot, `--uninstall`)                                                    |
| chromium | MV3 theme `{light,dark}/manifest.json` + images, `BrowserThemeColor` policy JSON and `.reg` for Chrome, Edge, Brave, Chromium                                                                             | `install-chromium.sh`, `install-chromium.md` (Load unpacked)                                     |

Tests generate everything in memory or in a temp directory and never touch the system:
`bun test test/`. The COSMIC key layout and the GNOME Shell selectors follow the upstream formats and
were not exercised on a live COSMIC or GNOME session.

Pending (work item C1): once a cosmic-config binding (read/write) exists, replace the hand-written
cosmic-config writes in `src/cosmic.ts`/`install-cosmic.sh` and validate the keys through it. Same candidate on the
Rust side: the hand-rolled `.desktop` parser in `crates/ui/drive/src/file_opening/linux.rs` (vs
`freedesktop-desktop-entry`).
