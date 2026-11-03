# Desktop sessions (WSL distro)

One desktop layer for the Bun OS WSL distro (Arch-style, pacman, [ops/RELEASES.md](ops/RELEASES.md)): COSMIC,
cosmic-comp alone, Hyprland, Omarchy and GNOME 51, each a Wayland session shown on the Windows desktop through
WSLg, chosen with `bunos-session`. Status 2026-11-03. The WSL bundle (kernel, WSLg, Docker, Waydroid) is owned by
[WSL.md](WSL.md) and `factory/wsl/`; this layer reaches it only through packages.

## Owners

| What | Where |
| --- | --- |
| Profile source (ids, packages, launch command, presentation, environment) | `crates/bunos-win11/src/desktop.rs` |
| Session manifest, generated (`bunos-win11 desktop --json`, kept equal by a unit test) | `factory/desktop/sessions.json` |
| Session chooser `bunos-session`, theme switch `bunos-theme` (Bun) | `factory/desktop/bunos-desktop/` |
| Recipes (PKGBUILD) | `factory/desktop/pkgbuilds/<pkg>/` |
| Rust CLI stack (`bunos-cli`) | `factory/desktop/cli.json`, rendered by `bun factory/desktop/pkgbuilds.ts` |
| Build into `[bunos-testing]` | `factory/desktop/build.sh` on `vps` |
| Theme tokens | Omarchy's `colors.toml` format (`vendor/omarchy/themes`, `factory/distro/themes`), [THEMES.md](THEMES.md); the M3 + macOS-control theme packages come from docs/DESIGN-M3-WINDOWS.md |

`bun factory/desktop/pkgbuilds.ts --check` fails when a recipe's `_commit` differs from its vendor gitlink.

## Sources (forks, pins)

| Fork (aphrody-labs) | Pin | Upstream |
| --- | --- | --- |
| `omarchy` (`vendor/omarchy`) | `ae64a4be` (quattro, 4.0.0.alpha, 2026-11-03) | omacom/omarchy (formerly basecamp/omarchy) |
| `try-omarchy-windows` (`vendor/omarchy-windows`) | `31de668d` (in step with omacom master `b830a873`) | omacom/try-omarchy-windows |
| `cosmic-comp`, `cosmic-session` (`vendor/cosmic-epoch/*`) | `8fb0fd48`, `8093b59b` (epoch 1.11 base + Bun OS defaults: Omarchy keymap, autotile) | pop-os |
| `Hyprland` + 12 hyprwm libraries (`vendor/hyprland/*`) | Hyprland v0.57.0 `0aa6745f` | hyprwm |
| `hyprland-plugins` (`vendor/hyprland/hyprland-plugins`) | v0.57.0 `d2427d4d` | hyprwm |
| `wlvncc` (`vendor/wlvncc`) | `cc0abf87` | any1/wlvncc |
| `mutter`, `gnome-shell` (`vendor/gnome/*`) | 51.1 `9134e3a5`, `33da0685` | GNOME (GitHub mirrors of gitlab.gnome.org) |

GNOME 51 exists: 51.0 and 51.1 are on download.gnome.org, and Arch `extra` carries gnome-shell and mutter 51.1
(2026-10-13/14).

## What Omarchy and Try Omarchy are, and what is merged

- **Omarchy** (MIT): an Arch + Hyprland setup. The quattro branch configures Hyprland in Lua (`default/hypr/*.lua`,
  user overrides in `config/hypr/`), ships 578 `omarchy-*` bash commands (menus, theme switch, toggles, agents),
  23 themes as `colors.toml` + templates, a Quickshell desktop shell, Walker/Mako/Waybar defaults, and system files
  (Limine, Plymouth, SDDM, zram/oomd).
