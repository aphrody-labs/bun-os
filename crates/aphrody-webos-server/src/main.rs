// SPDX-License-Identifier: Apache-2.0
//! aphrody.com server (docs/webos/ARCHITECTURE.md, ADR-003). One native process behind nginx serves the Rust wasm
//! client, `/api/health` and `/api/os`, and merges the routers of the session, stream, repository and inventory crates
//! as they land. Until the client is built into the release, `/` is a page rendered here.

mod emulators;
mod health;
mod page;
mod sessions;
mod site;
#[cfg(test)]
mod tests;

use std::any::Any;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    BoxError, Router,
    error_handling::HandleErrorLayer,
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    serve::ListenerExt,
};
use tokio::sync::watch;
use tower::{ServiceBuilder, limit::GlobalConcurrencyLimitLayer, load_shed::LoadShedLayer};
use tower_http::{
    catch_panic::CatchPanicLayer,
    compression::CompressionLayer,
    limit::RequestBodyLimitLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    services::ServeDir,
    set_header::SetResponseHeaderLayer,
};

use aphrody_http_error::api::{Op, Service};

/// Public API of the WebOS server: https://api.aphrody.com/v1/webos/ (mounted at `/api`; docs/ops/API.md).
pub const API: Service = Service {
    name: "webos",
    title: "Bun OS WebOS server",
    version: env!("CARGO_PKG_VERSION"),
    description: "Sessions of the host's Bun OS desktops and their WebSocket stream, the emulator catalog and its qualification, and the inventory of every Bun OS member (records and JSON-RPC).",
    ops: &[
        Op::get("/session", "Session availability").tag("sessions"),
        Op::post("/sessions", "Start a session")
            .tag("sessions")
            .auth(),
        Op::delete("/sessions/{id}", "Stop a session")
            .tag("sessions")
            .auth(),
        Op::get("/sessions/{id}/stream", "Session stream")
            .tag("sessions")
            .auth()
            .websocket(),
        Op::get("/emulators", "Emulator catalog").tag("emulators"),
        Op::get("/emulators/qualification", "Emulator qualification").tag("emulators"),
        Op::get(
            "/emulators/qualification/{file}",
            "Qualification screenshot",
        )
        .tag("emulators")
        .content("image/png"),
        Op::get("/inventory", "Inventory index").tag("inventory"),
        Op::get("/inventory/{rest*}", "Inventory file").tag("inventory"),
        Op::get("/rpc", "Inventory JSON-RPC (query form)")
            .tag("inventory")
            .errors("jsonrpc"),
        Op::post("/rpc", "Inventory JSON-RPC")
            .tag("inventory")
            .errors("jsonrpc"),
        Op::get(
            "/{kind}",
            "Inventory records of one kind (apps, packages, crates, factory, ...)",
        )
        .tag("inventory"),
        Op::get("/{kind}/{rest*}", "One inventory record").tag("inventory"),
    ],
};

const CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; \
img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; \
frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";

pub struct AppState {
    pub started: Instant,
    /// Built wasm client (index.html, the wasm-bindgen glue and the .wasm), inside the release.
    pub client: PathBuf,
    pub source_commit: Option<String>,
    /// Release date (YYYY-MM-DD, `RELEASED_AT` or the start of the process): sitemap lastmod and security.txt.
    pub released: String,
    /// Inventory of every Bun OS member (crates/aphrody-inventory), when the release carries one.
    pub inventory: Result<aphrody_inventory::InventoryState, String>,
    /// Sessions of the host and the stream bridge (`sessions.rs`).
    pub sessions: sessions::Sessions,
    /// Set to true on SIGTERM or Ctrl-C: readiness turns 503 and the server drains (`main`).
    pub shutdown: watch::Sender<bool>,
}

/// Time a request/response handler may take before it is answered 503. Not applied to the WebSocket stream, whose
/// bridge lives as long as the session.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Largest request body (JSON-RPC batches, session requests, storage clearing); nginx caps the apex at 4 MiB.
const BODY_LIMIT: usize = 1024 * 1024;
/// Requests handled at once before new ones are shed with 503 (`WEBOS_MAX_IN_FLIGHT` overrides it).
const MAX_IN_FLIGHT: usize = 4096;
/// After SIGTERM: time left to in-flight requests and streams before the process exits (systemd waits 90 s).
const DRAIN: Duration = Duration::from_secs(20);
const REQUEST_ID: header::HeaderName = header::HeaderName::from_static("x-request-id");

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
    let rid = request
        .headers()
        .get(&REQUEST_ID)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
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
            "rid": rid,
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

fn wants_html(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|accept| accept.contains("text/html"))
}

