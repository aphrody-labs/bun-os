// SPDX-License-Identifier: Apache-2.0
//! Webview runtime of the desktop: wry (WebView2, WKWebView, WebKitGTK) by default, Chromium
//! Embedded Framework through [`crate::cef`] with the `cef` feature.

use std::path::{Path, PathBuf};

#[cfg(feature = "cef")]
pub use tauri_runtime_cef::Cef as Runtime;
#[cfg(not(feature = "cef"))]
pub use tauri_runtime_wry::Wry as Runtime;

/// Engine name reported by `--host-info`.
pub const ENGINE: &str = if cfg!(feature = "cef") { "cef" } else { "wry" };

/// The runtime of the desktop.
#[must_use]
pub fn runtime() -> Runtime {
    #[cfg(feature = "cef")]
    {
        crate::cef::runtime()
    }
    #[cfg(not(feature = "cef"))]
    {
        Runtime::default()
    }
}

/// The runtime of the isolated runtime host (`--runtime-host`), with a throwaway profile
/// directory for CEF; wry keeps its data directory under the session directory too.
///
/// # Errors
///
/// Fails when the profile directory cannot be created.
pub fn runtime_host(session: &Path) -> std::io::Result<Runtime> {
    #[cfg(feature = "cef")]
    {
        crate::cef::runtime_host(session)
    }
    #[cfg(not(feature = "cef"))]
    {
        std::fs::create_dir_all(session)?;
        Ok(Runtime::default())
    }
}

/// The per-session profile directory of the runtime host.
#[must_use]
pub fn session_dir() -> PathBuf {
    std::env::temp_dir().join(format!("yolo-desktop-{}", std::process::id()))
}