- **Try Omarchy for Windows** (MIT): a Go launcher that runs the Omarchy Arch guest in QEMU on the Windows
  Hypervisor Platform with a VirGL/Venus runtime. It is a VM, so Bun OS takes no runtime from it. What is reused is
  its evidence: `docs/WSL-GPU-EXPERIMENT.md` measured Hyprland under WSLg failing (`Missing protocols`,
  `no allocator available`, exit 134), and its guest patches list what a hosted Omarchy needs (clipboard and file
  bridges, time zone and keyboard following Windows, animations off on CPU rendering).
- **bunos-omarchy** merges the upstream `omarchy` and `omarchy-settings` recipes (aphrody-labs/omarchy-pkgs) into one
  user-level package: commands, Hyprland Lua config, keybindings, menus, themes, Quickshell shell, fonts and
  `/etc/skel` seeding, plus hyprbars title bars. It drops Omarchy's `/etc` system tree and pacman update guard,
  which belong to WSL and Bun OS. The chooser, the cross-desktop theme switch and the WSLg session handling are
  written in Bun; Omarchy's bash commands ship unchanged as its runtime (porting them is open, see below).
- cosmic-comp already carries Omarchy's keymap in our fork, so the keybindings match across COSMIC and Omarchy.

## Presentation under WSLg (lowest latency that works)

WSLg's compositor is Weston 9 with Microsoft's RDP/RAIL patches; every Linux window becomes a Windows window over
RDP with shared-memory surfaces (VAIL). It offers `xdg_wm_base` v1, `wl_compositor` v4, `wl_seat` v7 and no
`zwp_linux_dmabuf_v1` ([WSLG.md](WSLG.md), measured from source and CI). So the choice per compositor is:

