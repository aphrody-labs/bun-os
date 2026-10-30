// SPDX-License-Identifier: Apache-2.0
//! `/ui` routes of aphrody.com: the bun-ui host page, the catalog, the bundles (static, with the CSP their manifest
//! asks for) and the Broadway proxy (HTTP and WebSocket upgrade to the app's `gtk4-broadwayd` on loopback).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    Json, Router,
    body::Body,
    extract::{Path as UrlPath, Request, State},
    http::{HeaderName, HeaderValue, StatusCode, header},
    response::{Html, IntoResponse, Redirect, Response},
    routing::get,
};
use hyper_util::rt::TokioIo;
use tower_http::services::ServeDir;

use crate::{Bundle, BundleKind, Catalog, MANIFEST, SCHEMA_VERSION, Toolkit, csp_with};

struct Ui {
    dir: PathBuf,
}

/// Every `<dir>/<toolkit>/<id>/bun-ui.json` whose toolkit and id match its location, sorted by toolkit then title.
pub fn load_catalog(dir: &Path) -> Catalog {
    let mut apps = Vec::new();
    for toolkit in Toolkit::ALL {
        let Ok(entries) = std::fs::read_dir(dir.join(toolkit.as_str())) else { continue };
        for entry in entries.flatten() {
            let Ok(text) = std::fs::read_to_string(entry.path().join(MANIFEST)) else { continue };
            let Ok(bundle) = serde_json::from_str::<Bundle>(&text) else { continue };
            if bundle.schema_version == SCHEMA_VERSION
                && bundle.toolkit == toolkit
                && Bundle::valid_id(&bundle.id)
                && entry.file_name().to_str() == Some(bundle.id.as_str())
            {
                apps.push(bundle);
            }
        }
    }
    apps.sort_by(|a, b| (a.toolkit.as_str(), &a.title).cmp(&(b.toolkit.as_str(), &b.title)));
    Catalog { apps }
}

fn bundle(ui: &Ui, toolkit: &str, id: &str) -> Option<Bundle> {
    let toolkit = Toolkit::parse(toolkit)?;
    if !Bundle::valid_id(id) {
        return None;
    }
    let text = std::fs::read_to_string(ui.dir.join(toolkit.as_str()).join(id).join(MANIFEST)).ok()?;
    let bundle: Bundle = serde_json::from_str(&text).ok()?;
    (bundle.toolkit == toolkit && bundle.id == id && bundle.schema_version == SCHEMA_VERSION).then_some(bundle)
}

fn with_csp(mut response: Response, csp: &str) -> Response {
    if let Ok(value) = HeaderValue::from_str(csp) {
        response.headers_mut().insert(header::CONTENT_SECURITY_POLICY, value);
    }
    response
}

/// The `/ui` router; `dir` holds `host/` (the wasm host) and one directory per toolkit.
pub fn router(dir: PathBuf) -> Router {
    let state = Arc::new(Ui { dir });
    Router::new()
        .route("/ui", get(|| async { Redirect::permanent("/ui/") }))
        .route("/ui/", get(host_page))
        .route("/ui/apps.json", get(catalog))
        .route("/ui/host/{*rest}", get(host_asset))
        .route("/ui/{toolkit}/{id}", get(|UrlPath((t, i)): UrlPath<(String, String)>| async move {
            Redirect::permanent(&format!("/ui/{t}/{i}/"))
        }))
        .route("/ui/{toolkit}/{id}/", get(app_root))
        .route("/ui/{toolkit}/{id}/{*rest}", get(app_asset))
        .with_state(state)
}

