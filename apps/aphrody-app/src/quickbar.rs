// SPDX-License-Identifier: Apache-2.0
//! System-wide quick ask bar.
//!
//! A second frameless, transparent, always-on-top webview window (`quickbar`, declared in
//! `tauri.conf.json`, hidden at start and parked off-screen, see [`crate::parking`]) that the global `Alt+Space` shortcut toggles. It hides
//! again when it loses focus or when the UI asks for it (Escape, close, minimize). The bar
//! talks to the agent through the same allow-listed commands as the main window
//! (`aphrody_rpc`, `aphrody_session_stream`), so it adds no new agent path.

use tauri::{AppHandle, Manager, PhysicalPosition, Runtime, WebviewWindow};

use crate::parking;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Label of the quick ask window in `tauri.conf.json`.
pub const LABEL: &str = "quickbar";

/// Global accelerator that toggles the bar.
pub const SHORTCUT: &str = "alt+space";

/// Vertical offset of the bar, as a fraction of the monitor height.
const TOP_FRACTION: f64 = 0.12;

/// Register [`SHORTCUT`]. A failure (another application owns the accelerator) is logged and
/// leaves the desktop running without the bar shortcut.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    let result = app
        .global_shortcut()
        .on_shortcut(SHORTCUT, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle(app);
            }
        });
    if let Err(error) = result {
        log::error!("quick ask shortcut {SHORTCUT}: {error}");
    }
}

/// Show the bar near the top of the monitor under the cursor, or hide it when visible.
pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(LABEL) else {
        log::error!("quick ask window `{LABEL}` is not declared");
        return;
    };
    // A bar that was never shown is parked off-screen but mapped, so visibility alone is not enough.
    let on_screen = window.is_visible().unwrap_or(false)
        && !window
            .outer_position()
            .is_ok_and(|at| parking::is_parked(at.x, at.y));
    let result = if on_screen {
        window.hide()
    } else {
        parking::reveal(&window, place).and_then(|()| window.set_focus())
    };
    if let Err(error) = result {
        log::error!("quick ask toggle: {error}");
    }
}

/// Hide the bar (focus loss, Escape, close).
pub fn hide<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

/// Center the bar horizontally, [`TOP_FRACTION`] from the top of the current monitor.
fn place<R: Runtime>(window: &WebviewWindow<R>) {
    let monitor = window
        .cursor_position()
        .ok()
        .and_then(|cursor| window.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, window.outer_size()) else {
        return;
    };
    let origin = monitor.position();
    let area = monitor.size();
    let x = f64::from(origin.x) + (f64::from(area.width) - f64::from(size.width)) / 2.0;
    let y = f64::from(origin.y) + f64::from(area.height) * TOP_FRACTION;
    if let Err(error) = window.set_position(PhysicalPosition::new(x, y)) {
        log::error!("quick ask placement: {error}");
    }
}

/// Actions the bar may request for its own window.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum QuickbarAction {
    /// Hide the bar.
    Hide,
    /// Hide the bar and bring the main Aphrody window forward (history, full chat).
    OpenMain,
    /// Resize the bar to fit its content (logical pixels height).
    Resize {
        /// New logical height.
        height: f64,
    },
}

/// Execute a [`QuickbarAction`] for the invoking window, which must be the quick ask bar.
pub fn act<R: Runtime>(window: &WebviewWindow<R>, action: QuickbarAction) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("quick ask actions are restricted to the quick ask window".into());
    }
    match action {
        QuickbarAction::Hide => hide(window),
        QuickbarAction::OpenMain => {
            hide(window)?;
            let main = window
                .app_handle()
                .get_webview_window("main")
                .ok_or_else(|| "main window is not available".to_owned())?;
            main.show()
                .and_then(|()| main.unminimize())
                .and_then(|()| main.set_focus())
                .map_err(|error| error.to_string())
        }
        QuickbarAction::Resize { height } => {
            let height = height.clamp(120.0, 640.0);
            let width = window
                .inner_size()
                .and_then(|size| {
                    window
                        .scale_factor()
                        .map(|scale| size.to_logical::<f64>(scale))
                })
                .map_err(|error| error.to_string())?
                .width;
            window
                .set_size(tauri::LogicalSize::new(width, height))
                .map_err(|error| error.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::QuickbarAction;

    #[test]
    fn quickbar_actions_use_a_closed_json_contract() {
        assert!(matches!(
            serde_json::from_str::<QuickbarAction>(r#"{"action":"hide"}"#),
            Ok(QuickbarAction::Hide)
        ));
        assert!(matches!(
            serde_json::from_str::<QuickbarAction>(r#"{"action":"open_main"}"#),
            Ok(QuickbarAction::OpenMain)
        ));
        assert!(matches!(
            serde_json::from_str::<QuickbarAction>(r#"{"action":"resize","height":300}"#),
            Ok(QuickbarAction::Resize { .. })
        ));
        assert!(serde_json::from_str::<QuickbarAction>(r#"{"action":"close_main"}"#).is_err());
    }
}
