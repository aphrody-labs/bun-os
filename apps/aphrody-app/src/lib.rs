// SPDX-License-Identifier: Apache-2.0
//! Aphrody desktop (Tauri 3): the GUI and window manager of Aphrody OS.
//!
//! The agent runs in this process. Agent sessions are served by `aphrody-app-server` over
//! in-memory pipes, owned by [`broker::AppServerBroker`] (JSON-RPC, restart with handshake
//! replay, event routing); model management is the toolkit-free `aphrody-local-ai` hub
//! ([`models`]). No `aphrody` binary is bundled, located or spawned: a panic in the agent is
//! contained by its Tokio task, so it cannot take the window down, and the next request restarts
//! it. The one process the agent still starts is the managed `llama-server`, through a detached
//! daemon that re-executes this very executable ([`llama_daemon`]). The webview sees only
//! allow-listed Tauri commands and the `aphrody://notification` / `aphrody://backend` events.
//!
//! At start the desktop also hosts the Aphrody OS kernel ([`aphrody_kernel`]) with
//! web ([`web_subsystem::WebSubsystem`]: Obscura and the optional MCP provider) and window
//! ([`window::WindowSubsystem`]) subsystems on the local endpoint, or joins the kernel already
//! serving it with the window subsystem.

pub mod broker;
#[cfg(feature = "cef")]
pub mod cef;
pub mod desktop;
pub mod explorer;
pub mod identity;
pub mod integration;
pub mod kits;
pub mod llama_daemon;
pub mod local_ai;
pub mod models;
pub mod parking;
pub mod quickbar;
pub mod runtime;
pub mod runtime_host;
pub mod showcase;
pub mod studio;
#[path = "web_subsystem.rs"]
pub mod web_subsystem;
pub mod webview;
pub mod window;

use std::{
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use aphrody_kernel::{AgentBus, Event, Kernel, SystemSubsystem};
#[cfg(windows)]
use base64::Engine;
use tauri::{Emitter, Manager, PhysicalSize, WebviewWindow};

use crate::broker::AppServerBroker;

/// The bus of the kernel this desktop hosts, for window events.
static BUS: OnceLock<AgentBus> = OnceLock::new();
static TAURI_DRIVER_SESSION: AtomicBool = AtomicBool::new(false);

/// Host the Aphrody OS kernel (web, admin and window subsystems) on the local
/// endpoint, or, when a kernel already serves it, join that kernel with the desktop-owned
/// subsystems only.
async fn start_kernel(app: tauri::AppHandle) {
    let endpoint = aphrody_kernel::transport::default_endpoint();
    let windows: Arc<dyn SystemSubsystem> = Arc::new(window::WindowSubsystem::new(app.clone()));
    let admin: Arc<dyn SystemSubsystem> = Arc::new(aphrody_kernel::AdminSubsystem);
    if aphrody_kernel::transport::connect(&endpoint).await.is_ok() {
        log::info!("joining the kernel at {endpoint}");
        let webviews: Arc<dyn SystemSubsystem> = Arc::new(TauriWebviewSubsystem::new(app.clone()));
        let (windows_result, webviews_result) = tokio::join!(
            aphrody_kernel::client::host_remote(windows, &endpoint),
            aphrody_kernel::client::host_remote(webviews, &endpoint),
        );
        if let Err(error) = windows_result {
            log::error!("desktop subsystem left the kernel: {error}");
        }
        if let Err(error) = webviews_result {
            log::error!("Tauri webview subsystem left the kernel: {error}");
        }
        return;
    }
    let kernel = Kernel::new();
    let _ = BUS.set(kernel.bus());
    let provider =
        match aphrody_kernel::mcp_proxy::McpProxySubsystem::configured_provider(None).await {
            Ok(provider) => provider,
            Err(error) => {
                log::error!("Aphrody Web MCP: {error}");
                None
            }
        };
    for subsystem in [
        Arc::new(web_subsystem::WebSubsystem::new(provider)) as Arc<dyn SystemSubsystem>,
        windows,
        Arc::new(TauriWebviewSubsystem::new(app.clone())) as Arc<dyn SystemSubsystem>,
        admin,
        Arc::new(aphrody_kernel::systemd::SystemdSubsystem::new()) as Arc<dyn SystemSubsystem>,
        Arc::new(aphrody_kernel::coreutils::CoreutilsSubsystem::new()) as Arc<dyn SystemSubsystem>,
        Arc::new(aphrody_kernel::compat::CompatSubsystem::new()) as Arc<dyn SystemSubsystem>,
        Arc::new(aphrody_kernel::InfraSubsystem::new()) as Arc<dyn SystemSubsystem>,
        Arc::new(aphrody_kernel::CloudSubsystem::new()) as Arc<dyn SystemSubsystem>,
    ] {
        if let Err(error) = kernel.register(subsystem).await {
            log::error!("subsystem: {error}");
        }
    }
    log::info!("serving the kernel at {endpoint}");
    if let Err(error) = aphrody_kernel::transport::serve_endpoint(kernel, endpoint).await {
        log::error!("kernel endpoint: {error}");
    }
}

/// Forward one JSON-RPC message to the agent's app-server and return its reply.
/// If `request` contains `id` and `result` or `error`, it is treated as a server-request reply (e.g. approval)
/// and forwarded directly preserving the server ID.
#[tauri::command]
async fn aphrody_rpc(
    broker: tauri::State<'_, AppServerBroker>,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if !request.is_object() {
        return Err("aphrody_rpc expects a JSON-RPC object".into());
    }
    if (request.get("result").is_some() || request.get("error").is_some())
        && request.get("id").is_some()
    {
        broker.reply(request).await?;
        return Ok(serde_json::json!({ "acknowledged": true }));
    }
    if request
        .get("method")
        .and_then(serde_json::Value::as_str)
        .is_none()
    {
        return Err("aphrody_rpc expects a JSON-RPC object with a string `method` or a reply with `id` and `result`/`error`".into());
    }
    broker.call(request).await
}

