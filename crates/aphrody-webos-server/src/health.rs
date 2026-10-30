// SPDX-License-Identifier: Apache-2.0
//! `GET /api/health`: 200 when every required check passes, 503 otherwise (the release activator gates on it).

use std::collections::BTreeMap;
use std::sync::Arc;

use aphrody_webos_protocol::{Health, HealthCheck, PROTOCOL_VERSION};
use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};

use crate::AppState;

fn check(ok: bool, optional: bool, detail: String) -> HealthCheck {
    HealthCheck {
        ok,
        optional,
        detail: if ok { None } else { Some(detail) },
    }
}

pub async fn health(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut checks = BTreeMap::new();
    let client = tokio::fs::try_exists(state.client.join("index.html"))
        .await
        .unwrap_or(false);
    checks.insert(
        "client".to_owned(),
        check(
            client,
            true,
            format!(
                "no wasm client in {}; the placeholder page is served",
                state.client.display()
            ),
        ),
    );
    // The Hyprland session gateway that runs beside this service until the Rust gateway replaces it.
    let gateway = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        tokio::net::TcpStream::connect(("127.0.0.1", 8793)),
    )
    .await
    .is_ok_and(|r| r.is_ok());
    checks.insert(
        "session-gateway".to_owned(),
        check(gateway, true, "127.0.0.1:8793 is not listening".into()),
    );
    let ok = checks.values().all(|c| c.ok || c.optional);
    let body = Health {
        ok,
        service: "aphrody-webos".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        protocol: PROTOCOL_VERSION,
        source_commit: state.source_commit.clone(),
        uptime_seconds: state.started.elapsed().as_secs(),
        checks,
    };
    let status = if ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(body),
    )
}
