// SPDX-License-Identifier: Apache-2.0

//! Loopback REST endpoints owned by the Aphrody AI backend.

use std::{sync::LazyLock, time::Duration};

use aphrody_models::ModelStore;
use aphrody_sql::pg::Client;
use axum::{
    Json, Router,
    body::Body,
    extract::Query,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};

const DB_TIMEOUT: Duration = Duration::from_millis(1500);
/// Connect timeout of the shared upstream client.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .pool_idle_timeout(Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

#[derive(Debug, Deserialize)]
struct RagQuery {
    q: Option<String>,
    limit: Option<usize>,
}

pub(crate) fn router() -> Router {
    Router::new()
        .route("/healthz", get(health_handler))
        .route("/api/v1/models", get(models_handler))
        .route("/v1/models", get(openai_models_handler))
        .route(
            "/v1/chat/completions",
            post(openai_chat_completions_handler),
        )
        .route("/api/v1/aphrody/status", get(aphrody_status_handler))
        .route("/api/v1/rag/query", get(rag_query_handler))
        .route("/api/v1/rag/stats", get(rag_stats_handler))
}

/// Build a chat-upstream request. Gateway/provider credentials are never used
/// here: the configured chat backend has its own protected bearer credential.
fn chat_request(method: reqwest::Method, url: reqwest::Url) -> reqwest::RequestBuilder {
    request_with_token(
        method,
        url,
        aphrody_config::ai_env::CHAT_API_KEY.resolve().as_deref(),
    )
}

fn request_with_token(
    method: reqwest::Method,
    url: reqwest::Url,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    let request = CLIENT.request(method, url);
    match token {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

/// A credentialed upstream cannot be exposed through an anonymous REST route.
/// Legacy keyless loopback chat remains usable without a gateway token.
fn gateway_auth(headers: &HeaderMap, expected: Option<&str>, required: bool) -> Option<Response> {
    let Some(expected) = expected.filter(|value| !value.trim().is_empty()) else {
        if !required {
            return None;
        }
        return Some(gateway_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Gateway API token is not configured",
        ));
    };
    let supplied = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split_once(' '))
        .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("Bearer"))
        .map(|(_, token)| token.trim());
    if !supplied.is_some_and(|token| {
        aphrody_secrets::constant_time_eq(token.as_bytes(), expected.as_bytes())
    }) {
        return Some(gateway_error(StatusCode::UNAUTHORIZED, "Unauthorized"));
    }
    None
}

fn gateway_error(status: StatusCode, message: &str) -> Response {
    let mut response =
        aphrody_http_error::error_response(status, status.as_u16().to_string(), message, None);
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store"),
    );
    response
}

/// The chat/code/reasoning/small capability's base URL. No literal port is
/// guessed (CLAUDE.md §7): `None` means unconfigured, not a wrong guess.
fn llm_url() -> Option<reqwest::Url> {
    let base = aphrody_config::ai_env::CHAT_BASE_URL.resolve()?;
    let url = reqwest::Url::parse(&base).ok()?;
    matches!(url.scheme(), "http" | "https").then_some(url)
}

/// Observe the configured backend without triggering model preparation or downloads.
fn llm_health_url() -> Option<reqwest::Url> {
    llm_url()
}

async fn health_handler() -> Response {
    response(
        json!({ "status": "ok", "service": "aphrody-ai-http" }),
        "no-store",
    )
}

fn response(payload: Value, cache_control: &'static str) -> Response {
    ([(header::CACHE_CONTROL, cache_control)], Json(payload)).into_response()
}

async fn models_handler() -> Response {
    let inventory = tokio::task::spawn_blocking(|| {
        let store = ModelStore::open().ok()?;
        if !store.registry_path().is_file() {
            return None;
        }
        store.list().ok()
    })
    .await;
    match inventory {
        Ok(Some(models)) => {
            let registered_count = models.len();
            let models: Vec<Value> = models
                .into_iter()
                .filter(|model| model.path.is_file())
                .map(|model| {
                    json!({
                        "id": model.catalog_id,
                        "format": model.format,
                        "bytes": model.bytes,
                        "installed_at": model.installed_at_rfc3339(),
                        "status": "present"
                    })
                })
                .collect();
            response(
                json!({
                    "status": if !models.is_empty() {
                        "active"
                    } else if registered_count == 0 {
                        "empty"
                    } else {
                        "unavailable"
                    },
                    "source": "aphrody_models_registry",
                    "models": models
                }),
                "no-store",
            )
        }
        _ => response(
            json!({
                "status": "unavailable",
                "reason": "Model registry unavailable",
                "models": []
            }),
            "no-store",
        ),
    }
}

