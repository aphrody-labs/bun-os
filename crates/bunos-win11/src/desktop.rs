// SPDX-License-Identifier: Apache-2.0
//! Desktop profiles, archinstall-style. Each profile is a named desktop the optimiser can set up on top of the
//! debloated Windows:
//!
//! - the Linux desktops (`cosmic`, `cosmic-comp`, `hyprland`, `omarchy`, `gnome`) run from the Bun OS WSL bundle
//!   through WSLg, appearing as native Windows windows. This crate owns the profile wiring and the per-desktop
//!   package lists for the Bun OS Arch-style pacman repos; another member owns the WSL kernel/WSLg bundle, reached
//!   only through the documented interface in docs/WSL.md.
//! - `windows-native` is the Windows path: no process of ours stays resident. It is a one-shot apply of the tweak
//!   catalog's `look` and `shell` modules (accent on title bars and borders from the M3 seed, dark mode, Mica and
//!   transparency, a static wallpaper, Snap layouts, virtual desktops, taskbar/Start declutter), journaled and undoable,
//!   that Windows itself renders. The resident stack it replaces (GlazeWM, tacky-borders, AltSnap, Flow Launcher, Zebar,
//!   waku, the chrome watcher and caption overlay, the wgpu wallpaper) is retired: docs/WINDOWS-ARCHITECTURE.md.
//!
//! This enum is the single desktop profile source: the Linux session chooser (`bunos-session`, package
//! `bunos-desktop`) reads `factory/desktop/sessions.json`, which `bunos-win11 desktop --json` writes from here and a
//! test keeps identical. How each session reaches the Windows desktop under WSLg, and why, is in
//! docs/DESKTOP-SESSIONS.md.
//!
//! Nothing here starts WSL or registers a live shell; the wiring is emitted as a launch plan the user runs.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Desktop {
    /// Pop!_OS COSMIC epoch session (iced/libcosmic), full DE.
    Cosmic,
    /// cosmic-comp Wayland compositor alone (bare tiling/stacking compositor).
    CosmicComp,
    /// Hyprland dynamic tiling Wayland compositor.
    Hyprland,
    /// Omarchy (vendor/omarchy, package `bunos-omarchy`): Hyprland + Omarchy configs, keybindings, menus, themes.
    Omarchy,
    /// GNOME 51 Shell (Mutter Wayland; 51.1 released 2026-10).
    Gnome,
    /// Windows itself, configured once through its own settings (tweak modules `look` + `shell`); nothing resident.
    WindowsNative,
}

