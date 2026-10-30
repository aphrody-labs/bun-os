// SPDX-License-Identifier: Apache-2.0
//! Desktop integration: loading screen, system tray, desktop pet, desktop widget, autostart,
//! "Open with Aphrody" (file associations) and `aphrody://` deep links.
//!
//! Every surface is a webview window declared in `tauri.conf.json` (hidden at start, parked off-screen
//! so CEF never flashes it, see [`crate::parking`]) and rendered by `@aphrody/app-ui` through its `?view=` parameter:
//!
//! - `splash` shows the animated pet until the main window reports ready
//!   ([`aphrody_app_ready`]), with a [`SPLASH_TIMEOUT`] fallback so a broken UI still opens.
//! - `pet` is a transparent, frameless, always-on-top, skip-taskbar window. A cursor poller makes
//!   it click-through everywhere except over the sprite rectangle the UI reports, and streams the
//!   pointer position so the sprite can look at it. Clicking the sprite focuses the main window.
//! - `widget` is a small transparent always-on-bottom quick-actions/status card.
//!
//! Pet and widget visibility and position persist in the `desktop.json` store; autostart is owned by
//! `tauri-plugin-autostart`, which launches the app with [`AUTOSTART_FLAG`] so that a session
//! start brings up the pet and tray without the main window.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, DynRuntime, Emitter, LogicalPosition, Manager, PhysicalPosition, WebviewWindow,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_fs::FsExt as _;
use tauri_plugin_notification::NotificationExt as _;
use tauri_plugin_store::StoreExt as _;
use tauri_plugin_updater::UpdaterExt as _;

use crate::parking;

/// Main shell window label.
pub const MAIN: &str = "main";
/// Loading screen window label.
pub const SPLASH: &str = "splash";
/// Desktop pet window label.
pub const PET: &str = "pet";
/// Desktop widget window label.
pub const WIDGET: &str = "widget";
/// Argument the autostart entry passes: start in the background (tray, pet, widget).
pub const AUTOSTART_FLAG: &str = "--autostart";
/// Deep-link scheme registered through `plugins.deep-link` and the installers.
pub const SCHEME: &str = "aphrody";
/// Event telling the main window that open requests are waiting ([`aphrody_take_open_requests`]).
pub const OPEN_EVENT: &str = "aphrody://open";
/// Event carrying the pointer position (logical pixels, relative to the pet window).
pub const PET_CURSOR_EVENT: &str = "aphrody://pet/cursor";
/// Store file holding the desktop integration preferences.
const STORE: &str = "desktop.json";
/// Longest time the loading screen waits for the main UI before showing it anyway.
const SPLASH_TIMEOUT: Duration = Duration::from_secs(30);
/// Pointer polling period for the pet hit-testing and gaze.
const CURSOR_POLL: Duration = Duration::from_millis(40);
/// Polling period while the pet is hidden or parked (it only has to notice the pet coming back).
const CURSOR_IDLE_POLL: Duration = Duration::from_millis(400);

/// Persisted desktop integration preferences.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopPrefs {
    /// Show the desktop pet.
    pub pet: bool,
    /// Show the desktop widget.
    pub widget: bool,
}

/// State reported to the settings page.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct IntegrationState {
    pet: bool,
    widget: bool,
    autostart: bool,
}

/// Files and deep links handed to Aphrody by the OS ("Open with", `aphrody://...`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct OpenRequest {
    /// `aphrody://` URLs.
    pub urls: Vec<String>,
    /// Absolute paths of existing files.
    pub files: Vec<String>,
}

impl OpenRequest {
    fn is_empty(&self) -> bool {
        self.urls.is_empty() && self.files.is_empty()
    }
}

