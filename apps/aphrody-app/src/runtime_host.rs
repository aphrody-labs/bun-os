//! Isolated CEF host of the light desktop SDK (`aphrody-app --runtime-host`, protocol
//! `yolo.desktop/1`). It was the `yolo-desktop` crate; the executable now is the single desktop app.
//! The UI event loop stays on the process main thread; clients receive no Rust objects or browser
//! engine dependencies. Each session runs on its own throwaway CEF profile directory.
use std::collections::{BTreeSet, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, mpsc};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const MAX_FRAME: u64 = 64 * 1024;
const MAX_EVENTS: usize = 256;
const MAX_WINDOWS: usize = 8;
const UI_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Policy {
    grants: BTreeSet<String>,
    allowed_origins: BTreeSet<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    token: String,
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    sequence: u64,
    window: String,
    kind: String,
    data: Value,
}

#[derive(Default)]
struct Events {
    sequence: u64,
    items: VecDeque<Event>,
}

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(|poison| poison.into_inner())
}

impl Events {
    fn push(&mut self, window: &str, kind: &str, data: Value) {
        self.sequence += 1;
        self.items.push_back(Event {
            sequence: self.sequence,
            window: window.into(),
            kind: kind.into(),
            data,
        });
        if self.items.len() > MAX_EVENTS {
            self.items.pop_front();
        }
    }

    fn since(&self, sequence: u64) -> Result<Value, (&'static str, String)> {
        if sequence > self.sequence {
            return Err(("InvalidArgument", "event cursor is in the future".into()));
        }
        if self
            .items
            .front()
            .is_some_and(|first| sequence + 1 < first.sequence)
        {
            return Err((
                "EventGap",
                "event queue overflowed; refresh the window state".into(),
            ));
        }
        Ok(json!({"sequence": self.sequence,
      "events": self.items.iter().filter(|event| event.sequence > sequence).collect::<Vec<_>>() }))
    }
}

type HostResult = Result<Value, (&'static str, String)>;

fn permission(method: &str) -> Option<&'static str> {
    match method {
        "window.create" => Some("window.create"),
        "window.close" | "window.title" | "window.resize" => Some("window.control"),
        "window.info" | "events.read" => Some("window.observe"),
        "shutdown" => None,
        _ => Some("unknown"),
    }
}

fn authorize(policy: &Policy, method: &str) -> HostResult {
    // Creation owns destruction even when mutation rights were not granted.
    if method == "window.close" && policy.grants.contains("window.create") {
        return Ok(Value::Null);
    }
    if let Some(grant) = permission(method)
        && !policy.grants.contains(grant)
    {
        return Err((
            "PermissionDenied",
            format!("desktop grant {grant} is required"),
        ));
    }
    Ok(Value::Null)
}

fn url_for(policy: &Policy, input: &str) -> Result<Url, (&'static str, String)> {
    let url = Url::parse(input).map_err(|error| ("InvalidArgument", error.to_string()))?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || !policy
            .allowed_origins
            .contains(&url.origin().ascii_serialization())
    {
        return Err((
            "PermissionDenied",
            "URL is outside the desktop origin policy".into(),
        ));
    }
    Ok(url)
}

fn string<'a>(params: &'a Value, key: &str) -> Result<&'a str, (&'static str, String)> {
    params[key]
        .as_str()
        .ok_or(("InvalidArgument", format!("{key} must be a string")))
}

fn dimension(params: &Value, key: &str, default: f64) -> Result<f64, (&'static str, String)> {
    let value = match params.get(key) {
        Some(value) => value
            .as_f64()
            .ok_or(("InvalidArgument", format!("{key} must be numeric")))?,
        None => default,
    };
    if !(64.0..=8192.0).contains(&value) {
        return Err(("InvalidArgument", format!("{key} must be 64..8192")));
    }
    Ok(value)
}

