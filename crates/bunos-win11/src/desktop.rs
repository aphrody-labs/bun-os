// SPDX-License-Identifier: Apache-2.0
//! Desktop profiles, archinstall-style. Each profile is a named desktop the optimiser can set up on top of the
//! debloated Windows:
//!
//! - the Linux desktops (`cosmic`, `cosmic-comp`, `hyprland`, `omarchy`, `gnome`) run from the Bun OS WSL bundle
//!   through WSLg, appearing as native Windows windows. This crate owns the profile wiring and the per-desktop
//!   package lists for the Bun OS Arch-style pacman repos; another member owns the WSL kernel/WSLg bundle, reached
//!   only through the documented interface in [`WslDesktop`].
//! - `windows-mac` is the native path: the macOS-style window chrome, dock, Rust tiling WM (GlazeWM, vendored) and
//!   the Rust wallpaper engine, all running on Windows itself.
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
    /// Omarchy (our try-omarchy-windows fork): Hyprland + Omarchy dotfiles and tooling.
    Omarchy,
    /// GNOME 51 Shell (Mutter Wayland).
    Gnome,
    /// Native Windows: macOS-style chrome + dock + GlazeWM + Rust wallpaper engine.
    WindowsMac,
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
            _ => return None,
        })
    }

    pub const ALL: [Self; 6] =
        [Self::Cosmic, Self::CosmicComp, Self::Hyprland, Self::Omarchy, Self::Gnome, Self::WindowsMac];

    #[must_use]
    pub fn is_wsl(self) -> bool {
        !matches!(self, Self::WindowsMac)
    }

    #[must_use]
    pub fn title(self) -> &'static str {
        match self {
            Self::Cosmic => "COSMIC desktop (Pop!_OS, via WSLg)",
            Self::CosmicComp => "cosmic-comp compositor only (via WSLg)",
            Self::Hyprland => "Hyprland (via WSLg)",
            Self::Omarchy => "Omarchy — Hyprland + dotfiles (via WSLg)",
            Self::Gnome => "GNOME 51 (via WSLg)",
            Self::WindowsMac => "Windows, macOS-style (native: chrome + dock + GlazeWM + wallpaper engine)",
        }
    }

    /// Bun OS pacman packages the profile needs in the WSL guest (empty for the native profile). Names match the
    /// Bun OS Arch-style repos; upstreams live under `vendor/` as pinned forks built from source.
    #[must_use]
    pub fn packages(self) -> &'static [&'static str] {
        match self {
            Self::Cosmic => &[
                "cosmic-session", "cosmic-comp", "cosmic-panel", "cosmic-launcher", "cosmic-settings",
                "cosmic-files", "cosmic-term", "cosmic-greeter", "xdg-desktop-portal-cosmic",
            ],
            Self::CosmicComp => &["cosmic-comp", "cosmic-session"],
            Self::Hyprland => &[
                "hyprland", "waybar", "wofi", "mako", "kitty", "xdg-desktop-portal-hyprland", "hyprpaper",
            ],
            Self::Omarchy => &[
                "omarchy", "hyprland", "waybar", "walker", "mako", "alacritty", "hyprpaper",
                "xdg-desktop-portal-hyprland",
            ],
            Self::Gnome => &["gnome-shell", "gnome-session", "mutter", "gnome-control-center", "nautilus", "gnome-terminal"],
            Self::WindowsMac => &[],
        }
    }

    /// The vendored upstream fork(s) the profile builds from.
    #[must_use]
    pub fn vendored(self) -> &'static [&'static str] {
        match self {
            Self::Cosmic | Self::CosmicComp => &["vendor/cosmic-epoch", "vendor/pop-os"],
            Self::Hyprland => &["vendor/hyprland"],
            Self::Omarchy => &["vendor/omarchy-windows", "vendor/omarchy", "vendor/hyprland"],
            Self::Gnome => &[],
            Self::WindowsMac => &["vendor/glazewm", "crates/bunos-win11-chrome", "crates/bunos-win11-wallpaper"],
        }
    }

    /// Launch command the guest runs under WSLg (the Bun OS WSL bundle sets up the distro). `None` for native.
    #[must_use]
    pub fn wslg_launch(self) -> Option<&'static str> {
        match self {
            Self::Cosmic => Some("cosmic-session"),
            Self::CosmicComp => Some("cosmic-comp"),
            Self::Hyprland | Self::Omarchy => Some("Hyprland"),
            Self::Gnome => Some("dbus-run-session -- gnome-session"),
            Self::WindowsMac => None,
        }
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
                steps.push(format!("launch under WSLg: wsl -d {distro} -- env WAYLAND_DISPLAY=wayland-0 {cmd}"));
                steps.push("WSLg projects each Wayland surface as a native Windows window".to_owned());
            }
            steps
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