/// Split a command line (without the program name) into deep links and existing files.
///
/// Flags (`-x`, `--flag`) are ignored; relative paths resolve against `cwd`; paths for which
/// `is_file` is false are dropped, so arbitrary arguments never become open requests.
pub fn classify_args<I, S>(args: I, cwd: &Path, is_file: impl Fn(&Path) -> bool) -> OpenRequest
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut request = OpenRequest::default();
    for arg in args {
        let arg = arg.as_ref().trim();
        if arg.is_empty() || arg.starts_with('-') {
            continue;
        }
        let is_link = arg
            .split_once(':')
            .is_some_and(|(scheme, _)| scheme.eq_ignore_ascii_case(SCHEME));
        if is_link {
            // A bare `aphrody:` names nothing to open.
            let target = url::Url::parse(arg).is_ok_and(|url| {
                url.host_str().is_some_and(|host| !host.is_empty())
                    || !url.path().trim_matches('/').is_empty()
            });
            if target {
                request.urls.push(arg.to_owned());
            }
            continue;
        }
        let path = PathBuf::from(arg);
        let path = if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        };
        if is_file(&path) {
            request.files.push(path.display().to_string());
        }
    }
    request
}

/// Pet sprite rectangle, logical pixels relative to the pet window.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct HitRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl HitRect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
}

/// Tray check items kept to mirror toggles made from the settings page or the pet.
struct TrayItems {
    pet: CheckMenuItem<DynRuntime>,
    widget: CheckMenuItem<DynRuntime>,
    autostart: CheckMenuItem<DynRuntime>,
}

/// Process-wide integration state.
#[derive(Default)]
pub struct Integration {
    pending: Mutex<Vec<OpenRequest>>,
    hit: Mutex<Option<HitRect>>,
    tray: Mutex<Option<TrayItems>>,
    /// Last position of the pet and the widget, by label (physical pixels), until it is persisted.
    positions: Mutex<HashMap<String, (i32, i32)>>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Read the persisted preferences (defaults when the store is missing or unreadable).
pub fn load_prefs(app: &AppHandle) -> DesktopPrefs {
    let Ok(store) = app.store(STORE) else {
        return DesktopPrefs::default();
    };
    let flag = |key: &str| {
        store
            .get(key)
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
    };
    DesktopPrefs {
        pet: flag("pet"),
        widget: flag("widget"),
    }
}

fn save_pref(app: &AppHandle, key: &str, on: bool) {
    match app.store(STORE) {
        Ok(store) => {
            store.set(key, on);
            if let Err(error) = store.save() {
                log::error!("desktop preferences save: {error}");
            }
        }
        Err(error) => log::error!("desktop preferences store: {error}"),
    }
}

/// Show, unminimize and focus the main window.
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN)
        && let Err(error) = window
            .show()
            .and_then(|()| window.unminimize())
            .and_then(|()| window.set_focus())
    {
        log::error!("main window focus: {error}");
    }
}

fn close_splash(app: &AppHandle) {
    if let Some(splash) = app.get_webview_window(SPLASH)
        && let Err(error) = splash.close()
    {
        log::error!("splash close: {error}");
    }
}

/// Queue an open request, widen the fs scope to its files, and bring the main window forward.
pub fn dispatch_open(app: &AppHandle, request: OpenRequest) {
    if request.is_empty() {
        return;
    }
    if let Some(scope) = app.try_fs_scope() {
        for file in &request.files {
            if let Err(error) = scope.allow_file(file) {
                log::error!("fs scope for {file}: {error}");
            }
        }
    }
    lock(&app.state::<Integration>().pending).push(request);
    if let Err(error) = app.emit_to(MAIN, OPEN_EVENT, ()) {
        log::error!("open event: {error}");
    }
    show_main(app);
}

/// Handle the command line of a second launch (forwarded by the single-instance plugin).
pub fn on_second_instance(app: &AppHandle, args: &[String], cwd: &str) {
    if crate::showcase::requested(args) {
        crate::showcase::open(app);
    }
    let request = classify_args(args.iter().skip(1), Path::new(cwd), Path::is_file);
    if request.is_empty() {
        show_main(app);
    } else {
        dispatch_open(app, request);
    }
}

