// SPDX-License-Identifier: Apache-2.0
//! Codex-shaped local app-server for Aphrody.
//!
//! The wire contract is deliberately provider-neutral: JSON-RPC 2.0 requests
//! manage threads and start turns, while the implementation always uses the
//! local, keyless Aphrody runtime. This lets the CLI, TUI and web GUI share a
//! single session boundary without depending on OpenAI cloud services.

#![forbid(unsafe_code)]

mod config;
#[path = "google_search.rs"]
mod google_search;
mod host_tools;
#[path = "web.rs"]
pub mod web;

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    net::SocketAddr,
    sync::Arc,
};

use aphrody_agent_home::{AgentHome, BootstrapBudget, HomeOptions};
use aphrody_agent_proto::{Event, EventMsg, InputItem, Op};
use aphrody_agent_runtime::{
    AgentRuntime, ModelChoice, ModelFactory, ProviderLease, build_profiled_tool_registry,
    build_tool_registry, prepare_managed_provider_in,
};
use aphrody_app_protocol::{
    ClientRequest, ConfigReadParams, InitializeParams, JSONRPCError, JSONRPCNotification,
    JSONRPCRequest, JSONRPCResponse, ListMcpServerStatusParams, LlamaStatusResponse,
    LoginAccountParams, ModelListParams, RequestId, ShutdownResponse, ThreadArchiveParams,
    ThreadCloseParams, ThreadCloseResponse, ThreadCompactStartParams, ThreadCompactStartResponse,
    ThreadForkParams, ThreadListParams, ThreadReadParams, ThreadResumeParams, ThreadStartParams,
    ThreadUnarchiveParams, ThreadUnarchiveResponse, ToolsListParams, TrainStatusResponse,
    TurnEventsParams, TurnEventsResponse, TurnInterruptParams, TurnStartParams, TurnSteerParams,
    UserInput,
};
#[cfg(feature = "rag")]
use aphrody_app_protocol::{
    RagContextParams, RagContextResponse, RagSearchParams, RagSearchResponse, RagSearchResult,
    RagStatusResponse,
};
#[cfg(feature = "rag")]
use aphrody_rag::{RagContextTool, RagSearcher, RagStore};
#[cfg(feature = "rag")]
use aphrody_toolcall::ToolExecutor;
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{
        IntoResponse, Response,
        sse::{Event as SseEvent, KeepAlive, Sse},
    },
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt},
    sync::{Mutex, mpsc::UnboundedReceiver},
};

#[derive(Debug, Error)]
pub enum AppServerError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("method not found: {0}")]
    MethodNotFound(String),
    #[error("method failed: {0}")]
    Runtime(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Deserialize)]
struct RpcRequest {
    #[serde(default)]
    id: Option<RequestId>,
    method: String,
    #[serde(default)]
    params: Value,
}

/// Map wire-method aliases onto their canonical contract name. Runs once,
/// before the known-method check and contract parsing.
fn canonical_method(method: &str) -> &str {
    match method {
        "models/list" => "model/list",
        "aphrody/notifications" => "notifications/drain",
        "system/status" => "aphrody/status",
        other => other,
    }
}

/// Every wire method of `ClientRequest` (see `ClientRequest::method_name`).
const KNOWN_METHODS: &[&str] = &[
    "initialize",
    "thread/start",
    "thread/resume",
    "thread/fork",
    "thread/list",
    "thread/read",
    "thread/archive",
    "thread/unarchive",
    "thread/close",
    "thread/compact/start",
    "turn/start",
    "turn/steer",
    "turn/interrupt",
    "turn/events",
    "model/list",
    "config/read",
    "account/login/start",
    "account/read",
    "account/logout",
    "mcpServerStatus/list",
    "tools/list",
    "notifications/drain",
    "shutdown",
    "aphrody/status",
    "aphrody/rag/search",
    "aphrody/rag/context",
    "aphrody/rag/status",
    "aphrody/llama/status",
    "aphrody/train/status",
];

/// Parse an alias-normalized method into the typed contract request.
/// Unknown method -> `MethodNotFound`; known method with bad params ->
/// `InvalidRequest`.
fn parse_client_request(
    id: RequestId,
    method: &str,
    params: &Value,
) -> Result<ClientRequest, AppServerError> {
    if !KNOWN_METHODS.contains(&method) {
        return Err(AppServerError::MethodNotFound(method.to_owned()));
    }
    let params = (!params.is_null()).then(|| params.clone());
    match ClientRequest::from_jsonrpc(JSONRPCRequest::new(id.clone(), method, params)) {
        Ok(request) => Ok(request),
        Err(error) => lenient_client_request(id, method)
            .ok_or_else(|| AppServerError::InvalidRequest(error.to_string())),
    }
}

/// Routing carrier for methods whose handler validates the raw `params`
/// itself (precise legacy `-32602` messages, legacy shapes such as a string
/// `turn/start` input or an `initialize` without `clientInfo`). The typed
/// contract params are stricter than what this server has always accepted, so
/// when strict parsing fails for these methods the request is still routed
/// with placeholder typed params; the handler never reads them and works from
/// the raw value. Methods that consume their typed params directly are not
/// listed and stay strictly validated.
fn lenient_client_request(id: RequestId, method: &str) -> Option<ClientRequest> {
    Some(match method {
        "initialize" => ClientRequest::Initialize {
            id,
            params: InitializeParams::default(),
        },
        "thread/start" => ClientRequest::ThreadStart {
            id,
            params: ThreadStartParams::default(),
        },
        "thread/resume" => ClientRequest::ThreadResume {
            id,
            params: ThreadResumeParams::default(),
        },
        "thread/fork" => ClientRequest::ThreadFork {
            id,
            params: ThreadForkParams::default(),
        },
        "thread/list" => ClientRequest::ThreadList {
            id,
            params: ThreadListParams::default(),
        },
        "thread/read" => ClientRequest::ThreadRead {
            id,
            params: ThreadReadParams::default(),
        },
        "thread/archive" => ClientRequest::ThreadArchive {
            id,
            params: ThreadArchiveParams::default(),
        },
        "thread/compact/start" => ClientRequest::ThreadCompactStart {
            id,
            params: ThreadCompactStartParams::default(),
        },
        "turn/start" => ClientRequest::TurnStart {
            id,
            params: TurnStartParams::default(),
        },
        "turn/steer" => ClientRequest::TurnSteer {
            id,
            params: TurnSteerParams {
                thread_id: String::new(),
                turn_id: String::new(),
                input: Vec::new(),
            },
        },
        "turn/interrupt" => ClientRequest::TurnInterrupt {
            id,
            params: TurnInterruptParams {
                thread_id: String::new(),
                turn_id: String::new(),
            },
        },
        "model/list" => ClientRequest::ModelList {
            id,
            params: ModelListParams::default(),
        },
        "config/read" => ClientRequest::ConfigRead {
            id,
            params: ConfigReadParams::default(),
        },
        "account/login/start" => ClientRequest::AccountLoginStart {
            id,
            params: LoginAccountParams::default(),
        },
        "mcpServerStatus/list" => ClientRequest::McpServerStatusList {
            id,
            params: ListMcpServerStatusParams::default(),
        },
        "tools/list" => ClientRequest::ToolsList {
            id,
            params: ToolsListParams::default(),
        },
        _ => return None,
    })
}

/// `aphrody/llama/status`: the managed llama-server state published by its
/// daemon. Roles are checked in the order chat, embed, rerank and the first
/// ready instance is reported (chat is the primary role). `discover_running`
/// already verifies the daemon process is alive; `running` additionally
/// requires the server to have finished loading (`ready`). RunState carries
/// no VRAM figure, so `vram_usage_mib` stays `None`.
fn llama_status() -> LlamaStatusResponse {
    use aphrody_llama_server::{Role, discover_running};
    [Role::Chat, Role::Embed, Role::Rerank]
        .into_iter()
        .filter_map(discover_running)
        .find(|state| state.ready)
        .map_or_else(LlamaStatusResponse::default, |state| LlamaStatusResponse {
            running: true,
            pid: Some(state.server_pid),
            port: Some(state.port),
            active_model: Some(state.alias),
            vram_usage_mib: None,
        })
}

