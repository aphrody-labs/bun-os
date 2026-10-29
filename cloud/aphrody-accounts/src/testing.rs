//! In-memory transport for fixture tests: scripted responses, recorded requests.

use crate::error::{Error, Result};
use crate::http::{HttpRequest, HttpResponse, HttpTransport};
use std::collections::VecDeque;
use std::sync::Mutex;

type Matcher = Box<dyn Fn(&HttpRequest) -> bool + Send + Sync>;

/// Responds to requests from a queue of `(matcher, response)` rules; the first rule whose
/// matcher accepts the request is used (and consumed unless it is `sticky`).
#[derive(Default)]
pub struct ScriptedTransport {
    rules: Mutex<VecDeque<(Matcher, HttpResponse, bool)>>,
    seen: Mutex<Vec<HttpRequest>>,
}

impl ScriptedTransport {
    /// Empty script.
    pub fn new() -> Self {
        Self::default()
    }
    /// One-shot rule matching on a URL substring.
    pub fn on(self, url_contains: &str, response: HttpResponse) -> Self {
        self.on_if(move_str(url_contains), response, false)
    }
    /// Rule that stays in the queue after matching.
    pub fn always(self, url_contains: &str, response: HttpResponse) -> Self {
        self.on_if(move_str(url_contains), response, true)
    }
    /// One-shot rule with a custom matcher.
    pub fn on_if(
        self,
        matcher: impl Fn(&HttpRequest) -> bool + Send + Sync + 'static,
        response: HttpResponse,
        sticky: bool,
    ) -> Self {
        if let Ok(mut r) = self.rules.lock() {
            r.push_back((Box::new(matcher), response, sticky));
        }
        self
    }
    /// Every request executed so far.
    pub fn requests(&self) -> Vec<HttpRequest> {
        self.seen.lock().map(|s| s.clone()).unwrap_or_default()
    }
    /// Number of requests whose URL contains `needle`.
    pub fn count(&self, needle: &str) -> usize {
        self.requests().iter().filter(|r| r.url.contains(needle)).count()
    }
}

fn move_str(s: &str) -> impl Fn(&HttpRequest) -> bool + Send + Sync + 'static + use<> {
    let s = s.to_owned();
    move |r| r.url.contains(&s)
}

impl HttpTransport for ScriptedTransport {
    fn execute(&self, req: &HttpRequest) -> Result<HttpResponse> {
        if let Ok(mut s) = self.seen.lock() {
            s.push(req.clone());
        }
        let mut rules = self.rules.lock().map_err(|_| Error::Transport("poisoned".into()))?;
        let Some(idx) = rules.iter().position(|(m, _, _)| m(req)) else {
            return Err(Error::Transport(format!("no scripted response for {} {}", req.method, req.url)));
        };
        let resp = if rules[idx].2 {
            rules[idx].1.clone()
        } else {
            rules.remove(idx).map(|r| r.1).unwrap_or_default()
        };
        Ok(resp)
    }
}

/// Build an unsigned JWT-shaped id_token carrying `claims` (header `alg: none`), as used in fixtures.
pub fn fake_id_token(claims: &serde_json::Value) -> String {
    use base64::Engine as _;
    let enc = |v: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v);
    format!("{}.{}.", enc(br#"{"alg":"none"}"#), enc(claims.to_string().as_bytes()))
}