| Session | Presentation | How | Why |
| --- | --- | --- | --- |
| `cosmic`, `cosmic-comp` | nested window | `COSMIC_BACKEND=winit start-cosmic` | cosmic-comp's winit backend is a plain Wayland/X11 client (pop-os/cosmic-comp `src/backend/mod.rs`); its x11 backend needs DRI3/GBM and a DRM device that WSL lacks. One Windows window, Mesa d3d12 rendering, no encoding: the lowest latency path. |
| `gnome` | devkit viewer | `gnome-shell --devkit` | Mutter 51 removed the nested X11/Wayland backend; `--devkit` runs the native backend headless with a virtual monitor and opens the GTK 4 `mutter-devkit` viewer, fed by a PipeWire screen cast (mutter 51.1 `src/core/meta-context-main.c`, `mdk/`). The viewer is an ordinary WSLg client: one copy, no encoding. Fallback: `--headless` + gnome-remote-desktop 51 RDP to mstsc. |
| `hyprland`, `omarchy` | headless viewer | Hyprland with no `WAYLAND_DISPLAY` and `LIBSEAT_BACKEND=noop` (Aquamarine headless backend on the vgem render node, software GL), `hyprctl output create headless`, `wayvnc` on 127.0.0.1, `wlvncc` as the WSLg window | Aquamarine's Wayland backend refuses WSLg's Weston (measured twice: WSLG.md CI, Try Omarchy's WSL experiment) and Aquamarine has no shared-memory allocator (hyprwm/aquamarine#228, open). Headless Hyprland 0.57.0 ran in the WSLg fork's CI. Loopback VNC with raw encoding costs one copy; no compression on the path. |

Rejected: Hyprland nested in stock WSLg (fails), a Weston 16 RDP host (seat not yet proven, [WSLG.md](WSLG.md)
option A), RDP from the distro to mstsc for every session (encodes every frame), and any VM (Try Omarchy's QEMU
path, Hyper-V guests): Bun OS runs one WSL distro and no VMs.

Requirements met by the WSL bundle, not by this layer: the kernel's `CONFIG_DRM_VGEM` render node (Hyprland), PipeWire
in the session (GNOME viewer), systemd user instance and D-Bus (`dbus-run-session` is used per session).

## Theme

Default look: Material 3 with macOS-style window controls on every desktop, produced by the design track from the
single M3 token source (docs/DESIGN-M3-WINDOWS.md, `@aphrody/m3-os-themes design`). `bunos-design-m3` installs that
artifact unchanged (keyed by the commit in its `receipt.json`): GTK 3/4 + libadwaita theme `BunOS-M3`, GNOME Shell
theme, GNOME defaults as a gschema override (button layout close,minimize,maximize on the left, M3 fonts, icons),
COSMIC defaults (theme builders, CosmicTk with the controls at the start) in `/usr/share/bunos/xdg/cosmic`, first in `XDG_DATA_DIRS` (cosmic-settings owns `/usr/share/cosmic`), Hyprland
chrome for hyprbars, the Omarchy-format palette `bunos-m3`, icon themes Aphrody-M3 / Aphrody-M3-Dark, the M3 fonts
with `60-bunos-m3.conf`, and the wallpaper. Every Linux profile pulls it, and the first `bunos-session` applies
`bunos-m3`.

The switch is `bunos-theme <name>` over one token format, Omarchy's `colors.toml`: Hyprland/Omarchy through
`omarchy-theme-set`, COSMIC through `bunos-theme-set` (cosmic.ron from `factory/distro/cosmic-themes.ts`), GNOME through
`gsettings` (color-scheme, nearest libadwaita accent) and `~/.config/gtk-4.0/gtk.css` (the theme's own `gtk.css` when it
ships one, otherwise libadwaita named colours generated from `colors.toml`).

Window controls on the left in libcosmic apps: the design track's patch
(`packages/m3-os-themes/patches/libcosmic-window-controls-start.patch`) is committed on the aphrody-labs/libcosmic fork
(branch `bunos/window-controls-start`, on the pinned base `de9353ab`). COSMIC applications take libcosmic as a Cargo git
dependency, so the controls move once those applications are rebuilt against the fork (`[patch]` to it); until then the
Arch builds of the COSMIC apps keep the right-side controls.

## Packages

`bunos-desktop` (chooser, theme switch, manifest, wayland-sessions entries), `bunos-omarchy`, `bunos-cli` and its 24
tools, `cosmic-comp`, `cosmic-session`, `hyprland`, `hyprland-plugin-hyprbars`, `wlvncc`, `mutter` (+ `mutter-devkit`),
`gnome-shell`. Recipes for forks we build reuse Arch's recipe with the source moved to the pinned fork (provenance in
each header). The rest of COSMIC (panel, launcher, settings, files, term, portal) and GNOME's other modules come from
Arch `extra` at the same release until their forks are packaged.

`bunos-cli`: uutils coreutils (`uu-` prefixed beside GNU coreutils, which the boot path keeps), nushell, rio, helix,
ripgrep, fd, sd, bat, eza, dust, procs, zoxide, atuin, starship, yazi, bottom, zellij, xh, ouch, just, hyperfine,
tokei, git-delta, gitui. All maintained on 2026-11-03 (release or push within the last weeks; helix, bat and gitui
release slowly but their default branches are active). The picks match the native Windows userland
(`factory/windows/userland/tools.json`) and add the Linux session tools.

To install in the distro (owner of the package lists: `factory/wsl/`): add `[bunos-testing]` before `[core]` in
`/etc/pacman.conf`, then `pacman -Syu bunos-cli bunos-desktop` and the desktops wanted, for example
`pacman -S bunos-omarchy` or `pacman -S cosmic-session cosmic-comp`; then `bunos-session`.

## Status

Build results of the packages and what is queued are recorded in the commit that runs `factory/desktop/build.sh`.
Not verified yet: any session running under WSLg (the workstation does not start WSL from this track; the WSL track
runs the bundle). Open: porting Omarchy's menus and commands from bash to Bun/nushell, a Walker package, Omarchy's
WSL guest adaptations (animations off on CPU rendering, clipboard and time zone follow Windows).
