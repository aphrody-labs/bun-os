// SPDX-License-Identifier: Apache-2.0
//! One loopback OpenAI-compatible endpoint over several chat models, chosen by
//! the request's `model`: managed llama.cpp models (a base GGUF with optional
//! LoRA adapters, see [`crate::local_chat`]), the Gemini web app (a signed-in
//! cookie jar, `aphrody-gemini-web`) and any other OpenAI-compatible server.
//!
//! - `GET /v1/models` lists only the models that can answer now: a llama model whose files are
//!   on disk and whose `llama-server` was found, a Gemini model whose session bootstraps, an
//!   upstream whose own `/models` answers.
//! - `POST /v1/chat/completions` routes by `model`. llama models start on first use (one at a
//!   time: switching stops the previous one, so a single GPU is never shared) and the request,
//!   `stream`, `tools` and `tool_choice` included, is relayed as is to `llama-server` (native
//!   tool calls through the model's Jinja template). Gemini answers once; with `stream: true`
//!   it is sent as SSE (one delta, then `[DONE]`). Gemini has no tool calling: `tools` are
//!   dropped and the response carries `x-aphrody-tools-ignored: true`.
//! - `POST /v1/responses` and `POST /v1/responses/compact` relay the native Responses
//!   wire to llama and OpenAI backends, including opaque reasoning/compaction items.
//!   Gemini web has no Responses contract and returns an explicit unsupported error.
//! - `GET /health` reports every backend (`available`, `running`, `reason`).
//!
//! The configuration is a JSON [`RouterConfig`] (see `aphrody llama router --help`).

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use aphrody_gemini_web::{GeminiModel, GeminiWebClient};
use aphrody_models::Catalog;
use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Mutex;

use crate::{
    ArtifactSpec, ChatLaunchOptions, ChatProvisionRequest, DaemonCommand, LoraSpec, Role,
    StateDirs, Supervisor, chat_present, launch_chat, provision_chat,
};

/// How long a Gemini availability probe is trusted.
const GEMINI_PROBE_TTL: Duration = Duration::from_secs(300);
/// Idle shutdown of a llama model started by the router.
const LLAMA_KEEP_ALIVE: Duration = Duration::from_secs(600);

/// The router configuration file.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouterConfig {
    /// Served models, in listing order.
    pub models: Vec<ModelConfig>,
    /// Product catalog (catalog.json schema) for llama model and adapter ids.
    #[serde(default)]
    pub catalog: Option<PathBuf>,
}

/// One served model.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "backend", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ModelConfig {
    /// A managed llama.cpp model.
    Llama {
        /// Id clients send as `model`.
        id: String,
        /// Base model: catalog id or reference.
        model: String,
        /// Digest of a raw `model` reference.
        #[serde(default)]
        sha256: Option<String>,
        /// Adapters.
        #[serde(default)]
        lora: Vec<LoraConfig>,
        /// Context size.
        #[serde(default)]
        ctx: Option<u32>,
        /// Request slots.
        #[serde(default)]
        parallel: Option<u8>,
        /// Raw `llama-server` arguments.
        #[serde(default)]
        extra_args: Vec<String>,
    },
    /// The Gemini web app.
    GeminiWeb {
        /// Id clients send as `model` (e.g. `gemini-web/flash`).
        id: String,
        /// `flash`, `flash-lite` or `pro`.
        #[serde(default = "default_variant")]
        variant: String,
        /// Cookie jar; default `APHRODY_GOOGLE_COOKIES_JSON`, else `~/.aphrody/google-cookies.json`.
        #[serde(default)]
        cookie_file: Option<PathBuf>,
        /// Interface language of the session (`fr`, `en`, `ja`).
        #[serde(default = "default_language")]
        language: String,
    },
    /// Any OpenAI-compatible server.
    Openai {
        /// Id clients send as `model`.
        id: String,
        /// API root (`http://host:port/v1`).
        base_url: String,
        /// Model name upstream; default `id`.
        #[serde(default)]
        upstream_model: Option<String>,
        /// Environment variable holding a bearer token.
        #[serde(default)]
        api_key_env: Option<String>,
    },
}