/// `aphrody/train/status`: `active` mirrors `aphrody train status`
/// (`gpu_lock_active`): the GPU training lock file exists under the state
/// directory's `locks/`. `job_id`, `step` and `total_steps` stay `None`:
/// `aphrody-train` streams `TrainEvent`s only to the launching process and
/// persists no per-job state a separate process could read. Filling them in
/// needs a `RunState`-style published state file in `aphrody-train`
/// (mirroring `aphrody-llama-server`'s `state.rs`); that is follow-up work.
fn train_status() -> TrainStatusResponse {
    let active = aphrody_models::paths::state_dir()
        .is_ok_and(|state_dir| state_dir.join("locks").join("gpu.lock").exists());
    TrainStatusResponse {
        active,
        ..TrainStatusResponse::default()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadInfo {
    id: String,
    created_at: u64,
    model: String,
    cwd: String,
    updated_at: u64,
    preview: String,
    ephemeral: bool,
    archived: bool,
    model_provider: String,
    status: Value,
    source: &'static str,
    cli_version: &'static str,
    turns: Vec<Value>,
}

#[derive(Debug)]
pub struct AppServer {
    threads: BTreeMap<String, ThreadState>,
    initialized: bool,
    initialize_received: bool,
    aphrody_extensions: bool,
    notifications: Vec<Value>,
    base_home: std::path::PathBuf,
    home: std::path::PathBuf,
    profile: Option<String>,
    /// Model store root chosen by the embedding host (see [`AppServer::with_models_dir`]).
    /// `None` keeps the default resolution: `$APHRODY_MODELS_DIR`, else `<state dir>/models`.
    models_dir: Option<std::path::PathBuf>,
    #[cfg(test)]
    test_home: Option<tempfile::TempDir>,
}

impl Default for AppServer {
    fn default() -> Self {
        Self::with_home(config::state_home())
    }
}

#[derive(Debug)]
struct ThreadState {
    info: ThreadInfo,
    events: UnboundedReceiver<Event>,
    handle: aphrody_engine::SessionHandle,
    _provider_lease: ProviderLease,
    active_turn: Option<Value>,
    is_compaction: bool,
    interrupt_requested: bool,
    message_started: bool,
    /// Tool calls started but not yet finished, keyed by provider call id.
    /// A tool call is only reported as an item once it ends, so begin/end
    /// must be correlated across two events.
    open_tool_calls: HashMap<String, (String, String)>,
    host_tools: host_tools::HostTools,
    tools: Arc<aphrody_toolcall::ToolRegistry>,
}

impl AppServer {
    fn dispatch_host_tools(
        &mut self,
        method: &str,
        params: &Value,
    ) -> Result<Value, AppServerError> {
        let thread_id = params
            .get("threadId")
            .and_then(Value::as_str)
            .ok_or_else(|| AppServerError::InvalidRequest("threadId is required".into()))?;
        let thread = self
            .threads
            .get_mut(thread_id)
            .ok_or_else(|| AppServerError::InvalidRequest("unknown thread".into()))?;
        match method {
            "tool/respond" | "permission/respond" => {
                let request_id =
                    params
                        .get("requestId")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            AppServerError::InvalidRequest("requestId is required".into())
                        })?;
                thread.host_tools.respond(request_id, params)?;
                Ok(json!({"accepted":true}))
            }
            "thread/tools/get" => thread.host_tools.view(),
            "thread/tools/set" => {
                if thread.active_turn.is_some() {
                    return Err(AppServerError::InvalidRequest(
                        "host tools cannot change during a turn".into(),
                    ));
                }
                let next = host_tools::HostTools::declare(thread_id, params.get("tools"))?
                    .with_host_permission(thread.host_tools.host_owns_gate());
                let prior_names: BTreeSet<_> = thread
                    .host_tools
                    .executors()?
                    .iter()
                    .map(|tool| tool.definition().name.clone())
                    .collect();
                let mut registry = aphrody_toolcall::ToolRegistry::new();
                for definition in thread.tools.definitions() {
                    if !prior_names.contains(&definition.name)
                        && let Some(tool) = thread.tools.get(&definition.name)
                    {
                        registry
                            .register(tool)
                            .map_err(|error| AppServerError::InvalidRequest(error.to_string()))?;
                    }
                }
                for tool in next.executors()? {
                    registry
                        .register(tool)
                        .map_err(|error| AppServerError::InvalidRequest(error.to_string()))?;
                }
                let registry = Arc::new(registry);
                thread
                    .handle
                    .replace_tools(registry.clone())
                    .map_err(|_| AppServerError::Runtime("session actor stopped".into()))?;
                thread.host_tools.cancel_all();
                thread.host_tools = next;
                thread.tools = registry;
                thread.host_tools.view()
            }
            _ => Err(AppServerError::MethodNotFound(method.into())),
        }
    }

    fn read_account(&self, params: &Value) -> Result<Value, AppServerError> {
        if !params.is_null() && !params.as_object().is_some_and(serde_json::Map::is_empty) {
            return Err(AppServerError::InvalidRequest(
                "account/read does not accept parameters".into(),
            ));
        }
        let resolved =
            config::resolve_with_profile(&self.base_home, &json!({}), self.profile.as_deref())?;
        let local = resolved.provider.info.managed.is_some();
        let account = aphrody_app_protocol::GetAccountResponse {
            auth_mode: local.then_some(aphrody_app_protocol::AuthMode::Oss),
            email: None,
            plan: local.then(|| "oss".to_owned()),
        };
        serde_json::to_value(account).map_err(Into::into)
    }

    fn start_account_login(&self, params: &Value) -> Result<Value, AppServerError> {
        let request: aphrody_app_protocol::LoginAccountParams =
            serde_json::from_value(params.clone())
                .map_err(|error| AppServerError::InvalidRequest(error.to_string()))?;
        match request.mode {
            Some(aphrody_app_protocol::AuthMode::Oss) => {
                if request.api_key.is_some() {
                    return Err(AppServerError::InvalidRequest(
                        "OSS login does not accept an API key".into(),
                    ));
                }
                let resolved = config::resolve_with_profile(
                    &self.base_home,
                    &json!({"oss": true}),
                    self.profile.as_deref(),
                )?;
                if resolved.provider.info.managed.is_none() {
                    return Err(AppServerError::InvalidRequest(
                        "OSS login requires a locally managed provider".into(),
                    ));
                }
                Ok(json!({"completed": true, "loginUrl": null}))
            }
            Some(aphrody_app_protocol::AuthMode::ApiKey) => Err(AppServerError::InvalidRequest(
                "API key login requires a credential store and is unavailable".into(),
            )),
            Some(
                aphrody_app_protocol::AuthMode::Chatgpt | aphrody_app_protocol::AuthMode::Headers,
            )
            | None => Err(AppServerError::InvalidRequest(
                "requested account login mode is unavailable".into(),
            )),
        }
    }

    fn read_config(&self, params: &Value) -> Result<Value, AppServerError> {
        let request: aphrody_app_protocol::ConfigReadParams =
            serde_json::from_value(params.clone())
                .map_err(|error| AppServerError::InvalidRequest(error.to_string()))?;
        if request.thread_id.is_some() {
            return Err(AppServerError::InvalidRequest(
                "thread-scoped config inspection is not available".into(),
            ));
        }
        let resolved =
            config::resolve_with_profile(&self.base_home, &json!({}), self.profile.as_deref())?;
        let mut config = serde_json::Map::new();
        config.insert("model".into(), json!(resolved.model));
        config.insert("model_provider".into(), json!(resolved.provider.id));
        config.insert("approval_policy".into(), json!(resolved.approval_policy));
        config.insert("sandbox_mode".into(), json!(resolved.sandbox_mode));
        config.insert(
            "model_context_window".into(),
            json!(resolved.model_context_window),
        );
        config.insert(
            "model_auto_compact_token_limit".into(),
            json!(resolved.model_auto_compact_token_limit),
        );
        config.insert(
            "model_reasoning_effort".into(),
            json!(resolved.model_reasoning_effort),
        );
        config.insert(
            "model_reasoning_summary".into(),
            json!(resolved.model_reasoning_summary),
        );
        config.insert("model_verbosity".into(), json!(resolved.model_verbosity));
        let source = self.base_home.join("config.toml");
        let config_path = source
            .is_file()
            .then(|| source.to_string_lossy().into_owned());
        Ok(json!({"config": config, "configPath": config_path}))
    }

    fn list_mcp_server_status(&self, params: &Value) -> Result<Value, AppServerError> {
        let config =
            config::resolve_with_profile(&self.base_home, &json!({}), self.profile.as_deref())?;
        if params.get("cursor").is_some_and(|cursor| !cursor.is_null()) {
            return Err(AppServerError::InvalidRequest(
                "MCP server status pagination is not supported by this protocol version".into(),
            ));
        }
        let servers = config.mcp_servers
            .iter()
            .map(|(name, server)| {
                json!({
                    "name": name,
                    // No MCP connection manager is retained by this app-server.
                    "status": if server.enabled { "unknown" } else { "disabled" },
                    "toolCount": 0,
                    "error": if server.enabled { Some("MCP runtime inventory unavailable") } else { None },
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({"servers": servers}))
    }

    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Select the base configuration and state directory. `initialize` may
    /// derive a profile-isolated workspace below it.
    #[must_use]
    pub fn with_home(home: impl Into<std::path::PathBuf>) -> Self {
        let home = home.into();
        Self {
            threads: BTreeMap::new(),
            initialized: false,
            initialize_received: false,
            aphrody_extensions: false,
            notifications: Vec::new(),
            base_home: home.clone(),
            home,
            profile: None,
            models_dir: None,
            #[cfg(test)]
            test_home: None,
        }
    }

    /// Select the model store root used to resolve and download the weights of managed local
    /// models.
    ///
    /// A host that embeds the server in its own process (the desktop) passes the folder the
    /// user chose instead of exporting `APHRODY_MODELS_DIR`: mutating the process environment
    /// is `unsafe` in edition 2024 and racy next to other threads. A `None` root, the default,
    /// keeps `$APHRODY_MODELS_DIR`, else `<state dir>/models`.
    #[must_use]
    pub fn with_models_dir(mut self, models_dir: impl Into<std::path::PathBuf>) -> Self {
        self.models_dir = Some(models_dir.into());
        self
    }

    /// The model store root selected with [`AppServer::with_models_dir`], if any.
    #[must_use]
    pub fn models_dir(&self) -> Option<&std::path::Path> {
        self.models_dir.as_deref()
    }

    /// Stop every session and wait for its rollout recorder to flush before
    /// the enclosing runtime or process exits.
    pub async fn shutdown(&mut self) -> Result<(), AppServerError> {
        let threads = std::mem::take(&mut self.threads);
        for thread in threads.values() {
            thread.host_tools.cancel_all();
            let _ = thread.handle.submit(Op::Shutdown);
        }
        let mut failure = None;
        for thread in threads.into_values() {
            if let Err(error) = thread.handle.join().await {
                failure.get_or_insert_with(|| AppServerError::Runtime(error.to_string()));
            }
        }
        self.notifications.clear();
        failure.map_or(Ok(()), Err)
    }

    fn archive_marker(&self, thread_id: &str) -> std::path::PathBuf {
        let encoded = thread_id
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        self.home.join("archived-threads").join(encoded)
    }

    async fn is_archived(&self, thread_id: &str) -> bool {
        tokio::fs::try_exists(self.archive_marker(thread_id))
            .await
            .unwrap_or(false)
    }

    async fn start_thread(
        &mut self,
        mut params: Value,
        restored: Option<aphrody_rollout::SessionSummary>,
        forked_from: Option<String>,
    ) -> Result<Value, AppServerError> {
        validate_policy(&params)?;
        if params.is_null() {
            params = json!({});
        }
        if let Some(session) = &restored {
            if params.get("modelProvider").is_none_or(Value::is_null) {
                params["modelProvider"] = json!(session.meta.model_provider);
            }
            if params.get("model").is_none_or(Value::is_null) {
                params["model"] = json!(session.meta.model);
            }
            if params.get("cwd").is_none_or(Value::is_null) {
                params["cwd"] = json!(session.meta.cwd);
            }
        }
        let mut resolved =
            config::resolve_with_profile(&self.base_home, &params, self.profile.as_deref())?;
        let cwd = config::optional_string(&params, "cwd")?
            .map(std::path::PathBuf::from)
            .unwrap_or(std::env::current_dir()?);
        let cwd = cwd
            .canonicalize()
            .map_err(|error| AppServerError::InvalidRequest(format!("invalid cwd: {error}")))?;
        if !cwd.is_dir() {
            return Err(AppServerError::InvalidRequest(
                "cwd must be a directory".into(),
            ));
        }
        let ephemeral = params
            .get("ephemeral")
            .filter(|value| !value.is_null())
            .map(|value| {
                value.as_bool().ok_or_else(|| {
                    AppServerError::InvalidRequest("ephemeral must be boolean".into())
                })
            })
            .transpose()?
            .unwrap_or(false);
        // Validate host options before any managed inference process is started.
        // Invalid declarations must not consume a model lease or launch hardware.
        config::validate_session_options(&params)?;
        // Validate declarations before managed inference acquisition as well.
        host_tools::HostTools::declare("validation", params.get("tools"))?;
        let provider_lease =
            prepare_managed_provider_in(&mut resolved, &cwd, self.models_dir.as_deref())
                .await
                .map_err(|error| AppServerError::Runtime(error.to_string()))?;
        let mut runtime_config = config::runtime(&resolved, &self.home, &cwd, &params)?;
        if !ephemeral {
            runtime_config = runtime_config.with_rollout_path(self.home.join("sessions"));
        }
        let id = if forked_from.is_some() {
            Event::new(EventMsg::TurnStarted).id
        } else {
            restored.as_ref().map_or_else(
                || Event::new(EventMsg::TurnStarted).id,
                |session| session.meta.id.clone(),
            )
        };
        let mut info = ThreadInfo {
            id: id.clone(),
            created_at: now(),
            updated_at: now(),
            model: runtime_config.model.clone(),
            cwd: cwd.to_string_lossy().into_owned(),
            preview: String::new(),
            ephemeral,
            archived: false,
            model_provider: resolved.provider.id.clone(),
            status: json!({"type":"idle"}),
            source: "appServer",
            cli_version: env!("CARGO_PKG_VERSION"),
            turns: Vec::new(),
        };
        let model = ModelFactory::build(&resolved)
            .map_err(|error| AppServerError::Runtime(error.to_string()))?;
        let profiled_tools = runtime_config.tool_profile.is_some();
        let mut builder = AgentRuntime::builder()
            .config(runtime_config)
            .model(ModelChoice::from_client(model))
            .session_id(id.clone());
        let host_tools = host_tools::HostTools::declare(&id, params.get("tools"))?
            .with_host_permission(
                params.get("permissions").and_then(Value::as_str) == Some("host"),
            );
        for executor in host_tools.executors()? {
            builder = builder
                .tool(executor)
                .map_err(|error| AppServerError::Runtime(error.to_string()))?;
        }
        if let Some(session) = restored {
            let saved = thread_from_session(&session).await;
            if forked_from.is_none() {
                info.created_at = saved.created_at;
                info.updated_at = saved.updated_at;
            }
            let contents = tokio::fs::read_to_string(&session.path).await?;
            let lines = contents
                .lines()
                .filter(|line| !line.trim().is_empty())
                .map(serde_json::from_str::<aphrody_rollout::RolloutLine>)
                .collect::<Result<Vec<_>, _>>()?;
            let history = aphrody_engine::restore_history(&lines);
            if history.undecodable != 0 {
                return Err(AppServerError::InvalidRequest(
                    "rollout contains invalid conversation history".into(),
                ));
            }
            info.turns = restore_ui_turns(&id, &lines)?;
            info.preview = thread_preview(&info.turns);
            builder = builder.history(history.messages);
            if let Some(parent_id) = &forked_from {
                builder = builder.forked_from(parent_id.clone());
            } else if !ephemeral {
                builder = builder.resume_path(session.path);
            }
        }
        let runtime = if profiled_tools {
            builder.build_profiled().await
        } else {
            builder.build()
        }
        .map_err(|error| AppServerError::Runtime(error.to_string()))?;
        let tools = runtime.tools().clone();
        let mut handle = runtime
            .spawn()
            .await
            .map_err(|error| AppServerError::Runtime(error.to_string()))?;
        let events = handle
            .events()
            .ok_or_else(|| AppServerError::Runtime("session event stream unavailable".into()))?;
        self.notifications
            .push(notification("thread/started", json!({"thread": info})));
        self.threads.insert(
            id,
            ThreadState {
                info: info.clone(),
                events,
                handle,
                _provider_lease: provider_lease,
                active_turn: None,
                is_compaction: false,
                interrupt_requested: false,
                message_started: false,
                open_tool_calls: HashMap::new(),
                host_tools,
                tools,
            },
        );
        Ok(thread_response(&info))
    }

    async fn list_threads(&self, params: &Value) -> Result<Value, AppServerError> {
        let archived = params
            .get("archived")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let listing = aphrody_rollout::list_sessions(self.home.join("sessions"))
            .await
            .map_err(|error| AppServerError::Runtime(error.to_string()))?;
        let mut summaries = BTreeMap::new();
        for session in &listing.sessions {
            let summary = thread_from_session(session).await;
            summaries.insert(summary.id.clone(), summary);
        }
        for thread in self.threads.values() {
            let mut summary = thread.info.clone();
            summary.turns.clear();
            summaries.insert(summary.id.clone(), summary);
        }
        let mut filtered = Vec::new();
        for mut summary in summaries.into_values() {
            summary.archived = self.is_archived(&summary.id).await;
            if summary.archived == archived {
                filtered.push(summary);
            }
        }
        let mut summaries = filtered;
        summaries.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then(right.id.cmp(&left.id))
        });
        let start = match params.get("cursor").filter(|value| !value.is_null()) {
            Some(cursor) => summaries
                .iter()
                .position(|thread| cursor.as_str() == Some(thread.id.as_str()))
                .map(|index| index + 1)
                .ok_or_else(|| {
                    AppServerError::InvalidRequest("invalid thread/list cursor".into())
                })?,
            None => 0,
        };
        let limit = params
            .get("limit")
            .filter(|value| !value.is_null())
            .map(|value| {
                value
                    .as_u64()
                    .and_then(|value| usize::try_from(value).ok())
                    .filter(|value| *value > 0)
                    .ok_or_else(|| {
                        AppServerError::InvalidRequest("thread/list limit must be positive".into())
                    })
            })
            .transpose()?
            .unwrap_or(100);
        let end = start.saturating_add(limit).min(summaries.len());
        let next_cursor = (end < summaries.len()).then(|| summaries[end - 1].id.clone());
        Ok(
            json!({"data": &summaries[start..end], "nextCursor": next_cursor, "skipped": listing.skipped}),
        )
    }

    /// Drain provider events into Codex-compatible notifications without
    /// waiting for a running turn to finish.
    pub fn drain_notifications(&mut self) -> Vec<Value> {
        for thread in self.threads.values_mut() {
            self.notifications.extend(thread.host_tools.drain());
            while let Ok(event) = thread.events.try_recv() {
                self.notifications.extend(thread.observe(&event));
            }
        }
        std::mem::take(&mut self.notifications)
    }

    /// Handle one JSON-RPC request. Notifications produce no response.
    pub async fn handle(&mut self, line: &str) -> Result<Option<String>, AppServerError> {
        // Replies to caller-owned tool requests are not client requests. Route
        // correlation before decoding the method-bearing request contract.
        if let Ok(value) = serde_json::from_str::<Value>(line)
            && value.get("method").is_none()
            && (value.get("result").is_some() || value.get("error").is_some())
        {
            if let Some(id) = value.get("id").and_then(Value::as_str) {
                for thread in self.threads.values() {
                    if thread.host_tools.contains(id) {
                        let result = value.get("result").cloned().unwrap_or_else(
                            || json!({"content":"host callback failed","isError":true,"decision":"deny"}),
                        );
                        thread.host_tools.respond(id, &result)?;
                        return Ok(None);
                    }
                }
            }
            return Err(AppServerError::InvalidRequest(
                "unknown host callback response".into(),
            ));
        }
        let mut request: RpcRequest = match serde_json::from_str(line) {
            Ok(request) => request,
            Err(error) => {
                let code = if error.is_syntax() || error.is_eof() {
                    -32700
                } else {
                    -32600
                };
                return Ok(Some(
                    json!({"id": null, "error": {"code": code, "message": error.to_string()}})
                        .to_string(),
                ));
            }
        };
        request.method = canonical_method(&request.method).to_owned();
        if request.method != "initialize" && request.method != "initialized" && !self.initialized {
            if request.id.is_none() {
                return Ok(None);
            }
            return Ok(Some(serde_json::to_string(&JSONRPCError::new(
                request.id.expect("request id checked"),
                -32002,
                "Not initialized",
                None,
            ))?));
        }
        let Some(id) = request.id.clone() else {
            if request.method == "initialized" && self.initialize_received {
                self.initialized = true;
            }
            return Ok(None);
        };
        let result = if request.method == "aphrody/google/search" {
            google_search::dispatch(self.aphrody_extensions, &request.params).await
        } else if matches!(
            request.method.as_str(),
            "tool/respond" | "permission/respond" | "thread/tools/get" | "thread/tools/set"
        ) {
            self.dispatch_host_tools(&request.method, &request.params)
        } else {
            match parse_client_request(id.clone(), &request.method, &request.params) {
                Ok(client_request) => self.dispatch(client_request, request.params).await,
                Err(error) => Err(error),
            }
        };
        Ok(Some(match result {
            Ok(value) => serde_json::to_string(&JSONRPCResponse::new(id, value))?,
            Err(AppServerError::MethodNotFound(method)) => {
                serde_json::to_string(&JSONRPCError::method_not_found(id, &method))?
            }
            Err(error) => {
                let code = if matches!(error, AppServerError::InvalidRequest(_)) {
                    -32602
                } else {
                    -32603
                };
                serde_json::to_string(&JSONRPCError::new(id, code, error.to_string(), None))?
            }
        }))
    }

    async fn dispatch(
        &mut self,
        request: ClientRequest,
        params: Value,
    ) -> Result<Value, AppServerError> {
        match request {
            ClientRequest::Initialize { .. } if self.initialize_received => {
                Err(AppServerError::InvalidRequest("Already initialized".into()))
            }
            ClientRequest::Initialize { .. } => {
                self.profile = config::select_profile(&self.base_home, &params)?;
                self.home = config::profile_home(&self.base_home, self.profile.as_deref());
                self.aphrody_extensions = params
                    .pointer("/capabilities/aphrody")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let home = std::path::absolute(&self.home)?;
                self.initialize_received = true;
                Ok(json!({
                    "userAgent": concat!("aphrody/", env!("CARGO_PKG_VERSION")),
                    "codexHome": home,
                    "platformFamily": std::env::consts::FAMILY,
                    "platformOs": std::env::consts::OS,
                    "serverInfo": {"name": "aphrody", "version": env!("CARGO_PKG_VERSION")},
                    "capabilities": {"threads": true, "turns": true, "localModels": true, "interrupt": true, "hostTools":true, "aphrody": true, "googleSearch": true, "rag": cfg!(feature = "rag")},
                    "authentication": {"required": false}
                }))
            }
            ClientRequest::ThreadList { .. } => self.list_threads(&params).await,
            ClientRequest::ConfigRead { .. } => self.read_config(&params),
            ClientRequest::AccountRead { .. } => self.read_account(&params),
            ClientRequest::AccountLoginStart { .. } => self.start_account_login(&params),
            ClientRequest::McpServerStatusList { .. } => self.list_mcp_server_status(&params),
            ClientRequest::ThreadRead { .. } => {
                let thread_id =
                    params
                        .get("threadId")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            AppServerError::InvalidRequest("thread/read requires threadId".into())
                        })?;
                let include_turns = params
                    .get("includeTurns")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if let Some(thread) = self.threads.get(thread_id) {
                    let mut info = thread.info.clone();
                    if !include_turns {
                        info.turns.clear();
                    }
                    return Ok(json!({ "thread": info }));
                }
                let session = aphrody_rollout::find_session(self.home.join("sessions"), thread_id)
                    .await
                    .map_err(|error| AppServerError::Runtime(error.to_string()))?
                    .filter(|session| session.meta.id == thread_id)
                    .ok_or_else(|| {
                        AppServerError::InvalidRequest(format!("unknown thread: {thread_id}"))
                    })?;
                let mut info = thread_from_session(&session).await;
                info.archived = self.is_archived(thread_id).await;
                if include_turns {
                    let lines = aphrody_rollout::resume(&session.path)
                        .await
                        .map_err(|error| AppServerError::Runtime(error.to_string()))?;
                    info.turns = restore_ui_turns(thread_id, &lines)?;
                    info.preview = thread_preview(&info.turns);
                }
                Ok(json!({ "thread": info }))
            }
            ClientRequest::ThreadResume { .. } => {
                validate_policy(&params)?;
                let thread_id =
                    params
                        .get("threadId")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            AppServerError::InvalidRequest("thread/resume requires threadId".into())
                        })?;
                if self.is_archived(thread_id).await {
                    return Err(AppServerError::InvalidRequest("thread is archived".into()));
                }
                if let Some(thread) = self.threads.get(thread_id) {
                    return Ok(thread_response(&thread.info));
                }
                let session = aphrody_rollout::find_session(self.home.join("sessions"), thread_id)
                    .await
                    .map_err(|error| AppServerError::Runtime(error.to_string()))?
                    .filter(|session| session.meta.id == thread_id)
                    .ok_or_else(|| {
                        AppServerError::InvalidRequest(format!("unknown thread: {thread_id}"))
                    })?;
                self.start_thread(params, Some(session), None).await
            }
            ClientRequest::ThreadArchive { .. } => {
                let thread_id = params
                    .get("threadId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        AppServerError::InvalidRequest("thread/archive requires threadId".into())
                    })?
                    .to_string();
                if self
                    .threads
                    .get(&thread_id)
                    .is_some_and(|thread| thread.active_turn.is_some())
                {
                    return Err(AppServerError::InvalidRequest(
                        "cannot archive an active turn".into(),
                    ));
                }
                let _session =
                    aphrody_rollout::find_session(self.home.join("sessions"), &thread_id)
                        .await
                        .map_err(|error| AppServerError::Runtime(error.to_string()))?
                        .filter(|session| session.meta.id == thread_id)
                        .ok_or_else(|| {
                            AppServerError::InvalidRequest(format!(
                                "thread has no persisted history: {thread_id}"
                            ))
                        })?;
                if let Some(thread) = self.threads.remove(&thread_id) {
                    let _ = thread.handle.submit(Op::Shutdown);
                    thread
                        .handle
                        .join()
                        .await
                        .map_err(|error| AppServerError::Runtime(error.to_string()))?;
                }
                let marker = self.archive_marker(&thread_id);
                tokio::fs::create_dir_all(marker.parent().expect("archive marker has parent"))
                    .await?;
                tokio::fs::write(&marker, b"").await?;
                self.notifications.push(notification(
                    "thread/archived",
                    json!({"threadId": thread_id}),
                ));
                Ok(json!({"archived": true}))
            }
            ClientRequest::ThreadUnarchive {
                params: ThreadUnarchiveParams { thread_id },
                ..
            } => {
                let marker = self.archive_marker(&thread_id);
                tokio::fs::remove_file(&marker).await.map_err(|error| {
                    AppServerError::InvalidRequest(format!("thread is not archived: {error}"))
                })?;
                Ok(serde_json::to_value(ThreadUnarchiveResponse {
                    archived: false,
                })?)
            }
            ClientRequest::ThreadFork { .. } => {
                validate_policy(&params)?;
                let thread_id = params
                    .get("threadId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        AppServerError::InvalidRequest("thread/fork requires threadId".into())
                    })?
                    .to_string();
                if self
                    .threads
                    .get(&thread_id)
                    .is_some_and(|thread| thread.active_turn.is_some())
                {
                    return Err(AppServerError::InvalidRequest(
                        "cannot fork an active turn".into(),
                    ));
                }
                let session = aphrody_rollout::find_session(self.home.join("sessions"), &thread_id)
                    .await
                    .map_err(|error| AppServerError::Runtime(error.to_string()))?
                    .filter(|session| session.meta.id == thread_id)
                    .ok_or_else(|| {
                        AppServerError::InvalidRequest(format!(
                            "thread has no persisted history: {thread_id}"
                        ))
                    })?;
                self.start_thread(params, Some(session), Some(thread_id))
                    .await
            }
            ClientRequest::ThreadCompactStart { .. } => {
                let thread_id =
                    params
                        .get("threadId")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            AppServerError::InvalidRequest(
                                "thread/compact/start requires threadId".into(),
                            )
                        })?;
                let thread = self.threads.get_mut(thread_id).ok_or_else(|| {
                    AppServerError::InvalidRequest(format!("unknown thread: {thread_id}"))
                })?;
                while let Ok(event) = thread.events.try_recv() {
                    self.notifications.extend(thread.observe(&event));
                }
                if thread.active_turn.is_some() {
                    return Err(AppServerError::InvalidRequest(
                        "cannot compact while a turn is active".into(),
                    ));
                }
                thread
                    .handle
                    .submit(Op::Compact)
                    .map_err(|_| AppServerError::Runtime("session actor stopped".into()))?;
                // Reserve the turn before returning, so another request cannot
                // race the actor's compaction-start notification.
                thread.active_turn = Some(json!({
                    "id": format!("{thread_id}-turn-{}", thread.info.turns.len() + 1),
                    "items": [], "status": "inProgress", "error": null,
                }));
                thread.is_compaction = true;
                thread.interrupt_requested = false;
                thread.message_started = false;
                thread.info.status = json!({"type": "active", "activeFlags": []});
                Ok(serde_json::to_value(ThreadCompactStartResponse {})?)
            }
            ClientRequest::TurnEvents {
                params: TurnEventsParams { thread_id },
                ..
            } => {
                let thread = self.threads.get_mut(&thread_id).ok_or_else(|| {
                    AppServerError::InvalidRequest(format!("unknown thread: {thread_id}"))
                })?;
                let mut events = Vec::new();
                let mut completed = false;
                while let Ok(event) = thread.events.try_recv() {
                    completed = completed
                        || matches!(
                            &event.msg,
                            EventMsg::TurnComplete { .. } | EventMsg::Error { .. }
                        );
                    self.notifications.extend(thread.observe(&event));
                    events.push(event);
                }
                let notifications = std::mem::take(&mut self.notifications);
                Ok(serde_json::to_value(TurnEventsResponse {
                    thread_id,
                    data: serde_json::to_value(events)?,
                    completed,
                    notifications: Value::Array(notifications),
                })?)
            }
            // `ToolsListParams` only carries `thread_id`; the handler also
            // honours `cwd`, `model` and policy overrides from the raw params
            // (same resolution path as `thread/start`), so the raw value is
            // kept for config resolution.
            ClientRequest::ToolsList { .. } => {
                if let Some(thread_id) = params.get("threadId").and_then(Value::as_str) {
                    let thread = self
                        .threads
                        .get(thread_id)
                        .ok_or_else(|| AppServerError::InvalidRequest("unknown thread".into()))?;
                    return Ok(json!({"data":thread.tools.openai_functions()}));
                }
                let resolved = config::resolve_with_profile(
                    &self.base_home,
                    &params,
                    self.profile.as_deref(),
                )?;
                let cwd = config::optional_string(&params, "cwd")?
                    .map(std::path::PathBuf::from)
                    .unwrap_or(std::env::current_dir()?);
                let cwd = cwd.canonicalize().map_err(|error| {
                    AppServerError::InvalidRequest(format!("invalid cwd: {error}"))
                })?;
                if !cwd.is_dir() {
                    return Err(AppServerError::InvalidRequest(
                        "cwd must be a directory".into(),
                    ));
                }
                let runtime_config = config::runtime(&resolved, &self.home, &cwd, &params)?;
                let tools = if runtime_config.tool_profile.is_some() {
                    build_profiled_tool_registry(&runtime_config).await
                } else {
                    build_tool_registry(&runtime_config).map_err(Into::into)
                }
                .map_err(|error: aphrody_agent_runtime::RuntimeError| {
                    AppServerError::Runtime(error.to_string())
                })?;
                Ok(json!({ "data": tools.openai_functions() }))
            }
            ClientRequest::ModelList { .. } => {
                let resolved = config::resolve_with_profile(
                    &self.base_home,
                    &params,
                    self.profile.as_deref(),
                )?;
                let mut models = Vec::new();
                let mut seen = BTreeSet::new();
                if let Some(model) = resolved.model {
                    seen.insert((model.clone(), resolved.provider.id.clone()));
                    models.push(json!({
                        "id": model,
                        "model": model,
                        "provider": resolved.provider.id,
                        "default": true,
                        "source": "configured",
                        "availability": "unknown"
                    }));
                }
                for thread in self.threads.values() {
                    let model = &thread.info.model;
                    let provider = &thread.info.model_provider;
                    if seen.insert((model.clone(), provider.clone())) {
                        models.push(json!({
                            "id": model,
                            "model": model,
                            "provider": provider,
                            "default": false,
                            "source": "active-thread",
                            "availability": "unknown"
                        }));
                    }
                }
                Ok(json!({ "data": models }))
            }
            ClientRequest::NotificationsDrain { .. } => {
                let notifs = self.drain_notifications();
                Ok(json!({ "notifications": notifs }))
            }
            ClientRequest::AphrodyStatus { .. } => Ok(json!({
                "service": "aphrody-app-server",
                "version": env!("CARGO_PKG_VERSION"),
                "initialized": self.initialized,
                "threads": self.threads.len(),
                "home": self.home.to_string_lossy(),
                "profile": self.profile,
                "capabilities": {
                    "threads": true,
                    "turns": true,
                    "localModels": true,
                    "interrupt": true,
                    "steer": true,
                    "events": true,
                    "rag": cfg!(feature = "rag")
                }
            })),
            #[cfg(feature = "rag")]
            ClientRequest::RagSearch { params, .. } => self.rag_search(params).await,
            #[cfg(feature = "rag")]
            ClientRequest::RagContext { params, .. } => self.rag_context(params).await,
            #[cfg(feature = "rag")]
            ClientRequest::RagStatus { .. } => self.rag_status().await,
            #[cfg(not(feature = "rag"))]
            ClientRequest::RagSearch { .. }
            | ClientRequest::RagContext { .. }
            | ClientRequest::RagStatus { .. } => Err(AppServerError::MethodNotFound(
                request.method_name().to_owned(),
            )),
            ClientRequest::TurnInterrupt { .. } => {
                let thread_id =
                    params
                        .get("threadId")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            AppServerError::InvalidRequest(
                                "turn/interrupt requires threadId".into(),
                            )
                        })?;
                let thread = self.threads.get_mut(thread_id).ok_or_else(|| {
                    AppServerError::InvalidRequest(format!("unknown thread: {thread_id}"))
                })?;
                let active = thread
                    .active_turn
                    .as_ref()
                    .ok_or_else(|| AppServerError::InvalidRequest("no active turn".into()))?;
                if params.get("turnId").is_some_and(|id| id != &active["id"]) {
                    return Err(AppServerError::InvalidRequest(
                        "turnId does not match the active turn".into(),
                    ));
                }
                if thread.is_compaction {
                    return Err(AppServerError::InvalidRequest(
                        "native structural compaction cannot be interrupted".into(),
                    ));
                }
                thread
                    .handle
                    .submit(Op::Interrupt)
                    .map_err(|_| AppServerError::Runtime("session actor stopped".into()))?;
                thread.interrupt_requested = true;
                thread.host_tools.cancel_all();
                Ok(json!({ "threadId": thread_id, "status": "interrupt_requested" }))
            }
            ClientRequest::TurnSteer { .. } => {
                let thread_id = params
                    .get("threadId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppServerError::InvalidRequest("threadId is required".into()))?;
                let thread = self.threads.get_mut(thread_id).ok_or_else(|| {
                    AppServerError::InvalidRequest(format!("unknown thread: {thread_id}"))
                })?;
                let turn = thread
                    .active_turn
                    .as_ref()
                    .ok_or_else(|| AppServerError::InvalidRequest("no active turn".into()))?;
                if params
                    .get("expectedTurnId")
                    .or_else(|| params.get("turnId"))
                    != Some(&turn["id"])
                {
                    return Err(AppServerError::InvalidRequest(
                        "expectedTurnId does not match the active turn".into(),
                    ));
                }
                let (items, _) = parse_input(&params)?;
                thread
                    .handle
                    .submit(Op::Steer { items })
                    .map_err(|_| AppServerError::Runtime("session actor stopped".into()))?;
                Ok(json!({"turnId": turn["id"]}))
            }
            ClientRequest::ThreadClose {
                params: ThreadCloseParams { thread_id },
                ..
            } => {
                let thread = self.threads.remove(&thread_id).ok_or_else(|| {
                    AppServerError::InvalidRequest(format!("unknown thread: {thread_id}"))
                })?;
                thread.host_tools.cancel_all();
                let _ = thread.handle.submit(Op::Shutdown);
                let _ = thread.handle.join().await;
                Ok(serde_json::to_value(ThreadCloseResponse {
                    thread_id,
                    status: "closed".to_owned(),
                })?)
            }
            ClientRequest::ThreadStart { .. } => self.start_thread(params, None, None).await,
            ClientRequest::TurnStart { .. } => {
                validate_policy(&params)?;
                let thread_id =
                    params
                        .get("threadId")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            AppServerError::InvalidRequest("turn/start requires threadId".into())
                        })?;
                let thread = self.threads.get_mut(thread_id).ok_or_else(|| {
                    AppServerError::InvalidRequest(format!("unknown thread: {thread_id}"))
                })?;
                let wait = params
                    .get("waitForCompletion")
                    .and_then(Value::as_bool)
                    .unwrap_or_else(|| params.get("input").is_some_and(Value::is_string));
                if wait && !thread.host_tools.is_empty() {
                    return Err(AppServerError::InvalidRequest(
                        "host callbacks require asynchronous turn/start (waitForCompletion=false)"
                            .into(),
                    ));
                }
                for (key, expected) in [("model", &thread.info.model), ("cwd", &thread.info.cwd)] {
                    if params
                        .get(key)
                        .is_some_and(|value| !value.is_null() && value.as_str() != Some(expected))
                    {
                        return Err(AppServerError::InvalidRequest(format!(
                            "per-turn {key} overrides are not supported"
                        )));
                    }
                }
                while let Ok(event) = thread.events.try_recv() {
                    self.notifications.extend(thread.observe(&event));
                }
                if thread.active_turn.is_some() {
                    return Err(AppServerError::InvalidRequest(
                        "thread already has an active turn".into(),
                    ));
                }
                let (items, content) = parse_input(&params)?;
                let turn_id = format!("{thread_id}-turn-{}", thread.info.turns.len() + 1);
                let turn = json!({"id": turn_id, "items": [{"type": "userMessage", "id": format!("{turn_id}-user"), "content": content}], "status": "inProgress", "error": null});
                thread
                    .handle
                    .submit(Op::UserInput { items })
                    .map_err(|_| AppServerError::Runtime("session actor stopped".into()))?;
                thread.active_turn = Some(turn.clone());
                thread.is_compaction = false;
                thread.interrupt_requested = false;
                thread.message_started = false;
                thread.info.status = json!({"type": "active", "activeFlags": []});
                thread.info.updated_at = now();
                if thread.info.preview.is_empty() {
                    thread.info.preview = thread_preview(std::slice::from_ref(&turn));
                }
                self.notifications.push(notification(
                    "turn/started",
                    json!({"threadId": thread_id, "turn": turn}),
                ));
                if !wait {
                    return Ok(json!({
                        "turn": turn,
                        "id": turn_id,
                        "threadId": thread.info.id,
                        "status": "in_progress"
                    }));
                }
                let mut events = Vec::new();
                let output = loop {
                    let event = thread.events.recv().await.ok_or_else(|| {
                        AppServerError::Runtime("session event stream closed".into())
                    })?;
                    let completed = match &event.msg {
                        EventMsg::TurnComplete { last_agent_message } => {
                            Some(last_agent_message.clone())
                        }
                        EventMsg::Error { message } => {
                            self.notifications.extend(thread.observe(&event));
                            return Err(AppServerError::Runtime(message.clone()));
                        }
                        _ => None,
                    };
                    self.notifications.extend(thread.observe(&event));
                    events.push(event);
                    if completed.is_some() {
                        break completed.flatten().unwrap_or_default();
                    }
                };
                Ok(json!({
                    "turn": thread.info.turns.last(),
                    "id": turn_id,
                    "threadId": thread.info.id,
                    "status": "completed",
                    "output": output,
                    "events": events
                }))
            }
            ClientRequest::Shutdown { .. } => {
                self.shutdown().await?;
                Ok(serde_json::to_value(ShutdownResponse { ok: true })?)
            }
            // Login is stateless: `account/login/start` only validates that a
            // locally managed provider exists and stores nothing, and
            // `account/read` derives the account from configuration. There is
            // no session or token to clear, so logout is an honest no-op.
            ClientRequest::AccountLogout { .. } => Ok(json!({})),
            ClientRequest::LlamaStatus { .. } => Ok(serde_json::to_value(llama_status())?),
            ClientRequest::TrainStatus { .. } => Ok(serde_json::to_value(train_status())?),
        }
    }

    #[cfg(feature = "rag")]
    fn require_aphrody_extensions(&self) -> Result<(), AppServerError> {
        if self.aphrody_extensions {
            Ok(())
        } else {
            Err(AppServerError::InvalidRequest(
                "initialize with capabilities.aphrody=true before using aphrody/* methods".into(),
            ))
        }
    }

    #[cfg(feature = "rag")]
    fn rag_store(&self) -> Result<(Arc<RagStore>, std::path::PathBuf), AppServerError> {
        self.require_aphrody_extensions()?;
        let config =
            config::resolve_with_profile(&self.base_home, &json!({}), self.profile.as_deref())?;
        let cwd = std::env::current_dir()?;
        let path = config::rag_db_path(&config, &self.home, &cwd)?;
        if !path.is_file() {
            return Err(AppServerError::InvalidRequest(format!(
                "RAG index does not exist at {}; run `aphrody rag index` first",
                path.display()
            )));
        }
        let store =
            RagStore::open(&path).map_err(|error| AppServerError::Runtime(error.to_string()))?;
        Ok((Arc::new(store), path))
    }

    #[cfg(feature = "rag")]
    async fn rag_search(&self, params: RagSearchParams) -> Result<Value, AppServerError> {
        if params.query.trim().is_empty() || !(1..=100).contains(&params.top_k) {
            return Err(AppServerError::InvalidRequest(
                "RAG query must be nonempty and topK must be between 1 and 100".into(),
            ));
        }
        let (store, _) = self.rag_store()?;
        let hits = store
            .search_lexical(&params.query, params.top_k)
            .await
            .map_err(|error| AppServerError::Runtime(error.to_string()))?;
        let results = hits
            .into_iter()
            .map(|hit| RagSearchResult {
                chunk_id: hit.chunk.id.to_string(),
                path: hit.chunk.path,
                content: hit.chunk.content,
                score: hit.score as f32,
            })
            .collect();
        Ok(serde_json::to_value(RagSearchResponse { results })?)
    }

    #[cfg(feature = "rag")]
    async fn rag_context(&self, params: RagContextParams) -> Result<Value, AppServerError> {
        if params.query.trim().is_empty() || params.max_tokens == Some(0) {
            return Err(AppServerError::InvalidRequest(
                "RAG query must be nonempty and maxTokens must be positive".into(),
            ));
        }
        let (store, _) = self.rag_store()?;
        let searcher = Arc::new(RagSearcher::new(store.clone()));
        let output = RagContextTool::new(searcher)
            .handle(json!({
                "query": params.query,
                "token_budget": params.max_tokens.unwrap_or(2000),
                "mode": "lexical",
                "rerank": false,
            }))
            .await
            .map_err(|error| AppServerError::Runtime(error.to_string()))?;
        let sources = store
            .search_lexical(&params.query, 15)
            .await
            .map_err(|error| AppServerError::Runtime(error.to_string()))?
            .into_iter()
            .map(|hit| hit.chunk.path)
            .fold(Vec::<String>::new(), |mut paths, path| {
                if !paths.contains(&path) {
                    paths.push(path);
                }
                paths
            });
        Ok(serde_json::to_value(RagContextResponse {
            prompt_context: output.content,
            sources,
        })?)
    }

    #[cfg(feature = "rag")]
    async fn rag_status(&self) -> Result<Value, AppServerError> {
        let (store, path) = self.rag_store()?;
        let stats = store
            .stats()
            .await
            .map_err(|error| AppServerError::Runtime(error.to_string()))?;
        Ok(serde_json::to_value(RagStatusResponse {
            indexed_documents: stats.doc_count,
            total_chunks: stats.chunk_count,
            database_path: path.to_string_lossy().into_owned(),
            embed_model: stats.embedding_model.unwrap_or_default(),
        })?)
    }
}

