// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! MCP HTTP retrieval target evaluating tools/call `rag_search`.

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use aphrody_rag_core::eval::RetrievedHit;
use async_trait::async_trait;
use reqwest::{
    Client, StatusCode,
    header::{CONTENT_TYPE, USER_AGENT},
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tokio::sync::Mutex;

use super::{EvalTarget, TargetResponse};
use crate::error::{EvalError, Result};

/// Wire request payload for MCP JSON-RPC `tools/call`.
#[derive(Debug, Serialize)]
struct McpCallRequest<'a> {
    jsonrpc: &'static str,
    id: u64,
    method: &'static str,
    params: McpCallParams<'a>,
}

#[derive(Debug, Serialize)]
struct McpCallParams<'a> {
    name: &'a str,
    arguments: JsonValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    _meta: Option<&'a JsonValue>,
}

#[derive(Debug, Deserialize)]
struct McpCallContentItem {
    #[serde(rename = "type")]
    item_type: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct McpCallResult {
    #[serde(default)]
    content: Vec<McpCallContentItem>,
    #[serde(default, alias = "isError")]
    is_error: bool,
    #[serde(rename = "structuredContent")]
    structured_content: Option<JsonValue>,
}

#[derive(Debug, Deserialize)]
struct McpCallResponse {
    jsonrpc: String,
    id: JsonValue,
    result: Option<McpCallResult>,
    error: Option<JsonValue>,
}

/// Target querying an external or local MCP endpoint serving `rag_search`.
pub struct McpTarget {
    name: String,
    endpoint_url: String,
    client: std::result::Result<Client, reqwest::Error>,
    tool_name: String,
    min_interval: Duration,
    last_request_at: Arc<Mutex<Option<Instant>>>,
}

impl McpTarget {
    /// Create a new MCP target targeting `endpoint_url`.
    pub fn new(endpoint_url: impl Into<String>) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let endpoint = endpoint_url.into();
        Self {
            name: format!("mcp:{}", endpoint),
            endpoint_url: endpoint,
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::none())
                .build(),
            tool_name: "rag_search".to_owned(),
            min_interval: Duration::from_millis(500),
            last_request_at: Arc::new(Mutex::new(None)),
        }
    }

    /// Set a custom tool name if divergent (default: `rag_search`).
    pub fn with_tool_name(mut self, name: impl Into<String>) -> Self {
        self.tool_name = name.into();
        self
    }

    /// Set the minimum interval between read-only MCP searches (never above 2 QPS).
    pub fn with_rate_limit(mut self, min_interval: Duration) -> Self {
        self.min_interval = min_interval.max(Duration::from_millis(500));
        self
    }
}

#[async_trait]
impl EvalTarget for McpTarget {
    fn name(&self) -> &str {
        &self.name
    }

    async fn query(&self, query_str: &str, limit: usize) -> Result<TargetResponse> {
        if !matches!(self.tool_name.as_str(), "rag_search") {
            return Err(EvalError::Other(
                "MCP evaluation permits only read-only rag_search tools".to_owned(),
            ));
        }
        let _endpoint = reqwest::Url::parse(&self.endpoint_url)
            .map_err(|error| EvalError::Other(format!("invalid MCP endpoint: {error}")))?;
        // Serialize the whole exchange, not only the initial delay.
        let mut last_request_at = self.last_request_at.lock().await;
        let start = Instant::now();

        let req_body = McpCallRequest {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: McpCallParams {
                name: &self.tool_name,
                arguments: search_arguments(query_str, limit),
                _meta: None,
            },
        };

        let mut failures = 0;
        let resp = loop {
            if let Some(last) = *last_request_at {
                let wait = self.min_interval.saturating_sub(last.elapsed());
                if !wait.is_zero() {
                    tokio::time::sleep(wait).await;
                }
            }
            *last_request_at = Some(Instant::now());
            let client = self.client.as_ref().map_err(|error| {
                EvalError::Other(format!("MCP HTTP client configuration failed: {error}"))
            })?;
            let response = client
                .post(&self.endpoint_url)
                .header(CONTENT_TYPE, "application/json")
                .header(USER_AGENT, "aphrody-rag-eval/1.0.0 (read-only MCP search)")
                .json(&req_body)
                .send()
                .await?;
            let status = response.status();
            if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS {
                failures += 1;
                if failures == 3 {
                    return Err(EvalError::CircuitBreaker {
                        consecutive_failures: failures,
                        last_status: status.as_u16(),
                        message: format!("received MCP HTTP {status}"),
                    });
                }
                continue;
            }
            break response;
        };
        let body: McpCallResponse = resp.error_for_status()?.json().await?;
        if body.jsonrpc != "2.0" || body.id != 1 {
            return Err(EvalError::Other(
                "invalid MCP JSON-RPC version or response id".to_owned(),
            ));
        }

        if body.error.is_some() {
            return Err(EvalError::Other(
                "MCP server returned a JSON-RPC error".to_owned(),
            ));
        }

        let mcp_res = body
            .result
            .ok_or_else(|| EvalError::Other("missing result in MCP response".to_string()))?;

        if mcp_res.is_error {
            return Err(EvalError::Other(
                "MCP search tool reported an error".to_owned(),
            ));
        }

        let payload = if let Some(structured) = mcp_res.structured_content {
            structured
        } else {
            let item = mcp_res
                .content
                .iter()
                .find(|item| item.item_type == "text" && item.text.is_some())
                .ok_or_else(|| {
                    EvalError::Other("MCP search returned no structured result".to_owned())
                })?;
            serde_json::from_str(item.text.as_deref().unwrap_or_default())?
        };
        let (hits, mode) = parse_search_payload(payload)?;

        let latency_ms = start.elapsed().as_millis() as u64;

        Ok(TargetResponse {
            hits,
            mode_served: mode,
            latency_ms,
        })
    }
}

