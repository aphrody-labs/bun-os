//! Minimal blocking HTTP seam. Production uses `ureq` (rustls); tests script responses.

use crate::error::{Error, Result};
use serde::de::DeserializeOwned;
use std::time::Duration;

/// Request body.
#[derive(Debug, Clone, Default)]
pub enum Body {
    /// No body.
    #[default]
    Empty,
    /// `application/x-www-form-urlencoded`.
    Form(Vec<(String, String)>),
    /// Raw bytes with an explicit content type.
    Bytes {
        /// `Content-Type` value.
        content_type: String,
        /// Payload.
        data: Vec<u8>,
    },
}

/// One HTTP request.
#[derive(Debug, Clone)]
pub struct HttpRequest {
    /// Upper-case method.
    pub method: String,
    /// Absolute URL.
    pub url: String,
    /// Extra headers (`Authorization` lives here and is redacted by [`HttpRequest::redacted`]).
    pub headers: Vec<(String, String)>,
    /// Body.
    pub body: Body,
}

impl HttpRequest {
    /// `GET url`.
    pub fn get(url: impl Into<String>) -> Self {
        Self::new("GET", url)
    }
    /// Request with no body.
    pub fn new(method: &str, url: impl Into<String>) -> Self {
        Self {
            method: method.into(),
            url: url.into(),
            headers: Vec::new(),
            body: Body::Empty,
        }
    }
    /// `POST` form.
    pub fn post_form(url: impl Into<String>, fields: Vec<(String, String)>) -> Self {
        let mut r = Self::new("POST", url);
        r.body = Body::Form(fields);
        r
    }
    /// JSON body (`application/json; charset=UTF-8`).
    pub fn json(method: &str, url: impl Into<String>, value: &serde_json::Value) -> Self {
        let mut r = Self::new(method, url);
        r.body = Body::Bytes {
            content_type: "application/json; charset=UTF-8".into(),
            data: serde_json::to_vec(value).unwrap_or_default(),
        };
        r
    }
    /// Raw body.
    pub fn bytes(method: &str, url: impl Into<String>, content_type: &str, data: Vec<u8>) -> Self {
        let mut r = Self::new(method, url);
        r.body = Body::Bytes {
            content_type: content_type.into(),
            data,
        };
        r
    }
    /// Add a header.
    #[must_use]
    pub fn header(mut self, name: &str, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }
    /// `Authorization: Bearer ...`.
    #[must_use]
    pub fn bearer(self, token: &str) -> Self {
        self.header("Authorization", format!("Bearer {token}"))
    }
    /// Value of a header, case-insensitive.
    pub fn header_value(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
    /// Body as UTF-8 text (form bodies are re-encoded), for assertions and logs.
    pub fn body_text(&self) -> String {
        match &self.body {
            Body::Empty => String::new(),
            Body::Form(f) => encode_form(f),
            Body::Bytes { data, .. } => String::from_utf8_lossy(data).into_owned(),
        }
    }
}

/// HTTP response with the body fully read.
#[derive(Debug, Clone, Default)]
pub struct HttpResponse {
    /// Status code.
    pub status: u16,
    /// Response headers.
    pub headers: Vec<(String, String)>,
    /// Body bytes.
    pub body: Vec<u8>,
}

impl HttpResponse {
    /// Build a JSON response (used by fixtures).
    pub fn json(status: u16, value: &serde_json::Value) -> Self {
        Self {
            status,
            headers: vec![("content-type".into(), "application/json".into())],
            body: serde_json::to_vec(value).unwrap_or_default(),
        }
    }
    /// 2xx.
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }
    /// Header value, case-insensitive.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
    /// Body as lossy UTF-8.
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
    /// Parse the body as JSON.
    pub fn parse<T: DeserializeOwned>(&self) -> Result<T> {
        serde_json::from_slice(&self.body).map_err(Error::from)
    }
    /// Turn a non-2xx response into [`Error::Api`] (message extracted from Google/Graph error envelopes).
    pub fn error_for_status(self) -> Result<Self> {
        if self.is_success() {
            return Ok(self);
        }
        Err(Error::Api {
            status: self.status,
            message: api_message(&self.body),
        })
    }
}

/// Extract `error.message` (Google, Graph) or `error` (OAuth) from an error body, truncated.
pub fn api_message(body: &[u8]) -> String {
    let fallback = || {
        String::from_utf8_lossy(body)
            .chars()
            .take(300)
            .collect::<String>()
    };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(body) else {
        return fallback();
    };
    let msg = v
        .pointer("/error/message")
        .or_else(|| v.pointer("/error_description"))
        .or_else(|| v.pointer("/error"))
        .and_then(|m| m.as_str());
    msg.map_or_else(fallback, |m| m.chars().take(300).collect())
}

/// `application/x-www-form-urlencoded` encoding.
pub fn encode_form(fields: &[(String, String)]) -> String {
    let mut ser = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in fields {
        ser.append_pair(k, v);
    }
    ser.finish()
}

/// The transport seam every client in this stack goes through.
pub trait HttpTransport: Send + Sync {
    /// Execute one request. Non-2xx statuses are NOT errors at this layer.
    fn execute(&self, req: &HttpRequest) -> Result<HttpResponse>;
}

/// Production transport over `ureq` with rustls.
#[derive(Clone)]
pub struct UreqTransport {
    agent: ureq::Agent,
}

impl UreqTransport {
    /// Agent with a 120 s global timeout and statuses surfaced as data.
    pub fn new() -> Self {
        Self::with_timeout(Duration::from_secs(120))
    }
    /// Agent with a custom global timeout.
    pub fn with_timeout(timeout: Duration) -> Self {
        let config = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(timeout))
            .user_agent("aphrody-accounts/1.4")
            .build();
        Self {
            agent: config.into(),
        }
    }
}

impl Default for UreqTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpTransport for UreqTransport {
    fn execute(&self, req: &HttpRequest) -> Result<HttpResponse> {
        let mut builder = ureq::http::Request::builder()
            .method(req.method.as_str())
            .uri(req.url.as_str());
        for (k, v) in &req.headers {
            builder = builder.header(k.as_str(), v.as_str());
        }
        let (content_type, data): (Option<String>, Vec<u8>) = match &req.body {
            Body::Empty => (None, Vec::new()),
            Body::Form(f) => (
                Some("application/x-www-form-urlencoded".into()),
                encode_form(f).into_bytes(),
            ),
            Body::Bytes { content_type, data } => (Some(content_type.clone()), data.clone()),
        };
        if let Some(ct) = content_type {
            builder = builder.header("Content-Type", ct);
        }
        let transport = |e: ureq::Error| Error::Transport(e.to_string());
        let mut resp = if data.is_empty()
            && req.method != "POST"
            && req.method != "PUT"
            && req.method != "PATCH"
        {
            let r = builder
                .body(())
                .map_err(|e| Error::Transport(e.to_string()))?;
            self.agent.run(r).map_err(transport)?
        } else {
            let r = builder
                .body(data)
                .map_err(|e| Error::Transport(e.to_string()))?;
            self.agent.run(r).map_err(transport)?
        };
        let status = resp.status().as_u16();
        let headers = resp
            .headers()
            .iter()
            .map(|(k, v)| {
                (
                    k.as_str().to_owned(),
                    v.to_str().unwrap_or_default().to_owned(),
                )
            })
            .collect();
        let body = resp
            .body_mut()
            .with_config()
            .limit(2 * 1024 * 1024 * 1024)
            .read_to_vec()
            .map_err(transport)?;
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}
