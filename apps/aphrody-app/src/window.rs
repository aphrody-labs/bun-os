// SPDX-License-Identifier: Apache-2.0
//! The window subsystem: Tauri as the window manager of Aphrody OS.
//!
//! Agents list, open, focus, move, resize, retitle and close desktop windows, raise native
//! notifications and use the clipboard. The kernel window subsystem is the
//! authoritative agent surface: autonomous agents may mutate every Aphrody
//! window, including the main shell window.

use aphrody_subsystem::{
    AgentBus, Event, SkillManifest, SkillStep, SubsystemError, SystemSubsystem, ToolDefinition,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl,
    WebviewWindowBuilder, image::Image,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_notification::NotificationExt;

fn adaptive_title(url: &tauri::Url, label: &str) -> String {
    let host = url.host_str().unwrap_or(label);
    let product = host
        .strip_prefix("www.")
        .unwrap_or(host)
        .split('.')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(label);
    let product = product
        .chars()
        .enumerate()
        .map(|(index, ch)| {
            if index == 0 {
                ch.to_ascii_uppercase()
            } else {
                ch
            }
        })
        .collect::<String>();
    format!("{product} — Aphrody")
}

pub struct WindowSubsystem {
    app: AppHandle,
}

impl WindowSubsystem {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    fn window(&self, arguments: &Value) -> Result<tauri::WebviewWindow, SubsystemError> {
        let label = arguments
            .get("label")
            .and_then(Value::as_str)
            .ok_or_else(|| SubsystemError::InvalidArguments("`label` is required".into()))?;
        self.app.get_webview_window(label).ok_or_else(|| {
            SubsystemError::InvalidArguments(format!("no window labelled `{label}`"))
        })
    }

    fn notify(&self, title: &str, body: &str) -> Result<(), SubsystemError> {
        self.app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(failed)
    }
}

fn failed(error: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::Failed(error.to_string())
}

fn describe(window: &tauri::WebviewWindow) -> Value {
    let position = window.outer_position().ok();
    let size = window.inner_size().ok();
    json!({
        "label": window.label(),
        "title": window.title().unwrap_or_default(),
        "url": window.url().map(|url| url.to_string()).unwrap_or_default(),
        "visible": window.is_visible().unwrap_or(false),
        "focused": window.is_focused().unwrap_or(false),
        "minimized": window.is_minimized().unwrap_or(false),
        "maximized": window.is_maximized().unwrap_or(false),
        "x": position.map(|p| p.x), "y": position.map(|p| p.y),
        "width": size.map(|s| s.width), "height": size.map(|s| s.height),
    })
}

fn integer(arguments: &Value, key: &str) -> Option<i64> {
    arguments.get(key).and_then(Value::as_i64)
}

fn label_schema() -> Value {
    json!({"type": "object", "properties": {"label": {"type": "string"}}, "required": ["label"]})
}

#[async_trait]
impl SystemSubsystem for WindowSubsystem {
    fn name(&self) -> &'static str {
        "window"
    }

    fn description(&self) -> &'static str {
        "The desktop window manager (Tauri): windows, native notifications and the clipboard."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "window_list",
                "Every desktop window with its title, URL, state, position and size.",
                json!({"type": "object"}),
            ),
            ToolDefinition::new(
                "window_open",
                "Open a Tauri/CEF interactive preview on an http(s) URL. It gets no desktop \
                 capability and is never used as a crawler or artifact source.",
                json!({"type": "object", "properties": {
                    "label": {"type": "string", "description": "Unique window id: letters, digits, `-`, `_`."},
                    "url": {"type": "string"},
                    "title": {"type": "string"},
                    "width": {"type": "integer", "minimum": 200}, "height": {"type": "integer", "minimum": 150}
                }, "required": ["label", "url"]}),
            ),
            ToolDefinition::new(
                "window_focus",
                "Show, unminimize and focus a window.",
                label_schema(),
            ),
            // Not `window_close`: the admin subsystem already serves that name (Win32 `hwnd`), and a
            // duplicate tool name makes the kernel reject the whole admin registration.
            ToolDefinition::new(
                "window_close_label",
                "Close a window by label.",
                label_schema(),
            ),
            ToolDefinition::new(
                "window_set_bounds",
                "Move and/or resize a window (physical pixels).",
                json!({"type": "object", "properties": {
                    "label": {"type": "string"}, "x": {"type": "integer"}, "y": {"type": "integer"},
                    "width": {"type": "integer", "minimum": 1}, "height": {"type": "integer", "minimum": 1}
                }, "required": ["label"]}),
            ),
            ToolDefinition::new(
                "window_set_state",
                "Minimize, maximize, restore, hide or show a window.",
                json!({"type": "object", "properties": {
                    "label": {"type": "string"},
                    "state": {"type": "string", "enum": ["minimized", "maximized", "normal", "hidden", "shown"]}
                }, "required": ["label", "state"]}),
            ),
            ToolDefinition::new(
                "window_set_title",
                "Change a window title.",
                json!({"type": "object", "properties": {"label": {"type": "string"}, "title": {"type": "string"}}, "required": ["label", "title"]}),
            ),
            ToolDefinition::new(
                "desktop_notify",
                "Show a native desktop notification.",
                json!({"type": "object", "properties": {"title": {"type": "string"}, "body": {"type": "string"}}, "required": ["title"]}),
            ),
            ToolDefinition::new(
                "clipboard_read",
                "Read the clipboard text.",
                json!({"type": "object"}),
            ),
            ToolDefinition::new(
                "clipboard_write",
                "Replace the clipboard text.",
                json!({"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}),
            ),
        ]
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        match tool {
            "window_list" => {
                let mut windows: Vec<Value> =
                    self.app.webview_windows().values().map(describe).collect();
                windows.sort_by(|a, b| a["label"].as_str().cmp(&b["label"].as_str()));
                Ok(json!(windows))
            }
            "window_open" => {
                let label = arguments
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if label.is_empty()
                    || !label
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                {
                    return Err(SubsystemError::InvalidArguments(
                        "`label`: letters, digits, `-`, `_`".into(),
                    ));
                }
                if self.app.get_webview_window(label).is_some() {
                    let window = self
                        .app
                        .get_webview_window(label)
                        .ok_or_else(|| SubsystemError::Unavailable("window disappeared".into()))?;
                    window.show().map_err(failed)?;
                    window.unminimize().map_err(failed)?;
                    window.set_focus().map_err(failed)?;
                    return Ok(describe(&window));
                }
                let url = arguments
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let url: tauri::Url = url
                    .parse()
                    .map_err(|error| SubsystemError::InvalidArguments(format!("url: {error}")))?;
                if !matches!(url.scheme(), "http" | "https") {
                    return Err(SubsystemError::InvalidArguments(
                        "only http and https URLs open in a window".into(),
                    ));
                }
                let width = integer(&arguments, "width").unwrap_or(1100).max(200);
                let height = integer(&arguments, "height").unwrap_or(760).max(150);
                let title = arguments
                    .get("title")
                    .and_then(Value::as_str)
                    .filter(|title| !title.trim().is_empty())
                    .map(str::to_owned)
                    .unwrap_or_else(|| adaptive_title(&url, label));
                #[allow(clippy::cast_precision_loss)]
                let mut builder =
                    WebviewWindowBuilder::new(&self.app, label, WebviewUrl::External(url))
                        .title(title)
                        .inner_size(width as f64, height as f64);
                if label == "gemini-web" {
                    // Embedded: installed builds have no source tree to read the icon from.
                    let icon =
                        Image::from_bytes(include_bytes!("../icons/icon.ico")).map_err(failed)?;
                    builder = builder.icon(icon).map_err(failed)?;
                }
                let window = builder.build().map_err(failed)?;
                Ok(describe(&window))
            }
            "window_focus" => {
                let window = self.window(&arguments)?;
                window.show().map_err(failed)?;
                window.unminimize().map_err(failed)?;
                window.set_focus().map_err(failed)?;
                Ok(describe(&window))
            }
            "window_close_label" => {
                let window = self.window(&arguments)?;
                window.close().map_err(failed)?;
                Ok(json!({"closed": window.label()}))
            }
            "window_set_bounds" => {
                let window = self.window(&arguments)?;
                if let (Some(x), Some(y)) = (integer(&arguments, "x"), integer(&arguments, "y")) {
                    let x = i32::try_from(x).map_err(failed)?;
                    let y = i32::try_from(y).map_err(failed)?;
                    window
                        .set_position(Position::Physical(PhysicalPosition { x, y }))
                        .map_err(failed)?;
                }
                if let (Some(width), Some(height)) =
                    (integer(&arguments, "width"), integer(&arguments, "height"))
                {
                    let width = u32::try_from(width).map_err(failed)?;
                    let height = u32::try_from(height).map_err(failed)?;
                    window
                        .set_size(Size::Physical(PhysicalSize { width, height }))
                        .map_err(failed)?;
                }
                Ok(describe(&window))
            }
            "window_set_state" => {
                let window = self.window(&arguments)?;
                match arguments
                    .get("state")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                {
                    "minimized" => window.minimize(),
                    "maximized" => window.maximize(),
                    "normal" => window.unmaximize().and_then(|()| window.unminimize()),
                    "hidden" => window.hide(),
                    "shown" => window.show(),
                    other => {
                        return Err(SubsystemError::InvalidArguments(format!(
                            "unknown state `{other}`"
                        )));
                    }
                }
                .map_err(failed)?;
                Ok(describe(&window))
            }
            "window_set_title" => {
                let window = self.window(&arguments)?;
                let title = arguments
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                window.set_title(title).map_err(failed)?;
                Ok(describe(&window))
            }
            "desktop_notify" => {
                let title = arguments
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Aphrody");
                let body = arguments
                    .get("body")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.notify(title, body)?;
                Ok(json!({"shown": true}))
            }
            "clipboard_read" => {
                Ok(json!({"text": self.app.clipboard().read_text().map_err(failed)?}))
            }
            "clipboard_write" => {
                let text = arguments
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                self.app.clipboard().write_text(text).map_err(failed)?;
                Ok(json!({"written": true}))
            }
            other => Err(SubsystemError::UnknownTool(other.to_owned())),
        }
    }

    fn skills(&self) -> Vec<SkillManifest> {
        vec![SkillManifest {
            name: "open_beside".into(),
            description: "Open an isolated Tauri/CEF URL preview on the right half of a 1920x1080 \
                          area and focus it."
                .into(),
            parameters: vec!["label".into(), "url".into()],
            steps: vec![
                SkillStep {
                    tool: "window_open".into(),
                    arguments: json!({"label": "{{label}}", "url": "{{url}}"}),
                },
                SkillStep {
                    tool: "window_set_bounds".into(),
                    arguments: json!({"label": "{{label}}", "x": 960, "y": 0, "width": 960, "height": 1040}),
                },
                SkillStep {
                    tool: "window_focus".into(),
                    arguments: json!({"label": "{{label}}"}),
                },
            ],
        }]
    }

    async fn run(&self, bus: AgentBus) -> Result<(), SubsystemError> {
        let mut events = bus.subscribe();
        loop {
            match events.recv().await {
                Ok(Event { kind, payload, .. }) if kind == "desktop/notify" => {
                    let title = payload
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or("Aphrody");
                    let body = payload
                        .get("body")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if let Err(error) = self.notify(title, body) {
                        log::warn!("desktop/notify: {error}");
                    }
                }
                Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return Ok(()),
            }
        }
    }
}