fn set_surface(app: &AppHandle, label: &str, on: bool) {
    let Some(window) = app.get_webview_window(label) else {
        log::error!("window `{label}` is not declared");
        return;
    };
    let result = if on {
        // A hidden window is parked off-screen: put it where it belongs first.
        parking::reveal(&window, |window| place_surface(app, window))
    } else {
        note_moved_window(app, &window);
        flush_positions(app);
        window.hide()
    };
    if let Err(error) = result {
        log::error!("{label} visibility: {error}");
    }
    if label == PET && !on {
        *lock(&app.state::<Integration>().hit) = None;
    }
}

/// Show or hide the desktop pet and persist the choice.
pub fn set_pet(app: &AppHandle, on: bool) {
    set_surface(app, PET, on);
    save_pref(app, "pet", on);
    if let Some(items) = lock(&app.state::<Integration>().tray).as_ref() {
        let _ = items.pet.set_checked(on);
    }
}

/// Show or hide the desktop widget and persist the choice.
pub fn set_widget(app: &AppHandle, on: bool) {
    set_surface(app, WIDGET, on);
    save_pref(app, "widget", on);
    if let Some(items) = lock(&app.state::<Integration>().tray).as_ref() {
        let _ = items.widget.set_checked(on);
    }
}

/// Enable or disable launching Aphrody (in the background) at session start.
pub fn set_autostart(app: &AppHandle, on: bool) -> Result<(), String> {
    let manager = app.autostart();
    if on {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|error| error.to_string())?;
    if let Some(items) = lock(&app.state::<Integration>().tray).as_ref() {
        let _ = items.autostart.set_checked(on);
    }
    Ok(())
}

fn autostart_enabled(app: &AppHandle) -> bool {
    app.autostart().is_enabled().unwrap_or(false)
}

/// Current integration state for the settings page.
pub fn state(app: &AppHandle) -> IntegrationState {
    let prefs = load_prefs(app);
    IntegrationState {
        pet: prefs.pet,
        widget: prefs.widget,
        autostart: autostart_enabled(app),
    }
}

/// Result of an explicit update check.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheckResult {
    /// Whether an update is available.
    pub available: bool,
    /// Current app version.
    pub current_version: String,
    /// New version if available.
    pub version: Option<String>,
    /// Release notes / body if provided.
    pub body: Option<String>,
}

/// Ask the release feed for an update and report the result as a desktop notification.
pub async fn check_updates(app: AppHandle) {
    let body = match app.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => {
                format!(
                    "Aphrody {} is available. Open Settings to install it.",
                    update.version
                )
            }
            Ok(None) => "Aphrody is up to date.".to_owned(),
            Err(error) => format!("Update check failed: {error}"),
        },
        Err(error) => format!("Updater unavailable: {error}"),
    };
    if let Err(error) = app
        .notification()
        .builder()
        .title("Aphrody")
        .body(body)
        .show()
    {
        log::error!("update notification: {error}");
    }
}

/// Check for updates explicitly for the UI / settings page.
#[tauri::command]
pub async fn aphrody_check_update(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let updater = app.updater().map_err(|error| error.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateCheckResult {
            available: true,
            current_version,
            version: Some(update.version.clone()),
            body: update.body.clone(),
        }),
        Ok(None) => Ok(UpdateCheckResult {
            available: false,
            current_version,
            version: None,
            body: None,
        }),
        Err(error) => Err(error.to_string()),
    }
}