async fn catalog(State(ui): State<Arc<Ui>>) -> Response {
    let dir = ui.dir.clone();
    let catalog = tokio::task::spawn_blocking(move || load_catalog(&dir)).await.unwrap_or_default();
    let mut response = Json(catalog).into_response();
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

async fn host_page(State(ui): State<Arc<Ui>>) -> Response {
    let csp = csp_with(std::iter::empty());
    if let Ok(bytes) = tokio::fs::read(ui.dir.join("host").join("index.html")).await {
        let response = (
            [(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "no-cache")],
            bytes,
        )
            .into_response();
        return with_csp(response, &csp);
    }
    // No host build in this release: a plain list of the bundles.
    let dir = ui.dir.clone();
    let catalog = tokio::task::spawn_blocking(move || load_catalog(&dir)).await.unwrap_or_default();
    let mut items = String::new();
    for app in &catalog.apps {
        items.push_str(&format!(
            "<li><a href=\"{base}\">{title}</a> <small>{toolkit}, {kind:?}</small></li>",
            base = app.base(),
            title = escape(&app.title),
            toolkit = app.toolkit.as_str(),
            kind = app.kind,
        ));
    }
    let page = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>bun-ui</title>\
         <style>body{{background:#1b1b1b;color:#e4e4e4;font:16px/1.5 system-ui,sans-serif;margin:2rem}}a{{color:#94ebeb}}</style>\
         </head><body><h1>bun-ui apps</h1><ul>{items}</ul></body></html>"
    );
    with_csp(Html(page).into_response(), &csp)
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

async fn serve_file(dir: PathBuf, rest: &str, request: Request) -> Response {
    let (mut parts, body) = request.into_parts();
    let query = parts.uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    parts.uri = match format!("/{rest}{query}").parse() {
        Ok(uri) => uri,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let request = Request::from_parts(parts, body);
    let mut response = match tower::ServiceExt::oneshot(ServeDir::new(dir), request).await {
        Ok(response) => response.map(Body::new),
        Err(never) => match never {},
    };
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

async fn host_asset(State(ui): State<Arc<Ui>>, UrlPath(rest): UrlPath<String>, request: Request) -> Response {
    let response = serve_file(ui.dir.join("host"), &rest, request).await;
    with_csp(response, &csp_with(std::iter::empty()))
}

async fn app_root(
    State(ui): State<Arc<Ui>>,
    UrlPath((toolkit, id)): UrlPath<(String, String)>,
    request: Request,
) -> Response {
    app(ui, toolkit, id, String::new(), request).await
}

async fn app_asset(
    State(ui): State<Arc<Ui>>,
    UrlPath((toolkit, id, rest)): UrlPath<(String, String, String)>,
    request: Request,
) -> Response {
    app(ui, toolkit, id, rest, request).await
}

async fn app(ui: Arc<Ui>, toolkit: String, id: String, rest: String, request: Request) -> Response {
    let Some(bundle) = bundle(&ui, &toolkit, &id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let csp = bundle.csp();
    let response = match bundle.kind {
        BundleKind::Broadway => match bundle.upstream.as_deref() {
            Some(upstream) if upstream.starts_with("127.0.0.1:") => {
                proxy(upstream, &rest, request).await.unwrap_or_else(|error| {
                    (StatusCode::BAD_GATEWAY, format!("{} is not running: {error}", bundle.title)).into_response()
                })
            }
            _ => StatusCode::BAD_GATEWAY.into_response(),
        },
        BundleKind::WasmBindgen | BundleKind::Emscripten => {
            let rest = if rest.is_empty() { bundle.entry.clone() } else { rest };
            serve_file(ui.dir.join(bundle.toolkit.as_str()).join(&bundle.id), &rest, request).await
        }
    };
    with_csp(response, &csp)
}

const HOP_BY_HOP: [HeaderName; 4] =
    [header::HOST, header::CONTENT_LENGTH, header::TRANSFER_ENCODING, header::PROXY_AUTHORIZATION];

/// Forward one request to `upstream` (loopback only). A `101 Switching Protocols` answer (Broadway's WebSocket) is
/// relayed and both upgraded connections are spliced.
async fn proxy(upstream: &str, rest: &str, mut request: Request) -> Result<Response, Box<dyn std::error::Error + Send + Sync>> {
    let stream = tokio::net::TcpStream::connect(upstream).await?;
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await?;
    tokio::spawn(connection.with_upgrades());

    let wants_upgrade = request.headers().contains_key(header::UPGRADE);
    let client_upgrade = wants_upgrade.then(|| hyper::upgrade::on(&mut request));
    let (parts, body) = request.into_parts();
    let query = parts.uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    let mut builder = hyper::Request::builder().method(parts.method).uri(format!("/{rest}{query}"));
    for (name, value) in &parts.headers {
        if !HOP_BY_HOP.contains(name) && name != header::COOKIE && name != header::AUTHORIZATION {
            builder = builder.header(name, value);
        }
    }
    builder = builder.header(header::HOST, upstream);
    let upstream_request = builder.body(body)?;
    let mut response = sender.send_request(upstream_request).await?;

    if response.status() == StatusCode::SWITCHING_PROTOCOLS {
        let server_upgrade = hyper::upgrade::on(&mut response);
        if let Some(client_upgrade) = client_upgrade {
            tokio::spawn(async move {
                if let (Ok(client), Ok(server)) = (client_upgrade.await, server_upgrade.await) {
                    let _ = tokio::io::copy_bidirectional(&mut TokioIo::new(client), &mut TokioIo::new(server)).await;
                }
            });
        }
        let (parts, _) = response.into_parts();
        return Ok(Response::from_parts(parts, Body::empty()));
    }
    Ok(response.map(Body::new))
}