/// Standard OpenAI `/v1/models` format.
async fn openai_models_handler() -> Response {
    let inventory = tokio::task::spawn_blocking(|| {
        let store = ModelStore::open().ok()?;
        if !store.registry_path().is_file() {
            return None;
        }
        store.list().ok()
    })
    .await;

    let mut model_entries: Vec<Value> = match inventory {
        Ok(Some(models)) => models
            .into_iter()
            .filter(|model| model.path.is_file())
            .map(|model| {
                json!({
                    "id": model.catalog_id,
                    "object": "model",
                    "created": 1727222400,
                    "owned_by": "aphrody-local",
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    // If local catalog is empty or unpopulated, expose the default local models
    if model_entries.is_empty() {
        for name in &[
            "qwen3-30b-a3b-instruct-2507-q4km",
            "qwen3-coder-30b-a3b-q4km",
            "gpt-oss-20b-mxfp4",
            "qwen3-4b-instruct-2507-q4km",
            "qwen3-vl-8b-instruct-q4km",
            "granite-docling-258m",
            "whisper-large-v3-turbo-q8",
            "qwen3-embedding-0.6b",
            "qwen3-reranker-0.6b-q8",
        ] {
            model_entries.push(json!({
                "id": name,
                "object": "model",
                "created": 1727222400,
                "owned_by": "aphrody-local",
            }));
        }
    }

    response(
        json!({
            "object": "list",
            "data": model_entries,
        }),
        "no-store",
    )
}

/// Forwarding or direct execution handler for `/v1/chat/completions`.
async fn openai_chat_completions_handler(
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Response {
    let token = aphrody_config::ai_env::CHAT_API_KEY.resolve();
    let gateway_token = aphrody_config::ai_env::HTTP_TOKEN.resolve();
    if let Some(error) = gateway_auth(&headers, gateway_token.as_deref(), token.is_some()) {
        return error;
    }
    let Some(url) = llm_url() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CACHE_CONTROL, "no-store")],
            Json(json!({
                "error": {
                    "message": "Local LLM runtime (llama-server) is not running or CHAT_BASE_URL is not configured",
                    "type": "server_error",
                    "code": "service_unavailable"
                }
            })),
        )
            .into_response();
    };

    forward_openai_chat(url, payload, token.as_deref()).await
}

/// Relay both JSON completions and SSE incrementally. Only response metadata
/// needed by clients is forwarded; upstream cookies and credentials stay private.
async fn forward_openai_chat(
    mut url: reqwest::Url,
    payload: Value,
    token: Option<&str>,
) -> Response {
    url.set_path(&format!(
        "{}/chat/completions",
        url.path().trim_end_matches('/')
    ));
    let upstream = request_with_token(reqwest::Method::POST, url, token)
        .timeout(Duration::from_secs(120))
        .json(&payload)
        .send()
        .await;

    match upstream {
        Ok(resp) => {
            let status = resp.status();
            let headers = resp.headers().clone();
            let mut response = Response::new(Body::from_stream(resp.bytes_stream()));
            *response.status_mut() = status;
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                axum::http::HeaderValue::from_static("no-store"),
            );
            response.headers_mut().insert(
                "x-accel-buffering",
                axum::http::HeaderValue::from_static("no"),
            );
            for name in [header::CONTENT_TYPE, header::RETRY_AFTER] {
                if let Some(value) = headers.get(&name) {
                    response.headers_mut().insert(name, value.clone());
                }
            }
            response
        }
        Err(_) => (
            StatusCode::BAD_GATEWAY,
            [(header::CACHE_CONTROL, "no-store")],
            Json(json!({
                "error": {
                    "message": "Chat upstream unavailable",
                    "type": "bad_gateway"
                }
            })),
        )
            .into_response(),
    }
}

/// Unified status endpoint for `aphrody core` / `aphrody kernel` / `aphrody ai api`.
async fn aphrody_status_handler() -> Response {
    let models_registered = tokio::task::spawn_blocking(|| {
        let store = ModelStore::open().ok()?;
        store.list().ok().map(|l| l.len())
    })
    .await
    .ok()
    .flatten()
    .unwrap_or(0);

    let llm_endpoint = llm_health_url();
    let llm_online = if let Some(mut url) = llm_endpoint.clone() {
        url.set_path(&format!("{}/models", url.path().trim_end_matches('/')));
        chat_request(reqwest::Method::GET, url)
            .timeout(DB_TIMEOUT)
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
    } else {
        false
    };

    response(
        json!({
            "status": "healthy",
            "version": env!("CARGO_PKG_VERSION"),
            "subsystems": {
                "core": "operational",
                "chat": "operational",
                "kernel": "operational",
                "ai_api": {
                    "status": if llm_online { "connected" } else { "standby" },
                    "models_count": models_registered,
                    "endpoint": llm_endpoint.map(|u| u.to_string()),
                }
            }
        }),
        "no-store",
    )
}

/// Checks a connection out of the process-wide `aphrody-sql` pool (TLS for non-loopback
/// hosts). `APHRODY_MCP_DATABASE_URL_POOLED` is preferred over the historical
/// `APHRODY_MCP_DATABASE_URL`, which keeps working unchanged.
async fn connect_db() -> Option<Client> {
    let url = aphrody_sql::DatabaseEnv::new("APHRODY_MCP").runtime()?.url;
    let pool = aphrody_sql::shared_pool(url.expose()).ok()?;
    tokio::time::timeout(DB_TIMEOUT, pool.get())
        .await
        .ok()?
        .ok()
}

async fn rag_query_handler(Query(params): Query<RagQuery>) -> Response {
    let query = params.q.unwrap_or_default().trim().to_lowercase();
    let limit = params.limit.unwrap_or(5).clamp(1, 20);
    if query.is_empty() {
        return response(
            json!({
                "query": query,
                "total_matches": 0,
                "limit": limit,
                "source": "postgresql_rag",
                "status": "query_required",
                "results": []
            }),
            "no-store",
        );
    }

    let Some(client) = connect_db().await else {
        return rag_unavailable(query, limit);
    };
    let pattern = format!("%{query}%");
    let row_limit = limit as i64;
    let sql = "SELECT title::text, url::text, corpus::text, content::text FROM \
               aphrody_rag_documents WHERE title ILIKE $1 OR content ILIKE $1 LIMIT $2";
    let rows = tokio::time::timeout(DB_TIMEOUT, client.query(sql, &[&pattern, &row_limit])).await;
    let Ok(Ok(rows)) = rows else {
        return rag_unavailable(query, limit);
    };

    let results: Vec<Value> = rows
        .iter()
        .map(|row| {
            let content = row
                .try_get::<_, Option<String>>(3)
                .ok()
                .flatten()
                .unwrap_or_default();
            let mut chars = content.chars();
            let snippet = chars.by_ref().take(180).collect::<String>();
            let snippet = if chars.next().is_some() {
                format!("{snippet}...")
            } else {
                snippet
            };
            json!({
                "title": row.try_get::<_, Option<String>>(0).ok().flatten(),
                "url": row.try_get::<_, Option<String>>(1).ok().flatten(),
                "corpus": row.try_get::<_, Option<String>>(2).ok().flatten(),
                "snippet": snippet,
                "match": "keyword"
            })
        })
        .collect();
    response(
        json!({
            "query": query,
            "total_matches": results.len(),
            "limit": limit,
            "source": "postgresql_rag",
            "status": "ok",
            "results": results
        }),
        "public, max-age=60",
    )
}

fn rag_unavailable(query: String, limit: usize) -> Response {
    response(
        json!({
            "query": query,
            "total_matches": 0,
            "limit": limit,
            "source": "postgresql_rag",
            "status": "unavailable",
            "reason": "RAG backend unavailable",
            "results": []
        }),
        "no-store",
    )
}

async fn rag_stats_handler() -> Response {
    let Some(client) = connect_db().await else {
        return stats_response(None, None);
    };
    let documents = count_rows(&client, "SELECT count(*) FROM aphrody_rag_documents").await;
    let chunks = count_rows(&client, "SELECT count(*) FROM aphrody_rag_chunks").await;
    stats_response(documents, chunks)
}

async fn count_rows(client: &Client, sql: &'static str) -> Option<i64> {
    let row = tokio::time::timeout(DB_TIMEOUT, client.query_one(sql, &[]))
        .await
        .ok()?
        .ok()?;
    row.try_get(0).ok()
}

fn stats_response(documents: Option<i64>, chunks: Option<i64>) -> Response {
    let active = documents.is_some() && chunks.is_some();
    response(
        json!({
            "status": if active { "active" } else { "unavailable" },
            "total_documents_indexed": documents,
            "total_vector_chunks": chunks,
            "vector_dimensions": null,
            "vector_index": null,
            "database": "PostgreSQL",
            "cache": null,
            "corpora": null
        }),
        if active {
            "public, max-age=300"
        } else {
            "no-store"
        },
    )
}

#[cfg(test)]
mod tests {
    use axum::body::to_bytes;

    use super::*;

    #[test]
    fn credentialed_chat_requires_a_distinct_gateway_credential() {
        let mut headers = HeaderMap::new();
        assert_eq!(
            gateway_auth(&headers, None, true).unwrap().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            gateway_auth(&headers, Some("gateway-fixture"), true)
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        headers.insert(
            header::AUTHORIZATION,
            axum::http::HeaderValue::from_static("Bearer upstream-fixture"),
        );
        assert_eq!(
            gateway_auth(&headers, Some("gateway-fixture"), true)
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        headers.insert(
            header::AUTHORIZATION,
            axum::http::HeaderValue::from_static("bearer gateway-fixture"),
        );
        assert!(gateway_auth(&headers, Some("gateway-fixture"), true).is_none());
        assert!(gateway_auth(&HeaderMap::new(), None, false).is_none());
        assert_eq!(
            gateway_auth(&HeaderMap::new(), Some("gateway-fixture"), false)
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn chat_proxy_authenticates_and_streams_before_upstream_completion() {
        use axum::body::Bytes;
        use futures_util::StreamExt;
        use std::{io, sync::Arc};
        let _ = rustls::crypto::ring::default_provider().install_default();
        let finish = Arc::new(tokio::sync::Notify::new());
        let upstream_finish = finish.clone();
        let app = Router::new().route(
            "/v1/chat/completions",
            post(move |headers: HeaderMap, Json(payload): Json<Value>| {
                let finish = upstream_finish.clone();
                async move {
                    assert_eq!(headers[header::AUTHORIZATION], "Bearer chat-only-fixture");
                    assert_eq!(payload["model"], "qualified-candidate");
                    assert_eq!(payload["stream"], true);
                    let first = futures_util::stream::once(async {
                        Ok::<_, io::Error>(Bytes::from_static(
                            b"data: {\"choices\":[{\"delta\":{\"content\":\"Bonjour\"}}]}\n\n",
                        ))
                    });
                    let last = futures_util::stream::once(async move {
                        finish.notified().await;
                        Ok::<_, io::Error>(Bytes::from_static(b"data: [DONE]\n\n"))
                    });
                    (
                        [
                            (header::CONTENT_TYPE, "text/event-stream"),
                            (header::SET_COOKIE, "upstream-private=fixture"),
                        ],
                        Body::from_stream(first.chain(last)),
                    )
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await });
        let response = tokio::time::timeout(Duration::from_secs(2), forward_openai_chat(
            reqwest::Url::parse(&format!("http://{address}/v1")).unwrap(),
            json!({"model":"qualified-candidate", "messages":[{"role":"user","content":"Bonjour"}], "stream":true}),
            Some("chat-only-fixture"),
        )).await.expect("the proxy must return before generation ends");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/event-stream"
        );
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(response.headers()["x-accel-buffering"], "no");
        assert!(!response.headers().contains_key(header::SET_COOKIE));
        let mut chunks = response.into_body().into_data_stream();
        let first = tokio::time::timeout(Duration::from_secs(2), chunks.next())
            .await
            .expect("first token is available without buffering")
            .unwrap()
            .unwrap();
        assert!(std::str::from_utf8(&first).unwrap().contains("Bonjour"));
        finish.notify_one();
        let done = tokio::time::timeout(Duration::from_secs(2), chunks.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(&done[..], b"data: [DONE]\n\n");
        server.abort();
    }

    #[tokio::test]
    async fn chat_proxy_preserves_json_error_status_and_retry_after() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let app = Router::new().route(
            "/v1/chat/completions",
            post(|| async {
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    [(header::RETRY_AFTER, "3")],
                    Json(json!({"error":{"message":"capacity reached","type":"rate_limit_error"}})),
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await });
        let response = forward_openai_chat(
            reqwest::Url::parse(&format!("http://{address}/v1")).unwrap(),
            json!({"model":"candidate", "stream":false}),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()[header::RETRY_AFTER], "3");
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["error"]["message"], "capacity reached");
        server.abort();
    }

    #[tokio::test]
    async fn loopback_router_exposes_liveness_and_query_contract() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, router()).await });
        let client = reqwest::Client::new();

        let health = client
            .get(format!("http://{address}/healthz"))
            .send()
            .await
            .unwrap();
        assert!(health.status().is_success());
        assert_eq!(health.json::<Value>().await.unwrap()["status"], "ok");

        let query = client
            .get(format!("http://{address}/api/v1/rag/query?q="))
            .send()
            .await
            .unwrap();
        assert!(query.status().is_success());
        assert_eq!(
            query.json::<Value>().await.unwrap()["status"],
            "query_required"
        );

        server.abort();
    }

    #[tokio::test]
    async fn empty_query_never_needs_database() {
        let response = rag_query_handler(Query(RagQuery {
            q: Some("   ".into()),
            limit: Some(50),
        }))
        .await;
        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        let result: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["status"], "query_required");
        assert_eq!(result["limit"], 20);
    }

    #[tokio::test]
    async fn stats_do_not_invent_counts() {
        let response = stats_response(None, None);
        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        let result: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(result["status"], "unavailable");
        assert!(result["total_documents_indexed"].is_null());
        assert!(result["total_vector_chunks"].is_null());
    }
}
