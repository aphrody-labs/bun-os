// SPDX-License-Identifier: Apache-2.0
//! Runtime plugin of `@aphrody/web-to-tauri`: the behaviour of a website or web app wrapped in a
//! native Tauri 3 window.
//!
//! The generated project is configuration only. `init` reads its `wrap.json` and creates the main
//! window:
//!
//! - `remote`: the webview loads the deployed origin; page, API and backend are untouched.
//! - `bundle`: the assets Tauri embedded are served from a loopback origin and the configured API
//!   prefixes are proxied to the backend (Origin and Referer rewritten, cookies re-scoped).
//! - `sidecar`: the project's own server runs as a child process and the window loads it.
//!
//! ```rust,ignore
//! tauri::Builder::default()
//!     .runtime(tauri_runtime_cef::Cef::default())
//!     .plugin(tauri_plugin_aphrody::wrap::init(include_str!("../wrap.json")))
//!     .run(tauri::generate_context!())
//! ```
//!
//! The plugin grants the page no IPC: a remote origin gets no Tauri command unless the app adds a
//! `remote` capability for it.
//!
//! # Features
//!
//! - `bundle` (default): the loopback server of the `bundle` mode (axum, reqwest, rustls, tokio).
//!   Without it a `wrap.json` with `mode: bundle` is refused at startup; `remote` and `sidecar`
//!   (std only) work unchanged. A remote-only or sidecar app uses `default-features = false`.
//! - `debug-bridge`: compiles the bridge of [`debug::init`] (the former `aphrody-tauri-debug`
//!   crate). [`debug`] itself is always available and is an empty plugin without the feature.

mod config;
pub mod debug;
mod policy;
#[cfg(feature = "wrap-bundle")]
mod proxy;
#[cfg(feature = "wrap-bundle")]
mod serve;
/// Loopback sidecar process of the `sidecar` mode, also started by apps that host it themselves.
pub mod sidecar;
mod window;

use std::sync::Arc;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};
use url::Url;

pub use config::{ConfigError, Engine, External, Mode, Origins, SCHEMA, Sidecar, WrapConfig};
pub use policy::{Decision, Pattern, Policy};

/// Plugin name.
pub const PLUGIN_NAME: &str = "aphrody-wrap";

/// Why `mode: bundle` cannot start in a build without the `bundle` feature.
#[cfg(not(feature = "wrap-bundle"))]
const NO_BUNDLE_SERVER: &str = "this build has no bundle server: enable the `bundle` feature";

#[cfg(feature = "wrap-bundle")]
fn start_bundle<R: Runtime>(
    app: &AppHandle<R>,
    config: &WrapConfig,
) -> Result<String, Box<dyn std::error::Error>> {
    serve::start(
        app,
        config
            .bundle
            .as_ref()
            .ok_or("the bundle section is missing")?,
    )
}

#[cfg(not(feature = "wrap-bundle"))]
fn start_bundle<R: Runtime>(
    _app: &AppHandle<R>,
    _config: &WrapConfig,
) -> Result<String, Box<dyn std::error::Error>> {
    Err(NO_BUNDLE_SERVER.into())
}

fn start_local<R: Runtime>(
    app: &AppHandle<R>,
    config: &WrapConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let origin = match config.mode {
        Mode::Bundle => start_bundle(app, config)?,
        Mode::Sidecar => sidecar::start(
            app,
            config
                .sidecar
                .as_ref()
                .ok_or("the sidecar section is missing")?,
        )?,
        Mode::Remote => return Err("remote mode has no local origin".into()),
    };
    let start = Url::parse(&origin)?.join(&config.start)?;
    let policy = Arc::new(Policy::new(&config.origins, &[origin]));
    window::build(app, config, start, policy)?;
    Ok(())
}

fn start<R: Runtime>(
    app: &AppHandle<R>,
    config: WrapConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    // Refuse at setup, not on the start thread: an app that cannot honour its wrap.json must not open.
    #[cfg(not(feature = "wrap-bundle"))]
    if config.mode == Mode::Bundle {
        return Err(NO_BUNDLE_SERVER.into());
    }
    match config.mode {
        Mode::Remote => {
            let start = Url::parse(&config.start)?;
            let policy = Arc::new(Policy::new(&config.origins, &[]));
            window::build(app, &config, start, policy)?;
        }
        Mode::Bundle | Mode::Sidecar => {
            // A sidecar can take seconds to answer: keep the event loop free meanwhile.
            let app = app.clone();
            std::thread::Builder::new()
                .name("aphrody-wrap-start".into())
                .spawn(move || {
                    if let Err(error) = start_local(&app, &config) {
                        eprintln!("aphrody-tauri-wrap: {error}");
                        sidecar::stop(&app);
                        app.exit(1);
                    }
                })?;
        }
    }
    Ok(())
}

/// Builds the plugin from the text of `wrap.json`. The app does not start when it is invalid.
pub fn init<R: Runtime>(config_json: &'static str) -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(move |app, _api| {
            let config = WrapConfig::parse(config_json)?;
            start(app, config)
        })
        .on_cleanup_before_exit(|app| sidecar::stop(app))
        .build()
}