/// One adapter of a llama model.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoraConfig {
    /// Catalog id or reference (`file:` for an installer-shipped adapter).
    pub spec: String,
    /// Digest of a raw reference.
    #[serde(default)]
    pub sha256: Option<String>,
    /// Scale (default 1.0).
    #[serde(default = "one")]
    pub scale: f32,
}

fn default_variant() -> String {
    "flash".to_owned()
}
fn default_language() -> String {
    "fr".to_owned()
}
const fn one() -> f32 {
    1.0
}

impl ModelConfig {
    /// The id clients send.
    #[must_use]
    pub fn id(&self) -> &str {
        match self {
            Self::Llama { id, .. } | Self::GeminiWeb { id, .. } | Self::Openai { id, .. } => id,
        }
    }

    fn backend(&self) -> &'static str {
        match self {
            Self::Llama { .. } => "llama",
            Self::GeminiWeb { .. } => "gemini-web",
            Self::Openai { .. } => "openai",
        }
    }
}

impl RouterConfig {
    /// Read and check a configuration file.
    ///
    /// # Errors
    ///
    /// Unreadable file, invalid JSON, an empty or duplicated id, an unknown
    /// Gemini variant.
    pub fn load(path: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let config: Self =
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        config.check()?;
        Ok(config)
    }

    fn check(&self) -> Result<(), String> {
        let mut seen = std::collections::HashSet::new();
        for model in &self.models {
            let id = model.id();
            if id.trim().is_empty() || !seen.insert(id) {
                return Err(format!("model id `{id}` is empty or duplicated"));
            }
            if let ModelConfig::GeminiWeb { variant, .. } = model
                && GeminiModel::from_id(variant).is_none()
            {
                return Err(format!("{id}: unknown Gemini variant `{variant}`"));
            }
        }
        Ok(())
    }
}

/// Where the router keeps models and server state, and how it starts servers.
#[derive(Debug, Clone)]
pub struct RouterContext {
    /// Model store root.
    pub models_dir: PathBuf,
    /// Server state root; each llama model gets `<state_dir>/<id>`.
    pub state_dir: PathBuf,
    /// The `llama-server` binary, when one was found.
    pub llama_bin: Option<PathBuf>,
    /// The daemon launcher.
    pub daemon: DaemonCommand,
}

struct Gemini {
    probed: Option<(Instant, Result<Arc<GeminiWebClient>, String>)>,
}

struct Inner {
    config: RouterConfig,
    declared: Option<Catalog>,
    context: RouterContext,
    http: reqwest::Client,
    /// The llama model currently started, and its OpenAI root.
    active: Mutex<Option<(String, String)>>,
    gemini: Mutex<HashMap<String, Gemini>>,
}

/// The router state shared by the handlers.
#[derive(Clone)]
pub struct ChatRouter(Arc<Inner>);

impl ChatRouter {
    /// Build a router.
    ///
    /// # Errors
    ///
    /// The declared catalog cannot be read.
    pub fn new(config: RouterConfig, context: RouterContext) -> Result<Self, String> {
        let declared = match &config.catalog {
            Some(path) => Some(Catalog::load(path).map_err(|e| e.to_string())?),
            None => None,
        };
        Ok(Self(Arc::new(Inner {
            config,
            declared,
            context,
            http: reqwest::Client::new(),
            active: Mutex::new(None),
            gemini: Mutex::new(HashMap::new()),
        })))
    }

    /// The axum application.
    pub fn app(&self) -> Router {
        Router::new()
            .route("/health", get(health))
            .route("/v1/models", get(models))
            .route("/v1/chat/completions", post(chat))
            .route("/v1/responses", post(responses))
            .route("/v1/responses/compact", post(compact))
            .with_state(self.clone())
    }

