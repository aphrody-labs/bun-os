// SPDX-License-Identifier: Apache-2.0
//! Desktop profiles, archinstall-style. Each profile is a named desktop the optimiser can set up on top of the
//! debloated Windows:
//!
//! - the Linux desktops (`cosmic`, `cosmic-comp`, `hyprland`, `omarchy`, `gnome`) run from the Bun OS WSL bundle
//!   through WSLg, appearing as native Windows windows. This crate owns the profile wiring and the per-desktop
//!   package lists for the Bun OS Arch-style pacman repos; another member owns the WSL kernel/WSLg bundle, reached
//!   only through the documented interface in docs/WSL.md.
//! - `windows-mac` is the native path: the macOS-style window chrome, dock, Rust tiling WM (GlazeWM, vendored) and
//!   the Rust wallpaper engine, all running on Windows itself.
//! - `windows-hyprland` is the other native path: the same chrome and wallpaper with GlazeWM (bunos fork, animated),
//!   tacky-borders, Zebar, Flow Launcher and AltSnap configured as Hyprland/Omarchy; its configs come from
//!   [`crate::hyprwin`].
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
    /// Native Windows: macOS-style chrome + dock + GlazeWM + Rust wallpaper engine.
    WindowsMac,
    /// Native Windows, Hyprland/Omarchy-style: animated GlazeWM + gradient borders + bar + launcher + Super-drag.
    WindowsHyprland,
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
            Self::WindowsMac => "windows-mac",
            Self::WindowsHyprland => "windows-hyprland",
        }
    }

    pub fn parse(id: &str) -> Option<Self> {
        Some(match id {
            "cosmic" => Self::Cosmic,
            "cosmic-comp" => Self::CosmicComp,
            "hyprland" => Self::Hyprland,
            "omarchy" => Self::Omarchy,
            "gnome" => Self::Gnome,
            "windows-mac" => Self::WindowsMac,
            "windows-hyprland" => Self::WindowsHyprland,
            _ => return None,
        })
    }

    pub const ALL: [Self; 7] = [
        Self::Cosmic,
        Self::CosmicComp,
        Self::Hyprland,
        Self::Omarchy,
        Self::Gnome,
        Self::WindowsMac,
        Self::WindowsHyprland,
    ];

    #[must_use]
    pub fn is_wsl(self) -> bool {
        !matches!(self, Self::WindowsMac | Self::WindowsHyprland)
    }

    #[must_use]
    pub fn title(self) -> &'static str {
        match self {
            Self::Cosmic => "COSMIC desktop (Pop!_OS, via WSLg)",
            Self::CosmicComp => "cosmic-comp compositor only (via WSLg)",
            Self::Hyprland => "Hyprland (via WSLg)",
            Self::Omarchy => "Omarchy: Hyprland + Omarchy configs, menus and themes (via WSLg)",
            Self::Gnome => "GNOME 51 (via WSLg)",
            Self::WindowsMac => "Windows, macOS-style (native: chrome + dock + GlazeWM + wallpaper engine)",
            Self::WindowsHyprland => {
                "Windows, Hyprland-style (native: animated GlazeWM + gradient borders + Zebar + Flow Launcher + AltSnap)"
            }
        }
    }

    /// Bun OS pacman packages the profile needs in the WSL guest (empty for the native profile). Names match the
    /// Bun OS Arch-style repos; upstreams live under `vendor/` as pinned forks built from source
    /// (factory/desktop/pkgbuilds). Every Linux profile also pulls `bunos-desktop` (chooser, theme) and `bunos-cli`.
    #[must_use]
    pub fn packages(self) -> &'static [&'static str] {
        match self {
            Self::Cosmic => &[
                "bunos-desktop", "bunos-cli", "cosmic-session", "cosmic-comp", "cosmic-panel", "cosmic-launcher",
                "cosmic-settings", "cosmic-files", "cosmic-term", "xdg-desktop-portal-cosmic",
            ],
            Self::CosmicComp => &["bunos-desktop", "bunos-cli", "cosmic-comp"],
            Self::Hyprland => &[
                "bunos-desktop", "bunos-cli", "hyprland", "xdg-desktop-portal-hyprland", "waybar", "mako", "wayvnc",
                "wlvncc",
            ],
            Self::Omarchy => &["bunos-desktop", "bunos-cli", "bunos-omarchy", "hyprland", "wayvnc", "wlvncc"],
            Self::Gnome => &[
                "bunos-desktop", "bunos-cli", "gnome-shell", "mutter", "gnome-session", "gnome-control-center",
                "nautilus", "xdg-desktop-portal-gnome",
            ],
            Self::WindowsMac | Self::WindowsHyprland => &[],
        }
    }

    /// The vendored upstream fork(s) the profile builds from.
    #[must_use]
    pub fn vendored(self) -> &'static [&'static str] {
        match self {
            Self::Cosmic | Self::CosmicComp => &["vendor/cosmic-epoch"],
            Self::Hyprland => &["vendor/hyprland"],
            Self::Omarchy => &["vendor/omarchy", "vendor/omarchy-windows", "vendor/hyprland"],
            Self::Gnome => &["vendor/gnome/mutter", "vendor/gnome/gnome-shell"],
            Self::WindowsMac => &["vendor/glazewm", "crates/bunos-win11-chrome", "crates/bunos-win11-wallpaper"],
            Self::WindowsHyprland => &[
                "vendor/glazewm",
                "vendor/tacky-borders",
                "vendor/zebar",
                "vendor/flow-launcher",
                "vendor/altsnap",
                "crates/bunos-win11-chrome",
                "crates/bunos-win11-wallpaper",
            ],
        }
    }

    /// How the session's output reaches Windows under WSLg. `None` for the native profile.
    #[must_use]
    pub fn presentation(self) -> Option<Presentation> {
        match self {
            Self::Cosmic | Self::CosmicComp => Some(Presentation::NestedWindow),
            Self::Gnome => Some(Presentation::DevkitViewer),
            Self::Hyprland | Self::Omarchy => Some(Presentation::HeadlessViewer),
            Self::WindowsMac | Self::WindowsHyprland => None,
        }
    }

    /// Environment the session starts with, on top of WSLg's (`WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0`). An empty
    /// value unsets the variable.
    #[must_use]
    pub fn env(self) -> &'static [(&'static str, &'static str)] {
        match self {
            // cosmic-comp src/backend/mod.rs: COSMIC_BACKEND=winit skips the x11 backend, which needs DRI3/GBM and
            // a DRM node that WSL does not have; winit opens one WSLg window and renders through Mesa d3d12.
            Self::Cosmic | Self::CosmicComp => &[("COSMIC_BACKEND", "winit"), ("XDG_CURRENT_DESKTOP", "COSMIC")],
            // Aquamarine's Wayland backend refuses WSLg's Weston (no dmabuf, old xdg_wm_base/wl_seat; docs/WSLG.md),
            // so Hyprland runs on its headless backend (no WAYLAND_DISPLAY, no seat) on the vgem render node with
            // software GL, as in the WSLg fork's hyprland-headless mode.
            Self::Hyprland | Self::Omarchy => &[
                ("WAYLAND_DISPLAY", ""),
                ("LIBSEAT_BACKEND", "noop"),
                ("XDG_CURRENT_DESKTOP", "Hyprland"),
                ("XDG_SESSION_DESKTOP", "Hyprland"),
            ],
            Self::Gnome => &[("XDG_CURRENT_DESKTOP", "GNOME"), ("XDG_SESSION_DESKTOP", "gnome")],
            Self::WindowsMac | Self::WindowsHyprland => &[],
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
            Self::Gnome => Some("gnome-shell --devkit"),
            Self::WindowsMac | Self::WindowsHyprland => None,
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
                format!("ensure the Bun OS WSL bundle is installed (another member owns it): wsl -d {distro} -- true"),
                format!("pacman -S --needed {} (in {distro})", self.packages().join(" ")),
            ];
            if let Some(cmd) = self.wslg_launch() {
                steps.push(format!("launch under WSLg: wsl -d {distro} -- bunos-session {} ({cmd})", self.id()));
                steps.push(format!("or pick it from the chooser: wsl -d {distro} -- bunos-session"));
            }
            if let Some(p) = self.presentation() {
                steps.push(p.describe().to_owned());
            }
            steps
        } else if self == Self::WindowsHyprland {
            vec![
                "bun factory/windows/desktop/hyprland.ts build (GlazeWM bunos fork, tacky-borders, Zebar, chrome, wallpaper from source; AltSnap cross-built on vps; Flow Launcher with dotnet; staged and test-signed under %LOCALAPPDATA%/bunos/desktop)".to_owned(),
                "bunos-win11 desktop windows-hyprland --render <dir> (GlazeWM, tacky-borders, AltSnap, Flow configs from the M3 roles; glass max, reduced when Transparency effects are off)".to_owned(),
                "bun factory/windows/desktop/hyprland.ts up (per-user processes: wallpaper, chrome watch, GlazeWM, tacky-borders, Zebar, AltSnap, Flow; nothing registered as the shell, no autostart, no registry writes)".to_owned(),
                "bun factory/windows/desktop/hyprland.ts down | undo (stop them; undo also deletes the staged tree)".to_owned(),
            ]
        } else {
            vec![
                "cargo build -p bunos-win11-chrome -p bunos-win11-wallpaper --target x86_64-pc-windows-msvc".to_owned(),
                "build GlazeWM from vendor/glazewm (GPL-3.0)".to_owned(),
                "run bunos-win11-wallpaper (wgpu into the WorkerW desktop layer)".to_owned(),
                "run the macOS chrome module (rounded corners, Mica, unified dark caption, colored borders, dock)".to_owned(),
                "start GlazeWM for tiling (not registered as the live shell)".to_owned(),
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
            Self::NestedWindow => "the compositor opens one WSLg window (nested Wayland, no encoding)",
            Self::DevkitViewer => {
                "mutter runs headless; the mutter-devkit viewer is the WSLg window (PipeWire, no encoding)"
            }
            Self::HeadlessViewer => "Hyprland runs headless; wayvnc on loopback + the wlvncc viewer is the WSLg window",
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
        let committed = include_str!("../../../factory/desktop/sessions.json").replace("\r\n", "\n");
        assert_eq!(committed, manifest_json(), "run: bunos-win11 desktop --json > factory/desktop/sessions.json");
    }

    #[test]
    fn every_linux_profile_has_a_session() {
        for d in Desktop::ALL {
            assert_eq!(d.is_wsl(), d.presentation().is_some(), "{}", d.id());
            assert_eq!(d.is_wsl(), d.wslg_launch().is_some(), "{}", d.id());
            if d.is_wsl() {
                assert!(d.packages().contains(&"bunos-desktop") && d.packages().contains(&"bunos-cli"));
            }
        }
    }
}