/// Build the app-server v2 `mcpToolCall` item for one tool call.
///
/// `server_name` separates the BXC web surface from aphrody's own local
/// tools, so a client can tell a page action from a shell command.
fn tool_call_item(item_id: &str, name: &str, ok: Option<bool>) -> Value {
    let server_name = if BXC_TOOL_NAMES.contains(&name) {
        "bxc"
    } else {
        "aphrody"
    };
    let mut item = json!({
        "type": "mcpToolCall",
        "id": item_id,
        "serverName": server_name,
        "toolName": name,
        "arguments": Value::Null,
    });
    if let Some(ok) = ok {
        item["result"] = json!({"ok": ok});
    }
    item
}

/// Tool names served by the BXC subsystem (web, scraping, JS VM, browser).
const BXC_TOOL_NAMES: [&str; 5] = [
    "web_search",
    "web_scrape",
    "js_eval",
    "google_ai",
    "browser",
];

impl ThreadState {
    fn observe(&mut self, event: &Event) -> Vec<Value> {
        if let EventMsg::ContextCompactionStarted { item_id } = &event.msg {
            self.is_compaction = true;
            let turn = self.active_turn.get_or_insert_with(|| {
                json!({
                    "id": format!("{}-turn-{}", self.info.id, self.info.turns.len() + 1),
                    "items": [], "status": "inProgress", "error": null,
                })
            });
            let item = json!({"type": "contextCompaction", "id": item_id});
            let started = notification(
                "turn/started",
                json!({"threadId": self.info.id, "turn": turn}),
            );
            turn["items"]
                .as_array_mut()
                .expect("turn items")
                .push(item.clone());
            self.info.status = json!({"type": "active", "activeFlags": []});
            self.info.updated_at = now();
            return vec![
                started,
                notification(
                    "item/started",
                    json!({"threadId": self.info.id, "turnId": turn["id"], "item": item}),
                ),
            ];
        }
        let Some(turn) = self.active_turn.as_mut() else {
            return Vec::new();
        };
        let mut messages = Vec::new();
        let turn_id = turn["id"].as_str().unwrap_or_default().to_string();
        let item_id = format!(
            "{turn_id}-message-{}",
            turn["items"].as_array().map_or(0, Vec::len)
        );
        match &event.msg {
            EventMsg::AgentMessageDelta { delta } => {
                if !self.message_started {
                    messages.push(notification("item/started", json!({"threadId": self.info.id, "turnId": turn_id, "item": {"type": "agentMessage", "id": item_id, "text": ""}})));
                    self.message_started = true;
                }
                messages.push(notification("item/agentMessage/delta", json!({
                    "threadId": self.info.id, "turnId": turn_id, "itemId": item_id, "delta": delta,
                })));
            }
            EventMsg::AgentMessage { text } => {
                let item = json!({"type": "agentMessage", "id": item_id, "text": text});
                if !self.message_started {
                    messages.push(notification(
                        "item/started",
                        json!({"threadId": self.info.id, "turnId": turn_id, "item": item}),
                    ));
                }
                if let Some(items) = turn["items"].as_array_mut() {
                    items.push(item.clone());
                }
                messages.push(notification(
                    "item/completed",
                    json!({"threadId": self.info.id, "turnId": turn_id, "item": item}),
                ));
                self.message_started = false;
            }
            // Tool activity — including every browser / web computer-use
            // action driven through BXC — is relayed so a client watching a
            // thread sees what the agent is doing, not only what it says.
            EventMsg::ToolCallBegin { call_id, name } => {
                let item_id = format!("{turn_id}-tool-{call_id}");
                self.open_tool_calls
                    .insert(call_id.clone(), (item_id.clone(), name.clone()));
                messages.push(notification(
                    "item/started",
                    json!({
                        "threadId": self.info.id,
                        "turnId": turn_id,
                        "item": tool_call_item(&item_id, name, None),
                    }),
                ));
            }
            EventMsg::ToolCallEnd { call_id, ok } => {
                let Some((item_id, name)) = self.open_tool_calls.remove(call_id) else {
                    return messages;
                };
                let item = tool_call_item(&item_id, &name, Some(*ok));
                if let Some(items) = turn["items"].as_array_mut() {
                    items.push(item.clone());
                }
                messages.push(notification(
                    "item/completed",
                    json!({"threadId": self.info.id, "turnId": turn_id, "item": item}),
                ));
            }
            EventMsg::ContextCompactionCompleted { item_id } => {
                let item = turn["items"].as_array().and_then(|items| {
                    items.iter().find(|item| {
                        item["type"] == "contextCompaction"
                            && item["id"].as_str() == Some(item_id.as_str())
                    })
                });
                let Some(item) = item else { return messages };
                messages.push(notification(
                    "item/completed",
                    json!({"threadId": self.info.id, "turnId": turn_id, "item": item}),
                ));
                turn["status"] = json!("completed");
                messages.push(notification(
                    "turn/completed",
                    json!({"threadId": self.info.id, "turn": turn}),
                ));
                if let Some(turn) = self.active_turn.take() {
                    self.info.turns.push(turn);
                }
                self.is_compaction = false;
                self.info.status = json!({"type": "idle"});
                self.info.updated_at = now();
            }
            EventMsg::TurnComplete { .. } | EventMsg::Error { .. } => {
                turn["status"] = json!(if matches!(event.msg, EventMsg::Error { .. }) {
                    "failed"
                } else if self.interrupt_requested {
                    "interrupted"
                } else {
                    "completed"
                });
                if let EventMsg::Error { message } = &event.msg {
                    turn["error"] = json!({"message": message, "codexErrorInfo": null, "additionalDetails": null});
                }
                messages.push(notification(
                    "turn/completed",
                    json!({"threadId": self.info.id, "turn": turn}),
                ));
                if let Some(turn) = self.active_turn.take() {
                    self.info.turns.push(turn);
                }
                self.is_compaction = false;
                self.info.status = json!({"type": "idle"});
                self.info.updated_at = now();
            }
            _ => {}
        }
        messages
    }
}