    /// Stop the llama model the router started, if any.
    pub async fn shutdown(&self) {
        let active = self.0.active.lock().await.take();
        if let Some((id, _)) = active {
            let _ = self.supervisor(&id).stop(Role::Chat).await;
        }
    }

    fn supervisor(&self, id: &str) -> Supervisor {
        let dir: String = id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '.' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        Supervisor::new(
            StateDirs::new(self.0.context.state_dir.join(dir)),
            self.0.context.daemon.clone(),
        )
    }

    fn provision_request(&self, model: &ModelConfig) -> Option<ChatProvisionRequest> {
        let ModelConfig::Llama {
            model,
            sha256,
            lora,
            ..
        } = model
        else {
            return None;
        };
        Some(ChatProvisionRequest {
            models_dir: Some(self.0.context.models_dir.clone()),
            declared: self.0.declared.clone(),
            model: Some(ArtifactSpec {
                spec: model.clone(),
                sha256: sha256.clone(),
            }),
            lora: lora
                .iter()
                .map(|l| LoraSpec {
                    artifact: ArtifactSpec {
                        spec: l.spec.clone(),
                        sha256: l.sha256.clone(),
                    },
                    scale: l.scale,
                })
                .collect(),
            force: false,
        })
    }

    /// Whether `model` can answer now, and why not.
    async fn availability(&self, model: &ModelConfig) -> (bool, Option<String>) {
        match model {
            ModelConfig::Llama { .. } => {
                if self.0.context.llama_bin.is_none() {
                    return (false, Some("llama-server not found".to_owned()));
                }
                let request = self.provision_request(model).unwrap_or_default();
                match tokio::task::spawn_blocking(move || chat_present(&request)).await {
                    Ok(Ok(true)) => (true, None),
                    Ok(Ok(false)) => (false, Some("model files not provisioned".to_owned())),
                    Ok(Err(error)) => (false, Some(error.to_string())),
                    Err(error) => (false, Some(error.to_string())),
                }
            }
            ModelConfig::GeminiWeb { .. } => match self.gemini_client(model).await {
                Ok(_) => (true, None),
                Err(reason) => (false, Some(reason)),
            },
            ModelConfig::Openai {
                base_url,
                api_key_env,
                ..
            } => {
                let url = format!("{}/models", base_url.trim_end_matches('/'));
                let mut request = self.0.http.get(url).timeout(Duration::from_secs(3));
                if let Some(key) = api_key_env.as_deref().and_then(|k| std::env::var(k).ok()) {
                    request = request.bearer_auth(key);
                }
                match request.send().await {
                    Ok(resp) if resp.status().is_success() => (true, None),
                    Ok(resp) => (false, Some(format!("upstream answered {}", resp.status()))),
                    Err(error) => (false, Some(format!("upstream unreachable: {error}"))),
                }
            }
        }
    }

    async fn gemini_client(&self, model: &ModelConfig) -> Result<Arc<GeminiWebClient>, String> {
        let ModelConfig::GeminiWeb {
            id,
            cookie_file,
            language,
            ..
        } = model
        else {
            return Err("not a Gemini model".to_owned());
        };
        let mut cache = self.0.gemini.lock().await;
        let entry = cache.entry(id.clone()).or_insert(Gemini { probed: None });
        if let Some((at, result)) = &entry.probed
            && at.elapsed() < GEMINI_PROBE_TTL
        {
            return result.clone();
        }
        let path = cookie_file
            .clone()
            .or_else(|| aphrody_gemini_web::Auth::default_cookie_path().ok());
        let result = match path {
            Some(path) if path.is_file() => {
                match tokio::time::timeout(
                    Duration::from_secs(15),
                    GeminiWebClient::from_cookie_file(&path, language),
                )
                .await
                {
                    Ok(Ok(client)) => Ok(Arc::new(client)),
                    Ok(Err(error)) => Err(format!("Gemini session rejected: {error}")),
                    Err(_) => Err("Gemini session timed out".to_owned()),
                }
            }
            _ => Err("Gemini cookie file not found".to_owned()),
        };
        entry.probed = Some((Instant::now(), result.clone()));
        result
    }