fn execute(
    app: &AppHandle,
    policy: &Policy,
    events: &Arc<Mutex<Events>>,
    request: &Request,
) -> HostResult {
    authorize(policy, &request.method)?;
    if request.method == "events.read" {
        let since = request.params["since"]
            .as_u64()
            .ok_or(("InvalidArgument", "since must be an integer".into()))?;
        return lock(events).since(since);
    }
    if request.method == "shutdown" {
        for window in app.webview_windows().values() {
            window
                .destroy()
                .map_err(|error| ("Internal", error.to_string()))?;
        }
        return Ok(json!({"stopped": true}));
    }
    if request.method == "window.create" {
        if app.webview_windows().len() >= MAX_WINDOWS {
            return Err(("Busy", "desktop window limit reached".into()));
        }
        let url = url_for(policy, string(&request.params, "url")?)?;
        let title = string(&request.params, "title")?;
        if title.len() > 1024 {
            return Err(("InvalidArgument", "title is longer than 1024 bytes".into()));
        }
        let label = format!("window-{}", request.id);
        let origin = url.origin();
        let page_events = Arc::clone(events);
        let navigation_events = Arc::clone(events);
        let permission_events = Arc::clone(events);
        let navigation_label = label.clone();
        let permission_label = label.clone();
        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
            .title(title)
            .inner_size(
                dimension(&request.params, "width", 800.0)?,
                dimension(&request.params, "height", 600.0)?,
            )
            .incognito(true)
            // Pages receive no application commands, host token, filesystem, downloads or popups.
            .on_navigation(move |url| {
                let allowed = url.origin() == origin;
                if !allowed {
                    lock(&navigation_events).push(
                        &navigation_label,
                        "navigation-denied",
                        json!({"origin": url.origin().ascii_serialization()}),
                    );
                }
                allowed
            })
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_download(|_, _| false)
            .on_permission_request(move |_, permission| {
                lock(&permission_events).push(
                    &permission_label,
                    "permission-denied",
                    json!({"permission": format!("{permission:?}")}),
                );
                PermissionResponse::Deny
            })
            .on_page_load(move |window, payload| {
                let kind = match payload.event() {
                    PageLoadEvent::Started => "load-started",
                    PageLoadEvent::Finished => "load-finished",
                };
                lock(&page_events).push(window.label(), kind, Value::Null);
            })
            .build()
            .map_err(|error| ("Internal", error.to_string()))?;
        let window_events = Arc::clone(events);
        let event_label = label.clone();
        window.on_window_event(move |event| {
            let kind = match event {
                tauri::WindowEvent::Destroyed => "destroyed",
                tauri::WindowEvent::CloseRequested { .. } => "close-requested",
                tauri::WindowEvent::Resized(_) => "resized",
                tauri::WindowEvent::Focused(_) => "focused",
                _ => return,
            };
            lock(&window_events).push(&event_label, kind, Value::Null);
        });
        lock(events).push(&label, "created", Value::Null);
        return Ok(json!({"window": label}));
    }
    let label = string(&request.params, "window")?;
    let window = app
        .get_webview_window(label)
        .ok_or(("InvalidHandle", "window has been destroyed".into()))?;
    match request.method.as_str() {
        "window.close" => window.destroy().map(|()| Value::Null),
        "window.title" => {
            let title = string(&request.params, "title")?;
            if title.len() > 1024 {
                return Err(("InvalidArgument", "title is longer than 1024 bytes".into()));
            }
            window.set_title(title).map(|()| Value::Null)
        }
        "window.resize" => window
            .set_size(tauri::LogicalSize::new(
                dimension(&request.params, "width", 800.0)?,
                dimension(&request.params, "height", 600.0)?,
            ))
            .map(|()| Value::Null),
        "window.info" => {
            let size = window
                .inner_size()
                .map_err(|error| ("Internal", error.to_string()))?;
            Ok(
                json!({"window": label, "width": size.width, "height": size.height,
        "visible": window.is_visible().map_err(|error| ("Internal", error.to_string()))?}),
            )
        }
        _ => return Err(("InvalidArgument", "unknown desktop method".into())),
    }
    .map_err(|error| ("Internal", error.to_string()))
}

