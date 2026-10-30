// SPDX-License-Identifier: Apache-2.0
//! Bun OS full-stack server. One native process serves the static Web OS (apps/webos/dist), the health and
//! catalogue API, and the browser-side routes. nginx terminates TLS in front of it on the VPS.

use std::net::SocketAddr;
use std::path::PathBuf;

use axum::{Json, Router, http::header, response::IntoResponse, routing::get};
use serde_json::json;
use tower_http::{
    compression::CompressionLayer, services::ServeDir, set_header::SetResponseHeaderLayer,
};

/// Directory of the built site (`bun build.ts` in apps/webos writes it).
fn site_dir() -> PathBuf {
    std::env::var_os("WEBOS_SITE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("apps/webos/dist"))
}

async fn health() -> impl IntoResponse {
    Json(
        json!({ "ok": true, "service": "bunos-webos-server", "version": env!("CARGO_PKG_VERSION") }),
    )
}

fn app(site: PathBuf) -> Router {
    let files = ServeDir::new(&site).append_index_html_on_directories(true);
    Router::new()
        .route("/api/health", get(health))
        .fallback_service(files)
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            header::HeaderValue::from_static("nosniff"),
        ))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr: SocketAddr = std::env::var("WEBOS_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".into())
        .parse()?;
    let site = site_dir();
    if !site.join("index.html").exists() {
        return Err(format!(
            "no site at {}: run `bun build.ts` in apps/webos first",
            site.display()
        )
        .into());
    }
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!(
        "bunos webos-server listening on http://{addr} serving {}",
        site.display()
    );
    axum::serve(listener, app(site))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