/// Download and install the available update if any.
#[tauri::command]
pub async fn aphrody_install_update(app: AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    if let Some(update) = updater.check().await.map_err(|error| error.to_string())? {
        update
            .download_and_install(|_downloaded, _total| {}, || {})
            .await
            .map_err(|error| error.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn build_tray(app: &AppHandle, prefs: DesktopPrefs) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Aphrody", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick_ask", "Quick ask", true, Some("Alt+Space"))?;
    let pet = CheckMenuItem::with_id(app, "pet", "Desktop pet", true, prefs.pet, None::<&str>)?;
    let widget = CheckMenuItem::with_id(
        app,
        "widget",
        "Desktop widget",
        true,
        prefs.widget,
        None::<&str>,
    )?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with the system",
        true,
        autostart_enabled(app),
        None::<&str>,
    )?;
    let updates = MenuItem::with_id(app, "updates", "Check for updates", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Aphrody", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &quick,
            &PredefinedMenuItem::separator(app)?,
            &pet,
            &widget,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &updates,
            &quit,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id("aphrody")
        .tooltip("Aphrody")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quick_ask" => crate::quickbar::toggle(app),
            "pet" => set_pet(app, !load_prefs(app).pet),
            "widget" => set_widget(app, !load_prefs(app).widget),
            "autostart" => {
                if let Err(error) = set_autostart(app, !autostart_enabled(app)) {
                    log::error!("autostart: {error}");
                }
            }
            "updates" => {
                tauri::async_runtime::spawn(check_updates(app.clone()));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    *lock(&app.state::<Integration>().tray) = Some(TrayItems {
        pet,
        widget,
        autostart,
    });
    Ok(())
}

pub fn build_app_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::Submenu;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(
                app,
                "menu_new_session",
                "New Session",
                true,
                Some("CmdOrCtrl+N"),
            )?,
            &MenuItem::with_id(
                app,
                "menu_open_file",
                "Open File...",
                true,
                Some("CmdOrCtrl+O"),
            )?,
            &MenuItem::with_id(
                app,
                "menu_open_folder",
                "Open Folder...",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &PredefinedMenuItem::fullscreen(app, None)?,
            &MenuItem::with_id(app, "menu_quick_ask", "Quick Ask", true, Some("Alt+Space"))?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &MenuItem::with_id(
                app,
                "menu_toggle_pet",
                "Toggle Desktop Pet",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                "menu_toggle_widget",
                "Toggle Desktop Widget",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(
                app,
                "menu_docs",
                "Aphrody Documentation",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, "menu_showcase", "M3 Showcase", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "menu_updates",
                "Check for Updates...",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::about(app, None, None)?,
        ],
    )?;

    let menu = Menu::with_items(
        app,
        &[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu],
    )?;
    // macOS shows the app menu in the system menu bar. Windows and Linux would attach it inside
    // every frameless window (main, splash, pet) above the custom title bar; there the shell's
    // own controls and the global Alt+Space shortcut cover these actions instead.
    if cfg!(target_os = "macos") {
        let _ = app.set_menu(menu);
    }
    Ok(())
}

/// Poll the pointer: make the pet window click-through outside the sprite and stream the
/// pointer position (logical, window-relative) to it for the gaze.
fn spawn_cursor_poller(app: AppHandle) {
    std::thread::Builder::new()
        .name("aphrody-pet-cursor".into())
        .spawn(move || {
            let mut ignoring: Option<bool> = None;
            let mut last: Option<(i64, i64)> = None;
            loop {
                std::thread::sleep(CURSOR_POLL);
                let Some(pet) = app.get_webview_window(PET) else {
                    return;
                };
                let parked = pet
                    .outer_position()
                    .is_ok_and(|at| parking::is_parked(at.x, at.y));
                if parked || !pet.is_visible().unwrap_or(false) {
                    ignoring = None;
                    last = None;
                    // Nothing to track while the pet is away: poll slowly, idle costs power.
                    std::thread::sleep(CURSOR_IDLE_POLL);
                    continue;
                }
                let (Ok(cursor), Ok(origin), Ok(scale)) = (
                    pet.cursor_position(),
                    pet.outer_position(),
                    pet.scale_factor(),
                ) else {
                    continue;
                };
                let x = (cursor.x - f64::from(origin.x)) / scale;
                let y = (cursor.y - f64::from(origin.y)) / scale;
                let hit = *lock(&app.state::<Integration>().hit);
                let ignore = hit.is_some_and(|rect| !rect.contains(x, y));
                if ignoring != Some(ignore) {
                    if let Err(error) = pet.set_ignore_cursor_events(ignore) {
                        log::error!("pet click-through: {error}");
                    }
                    ignoring = Some(ignore);
                }
                // Truncation to whole logical pixels is intended: sub-pixel moves are noise.
                #[allow(clippy::cast_possible_truncation)]
                let rounded = (x.round() as i64, y.round() as i64);
                if last != Some(rounded) {
                    last = Some(rounded);
                    let _ =
                        pet.emit_to(PET, PET_CURSOR_EVENT, serde_json::json!({ "x": x, "y": y }));
                }
            }
        })
        .map(|_| ())
        .unwrap_or_else(|error| log::error!("pet cursor poller: {error}"));
}

/// A work area or window rectangle: x, y, width, height in physical pixels.
type Rect = (i32, i32, u32, u32);

/// Where a surface first appears: the pet at the bottom-right of the work area, the widget at its
/// bottom-left, both with a margin.
fn default_position(label: &str, area: Rect, size: (u32, u32)) -> (i32, i32) {
    let (left, top, width, height) = area;
    let fit = |extent: u32, window: u32| i32::try_from(extent.saturating_sub(window)).unwrap_or(0);
    let y = top + fit(height, size.1);
    if label == WIDGET {
        (left + 24, y.saturating_sub(24).max(top))
    } else {
        (left + fit(width, size.0 + 48), y)
    }
}

/// Whether the top-left corner of a window lies inside one of the work areas.
fn on_screen(areas: &[Rect], position: (i32, i32)) -> bool {
    areas.iter().any(|&(left, top, width, height)| {
        let right = left.saturating_add(i32::try_from(width).unwrap_or(i32::MAX));
        let bottom = top.saturating_add(i32::try_from(height).unwrap_or(i32::MAX));
        position.0 >= left && position.0 < right && position.1 >= top && position.1 < bottom
    })
}

fn position_key(label: &str) -> String {
    format!("{label}_position")
}

fn saved_position(app: &AppHandle, label: &str) -> Option<(i32, i32)> {
    let store = app.store(STORE).ok()?;
    let value = store.get(position_key(label))?;
    let pair = value.as_array()?;
    let coordinate = |index: usize| {
        pair.get(index)?
            .as_i64()
            .and_then(|n| i32::try_from(n).ok())
    };
    Some((coordinate(0)?, coordinate(1)?))
}

/// Remember where the user left the pet or the widget. The parking spot is never remembered.
pub fn note_moved(app: &AppHandle, label: &str, x: i32, y: i32) {
    if matches!(label, PET | WIDGET) && !parking::is_parked(x, y) {
        lock(&app.state::<Integration>().positions).insert(label.to_owned(), (x, y));
    }
}

fn note_moved_window(app: &AppHandle, window: &WebviewWindow) {
    if let Ok(position) = window.outer_position() {
        note_moved(app, window.label(), position.x, position.y);
    }
}

/// Persist the remembered pet and widget positions (on hide and at exit).
pub fn flush_positions(app: &AppHandle) {
    let positions = lock(&app.state::<Integration>().positions).clone();
    if positions.is_empty() {
        return;
    }
    match app.store(STORE) {
        Ok(store) => {
            for (label, (x, y)) in positions {
                store.set(position_key(&label), serde_json::json!([x, y]));
            }
            if let Err(error) = store.save() {
                log::error!("surface positions save: {error}");
            }
        }
        Err(error) => log::error!("desktop preferences store: {error}"),
    }
}

/// Put a surface where it belongs before it shows: its remembered spot while that is still on a
/// monitor, else its default corner of the primary work area. A surface that is already on screen
/// stays where it is.
fn place_surface(app: &AppHandle, window: &WebviewWindow) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    if window.is_visible().unwrap_or(false) && !parking::is_parked(position.x, position.y) {
        return;
    }
    let Ok(size) = window.outer_size() else {
        return;
    };
    let rect = |monitor: &tauri::Monitor| {
        let area = monitor.work_area();
        (
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
        )
    };
    let areas: Vec<Rect> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(rect)
        .collect();
    let target = saved_position(app, window.label())
        .filter(|&saved| on_screen(&areas, saved))
        .or_else(|| {
            let primary = window.primary_monitor().ok().flatten()?;
            Some(default_position(
                window.label(),
                rect(&primary),
                (size.width, size.height),
            ))
        });
    if let Some((x, y)) = target
        && let Err(error) = window.set_position(PhysicalPosition::new(x, y))
    {
        log::error!("{} placement: {error}", window.label());
    }
}

/// Wire the tray, the surfaces, deep links and the startup open request. Called from `setup`.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let background = args.iter().any(|arg| arg == AUTOSTART_FLAG);
    let prefs = load_prefs(app);

    if let Err(error) = build_tray(app, prefs) {
        log::error!("tray icon: {error}");
    }

    if let Err(error) = build_app_menu(app) {
        log::error!("app menu: {error}");
    }

    // Installers register the scheme; dev runs and AppImages register it at runtime.
    #[cfg(any(target_os = "linux", all(windows, debug_assertions)))]
    {
        use tauri_plugin_deep_link::DeepLinkExt as _;
        if let Err(error) = app.deep_link().register_all() {
            log::error!("deep-link registration: {error}");
        }
    }
    // Windows and Linux deliver links as arguments (handled below and by the single-instance
    // callback); macOS delivers them through the plugin event.
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_deep_link::DeepLinkExt as _;
        let handle = app.clone();
        app.deep_link().on_open_url(move |event| {
            let urls = event
                .urls()
                .into_iter()
                .map(|url| url.to_string())
                .collect();
            dispatch_open(
                &handle,
                OpenRequest {
                    urls,
                    files: Vec::new(),
                },
            );
        });
    }

    spawn_cursor_poller(app.clone());
    if prefs.pet {
        set_surface(app, PET, true);
    }
    if prefs.widget {
        set_surface(app, WIDGET, true);
    }

    let cwd = std::env::current_dir().unwrap_or_default();
    let request = classify_args(args.iter().skip(1), &cwd, Path::is_file);
    if background && request.is_empty() {
        close_splash(app);
        return Ok(());
    }
    show_main(app);
    if let Some(splash) = app.get_webview_window(SPLASH)
        && let Err(error) = parking::reveal(&splash, |window| {
            if let Err(error) = window.center() {
                log::error!("splash centering: {error}");
            }
        })
    {
        log::error!("splash show: {error}");
    }
    if !request.is_empty() {
        lock(&app.state::<Integration>().pending).push(request);
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SPLASH_TIMEOUT).await;
        if handle.get_webview_window(SPLASH).is_some() {
            log::warn!("main UI did not report ready in {SPLASH_TIMEOUT:?}; showing it anyway");
            close_splash(&handle);
            show_main(&handle);
        }
    });
    Ok(())
}

