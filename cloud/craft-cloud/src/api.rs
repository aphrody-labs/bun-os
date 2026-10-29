//! Shared REST plumbing: bearer injection, retry with `Retry-After`, error mapping.

use aphrody_accounts::{Error, HttpRequest, HttpResponse, HttpTransport, Result, TokenSource};
use std::sync::Arc;
use std::time::Duration;

/// Retry policy for 429 and 5xx answers.
#[derive(Debug, Clone, Copy)]
pub struct Retry {
    /// Total attempts (first try included).
    pub attempts: u32,
    /// Delay when the server gives no `Retry-After`; doubles each attempt.
    pub base: Duration,
    /// Upper bound on any single wait.
    pub max: Duration,
}

impl Default for Retry {
    fn default() -> Self {
        Self { attempts: 4, base: Duration::from_millis(500), max: Duration::from_secs(30) }
    }
}

impl Retry {
    /// No waiting, for tests.
    pub const fn instant() -> Self {
        Self { attempts: 4, base: Duration::ZERO, max: Duration::ZERO }
    }
}

/// An authenticated REST client bound to one account and the scopes its calls need.
#[derive(Clone)]
pub struct Api {
    /// Transport (production: `UreqTransport`).
    pub http: Arc<dyn HttpTransport>,
    /// Token broker.
    pub tokens: Arc<dyn TokenSource>,
    /// Account id passed to the broker.
    pub account: String,
    /// Scopes every call of this client requires (checked before any request).
    pub scopes: Vec<&'static str>,
    /// Retry policy.
    pub retry: Retry,
}

impl Api {
    /// New client.
    pub fn new(http: Arc<dyn HttpTransport>, tokens: Arc<dyn TokenSource>, account: impl Into<String>, scopes: &[&'static str]) -> Self {
        Self { http, tokens, account: account.into(), scopes: scopes.to_vec(), retry: Retry::default() }
    }
    /// Override the retry policy.
    #[must_use]
    pub fn with_retry(mut self, retry: Retry) -> Self {
        self.retry = retry;
        self
    }
    fn bearer(&self) -> Result<String> {
        self.tokens.bearer(&self.account, &self.scopes)
    }

    /// Send with the account's bearer token; retries 429/500/502/503/504; 2xx only.
    pub fn send(&self, req: HttpRequest) -> Result<HttpResponse> {
        self.send_raw(req, true).and_then(HttpResponse::error_for_status)
    }

    /// Like [`Self::send`] but returns any final status (callers that interpret 308 or 412 themselves).
    pub fn send_any(&self, req: HttpRequest) -> Result<HttpResponse> {
        self.send_raw(req, true)
    }

    /// Send WITHOUT the bearer token (pre-authenticated upload/download URLs reject an Authorization header).
    pub fn send_anonymous(&self, req: HttpRequest) -> Result<HttpResponse> {
        self.send_raw(req, false)
    }

    fn send_raw(&self, req: HttpRequest, auth: bool) -> Result<HttpResponse> {
        let attempts = self.retry.attempts.max(1);
        let mut delay = self.retry.base;
        for attempt in 1..=attempts {
            let mut r = req.clone();
            if auth {
                r = r.bearer(&self.bearer()?);
            }
            let resp = self.http.execute(&r)?;
            let retryable = matches!(resp.status, 429 | 500 | 502 | 503 | 504);
            if !retryable || attempt == attempts {
                return Ok(resp);
            }
            let wait = resp
                .header("retry-after")
                .and_then(|v| v.trim().parse::<u64>().ok())
                .map_or(delay, Duration::from_secs)
                .min(self.retry.max);
            if !wait.is_zero() {
                std::thread::sleep(wait);
            }
            delay = (delay * 2).min(self.retry.max);
        }
        Err(Error::Transport("retry loop exhausted".into()))
    }

    /// `GET url` and parse JSON.
    pub fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T> {
        self.send(HttpRequest::get(url))?.parse()
    }
    /// Send a JSON body and parse the JSON answer.
    pub fn json<T: serde::de::DeserializeOwned>(&self, method: &str, url: &str, body: &serde_json::Value) -> Result<T> {
        self.send(HttpRequest::json(method, url, body))?.parse()
    }
}

/// Percent-encode one path segment or query value.
pub fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>().replace('+', "%20")
}

/// Random multipart boundary.
pub fn boundary() -> String {
    let mut b = [0u8; 12];
    let _ = getrandom::fill(&mut b);
    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("aphrody-{hex}")
}

/// Assemble a `multipart/related` body: a JSON metadata part followed by one media part.
pub fn multipart_related(boundary: &str, metadata: &serde_json::Value, media_type: &str, media: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(media.len() + 512);
    out.extend_from_slice(format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: {media_type}\r\n\r\n").as_bytes());
    out.extend_from_slice(media);
    out.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());
    out
}

#[cfg(test)]
pub(crate) mod testutil {
    use super::*;
    use aphrody_accounts::StaticToken;
    use aphrody_accounts::testing::ScriptedTransport;

    pub fn api(t: Arc<ScriptedTransport>) -> Api {
        Api::new(t, Arc::new(StaticToken("TOK".into())), "acct", &[]).with_retry(Retry::instant())
    }
}

#[cfg(test)]
mod tests {
    use super::testutil::api;
    use super::*;
    use aphrody_accounts::testing::ScriptedTransport;

    #[test]
    fn retries_429_then_succeeds_and_sends_bearer() {
        let t = Arc::new(
            ScriptedTransport::new()
                .on("x", HttpResponse { status: 429, headers: vec![("Retry-After".into(), "0".into())], body: vec![] })
                .on("x", HttpResponse { status: 503, ..Default::default() })
                .on("x", HttpResponse::json(200, &serde_json::json!({"ok":true}))),
        );
        let v: serde_json::Value = api(t.clone()).get_json("https://h/x").unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(t.requests().len(), 3);
        assert_eq!(t.requests()[0].header_value("authorization"), Some("Bearer TOK"));
    }

    #[test]
    fn non_retryable_errors_carry_the_api_message() {
        let t = Arc::new(ScriptedTransport::new().on(
            "x",
            HttpResponse::json(403, &serde_json::json!({"error":{"code":403,"message":"The caller does not have permission"}})),
        ));
        match api(t).send(HttpRequest::get("https://h/x")) {
            Err(Error::Api { status: 403, message }) => assert!(message.contains("permission")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn anonymous_requests_carry_no_authorization() {
        let t = Arc::new(ScriptedTransport::new().on("up", HttpResponse { status: 200, ..Default::default() }));
        api(t.clone()).send_anonymous(HttpRequest::get("https://up/x")).unwrap();
        assert!(t.requests()[0].header_value("authorization").is_none());
    }

    #[test]
    fn encodes_and_builds_multipart() {
        assert_eq!(enc("a b/c&d"), "a%20b%2Fc%26d");
        let body = multipart_related("B", &serde_json::json!({"name":"n"}), "text/plain", b"hi");
        let s = String::from_utf8(body).unwrap();
        assert!(s.starts_with("--B\r\n") && s.contains("{\"name\":\"n\"}") && s.ends_with("hi\r\n--B--"));
    }
}
