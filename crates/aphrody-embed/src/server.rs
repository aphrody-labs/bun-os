// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// OpenAI-compatible embedding service:
//
//   GET  /health         -> 200 {"status":"ready",...} once the model is loaded,
//                           503 {"status":"loading"|"unavailable",...} otherwise
//   POST /v1/embeddings  -> {"object":"list","model":..,"data":[{"object":"embedding","index":i,"embedding":[..]}]}
//
// Requests must name the served model, carry 1..=16 non-blank inputs of at
// most 8,192 characters, and already include the E5 `query: ` / `passage: `
// prefix (callers own the prefix; the engine embeds the text as given).

use std::{
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, OnceLock},
};

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};

use crate::native::{EmbedOptions, Embedder, ModelFiles, TextKind, find_model, require_installed};

/// Model name callers send and receive. It names the `vec_chunks` embedding
/// space of existing indexes, so existing clients and stored vectors keep
/// working unchanged.
pub const SERVED_MODEL: &str = "Xenova/multilingual-e5-small";
/// Native manifest entry that produces [`SERVED_MODEL`]'s space.
pub const NATIVE_MODEL: &str = "intfloat/multilingual-e5-small";
/// Output width of the served model.
pub const DIMENSION: usize = 384;
/// Maximum inputs per request.
pub const MAX_INPUTS: usize = 16;
/// Maximum characters per input.
pub const MAX_INPUT_CHARS: usize = 8192;

/// Where and what to serve.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Listen address (loopback by default).
    pub addr: SocketAddr,
    /// Directory holding the pinned model files; `None` = manifest default dir.
    pub model_dir: Option<PathBuf>,
    /// Worker threads for inference; 0 = all cores.
    pub threads: usize,
}

enum Status {
    Loading,
    Ready(Box<Embedder>),
    Unavailable(String),
}

#[derive(Clone)]
struct AppState {
    status: Arc<OnceLock<Status>>,
}

impl AppState {
    fn status(&self) -> &Status {
        self.status.get().unwrap_or(&Status::Loading)
    }
}

/// Validate an embedding request body and return its inputs.
///
/// Accepts `input` as one string or an array of strings, and `model` equal to
/// [`SERVED_MODEL`] or [`NATIVE_MODEL`].
#[must_use]
pub fn validate_request(body: &Value) -> Option<Vec<String>> {
    let model = body.get("model")?.as_str()?;
    if model != SERVED_MODEL && model != NATIVE_MODEL {
        return None;
    }
    let inputs: Vec<String> = match body.get("input")? {
        Value::String(text) => vec![text.clone()],
        Value::Array(items) => items
            .iter()
            .map(|item| item.as_str().map(str::to_owned))
            .collect::<Option<_>>()?,
        _ => return None,
    };
    let valid = (1..=MAX_INPUTS).contains(&inputs.len())
        && inputs
            .iter()
            .all(|text| !text.trim().is_empty() && text.chars().count() <= MAX_INPUT_CHARS);
    valid.then_some(inputs)
}

/// Load the pinned E5 model without any network access.
///
/// # Errors
/// Returns the engine error when the model is missing, fails its hash check,
/// or cannot be loaded.
pub fn load_model(config: &ServerConfig) -> crate::native::Result<Embedder> {
    let spec = find_model(NATIVE_MODEL)
        .ok_or_else(|| crate::native::Error::UnknownModel(NATIVE_MODEL.into()))?;
    let dir = config
        .model_dir
        .clone()
        .unwrap_or_else(|| spec.default_dir());
    let dir = require_installed(&spec, &dir)?;
    Embedder::load(
        &dir,
        &spec,
        EmbedOptions {
            threads: config.threads,
            ..EmbedOptions::default()
        },
    )
}

fn error(status: StatusCode, message: &str) -> Response {
    aphrody_http_error::error_response(status, status.as_u16().to_string(), message, None)
}

async fn health(State(state): State<AppState>) -> Response {
    let (code, status, reason) = match state.status() {
        Status::Ready(_) => (StatusCode::OK, "ready", None),
        Status::Loading => (StatusCode::SERVICE_UNAVAILABLE, "loading", None),
        Status::Unavailable(reason) => (
            StatusCode::SERVICE_UNAVAILABLE,
            "unavailable",
            Some(reason.as_str()),
        ),
    };
    let mut body = json!({ "status": status, "model": SERVED_MODEL, "dimensions": DIMENSION });
    if let Some(reason) = reason {
        // Same `{error:{code,message}}` envelope as `error()`, embedded in
        // the health document alongside `status`/`model`/`dimensions`.
        body["error"] = json!({ "code": code.as_u16().to_string(), "message": reason });
    }
    (code, Json(body)).into_response()
}