impl Desktop {
    #[must_use]
    pub fn id(self) -> &'static str {
        match self {
            Self::Cosmic => "cosmic",
            Self::CosmicComp => "cosmic-comp",
            Self::Hyprland => "hyprland",
            Self::Omarchy => "omarchy",
            Self::Gnome => "gnome",
            Self::WindowsNative => "windows-native",
        }
    }

    pub fn parse(id: &str) -> Option<Self> {
        Some(match id {
            "cosmic" => Self::Cosmic,
            "cosmic-comp" => Self::CosmicComp,
            "hyprland" => Self::Hyprland,
            "omarchy" => Self::Omarchy,
            "gnome" => Self::Gnome,
            "windows-native" => Self::WindowsNative,
            _ => return None,
        })
    }

    pub const ALL: [Self; 6] = [
        Self::Cosmic,
        Self::CosmicComp,
        Self::Hyprland,
        Self::Omarchy,
        Self::Gnome,
        Self::WindowsNative,
    ];

    #[must_use]
    pub fn is_wsl(self) -> bool {
        !matches!(self, Self::WindowsNative)
    }

    #[must_use]
    pub fn title(self) -> &'static str {
        match self {
            Self::Cosmic => "COSMIC desktop (Pop!_OS, via WSLg)",
            Self::CosmicComp => "cosmic-comp compositor only (via WSLg)",
            Self::Hyprland => "Hyprland (via WSLg)",
            Self::Omarchy => "Omarchy: Hyprland + Omarchy configs, menus and themes (via WSLg)",
            Self::Gnome => "GNOME 51 (via WSLg)",
            Self::WindowsNative => {
                "Windows, natively themed (accent, dark mode, Mica, wallpaper, Snap, virtual desktops; nothing resident)"
            }
        }
    }

    /// Bun OS pacman packages the profile needs in the WSL guest (empty for the native profile). Names match the
    /// Bun OS Arch-style repos; upstreams live under `vendor/` as pinned forks built from source
    /// (factory/desktop/pkgbuilds). Every Linux profile also pulls `bunos-desktop` (chooser, theme switch), `bunos-cli`
    /// and `bunos-design-m3` (the design track's M3 + macOS-controls defaults, docs/DESIGN-M3-WINDOWS.md).
    #[must_use]
    pub fn packages(self) -> &'static [&'static str] {
        match self {
            Self::Cosmic => &[
                "bunos-desktop",
                "bunos-cli",
                "bunos-design-m3",
                "cosmic-session",
                "cosmic-comp",
                "cosmic-panel",
                "cosmic-launcher",
                "cosmic-settings",
                "cosmic-files",
                "cosmic-term",
                "xdg-desktop-portal-cosmic",
            ],
            Self::CosmicComp => &[
                "bunos-desktop",
                "bunos-cli",
                "bunos-design-m3",
                "cosmic-comp",
            ],
            Self::Hyprland => &[
                "bunos-desktop",
                "bunos-cli",
                "bunos-design-m3",
                "hyprland",
                "xdg-desktop-portal-hyprland",
                "waybar",
                "mako",
                "wayvnc",
                "wlvncc",
            ],
            Self::Omarchy => &[
                "bunos-desktop",
                "bunos-cli",
                "bunos-design-m3",
                "bunos-omarchy",
                "hyprland",
                "wayvnc",
                "wlvncc",
            ],
            Self::Gnome => &[
                "bunos-desktop",
                "bunos-cli",
                "bunos-design-m3",
                "gnome-shell",
                "mutter",
                "gnome-session",
                "gnome-control-center",
                "nautilus",
                "xdg-desktop-portal-gnome",
            ],
            Self::WindowsNative => &[],
        }
    }

    /// The vendored upstream fork(s) the profile builds from.
    #[must_use]
    pub fn vendored(self) -> &'static [&'static str] {
        match self {
            Self::Cosmic | Self::CosmicComp => &["vendor/cosmic-epoch"],
            Self::Hyprland => &["vendor/hyprland"],
            Self::Omarchy => &[
                "vendor/omarchy",
                "vendor/omarchy-windows",
                "vendor/hyprland",
            ],
            Self::Gnome => &["vendor/gnome/mutter", "vendor/gnome/gnome-shell"],
            Self::WindowsNative => &["packages/bun-windows-winclean"],
        }
    }

    /// How the session's output reaches Windows under WSLg. `None` for the native profile.
    #[must_use]
    pub fn presentation(self) -> Option<Presentation> {
        match self {
            Self::Cosmic | Self::CosmicComp => Some(Presentation::NestedWindow),
            Self::Gnome => Some(Presentation::DevkitViewer),
            Self::Hyprland | Self::Omarchy => Some(Presentation::HeadlessViewer),
            Self::WindowsNative => None,
        }
    }

    /// Environment the session starts with, on top of WSLg's (`WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0`). An empty
    /// value unsets the variable.
    #[must_use]
    pub fn env(self) -> &'static [(&'static str, &'static str)] {
        match self {
            // cosmic-comp src/backend/mod.rs: COSMIC_BACKEND=winit skips the x11 backend, which needs DRI3/GBM and
            // a DRM node that WSL does not have; winit opens one WSLg window and renders through Mesa d3d12.
            Self::Cosmic | Self::CosmicComp => &[
                ("COSMIC_BACKEND", "winit"),
                ("XDG_CURRENT_DESKTOP", "COSMIC"),
            ],
            // Aquamarine's Wayland backend refuses WSLg's Weston (no dmabuf, old xdg_wm_base/wl_seat; docs/WSLG.md),
            // so Hyprland runs on Aquamarine's DRM backend with no seat on the kernel's vkms KMS device
            // (factory/wsl/kernel/wsl-desktop.config; our aquamarine fork renders on it instead of borrowing vgem),
            // with Mesa's software EGL (llvmpipe): without LIBGL_ALWAYS_SOFTWARE no EGL device matches vkms.
            Self::Hyprland | Self::Omarchy => &[
                ("WAYLAND_DISPLAY", ""),
                ("LIBSEAT_BACKEND", "noop"),
                ("LIBGL_ALWAYS_SOFTWARE", "1"),
                ("XDG_CURRENT_DESKTOP", "Hyprland"),
                ("XDG_SESSION_DESKTOP", "Hyprland"),
            ],
            // The devkit viewer asks org.freedesktop.portal.Desktop, whose GTK backend waits for a display that is not up
            // yet: 25 s D-Bus timeouts before the virtual monitor exists (measured 27 s to the window). With no backend
            // directory the portal answers at once (1.8 s); this session needs no portal (docs/WSL.md section 8).
            Self::Gnome => &[
                ("XDG_CURRENT_DESKTOP", "GNOME"),
                ("XDG_SESSION_DESKTOP", "gnome"),
                ("XDG_DESKTOP_PORTAL_DIR", "/var/empty"),
            ],
            Self::WindowsNative => &[],
        }
    }

    /// Launch command the guest runs under WSLg (the Bun OS WSL bundle sets up the distro). `None` for native.
    /// `bunos-session` wraps it in `dbus-run-session` and, for `HeadlessViewer`, adds the viewer.
    #[must_use]
    pub fn wslg_launch(self) -> Option<&'static str> {
        match self {
            Self::Cosmic => Some("start-cosmic"),
            Self::CosmicComp => Some("cosmic-comp"),
            Self::Hyprland => Some("Hyprland --config /usr/share/hypr/hyprland.lua"),
            Self::Omarchy => Some("Hyprland"),
            // --no-x11: WSLg mounts /tmp/.X11-unix read-only and mutter aborts when it cannot start Xwayland there.
            Self::Gnome => Some("gnome-shell --devkit --no-x11"),
            Self::WindowsNative => None,
        }
    }

    /// One machine-readable record per Linux profile, the contract of `factory/desktop/sessions.json`.
    #[must_use]
    pub fn manifest() -> Vec<SessionRecord> {
        Self::ALL
            .into_iter()
            .filter_map(|d| {
                Some(SessionRecord {
                    id: d.id(),
                    title: d.title(),
                    exec: d.wslg_launch()?,
                    presentation: d.presentation()?,
                    env: d.env().iter().map(|(k, v)| [*k, *v]).collect(),
                    packages: d.packages().to_vec(),
                    vendored: d.vendored().to_vec(),
                })
            })
            .collect()
    }

    /// A human-readable launch plan: the ordered steps to bring the desktop up. Nothing is executed here.
    #[must_use]
    pub fn launch_plan(self) -> Vec<String> {
        if self.is_wsl() {
            let distro = "BunOS";
            let mut steps = vec![
                format!(
                    "ensure the Bun OS WSL bundle is installed (another member owns it): wsl -d {distro} -- true"
                ),
                format!(
                    "pacman -S --needed {} (in {distro})",
                    self.packages().join(" ")
                ),
            ];
            if let Some(cmd) = self.wslg_launch() {
                steps.push(format!(
                    "launch under WSLg: wsl -d {distro} -- bunos-session {} ({cmd})",
                    self.id()
                ));
                steps.push(format!(
                    "or pick it from the chooser: wsl -d {distro} -- bunos-session"
                ));
            }
            if let Some(p) = self.presentation() {
                steps.push(p.describe().to_owned());
            }
            steps
        } else {
            vec![
                "bunos-win11 plan --module look --module shell --level standard (shows every registry value it would set, read-only)".to_owned(),
                "bunos-win11 apply --module look --module shell --level standard (one shot: restore point, .reg export, journal; then WM_SETTINGCHANGE and SPI_SETDESKWALLPAPER so it shows at once)".to_owned(),
                "Windows renders it: accent title bars and borders (DWM ColorPrevalence), dark mode, Mica/Acrylic where apps offer them, rounded corners (Windows 11 default), Snap layouts (Win+Z), virtual desktops (Win+Ctrl+arrows, Win+Tab)".to_owned(),
                "bunos-win11 undo (puts every value back); no process of ours runs afterwards".to_owned(),
            ]
        }
    }
}