fn require(window: &WebviewWindow, label: &str) -> Result<(), String> {
    if window.label() == label {
        Ok(())
    } else {
        Err(format!(
            "this command is restricted to the `{label}` window"
        ))
    }
}

/// The main UI finished its first render: close the loading screen and show the shell.
#[tauri::command]
pub fn aphrody_app_ready(window: WebviewWindow) -> Result<(), String> {
    require(&window, MAIN)?;
    let app = window.app_handle();
    let from_splash = app.get_webview_window(SPLASH).is_some();
    if from_splash {
        show_main(app);
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(3000)).await;
            close_splash(&handle);
        });
    } else {
        close_splash(app);
    }
    Ok(())
}

/// Drain the queued open requests (files, deep links) for the main window.
#[tauri::command]
pub fn aphrody_take_open_requests(window: WebviewWindow) -> Result<Vec<OpenRequest>, String> {
    require(&window, MAIN)?;
    Ok(std::mem::take(&mut *lock(
        &window.app_handle().state::<Integration>().pending,
    )))
}

/// Settings-page actions for the desktop integration.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum IntegrationAction {
    /// Report the current state.
    State,
    /// Show or hide the desktop pet.
    SetPet {
        /// Visible.
        on: bool,
    },
    /// Show or hide the desktop widget.
    SetWidget {
        /// Visible.
        on: bool,
    },
    /// Enable or disable autostart.
    SetAutostart {
        /// Enabled.
        on: bool,
    },
}

