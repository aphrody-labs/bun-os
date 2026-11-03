// SPDX-License-Identifier: Apache-2.0
//! `GET /api/health`: readiness, 200 when every required check passes, 503 otherwise (the release activator gates on
//! it). `GET /healthz`: liveness, answered without touching the disk or the network.

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
    let inventory = match &state.inventory {
        Ok(inventory) => {
            let summary = aphrody_inventory::health(inventory);
            check(
                summary.ok,
                false,
                format!("inventory incomplete: {} members", summary.total),
            )
        }
        Err(error) => check(false, false, format!("no inventory: {error}")),
    };
    checks.insert("inventory".to_owned(), inventory);
    // The desktop stream behind /api/sessions: declared and accepting TCP connections.
    let session = state.sessions.probe(SESSION_PROBE).await;
    let session_ok = session.is_ok();
    checks.insert(
        "session".to_owned(),
        check(session_ok, true, session.err().unwrap_or_default()),
    );
    // A draining process (SIGTERM, Ctrl-C) is not ready: it finishes in-flight work and takes no new sessions.
    let draining = *state.shutdown.borrow();
    checks.insert(
        "accepting".to_owned(),
        check(
            !draining,
            false,
            "the server is shutting down and draining its connections".into(),
        ),
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
    // The API standard fields (docs/ops/API.md) beside the protocol's own.
    let mut value = serde_json::to_value(&body).unwrap_or_default();
    let degraded = checks_degraded(&body.checks);
    value["status"] = serde_json::json!(if !ok {
        "down"
    } else if degraded {
        "degraded"
    } else {
        "ok"
    });
    value["commit"] = serde_json::json!(state.source_commit);
    value["channel"] = serde_json::json!(std::env::var("WEBOS_CHANNEL").ok());
    (
        status,
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(value),
    )
}

/// `GET /healthz`: the process is up and serving. No checks, so a slow disk or an unreachable desktop never makes
/// the supervisor restart a healthy process.
pub async fn live(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    (
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({
            "ok": true,
            "status": "ok",
            "service": "aphrody-webos",
            "version": env!("CARGO_PKG_VERSION"),
            "sourceCommit": state.source_commit,
            "uptimeSeconds": state.started.elapsed().as_secs(),
        })),
    )
}

/// Upper bound of the desktop stream probe, well under the 2 s budget of the release activator.
const SESSION_PROBE: std::time::Duration = std::time::Duration::from_millis(750);

fn checks_degraded(checks: &BTreeMap<String, HealthCheck>) -> bool {
    checks.values().any(|c| !c.ok)
}

#[cfg(test)]
mod tests {
    #[test]
    fn openapi_snapshot_is_current() {
        crate::API.check_snapshot(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."));
    }
}
