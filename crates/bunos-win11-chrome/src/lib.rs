// SPDX-License-Identifier: Apache-2.0
//! macOS-style window chrome for Windows, through the documented Desktop Window Manager attributes
//! (`DwmSetWindowAttribute`). No shell replacement, no msstyles patching, no injected code: every effect is a
//! supported DWM attribute on a window handle we are given, so it is safe and reversible.
//!
//! The look: rounded corners (`DWMWA_WINDOW_CORNER_PREFERENCE`), a Mica material
//! (`DWMWA_SYSTEMBACKDROP_TYPE`), immersive dark mode (`DWMWA_USE_IMMERSIVE_DARK_MODE`), a unified dark caption and
//! a thin accent border (`DWMWA_CAPTION_COLOR`, `DWMWA_BORDER_COLOR`). The traffic-light caption buttons and the
//! dock are described here ([`Dock`], [`Traffic`]); on Windows, `watch` draws the traffic lights itself in an owned
//! overlay over the native caption buttons ([`Buttons`], `src/buttons.rs`).

use serde::{Deserialize, Serialize};

pub mod paint;

/// A colour as 0xRRGGBB; converted to the `COLORREF` (0x00BBGGRR) the DWM expects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rgb(pub u32);

impl Rgb {
    #[must_use]
    pub fn colorref(self) -> u32 {
        let (r, g, b) = ((self.0 >> 16) & 0xff, (self.0 >> 8) & 0xff, self.0 & 0xff);
        (b << 16) | (g << 8) | r
    }
}

/// The chrome applied to a window.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct Chrome {
    pub rounded: bool,
    pub mica: bool,
    pub dark: bool,
    pub caption: Option<Rgb>,
    pub border: Option<Rgb>,
}

impl Default for Chrome {
    /// The Bun OS macOS-style default: rounded, Mica, dark, graphite caption, subtle accent border.
    fn default() -> Self {
        Self { rounded: true, mica: true, dark: true, caption: Some(Rgb(0x1e1e24)), border: Some(Rgb(0x3a3a42)) }
    }
}

/// macOS traffic-light buttons: colours (0xRRGGBB, harmonised to the theme by the profile) and DIP geometry.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(default)]
pub struct Traffic {
    pub close: Rgb,
    pub minimize: Rgb,
    pub zoom: Rgb,
    pub diameter: u32,
    pub gap: u32,
    pub inset: u32,
}

impl Default for Traffic {
    fn default() -> Self {
        Self { close: Rgb(0xff5f57), minimize: Rgb(0xfebc2e), zoom: Rgb(0x28c840), diameter: 12, gap: 8, inset: 12 }
    }
}

/// The caption-button overlay that `watch` draws over the native caption buttons (`DWMWA_CAPTION_BUTTON_BOUNDS`).
/// Colours are 0xRRGGBB; the profile renders them from the theme (`crates/bunos-win11/src/hyprwin.rs`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Buttons {
    pub enabled: bool,
    /// Process names (without `.exe`, case-insensitive) whose windows keep their native buttons.
    pub exclude: Vec<String>,
    pub glyph: Triple,
    pub pressed: Triple,
    pub inactive_fill: Rgb,
    pub inactive_border: Rgb,
    pub focus_ring: Rgb,
    /// Minimum hit area per button, in device-independent pixels.
    pub hit: u32,
}

/// One colour per button, in macOS order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Triple {
    pub close: Rgb,
    pub minimize: Rgb,
    pub zoom: Rgb,
}

impl Default for Buttons {
    /// The Dusk dark theme values (docs/DESIGN-M3-WINDOWS.md), used when no profile is given.
    fn default() -> Self {
        Self {
            enabled: true,
            exclude: Vec::new(),
            glyph: Triple { close: Rgb(0x4c0017), minimize: Rgb(0x4a2800), zoom: Rgb(0x00391f) },
            pressed: Triple { close: Rgb(0xd03466), minimize: Rgb(0xc98736), zoom: Rgb(0x00804f) },
            inactive_fill: Rgb(0x36343a),
            inactive_border: Rgb(0x938f99),
            focus_ring: Rgb(0xcdbdff),
            hit: 24,
        }
    }
}

/// Everything `watch` reads from `--config`: the `describe` shape plus the button overlay. Missing keys keep their
/// defaults, so the design export (`windows/bunos-win11-chrome.<mode>.json`) is accepted as is.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WatchConfig {
    pub chrome: Chrome,
    pub traffic: Traffic,
    pub buttons: Buttons,
}