    /// Start (or reuse) the llama model `config` and return its OpenAI root.
    async fn ensure_llama(&self, config: &ModelConfig) -> Result<String, String> {
        let ModelConfig::Llama {
            id,
            ctx,
            parallel,
            extra_args,
            ..
        } = config
        else {
            return Err("not a llama model".to_owned());
        };
        let mut active = self.0.active.lock().await;
        if let Some((current, base)) = active.as_ref() {
            let supervisor = self.supervisor(current);
            if current == id && supervisor.status(Role::Chat).is_some() {
                let _ = supervisor.touch(Role::Chat);
                return Ok(base.clone());
            }
            if current != id {
                let _ = supervisor.stop(Role::Chat).await;
            }
            *active = None;
        }
        let binary = self
            .0
            .context
            .llama_bin
            .clone()
            .ok_or("llama-server not found")?;
        let request = self.provision_request(config).unwrap_or_default();
        let model = provision_chat(&request, |_| {})
            .await
            .map_err(|e| e.to_string())?;
        let mut options = ChatLaunchOptions {
            ctx: *ctx,
            alias: Some(id.clone()),
            extra_args: extra_args.clone(),
            ..ChatLaunchOptions::default()
        };
        options.parallel = parallel.unwrap_or(1);
        options.ensure.keep_alive = Some(LLAMA_KEEP_ALIVE);
        let state = self.supervisor(id).dirs().root().to_path_buf();
        let chat = launch_chat(
            &binary,
            &state,
            self.0.context.daemon.clone(),
            &model,
            &options,
        )
        .await
        .map_err(|e| e.to_string())?;
        let base = chat.endpoint.base_url();
        *active = Some((id.clone(), base.clone()));
        Ok(base)
    }

    fn find(&self, id: &str) -> Option<&ModelConfig> {
        self.0.config.models.iter().find(|model| model.id() == id)
    }
}

