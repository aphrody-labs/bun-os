// SPDX-License-Identifier: Apache-2.0
//! The Aphrody M3 showcase as a window of the desktop, not a separate application.
//!
//! `aphrody-app --showcase` (or the main window's `aphrody_showcase_open` command, or a second
//! launch carrying the flag) starts the compiled Bun sidecar `m3-showcase` of `apps/m3-showcase`
//! on a free loopback port and opens a `showcase` window on its origin. The sidecar serves the UI
//! and its API from one origin and is stopped when the desktop exits. The window has no Tauri
//! capability: the page gets no IPC, navigation stays on the sidecar origin and external links
//! leave for the system browser. `bun apps/m3-showcase/scripts/tauri.ts sidecar` compiles the
//! sidecar next to the desktop executable (found there first, then on `PATH`).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock, PoisonError};

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_aphrody::wrap::{Sidecar, sidecar};

/// Launch flag opening the showcase window together with the desktop.
pub const FLAG: &str = "--showcase";
/// Label of the showcase window; no capability targets it.
pub const LABEL: &str = "showcase";
/// Compiled Bun sidecar (UI and API) staged by `apps/m3-showcase/scripts/tauri.ts`.
const PROGRAM: &str = "m3-showcase";

/// Origin of the running sidecar. Set once: the sidecar guard lives in the app state until exit.
static ORIGIN: OnceLock<Url> = OnceLock::new();
/// Serializes opens so the sidecar starts once.
static OPENING: Mutex<()> = Mutex::new(());

/// Whether the launch arguments ask for the showcase.
pub fn requested<I>(args: I) -> bool
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == FLAG)
}

fn config() -> Sidecar {
    Sidecar {
        program: PROGRAM.into(),
        args: Vec::new(),
        port: 0,
        ready_path: "/healthz".into(),
        ready_timeout_secs: 30,
        env: HashMap::new(),
    }
}

fn start_origin(app: &AppHandle) -> Result<Url, Box<dyn std::error::Error>> {
    if let Some(origin) = ORIGIN.get() {
        return Ok(origin.clone());
    }
    let origin = Url::parse(&sidecar::start(app, &config())?)?;
    Ok(ORIGIN.get_or_init(|| origin).clone())
}

fn build_window(app: &AppHandle, origin: Url) -> tauri::Result<()> {
    let navigation_origin = origin.origin();
    let opener = app.clone();
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(origin))
        .title("Aphrody M3 Showcase")
        .inner_size(1200.0, 800.0)
        .min_inner_size(320.0, 480.0)
        .zoom_hotkeys_enabled(true)
        .disable_drag_drop_handler()
        .on_navigation(move |url| url.origin() == navigation_origin)
        .on_new_window(move |url, _features| {
            if matches!(url.scheme(), "http" | "https") {
                let _ = tauri_plugin_opener::OpenerExt::opener(&opener)
                    .open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .build()
        .map(|_| ())
}

/// Show the showcase window, starting its sidecar first when needed. Never blocks the caller: the
/// sidecar can take seconds to answer. A failure is logged; the desktop keeps running.
pub fn open(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        if let Err(error) = window
            .show()
            .and_then(|()| window.unminimize())
            .and_then(|()| window.set_focus())
        {
            log::error!("showcase focus: {error}");
        }
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("aphrody-showcase-start".into())
        .spawn(move || {
            let _opening = OPENING.lock().unwrap_or_else(PoisonError::into_inner);
            if app.get_webview_window(LABEL).is_some() {
                return;
            }
            match start_origin(&app).map_err(|error| error.to_string()) {
                Ok(origin) => {
                    if let Err(error) = build_window(&app, origin) {
                        log::error!("showcase window: {error}");
                    }
                }
                Err(error) => log::error!("showcase sidecar: {error}"),
            }
        });
    if let Err(error) = spawned {
        log::error!("showcase start thread: {error}");
    }
}

/// Stop the sidecar, if one runs. Called when the desktop exits.
pub fn stop(app: &AppHandle) {
    sidecar::stop(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_flag_is_matched_exactly() {
        assert!(requested(["aphrody-app", "--showcase"]));
        assert!(!requested(["aphrody-app", "--showcase=1", "showcase"]));
        assert!(!requested(Vec::<String>::new()));
    }

    #[test]
    fn the_sidecar_is_the_loopback_ui_and_api_server() {
        let config = config();
        assert_eq!(config.program, "m3-showcase");
        assert_eq!(config.port, 0);
        assert_eq!(config.ready_path, "/healthz");
    }
}