/// Desktop integration settings, from the main window only.
#[tauri::command]
pub fn aphrody_desktop_integration(
    window: WebviewWindow,
    action: IntegrationAction,
) -> Result<IntegrationState, String> {
    require(&window, MAIN)?;
    let app = window.app_handle();
    match action {
        IntegrationAction::State => {}
        IntegrationAction::SetPet { on } => set_pet(app, on),
        IntegrationAction::SetWidget { on } => set_widget(app, on),
        IntegrationAction::SetAutostart { on } => set_autostart(app, on)?,
    }
    Ok(state(app))
}

/// Actions of the desktop pet window.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum PetAction {
    /// Report the sprite rectangle (logical, window-relative) that receives clicks.
    HitRect {
        /// Rectangle.
        #[serde(flatten)]
        rect: HitRect,
    },
    /// Walk horizontally by `dx` logical pixels, clamped to the monitor work area.
    Step {
        /// Signed distance.
        dx: f64,
    },
    /// Begin a native drag of the pet window.
    StartDragging,
    /// Focus the main Aphrody window (sprite click).
    OpenMain,
    /// Hide the pet (persisted).
    Hide,
}

/// Result of a [`PetAction::Step`]: whether the pet reached a work-area edge.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct PetStep {
    blocked: bool,
}