fn serve_client(
    stream: &mut TcpStream,
    app: &AppHandle,
    token: &str,
    policy: &Arc<Policy>,
    events: &Arc<Mutex<Events>>,
) -> Result<bool, Box<dyn std::error::Error>> {
    stream.set_read_timeout(Some(Duration::from_millis(750)))?;
    stream.set_write_timeout(Some(Duration::from_millis(750)))?;
    let mut bytes = Vec::new();
    use std::io::Read;
    BufReader::new((&mut *stream).take(MAX_FRAME + 1)).read_until(b'\n', &mut bytes)?;
    if bytes.len() as u64 > MAX_FRAME || bytes.last() != Some(&b'\n') {
        return Ok(false);
    }
    let request: Request = serde_json::from_slice(&bytes)?;
    if request.token != token {
        serde_json::to_writer(
            &mut *stream,
            &json!({"id": request.id, "error": {"code": "PermissionDenied", "message": "invalid desktop session"}}),
        )?;
        stream.write_all(b"\n")?;
        return Ok(false);
    }
    let id = request.id;
    let shutdown = request.method == "shutdown";
    let create = request.method == "window.create";
    let cancelled = Arc::new(AtomicBool::new(false));
    let ui_cancelled = Arc::clone(&cancelled);
    let ui_app = app.clone();
    let policy = Arc::clone(policy);
    let events = Arc::clone(events);
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        if ui_cancelled.load(Ordering::Acquire) {
            return;
        }
        let result = execute(&ui_app, &policy, &events, &request);
        // If a create completed after its receiver timed out, its resource must not survive.
        if ui_cancelled.load(Ordering::Acquire) {
            if request.method == "window.create"
                && let Some(window) = ui_app.get_webview_window(&format!("window-{id}"))
            {
                let _ = window.destroy();
            }
            return;
        }
        if sender.send(result).is_err()
            && request.method == "window.create"
            && let Some(window) = ui_app.get_webview_window(&format!("window-{id}"))
        {
            let _ = window.destroy();
        }
    })?;
    let result = receiver.recv_timeout(UI_TIMEOUT).unwrap_or_else(|_| {
        cancelled.store(true, Ordering::Release);
        Err(("Timeout", "desktop UI dispatch timed out".into()))
    });
    let stopped = shutdown && result.is_ok();
    let created = create && result.is_ok();
    let reply = match result {
        Ok(result) => json!({"id": id, "result": result}),
        Err((code, message)) => json!({"id": id, "error": {"code": code, "message": message}}),
    };
    let frame = serde_json::to_vec(&reply)?;
    let written = (|| -> std::io::Result<()> {
        if frame.len() as u64 >= MAX_FRAME {
            serde_json::to_writer(
                &mut *stream,
                &json!({"id": id, "error": {"code": "OutputLimit", "message": "desktop reply exceeds 64 KiB"}}),
            )?;
        } else {
            stream.write_all(&frame)?;
        }
        stream.write_all(b"\n")
    })();
    if written.is_err() && created {
        let cleanup_app = app.clone();
        app.run_on_main_thread(move || {
            if let Some(window) = cleanup_app.get_webview_window(&format!("window-{id}")) {
                let _ = window.destroy();
            }
        })?;
    }
    // A disconnected shutdown caller still owns shutdown; do not keep an empty engine alive.
    if stopped {
        return Ok(true);
    }
    written?;
    Ok(false)
}

/// Launch flag printing the build identity of the executable (artifact qualification).
pub const HOST_INFO_FLAG: &str = "--host-info";
/// Launch flag starting the isolated runtime host instead of the desktop.
pub const RUNTIME_HOST_FLAG: &str = "--runtime-host";

/// Whether `flag` is among the launch arguments.
pub fn has_flag(args: impl IntoIterator<Item = impl AsRef<std::ffi::OsStr>>, flag: &str) -> bool {
    args.into_iter().any(|arg| arg.as_ref() == flag)
}

/// Build identity answered by `--host-info`. The artifact name and protocol stay the
/// `yolo-desktop` / `yolo.desktop/1` contract the Yolo runtime SDK verifies.
pub fn host_info() -> Value {
    json!({
      "name": "yolo-desktop", "version": env!("CARGO_PKG_VERSION"),
      "protocol": "yolo.desktop/1", "target": env!("YOLO_DESKTOP_TARGET"),
      "git_rev": env!("YOLO_DESKTOP_GIT_REV"), "rustc": env!("YOLO_DESKTOP_RUSTC"),
      "panic_recovery": cfg!(panic = "unwind"), "engine": crate::webview::ENGINE
    })
}

/// Linux display tuning for NVIDIA/WSL drivers: the explicit-sync path of XWayland must not crash the
/// compositor. CEF runs on X11 (XWayland under Wayland), so no WebKitGTK variable applies. Call it at
/// the start of `main`, before any thread or CEF exists.
pub fn tune_linux_display() {
    #[cfg(target_os = "linux")]
    {
        const NAME: &str = "__NV_DISABLE_EXPLICIT_SYNC";
        if std::env::var_os(NAME).is_none() {
            // SAFETY: called from the process main thread before any other thread is spawned.
            unsafe { std::env::set_var(NAME, "1") };
        }
    }
}

