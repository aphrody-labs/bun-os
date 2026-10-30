// SPDX-License-Identifier: Apache-2.0
//! `aphrody-remote-desktop` - cross-platform remote-desktop server.
//!
//! Captures the screen (Windows GDI via `aphrody-capture`, Linux X11 via
//! pure-Rust `x11rb`), streams JPEG frames over a WebSocket to an embedded
//! browser viewer and injects the viewer's mouse and keyboard input.
//! Authentication is a mandatory bearer token. The same capture/input backend also feeds an
//! RFB (VNC) server (`vnc-server`), and a VNC client (`vnc-client`) drives any VNC server.
//! [`target`] is the single remote-target model (local, MCP HTTP, VNC, WebSocket, shell)
//! resolved from the declared WireGuard tunnel; [`tokens`] is the single credential source.

#[cfg(feature = "android")]
pub mod android;
pub mod backend;
pub mod encode;
pub mod keymap;
pub mod protocol;
mod server;
pub mod target;
pub mod tokens;
pub mod vnc;

pub use server::{ServeOptions, serve};

use anyhow::{Context, Result};

/// 32 random bytes as 64 lowercase hex characters.
pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("operating system random generator unavailable");
    let mut out = String::with_capacity(64);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Availability of the capture/input backend on this host.
pub fn backend_status() -> serde_json::Value {
    let os = std::env::consts::OS;
    let expected = match os {
        "windows" => "gdi",
        "linux" => "x11",
        _ => "none",
    };
    let probe = backend::create_backend().and_then(|mut b| {
        let name = b.name();
        b.capture().map(|f| (name, f.width, f.height))
    });
    match probe {
        Ok((name, width, height)) => serde_json::json!({
            "os": os,
            "backend": name,
            "available": true,
            "reason": null,
            "width": width,
            "height": height,
        }),
        Err(e) => serde_json::json!({
            "os": os,
            "backend": expected,
            "available": false,
            "reason": format!("{e:#}"),
        }),
    }
}

/// One JPEG of the current screen (optionally downscaled by `scale` 1..=4).
pub fn snapshot_jpeg(quality: u8, scale: u8) -> Result<Vec<u8>> {
    let mut backend = backend::create_backend()?;
    let frame = backend.capture().context("screen capture failed")?;
    encode::encode_jpeg(&frame.bgra, frame.width, frame.height, quality, scale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_shape() {
        let a = generate_token();
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_ne!(a, generate_token());
    }

    #[test]
    fn status_has_fields() {
        let s = backend_status();
        assert!(s["os"].is_string());
        assert!(s["available"].is_boolean());
        assert!(s["backend"].is_string());
    }
}
