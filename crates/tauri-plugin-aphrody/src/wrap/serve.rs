// SPDX-License-Identifier: Apache-2.0
//! Loopback server of the `bundle` mode: serves the assets Tauri embedded from `frontendDist` and
//! proxies the configured API prefixes to the backend, so the page keeps one origin and the
//! backend keeps seeing the requests it was written for.

use std::net::TcpListener;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::response::Response;
use http::header::{self, HeaderValue};
use http::{Method, StatusCode};
use tauri::{AppHandle, Runtime};
use url::Url;

use crate::wrap::config::Bundle;
use crate::wrap::proxy;

struct Shared<R: Runtime> {
    app: AppHandle<R>,
    backend: Option<Url>,
    prefixes: Vec<String>,
    origin: String,
    spa_fallback: bool,
    client: reqwest::Client,
}

fn plain(status: StatusCode, message: &str) -> Response {
    let mut response = Response::new(Body::from(message.to_string()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    response
}

fn has_file_extension(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .is_some_and(|name| name.contains('.'))
}

fn serve_asset<R: Runtime>(state: &Shared<R>, method: &Method, path: &str) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return plain(StatusCode::METHOD_NOT_ALLOWED, "method not allowed");
    }
    let resolver = state.app.asset_resolver();
    let Some(asset) = resolver.get(path.to_string()) else {
        return plain(StatusCode::NOT_FOUND, "not found");
    };
    let is_html = asset.mime_type.starts_with("text/html");
    // Tauri answers every unknown path with index.html. Never do that for a file request (a missing
    // script must be a 404, not an HTML page) nor, when the bundle is not a single-page app, for a route.
    if is_html && has_file_extension(path) && !path.ends_with(".html") {
        return plain(StatusCode::NOT_FOUND, "not found");
    }
    if is_html && !state.spa_fallback && !matches!(path, "/" | "/index.html") {
        let index = resolver
            .get("/index.html".to_string())
            .map(|index| index.bytes);
        if index.as_deref() == Some(asset.bytes.as_slice()) {
            return plain(StatusCode::NOT_FOUND, "not found");
        }
    }
    let mut response = Response::new(Body::from(asset.bytes));
    if let Ok(value) = HeaderValue::from_str(&asset.mime_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    if let Some(csp) = asset
        .csp_header
        .as_deref()
        .and_then(|csp| HeaderValue::from_str(csp).ok())
    {
        response
            .headers_mut()
            .insert(header::CONTENT_SECURITY_POLICY, csp);
    }
    response
}

async fn forward<R: Runtime>(state: &Shared<R>, request: Request) -> Response {
    let Some(backend) = state.backend.as_ref() else {
        return plain(StatusCode::BAD_GATEWAY, "no backend configured");
    };
    let (parts, body) = request.into_parts();
    if parts.headers.contains_key(header::UPGRADE) {
        return plain(
            StatusCode::NOT_IMPLEMENTED,
            "WebSocket upgrades are not proxied",
        );
    }
    let path_and_query = parts
        .uri
        .path_and_query()
        .map_or("/", |value| value.as_str());
    let target = proxy::backend_url(backend, path_and_query);
    let headers = proxy::forward_request_headers(&parts.headers, backend, &state.origin);
    let mut outgoing = state
        .client
        .request(parts.method.clone(), target)
        .headers(headers);
    if parts.method != Method::GET && parts.method != Method::HEAD {
        outgoing = outgoing.body(reqwest::Body::wrap_stream(body.into_data_stream()));
    }
    let upstream = match outgoing.send().await {
        Ok(upstream) => upstream,
        Err(error) => {
            return plain(
                StatusCode::BAD_GATEWAY,
                &format!("backend unreachable: {error}"),
            );
        }
    };
    let mut response = Response::new(Body::empty());
    *response.status_mut() = upstream.status();
    for (name, value) in upstream.headers() {
        if proxy::skip_response_header(name) {
            continue;
        }
        let rewritten = if *name == header::SET_COOKIE {
            value
                .to_str()
                .ok()
                .and_then(|text| HeaderValue::from_str(&proxy::rewrite_set_cookie(text)).ok())
        } else if *name == header::LOCATION {
            value.to_str().ok().and_then(|text| {
                HeaderValue::from_str(&proxy::rewrite_location(text, backend)).ok()
            })
        } else {
            Some(value.clone())
        };
        if let Some(value) = rewritten {
            response.headers_mut().append(name.clone(), value);
        }
    }
    *response.body_mut() = Body::from_stream(upstream.bytes_stream());
    response
}

async fn handle<R: Runtime>(State(state): State<Arc<Shared<R>>>, request: Request) -> Response {
    let path = request.uri().path().to_string();
    if state.backend.is_some() && proxy::is_proxied(&path, &state.prefixes) {
        return forward(&state, request).await;
    }
    serve_asset(&state, request.method(), &path)
}

/// Starts the server on `127.0.0.1:0` and returns its origin (`http://127.0.0.1:PORT`).
///
/// # Errors
///
/// Fails when no port can be bound or the backend URL or HTTP client is invalid.
pub fn start<R: Runtime>(
    app: &AppHandle<R>,
    bundle: &Bundle,
) -> Result<String, Box<dyn std::error::Error>> {
    // reqwest is built without a default TLS provider in this workspace.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    listener.set_nonblocking(true)?;
    let origin = format!("http://127.0.0.1:{}", listener.local_addr()?.port());
    let backend = bundle.backend.as_deref().map(Url::parse).transpose()?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let state = Arc::new(Shared {
        app: app.clone(),
        backend,
        prefixes: bundle.proxy.clone(),
        origin: origin.clone(),
        spa_fallback: bundle.spa_fallback,
        client,
    });
    let router = Router::new().fallback(handle::<R>).with_state(state);
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => {
                if let Err(error) = axum::serve(listener, router).await {
                    eprintln!("aphrody-tauri-wrap: loopback server stopped: {error}");
                }
            }
            Err(error) => eprintln!("aphrody-tauri-wrap: loopback listener failed: {error}"),
        }
    });
    Ok(origin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_file_requests_from_routes() {
        assert!(has_file_extension("/assets/app.js"));
        assert!(has_file_extension("/favicon.ico"));
        assert!(!has_file_extension("/about"));
        assert!(!has_file_extension("/"));
        assert!(!has_file_extension("/v1.2/docs"));
    }
}