fn error(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    let body = json!({ "error": { "message": message.into(), "type": code, "code": code } });
    (status, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

async fn health(State(router): State<ChatRouter>) -> Response {
    let active = router
        .0
        .active
        .lock()
        .await
        .as_ref()
        .map(|(id, _)| id.clone());
    let mut backends = Vec::new();
    for model in &router.0.config.models {
        let (available, reason) = router.availability(model).await;
        let running = matches!(model, ModelConfig::Llama { .. })
            && active.as_deref() == Some(model.id())
            && router.supervisor(model.id()).status(Role::Chat).is_some();
        backends.push(json!({
            "id": model.id(),
            "backend": model.backend(),
            "available": available,
            "running": running,
            "reason": reason,
        }));
    }
    let any = backends.iter().any(|b| b["available"] == json!(true));
    let body = json!({ "status": if any { "ok" } else { "unavailable" }, "backends": backends });
    ([(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

async fn models(State(router): State<ChatRouter>) -> Response {
    let mut data = Vec::new();
    for model in &router.0.config.models {
        if router.availability(model).await.0 {
            data.push(json!({
                "id": model.id(),
                "object": "model",
                "created": 0,
                "owned_by": format!("aphrody-{}", model.backend()),
            }));
        }
    }
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({ "object": "list", "data": data })),
    )
        .into_response()
}

async fn chat(State(router): State<ChatRouter>, Json(body): Json<Value>) -> Response {
    route_request(router, body, "chat/completions").await
}

async fn responses(State(router): State<ChatRouter>, Json(body): Json<Value>) -> Response {
    route_request(router, body, "responses").await
}

async fn compact(State(router): State<ChatRouter>, Json(body): Json<Value>) -> Response {
    route_request(router, body, "responses/compact").await
}

async fn route_request(router: ChatRouter, mut body: Value, endpoint: &str) -> Response {
    let Some(id) = body
        .get("model")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
    else {
        return error(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "`model` is required",
        );
    };
    let Some(config) = router.find(&id).cloned() else {
        return error(
            StatusCode::NOT_FOUND,
            "model_not_found",
            format!("unknown model `{id}`"),
        );
    };
    match &config {
        ModelConfig::Llama { .. } => match router.ensure_llama(&config).await {
            Ok(base) => relay(&router.0.http, &base, endpoint, None, body).await,
            Err(reason) => error(StatusCode::SERVICE_UNAVAILABLE, "model_unavailable", reason),
        },
        ModelConfig::Openai {
            base_url,
            upstream_model,
            api_key_env,
            ..
        } => {
            if let Some(name) = upstream_model {
                body["model"] = json!(name);
            }
            let key = api_key_env.as_deref().and_then(|k| std::env::var(k).ok());
            relay(&router.0.http, base_url, endpoint, key.as_deref(), body).await
        }
        ModelConfig::GeminiWeb { variant, .. } => {
            if endpoint != "chat/completions" {
                return error(
                    StatusCode::BAD_REQUEST,
                    "unsupported_endpoint",
                    "Gemini web does not support the OpenAI Responses API",
                );
            }
            let client = match router.gemini_client(&config).await {
                Ok(client) => client,
                Err(reason) => {
                    return error(StatusCode::SERVICE_UNAVAILABLE, "model_unavailable", reason);
                }
            };
            let tools_ignored = body.get("tools").is_some_and(|t| !t.is_null());
            let prompt = flatten_messages(body.get("messages").unwrap_or(&Value::Null));
            if prompt.is_empty() {
                return error(
                    StatusCode::BAD_REQUEST,
                    "invalid_request_error",
                    "no message text",
                );
            }
            let selector = GeminiModel::from_id(variant)
                .unwrap_or(GeminiModel::Flash)
                .header();
            let reply = match tokio::time::timeout(
                Duration::from_secs(120),
                client.ask(&prompt, Some(&selector)),
            )
            .await
            {
                Ok(Ok(reply)) => reply.text,
                Ok(Err(e)) => {
                    return error(StatusCode::BAD_GATEWAY, "upstream_error", e.to_string());
                }
                Err(_) => return error(StatusCode::GATEWAY_TIMEOUT, "timeout", "Gemini timed out"),
            };
            let stream = body.get("stream").and_then(Value::as_bool).unwrap_or(false);
            let mut response = completion_response(&id, reply.trim(), stream);
            if tools_ignored {
                response
                    .headers_mut()
                    .insert("x-aphrody-tools-ignored", HeaderValue::from_static("true"));
            }
            response
        }
    }
}

/// Relay a request to an OpenAI-compatible root, streaming the answer back as is.
async fn relay(
    http: &reqwest::Client,
    base: &str,
    endpoint: &str,
    key: Option<&str>,
    body: Value,
) -> Response {
    let url = format!("{}/{endpoint}", base.trim_end_matches('/'));
    let mut request = http.post(url).json(&body);
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    match request.send().await {
        Ok(upstream) => {
            let status =
                StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            // Preserve protocol metadata useful to SDK retry/tracing behavior;
            // do not forward transport framing, cookies or authentication headers.
            let mut headers = axum::http::HeaderMap::new();
            for (name, value) in upstream.headers() {
                if matches!(
                    name.as_str(),
                    "content-type" | "x-request-id" | "retry-after" | "openai-processing-ms"
                ) || name.as_str().starts_with("x-ratelimit-")
                {
                    headers.append(name.clone(), value.clone());
                }
            }
            if !headers.contains_key(header::CONTENT_TYPE) {
                headers.insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/json"),
                );
            }
            let mut response = Response::new(Body::from_stream(upstream.bytes_stream()));
            *response.status_mut() = status;
            *response.headers_mut() = headers;
            response
                .headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response
        }
        Err(e) => error(
            StatusCode::BAD_GATEWAY,
            "upstream_error",
            format!("upstream unreachable: {e}"),
        ),
    }
}

/// OpenAI messages as one prompt for a single-turn backend.
fn flatten_messages(messages: &Value) -> String {
    let Some(list) = messages.as_array() else {
        return String::new();
    };
    let text_of = |content: &Value| match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    let turns: Vec<(String, String)> = list
        .iter()
        .map(|m| {
            let role = m
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("user")
                .to_owned();
            (
                role,
                text_of(m.get("content").unwrap_or(&Value::Null))
                    .trim()
                    .to_owned(),
            )
        })
        .filter(|(_, text)| !text.is_empty())
        .collect();
    if let [(role, text)] = turns.as_slice()
        && role == "user"
    {
        return text.clone();
    }
    turns
        .iter()
        .map(|(role, text)| {
            let label = match role.as_str() {
                "system" | "developer" => "Instructions",
                "assistant" => "Assistant",
                "tool" => "Tool result",
                _ => "User",
            };
            format!("{label}:\n{text}")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn completion_response(model: &str, text: &str, stream: bool) -> Response {
    let created = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let id = format!("chatcmpl-{created}");
    if !stream {
        let body = json!({
            "id": id, "object": "chat.completion", "created": created, "model": model,
            "choices": [{ "index": 0, "finish_reason": "stop",
                "message": { "role": "assistant", "content": text } }],
        });
        return ([(header::CACHE_CONTROL, "no-store")], Json(body)).into_response();
    }
    let chunk = |delta: Value, finish: Value| {
        json!({ "id": id, "object": "chat.completion.chunk", "created": created, "model": model,
            "choices": [{ "index": 0, "delta": delta, "finish_reason": finish }] })
    };
    let sse = format!(
        "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
        chunk(json!({ "role": "assistant", "content": text }), Value::Null),
        chunk(json!({}), json!("stop")),
    );
    (
        [
            (header::CONTENT_TYPE, "text/event-stream"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        sse,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(dir: &Path) -> RouterContext {
        RouterContext {
            models_dir: dir.join("models"),
            state_dir: dir.join("llama"),
            llama_bin: None,
            daemon: DaemonCommand {
                program: PathBuf::new(),
                args: Vec::new(),
            },
        }
    }

    #[test]
    fn config_parses_the_three_backends_and_rejects_duplicates() {
        let config: RouterConfig = serde_json::from_str(
            r#"{"models":[
              {"backend":"llama","id":"product-chat-v2","model":"qwen3-4b-instruct-2507-q4km",
               "lora":[{"spec":"file:/a.gguf","sha256":"ab"}],"ctx":8192},
              {"backend":"llama","id":"gemma-4-e2b","model":"gemma-4-e2b-it-q4km"},
              {"backend":"gemini-web","id":"gemini-web/flash"},
              {"backend":"openai","id":"other","base_url":"http://127.0.0.1:1/v1"}]}"#,
        )
        .unwrap();
        config.check().unwrap();
        assert_eq!(config.models.len(), 4);
        let ModelConfig::Llama { lora, .. } = &config.models[0] else {
            panic!()
        };
        assert!((lora[0].scale - 1.0).abs() < f32::EPSILON);
        let dup: RouterConfig = serde_json::from_str(
            r#"{"models":[{"backend":"gemini-web","id":"x"},{"backend":"gemini-web","id":"x"}]}"#,
        )
        .unwrap();
        assert!(dup.check().is_err());
        let bad: RouterConfig = serde_json::from_str(
            r#"{"models":[{"backend":"gemini-web","id":"x","variant":"ultra"}]}"#,
        )
        .unwrap();
        assert!(bad.check().is_err());
    }

    #[test]
    fn messages_flatten_for_single_turn_backends() {
        let one = json!([{ "role": "user", "content": "Qui est Goku ?" }]);
        assert_eq!(flatten_messages(&one), "Qui est Goku ?");
        let many = json!([
            { "role": "system", "content": "Réponds en français." },
            { "role": "user", "content": [{ "type": "text", "text": "Qui est Goku ?" }] },
        ]);
        assert_eq!(
            flatten_messages(&many),
            "Instructions:\nRéponds en français.\n\nUser:\nQui est Goku ?"
        );
    }

    #[tokio::test]
    async fn listing_only_offers_available_models_and_unknown_ids_are_404() {
        let dir = tempfile::tempdir().unwrap();
        let config: RouterConfig = serde_json::from_str(&format!(
            r#"{{"models":[
              {{"backend":"llama","id":"local","model":"qwen3-4b-instruct-2507-q4km"}},
              {{"backend":"gemini-web","id":"gemini-web/flash","cookie_file":"{}"}}]}}"#,
            dir.path()
                .join("missing.json")
                .display()
                .to_string()
                .replace('\\', "/")
        ))
        .unwrap();
        let router = ChatRouter::new(config, context(dir.path())).unwrap();
        let app = router.app();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await });
        let http = reqwest::Client::new();
        let models: Value = http
            .get(format!("http://{addr}/v1/models"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(models["data"], json!([]));
        let health: Value = http
            .get(format!("http://{addr}/health"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(health["status"], "unavailable");
        assert_eq!(health["backends"][0]["reason"], "llama-server not found");
        assert_eq!(
            health["backends"][1]["reason"],
            "Gemini cookie file not found"
        );
        let unknown = http
            .post(format!("http://{addr}/v1/chat/completions"))
            .json(&json!({ "model": "nope", "messages": [] }))
            .send()
            .await
            .unwrap();
        assert_eq!(unknown.status(), 404);
        let down = http
            .post(format!("http://{addr}/v1/chat/completions"))
            .json(&json!({ "model": "gemini-web/flash", "messages": [] }))
            .send()
            .await
            .unwrap();
        assert_eq!(down.status(), 503);
    }

    #[tokio::test]
    async fn openai_upstream_is_relayed_with_its_stream() {
        let upstream = Router::new()
            .route("/v1/models", get(|| async { Json(json!({ "data": [] })) }))
            .route(
                "/v1/chat/completions",
                post(|Json(body): Json<Value>| async move {
                    (
                        [(header::CONTENT_TYPE, "text/event-stream")],
                        format!(
                            "data: {{\"model\":\"{}\"}}\n\ndata: [DONE]\n\n",
                            body["model"].as_str().unwrap_or("")
                        ),
                    )
                }),
            );
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let up = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, upstream).await });

        let dir = tempfile::tempdir().unwrap();
        let config: RouterConfig = serde_json::from_str(&format!(
            r#"{{"models":[{{"backend":"openai","id":"remote","base_url":"http://{up}/v1","upstream_model":"real"}}]}}"#
        ))
        .unwrap();
        let app = ChatRouter::new(config, context(dir.path())).unwrap().app();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await });
        let http = reqwest::Client::new();
        let models: Value = http
            .get(format!("http://{addr}/v1/models"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(models["data"][0]["id"], "remote");
        let resp = http
            .post(format!("http://{addr}/v1/chat/completions"))
            .json(&json!({ "model": "remote", "stream": true, "messages": [] }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.headers()["content-type"], "text/event-stream");
        let text = resp.text().await.unwrap();
        assert!(text.contains("\"model\":\"real\"") && text.ends_with("data: [DONE]\n\n"));
    }

    #[tokio::test]
    async fn responses_and_compact_preserve_native_payloads_and_errors() {
        let upstream = Router::new()
            .route("/v1/responses", post(|Json(body): Json<Value>| async move {
                assert_eq!(body["model"], "real");
                assert_eq!(body["input"][0]["encrypted_content"], "opaque-state");
                assert_eq!(body["tools"][0]["type"], "function");
                assert_eq!(body["previous_response_id"], "resp_previous");
                assert_eq!(body["store"], false);
                (
                    [(header::CONTENT_TYPE, "text/event-stream"),
                     (header::HeaderName::from_static("x-request-id"), "req_native")],
                    "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_native\",\"output\":[]}}\n\n",
                )
            }))
            .route("/v1/responses/compact", post(|Json(body): Json<Value>| async move {
                if body["input"].is_null() {
                    return (
                        StatusCode::TOO_MANY_REQUESTS,
                        [(header::RETRY_AFTER, "7")],
                        Json(json!({"error":{"type":"rate_limit_error","code":"rate_limit_exceeded"}})),
                    ).into_response();
                }
                assert_eq!(body["model"], "real");
                assert_eq!(body["instructions"], "retain tool history");
                Json(json!({
                    "id": "cmp_native", "object": "response.compaction",
                    "output": body["input"],
                    "usage": {"input_tokens": 17, "output_tokens": 5, "total_tokens": 22},
                })).into_response()
            }));
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let up = listener.local_addr().unwrap();
        let upstream_task = tokio::spawn(async move { axum::serve(listener, upstream).await });
        let dir = tempfile::tempdir().unwrap();
        let config: RouterConfig = serde_json::from_value(json!({"models":[{
            "backend":"openai", "id":"remote", "base_url":format!("http://{up}/v1/"),
            "upstream_model":"real",
        }]}))
        .unwrap();
        let app = ChatRouter::new(config, context(dir.path())).unwrap().app();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let addr = listener.local_addr().unwrap();
        let router_task = tokio::spawn(async move { axum::serve(listener, app).await });
        let http = reqwest::Client::new();
        let input = json!([
            {"type":"compaction", "id":"cmp_previous", "encrypted_content":"opaque-state"},
            {"type":"function_call_output", "call_id":"call_1", "output":"工具結果"},
        ]);
        let response = http
            .post(format!("http://{addr}/v1/responses"))
            .json(&json!({
                "model":"remote", "input":input, "stream":true, "store":false,
                "previous_response_id":"resp_previous",
                "tools":[{"type":"function", "name":"search", "parameters":{"type":"object"}}],
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "text/event-stream");
        assert_eq!(response.headers()["x-request-id"], "req_native");
        assert_eq!(
            response.text().await.unwrap(),
            "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_native\",\"output\":[]}}\n\n"
        );
        let compact: Value = http
            .post(format!("http://{addr}/v1/responses/compact"))
            .json(&json!({"model":"remote", "input":input, "instructions":"retain tool history"}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(compact["output"], input);
        assert_eq!(compact["object"], "response.compaction");
        assert_eq!(compact["usage"]["total_tokens"], 22);
        let failure = http
            .post(format!("http://{addr}/v1/responses/compact"))
            .json(&json!({"model":"remote"}))
            .send()
            .await
            .unwrap();
        assert_eq!(failure.status(), 429);
        assert_eq!(failure.headers()["retry-after"], "7");
        assert_eq!(
            failure.json::<Value>().await.unwrap()["error"]["code"],
            "rate_limit_exceeded"
        );
        router_task.abort();
        upstream_task.abort();
        assert!(router_task.await.unwrap_err().is_cancelled());
        assert!(upstream_task.await.unwrap_err().is_cancelled());
    }

    #[tokio::test]
    async fn responses_reject_unsupported_backends_without_loading_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let config: RouterConfig = serde_json::from_value(json!({"models":[{
            "backend":"gemini-web", "id":"web", "cookie_file":dir.path().join("missing.json"),
        }]}))
        .unwrap();
        let router = ChatRouter::new(config, context(dir.path())).unwrap();
        for endpoint in ["responses", "responses/compact"] {
            assert_eq!(
                route_request(router.clone(), json!({"model":"web"}), endpoint)
                    .await
                    .status(),
                StatusCode::BAD_REQUEST
            );
            assert_eq!(
                route_request(router.clone(), json!({"model":"missing"}), endpoint)
                    .await
                    .status(),
                StatusCode::NOT_FOUND
            );
            assert_eq!(
                route_request(router.clone(), json!({"input":[]}), endpoint)
                    .await
                    .status(),
                StatusCode::BAD_REQUEST
            );
        }
    }

    #[test]
    fn gemini_stream_is_one_delta_then_done() {
        let response = completion_response("gemini-web/flash", "Bonjour", true);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/event-stream"
        );
    }
}