/// Execute a pet action for the invoking window, which must be the pet.
#[tauri::command]
pub fn aphrody_pet(window: WebviewWindow, action: PetAction) -> Result<PetStep, String> {
    require(&window, PET)?;
    let app = window.app_handle();
    let err = |error: tauri::Error| error.to_string();
    match action {
        PetAction::HitRect { rect } => *lock(&app.state::<Integration>().hit) = Some(rect),
        PetAction::StartDragging => window.start_dragging().map_err(err)?,
        PetAction::OpenMain => show_main(app),
        PetAction::Hide => set_pet(app, false),
        PetAction::Step { dx } => {
            let scale = window.scale_factor().map_err(err)?;
            let position = window
                .outer_position()
                .map_err(err)?
                .to_logical::<f64>(scale);
            let size = window.outer_size().map_err(err)?.to_logical::<f64>(scale);
            let monitor = window
                .current_monitor()
                .map_err(err)?
                .or(window.primary_monitor().map_err(err)?)
                .ok_or_else(|| "no monitor".to_owned())?;
            let area = monitor.work_area();
            let left = f64::from(area.position.x) / scale;
            let right = left + f64::from(area.size.width) / scale - size.width;
            let x = (position.x + dx).clamp(left, right.max(left));
            window
                .set_position(LogicalPosition::new(x, position.y))
                .map_err(err)?;
            let blocked = (x - (position.x + dx)).abs() > f64::EPSILON;
            return Ok(PetStep { blocked });
        }
    }
    Ok(PetStep { blocked: false })
}

/// Actions of the desktop widget window.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum WidgetAction {
    /// Focus the main Aphrody window.
    OpenMain,
    /// Toggle the quick ask bar.
    QuickAsk,
    /// Toggle the desktop pet.
    TogglePet,
    /// Begin a native drag of the widget.
    StartDragging,
    /// Hide the widget (persisted).
    Hide,
}