async fn thread_from_session(session: &aphrody_rollout::SessionSummary) -> ThreadInfo {
    let created_at = chrono::DateTime::parse_from_rfc3339(&session.meta.timestamp)
        .ok()
        .and_then(|timestamp| u64::try_from(timestamp.timestamp()).ok())
        .unwrap_or(0);
    let updated_at = tokio::fs::metadata(&session.path)
        .await
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|timestamp| timestamp.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(created_at, |duration| duration.as_secs());
    ThreadInfo {
        id: session.meta.id.clone(),
        created_at,
        updated_at,
        model: session.meta.model.clone().unwrap_or_default(),
        cwd: session
            .meta
            .cwd
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        preview: String::new(),
        ephemeral: false,
        archived: false,
        model_provider: session.meta.model_provider.clone().unwrap_or_default(),
        status: json!({"type": "notLoaded"}),
        source: "appServer",
        cli_version: env!("CARGO_PKG_VERSION"),
        turns: Vec::new(),
    }
}

fn thread_preview(turns: &[Value]) -> String {
    turns
        .iter()
        .filter_map(|turn| turn["items"].as_array())
        .flatten()
        .filter(|item| item["type"] == "userMessage")
        .filter_map(|item| item["content"].as_array())
        .flatten()
        .find_map(|part| part["text"].as_str())
        .unwrap_or_default()
        .chars()
        .take(160)
        .collect()
}

/// Recover the UI from the same recorded messages that are replayed to models.
/// Engine lifecycle records keep steering messages inside their original turn.
fn restore_ui_turns(
    thread_id: &str,
    lines: &[aphrody_rollout::RolloutLine],
) -> Result<Vec<Value>, AppServerError> {
    use aphrody_model_client::{ChatMessage, ImageSource, Part, Role};
    let mut turns: Vec<Value> = Vec::new();
    let mut started = false;
    let mut replacement_history = false;
    for line in lines {
        if line.item["type"] == aphrody_engine::ROLLOUT_HISTORY_ITEM {
            replacement_history |= line.item["compaction_checkpoint"] == true;
            if replacement_history {
                // The checkpoint and retained suffix replace model context;
                // they must not duplicate the original UI transcript.
                continue;
            }
            let message: ChatMessage = serde_json::from_value(line.item["message"].clone())?;
            let needs_turn = turns.last().is_none_or(|turn| {
                message.role == Role::User
                    && (turn["status"] != "inProgress"
                        || (!started
                            && turn["items"]
                                .as_array()
                                .is_some_and(|items| !items.is_empty())))
            });
            if needs_turn {
                if let Some(previous) = turns
                    .last_mut()
                    .filter(|turn| turn["status"] == "inProgress")
                {
                    previous["status"] = json!("completed");
                }
                turns.push(json!({"id": format!("{thread_id}-turn-{}", turns.len() + 1), "items": [], "status": "inProgress", "error": null}));
                started = false;
            }
            let turn = turns.last_mut().expect("turn created for history");
            let turn_id = turn["id"].as_str().unwrap_or_default().to_string();
            let items = turn["items"].as_array_mut().expect("turn items");
            let mut user_content = Vec::new();
            for part in message.parts {
                match part {
                    Part::Text(text) if message.role == Role::User => {
                        user_content.push(json!({"type": "text", "text": text}));
                    }
                    Part::Image(source) if message.role == Role::User => {
                        let url = match source {
                            ImageSource::Url(url) => url,
                            ImageSource::Base64 { mime, data } => {
                                format!("data:{mime};base64,{data}")
                            }
                        };
                        user_content.push(json!({"type": "image", "url": url}));
                    }
                    Part::Text(text) if message.role == Role::Model => {
                        items.push(json!({"type": "agentMessage", "id": format!("{turn_id}-message-{}", items.len()), "text": text}));
                    }
                    Part::FunctionCall { id, name, args } => {
                        items.push(json!({"type": "dynamicToolCall", "id": id, "namespace": null, "tool": name,
                            "arguments": args, "status": "inProgress", "contentItems": null, "success": null, "durationMs": null}));
                    }
                    Part::FunctionResponse {
                        id, name, response, ..
                    } => {
                        let content = json!([{"type": "inputText", "text": response.to_string()}]);
                        if let Some(call) = items.iter_mut().find(|item| item["id"] == id) {
                            call["contentItems"] = content;
                            call["status"] = json!("completed");
                        } else {
                            items.push(json!({"type": "dynamicToolCall", "id": id, "namespace": null, "tool": name,
                                "arguments": null, "status": "completed", "contentItems": content, "success": null, "durationMs": null}));
                        }
                    }
                    _ => {}
                }
            }
            if !user_content.is_empty() {
                items.push(json!({"type": "userMessage", "id": format!("{turn_id}-user-{}", items.len()), "content": user_content}));
            }
        } else if line.item["msg"]["type"] == "context_compaction_started" {
            replacement_history = false;
            turns.push(json!({
                "id": format!("{thread_id}-turn-{}", turns.len() + 1),
                "items": [{"type": "contextCompaction", "id": line.item["msg"]["item_id"]}],
                "status": "inProgress", "error": null,
            }));
            started = true;
        } else if let Some(turn) = turns.last_mut() {
            replacement_history = false;
            match line.item["msg"]["type"].as_str() {
                Some("turn_started") => started = true,
                Some("turn_complete" | "context_compaction_completed") => {
                    turn["status"] = json!("completed");
                    started = false;
                }
                Some("error") => {
                    turn["status"] = json!("failed");
                    turn["error"] = json!({"message": line.item["msg"]["message"], "codexErrorInfo": null, "additionalDetails": null});
                    started = false;
                }
                _ => {}
            }
        }
    }
    if let Some(turn) = turns
        .last_mut()
        .filter(|turn| turn["status"] == "inProgress")
    {
        turn["status"] = json!("interrupted");
    }
    Ok(turns)
}

fn notification(method: &str, params: Value) -> Value {
    // Serialization contains only JSON values and therefore cannot fail.
    json!(JSONRPCNotification::new(method, Some(params)))
}

fn thread_response(info: &ThreadInfo) -> Value {
    json!({
        "thread": info, "model": info.model, "modelProvider": info.model_provider,
        "cwd": info.cwd, "approvalPolicy": "never", "approvalsReviewer": "user",
        "sandbox": {"type": "dangerFullAccess"}, "reasoningEffort": null,
        "serviceTier": null, "runtimeWorkspaceRoots": [], "instructionSources": [],
    })
}

fn validate_policy(params: &Value) -> Result<(), AppServerError> {
    if params
        .get("approvalPolicy")
        .is_some_and(|value| !value.is_null() && value != "never")
    {
        return Err(AppServerError::InvalidRequest(
            "this local server supports only approvalPolicy=never".into(),
        ));
    }
    if params.get("sandbox").is_some_and(|value| {
        !value.is_null() && value != "danger-full-access" && value != "dangerously-bypass"
    }) {
        return Err(AppServerError::InvalidRequest(
            "this local server supports only sandbox=danger-full-access".into(),
        ));
    }
    if params
        .get("sandboxPolicy")
        .is_some_and(|value| !value.is_null() && value != &json!({"type": "dangerFullAccess"}))
    {
        return Err(AppServerError::InvalidRequest(
            "this local server supports only dangerFullAccess sandboxPolicy".into(),
        ));
    }
    Ok(())
}