/// Runs the precompiled desktop engine. All clients of one session have the same explicit
/// host-owned grants and origin policy; web pages cannot obtain the session token.
pub fn run(mut context: tauri::Context) -> Result<i32, Box<dyn std::error::Error>> {
    let token = std::env::var("YOLO_DESKTOP_TOKEN")?;
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid desktop session token".into());
    }
    let policy: Policy = serde_json::from_str(&std::env::var("YOLO_DESKTOP_POLICY")?)?;
    if policy.grants.iter().any(|grant| {
        !["window.create", "window.control", "window.observe"].contains(&grant.as_str())
    }) {
        return Err("unknown desktop grant".into());
    }
    for origin in &policy.allowed_origins {
        let url =
            url_for(&policy, origin).map_err(|(code, message)| format!("{code}: {message}"))?;
        if origin != &url.origin().ascii_serialization() {
            return Err("desktop policy requires canonical URL origins".into());
        }
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let stopping = Arc::new(AtomicBool::new(false));
    let worker = Arc::new(Mutex::new(None));
    let setup_worker = Arc::clone(&worker);
    let setup_stopping = Arc::clone(&stopping);
    let events = Arc::new(Mutex::new(Events::default()));
    let policy = Arc::new(policy);
    context.config_mut().app.windows.clear();
    let session = crate::webview::session_dir();
    let app = tauri::Builder::default().runtime(crate::webview::runtime_host(&session)?).setup(move |app| {
    let app = app.handle().clone();
    *lock(&setup_worker) = Some(thread::Builder::new().name("yolo-desktop-control".into()).spawn(move || {
      while !setup_stopping.load(Ordering::Acquire) {
        match listener.accept() {
          Ok((mut stream, _)) => {
            if let Ok(true) = serve_client(&mut stream, &app, &token, &policy, &events) {
              setup_stopping.store(true, Ordering::Release);
              app.exit(0);
            }
          },
          Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(5)),
          Err(_) => { app.exit(1); break; },
        }
      }
    })?);
    println!("{}", json!({"protocol": "yolo.desktop/1", "port": port, "maxWindows": MAX_WINDOWS, "maxEvents": MAX_EVENTS}));
    std::io::stdout().flush()?;
    Ok(())
  }).build(context)?;
    let exit_stopping = Arc::clone(&stopping);
    let code = app.run_return(move |_, event| match event {
        tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        tauri::RunEvent::Exit => {
            exit_stopping.store(true, Ordering::Release);
        }
        _ => {}
    });
    stopping.store(true, Ordering::Release);
    let joined = lock(&worker).take().map(|worker| worker.join());
    // The profile only lives for this session; best effort, the OS temp cleaner takes the rest.
    let _ = std::fs::remove_dir_all(&session);
    if let Some(Err(_)) = joined {
        return Err("desktop control worker panicked".into());
    }
    Ok(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> Policy {
        Policy {
            grants: BTreeSet::from(["window.create".into()]),
            allowed_origins: BTreeSet::from([
                "https://example.test".into(),
                "http://127.0.0.1:1420".into(),
            ]),
        }
    }

    #[test]
    fn native_policy_denies_undeclared_grants_and_origins() {
        assert!(authorize(&policy(), "window.create").is_ok());
        assert_eq!(
            authorize(&policy(), "window.title").unwrap_err().0,
            "PermissionDenied"
        );
        assert!(url_for(&policy(), "https://example.test/page").is_ok());
        for url in [
            "https://evil.test",
            "https://user@example.test",
            "file:///tmp/page.html",
            "javascript:alert(1)",
            "http://example.test",
        ] {
            assert_eq!(url_for(&policy(), url).unwrap_err().0, "PermissionDenied");
        }
    }

    #[test]
    fn event_overflow_is_explicit_and_window_dimensions_are_bounded() {
        let mut events = Events::default();
        for _ in 0..=MAX_EVENTS {
            events.push("window-1", "focused", Value::Null);
        }
        assert_eq!(events.items.len(), MAX_EVENTS);
        assert_eq!(events.since(0).unwrap_err().0, "EventGap");
        assert!(events.since(1).is_ok());
        assert!(dimension(&json!({"width": 12}), "width", 800.0).is_err());
        assert!(dimension(&json!({"width": "100"}), "width", 800.0).is_err());
    }
}
