// SPDX-License-Identifier: Apache-2.0
//! aphrody.com server (docs/webos/ARCHITECTURE.md, ADR-003). One native process behind nginx serves the Rust wasm
//! client, `/api/health` and `/api/os`, and merges the routers of the session, stream, repository and inventory crates
//! as they land. Until the client is built into the release, `/` is a page rendered here.

mod emulators;
mod health;
mod page;
mod sessions;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::{
    Router,
    extract::{Request, State},
    http::{HeaderValue, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use tower_http::{
    compression::CompressionLayer, services::ServeDir, set_header::SetResponseHeaderLayer,
};

const CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; \
img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; \
frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";

pub struct AppState {
    pub started: Instant,
    /// Built wasm client (index.html, the wasm-bindgen glue and the .wasm), inside the release.
    pub client: PathBuf,
    pub source_commit: Option<String>,
    /// Inventory of every Bun OS member (crates/aphrody-inventory), when the release carries one.
    pub inventory: Result<aphrody_inventory::InventoryState, String>,
    /// Sessions of the host and the stream bridge (`sessions.rs`).
    pub sessions: sessions::Sessions,
}

fn env_path(name: &str, default: &str) -> PathBuf {
    std::env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(default))
}

async fn root(State(state): State<Arc<AppState>>) -> Response {
    match tokio::fs::read(state.client.join("index.html")).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            bytes,
        )
            .into_response(),
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

/// Content-hashed files (`name-<12+ hex>.ext`) are immutable; everything else revalidates.
async fn caching(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    let hashed = path
        .rsplit('/')
        .next()
        .and_then(|file| file.split('.').next())
        .and_then(|stem| stem.rsplit('-').next())
        .is_some_and(|tail| tail.len() >= 12 && tail.bytes().all(|b| b.is_ascii_hexdigit()));
    let success = response.status().is_success();
    let headers = response.headers_mut();
    if hashed && success {
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    } else if !headers.contains_key(header::CACHE_CONTROL) {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
    response
}

fn app(state: Arc<AppState>) -> Router {
    // release.sh writes .br and .gz next to the client files; content-hashed names are cached immutably.
    let assets = ServeDir::new(&state.client)
        .precompressed_br()
        .precompressed_gzip();
    let state_sessions = state.sessions.clone();
    let inventory = match &state.inventory {
        Ok(inventory) => aphrody_inventory::router(inventory.clone()),
        Err(_) => Router::new(),
    };
    Router::new()
        .route("/", get(root))
        .route("/api/health", get(health::health))
        .route("/healthz", get(health::health))
        .with_state(state)
        .merge(inventory)
        .merge(sessions::router(state_sessions))
        .merge(emulators::router(
            env_path("WEBOS_OBJECTS", "objects"),
            env_path("WEBOS_EMULATOR_PAGE", "emulator"),
        ))
        // bun-ui: iced, libcosmic, Qt and GTK apps in the browser (crates/bun-ui-web).
        .merge(bun_ui_web::router(env_path("WEBOS_UI_DIR", "ui")))
        .fallback_service(assets)
        .layer(middleware::from_fn(log))
        .layer(middleware::from_fn(caching))
        .layer(CompressionLayer::new())
        // Cross-origin isolation for threads and SharedArrayBuffer (wasm threads, WebGPU workers); routers that need
        // require-corp (emulators) set their own value first.
        .layer(SetResponseHeaderLayer::if_not_present(
            header::HeaderName::from_static("cross-origin-opener-policy"),
            HeaderValue::from_static("same-origin"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::HeaderName::from_static("cross-origin-embedder-policy"),
            HeaderValue::from_static("credentialless"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::HeaderName::from_static("cross-origin-resource-policy"),
            HeaderValue::from_static("same-origin"),
        ))
        // Routers may set their own policy (e.g. /ui); the default applies when none is present.
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(CSP),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
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
    let addr: SocketAddr = std::env::var("WEBOS_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8790".into())
        .parse()?;
    let state = Arc::new(AppState {
        started: Instant::now(),
        client: env_path("WEBOS_CLIENT_DIR", "client"),
        source_commit: std::env::var("SOURCE_COMMIT")
            .ok()
            .filter(|s| !s.is_empty()),
        inventory: aphrody_inventory::InventoryState::from_env().map_err(|e| e.to_string()),
        sessions: sessions::Sessions::from_env(),
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