fn parse_input(params: &Value) -> Result<(Vec<InputItem>, Vec<UserInput>), AppServerError> {
    let input = params
        .get("input")
        .ok_or_else(|| AppServerError::InvalidRequest("input is required".into()))?;
    let content: Vec<UserInput> = if let Some(text) = input.as_str() {
        vec![UserInput::text(text)]
    } else {
        serde_json::from_value(input.clone())
            .map_err(|error| AppServerError::InvalidRequest(error.to_string()))?
    };
    if content.is_empty() {
        return Err(AppServerError::InvalidRequest(
            "input must not be empty".into(),
        ));
    }
    let items = content
        .iter()
        .map(|item| match item {
            UserInput::Text { text } => InputItem::Text { text: text.clone() },
            UserInput::Image { url } => InputItem::Image {
                path: None,
                url: Some(url.clone()),
            },
        })
        .collect();
    Ok((items, content))
}

/// Serve newline-delimited JSON-RPC over stdin/stdout, suitable for a GUI or
/// another local process. No credentials are read or emitted.
pub async fn serve_stdio<R, W>(reader: R, writer: W) -> Result<(), AppServerError>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    serve_stdio_with(reader, writer, AppServer::new()).await
}

/// [`serve_stdio`] over any pair of streams, with a caller-configured [`AppServer`].
///
/// This is the in-process entry point: a host that embeds the server (the desktop broker) wires
/// `reader` and `writer` to the two halves of a `tokio::io::duplex` pipe instead of a child
/// process, and configures the server it hands in (for example
/// [`AppServer::with_models_dir`]). The loop ends at end of input, or on an I/O or serialization
/// failure; every session is joined before this returns, so rollouts are flushed.
pub async fn serve_stdio_with<R, W>(
    reader: R,
    writer: W,
    mut server: AppServer,
) -> Result<(), AppServerError>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    serve_stdio_with_server(reader, writer, &mut server).await
}

async fn serve_stdio_with_server<R, W>(
    reader: R,
    mut writer: W,
    server: &mut AppServer,
) -> Result<(), AppServerError>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let result: Result<(), AppServerError> = async {
        let mut lines = reader.lines();
        let mut poll = tokio::time::interval(std::time::Duration::from_millis(10));
        loop {
            tokio::select! {
                line = lines.next_line() => {
                    let Some(line) = line? else { break };
                    if line.trim().is_empty() { continue; }
                    if let Some(response) = server.handle(&line).await? {
                        writer.write_all(response.as_bytes()).await?;
                        writer.write_all(b"\n").await?;
                    }
                },
                _ = poll.tick() => {},
            }
            for notification in server.drain_notifications() {
                writer
                    .write_all(serde_json::to_string(&notification)?.as_bytes())
                    .await?;
                writer.write_all(b"\n").await?;
            }
            writer.flush().await?;
        }
        Ok(())
    }
    .await;
    // EOF and I/O failures must both join the actors: dropping their handles
    // only schedules cleanup, which is too late when Tokio shuts down next.
    let shutdown = server.shutdown().await;
    result.and(shutdown)
}

/// Serve the same JSON-RPC app-server over local HTTP.
///
/// The caller chooses the bind address explicitly; no public interface or
/// credential-bearing cloud transport is enabled implicitly.
pub async fn serve_http(addr: SocketAddr) -> Result<(), AppServerError> {
    validate_http_bind(addr)?;
    serve_http_router(addr, http_router()).await
}

/// Reusable app transport router. Hosts must preserve the loopback-only listener
/// boundary when composing it; RPC/event handlers retain their Host/Origin checks.
pub fn http_router() -> Router {
    http_routes()
        .route("/", get(web::index))
        .route("/app.js", get(web::script))
        .route("/app.css", get(web::style))
}

fn http_routes() -> Router {
    let state = Arc::new(Mutex::new(AppServer::new()));
    Router::new()
        .route("/health", get(http_health).options(http_cors_preflight))
        .route("/healthz", get(http_health).options(http_cors_preflight))
        .route("/rpc", post(http_rpc).options(http_cors_preflight))
        .route("/events", get(http_events).options(http_cors_preflight))
        .route(
            "/notifications",
            get(http_notifications).options(http_cors_preflight),
        )
        .with_state(state)
}

/// Canonical app-ui at `/` and `/app`. Explicit RPC/event routes win over the
/// site's fallback, preserving `/health` JSON and host permission boundaries.
#[cfg(feature = "site")]
pub fn http_router_with_site(
    root: &std::path::Path,
    webos_url: Option<&str>,
) -> Result<Router, AppServerError> {
    let site = aphrody_site::router(root, webos_url)?;
    Ok(http_routes()
        .nest("/workspace", site.clone())
        .fallback_service(site))
}

/// Serve native product site and existing app RPC/events on one loopback-only
/// listener, consuming the same native catalog/rendering owner as CLI and MCP.
#[cfg(feature = "site")]
pub async fn serve_http_with_site(
    root: &std::path::Path,
    addr: SocketAddr,
    webos_url: Option<&str>,
) -> Result<(), AppServerError> {
    validate_http_bind(addr)?;
    serve_http_router(addr, http_router_with_site(root, webos_url)?).await
}

fn validate_http_bind(addr: SocketAddr) -> Result<(), AppServerError> {
    if !addr.ip().is_loopback() {
        return Err(AppServerError::InvalidRequest(
            "the unauthenticated app-server must bind to a loopback address".into(),
        ));
    }
    Ok(())
}

async fn serve_http_router(addr: SocketAddr, app: Router) -> Result<(), AppServerError> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await.map_err(AppServerError::Io)
}

async fn http_health() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    add_cors_headers(&mut headers);
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    (
        headers,
        Json(
            json!({"ok": true, "authentication_required": false, "service": "aphrody-app-server"}),
        ),
    )
}

async fn http_cors_preflight() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    add_cors_headers(&mut headers);
    (StatusCode::NO_CONTENT, headers)
}