fn default_detail(status: StatusCode) -> String {
    match status {
        StatusCode::NOT_FOUND => "Nothing is served at this address.".into(),
        StatusCode::METHOD_NOT_ALLOWED => "This address does not accept that method.".into(),
        StatusCode::PAYLOAD_TOO_LARGE => {
            format!("The request body is larger than {BODY_LIMIT} bytes.")
        }
        _ => status.canonical_reason().unwrap_or("Error").into(),
    }
}

/// Every error leaves as the standard problem (`application/problem+json`, RFC 9457, with the legacy `error` member)
/// on `/api/*` and for API clients, or as an HTML page for browser navigations, never as an empty or plain-text body
/// (unknown paths, wrong methods, extractor and body-limit rejections). Bodies routers already shaped (JSON, HTML,
/// images) pass unchanged. Errors are never cached.
async fn errors(request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let api = path == "/api" || path.starts_with("/api/");
    let html = !api && wants_html(request.headers());
    let response = next.run(request).await;
    let status = response.status();
    if !(status.is_client_error() || status.is_server_error()) {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    parts
        .headers
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    let content_type = parts
        .headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !(content_type.is_empty() || content_type.starts_with("text/plain")) {
        return Response::from_parts(parts, body);
    }
    let bytes = axum::body::to_bytes(body, 16 * 1024)
        .await
        .unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes).trim().to_owned();
    let detail = if text.is_empty() {
        default_detail(status)
    } else {
        text
    };
    let mut shaped = if html {
        (status, page::error(status, &detail)).into_response()
    } else {
        problem(status, &detail)
    };
    for name in [
        header::ALLOW,
        header::RETRY_AFTER,
        header::WWW_AUTHENTICATE,
        header::CONTENT_RANGE,
        REQUEST_ID,
    ] {
        if let Some(value) = parts.headers.get(&name) {
            shaped.headers_mut().insert(name, value.clone());
        }
    }
    shaped
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    shaped
}

/// The standard problem with the legacy `error` member the client reads (`aphrody_webos_protocol::ApiError`).
fn problem(status: StatusCode, detail: &str) -> Response {
    aphrody_http_error::api::problem_with(status, detail, serde_json::json!({ "error": detail }))
}

/// A panicking handler answers 500 with the standard problem; the panic message goes to the log, not the client.
fn panicked(panic: Box<dyn Any + Send + 'static>) -> Response {
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("non-string panic payload");
    println!(
        "{}",
        serde_json::json!({ "event": "panic", "message": message })
    );
    problem(
        StatusCode::INTERNAL_SERVER_ERROR,
        "The server failed while handling this request.",
    )
}

/// Errors of the tower middleware (request timeout, load shedding) as standard problems.
async fn middleware_error(error: BoxError) -> Response {
    if error.is::<tower::timeout::error::Elapsed>() {
        problem(
            StatusCode::SERVICE_UNAVAILABLE,
            &format!(
                "The request was not answered within {} s.",
                REQUEST_TIMEOUT.as_secs()
            ),
        )
    } else if error.is::<tower::load_shed::error::Overloaded>() {
        let mut response = problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "The server is at capacity; try again in a moment.",
        );
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
        response
    } else {
        println!(
            "{}",
            serde_json::json!({ "event": "middleware-error", "message": error.to_string() })
        );
        problem(
            StatusCode::INTERNAL_SERVER_ERROR,
            "The server failed while handling this request.",
        )
    }
}

fn max_in_flight() -> usize {
    std::env::var("WEBOS_MAX_IN_FLIGHT")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|n| *n > 0)
        .unwrap_or(MAX_IN_FLIGHT)
}

