// SPDX-License-Identifier: Apache-2.0
//! Behaviour of the assembled server (`app()`): errors, HEAD, health, request ids, limits, panics.

use std::sync::Arc;
use std::time::Instant;

use axum::{
    Router,
    body::Body,
    extract::Request,
    http::{StatusCode, header},
    middleware,
    response::Response,
};
use tokio::sync::watch;
use tower::ServiceExt;
use tower_http::catch_panic::CatchPanicLayer;

use crate::{AppState, BODY_LIMIT, app, errors, middleware_error, panicked, sessions};

fn state() -> Arc<AppState> {
    let (shutdown, draining) = watch::channel(false);
    Arc::new(AppState {
        started: Instant::now(),
        client: std::env::temp_dir().join("aphrody-webos-server-test-missing"),
        source_commit: Some("0123456789abcdef".into()),
        released: "2026-11-03".into(),
        inventory: Err("not part of this test release".into()),
        sessions: sessions::Sessions::from_env(draining),
        shutdown,
    })
}

async fn send(state: &Arc<AppState>, request: Request) -> (Response<()>, Vec<u8>) {
    let response = app(state.clone()).oneshot(request).await.unwrap();
    let (parts, body) = response.into_parts();
    let bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
    (Response::from_parts(parts, ()), bytes.to_vec())
}

fn request(method: &str, uri: &str) -> Request {
    Request::builder()
        .method(method)
        .uri(uri)
        .body(Body::empty())
        .unwrap()
}

fn value_of<'a>(response: &'a Response<()>, name: &str) -> &'a str {
    response
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
}

fn json(body: &[u8]) -> serde_json::Value {
    serde_json::from_slice(body).unwrap()
}

#[tokio::test]
async fn unknown_api_path_is_a_problem() {
    let state = state();
    let (response, body) = send(&state, request("GET", "/api/no/such/thing")).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        value_of(&response, "content-type"),
        "application/problem+json"
    );
    assert_eq!(value_of(&response, "cache-control"), "no-store");
    assert!(!value_of(&response, "x-request-id").is_empty());
    let value = json(&body);
    assert_eq!(value["status"], 404);
    assert_eq!(value["error"], value["detail"]);
}

#[tokio::test]
async fn unknown_page_is_html_for_browsers() {
    let state = state();
    let mut navigation = request("GET", "/no-such-page");
    navigation.headers_mut().insert(
        header::ACCEPT,
        "text/html,application/xhtml+xml".parse().unwrap(),
    );
    let (response, body) = send(&state, navigation).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(value_of(&response, "content-type").starts_with("text/html"));
    assert_eq!(value_of(&response, "cache-control"), "no-store");
    assert!(String::from_utf8(body).unwrap().contains("404 Not Found"));
}

#[tokio::test]
async fn wrong_method_keeps_allow() {
    let state = state();
    let (response, body) = send(&state, request("PUT", "/api/session")).await;
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert!(value_of(&response, "allow").contains("GET"));
    assert_eq!(
        value_of(&response, "content-type"),
        "application/problem+json"
    );
    assert_eq!(json(&body)["status"], 405);
}

#[tokio::test]
async fn head_is_answered_without_body() {
    let state = state();
    for uri in ["/healthz", "/api/session", "/api/openapi.json"] {
        let (response, body) = send(&state, request("HEAD", uri)).await;
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        assert!(body.is_empty(), "{uri}");
    }
}

#[tokio::test]
async fn liveness_is_cheap_and_readiness_reports_checks() {
    let state = state();
    let (live, body) = send(&state, request("GET", "/healthz")).await;
    assert_eq!(live.status(), StatusCode::OK);
    let value = json(&body);
    assert_eq!(value["ok"], true);
    assert_eq!(value["sourceCommit"], "0123456789abcdef");

    // No inventory in this release: not ready.
    let (ready, body) = send(&state, request("GET", "/api/health")).await;
    assert_eq!(ready.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(value_of(&ready, "cache-control"), "no-store");
    let value = json(&body);
    assert_eq!(value["ok"], false);
    assert_eq!(value["status"], "down");
    assert_eq!(value["sourceCommit"], "0123456789abcdef");
    assert_eq!(value["checks"]["inventory"]["ok"], false);
    assert_eq!(value["checks"]["client"]["optional"], true);
    assert_eq!(value["checks"]["session"]["optional"], true);
    assert_eq!(value["checks"]["accepting"]["ok"], true);
}

#[tokio::test]
async fn draining_turns_readiness_down() {
    let state = state();
    state.shutdown.send_replace(true);
    let (ready, body) = send(&state, request("GET", "/api/health")).await;
    assert_eq!(ready.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json(&body)["checks"]["accepting"]["ok"], false);
    let (live, _) = send(&state, request("GET", "/healthz")).await;
    assert_eq!(live.status(), StatusCode::OK);
}

#[tokio::test]
async fn request_id_is_kept_and_returned() {
    let state = state();
    let mut proxied = request("GET", "/healthz");
    proxied
        .headers_mut()
        .insert("x-request-id", "nginx-abc123".parse().unwrap());
    let (response, _) = send(&state, proxied).await;
    assert_eq!(value_of(&response, "x-request-id"), "nginx-abc123");
}

#[tokio::test]
async fn oversized_body_is_refused() {
    let state = state();
    let oversized = Request::builder()
        .method("POST")
        .uri("/api/sessions")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CONTENT_LENGTH, BODY_LIMIT + 1)
        .body(Body::from(vec![b' '; BODY_LIMIT + 1]))
        .unwrap();
    let (response, body) = send(&state, oversized).await;
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        value_of(&response, "content-type"),
        "application/problem+json"
    );
    assert_eq!(json(&body)["status"], 413);
}

#[tokio::test]
async fn unauthenticated_stop_is_a_problem() {
    let state = state();
    let (response, body) = send(&state, request("DELETE", "/api/sessions/abc")).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(
        json(&body)["error"]
            .as_str()
            .is_some_and(|e| e.contains("Sign in"))
    );
}

#[tokio::test]
async fn panics_become_problems() {
    let router: Router = Router::new()
        .route(
            "/boom",
            axum::routing::get(|| async {
                if std::hint::black_box(true) {
                    panic!("handler bug");
                }
            }),
        )
        .layer(CatchPanicLayer::custom(panicked))
        .layer(middleware::from_fn(errors));
    let response = router.oneshot(request("GET", "/boom")).await.unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "application/problem+json"
    );
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("handler bug"));
}

#[tokio::test]
async fn timeouts_and_overload_are_problems() {
    let elapsed = middleware_error(Box::new(tower::timeout::error::Elapsed::new())).await;
    assert_eq!(elapsed.status(), StatusCode::SERVICE_UNAVAILABLE);
    let shed = middleware_error(Box::new(tower::load_shed::error::Overloaded::new())).await;
    assert_eq!(shed.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(shed.headers()[header::RETRY_AFTER], "1");
}
