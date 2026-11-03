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

To install in the distro (owner of the package lists: `factory/wsl/`): `bunos-wsl-native.sh desktop` as root, or
`install.ts --desktop`, or the image profile `BUNOS_PROFILE=desktop`. It adds `[bunos-testing]` before the first
repository (`SigLevel = Required`, `Server = https://aphrody.com/repo/bunos-testing/$arch`), trusts the store key
`A4B3EFE520B09C8184ACF571BFCB340002617BD7` from `https://aphrody.com/repo/os/aphrody.gpg`, installs
`factory/wsl/packages.desktop` and adds the user to `video` and `render`; then `bunos-session`. The repository is
published signed by `factory/wsl/publish-testing.sh` (packages and database; only the files the database names).

## Status (2026-11-03)

Built on vps by `factory/desktop/build.sh` into `~/build/storage/artifacts/pacman/bunos-testing/x86_64`, all from the
pinned forks: the 24 `bunos-cli` tools and the meta-package, `bunos-desktop`, `bunos-design-m3` (design artifact
`3b89bb26a8f4`), `bunos-omarchy` 4.0.0.alpha, `cosmic-comp` and `cosmic-session` 1.11.0, `hyprland` 0.57.0 (+ `hyprpm`),
`hyprland-plugin-hyprbars` 0.57.0, `wlvncc`, `mutter` 51.1 (+ `mutter-devkit`) and `gnome-shell` 51.1. Rebuilt and published
14:45 for the fixes below: `cosmic-comp` 1.11.0-1.2, `bunos-desktop` 5, `bunos-omarchy` 4.0.0.alpha-3, `gnome-shell` 51.1-1.2
(81 packages signed in `[bunos-testing]`, installed in the workstation distro from there). Nothing is queued.

Verified: a clean `archlinux:base` container with `[bunos-testing]` first installs `bunos-cli bunos-desktop bunos-omarchy
cosmic-session gnome-shell mutter-devkit` without conflicts (the first run found `/usr/share/cosmic` owned by
cosmic-settings, now fixed) and every tool answers `--version` (Hyprland 0.57.0 at `0aa6745f`, GNOME Shell 51.1, rg 15.2.0,
nushell, uutils, helix, zellij, atuin, yazi, bottom, delta, gitui, just 1.59.0, rio, eza, starship). `bunos-session --list`
/ `--plan` and `bunos-theme --gtk` run against the committed manifest and Omarchy themes; `cargo test -p bunos-win11`
locks the manifest to the profiles.

Sessions under WSLg and under bunos-wayland-win: see "Run on the workstation" below. Pins behind the newest release: rio (`v0.5.28`+2; `v0.5.29` is out), cosmic-comp/cosmic-session (epoch 1.11 base
3 and 1 commits behind the tag, plus Bun OS defaults). Open: porting Omarchy's menus and commands from bash to
Bun/nushell, a Walker package, Omarchy's WSL guest adaptations (animations off on CPU rendering, clipboard and time zone
follow Windows), Lua forms of the design track's Hyprland chrome for Hyprland 0.57 / Omarchy quattro, rebuilding the
COSMIC applications against the patched libcosmic.

## Run on the workstation (2026-11-03)

The `bunos` distro on our 7.3.1 kernel (vkms added, [WSL.md](WSL.md) section 8), WSLg with msrdc in the user's session,
packages from the published `[bunos-testing]`. Times are from spawning the command on Windows to the session's window on
the Windows desktop (`factory/wsl/windows/session-probe.ts`, `EnumWindows` every 20 ms); screenshots were read back.

| Session | Path | Window | Time | What draws |
| --- | --- | --- | --- | --- |
| `cosmic` | WSLg, `bunos-session cosmic` | "Smithay (bunos)", 1280x800 | 0.75 s (1.3 s first start) | COSMIC panel (Workspaces, Applications), dock, background |
| `cosmic-comp` | WSLg | "Smithay (bunos)" | 0.65 s | background (no shell, as intended) |
| `gnome` | WSLg, `bunos-session gnome` | "Mutter Development Kit (bunos)" | 2.3 s (1.8 s without the chooser) | GNOME Shell overview, workspace thumbnails |
| `hyprland` | WSLg, vkms -> wayvnc -> wlvncc | "WayVNC (bunos)", 960x540 | 1.1 s | Hyprland wallpaper |
| `omarchy` | WSLg, same | "WayVNC (bunos)" | 1.6 s | Omarchy wallpaper, Quickshell bar (workspaces, clock, tray), dock and notification layers |
| `cosmic` | bunos-wayland-win (`--wsl bunos`) | "Smithay" | 0.87 s | panel with clock, dock; the output follows the window size |
| `gnome` | bunos-wayland-win | "Mutter Development Kit" | 2.4 s | top bar with clock, wallpaper |
| `omarchy` viewer | bunos-wayland-win running wlvncc | "WayVNC" | 1.2 s | the same Omarchy output |
| `hyprland`, `omarchy` nested | bunos-wayland-win `--host-arg --dmabuf`, `LIBGL_ALWAYS_SOFTWARE=1 Hyprland` | "Hyprland" | - | Hyprland wallpaper + foot (100-155 fps); Omarchy with its bar and dock ([WAYLAND-WINDOWS.md](WAYLAND-WINDOWS.md)) |

