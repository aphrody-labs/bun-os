// SPDX-License-Identifier: Apache-2.0
//! aphrody.com server (docs/webos/ARCHITECTURE.md, ADR-003). One native process behind nginx serves the Rust wasm
//! client, `/api/health` and `/api/os`, and merges the routers of the session, stream, repository and inventory crates
//! as they land. Until the client is built into the release, `/` is a page rendered here.

mod health;
mod page;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use aphrody_webos_protocol::{OsEntry, OsId};
use axum::{
    Json, Router,
    extract::{Request, State},
    http::{HeaderValue, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use tower_http::{compression::CompressionLayer, services::ServeDir, set_header::SetResponseHeaderLayer};

const CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; \
img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; \
frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";

pub struct AppState {
    pub started: Instant,
    /// Built wasm client (index.html, the wasm-bindgen glue and the .wasm), inside the release.
    pub client: PathBuf,
    pub source_commit: Option<String>,
}

fn env_path(name: &str, default: &str) -> PathBuf {
    std::env::var_os(name).map(PathBuf::from).unwrap_or_else(|| PathBuf::from(default))
}

/// `GET /api/os`: the catalog of operating systems. None is startable until the session manager is mounted.
async fn os_catalog() -> Json<Vec<OsEntry>> {
    Json(
        OsId::ALL
            .iter()
            .map(|&id| OsEntry {
                id,
                name: id.name().into(),
                summary: id.summary().into(),
                available: false,
                reason: Some("The session manager is not deployed on this host yet.".into()),
            })
            .collect(),
    )
}

async fn root(State(state): State<Arc<AppState>>) -> Response {
    match tokio::fs::read(state.client.join("index.html")).await {
        Ok(bytes) => {
            ([(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "no-cache")], bytes)
                .into_response()
        }
        Err(_) => page::placeholder(state.source_commit.as_deref()).into_response(),
    }
}

/// One JSON line per API request or error on stdout (journald).
async fn log(request: Request, next: Next) -> Response {
    let started = Instant::now();
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let response = next.run(request).await;
    let status = response.status().as_u16();
    if path.starts_with("/api/") || status >= 400 {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let line = serde_json::json!({
            "ts": ts,
            "method": method.as_str(),
            "path": path,
            "status": status,
            "ms": started.elapsed().as_millis(),
        });
        println!("{line}");
    }
    response
}

fn app(state: Arc<AppState>) -> Router {
    let assets = ServeDir::new(&state.client);
    Router::new()
        .route("/", get(root))
        .route("/api/health", get(health::health))
        .route("/healthz", get(health::health))
        .route("/api/os", get(os_catalog))
        .fallback_service(assets)
        .with_state(state)
        .layer(middleware::from_fn(log))
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::overriding(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP)))
        .layer(SetResponseHeaderLayer::overriding(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        ))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr: SocketAddr = std::env::var("WEBOS_ADDR").unwrap_or_else(|_| "127.0.0.1:8790".into()).parse()?;
    let state = Arc::new(AppState {
        started: Instant::now(),
        client: env_path("WEBOS_CLIENT_DIR", "client"),
        source_commit: std::env::var("SOURCE_COMMIT").ok().filter(|s| !s.is_empty()),
    });
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!(
        "{}",
        serde_json::json!({ "event": "listening", "addr": addr.to_string(), "client": state.client.display().to_string() })
    );
    axum::serve(listener, app(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