fn parse_search_payload(payload: JsonValue) -> Result<(Vec<RetrievedHit>, String)> {
    let mode = payload
        .get("mode_served")
        .or_else(|| payload.get("modeServed"))
        .or_else(|| payload.get("mode"))
        .and_then(JsonValue::as_str)
        .filter(|mode| !mode.trim().is_empty())
        .ok_or_else(|| EvalError::Other("MCP search result lacks mode_served".to_owned()))?;
    let hits = payload
        .get("hits")
        .or_else(|| payload.get("results"))
        .ok_or_else(|| EvalError::Other("MCP search result lacks hits".to_owned()))?;
    let hits = serde_json::from_value::<Vec<RetrievedHit>>(hits.clone())?;
    Ok((hits, mode.to_owned()))
}

fn search_arguments(query: &str, limit: usize) -> JsonValue {
    serde_json::json!({ "query": query, "limit": limit })
}

#[cfg(test)]
mod tests {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    use super::*;

    #[test]
    fn structured_results_require_mode_and_valid_hits() {
        assert!(parse_search_payload(serde_json::json!({"hits": []})).is_err());
        assert!(
            parse_search_payload(serde_json::json!({"mode_served": "lexical", "hits": [{}]}))
                .is_err()
        );
        let (hits, mode) =
            parse_search_payload(serde_json::json!({"mode_served": "lexical", "hits": []}))
                .expect("valid empty result");
        assert!(hits.is_empty());
        assert_eq!(mode, "lexical");
    }

    #[tokio::test]
    async fn mcp_target_accepts_structured_read_only_search() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local address");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut request = [0u8; 2048];
            let count = socket.read(&mut request).await.expect("read request");
            assert!(String::from_utf8_lossy(&request[..count]).starts_with("POST /mcp HTTP/1.1"));
            let body = r#"{"jsonrpc":"2.0","id":1,"result":{"content":[],"structuredContent":{"hits":[],"mode_served":"lexical"}}}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \
                 {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket
                .write_all(response.as_bytes())
                .await
                .expect("respond");
        });
        let target = McpTarget::new(format!("http://{addr}/mcp"));
        let result = target.query("query", 5).await.expect("MCP search");
        assert_eq!(result.mode_served, "lexical");
        assert!(result.hits.is_empty());
        server.await.expect("server task");
    }

    #[tokio::test]
    async fn mcp_target_blocks_non_search_tools() {
        let wrong_tool = McpTarget::new("http://127.0.0.1:9/mcp").with_tool_name("rag_ingest");
        assert!(wrong_tool.query("query", 5).await.is_err());
    }

    #[tokio::test]
    async fn mcp_target_aborts_after_three_rate_limits() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local address");
        let server = tokio::spawn(async move {
            for _ in 0..3 {
                let (mut socket, _) = listener.accept().await.expect("accept");
                let mut request = [0u8; 2048];
                let count = socket.read(&mut request).await.expect("read request");
                assert!(count > 0);
                socket.write_all(b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .await.expect("respond");
            }
        });
        let target = McpTarget::new(format!("http://{addr}/mcp"));
        assert!(matches!(
            target.query("query", 5).await,
            Err(EvalError::CircuitBreaker {
                consecutive_failures: 3,
                last_status: 429,
                ..
            })
        ));
        server.await.expect("server task");
    }
}