/// Forward one response to a server-initiated request (such as an approval decision) to the app-server.
#[tauri::command]
async fn aphrody_reply(
    broker: tauri::State<'_, AppServerBroker>,
    response: serde_json::Value,
) -> Result<(), String> {
    broker.reply(response).await
}

/// Subscribe the invoking webview to one thread's streamed notifications.
///
/// Forwards every JSON-RPC notification the app-server emits for `thread_id` (item
/// deltas, tool events, `turn/completed`, ...) over `channel`, in arrival order, on top
/// of the existing [`broker::NOTIFICATION_EVENT`] broadcast. Replaces any previous
/// subscription for the same thread; call `aphrody_session_unstream` (or `thread/close`
/// through [`aphrody_rpc`]) to stop it.
#[tauri::command]
fn aphrody_session_stream(
    broker: tauri::State<'_, AppServerBroker>,
    thread_id: String,
    channel: tauri::ipc::Channel<serde_json::Value>,
) -> Result<(), String> {
    if thread_id.trim().is_empty() {
        return Err("aphrody_session_stream requires a non-empty thread_id".into());
    }
    broker.subscribe(thread_id, channel);
    Ok(())
}

/// Stop streaming notifications for one thread. A no-op when it has no subscription.
#[tauri::command]
fn aphrody_session_unstream(broker: tauri::State<'_, AppServerBroker>, thread_id: String) {
    broker.unsubscribe(&thread_id);
}

/// Return the platform-correct, Tauri-owned Aphrody runtime layout.
#[tauri::command]
fn aphrody_runtime_layout(app: tauri::AppHandle) -> Result<runtime::RuntimeLayout, String> {
    runtime::resolve(&app)
}

/// Static shell and host metadata for the UI header.
#[derive(serde::Serialize)]
struct Meta {
    app_version: &'static str,
    target_os: &'static str,
    target_arch: &'static str,
    family: &'static str,
    /// The executable hosting the agent. The agent runs in process, so this is the desktop
    /// itself (empty when the platform cannot tell). The field keeps its name for existing
    /// readers; it no longer names a separate `aphrody` binary.
    aphrody_bin: String,
    /// How the agent is reached: always `in-process` (see [`broker`]).
    agent_transport: &'static str,
}

#[tauri::command]
fn aphrody_meta() -> Meta {
    Meta {
        app_version: env!("CARGO_PKG_VERSION"),
        target_os: std::env::consts::OS,
        target_arch: std::env::consts::ARCH,
        family: std::env::consts::FAMILY,
        aphrody_bin: std::env::current_exe()
            .map_or_else(|_| String::new(), |exe| exe.display().to_string()),
        agent_transport: "in-process",
    }
}

pub(crate) struct TauriWebviewSubsystem {
    app: tauri::AppHandle,
}

