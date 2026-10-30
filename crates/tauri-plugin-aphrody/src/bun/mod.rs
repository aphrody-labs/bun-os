// SPDX-License-Identifier: Apache-2.0 OR MIT
//! The `aphrody` plugin: Bun as the backend runtime of a Tauri app.
//!
//! `plugins > aphrody > bun` in `tauri.conf.json` describes the server:
//!
//! ```json
//! { "plugins": { "aphrody": { "bun": { "entry": "server.ts", "hot": true } } } }
//! ```
//!
//! * `entry` runs with the `bun` of `PATH` (or `binary`), `--hot` when `hot` is set (dev HMR of
//!   `Bun.serve`); `sidecar` instead names a `bun build --compile` executable shipped next to the
//!   app (`bundle > externalBin`).
//! * The server gets a free loopback port in `PORT` (the default port of `Bun.serve`) and
//!   `BUN_TAURI_PORT`; the plugin waits until it accepts connections.
//! * The webview reaches it through `plugin:aphrody|bun_request` (no CORS, no CSP change) or at
//!   the URL of `plugin:aphrody|bun_info`. Its output is forwarded as `aphrody://bun-log` events.

mod http;
mod process;

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, RunEvent, Runtime, State};

pub use process::BunProcess;

/// `plugins > aphrody` of the app configuration.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default)]
    pub bun: Option<BunConfig>,
}

/// How to start the Bun server.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BunConfig {
    /// Script run with `bun [--hot] <entry>`.
    #[serde(default)]
    pub entry: Option<String>,
    /// Name of a compiled sidecar next to the app executable (`.exe` appended on Windows).
    #[serde(default)]
    pub sidecar: Option<String>,
    /// Bun executable for `entry` (default: `BUN_TAURI_BUN`, then `bun` from `PATH`).
    #[serde(default)]
    pub binary: Option<String>,
    /// Run `entry` with `--hot`.
    #[serde(default)]
    pub hot: bool,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Working directory (default: the current directory).
    #[serde(default)]
    pub cwd: Option<String>,
    /// Fixed port instead of a free one.
    #[serde(default)]
    pub port: Option<u16>,
    /// Milliseconds to wait for the port to accept connections (default 15000).
    #[serde(default)]
    pub ready_timeout_ms: Option<u64>,
    /// Start with the app (default true); otherwise on the first `bun_restart`.
    #[serde(default = "yes")]
    pub autostart: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no `plugins > aphrody > bun` configuration")]
    NotConfigured,
    #[error("`plugins > aphrody > bun` needs `entry` or `sidecar`")]
    NoEntry,
    #[error("Bun server is not running")]
    NotRunning,
    #[error("Bun server did not accept connections on port {0} in time")]
    NotReady(u16),
    #[error("Bun server exited before accepting connections ({0})")]
    Exited(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("invalid HTTP response from the Bun server: {0}")]
    Http(String),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Plugin state: the configuration and the running server, if any.
pub struct Bun {
    config: Option<BunConfig>,
    process: Mutex<Option<BunProcess>>,
}

/// What `bun_info` returns.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BunInfo {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub command: Vec<String>,
}

impl Bun {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<BunProcess>> {
        self.process.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn info(&self) -> BunInfo {
        let mut guard = self.lock();
        if guard.as_mut().is_some_and(|p| !p.alive()) {
            *guard = None;
        }
        match guard.as_ref() {
            Some(p) => BunInfo {
                running: true,
                pid: Some(p.pid()),
                port: Some(p.port),
                url: Some(p.url()),
                command: p.command.clone(),
            },
            None => BunInfo {
                running: false,
                pid: None,
                port: None,
                url: None,
                command: Vec::new(),
            },
        }
    }

    /// (Re)starts the server and waits until its port accepts connections.
    pub fn restart<R: Runtime>(&self, app: &AppHandle<R>) -> Result<BunInfo> {
        let config = self.config.as_ref().ok_or(Error::NotConfigured)?;
        self.stop();
        let started = BunProcess::spawn(app, config)?;
        *self.lock() = Some(started);
        Ok(self.info())
    }

    pub fn stop(&self) {
        if let Some(mut p) = self.lock().take() {
            p.kill();
        }
    }

    pub fn port(&self) -> Result<u16> {
        self.lock()
            .as_ref()
            .map(|p| p.port)
            .ok_or(Error::NotRunning)
    }
}

/// Request forwarded to the Bun server by `bun_request`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BunRequest {
    #[serde(default = "get")]
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
}

fn get() -> String {
    "GET".into()
}

pub use http::BunResponse;

#[tauri::command]
fn bun_info(bun: State<'_, Bun>) -> BunInfo {
    bun.info()
}

#[tauri::command]
async fn bun_restart<R: Runtime>(app: AppHandle<R>) -> Result<BunInfo> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Bun>().restart(&app))
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?
}

#[tauri::command]
async fn bun_request<R: Runtime>(app: AppHandle<R>, request: BunRequest) -> Result<BunResponse> {
    let port = app.state::<Bun>().port()?;
    tauri::async_runtime::spawn_blocking(move || http::send(port, &request))
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?
}

/// The `aphrody` plugin (Bun runtime).
pub fn init<R: Runtime>() -> TauriPlugin<R, Option<Config>> {
    Builder::<R, Option<Config>>::new("aphrody")
        .invoke_handler(
            tauri::generate_handler![#![plugin(aphrody)] bun_info, bun_request, bun_restart],
        )
        .setup(|app, api| {
            let config = api.config().as_ref().and_then(|c| c.bun.clone());
            let autostart = config.as_ref().is_some_and(|c| c.autostart);
            app.manage(Bun {
                config,
                process: Mutex::new(None),
            });
            if autostart {
                app.state::<Bun>().restart(app)?;
            }
            Ok(())
        })
        .on_event(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Bun>().stop();
            }
        })
        .build()
}
