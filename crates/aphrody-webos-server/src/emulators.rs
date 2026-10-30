// SPDX-License-Identifier: Apache-2.0
//! Emulator qualification and the browser emulator test page, served from the object store written by
//! packages/bun-engine/web-emulation (qualify-webos.ts, qualify-session.ts):
//!   GET /api/emulators                         catalog (`emulators/emulators.json`) merged with the last report
//!   GET /api/emulators/qualification           report (`emulators/qualification.json`)
//!   GET /api/emulators/qualification/{id}.png  screenshot of the qualified run
//!   GET /emulation/{core}/...  /vm/...         emulator cores and VM images of the object store
//!   GET /emulator.html (+ .js, .css, -probe.js) the test page, until the iced client hosts the emulators

use std::path::{Path, PathBuf};

use axum::{
    Json, Router,
    extract::{Path as UrlPath, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Value, json};
use tower_http::{services::ServeDir, set_header::SetResponseHeaderLayer};

#[derive(Clone)]
struct Store {
    objects: PathBuf,
}

async fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&tokio::fs::read(path).await.ok()?).ok()
}

fn no_cache(body: Value) -> Response {
    ([(header::CACHE_CONTROL, "no-cache")], Json(body)).into_response()
}

async fn qualification(State(store): State<Store>) -> Response {
    no_cache(
        read_json(&store.objects.join("emulators/qualification.json"))
            .await
            .unwrap_or_else(|| json!({ "schemaVersion": 1, "entries": {} })),
    )
}

async fn catalog(State(store): State<Store>) -> Response {
    let report = read_json(&store.objects.join("emulators/qualification.json")).await;
    let Some(Value::Array(list)) = read_json(&store.objects.join("emulators/emulators.json")).await else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "no emulator catalog published (emulators/emulators.json)" })),
        )
            .into_response();
    };
    let entries = report.as_ref().and_then(|r| r.get("entries")).cloned().unwrap_or_else(|| json!({}));
    let mut totals = [0u64; 4];
    let mut emulators = Vec::with_capacity(list.len());
    for mut emulator in list {
        let id = emulator.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();
        let served = match emulator.get("core").and_then(Value::as_str) {
            Some(core) if safe(core) => {
                tokio::fs::try_exists(store.objects.join("emulation").join(core).join("manifest.json"))
                    .await
                    .unwrap_or(false)
            }
            _ => false,
        };
        let native = emulator.get("mode").and_then(Value::as_str) == Some("native");
        let entry = entries.get(&id).cloned().unwrap_or_else(|| {
            json!({
                "id": id,
                "status": if native { "unsupported" } else { "untested" },
                "errors": [],
                "detail": emulator.get("reason").cloned().unwrap_or(Value::Null),
            })
        });
        match entry.get("status").and_then(Value::as_str) {
            Some("pass") => totals[0] += 1,
            Some("fail") => totals[1] += 1,
            Some("untested") => totals[2] += 1,
            Some("unsupported") => totals[3] += 1,
            _ => {}
        }
        if let Value::Object(map) = &mut emulator {
            map.insert("served".into(), Value::Bool(served));
            map.insert("qualification".into(), entry);
        }
        emulators.push(emulator);
    }
    no_cache(json!({
        "schemaVersion": 1,
        "generatedAt": report.as_ref().and_then(|r| r.get("generatedAt")).cloned().unwrap_or(Value::Null),
        "sourceCommit": report.as_ref().and_then(|r| r.get("sourceCommit")).cloned().unwrap_or(Value::Null),
        "totals": {
            "emulators": emulators.len(),
            "pass": totals[0], "fail": totals[1], "untested": totals[2], "unsupported": totals[3],
        },
        "emulators": emulators,
    }))
}

fn safe(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

async fn shot(State(store): State<Store>, UrlPath(file): UrlPath<String>) -> Response {
    let Some(id) = file.strip_suffix(".png").filter(|id| safe(id)) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match tokio::fs::read(store.objects.join("emulators/shots").join(format!("{id}.png"))).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, "image/png"), (header::CACHE_CONTROL, "no-cache")], bytes).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `objects`: the object store (WEBOS_OBJECTS); `page`: the staged qualify-page directory of the release.
pub fn router(objects: PathBuf, page: PathBuf) -> Router {
    // The emulators run threaded wasm: the page and its cores need cross-origin isolation.
    let isolate = |router: Router| {
        router
            .layer(SetResponseHeaderLayer::overriding(
                header::HeaderName::from_static("cross-origin-opener-policy"),
                HeaderValue::from_static("same-origin"),
            ))
            .layer(SetResponseHeaderLayer::overriding(
                header::HeaderName::from_static("cross-origin-embedder-policy"),
                HeaderValue::from_static("require-corp"),
            ))
            .layer(SetResponseHeaderLayer::overriding(
                header::HeaderName::from_static("cross-origin-resource-policy"),
                HeaderValue::from_static("same-origin"),
            ))
    };
    let mut static_files = Router::new()
        .nest_service("/emulation", ServeDir::new(objects.join("emulation")))
        .nest_service("/vm", ServeDir::new(objects.join("vm")));
    for file in ["emulator.html", "emulator.js", "emulator.css", "emulator-probe.js"] {
        static_files = static_files.route_service(&format!("/{file}"), tower_http::services::ServeFile::new(page.join(file)));
    }
    Router::new()
        .route("/api/emulators", get(catalog))
        .route("/api/emulators/qualification", get(qualification))
        .route("/api/emulators/qualification/{file}", get(shot))
        .with_state(Store { objects })
        .merge(isolate(static_files))
}