async fn http_rpc(
    State(state): State<Arc<Mutex<AppServer>>>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Result<impl IntoResponse, StatusCode> {
    if !trusted_headers(&headers) {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut resp_headers = HeaderMap::new();
    add_cors_headers(&mut resp_headers);
    let mut server = state.lock().await;
    let line = match serde_json::to_string(&request) {
        Ok(line) => line,
        Err(error) => {
            return Ok((
                resp_headers,
                Json(
                    json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":error.to_string()}}),
                ),
            ));
        }
    };
    let json_resp = match server.handle(&line).await {
        Ok(Some(response)) => serde_json::from_str(&response)
            .unwrap_or_else(|error| json!({"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":error.to_string()}})),
        Ok(None) => json!({}),
        Err(error) => json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":error.to_string()}}),
    };
    Ok((resp_headers, Json(json_resp)))
}

async fn http_notifications(
    State(state): State<Arc<Mutex<AppServer>>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, StatusCode> {
    if !trusted_headers(&headers) {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut resp_headers = HeaderMap::new();
    add_cors_headers(&mut resp_headers);
    let notifs = {
        let mut server = state.lock().await;
        server.drain_notifications()
    };
    Ok((resp_headers, Json(json!({ "notifications": notifs }))))
}

async fn http_events(
    State(state): State<Arc<Mutex<AppServer>>>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    if !trusted_headers(&headers) {
        return Err(StatusCode::FORBIDDEN);
    }
    use futures::StreamExt as _;

    let stream = futures::stream::unfold(
        (
            state,
            tokio::time::interval(std::time::Duration::from_millis(50)),
        ),
        |(state, mut interval)| async move {
            interval.tick().await;
            let notifs = {
                let mut server = state.lock().await;
                server.drain_notifications()
            };
            Some((notifs, (state, interval)))
        },
    )
    .flat_map(futures::stream::iter)
    .map(|notif| {
        Ok::<SseEvent, std::convert::Infallible>(SseEvent::default().data(notif.to_string()))
    });

    let sse = Sse::new(stream).keep_alive(KeepAlive::default());
    let mut res = sse.into_response();
    add_cors_headers(res.headers_mut());
    Ok(res)
}

fn add_cors_headers(headers: &mut HeaderMap) {
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS, PUT, DELETE"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type, Authorization, X-Requested-With, Origin, Accept"),
    );
}

fn trusted_headers(headers: &HeaderMap) -> bool {
    let Some(host) = headers.get("host").and_then(|value| value.to_str().ok()) else {
        return false;
    };
    let Ok(authority) = host.parse::<axum::http::uri::Authority>() else {
        return false;
    };
    let hostname = authority
        .host()
        .trim_start_matches('[')
        .trim_end_matches(']');
    let local = hostname.eq_ignore_ascii_case("localhost")
        || hostname
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if !local {
        return false;
    }
    if headers
        .get("sec-fetch-site")
        .is_some_and(|value| value == "cross-site")
    {
        return false;
    }
    if let Some(origin) = headers.get("origin") {
        let Ok(origin) = origin
            .to_str()
            .unwrap_or_default()
            .parse::<axum::http::Uri>()
        else {
            return false;
        };
        let is_tauri = origin.scheme_str() == Some("tauri");
        let is_same_host = (origin.scheme_str() == Some("http")
            || origin.scheme_str() == Some("https"))
            && origin
                .authority()
                .is_some_and(|value| value.as_str().eq_ignore_ascii_case(host));
        if !is_tauri && !is_same_host {
            return false;
        }
        return origin
            .path_and_query()
            .is_none_or(|value| value.as_str() == "/");
    }
    true
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn system_prompt() -> String {
    let policy = "Act proactively. Execute local tools immediately without asking for \
                  confirmation. For unfamiliar work, inspect before acting; use repository search \
                  and structured data extraction. Prefer local RAG/memory, OCR for images and \
                  documents, and computer-use/browser tools when available. Cross-check findings, \
                  then return concise, direct results with essential evidence and next action.";
    let home = AgentHome::open(HomeOptions::default())
        .ok()
        .map(|agent_home| {
            agent_home
                .system_prompt(&BootstrapBudget::default())
                .render()
        })
        .unwrap_or_default();
    if home.trim().is_empty() {
        policy.to_string()
    } else {
        format!("{policy}\n\n{home}")
    }
}

#[cfg(test)]
mod tests {
    use aphrody_agent_runtime::RuntimeConfig;

    use super::*;

    fn test_server() -> AppServer {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(
            home.path().join("config.toml"),
            r#"
model = "fixture"
model_provider = "fixture"

[model_providers.fixture]
name = "Deterministic test provider"
base_url = "http://127.0.0.1:9/v1"
wire_api = "chat"
"#,
        )
        .unwrap();
        let mut server = AppServer::with_home(home.path());
        server.test_home = Some(home);
        server
    }

    async fn initialized_server() -> AppServer {
        let mut server = test_server();
        server
            .handle(r#"{"id":0,"method":"initialize"}"#)
            .await
            .unwrap();
        server.handle(r#"{"method":"initialized"}"#).await.unwrap();
        server
    }

    #[test]
    fn ephemeral_host_prompt_and_empty_tool_surface_use_canonical_runtime() {
        let home = tempfile::tempdir().unwrap();
        let params = json!({"ephemeral":true,"systemPrompt":" exact host prompt \n","builtins":false,"subagents":false});
        let resolved = config::resolve(home.path(), &json!({})).unwrap();
        let runtime = config::runtime(&resolved, home.path(), home.path(), &params).unwrap();
        assert_eq!(
            runtime.system_prompt.as_deref(),
            Some(" exact host prompt \n")
        );
        assert!(runtime.live_agent_home_workspace.is_none());
        assert!(runtime.rag_db.is_none());
        let registry = build_tool_registry(&runtime).unwrap();
        assert!(registry.definitions().is_empty());
        for unsupported in [
            json!({"systemPrompt":"host"}),
            json!({"builtins":false}),
            json!({"tools":[{"name":""}]}),
            json!({"subagents":true}),
            json!({"permissions":"invalid-owner"}),
            json!({"ephemeral":true,"systemPrompt":" \n"}),
        ] {
            assert!(config::runtime(&resolved, home.path(), home.path(), &unsupported).is_err());
        }
    }

    #[test]
    fn models_dir_is_an_explicit_option_and_not_an_environment_variable() {
        assert_eq!(AppServer::with_home("home").models_dir(), None);
        let chosen = AppServer::with_home("home").with_models_dir("models");
        assert_eq!(chosen.models_dir(), Some(std::path::Path::new("models")));
    }

    #[tokio::test]
    async fn serve_stdio_with_answers_over_in_memory_pipes_and_ends_at_eof() {
        // The in-process transport of the desktop broker: one pipe per direction, no child.
        let (mut client_writer, server_reader) = tokio::io::duplex(64 * 1024);
        let (server_writer, client_reader) = tokio::io::duplex(64 * 1024);
        let served = tokio::spawn(serve_stdio_with(
            tokio::io::BufReader::new(server_reader),
            server_writer,
            test_server(),
        ));
        client_writer
            .write_all(b"{\"id\":1,\"method\":\"initialize\"}\n")
            .await
            .unwrap();
        let mut lines = tokio::io::BufReader::new(client_reader).lines();
        let reply = tokio::time::timeout(std::time::Duration::from_secs(5), lines.next_line())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let reply: Value = serde_json::from_str(&reply).unwrap();
        assert_eq!(reply["id"], 1);
        assert_eq!(reply["result"]["serverInfo"]["name"], "aphrody");
        // Closing the client end is the shutdown signal: the loop joins its sessions and returns.
        drop(client_writer);
        tokio::time::timeout(std::time::Duration::from_secs(5), served)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn model_list_reports_configured_and_active_models_without_claiming_installation() {
        let mut server = initialized_server().await;
        let initial = request(&mut server, "model/list", json!({})).await;
        let initial_models = initial["result"]["data"].as_array().unwrap();
        assert_eq!(initial_models.len(), 1, "{initial}");
        assert_eq!(initial_models[0]["model"], "fixture");
        assert_eq!(initial_models[0]["source"], "configured");
        assert_eq!(initial_models[0]["availability"], "unknown");

        let started = request(
            &mut server,
            "thread/start",
            json!({"model": "session-model"}),
        )
        .await;
        let thread_id = started["result"]["thread"]["id"].as_str().unwrap();
        let listed = request(&mut server, "models/list", json!({})).await;
        let models = listed["result"]["data"].as_array().unwrap();
        assert_eq!(models.len(), 2, "{listed}");
        assert_eq!(models[1]["model"], "session-model");
        assert_eq!(models[1]["provider"], "fixture");
        assert_eq!(models[1]["source"], "active-thread");
        assert_eq!(models[1]["availability"], "unknown");

        request(&mut server, "thread/close", json!({"threadId": thread_id})).await;
        let after_close = request(&mut server, "model/list", json!({})).await;
        assert_eq!(after_close["result"]["data"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn mcp_server_status_lists_configured_servers_without_exposing_credentials() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(
            home.path().join("config.toml"),
            "[mcp_servers.alpha]\ncommand = 'fixture'\nenabled = false\n\
             [mcp_servers.alpha.env]\nACCESS_TOKEN = 'private-value'\n\
             [mcp_servers.beta]\nurl = 'https://example.invalid/mcp'\n",
        )
        .unwrap();
        let mut server = AppServer::with_home(home.path());
        request(&mut server, "initialize", json!({})).await;
        server.handle(r#"{"method":"initialized"}"#).await.unwrap();
        let response = request(&mut server, "mcpServerStatus/list", json!({})).await;
        let decoded: aphrody_app_protocol::ListMcpServerStatusResponse =
            serde_json::from_value(response["result"].clone()).unwrap();
        assert_eq!(decoded.servers.len(), 2);
        assert_eq!(decoded.servers[0].name, "alpha");
        assert_eq!(decoded.servers[0].status, "disabled");
        assert_eq!(decoded.servers[1].name, "beta");
        assert_eq!(decoded.servers[1].status, "unknown");
        assert!(!response.to_string().contains("private-value"));
        let invalid = request(&mut server, "mcpServerStatus/list", json!({"cursor": "1"})).await;
        assert_eq!(invalid["error"]["code"], -32602);
    }

    #[tokio::test]
    async fn config_read_returns_effective_profile_without_provider_secrets() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(
            home.path().join("config.toml"),
            "model = 'base-model'\nmodel_provider = 'fixture'\n\
             [model_providers.fixture]\nname = 'Fixture'\nbase_url = 'http://127.0.0.1:9/v1'\n\
             wire_api = 'chat'\nexperimental_bearer_token = 'private-value'\n\
             [profiles.team]\nmodel = 'team-model'\n",
        )
        .unwrap();
        let mut server = AppServer::with_home(home.path());
        request(&mut server, "initialize", json!({"profile": "team"})).await;
        server.handle(r#"{"method":"initialized"}"#).await.unwrap();
        let response = request(&mut server, "config/read", json!({})).await;
        let decoded: aphrody_app_protocol::ConfigReadResponse =
            serde_json::from_value(response["result"].clone()).unwrap();
        assert_eq!(decoded.config["model"], "team-model");
        assert_eq!(decoded.config["model_provider"], "fixture");
        assert_eq!(
            decoded.config_path,
            Some(
                home.path()
                    .join("config.toml")
                    .to_string_lossy()
                    .into_owned()
            )
        );
        assert!(!response.to_string().contains("private-value"));
        let scoped = request(&mut server, "config/read", json!({"threadId": "missing"})).await;
        assert_eq!(scoped["error"]["code"], -32602);
    }

    #[tokio::test]
    async fn account_login_accepts_local_oss_and_never_echoes_api_keys() {
        let mut server = initialized_server().await;
        let success = request(&mut server, "account/login/start", json!({"mode": "oss"})).await;
        let decoded: aphrody_app_protocol::LoginAccountResponse =
            serde_json::from_value(success["result"].clone()).unwrap();
        assert!(decoded.completed);
        assert!(decoded.login_url.is_none());
        let rejected = request(
            &mut server,
            "account/login/start",
            json!({"mode": "apikey", "apiKey": "private-value"}),
        )
        .await;
        assert_eq!(rejected["error"]["code"], -32602);
        assert!(!rejected.to_string().contains("private-value"));
        let wrong = request(
            &mut server,
            "account/login/start",
            json!({"mode": "oss", "apiKey": "private-value"}),
        )
        .await;
        assert_eq!(wrong["error"]["code"], -32602);
        assert!(!wrong.to_string().contains("private-value"));
    }

    #[tokio::test]
    async fn account_read_reports_only_verified_local_mode() {
        let home = tempfile::tempdir().unwrap();
        let mut local = AppServer::with_home(home.path());
        request(&mut local, "initialize", json!({})).await;
        local.handle(r#"{"method":"initialized"}"#).await.unwrap();
        let response = request(&mut local, "account/read", json!({})).await;
        let account: aphrody_app_protocol::GetAccountResponse =
            serde_json::from_value(response["result"].clone()).unwrap();
        assert_eq!(account.auth_mode, Some(aphrody_app_protocol::AuthMode::Oss));
        assert_eq!(account.plan.as_deref(), Some("oss"));
        assert!(account.email.is_none());

        let mut external = test_server();
        request(&mut external, "initialize", json!({})).await;
        external
            .handle(r#"{"method":"initialized"}"#)
            .await
            .unwrap();
        let response = request(&mut external, "account/read", json!({})).await;
        let account: aphrody_app_protocol::GetAccountResponse =
            serde_json::from_value(response["result"].clone()).unwrap();
        assert!(account.auth_mode.is_none());
        assert!(account.plan.is_none());
        assert!(account.email.is_none());

        let invalid = request(&mut local, "account/read", json!({"includeSecrets": true})).await;
        assert_eq!(invalid["error"]["code"], -32602);
    }

    #[cfg(feature = "rag")]
    #[tokio::test]
    async fn rag_extensions_require_capability_and_query_the_profile_index() {
        let mut disabled = initialized_server().await;
        assert_eq!(
            request(&mut disabled, "aphrody/rag/status", json!({})).await["error"]["code"],
            -32602
        );

        let mut server = test_server();
        let initialized = request(
            &mut server,
            "initialize",
            json!({"capabilities": {"aphrody": true}}),
        )
        .await;
        assert_eq!(initialized["result"]["capabilities"]["aphrody"], true);
        server.handle(r#"{"method":"initialized"}"#).await.unwrap();

        let db = server.home.join("rag/index.db");
        std::fs::create_dir_all(db.parent().unwrap()).unwrap();
        let store = RagStore::open(&db).unwrap();
        let doc = store
            .upsert_doc("notes.md", "hash", None, Some("en"), 1, 64)
            .await
            .unwrap();
        store
            .insert_chunk(
                doc,
                0,
                None,
                None,
                "Profile retrieval is isolated per Aphrody profile.",
                1,
                1,
                10,
            )
            .await
            .unwrap();
        store.meta_set("embed_model_id", "ort:test").await.unwrap();

        let search = request(
            &mut server,
            "aphrody/rag/search",
            json!({"query": "Profile retrieval", "topK": 3}),
        )
        .await;
        assert_eq!(search["result"]["results"][0]["path"], "notes.md");

        let context = request(
            &mut server,
            "aphrody/rag/context",
            json!({"query": "Profile retrieval", "maxTokens": 100}),
        )
        .await;
        assert!(
            context["result"]["promptContext"]
                .as_str()
                .unwrap()
                .contains("Profile retrieval")
        );
        assert_eq!(context["result"]["sources"], json!(["notes.md"]));

        let status = request(&mut server, "aphrody/rag/status", json!({})).await;
        assert_eq!(status["result"]["indexedDocuments"], 1);
        assert_eq!(status["result"]["totalChunks"], 1);
        assert_eq!(status["result"]["embedModel"], "ort:test");
        assert_eq!(
            status["result"]["databasePath"],
            db.to_string_lossy().as_ref()
        );
    }

    #[test]
    fn profile_selection_uses_initialize_then_environment_then_config() {
        let base = tempfile::tempdir().unwrap();
        std::fs::write(
            base.path().join("config.toml"),
            "profile = \"configured\"\n",
        )
        .unwrap();
        assert_eq!(
            config::select_profile_with_environment(
                base.path(),
                &json!({"profile": " explicit "}),
                Some("environment"),
            )
            .unwrap()
            .as_deref(),
            Some("explicit")
        );
        assert_eq!(
            config::select_profile_with_environment(base.path(), &json!({}), Some(" environment "))
                .unwrap()
                .as_deref(),
            Some("environment")
        );
        assert_eq!(
            config::select_profile_with_environment(base.path(), &json!({}), None)
                .unwrap()
                .as_deref(),
            Some("configured")
        );
    }

    #[test]
    fn profile_home_is_contained_and_no_profile_keeps_the_exact_base() {
        let base = tempfile::tempdir().unwrap();
        assert_eq!(config::profile_home(base.path(), None), base.path());
        let isolated = config::profile_home(base.path(), Some("../../Escape"));
        assert_eq!(isolated, base.path().join("workspace-escape"));
        assert!(isolated.starts_with(base.path()));

        let params = json!({"config": {
            "profiles": {"safe": {}},
            "rag": {"enabled": true},
        }});
        let resolved = config::resolve_with_profile(base.path(), &params, Some("safe")).unwrap();
        let runtime = config::runtime(&resolved, &isolated, base.path(), &json!({})).unwrap();
        assert_eq!(runtime.rag_db, Some(isolated.join("rag/index.db")));
    }

    #[tokio::test]
    async fn initialize_returns_the_sanitized_profile_home() {
        let mut server = test_server();
        let expected = std::path::absolute(server.base_home.join("workspace-team")).unwrap();
        let initialized =
            request(&mut server, "initialize", json!({"profile": "../../Team"})).await;
        assert_eq!(
            initialized["result"]["codexHome"],
            expected.to_string_lossy().as_ref()
        );
        assert_eq!(server.home, expected);
    }

    #[tokio::test]
    async fn thread_resolves_profile_from_base_config_and_persists_under_profile_home() {
        let base = tempfile::tempdir().unwrap();
        std::fs::write(
            base.path().join("config.toml"),
            r#"
model = "base-model"
model_provider = "fixture"

[model_providers.fixture]
name = "Deterministic test provider"
base_url = "http://127.0.0.1:9/v1"
wire_api = "chat"

[profiles.worker]
model = "worker-model"
model_provider = "fixture"
"#,
        )
        .unwrap();
        let mut server = AppServer::with_home(base.path());
        request(&mut server, "initialize", json!({"profile": "worker"})).await;
        server.handle(r#"{"method":"initialized"}"#).await.unwrap();
        let started = request(&mut server, "thread/start", json!({})).await;
        assert_eq!(started["result"]["thread"]["model"], "worker-model");
        assert_eq!(
            server.home,
            base.path().join("workspace-worker"),
            "profile state must be derived from the base without replacing it for config loading"
        );
        let id = started["result"]["thread"]["id"].clone();
        request(&mut server, "thread/close", json!({"threadId": id})).await;
        assert!(base.path().join("workspace-worker/sessions").is_dir());
        assert!(!base.path().join("sessions").exists());
    }

    async fn request(server: &mut AppServer, method: &str, params: Value) -> Value {
        let response = server
            .handle(&json!({"id": "test", "method": method, "params": params}).to_string())
            .await
            .unwrap()
            .unwrap();
        serde_json::from_str(&response).unwrap()
    }

    #[tokio::test]
    async fn fork_creates_an_independent_persisted_thread() {
        let mut server = initialized_server().await;
        let parent = request(&mut server, "thread/start", json!({})).await;
        let parent_id = parent["result"]["thread"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        request(&mut server, "thread/close", json!({"threadId": parent_id})).await;
        let parent_reopened =
            request(&mut server, "thread/resume", json!({"threadId": parent_id})).await;
        assert_eq!(parent_reopened["result"]["thread"]["id"], parent_id);
        let fork = request(&mut server, "thread/fork", json!({"threadId": parent_id})).await;
        let fork_id = fork["result"]["thread"]["id"].as_str().unwrap().to_string();
        assert_ne!(fork_id, parent_id);
        assert_eq!(
            fork["result"]["thread"]["model"],
            parent["result"]["thread"]["model"]
        );
        // Closing is the native recorder's persistence barrier. Verify the
        // independent fork survives a real reopen before inspecting disk.
        request(&mut server, "thread/close", json!({"threadId": fork_id})).await;
        let reopened = request(&mut server, "thread/resume", json!({"threadId": fork_id})).await;
        assert_eq!(reopened["result"]["thread"]["id"], fork_id);
        let sessions = aphrody_rollout::list_sessions(server.home.join("sessions"))
            .await
            .unwrap();
        let fork_session = sessions
            .sessions
            .iter()
            .find(|session| session.meta.id == fork_id)
            .unwrap();
        assert_eq!(
            fork_session.meta.forked_from.as_deref(),
            Some(parent_id.as_str())
        );
        assert!(
            sessions
                .sessions
                .iter()
                .any(|session| session.meta.id == parent_id)
        );
        let compact = request(
            &mut server,
            "thread/compact/start",
            json!({"threadId": fork_id}),
        )
        .await;
        assert_eq!(compact["result"], json!({}));
        let bad = request(&mut server, "thread/fork", json!({"threadId": "missing"})).await;
        assert_eq!(bad["error"]["code"], -32602);
        let missing_compact = request(
            &mut server,
            "thread/compact/start",
            json!({"threadId": "missing"}),
        )
        .await;
        assert_eq!(missing_compact["error"]["code"], -32602);
        request(&mut server, "thread/close", json!({"threadId": fork_id})).await;
        request(&mut server, "thread/close", json!({"threadId": parent_id})).await;
        let archived = request(
            &mut server,
            "thread/archive",
            json!({"threadId": parent_id}),
        )
        .await;
        assert_eq!(archived["result"]["archived"], true);
        let archived_list = request(&mut server, "thread/list", json!({"archived": true})).await;
        assert_eq!(archived_list["result"]["data"][0]["id"], parent_id);
        assert_eq!(archived_list["result"]["data"][0]["archived"], true);
        let active_list = request(&mut server, "thread/list", json!({"archived": false})).await;
        assert!(
            !active_list["result"]["data"]
                .as_array()
                .unwrap()
                .iter()
                .any(|thread| thread["id"] == parent_id)
        );
        let blocked = request(&mut server, "thread/resume", json!({"threadId": parent_id})).await;
        assert_eq!(blocked["error"]["code"], -32602);
        let unarchived = request(
            &mut server,
            "thread/unarchive",
            json!({"threadId": parent_id}),
        )
        .await;
        assert_eq!(unarchived["result"]["archived"], false);
    }

    #[tokio::test]
    async fn compact_returns_empty_ack_then_native_items_and_terminal_turn() {
        let mut server = initialized_server().await;
        let start = request(&mut server, "thread/start", json!({})).await;
        let id = start["result"]["thread"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        server.drain_notifications();
        let response = request(&mut server, "thread/compact/start", json!({"threadId": id})).await;
        assert_eq!(response["result"], json!({}));
        let interrupt = request(&mut server, "turn/interrupt", json!({"threadId":id})).await;
        assert_eq!(interrupt["error"]["code"], -32602);
        assert!(
            interrupt["error"]["message"]
                .as_str()
                .unwrap()
                .contains("structural compaction")
        );
        let duplicate = request(&mut server, "thread/compact/start", json!({"threadId": id})).await;
        assert_eq!(duplicate["error"]["code"], -32602);
        let new_turn = request(
            &mut server,
            "turn/start",
            json!({"threadId": id, "input": "racing turn"}),
        )
        .await;
        assert_eq!(new_turn["error"]["code"], -32602);
        let notifications = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            let mut notifications = Vec::new();
            loop {
                notifications.extend(server.drain_notifications());
                if notifications
                    .iter()
                    .any(|event| event["method"] == "turn/completed")
                {
                    break notifications;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let methods = notifications
            .iter()
            .map(|event| event["method"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            methods,
            [
                "turn/started",
                "item/started",
                "item/completed",
                "turn/completed"
            ]
        );
        let item = &notifications[1]["params"]["item"];
        assert_eq!(item["type"], "contextCompaction");
        let typed_item: aphrody_app_protocol::ThreadItem =
            serde_json::from_value(item.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed_item).unwrap(), *item);
        assert_eq!(&notifications[2]["params"]["item"], item);
        assert_eq!(notifications[3]["params"]["turn"]["status"], "completed");
        assert!(server.threads[&id].active_turn.is_none());
        let read = request(
            &mut server,
            "thread/read",
            json!({"threadId": id,"includeTurns":true}),
        )
        .await;
        assert_eq!(read["result"]["thread"]["turns"][0]["items"][0], *item);
        request(&mut server, "thread/close", json!({"threadId":id})).await;
        let resumed = request(&mut server, "thread/resume", json!({"threadId":id})).await;
        assert_eq!(resumed["result"]["thread"]["turns"][0]["items"][0], *item);
        assert_eq!(
            resumed["result"]["thread"]["turns"][0]["status"],
            "completed"
        );
        request(&mut server, "thread/close", json!({"threadId":id})).await;
    }

    #[tokio::test]
    async fn compaction_failure_releases_the_reserved_turn() {
        let mut server = initialized_server().await;
        let start = request(&mut server, "thread/start", json!({})).await;
        let id = start["result"]["thread"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let thread = server.threads.get_mut(&id).unwrap();
        thread.observe(&Event::new(EventMsg::ContextCompactionStarted {
            item_id: "compact-failed".into(),
        }));
        let notifications = thread.observe(&Event::new(EventMsg::Error {
            message: "checkpoint flush failed".into(),
        }));
        assert_eq!(notifications[0]["method"], "turn/completed");
        assert_eq!(notifications[0]["params"]["turn"]["status"], "failed");
        assert!(thread.active_turn.is_none());
        assert_eq!(thread.info.status["type"], "idle");
        request(&mut server, "thread/close", json!({"threadId":id})).await;
    }

    #[tokio::test]
    async fn a_normal_turn_can_be_interrupted_before_its_first_engine_item() {
        let mut server = initialized_server().await;
        let start = request(&mut server, "thread/start", json!({})).await;
        let id = start["result"]["thread"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let turn = request(
            &mut server,
            "turn/start",
            json!({"threadId":id,"input":[{"type":"text","text":"hello"}]}),
        )
        .await;
        assert_eq!(turn["result"]["turn"]["status"], "inProgress");
        // No provider event has been drained; the actor has not supplied an
        // assistant item. Turn kind must not be inferred from visible items.
        server
            .threads
            .get_mut(&id)
            .unwrap()
            .active_turn
            .as_mut()
            .unwrap()["items"] = json!([]);
        let interrupted = request(
            &mut server,
            "turn/interrupt",
            json!({"threadId":id,"turnId":turn["result"]["turn"]["id"]}),
        )
        .await;
        assert!(interrupted.get("error").is_none(), "{interrupted}");
        assert!(server.threads[&id].interrupt_requested);
        request(&mut server, "thread/close", json!({"threadId":id})).await;
    }

    #[test]
    fn ui_replay_compaction_failure_and_missing_completion_are_terminal() {
        let started =
            json!({"msg":{"type":"context_compaction_started","item_id":"compact-failure"}});
        let lines = [
            started.clone(),
            json!({"msg":{"type":"error","message":"checkpoint flush failed"}}),
        ]
        .into_iter()
        .map(|item| aphrody_rollout::RolloutLine {
            ts: String::new(),
            item,
        })
        .collect::<Vec<_>>();
        let failed = restore_ui_turns("thread", &lines).unwrap();
        assert_eq!(failed[0]["status"], "failed");
        assert_eq!(failed[0]["error"]["message"], "checkpoint flush failed");
        // If a recorder stays unavailable even for the failure event, an
        // unfinished durable start is interrupted after restart, never success.
        let unfinished = restore_ui_turns(
            "thread",
            &[aphrody_rollout::RolloutLine {
                ts: String::new(),
                item: started,
            }],
        )
        .unwrap();
        assert_eq!(unfinished[0]["status"], "interrupted");
    }

    #[test]
    fn ui_replay_preserves_compaction_item_without_duplicating_checkpoint_history() {
        let user = json!({"role":"user","parts":[{"text":"original question"}]});
        let answer = json!({"role":"model","parts":[{"text":"original answer"}]});
        let items = [
            json!({"type":"history_item","message":user}),
            json!({"msg":{"type":"turn_started"}}),
            json!({"type":"history_item","message":answer}),
            json!({"msg":{"type":"turn_complete"}}),
            json!({"msg":{"type":"context_compaction_started","item_id":"compact-1"}}),
            json!({"type":"history_item","compaction_checkpoint":true,"message":{"role":"user","parts":[{"text":"structural checkpoint"}]}}),
            json!({"type":"history_item","compaction_checkpoint":false,"message":user}),
            json!({"type":"history_item","compaction_checkpoint":false,"message":answer}),
            json!({"msg":{"type":"context_compaction_completed","item_id":"compact-1"}}),
        ];
        let lines = items
            .into_iter()
            .map(|item| aphrody_rollout::RolloutLine {
                ts: String::new(),
                item,
            })
            .collect::<Vec<_>>();
        let turns = restore_ui_turns("thread", &lines).unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0]["items"].as_array().unwrap().len(), 2);
        assert_eq!(
            turns[1]["items"],
            json!([{"type":"contextCompaction","id":"compact-1"}])
        );
        assert_eq!(turns[1]["status"], "completed");
    }

    #[tokio::test]
    async fn fork_replays_parent_history_without_mutating_parent_rollout() {
        let mut server = initialized_server().await;
        let parent_id = "fixture-parent";
        let recorder = aphrody_rollout::RolloutRecorder::create(
            server.home.join("sessions"),
            aphrody_rollout::SessionMeta {
                id: parent_id.into(),
                cwd: Some(std::env::current_dir().unwrap()),
                model: Some("fixture".into()),
                model_provider: Some("fixture".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        recorder
            .record_async(json!({
                "type": aphrody_engine::ROLLOUT_HISTORY_ITEM,
                "message": {"role": "user", "parts": [{"text": "remember this"}]}
            }))
            .await
            .unwrap();
        recorder.shutdown().await.unwrap();
        let parent = aphrody_rollout::find_session(server.home.join("sessions"), parent_id)
            .await
            .unwrap()
            .unwrap();
        let before = tokio::fs::read(&parent.path).await.unwrap();
        let unloaded = request(
            &mut server,
            "thread/read",
            json!({"threadId": parent_id, "includeTurns": true}),
        )
        .await;
        assert_eq!(
            unloaded["result"]["thread"]["turns"][0]["items"][0]["content"][0]["text"],
            "remember this"
        );
        let summary = request(&mut server, "thread/read", json!({"threadId": parent_id})).await;
        assert_eq!(summary["result"]["thread"]["turns"], json!([]));
        let fork = request(&mut server, "thread/fork", json!({"threadId": parent_id})).await;
        assert_eq!(
            fork["result"]["thread"]["turns"][0]["items"][0]["content"][0]["text"],
            "remember this"
        );
        let fork_id = fork["result"]["thread"]["id"].as_str().unwrap();
        let child = aphrody_rollout::find_session(server.home.join("sessions"), fork_id)
            .await
            .unwrap()
            .unwrap();
        let lines = aphrody_rollout::resume(&child.path).await.unwrap();
        assert_eq!(aphrody_engine::restore_history(&lines).messages.len(), 1);
        assert_eq!(tokio::fs::read(&parent.path).await.unwrap(), before);
        let fork_id = fork_id.to_string();
        request(&mut server, "thread/close", json!({"threadId": fork_id})).await;
    }

    #[tokio::test]
    async fn malformed_frames_do_not_close_the_connection() {
        let mut server = initialized_server().await;
        for (frame, code) in [
            ("{", -32700),
            (r#"{"id":{},"method":"thread/list"}"#, -32600),
        ] {
            let response: Value =
                serde_json::from_str(&server.handle(frame).await.unwrap().unwrap()).unwrap();
            assert_eq!(response["error"]["code"], code);
        }
        let response = request(&mut server, "thread/list", json!({})).await;
        assert_eq!(response["result"]["data"], json!([]));
        assert!(response.get("jsonrpc").is_none());
        assert_eq!(
            request(&mut server, "unknown/method", json!({})).await["error"]["code"],
            -32601
        );
    }

    #[tokio::test]
    async fn initialized_notification_cannot_bypass_initialize() {
        let mut server = test_server();
        server.handle(r#"{"method":"initialized"}"#).await.unwrap();
        assert_eq!(
            request(&mut server, "thread/list", json!({})).await["error"]["code"],
            -32002
        );
        let initialized = request(&mut server, "initialize", json!({})).await;
        assert!(
            initialized["result"]["userAgent"]
                .as_str()
                .unwrap()
                .starts_with("aphrody/")
        );
        assert!(
            std::path::Path::new(initialized["result"]["codexHome"].as_str().unwrap())
                .is_absolute()
        );
        assert_eq!(
            request(&mut server, "initialize", json!({})).await["error"]["code"],
            -32602
        );
    }

    #[test]
    fn accepts_v2_multimodal_input_and_legacy_text() {
        let (items, _) = parse_input(&json!({"input": [
            {"type": "text", "text": "inspect", "text_elements": []},
            {"type": "image", "url": "data:image/png;base64,aW1hZ2U="},
        ]}))
        .unwrap();
        assert!(matches!(&items[0], InputItem::Text { text } if text == "inspect"));
        assert!(matches!(
            &items[1],
            InputItem::Image {
                path: None,
                url: Some(_)
            }
        ));
        assert!(parse_input(&json!({"input": "legacy"})).is_ok());
        for input in [json!([]), json!([{"type": "unknown"}]), json!(null)] {
            assert!(parse_input(&json!({"input": input})).is_err());
        }
    }

    #[tokio::test]
    async fn refuses_to_silently_ignore_requested_restrictions() {
        let mut server = initialized_server().await;
        for params in [
            json!({"sandbox": "read-only"}),
            json!({"approvalPolicy": "on-request"}),
            json!({"sandboxPolicy": {"type": "readOnly"}}),
        ] {
            assert_eq!(
                request(&mut server, "thread/start", params).await["error"]["code"],
                -32602
            );
        }
        assert!(server.threads.is_empty());
    }

    #[tokio::test]
    async fn profiled_mcp_is_used_by_tools_list_and_thread_start() {
        let mut server = initialized_server().await;
        let params = json!({"config": {"mcp_servers": {"disabled": {
            "command": "never-spawn",
            "enabled": false,
        }}}});

        let tools = request(&mut server, "tools/list", params.clone()).await;
        assert!(
            tools["result"]["data"]
                .as_array()
                .is_some_and(|tools| !tools.is_empty())
        );

        let started = request(&mut server, "thread/start", params).await;
        let thread_id = started["result"]["thread"]["id"].clone();
        assert!(thread_id.is_string(), "{started}");
        request(&mut server, "thread/close", json!({"threadId": thread_id})).await;
    }

    #[tokio::test]
    async fn malformed_explicit_plugin_manifest_is_a_clear_request_error() {
        let plugin = tempfile::tempdir().unwrap();
        let manifest_dir = plugin.path().join(".codex-plugin");
        std::fs::create_dir(&manifest_dir).unwrap();
        std::fs::write(manifest_dir.join("plugin.json"), "{").unwrap();
        let mut server = initialized_server().await;

        let response = request(
            &mut server,
            "thread/start",
            json!({"config": {"plugins": [plugin.path()]}}),
        )
        .await;

        assert_eq!(response["error"]["code"], -32602);
        let message = response["error"]["message"].as_str().unwrap();
        assert!(message.contains("cannot resolve tool profile"), "{message}");
        assert!(message.contains("invalid JSON"), "{message}");
        assert!(message.contains("plugin.json"), "{message}");
        assert!(server.threads.is_empty());
    }

    #[tokio::test]
    async fn turn_notifications_keep_ids_and_record_terminal_state() {
        let mut server = initialized_server().await;
        let start = request(&mut server, "thread/start", json!({"model": "test-local"})).await;
        let id = start["result"]["thread"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(start["result"]["thread"]["status"]["type"], "idle");
        assert!(start["result"]["thread"]["createdAt"].is_number());
        assert_eq!(server.drain_notifications()[0]["method"], "thread/started");
        let thread = server.threads.get_mut(&id).unwrap();
        thread.active_turn =
            Some(json!({"id": "turn-fixture", "items": [], "status": "inProgress", "error": null}));
        let delta = thread.observe(&Event::new(EventMsg::AgentMessageDelta {
            delta: "hello".into(),
        }));
        let completed = thread.observe(&Event::new(EventMsg::AgentMessage {
            text: "hello".into(),
        }));
        assert_eq!(
            delta.last().unwrap()["params"]["itemId"],
            completed[0]["params"]["item"]["id"]
        );
        thread.interrupt_requested = true;
        let terminal = thread.observe(&Event::new(EventMsg::TurnComplete {
            last_agent_message: Some("hello".into()),
        }));
        assert_eq!(terminal[0]["method"], "turn/completed");
        assert_eq!(terminal[0]["params"]["turn"]["status"], "interrupted");
        assert!(thread.active_turn.is_none());
        assert_eq!(thread.info.turns[0]["items"][0]["text"], "hello");
        request(&mut server, "thread/close", json!({"threadId": id})).await;
    }

    /// Browser / web computer-use activity must reach a watching client, and
    /// must be attributed to the BXC subsystem rather than to a local tool.
    #[tokio::test]
    async fn browser_tool_activity_is_relayed_as_a_bxc_tool_call_item() {
        let mut server = initialized_server().await;
        let start = request(&mut server, "thread/start", json!({"model": "test-local"})).await;
        let id = start["result"]["thread"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let thread = server.threads.get_mut(&id).unwrap();
        thread.active_turn =
            Some(json!({"id": "turn-fixture", "items": [], "status": "inProgress", "error": null}));

        let began = thread.observe(&Event::new(EventMsg::ToolCallBegin {
            call_id: "call-1".into(),
            name: "browser".into(),
        }));
        assert_eq!(began[0]["method"], "item/started");
        assert_eq!(began[0]["params"]["item"]["type"], "mcpToolCall");
        assert_eq!(began[0]["params"]["item"]["serverName"], "bxc");
        assert_eq!(began[0]["params"]["item"]["toolName"], "browser");

        let ended = thread.observe(&Event::new(EventMsg::ToolCallEnd {
            call_id: "call-1".into(),
            ok: true,
        }));
        assert_eq!(ended[0]["method"], "item/completed");
        assert_eq!(
            ended[0]["params"]["item"]["id"], began[0]["params"]["item"]["id"],
            "begin and end must correlate through the same item id"
        );
        assert_eq!(ended[0]["params"]["item"]["result"]["ok"], true);
        assert_eq!(
            thread.active_turn.as_ref().unwrap()["items"][0]["toolName"],
            "browser"
        );

        // A local tool is not attributed to BXC.
        let shell = thread.observe(&Event::new(EventMsg::ToolCallBegin {
            call_id: "call-2".into(),
            name: "shell".into(),
        }));
        assert_eq!(shell[0]["params"]["item"]["serverName"], "aphrody");

        // An end with no matching begin is ignored rather than inventing an item.
        let orphan = thread.observe(&Event::new(EventMsg::ToolCallEnd {
            call_id: "never-started".into(),
            ok: false,
        }));
        assert!(orphan.is_empty());

        request(&mut server, "thread/close", json!({"threadId": id})).await;
    }

    #[tokio::test]
    async fn v2_turn_returns_immediately_and_streams_the_real_engine_result() {
        use aphrody_agent_runtime::{ScriptedTurn, StubModelClient};

        let mut server = initialized_server().await;
        let start = request(&mut server, "thread/start", json!({"model": "fixture"})).await;
        let id = start["result"]["thread"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let mut thread = server.threads.remove(&id).unwrap();
        thread.handle.submit(Op::Shutdown).unwrap();
        thread.handle.join().await.unwrap();
        let runtime = AgentRuntime::builder()
            .config(RuntimeConfig::new("fixture"))
            .model(ModelChoice::stub(StubModelClient::new(
                "fixture",
                vec![ScriptedTurn::text("fixture result")],
            )))
            .build()
            .unwrap();
        let mut handle = runtime.spawn().await.unwrap();
        thread.events = handle.events().unwrap();
        thread.handle = handle;
        server.threads.insert(id.clone(), thread);
        let response = request(
            &mut server,
            "turn/start",
            json!({"threadId": id, "input": [{"type": "text", "text": "hello"}]}),
        )
        .await;
        assert_eq!(response["result"]["turn"]["status"], "inProgress");
        let turn_id = response["result"]["turn"]["id"].clone();
        let duplicate = request(
            &mut server,
            "turn/start",
            json!({"threadId": id, "input": [{"type": "text", "text": "duplicate"}]}),
        )
        .await;
        assert_eq!(duplicate["error"]["code"], -32602);
        let wrong_turn = request(
            &mut server,
            "turn/interrupt",
            json!({"threadId": id, "turnId": "other"}),
        )
        .await;
        assert_eq!(wrong_turn["error"]["code"], -32602);
        let notifications = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            let mut notifications = Vec::new();
            loop {
                notifications.extend(server.drain_notifications());
                if notifications
                    .iter()
                    .any(|event| event["method"] == "turn/completed")
                {
                    break notifications;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let completed = notifications
            .iter()
            .find(|event| event["method"] == "turn/completed")
            .unwrap();
        assert_eq!(completed["params"]["turn"]["id"], turn_id);
        assert_eq!(completed["params"]["turn"]["status"], "completed");
        assert_eq!(
            completed["params"]["turn"]["items"][1]["text"],
            "fixture result"
        );
        let read = request(
            &mut server,
            "thread/read",
            json!({"threadId": id, "includeTurns": true}),
        )
        .await;
        assert_eq!(read["result"]["thread"]["turns"][0]["id"], turn_id);
        request(&mut server, "thread/close", json!({"threadId": id})).await;
    }

    #[test]
    fn http_requires_loopback_host_and_same_origin() {
        for (host, origin, allowed) in [
            ("localhost:8789", None, true),
            ("127.0.0.1:8789", Some("http://127.0.0.1:8789"), true),
            ("[::1]:8789", Some("http://[::1]:8789"), true),
            ("localhost:8789", Some("http://localhost:3000"), false),
            ("localhost:8789", Some("https://evil.example"), false),
            ("localhost:8789", Some("null"), false),
            ("evil.example:8789", None, false),
        ] {
            let mut headers = HeaderMap::new();
            headers.insert("host", host.parse().unwrap());
            if let Some(origin) = origin {
                headers.insert("origin", origin.parse().unwrap());
            }
            assert_eq!(trusted_headers(&headers), allowed, "{host} {origin:?}");
        }
    }

    #[tokio::test]
    async fn http_refuses_public_bind_before_opening_listener() {
        let error = serve_http("0.0.0.0:0".parse().unwrap()).await.unwrap_err();
        assert!(error.to_string().contains("loopback"));
    }

    #[cfg(feature = "site")]
    #[tokio::test]
    async fn site_composition_preserves_transport_with_the_canonical_app_ui() {
        use axum::{
            body::{Body, to_bytes},
            http::Request,
        };
        use tower::ServiceExt;

        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("packages/m3-templates")).unwrap();
        std::fs::write(root.path().join("packages/m3-templates/stack.toml"), "").unwrap();
        let ui = root.path().join("packages/app-ui/dist");
        std::fs::create_dir_all(&ui).unwrap();
        let shell = "<div id=\"root\">canonical app-ui</div><script src=\"/app.js\"></script>";
        std::fs::write(ui.join("index.html"), shell).unwrap();
        std::fs::write(ui.join("app.js"), "canonical_bundle").unwrap();
        std::fs::write(ui.join("app.css"), "canonical_theme").unwrap();
        let app = http_router_with_site(root.path(), Some("http://127.0.0.1:3001")).unwrap();
        for path in [
            "/",
            "/docs",
            "/templates",
            "/api/docs",
            "/api/templates",
            "/app",
            "/app/",
            "/app.js",
            "/app.css",
            "/workspace/os",
            "/workspace/app.js",
            "/workspace/app.css",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            if matches!(
                path,
                "/" | "/app" | "/app/" | "/docs" | "/templates" | "/workspace/os"
            ) {
                let bytes = to_bytes(response.into_body(), 2 * 1024 * 1024)
                    .await
                    .unwrap();
                assert_eq!(bytes.as_ref(), shell.as_bytes());
            }
        }
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        let health: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024).await.unwrap()).unwrap();
        assert_eq!(health["service"], "aphrody-app-server");
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/rpc")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/rpc")
                    .header(header::HOST, "evil.invalid")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/webos")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
    }

    #[cfg(feature = "site")]
    #[tokio::test]
    async fn site_composition_refuses_public_bind_before_catalog_loading() {
        let error = serve_http_with_site(
            std::path::Path::new("nonexistent-template-root"),
            "0.0.0.0:0".parse().unwrap(),
            None,
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("loopback"));
    }

    #[test]
    fn server_config_wires_provider_yolo_rag_and_refuses_ignored_restrictions() {
        let home = tempfile::tempdir().unwrap();
        let params = json!({"model": "open-weights", "modelProvider": "custom", "config": {
            "model_providers": {"custom": {"name": "custom", "base_url": "http://127.0.0.1:9999/v1", "wire_api": "chat"}},
            "model_auto_compact_token_limit": 16384,
            "rag": {"enabled": true, "db_path": "index.db"},
            "mcp_servers": {"disabled": {"command": "never-spawn", "enabled": false}},
        }});
        let resolved = config::resolve(home.path(), &params).unwrap();
        let runtime = config::runtime(&resolved, home.path(), home.path(), &params).unwrap();
        assert_eq!(resolved.provider.id, "custom");
        assert_eq!(runtime.model, "open-weights");
        assert_eq!(runtime.max_tool_iterations, 0);
        assert_eq!(runtime.auto_compact_token_limit, Some(16_384));
        assert_eq!(
            runtime.autonomy,
            aphrody_agent_runtime::AutonomyMode::FullAuto
        );
        assert_eq!(runtime.rag_db, Some(home.path().join("index.db")));
        assert_eq!(
            runtime
                .tool_profile
                .as_ref()
                .expect("configured MCP server must create a tool profile")
                .mcp_servers
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            vec!["disabled"]
        );
        let dotted = config::resolve(
            home.path(),
            &json!({"config": {"rag.enabled": true, "rag.db_path": "dotted.db"}}),
        )
        .unwrap();
        assert_eq!(dotted.rag.enabled, Some(true));
        assert_eq!(dotted.rag.db_path.as_deref(), Some("dotted.db"));
        assert!(
            config::resolve(
                home.path(),
                &json!({"config": {"sandbox_mode": "read-only"}})
            )
            .is_err()
        );
        let invalid_limit = config::resolve(
            home.path(),
            &json!({"model": "open-weights", "modelProvider": "custom", "config": {
                "model_providers": {"custom": {"name": "custom", "base_url": "http://127.0.0.1:9999/v1", "wire_api": "chat"}},
                "model_auto_compact_token_limit": -1,
            }}),
        )
        .unwrap();
        assert!(config::runtime(&invalid_limit, home.path(), home.path(), &json!({})).is_err());
    }

    #[test]
    fn server_config_selects_managed_oss_without_inventing_an_endpoint() {
        let home = tempfile::tempdir().unwrap();
        let managed = config::resolve(home.path(), &json!({"oss": true})).unwrap();
        assert_eq!(managed.provider.id, "llama");
        assert_eq!(
            managed.provider.info.managed,
            Some(aphrody_config::ManagedRuntime::LlamaServer)
        );
        assert!(managed.provider.info.base_url.is_none());

        let external = config::resolve(
            home.path(),
            &json!({"oss": true, "localProvider": "lmstudio"}),
        )
        .unwrap();
        assert_eq!(external.provider.id, "lmstudio");
        assert_eq!(external.model.as_deref(), Some("openai/gpt-oss-20b"));
        assert!(config::resolve(home.path(), &json!({"oss": "yes"})).is_err());
    }

    #[tokio::test]
    async fn managed_oss_fails_before_model_download_when_runtime_is_missing() {
        let mut server = initialized_server().await;
        let runtime_dir = server
            .test_home
            .as_ref()
            .unwrap()
            .path()
            .join("empty-runtime");
        std::fs::create_dir(&runtime_dir).unwrap();
        let response = request(
            &mut server,
            "thread/start",
            json!({
                "oss": true,
                "config": {"llama": {"runtime_dir": runtime_dir}},
            }),
        )
        .await;
        assert_eq!(response["error"]["code"], -32603);
        assert!(
            response["error"]["message"]
                .as_str()
                .unwrap()
                .contains("llama-server absent from configured runtime_dir")
        );
        assert!(server.threads.is_empty());
    }

    #[tokio::test]
    async fn durable_resume_replays_history_to_the_configured_provider() {
        let captured = Arc::new(Mutex::new(Vec::<Value>::new()));
        let app =
            Router::new()
                .route(
                    "/v1/chat/completions",
                    post(
                        |State(captured): State<Arc<Mutex<Vec<Value>>>>,
                         Json(body): Json<Value>| async move {
                            captured.lock().await.push(body);
                            (
                                [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
                                "data: {\"choices\":[{\"delta\":{\"content\":\"fixture \
                                 answer\"}}]}\n\ndata: \
                                 {\"choices\":[{\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n",
                            )
                        },
                    ),
                )
                .with_state(captured.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let backend = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let provider = json!({"model_providers": {"fixture": {"name": "fixture", "base_url": format!("http://{address}/v1"), "wire_api": "chat"}}});
        let mut server = initialized_server().await;
        let start = request(
            &mut server,
            "thread/start",
            json!({"model": "fixture", "modelProvider": "fixture", "config": provider}),
        )
        .await;
        let id = start["result"]["thread"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(start["result"]["thread"]["ephemeral"], false);
        let home = server.test_home.take().unwrap();
        let mut first_turn_id = Value::Null;
        for (iteration, prompt) in ["first question", "follow-up question"]
            .into_iter()
            .enumerate()
        {
            if iteration > 0 {
                server = AppServer::with_home(home.path());
                request(&mut server, "initialize", json!({})).await;
                server.handle(r#"{"method":"initialized"}"#).await.unwrap();
                let listed = request(&mut server, "thread/list", json!({"limit": 1})).await;
                assert_eq!(listed["result"]["data"][0]["id"], id);
                assert_eq!(listed["result"]["data"][0]["status"]["type"], "notLoaded");
                let resumed = request(
                    &mut server,
                    "thread/resume",
                    json!({"threadId": id, "config": provider}),
                )
                .await;
                assert_eq!(resumed["result"]["thread"]["id"], id);
                assert_eq!(resumed["result"]["thread"]["turns"][0]["id"], first_turn_id);
                assert_eq!(
                    resumed["result"]["thread"]["turns"][0]["items"][0]["content"][0]["text"],
                    "first question"
                );
                assert_eq!(
                    resumed["result"]["thread"]["turns"][0]["items"][1]["text"],
                    "fixture answer"
                );
                assert_eq!(resumed["result"]["thread"]["preview"], "first question");
            }
            let started = request(
                &mut server,
                "turn/start",
                json!({"threadId": id, "input": [{"type": "text", "text": prompt}]}),
            )
            .await;
            assert_eq!(started["result"]["turn"]["status"], "inProgress");
            if iteration == 0 {
                first_turn_id = started["result"]["turn"]["id"].clone();
            }
            tokio::time::timeout(std::time::Duration::from_secs(5), async {
                loop {
                    let notifications = server.drain_notifications();
                    if let Some(done) = notifications
                        .iter()
                        .find(|event| event["method"] == "turn/completed")
                    {
                        assert_eq!(done["params"]["turn"]["status"], "completed", "{done}");
                        break;
                    }
                    // Give the current-thread test runtime an actual I/O poll
                    // opportunity; a permanently-ready yield loop can starve
                    // the loopback SSE server on Windows.
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
            })
            .await
            .unwrap();
            serve_stdio_with_server(
                tokio::io::BufReader::new(tokio::io::empty()),
                tokio::io::sink(),
                &mut server,
            )
            .await
            .unwrap();
            assert!(server.threads.is_empty());
        }
        let requests = captured.lock().await;
        assert_eq!(requests.len(), 2);
        let replayed = requests[1]["messages"].to_string();
        assert!(replayed.contains("first question"));
        assert!(replayed.contains("fixture answer"));
        assert!(replayed.contains("follow-up question"));
        backend.abort();
    }

    #[test]
    fn ui_replay_keeps_steering_and_tool_results_inside_the_original_turn() {
        let items = [
            json!({"type":"history_item","message":{"role":"user","parts":[{"text":"question"}]}}),
            json!({"msg":{"type":"turn_started"}}),
            json!({"type":"history_item","message":{"role":"model","parts":[{"function_call":{"id":"call-1","name":"read_file","args":{"path":"README.md"}}}]}}),
            json!({"type":"history_item","message":{"role":"tool","parts":[{"function_response":{"id":"call-1","name":"read_file","response":{"text":"file contents"},"images":[]}}]}}),
            json!({"type":"history_item","message":{"role":"user","parts":[{"text":"steering"}]}}),
            json!({"type":"history_item","message":{"role":"model","parts":[{"text":"answer"}]}}),
            json!({"msg":{"type":"turn_complete"}}),
            json!({"type":"history_item","message":{"role":"user","parts":[{"text":"unfinished"}]}}),
            json!({"msg":{"type":"turn_started"}}),
        ];
        let lines = items
            .into_iter()
            .map(|item| aphrody_rollout::RolloutLine {
                ts: String::new(),
                item,
            })
            .collect::<Vec<_>>();
        let turns = restore_ui_turns("thread", &lines).unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0]["id"], "thread-turn-1");
        assert_eq!(turns[0]["items"][1]["type"], "dynamicToolCall");
        assert_eq!(turns[0]["items"][1]["status"], "completed");
        assert!(
            turns[0]["items"][1]["contentItems"][0]["text"]
                .as_str()
                .unwrap()
                .contains("file contents")
        );
        assert_eq!(turns[0]["items"][2]["content"][0]["text"], "steering");
        assert_eq!(turns[0]["items"][3]["text"], "answer");
        assert_eq!(turns[0]["status"], "completed");
        assert_eq!(turns[1]["status"], "interrupted");
    }

    #[tokio::test]
    async fn lists_loaded_and_persisted_threads_once_with_pagination() {
        let mut server = initialized_server().await;
        let first = request(&mut server, "thread/start", json!({"model":"local"})).await;
        let first_id = first["result"]["thread"]["id"].clone();
        request(&mut server, "thread/close", json!({"threadId":first_id})).await;
        request(&mut server, "thread/start", json!({"model":"local"})).await;
        let page = request(&mut server, "thread/list", json!({"limit":1})).await;
        assert_eq!(page["result"]["data"].as_array().unwrap().len(), 1);
        let next = request(
            &mut server,
            "thread/list",
            json!({"limit":1,"cursor":page["result"]["nextCursor"]}),
        )
        .await;
        assert_eq!(next["result"]["data"].as_array().unwrap().len(), 1);
        assert_ne!(
            page["result"]["data"][0]["id"],
            next["result"]["data"][0]["id"]
        );
        assert!(next["result"]["nextCursor"].is_null());
        assert_eq!(
            request(&mut server, "thread/list", json!({"limit":0})).await["error"]["code"],
            -32602
        );
    }

    #[tokio::test]
    async fn initializes_without_credentials() {
        let mut server = test_server();
        let response = server
            .handle(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#)
            .await
            .unwrap()
            .unwrap();
        assert!(response.contains("\"required\":false"));
    }

    #[tokio::test]
    async fn requires_initialized_handshake_before_requests() {
        let mut server = test_server();
        let response = server
            .handle(r#"{"jsonrpc":"2.0","id":1,"method":"thread/list","params":{}}"#)
            .await
            .unwrap()
            .unwrap();
        assert!(response.contains("Not initialized"));
        server
            .handle(r#"{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}"#)
            .await
            .unwrap();
        server
            .handle(r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#)
            .await
            .unwrap();
        let response = server
            .handle(r#"{"jsonrpc":"2.0","id":3,"method":"thread/list","params":{}}"#)
            .await
            .unwrap()
            .unwrap();
        assert!(response.contains("\"data\":[]"));
    }

    #[tokio::test]
    async fn starts_and_lists_threads() {
        let mut server = test_server();
        server
            .handle(r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}"#)
            .await
            .unwrap();
        server
            .handle(r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#)
            .await
            .unwrap();
        let start = server
            .handle(
                r#"{"jsonrpc":"2.0","id":1,"method":"thread/start","params":{"model":"local"}}"#,
            )
            .await
            .unwrap()
            .unwrap();
        assert!(start.contains("createdAt"));
        let list = server
            .handle(r#"{"jsonrpc":"2.0","id":2,"method":"thread/list","params":{}}"#)
            .await
            .unwrap()
            .unwrap();
        assert!(list.contains("local"));
    }

    #[tokio::test]
    async fn lists_local_agent_tools() {
        let mut server = test_server();
        server
            .handle(r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}"#)
            .await
            .unwrap();
        server
            .handle(r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#)
            .await
            .unwrap();
        let response = server
            .handle(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#)
            .await
            .unwrap()
            .unwrap();
        assert!(response.contains("read_file"));
        assert!(response.contains("search_text"));
        assert!(response.contains("computer_use"));
    }

    #[tokio::test]
    async fn closes_a_started_thread() {
        let mut server = test_server();
        server
            .handle(r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}"#)
            .await
            .unwrap();
        server
            .handle(r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#)
            .await
            .unwrap();
        let start = server
            .handle(
                r#"{"jsonrpc":"2.0","id":1,"method":"thread/start","params":{"model":"local"}}"#,
            )
            .await
            .unwrap()
            .unwrap();
        let thread_id = start
            .split("\"id\":\"")
            .nth(1)
            .and_then(|value| value.split('"').next())
            .unwrap();
        let request = format!(
            r#"{{"jsonrpc":"2.0","id":2,"method":"thread/close","params":{{"threadId":"{thread_id}"}}}}"#
        );
        let response = server.handle(&request).await.unwrap().unwrap();
        assert!(response.contains("\"closed\""));
    }

    #[tokio::test]
    async fn reads_and_resumes_a_loaded_thread() {
        let mut server = test_server();
        server
            .handle(r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}"#)
            .await
            .unwrap();
        server
            .handle(r#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#)
            .await
            .unwrap();
        let start = server
            .handle(
                r#"{"jsonrpc":"2.0","id":1,"method":"thread/start","params":{"model":"local"}}"#,
            )
            .await
            .unwrap()
            .unwrap();
        let thread_id = start
            .split("\"id\":\"")
            .nth(1)
            .and_then(|value| value.split('\"').next())
            .unwrap();
        let read = server.handle(&format!(r#"{{"jsonrpc":"2.0","id":2,"method":"thread/read","params":{{"threadId":"{thread_id}"}}}}"#)).await.unwrap().unwrap();
        assert!(read.contains(thread_id));
        let resumed = server.handle(&format!(r#"{{"jsonrpc":"2.0","id":3,"method":"thread/resume","params":{{"threadId":"{thread_id}"}}}}"#)).await.unwrap().unwrap();
        assert!(resumed.contains(thread_id));
    }

    #[tokio::test]
    async fn aliases_normalize_and_unknown_methods_stay_method_not_found() {
        let mut server = initialized_server().await;
        let models = request(&mut server, "models/list", json!({})).await;
        assert!(models["result"]["data"].is_array(), "{models}");
        let drained = request(&mut server, "aphrody/notifications", json!({})).await;
        assert!(drained["result"]["notifications"].is_array(), "{drained}");
        let status = request(&mut server, "system/status", json!({})).await;
        assert_eq!(
            status["result"]["service"], "aphrody-app-server",
            "{status}"
        );
        let unknown = request(&mut server, "no/such/method", json!({})).await;
        assert_eq!(unknown["error"]["code"], -32601, "{unknown}");
        let malformed = request(&mut server, "thread/close", json!({})).await;
        assert_eq!(malformed["error"]["code"], -32602, "{malformed}");
    }

    #[tokio::test]
    async fn logout_llama_and_train_status_are_routed() {
        let mut server = initialized_server().await;
        let logout = request(&mut server, "account/logout", json!({})).await;
        assert_eq!(logout["result"], json!({}), "{logout}");
        let llama = request(&mut server, "aphrody/llama/status", json!({})).await;
        assert!(llama["result"]["running"].is_boolean(), "{llama}");
        let train = request(&mut server, "aphrody/train/status", json!({})).await;
        assert!(train["result"]["active"].is_boolean(), "{train}");
        assert!(train["result"].get("jobId").is_none(), "{train}");
    }
}
