// SPDX-License-Identifier: Apache-2.0
//! Screen capture and input injection backends.

use anyhow::Result;
pub use aphrody_capture::RawFrame;

#[cfg(windows)]
mod win32;
#[cfg(all(target_os = "linux", feature = "wayland"))]
pub mod wayland;
#[cfg(target_os = "linux")]
mod x11;

/// Pointer button.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Left,
    Middle,
    Right,
}

impl MouseButton {
    /// Parse `left` / `middle` / `right` (case-insensitive, default left).
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "right" => Self::Right,
            "middle" => Self::Middle,
            _ => Self::Left,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Middle => "middle",
            Self::Right => "right",
        }
    }
}

/// A screen that can be captured and driven.
///
/// Coordinates are absolute in the capture space: the origin of the frame
/// returned by [`ScreenBackend::capture`] is `(origin_x, origin_y)` in that
/// space (virtual desktop coordinates on Windows).
pub trait ScreenBackend: Send {
    /// Short backend identifier (`gdi`, `x11`, `wayland`).
    fn name(&self) -> &'static str;
    /// Grab the whole (virtual) screen as top-down BGRA.
    fn capture(&mut self) -> Result<RawFrame>;
    /// Move the pointer to absolute coordinates.
    fn mouse_move(&mut self, x: i32, y: i32) -> Result<()>;
    fn mouse_button(&mut self, button: MouseButton, down: bool) -> Result<()>;
    /// Wheel deltas, 120 per notch; positive `dy` scrolls up, positive `dx` right.
    fn wheel(&mut self, dx: i32, dy: i32) -> Result<()>;
    /// Press or release the key identified by a `KeyboardEvent.code`.
    fn key(&mut self, code: &str, down: bool) -> Result<()>;
    /// Type literal text.
    fn text(&mut self, text: &str) -> Result<()>;
    /// Press or release an X11/RFB keysym (VNC input). The default maps the keysym to its
    /// physical key, else types its character on press.
    fn keysym(&mut self, keysym: u32, down: bool) -> Result<()> {
        if let Some(code) = crate::keymap::keysym_to_code(keysym) {
            return self.key(&code, down);
        }
        match crate::keymap::keysym_char(keysym) {
            Some(c) if down => self.text(c.encode_utf8(&mut [0; 4])),
            Some(_) => Ok(()),
            None => anyhow::bail!("unmapped keysym {keysym:#x}"),
        }
    }
}

/// Open the backend of the current platform.
#[cfg(windows)]
pub fn create_backend() -> Result<Box<dyn ScreenBackend>> {
    Ok(Box::new(win32::Win32Backend))
}

/// Open the backend of the current platform: Wayland (pure-Rust wlr-screencopy and virtual
/// input) when `APHRODY_REMOTE_BACKEND=wayland`, or when only `WAYLAND_DISPLAY` is set; else X11.
#[cfg(target_os = "linux")]
pub fn create_backend() -> Result<Box<dyn ScreenBackend>> {
    let set = |k: &str| std::env::var(k).is_ok_and(|v| !v.is_empty());
    let forced = std::env::var("APHRODY_REMOTE_BACKEND").unwrap_or_default();
    if forced == "wayland" || (forced != "x11" && set("WAYLAND_DISPLAY") && !set("DISPLAY")) {
        #[cfg(feature = "wayland")]
        return Ok(Box::new(wayland::WaylandBackend::connect()?));
        #[cfg(not(feature = "wayland"))]
        anyhow::bail!("unsupported: Wayland session (build with the `wayland` feature)");
    }
    Ok(Box::new(x11::X11Backend::connect()?))
}

/// Open the backend of the current platform.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn create_backend() -> Result<Box<dyn ScreenBackend>> {
    anyhow::bail!("remote desktop is unsupported on {}", std::env::consts::OS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn button_parse() {
        assert_eq!(MouseButton::parse("Right"), MouseButton::Right);
        assert_eq!(MouseButton::parse("middle"), MouseButton::Middle);
        assert_eq!(MouseButton::parse("x"), MouseButton::Left);
        assert_eq!(MouseButton::Right.as_str(), "right");
    }
}