async fn embeddings(State(state): State<AppState>, body: axum::body::Bytes) -> Response {
    let Ok(body) = serde_json::from_slice::<Value>(&body) else {
        return error(StatusCode::BAD_REQUEST, "Invalid JSON");
    };
    let Some(inputs) = validate_request(&body) else {
        return error(StatusCode::BAD_REQUEST, "Invalid E5 embedding request");
    };
    let task = tokio::task::spawn_blocking(move || {
        let Status::Ready(embedder) = state.status() else {
            return None;
        };
        let refs: Vec<&str> = inputs.iter().map(String::as_str).collect();
        let vectors = embedder.embed_batch(&refs, TextKind::Raw).ok()?;
        let valid = vectors.len() == refs.len()
            && vectors
                .iter()
                .all(|v| v.len() == DIMENSION && v.iter().all(|x| x.is_finite()));
        valid.then_some(vectors)
    });
    match task.await {
        Ok(Some(vectors)) => Json(json!({
            "object": "list",
            "model": SERVED_MODEL,
            "data": vectors
                .into_iter()
                .enumerate()
                .map(|(index, embedding)| json!({ "object": "embedding", "index": index, "embedding": embedding }))
                .collect::<Vec<_>>(),
        }))
        .into_response(),
        _ => error(StatusCode::SERVICE_UNAVAILABLE, "E5 embedding backend unavailable"),
    }
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/embeddings", post(embeddings))
        .with_state(state)
}

/// Bind `config.addr`, start loading the model in the background, and serve
/// until the process is stopped. `/health` reports 503 until the model is ready.
///
/// # Errors
/// Returns the bind or accept error.
pub async fn serve(config: ServerConfig) -> std::io::Result<()> {
    let listener = tokio::net::TcpListener::bind(config.addr).await?;
    let state = AppState {
        status: Arc::new(OnceLock::new()),
    };
    let loader = state.status.clone();
    tokio::task::spawn_blocking(move || {
        let status = match load_model(&config) {
            Ok(embedder) => Status::Ready(Box::new(embedder)),
            Err(err) => {
                tracing::error!(error = %err, "E5 model unavailable");
                Status::Unavailable(err.to_string())
            }
        };
        let _ = loader.set(status);
    });
    tracing::info!(addr = %listener.local_addr()?, model = SERVED_MODEL, "embedding server listening");
    axum::serve(listener, router(state)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_served_e5_space_is_accepted() {
        let ok = json!({ "model": SERVED_MODEL, "input": ["query: Goku", "passage: Son Goku"] });
        assert_eq!(
            validate_request(&ok),
            Some(vec![
                "query: Goku".to_owned(),
                "passage: Son Goku".to_owned()
            ])
        );
        let single = json!({ "model": NATIVE_MODEL, "input": "query: Goku" });
        assert_eq!(
            validate_request(&single),
            Some(vec!["query: Goku".to_owned()])
        );
        assert!(validate_request(&json!({ "model": "other", "input": ["query: Goku"] })).is_none());
        assert!(validate_request(&json!({ "model": SERVED_MODEL, "input": [""] })).is_none());
        assert!(validate_request(&json!({ "model": SERVED_MODEL, "input": [1] })).is_none());
        let many = vec!["query: Goku"; MAX_INPUTS + 1];
        assert!(validate_request(&json!({ "model": SERVED_MODEL, "input": many })).is_none());
        let long = "x".repeat(MAX_INPUT_CHARS + 1);
        assert!(validate_request(&json!({ "model": SERVED_MODEL, "input": [long] })).is_none());
    }

    #[tokio::test]
    async fn health_is_503_and_embeddings_refuse_while_unavailable() {
        let state = AppState {
            status: Arc::new(OnceLock::new()),
        };
        let _ = state.status.set(Status::Unavailable("missing".into()));
        let response = health(State(state.clone())).await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = axum::body::Bytes::from(
            json!({ "model": SERVED_MODEL, "input": ["query: Goku"] }).to_string(),
        );
        let response = embeddings(State(state.clone()), body).await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let response = embeddings(State(state), axum::body::Bytes::from_static(b"{")).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