impl TauriWebviewSubsystem {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

#[async_trait::async_trait]
impl SystemSubsystem for TauriWebviewSubsystem {
    fn name(&self) -> &'static str {
        "tauri"
    }
    fn description(&self) -> &'static str {
        "Local Aphrody Tauri webview inspection and automation."
    }
    fn tools(&self) -> Vec<aphrody_subsystem::ToolDefinition> {
        vec![
            aphrody_subsystem::ToolDefinition::new(
                "tauri_window_list",
                "List Aphrody Tauri webview windows and state.",
                serde_json::json!({"type":"object"}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_dom_snapshot",
                "Inspect DOM text and accessible element metadata in a local Aphrody webview.",
                serde_json::json!({"type":"object","properties":{"window_id":{"type":"string"}}}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_find_element",
                "Find DOM elements by CSS selector in a local Aphrody webview.",
                serde_json::json!({"type":"object","properties":{"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["selector"]}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_interact",
                "Click, fill, type, focus or scroll a DOM element in a local Aphrody webview.",
                serde_json::json!({"type":"object","properties":{"action":{"type":"string","enum":["click","fill","type","focus","scroll_into_view"]},"selector":{"type":"string"},"text":{"type":"string"},"window_id":{"type":"string"}},"required":["action","selector"]}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_execute_js",
                "Evaluate JavaScript for explicit local Aphrody UI inspection.",
                serde_json::json!({"type":"object","properties":{"script":{"type":"string"},"window_id":{"type":"string"}},"required":["script"]}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_viewport_read",
                "Read rendered text and viewport dimensions in a local Aphrody webview.",
                serde_json::json!({"type":"object","properties":{"window_id":{"type":"string"}}}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_screenshot",
                "Capture a local Aphrody Tauri window as a PNG image.",
                serde_json::json!({"type":"object","properties":{"window_id":{"type":"string"}}}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_get_styles",
                "Read computed CSS styles for a local Aphrody Tauri element.",
                serde_json::json!({"type":"object","properties":{"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["selector"]}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_keyboard",
                "Dispatch a keydown or keyup event to a local Aphrody Tauri element.",
                serde_json::json!({"type":"object","properties":{"event":{"type":"string","enum":["keydown","keyup"]},"key":{"type":"string"},"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["event","key"]}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_wait_for",
                "Wait for a CSS selector or text to appear in a local Aphrody Tauri webview.",
                serde_json::json!({"type":"object","properties":{"selector":{"type":"string"},"text":{"type":"string"},"timeout_ms":{"type":"integer","minimum":0,"maximum":30000},"window_id":{"type":"string"}}}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_driver_session",
                "Start, stop or inspect the local Tauri automation session.",
                serde_json::json!({"type":"object","properties":{"action":{"type":"string","enum":["start","stop","status"]}},"required":["action"]}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_manage_window",
                "List, inspect or resize a local Tauri window.",
                serde_json::json!({"type":"object","properties":{"action":{"type":"string","enum":["list","info","resize"]},"window_id":{"type":"string"},"width":{"type":"integer","minimum":1},"height":{"type":"integer","minimum":1}},"required":["action"]}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "tauri_read_logs",
                "Read console entries explicitly buffered by a local Aphrody Tauri webview.",
                serde_json::json!({"type":"object","properties":{"window_id":{"type":"string"},"source":{"type":"string","enum":["console"]}}}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "webview_get_pointed_element",
                "Inspect the DOM element at viewport coordinates in a local Tauri webview.",
                serde_json::json!({"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"window_id":{"type":"string"}},"required":["x","y"]}),
            ),
            aphrody_subsystem::ToolDefinition::new(
                "webview_select_element",
                "Select a DOM element by CSS selector and return its geometry in a local Tauri webview.",
                serde_json::json!({"type":"object","properties":{"selector":{"type":"string"},"window_id":{"type":"string"}},"required":["selector"]}),
            ),
        ]
    }
    async fn call(
        &self,
        tool: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, aphrody_subsystem::SubsystemError> {
        if tool == "tauri_driver_session" {
            let action = arguments
                .get("action")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("status");
            let active = match action {
                "start" => {
                    TAURI_DRIVER_SESSION.store(true, Ordering::Release);
                    true
                }
                "stop" => {
                    TAURI_DRIVER_SESSION.store(false, Ordering::Release);
                    false
                }
                "status" => TAURI_DRIVER_SESSION.load(Ordering::Acquire),
                _ => {
                    return Err(aphrody_subsystem::SubsystemError::InvalidArguments(
                        "action must be start, stop or status".into(),
                    ));
                }
            };
            return Ok(
                serde_json::json!({"active":active,"transport":"aphrody-kernel","persistent":true}),
            );
        }
        if tool == "tauri_manage_window" {
            let action = arguments
                .get("action")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("list");
            if action == "list" {
                let windows: Vec<_> = self.app.webview_windows().values().map(|window| serde_json::json!({"label":window.label(),"title":window.title().unwrap_or_default(),"visible":window.is_visible().unwrap_or(false),"focused":window.is_focused().unwrap_or(false)})).collect();
                return Ok(serde_json::json!({"windows":windows}));
            }
            let label = arguments
                .get("window_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("main");
            let window = self.app.get_webview_window(label).ok_or_else(|| {
                aphrody_subsystem::SubsystemError::Unavailable(format!(
                    "Aphrody window {label:?} is unavailable"
                ))
            })?;
            if action == "resize" {
                let width = arguments
                    .get("width")
                    .and_then(serde_json::Value::as_u64)
                    .filter(|value| *value > 0 && *value <= 10000)
                    .ok_or_else(|| {
                        aphrody_subsystem::SubsystemError::InvalidArguments(
                            "width must be between 1 and 10000".into(),
                        )
                    })? as u32;
                let height = arguments
                    .get("height")
                    .and_then(serde_json::Value::as_u64)
                    .filter(|value| *value > 0 && *value <= 10000)
                    .ok_or_else(|| {
                        aphrody_subsystem::SubsystemError::InvalidArguments(
                            "height must be between 1 and 10000".into(),
                        )
                    })? as u32;
                window
                    .set_size(tauri::Size::Physical(PhysicalSize { width, height }))
                    .map_err(|error| {
                        aphrody_subsystem::SubsystemError::Failed(error.to_string())
                    })?;
            } else if action != "info" {
                return Err(aphrody_subsystem::SubsystemError::InvalidArguments(
                    "action must be list, info or resize".into(),
                ));
            }
            let size = window
                .inner_size()
                .map_err(|error| aphrody_subsystem::SubsystemError::Failed(error.to_string()))?;
            return Ok(
                serde_json::json!({"label":window.label(),"title":window.title().unwrap_or_default(),"visible":window.is_visible().unwrap_or(false),"focused":window.is_focused().unwrap_or(false),"width":size.width,"height":size.height}),
            );
        }
        if tool == "tauri_window_list" {
            let mut windows: Vec<_> = self.app.webview_windows().values().map(|window| serde_json::json!({"label":window.label(),"title":window.title().unwrap_or_default(),"url":window.url().map(|url|url.to_string()).unwrap_or_default(),"visible":window.is_visible().unwrap_or(false),"focused":window.is_focused().unwrap_or(false)})).collect();
            windows.sort_by(|a, b| a["label"].as_str().cmp(&b["label"].as_str()));
            return Ok(serde_json::Value::Array(windows));
        }
        let label = arguments
            .get("window_id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("main")
            .to_owned();
        let window = self.app.get_webview_window(&label).ok_or_else(|| {
            aphrody_subsystem::SubsystemError::Unavailable(format!(
                "Aphrody window {label:?} is unavailable"
            ))
        })?;
        if tool == "tauri_read_logs" {
            return webview_eval(&window, "JSON.stringify({source:'console',entries:Array.isArray(window.__APHRODY_MCP_LOGS__)?window.__APHRODY_MCP_LOGS__.slice(-500):[]})".into()).await;
        }
        if tool == "webview_get_pointed_element" {
            let x = arguments
                .get("x")
                .and_then(serde_json::Value::as_f64)
                .ok_or_else(|| {
                    aphrody_subsystem::SubsystemError::InvalidArguments("x is required".into())
                })?;
            let y = arguments
                .get("y")
                .and_then(serde_json::Value::as_f64)
                .ok_or_else(|| {
                    aphrody_subsystem::SubsystemError::InvalidArguments("y is required".into())
                })?;
            return webview_eval(&window, format!("(()=>{{const e=document.elementFromPoint({x},{y});if(!e)return JSON.stringify({{element:null}});const r=e.getBoundingClientRect();return JSON.stringify({{element:{{tag:e.tagName.toLowerCase(),id:e.id||null,classes:e.className&&String(e.className)||null,text:(e.innerText||e.value||'').slice(0,1000),selector:e.id?('#'+CSS.escape(e.id)):e.tagName.toLowerCase(),rect:{{x:r.x,y:r.y,width:r.width,height:r.height}}}}}})}})()" )).await;
        }
        if tool == "webview_select_element" {
            let selector = arguments
                .get("selector")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| {
                    aphrody_subsystem::SubsystemError::InvalidArguments(
                        "selector is required".into(),
                    )
                })?;
            let selector = serde_json::to_string(selector).map_err(|error| {
                aphrody_subsystem::SubsystemError::InvalidArguments(error.to_string())
            })?;
            return webview_eval(&window, format!("(()=>{{const e=document.querySelector({selector});if(!e)throw new Error('selector did not match an element');e.scrollIntoView({{block:'center',inline:'nearest'}});const r=e.getBoundingClientRect();return JSON.stringify({{selected:true,tag:e.tagName.toLowerCase(),text:(e.innerText||e.value||'').slice(0,1000),rect:{{x:r.x,y:r.y,width:r.width,height:r.height}}}})}})()" )).await;
        }
        match tool {
            "tauri_dom_snapshot" => webview_eval(&window, "JSON.stringify({title:document.title,url:location.href,body:document.body?.innerText?.slice(0,30000),elements:[...document.querySelectorAll('button,a,input,textarea,select,[role]')].slice(0,500).map((e,i)=>({ref:String(i+1),tag:e.tagName.toLowerCase(),role:e.getAttribute('role'),name:e.getAttribute('aria-label')||e.innerText||e.value||e.placeholder||'',disabled:!!e.disabled}))})".into()).await,
            "tauri_find_element" => {
                let selector = arguments.get("selector").and_then(serde_json::Value::as_str).ok_or_else(|| aphrody_subsystem::SubsystemError::InvalidArguments("selector is required".into()))?;
                let selector = serde_json::to_string(selector).map_err(|error| aphrody_subsystem::SubsystemError::InvalidArguments(error.to_string()))?;
                webview_eval(&window, format!("JSON.stringify([...document.querySelectorAll({selector})].slice(0,200).map((e,i)=>({{index:i,tag:e.tagName.toLowerCase(),text:(e.innerText||e.value||'').slice(0,1000),ariaLabel:e.getAttribute('aria-label'),role:e.getAttribute('role'),disabled:!!e.disabled}})))")).await
            },
            "tauri_interact" => {
                let action = arguments.get("action").and_then(serde_json::Value::as_str).unwrap_or_default();
                if !matches!(action,"click"|"fill"|"type"|"focus"|"scroll_into_view") { return Err(aphrody_subsystem::SubsystemError::InvalidArguments("unsupported Tauri DOM action".into())); }
                let selector = arguments.get("selector").and_then(serde_json::Value::as_str).ok_or_else(|| aphrody_subsystem::SubsystemError::InvalidArguments("selector is required".into()))?;
                let selector = serde_json::to_string(selector).map_err(|error| aphrody_subsystem::SubsystemError::InvalidArguments(error.to_string()))?;
                let text = serde_json::to_string(arguments.get("text").and_then(serde_json::Value::as_str).unwrap_or_default()).map_err(|error| aphrody_subsystem::SubsystemError::InvalidArguments(error.to_string()))?;
                let action = serde_json::to_string(action).map_err(|error| aphrody_subsystem::SubsystemError::InvalidArguments(error.to_string()))?;
                webview_eval(&window, format!("(()=>{{const e=document.querySelector({selector});if(!e)throw new Error('selector did not match an element');const a={action};if(a==='click')e.click();else if(a==='focus')e.focus();else if(a==='scroll_into_view')e.scrollIntoView({{block:'center'}});else{{const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;if(setter)setter.call(e,{text});else e.textContent={text};e.dispatchEvent(new Event('input',{{bubbles:true}}));e.dispatchEvent(new Event('change',{{bubbles:true}}));}}return JSON.stringify({{ok:true,tag:e.tagName.toLowerCase()}})}})()")).await
            },
            "tauri_execute_js" => {
                let script = arguments.get("script").and_then(serde_json::Value::as_str).ok_or_else(|| aphrody_subsystem::SubsystemError::InvalidArguments("script is required".into()))?;
                webview_eval(&window, script.to_owned()).await
            },
            "tauri_viewport_read" => webview_eval(&window,"JSON.stringify({width:innerWidth,height:innerHeight,title:document.title,text:document.body?.innerText?.slice(0,30000)})".into()).await,
            "tauri_screenshot" => {
                #[cfg(windows)]
                {
                    let title = window.title().map_err(|error| aphrody_subsystem::SubsystemError::Failed(error.to_string()))?;
                    let png = tokio::task::spawn_blocking(move || aphrody_capture::capture_window_by_title(&title))
                        .await
                        .map_err(|error| aphrody_subsystem::SubsystemError::Failed(error.to_string()))?
                        .map_err(|error| aphrody_subsystem::SubsystemError::Failed(error.to_string()))?;
                    Ok(serde_json::json!({"content":[{"type":"image","data":base64::engine::general_purpose::STANDARD.encode(png),"mimeType":"image/png"}],"isError":false}))
                }
                #[cfg(not(windows))]
                {
                    Err(aphrody_subsystem::SubsystemError::Unavailable("native Tauri window screenshots are available on Windows only".into()))
                }
            },
            "tauri_get_styles" => {
                let selector = arguments.get("selector").and_then(serde_json::Value::as_str).ok_or_else(|| aphrody_subsystem::SubsystemError::InvalidArguments("selector is required".into()))?;
                let selector = serde_json::to_string(selector).map_err(|error| aphrody_subsystem::SubsystemError::InvalidArguments(error.to_string()))?;
                webview_eval(&window, format!("(()=>{{const e=document.querySelector({selector});if(!e)throw new Error('selector did not match an element');const c=getComputedStyle(e),r=e.getBoundingClientRect();return JSON.stringify({{tag:e.tagName.toLowerCase(),text:(e.innerText||e.value||'').slice(0,500),rect:{{x:r.x,y:r.y,width:r.width,height:r.height}},styles:{{display:c.display,position:c.position,color:c.color,backgroundColor:c.backgroundColor,fontFamily:c.fontFamily,fontSize:c.fontSize,fontWeight:c.fontWeight,lineHeight:c.lineHeight,margin:c.margin,padding:c.padding,border:c.border,opacity:c.opacity,visibility:c.visibility,zIndex:c.zIndex}}}})}})()" )).await
            },
            "tauri_keyboard" => {
                let event = arguments.get("event").and_then(serde_json::Value::as_str).unwrap_or_default();
                if !matches!(event,"keydown"|"keyup") { return Err(aphrody_subsystem::SubsystemError::InvalidArguments("event must be keydown or keyup".into())); }
                let key = arguments.get("key").and_then(serde_json::Value::as_str).filter(|key|!key.is_empty()&&key.len()<=32).ok_or_else(|| aphrody_subsystem::SubsystemError::InvalidArguments("key must contain 1 to 32 bytes".into()))?;
                let key = serde_json::to_string(key).map_err(|error| aphrody_subsystem::SubsystemError::InvalidArguments(error.to_string()))?;
                let event = serde_json::to_string(event).map_err(|error| aphrody_subsystem::SubsystemError::InvalidArguments(error.to_string()))?;
                let selector = arguments.get("selector").and_then(serde_json::Value::as_str).map(serde_json::to_string).transpose().map_err(|error|aphrody_subsystem::SubsystemError::InvalidArguments(error.to_string()))?;
                let target = selector.map_or_else(|| "document.activeElement".to_owned(), |selector| format!("document.querySelector({selector})"));
                webview_eval(&window,format!("(()=>{{const e={target};if(!e)throw new Error('no focused or selected element');e.dispatchEvent(new KeyboardEvent({event},{{key:{key},bubbles:true,cancelable:true}}));return JSON.stringify({{ok:true,key:{key},event:{event}}})}})()" )).await
            },
            "tauri_wait_for" => {
                let selector = arguments.get("selector").and_then(serde_json::Value::as_str);
                let text = arguments.get("text").and_then(serde_json::Value::as_str);
                if selector.is_none() && text.is_none() { return Err(aphrody_subsystem::SubsystemError::InvalidArguments("selector or text is required".into())); }
                let timeout_ms = arguments.get("timeout_ms").and_then(serde_json::Value::as_u64).unwrap_or(5000).min(30000);
                let selector = selector.map(serde_json::to_string).transpose().map_err(|error|aphrody_subsystem::SubsystemError::InvalidArguments(error.to_string()))?;
                let text = text.map(serde_json::to_string).transpose().map_err(|error|aphrody_subsystem::SubsystemError::InvalidArguments(error.to_string()))?;
                let predicate = match (selector,text) {
                    (Some(selector),Some(text)) => format!("!!document.querySelector({selector})||document.body?.innerText?.includes({text})"),
                    (Some(selector),None) => format!("!!document.querySelector({selector})"),
                    (None,Some(text)) => format!("document.body?.innerText?.includes({text})"),
                    (None,None) => return Err(aphrody_subsystem::SubsystemError::InvalidArguments("selector or text is required".into())),
                };
                let started = tokio::time::Instant::now();
                loop {
                    let found = webview_eval(&window,format!("JSON.stringify({{found:!!({predicate})}})" )).await?.get("found").and_then(serde_json::Value::as_bool).unwrap_or(false);
                    if found { return Ok(serde_json::json!({"found":true})); }
                    if started.elapsed() >= Duration::from_millis(timeout_ms) { return Ok(serde_json::json!({"found":false,"timed_out":true})); }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            },
            _ => Err(aphrody_subsystem::SubsystemError::UnknownTool(tool.into())),
        }
    }
}

async fn webview_eval(
    window: &WebviewWindow,
    script: String,
) -> Result<serde_json::Value, aphrody_subsystem::SubsystemError> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = Arc::new(std::sync::Mutex::new(Some(send)));
    window
        .eval_with_callback(script, move |value| {
            if let Some(send) = send
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take()
            {
                let _ = send.send(value);
            }
        })
        .map_err(|error| aphrody_subsystem::SubsystemError::Failed(error.to_string()))?;
    let value = tokio::time::timeout(Duration::from_secs(15), receive)
        .await
        .map_err(|_| {
            aphrody_subsystem::SubsystemError::Failed("webview evaluation timed out".into())
        })?
        .map_err(|error| aphrody_subsystem::SubsystemError::Failed(error.to_string()))?;
    serde_json::from_str(&value).map_err(|error| {
        aphrody_subsystem::SubsystemError::Failed(format!("webview returned invalid JSON: {error}"))
    })
}

/// Host probe of the yolo-core engine: operating system, architecture and a millisecond timestamp.
#[tauri::command]
fn aphrody_system_stats() -> yolo_core::SystemStats {
    yolo_core::current_system_stats()
}

/// CPU micro-benchmark of the yolo-core engine, run off the UI thread.
#[tauri::command]
async fn aphrody_benchmark(iterations: u32) -> Result<yolo_core::BenchmarkResult, String> {
    tauri::async_runtime::spawn_blocking(move || yolo_core::compute_benchmark(iterations))
        .await
        .map_err(|error| error.to_string())
}

/// Open the M3 showcase window (its compiled Bun sidecar starts on first use).
#[tauri::command]
fn aphrody_showcase_open(window: WebviewWindow) -> Result<(), String> {
    shell_window(&window)?;
    showcase::open(window.app_handle());
    Ok(())
}

/// Capture the primary display after an explicit user action.
#[tauri::command]
async fn aphrody_capture_primary() -> Result<serde_json::Value, String> {
    desktop::capture_primary().await
}

#[tauri::command]
async fn aphrody_windows_host_status() -> Result<serde_json::Value, String> {
    desktop::windows_host_status().await
}

#[tauri::command]
async fn aphrody_windows_host_windows() -> Result<serde_json::Value, String> {
    desktop::windows_host_windows().await
}

#[tauri::command]
async fn aphrody_windows_host_observe() -> Result<serde_json::Value, String> {
    desktop::windows_host_observe().await
}

/// Return the current process working directory for project context.
#[tauri::command]
fn aphrody_system_cwd() -> Result<serde_json::Value, String> {
    desktop::system_cwd()
}

/// List entries in a local workspace directory.
#[tauri::command]
fn aphrody_fs_read_dir(path: Option<String>) -> Result<serde_json::Value, String> {
    desktop::fs_read_dir(path)
}

/// Read text file content safely for preview.
#[tauri::command]
fn aphrody_fs_read_text(path: String) -> Result<serde_json::Value, String> {
    desktop::fs_read_text(path)
}

/// Material shell theme preference.
///
/// `system` delegates the choice to the host OS. The state command reports the
/// effective light or dark theme selected by Tauri/CEF.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum ShellTheme {
    /// Follow the system preference.
    System,
    /// Force the M3 light palette.
    Light,
    /// Force the M3 dark palette.
    Dark,
}

/// Commands exposed solely to the local Aphrody shell title bar.
///
/// The command takes the invoking window instead of a caller-provided label.
/// Together with the main-only Tauri capability and [`shell_window`], this
/// keeps remote CEF previews from controlling any desktop window.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum ShellWindowAction {
    /// Return the current native state.
    State,
    /// Close the Aphrody shell.
    Close,
    /// Minimize the Aphrody shell.
    Minimize,
    /// Maximize the Aphrody shell.
    Maximize,
    /// Restore the shell from a minimized or maximized state.
    Restore,
    /// Toggle maximized state, suitable for a title-bar double click.
    ToggleMaximize,
    /// Show, unminimize and focus the shell.
    Focus,
    /// Begin a native window drag from an M3 title bar drag region.
    StartDragging,
    /// Set the shell fullscreen state.
    Fullscreen {
        /// Fullscreen.
        fullscreen: bool,
    },
    /// Toggle fullscreen state.
    ToggleFullscreen,
    /// Change the M3 palette and the native WebView theme together.
    SetTheme {
        /// Requested theme preference.
        theme: ShellTheme,
    },
}

/// Observable native state for the M3 window controls.
#[derive(Debug, serde::Serialize)]
struct ShellWindowState {
    label: String,
    title: String,
    focused: bool,
    minimized: bool,
    maximized: bool,
    fullscreen: bool,
    decorated: bool,
    /// Effective host theme (`light` or `dark`).
    theme: &'static str,
}

/// Result of an M3 title-bar action.
#[derive(Debug, serde::Serialize)]
struct ShellWindowControlResult {
    closed: bool,
    state: Option<ShellWindowState>,
}

fn shell_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("M3 shell window controls are restricted to the main Aphrody window".into());
    }
    Ok(())
}

fn shell_window_state(window: &WebviewWindow) -> Result<ShellWindowState, String> {
    shell_window(window)?;
    let theme = match window.theme().map_err(|error| error.to_string())? {
        tauri::Theme::Light => "light",
        tauri::Theme::Dark => "dark",
        _ => "dark",
    };
    Ok(ShellWindowState {
        label: window.label().to_owned(),
        title: window.title().map_err(|error| error.to_string())?,
        focused: window.is_focused().map_err(|error| error.to_string())?,
        minimized: window.is_minimized().map_err(|error| error.to_string())?,
        maximized: window.is_maximized().map_err(|error| error.to_string())?,
        fullscreen: window.is_fullscreen().map_err(|error| error.to_string())?,
        decorated: window.is_decorated().map_err(|error| error.to_string())?,
        theme,
    })
}

/// Execute an M3 shell title-bar command for its invoking window.
///
/// This command is intentionally attached to the invoking `WebviewWindow`:
/// the UI cannot target another label, and only `main` has a Tauri capability.
#[tauri::command]
fn aphrody_shell_window(
    window: WebviewWindow,
    action: ShellWindowAction,
) -> Result<ShellWindowControlResult, String> {
    shell_window(&window)?;
    match action {
        ShellWindowAction::State => Ok(()),
        ShellWindowAction::Close => {
            window.close().map_err(|error| error.to_string())?;
            return Ok(ShellWindowControlResult {
                closed: true,
                state: None,
            });
        }
        ShellWindowAction::Minimize => window.minimize(),
        ShellWindowAction::Maximize => window.maximize(),
        ShellWindowAction::Restore => window
            .unmaximize()
            .and_then(|()| window.unminimize())
            .and_then(|()| window.show()),
        ShellWindowAction::ToggleMaximize => {
            if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        ShellWindowAction::Focus => window
            .show()
            .and_then(|()| window.unminimize())
            .and_then(|()| window.set_focus()),
        ShellWindowAction::StartDragging => window.start_dragging(),
        ShellWindowAction::Fullscreen { fullscreen } => window.set_fullscreen(fullscreen),
        ShellWindowAction::ToggleFullscreen => {
            let current = window.is_fullscreen().map_err(|error| error.to_string())?;
            window.set_fullscreen(!current)
        }
        ShellWindowAction::SetTheme { theme } => window.set_theme(match theme {
            ShellTheme::System => None,
            ShellTheme::Light => Some(tauri::Theme::Light),
            ShellTheme::Dark => Some(tauri::Theme::Dark),
        }),
    }
    .map_err(|error| error.to_string())?;
    Ok(ShellWindowControlResult {
        closed: false,
        state: Some(shell_window_state(&window)?),
    })
}

/// Execute a quick ask bar action for the invoking window (the `quickbar` window only).
#[tauri::command]
fn aphrody_quickbar(window: WebviewWindow, action: quickbar::QuickbarAction) -> Result<(), String> {
    quickbar::act(&window, action)
}

/// The one embedded Tauri context (config, capabilities, `ui-dist` assets) shared by the desktop
/// and the isolated runtime host, so the assets are embedded once.
// `tauri::generate_context!()` expands to code that calls `std::process::exit`.
#[allow(clippy::exit)]
fn context() -> tauri::Context {
    tauri::generate_context!()
}

/// Run the isolated CEF host of the light desktop SDK (`--runtime-host`).
///
/// # Errors
///
/// Fails when the session token or policy of the environment is invalid, or the host cannot start.
pub fn run_runtime_host() -> Result<i32, Box<dyn std::error::Error>> {
    runtime_host::tune_linux_display();
    runtime_host::run(context())
}

/// Build and run the desktop application.
pub fn run() {
    tauri::Builder::default()
        // Tauri 3 has no implicit runtime: wry (system webview), or CEF with the `cef` feature.
        .runtime(webview::runtime())
        // single-instance must be the first plugin: a second launch focuses this window.
        // Its callback forwards the second launch's files and `aphrody://` links to this window.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            integration::on_second_instance(app, &args, &cwd);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Every window that starts hidden is parked off-screen (see `parking`): tracking
                // it would persist the parking spot. The pet and the widget keep their own position.
                .with_denylist(&parking::HIDDEN_AT_START)
                // Visibility is owned by the splash flow and the pet/widget preferences.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // The plugin defaults to `Trace`, which floods stdout and the log file with dependency
        // internals (html5ever, selectors, nu_parser: megabytes per minute).
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg(integration::AUTOSTART_FLAG)
                .build(),
        )
        // Endpoints and the minisign public key come from `plugins.updater` in the Tauri
        // config, injected at bundle time by aphrody-ops tauri; a build without them reports
        // the missing configuration from `check` instead of pretending there is no update.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(aphrody_shell_tauri::init())
        // Managed before `setup`: the config windows (splash, pet, widget) are created first and
        // their pages invoke integration commands as soon as they load.
        .manage(integration::Integration::default())
        .manage(models::Pulls::default())
        .setup(|app| {
            // The broker needs the app handle; a command reaching it before this point gets
            // Tauri's "state not managed" error instead of a panic.
            app.manage(AppServerBroker::new(app.handle().clone()));
            tauri::async_runtime::spawn(start_kernel(app.handle().clone()));
            quickbar::register(app.handle());
            integration::setup(app.handle())?;
            if showcase::requested(std::env::args()) {
                showcase::open(app.handle());
            }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "menu_new_session" => {
                let _ = app.emit_to(integration::MAIN, "aphrody://menu/new-session", ());
            }
            "menu_open_file" => {
                let _ = app.emit_to(integration::MAIN, "aphrody://menu/open-file", ());
            }
            "menu_open_folder" => {
                let _ = app.emit_to(integration::MAIN, "aphrody://menu/open-folder", ());
            }
            "menu_quick_ask" => {
                quickbar::toggle(app);
            }
            "menu_toggle_pet" => {
                integration::set_pet(app, !integration::load_prefs(app).pet);
            }
            "menu_toggle_widget" => {
                integration::set_widget(app, !integration::load_prefs(app).widget);
            }
            "menu_docs" => {
                let _ = tauri_plugin_opener::OpenerExt::opener(app)
                    .open_url("https://aphrody.dev/docs", None::<&str>);
            }
            "menu_showcase" => {
                showcase::open(app);
            }
            "menu_updates" => {
                tauri::async_runtime::spawn(integration::check_updates(app.clone()));
            }
            _ => {}
        })
        .on_page_load(|webview, payload| parking::hide_when_loaded(webview, &payload.event()))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Moved(position) = event {
                integration::note_moved(
                    window.app_handle(),
                    window.label(),
                    position.x,
                    position.y,
                );
            }
            if window.label() == integration::MAIN
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                // The tray keeps Aphrody running; "Quit Aphrody" in the tray exits.
                api.prevent_close();
                if let Err(error) = window.hide() {
                    log::error!("main hide on close: {error}");
                }
                return;
            }
            if window.label() == quickbar::LABEL
                && matches!(event, tauri::WindowEvent::Focused(false))
                && let Err(error) = window.hide()
            {
                log::error!("quick ask hide on blur: {error}");
            }
            let kind = match event {
                tauri::WindowEvent::Focused(true) => "window/focused",
                tauri::WindowEvent::Destroyed => "window/closed",
                _ => return,
            };
            if let Some(bus) = BUS.get() {
                bus.publish(Event {
                    source: "window".into(),
                    kind: kind.into(),
                    payload: serde_json::json!({ "label": window.label() }),
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            studio::studio_native_ai_status,
            studio::studio_native_chat,
            studio::studio_google_drive_authorize,
            studio::studio_a2a_fleet_status,
            studio::studio_a2a_send_envelope,
            studio::studio_mcp_tools_list,
            aphrody_meta,
            aphrody_rpc,
            aphrody_reply,
            aphrody_session_stream,
            aphrody_session_unstream,
            aphrody_runtime_layout,
            aphrody_capture_primary,
            aphrody_windows_host_status,
            aphrody_windows_host_windows,
            aphrody_windows_host_observe,
            aphrody_system_cwd,
            aphrody_shell_window,
            aphrody_quickbar,
            aphrody_system_stats,
            aphrody_benchmark,
            aphrody_showcase_open,
            integration::aphrody_app_ready,
            integration::aphrody_take_open_requests,
            integration::aphrody_desktop_integration,
            integration::aphrody_pet,
            integration::aphrody_widget,
            integration::aphrody_check_update,
            integration::aphrody_install_update,
            kits::aphrody_kit_start,
            kits::aphrody_kit_answer,
            kits::aphrody_kit_cancel,
            aphrody_fs_read_dir,
            aphrody_fs_read_text,
            explorer::aphrody_explorer_index_build,
            explorer::aphrody_explorer_search,
            explorer::aphrody_explorer_tree,
            models::aphrody_hardware_telemetry,
            models::aphrody_model_catalog,
            models::aphrody_model_list,
            models::aphrody_model_recommend,
            models::aphrody_model_verify,
            models::aphrody_model_remove,
            models::aphrody_model_store_root,
            models::aphrody_model_pull,
            models::aphrody_model_cancel,
            models::aphrody_model_scan_external,
            identity::aphrody_pet_etat,
            identity::aphrody_pet_frame_png_b64,
            identity::aphrody_pixel_mesurer,
            identity::aphrody_pixel_tokens_css,
            identity::aphrody_pixel_comparer,
            identity::aphrody_pixel_vectoriser,
            identity::aphrody_pixel_planche,
        ])
        .build(context())
        .expect("aphrody desktop: fatal error while building the Tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                showcase::stop(app);
                kits::stop_all();
                integration::flush_positions(app);
            }
            // The agent runs in this process: closing its input lets it join every session, so
            // each rollout is flushed before the process ends (bounded, a stuck turn is dropped).
            if matches!(event, tauri::RunEvent::Exit)
                && let Some(broker) = app.try_state::<AppServerBroker>()
            {
                tauri::async_runtime::block_on(broker.shutdown(Duration::from_secs(5)));
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{ShellTheme, ShellWindowAction};

    #[test]
    fn shell_window_actions_use_a_closed_json_contract() {
        let action: ShellWindowAction =
            serde_json::from_str(r#"{"action":"set_theme","theme":"dark"}"#)
                .expect("set_theme action must deserialize");
        assert!(matches!(
            action,
            ShellWindowAction::SetTheme {
                theme: ShellTheme::Dark
            }
        ));

        for action in [
            "state",
            "close",
            "minimize",
            "maximize",
            "restore",
            "toggle_maximize",
            "focus",
            "start_dragging",
            "toggle_fullscreen",
        ] {
            let action: ShellWindowAction =
                serde_json::from_str(&format!(r#"{{"action":"{action}"}}"#))
                    .unwrap_or_else(|error| panic!("{action} must deserialize: {error}"));
            assert!(!matches!(action, ShellWindowAction::SetTheme { .. }));
        }

        let action: ShellWindowAction =
            serde_json::from_str(r#"{"action":"fullscreen","fullscreen":true}"#)
                .expect("fullscreen action must deserialize");
        assert!(matches!(
            action,
            ShellWindowAction::Fullscreen { fullscreen: true }
        ));
    }

    #[test]
    fn shell_window_actions_reject_unknown_controls_and_themes() {
        assert!(serde_json::from_str::<ShellWindowAction>(r#"{"action":"resize"}"#).is_err());
        assert!(
            serde_json::from_str::<ShellWindowAction>(r#"{"action":"set_theme","theme":"sepia"}"#)
                .is_err()
        );
    }
}
