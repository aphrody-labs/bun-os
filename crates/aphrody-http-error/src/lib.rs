// SPDX-License-Identifier: Apache-2.0
//! One JSON error envelope for Aphrody's own HTTP surfaces (`aphrody-mcp`
//! REST, `aphrody-embed`), see `docs/apis/contracts/API.md` section 6.8.
//!
//! Wire shape: `{"error": {"code": "<string>", "message": "<string>", "data": <any, optional>}}`.
//!
//! [`api`] holds the Bun OS API contract (`docs/ops/API.md`): OpenAPI 3.1 from a typed route table,
//! the standard `/health` body and RFC 9457 problem responses, for services behind api.aphrody.com.
//!
//! Provider-compatible servers (`aphrody-gateway`, `aphrody-jev`) deliberately
//! do NOT use this crate: they mimic the OpenAI / Anthropic error formats so
//! stock clients keep working.

pub mod api;

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

/// Inner error object.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ErrorBody {
    /// Stable machine-readable code (the HTTP status number by default).
    pub code: String,
    /// Human-readable message.
    pub message: String,
    /// Optional structured details.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// Top-level envelope: `{"error": {...}}`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ErrorEnvelope {
    /// The error object.
    pub error: ErrorBody,
}

impl ErrorEnvelope {
    /// Build an envelope.
    #[must_use]
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        data: Option<serde_json::Value>,
    ) -> Self {
        Self {
            error: ErrorBody {
                code: code.into(),
                message: message.into(),
                data,
            },
        }
    }
}

/// Build the HTTP response for an error envelope.
#[must_use]
pub fn error_response(
    status: StatusCode,
    code: impl Into<String>,
    message: impl Into<String>,
    data: Option<serde_json::Value>,
) -> Response {
    (status, Json(ErrorEnvelope::new(code, message, data))).into_response()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn envelope_shape_omits_absent_data() {
        let response = error_response(StatusCode::NOT_FOUND, "404", "missing", None);
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            value,
            json!({"error": {"code": "404", "message": "missing"}})
        );
    }

    #[test]
    fn data_is_serialized_when_present() {
        let value =
            serde_json::to_value(ErrorEnvelope::new("x", "y", Some(json!({"a": 1})))).unwrap();
        assert_eq!(
            value,
            json!({"error": {"code": "x", "message": "y", "data": {"a": 1}}})
        );
    }
}