fn app(state: Arc<AppState>) -> Router {
    // release.sh writes .br and .gz next to the client files; content-hashed names are cached immutably.
    let assets = ServeDir::new(&state.client)
        .precompressed_br()
        .precompressed_gzip();
    let state_sessions = state.sessions.clone();
    let stream_sessions = state.sessions.clone();
    let state_site = state.clone();
    let inventory = match &state.inventory {
        Ok(inventory) => aphrody_inventory::router(inventory.clone()),
        Err(_) => Router::new(),
    };
    Router::new()
        .route("/", get(root))
        .route("/api/health", get(health::health))
        .route("/healthz", get(health::live))
        .with_state(state)
        .merge(API.routes_at("/api"))
        // SEO, llms.txt, share images, web app manifest, service worker and storage management (site.rs).
        .merge(site::router(state_site))
        .merge(inventory)
        .merge(sessions::router(state_sessions))
        .merge(emulators::router(
            env_path("WEBOS_OBJECTS", "objects"),
            env_path("WEBOS_EMULATOR_PAGE", "emulator"),
        ))
        // bun-ui: iced, libcosmic, Qt and GTK apps in the browser (crates/bun-ui-web).
        .merge(bun_ui_web::router(env_path("WEBOS_UI_DIR", "ui")))
        .fallback_service(assets)
        .layer(
            ServiceBuilder::new()
                .layer(HandleErrorLayer::new(middleware_error))
                .timeout(REQUEST_TIMEOUT),
        )
        // The long-lived WebSocket stream, outside the request timeout.
        .merge(sessions::stream_router(stream_sessions))
        .layer(RequestBodyLimitLayer::new(BODY_LIMIT))
        .layer(CatchPanicLayer::custom(panicked))
        // One shared semaphore (Router::layer wraps each route): past the limit requests are shed, not queued.
        .layer(
            ServiceBuilder::new()
                .layer(HandleErrorLayer::new(middleware_error))
                .layer(LoadShedLayer::new())
                .layer(GlobalConcurrencyLimitLayer::new(max_in_flight())),
        )
        .layer(middleware::from_fn(errors))
        .layer(middleware::from_fn(log))
        .layer(middleware::from_fn(caching))
        .layer(CompressionLayer::new())
        // x-request-id: kept from the proxy when present, generated otherwise; logged and returned.
        .layer(PropagateRequestIdLayer::new(REQUEST_ID))
        .layer(SetRequestIdLayer::new(REQUEST_ID, MakeRequestUuid))
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

/// Current UTC date as YYYY-MM-DD (civil-from-days, H. Hinnant).
fn today() -> String {
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() / 86_400) as i64
        + 719_468;
    let era = days.div_euclid(146_097);
    let doe = days.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr: SocketAddr = std::env::var("WEBOS_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8790".into())
        .parse()?;
    let (shutdown, draining) = watch::channel(false);
    let state = Arc::new(AppState {
        started: Instant::now(),
        client: env_path("WEBOS_CLIENT_DIR", "client"),
        source_commit: std::env::var("SOURCE_COMMIT")
            .ok()
            .filter(|s| !s.is_empty()),
        released: std::env::var("RELEASED_AT")
            .ok()
            .filter(|d| d.len() >= 10)
            .map(|d| d[..10].to_owned())
            .unwrap_or_else(today),
        inventory: aphrody_inventory::InventoryState::from_env().map_err(|e| e.to_string()),
        sessions: sessions::Sessions::from_env(draining.clone()),
        shutdown,
    });
    site::prerender();
    let signals = Signals::install()?;
    let listener = tokio::net::TcpListener::bind(addr)
        .await?
        // Interactive traffic (input events, small stream frames) is not held back by Nagle.
        .tap_io(|tcp| {
            let _ = tcp.set_nodelay(true);
        });
    println!(
        "{}",
        serde_json::json!({ "event": "listening", "addr": addr.to_string(), "client": state.client.display().to_string() })
    );
    let trigger = state.clone();
    tokio::spawn(async move {
        let signal = signals.recv().await;
        println!(
            "{}",
            serde_json::json!({ "event": "draining", "signal": signal, "graceSeconds": DRAIN.as_secs() })
        );
        trigger.shutdown.send_replace(true);
    });
    let mut stop = draining.clone();
    let server = axum::serve(listener, app(state)).with_graceful_shutdown(async move {
        let _ = stop.wait_for(|draining| *draining).await;
    });
    // Graceful shutdown waits for every connection; past DRAIN the process exits anyway (stuck clients, streams).
    let mut deadline = draining;
    let deadline = async move {
        let _ = deadline.wait_for(|draining| *draining).await;
        tokio::time::sleep(DRAIN).await;
    };
    tokio::select! {
        served = server.into_future() => {
            served?;
            println!("{}", serde_json::json!({ "event": "stopped", "drained": true }));
        }
        () = deadline => {
            println!("{}", serde_json::json!({ "event": "stopped", "drained": false }));
        }
    }
    Ok(())
}

/// Ctrl-C and, on Unix, SIGTERM (`systemctl stop`, restarts by the release activator). Registered before the
/// listener binds, so a failure to register is a startup error rather than a process that ignores systemd.
struct Signals {
    #[cfg(unix)]
    terminate: tokio::signal::unix::Signal,
}

impl Signals {
    fn install() -> std::io::Result<Signals> {
        Ok(Signals {
            #[cfg(unix)]
            terminate: tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?,
        })
    }

    async fn recv(self) -> &'static str {
        #[cfg(unix)]
        {
            let mut terminate = self.terminate;
            tokio::select! {
                _ = tokio::signal::ctrl_c() => "SIGINT",
                _ = terminate.recv() => "SIGTERM",
            }
        }
        #[cfg(not(unix))]
        {
            let Signals {} = self;
            let _ = tokio::signal::ctrl_c().await;
            "ctrl-c"
        }
    }
}