/// How a Linux session is shown on the Windows desktop through WSLg (lowest latency first).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Presentation {
    /// The compositor is itself a WSLg client: one Windows window, buffers shared with WSLg, no encoding.
    NestedWindow,
    /// Mutter headless with a virtual monitor; the GTK 4 `mutter-devkit` viewer shows it as a WSLg window
    /// (PipeWire screen cast, one copy, no encoding).
    DevkitViewer,
    /// The compositor runs headless; `wayvnc` serves it on loopback and the `wlvncc` Wayland viewer shows it as a
    /// WSLg window (raw encoding over loopback, one copy).
    HeadlessViewer,
}

impl Presentation {
    #[must_use]
    pub fn describe(self) -> &'static str {
        match self {
            Self::NestedWindow => {
                "the compositor opens one WSLg window (nested Wayland, no encoding)"
            }
            Self::DevkitViewer => {
                "mutter runs headless; the mutter-devkit viewer is the WSLg window (PipeWire, no encoding)"
            }
            Self::HeadlessViewer => {
                "Hyprland runs headless; wayvnc on loopback + the wlvncc viewer is the WSLg window"
            }
        }
    }
}

/// One entry of `factory/desktop/sessions.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SessionRecord {
    pub id: &'static str,
    pub title: &'static str,
    pub exec: &'static str,
    pub presentation: Presentation,
    pub env: Vec<[&'static str; 2]>,
    pub packages: Vec<&'static str>,
    pub vendored: Vec<&'static str>,
}

/// The committed manifest: pretty JSON with a trailing newline.
#[must_use]
pub fn manifest_json() -> String {
    let mut out = serde_json::to_string_pretty(&serde_json::json!({
        "schema": 1,
        "generator": "bunos-win11 desktop --json (crates/bunos-win11/src/desktop.rs)",
        "sessions": Desktop::manifest(),
    }))
    .expect("manifest serialises");
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn committed_manifest_matches_profiles() {
        let committed =
            include_str!("../../../factory/desktop/sessions.json").replace("\r\n", "\n");
        assert_eq!(
            committed,
            manifest_json(),
            "run: bunos-win11 desktop --json > factory/desktop/sessions.json"
        );
    }

    #[test]
    fn every_linux_profile_has_a_session() {
        for d in Desktop::ALL {
            assert_eq!(d.is_wsl(), d.presentation().is_some(), "{}", d.id());
            assert_eq!(d.is_wsl(), d.wslg_launch().is_some(), "{}", d.id());
            if d.is_wsl() {
                for p in ["bunos-desktop", "bunos-cli", "bunos-design-m3"] {
                    assert!(d.packages().contains(&p), "{} lacks {p}", d.id());
                }
            }
        }
    }
}