/// Execute a widget action for the invoking window, which must be the widget.
#[tauri::command]
pub fn aphrody_widget(
    window: WebviewWindow,
    action: WidgetAction,
) -> Result<IntegrationState, String> {
    require(&window, WIDGET)?;
    let app = window.app_handle();
    match action {
        WidgetAction::OpenMain => show_main(app),
        WidgetAction::QuickAsk => crate::quickbar::toggle(app),
        WidgetAction::TogglePet => set_pet(app, !load_prefs(app).pet),
        WidgetAction::StartDragging => {
            window.start_dragging().map_err(|error| error.to_string())?
        }
        WidgetAction::Hide => set_widget(app, false),
    }
    Ok(state(app))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{
        HitRect, IntegrationAction, OpenRequest, PET, PetAction, WIDGET, WidgetAction,
        classify_args, default_position, on_screen, parking,
    };

    #[test]
    fn classify_args_splits_links_files_and_noise() {
        let root = std::env::temp_dir();
        let cwd = root.join("work");
        let absolute = root.join("abs").join("readme.txt");
        let files = [cwd.join("notes.md"), absolute.clone()];
        let is_file = |path: &Path| files.iter().any(|file| file == path);
        let absolute = absolute.display().to_string();
        let request = classify_args(
            [
                "--autostart",
                "aphrody://thread/abc",
                "notes.md",
                absolute.as_str(),
                "missing.md",
                "APHRODY://x",
                "aphrody:",
            ],
            &cwd,
            is_file,
        );
        assert_eq!(
            request.urls,
            vec!["aphrody://thread/abc".to_owned(), "APHRODY://x".to_owned()]
        );
        assert_eq!(request.files.len(), 2);
        assert!(request.files[0].ends_with("notes.md"));
        assert_eq!(request.files[1], absolute);
        assert_eq!(
            classify_args(Vec::<String>::new(), &cwd, is_file),
            OpenRequest::default()
        );
    }

    #[test]
    fn hit_rect_is_half_open() {
        let rect = HitRect {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 50.0,
        };
        assert!(rect.contains(10.0, 20.0));
        assert!(rect.contains(109.9, 69.9));
        assert!(!rect.contains(110.0, 30.0));
        assert!(!rect.contains(5.0, 30.0));
    }

    #[test]
    fn surface_actions_use_closed_json_contracts() {
        assert!(matches!(
            serde_json::from_str::<PetAction>(
                r#"{"action":"hit_rect","x":1,"y":2,"width":3,"height":4}"#
            ),
            Ok(PetAction::HitRect { .. })
        ));
        assert!(matches!(
            serde_json::from_str::<PetAction>(r#"{"action":"step","dx":-2}"#),
            Ok(PetAction::Step { .. })
        ));
        assert!(serde_json::from_str::<PetAction>(r#"{"action":"close_main"}"#).is_err());
        assert!(matches!(
            serde_json::from_str::<WidgetAction>(r#"{"action":"quick_ask"}"#),
            Ok(WidgetAction::QuickAsk)
        ));
        assert!(matches!(
            serde_json::from_str::<IntegrationAction>(r#"{"action":"set_autostart","on":true}"#),
            Ok(IntegrationAction::SetAutostart { on: true })
        ));
        assert!(serde_json::from_str::<IntegrationAction>(r#"{"action":"set_pet"}"#).is_err());
    }

    #[test]
    fn surfaces_open_in_their_default_corner() {
        let area = (0, 0, 1920, 1040);
        // The pet sits bottom-right with a 48 px margin, the widget bottom-left with 24 px.
        assert_eq!(
            default_position(PET, area, (180, 196)),
            (1920 - 180 - 48, 1040 - 196)
        );
        assert_eq!(
            default_position(WIDGET, area, (300, 172)),
            (24, 1040 - 172 - 24)
        );
        // A second monitor to the right keeps its own origin.
        assert_eq!(
            default_position(PET, (1920, 0, 1920, 1080), (180, 196)),
            (1920 + 1920 - 228, 884)
        );
        // A window larger than the work area never goes before the origin.
        assert_eq!(default_position(PET, (0, 0, 100, 100), (180, 196)), (0, 0));
    }

    #[test]
    fn a_remembered_position_is_used_only_while_it_is_on_a_monitor() {
        let areas = [(0, 0, 1920, 1040), (1920, 0, 1280, 1024)];
        assert!(on_screen(&areas, (10, 10)));
        assert!(on_screen(&areas, (2000, 500)));
        assert!(!on_screen(&areas, (3200, 0)));
        assert!(!on_screen(&areas, (-1, 0)));
        assert!(!on_screen(&areas, (parking::PARK, parking::PARK)));
        assert!(!on_screen(&[], (0, 0)));
    }
}