impl WatchConfig {
    /// Read a config file; `None` gives the defaults.
    pub fn load(path: Option<&std::path::Path>) -> Result<Self, String> {
        let Some(path) = path else { return Ok(Self::default()) };
        let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
    }

    /// Whether windows of `process` (image name with or without `.exe`) keep their native buttons.
    #[must_use]
    pub fn excluded(&self, process: &str) -> bool {
        let name = process.strip_suffix(".exe").or_else(|| process.strip_suffix(".EXE")).unwrap_or(process);
        self.buttons.exclude.iter().any(|e| e.trim_end_matches(".exe").eq_ignore_ascii_case(name))
    }
}

/// A macOS-style dock descriptor (the compositor renders it; this is the layout contract).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dock {
    pub position: DockPosition,
    pub icon_size: u32,
    pub magnification: f32,
    pub autohide: bool,
    pub background: Rgb,
    pub items: Vec<DockItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockPosition {
    Bottom,
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockItem {
    pub label: String,
    /// Target: an executable path, an AppUserModelID, or a shell command.
    pub launch: String,
    pub icon: Option<String>,
}

impl Default for Dock {
    fn default() -> Self {
        Self {
            position: DockPosition::Bottom,
            icon_size: 48,
            magnification: 1.5,
            autohide: true,
            background: Rgb(0x1e1e24),
            items: Vec::new(),
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::Chrome;
    use windows::core::BOOL;
    use windows::Win32::{
        Foundation::HWND,
        Graphics::Dwm::{
            DwmSetWindowAttribute, DWMSBT_MAINWINDOW, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR,
            DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
            DWM_SYSTEMBACKDROP_TYPE, DWM_WINDOW_CORNER_PREFERENCE,
        },
    };

    fn set<T: Copy>(hwnd: HWND, attr: windows::Win32::Graphics::Dwm::DWMWINDOWATTRIBUTE, value: &T) -> windows::core::Result<()> {
        // SAFETY: documented DWM attribute setter; `value` outlives the call and its size is passed exactly.
        unsafe {
            DwmSetWindowAttribute(hwnd, attr, (value as *const T).cast(), std::mem::size_of::<T>() as u32)
        }
    }

    /// Apply `chrome` to `hwnd`. `hwnd` is a raw window handle value (as `isize`).
    pub fn apply(hwnd_value: isize, chrome: &Chrome) -> windows::core::Result<()> {
        let hwnd = HWND(hwnd_value as *mut core::ffi::c_void);
        if chrome.rounded {
            set::<DWM_WINDOW_CORNER_PREFERENCE>(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &DWMWCP_ROUND)?;
        }
        if chrome.mica {
            set::<DWM_SYSTEMBACKDROP_TYPE>(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, &DWMSBT_MAINWINDOW)?;
        }
        set::<BOOL>(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &BOOL::from(chrome.dark))?;
        if let Some(c) = chrome.caption {
            set::<u32>(hwnd, DWMWA_CAPTION_COLOR, &c.colorref())?;
        }
        if let Some(c) = chrome.border {
            set::<u32>(hwnd, DWMWA_BORDER_COLOR, &c.colorref())?;
        }
        Ok(())
    }
}

/// Apply `chrome` to the window whose `HWND` value is `hwnd`. Returns an error string on failure.
///
/// Off Windows this is a no-op that reports the platform, so the crate builds and tests everywhere.
#[cfg(windows)]
pub fn apply(hwnd: isize, chrome: &Chrome) -> Result<(), String> {
    imp::apply(hwnd, chrome).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn apply(_hwnd: isize, _chrome: &Chrome) -> Result<(), String> {
    Err("DWM chrome is Windows-only".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colorref_swaps_to_bgr() {
        assert_eq!(Rgb(0x112233).colorref(), 0x00332211);
        assert_eq!(Rgb(0xff5f57).colorref(), 0x00575fff);
    }

    #[test]
    fn default_chrome_is_the_mac_look() {
        let c = Chrome::default();
        assert!(c.rounded && c.mica && c.dark);
        assert!(c.caption.is_some() && c.border.is_some());
    }

    #[test]
    fn descriptors_round_trip_json() {
        let dock = Dock { items: vec![DockItem { label: "Rio".into(), launch: "rio.exe".into(), icon: None }], ..Dock::default() };
        let json = serde_json::to_string(&dock).unwrap();
        let back: Dock = serde_json::from_str(&json).unwrap();
        assert_eq!(back.items.len(), 1);
        let t = Traffic::default();
        assert_eq!(serde_json::from_str::<Traffic>(&serde_json::to_string(&t).unwrap()).unwrap().diameter, 12);
    }
}