Fixes that this run needed (all committed):

- GNOME: `gnome-shell --devkit` aborted ("Failed to start X Wayland: /tmp/.X11-unix is not writable": WSLg mounts it
  read-only), so the profile adds `--no-x11`. It then took 27 s to show its window: the devkit viewer calls
  `org.freedesktop.portal.Desktop`, whose GTK backend waits for a display that is not up yet (25 s D-Bus timeouts before
  the virtual monitor). `XDG_DESKTOP_PORTAL_DIR=/var/empty` in the profile: 1.8 s. GNOME's screen-cast service also
  needs `gst-plugin-pipewire gst-plugins-base gst-plugins-good` (in `factory/wsl/packages.desktop`).
- Hyprland/Omarchy: the headless plan could not start. Aquamarine needs a KMS device and WSL has only vgem
  (render-only): "no allocator available". The kernel now builds vkms (`factory/wsl/kernel/wsl-desktop.config`).
  Then Aquamarine borrowed vgem as vkms's render node and every GBM allocation failed: `aquamarine` is now packaged
  from our fork (`bunos/v0.16.0`, v0.16.0 + one patch that skips a vgem render node) and the vendor pin moved from the
  stale v0.15.1 to that commit. Then no EGL device matched vkms: the profile sets `LIBGL_ALWAYS_SOFTWARE=1` (llvmpipe).
- Omarchy's Quickshell bar never started: `~/.config/hypr/hyprland.lua` was Hyprland's autogenerated example (written by
  an earlier Hyprland start without a config), and `bunos-session` only seeded Omarchy's config when that file was
  missing, so Omarchy's `autostart.lua` (`omarchy-launch-shell`) never loaded. `bunos-session` now moves a
  `hyprland.lua` that is not Omarchy's aside (`hyprland.lua.bunos-<ms>`) and adds missing files on every start (the
  package's `/etc/skel` `hypr/` first, for the hyprbars autostart). Bun's `Bun.spawn` also kept an inherited variable
  set to `undefined`, so the "unset" entries of the manifest (`WAYLAND_DISPLAY`) never reached the session; they are
  deleted now. The shell then ran on a black background: it decodes the theme's webp backgrounds through
  `qt6-imageformats` and calls `magick` and `inotifywait`, so `bunos-omarchy` 3 depends on `qt6-imageformats
  imagemagick inotify-tools grim slurp` (Omarchy's `install/omarchy-base.packages`). Screenshot read back with `grim -o
  BUNOS-1`: bar with workspaces 1-5, "Tuesday 14:04", tray, over the liftoff wallpaper.
- cosmic-comp's own Xwayland failed under WSLg ("Failed to create sockets: Read-only file system" for displays 1-32,
  then "Could not find a free socket for the XServer"). Our smithay fix (serve the abstract socket alone when
  `/tmp/.X11-unix` is read-only, `aphrody-labs/smithay@d646b6dd`) is now on cosmic-comp's smithay pin too
  (`aphrody-labs/smithay` branch `bunos/cosmic-comp-cf43a02` = `098c6aa`), and the fork (`3f94ece6`) builds against it:
  `cosmic-comp` 1.11.0-1.2. Verified: COSMIC logs "serving the abstract socket only", `Xwayland :1 -rootless` runs,
  `xdpyinfo` answers on `:1`, and two `xeyes` windows tile in the COSMIC session (grim on cosmic-comp's socket).
- `gnome-shell-calendar-server` could not start (`libecal-2.0.so.3: cannot open shared object file`): Arch lists
  evolution-data-server as optional, but the calendar server links it. `gnome-shell` 51.1-1.2 depends on it.
- bunos-omarchy: its `foot.desktop`, `imv.desktop`, `mpv.desktop` are per-user overrides in Omarchy and conflicted with
  those packages system-wide. They now go to `/etc/skel/.local/share/applications`, and `bunos-session omarchy` copies
  them into an existing user's `~/.local/share/applications` (pkgrel 2).

Open:

- Under WSLg, COSMIC's output follows only resizes that reach cosmic-comp as `xdg_toplevel.configure`. An interactive
  resize from winit's own frame does (configure 1340x832, output 1332x800 under `WAYLAND_DEBUG=client`). A Windows-side
  resize of the RAIL window (`MoveWindow`, as GlazeWM's `SetWindowPos` does) produced no configure from WSLg's Weston 9
  in the three logged runs (one unlogged run did reflow, to 1600x1000), so cosmic-comp has nothing to follow;
  winit's client-side frame also becomes separate "sub-surface (bunos)" RAIL windows that such a move leaves behind.
  The native presenter configures on every Windows resize and has neither problem. The fix belongs in WSLg's
  rdprail-shell (send a configure when the RDP client moves or sizes a window), in the WSLg fork.
- Omarchy calls `herdr` at start (`command not found: herdr` notification); not packaged yet.
