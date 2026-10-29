// SPDX-License-Identifier: Apache-2.0
//! Optional HTTP routing to existing Jev and chat endpoints.
// Portable settings and wire text cannot depend on Bun's native environment/string wrappers.
#![allow(clippy::disallowed_methods)]
use crate::{
    Backend, Decision, Failover, JevError, NativeEngine, Request, Response, check_request,
    check_response,
};
use serde::Deserialize;
use std::{
    collections::VecDeque,
    fmt,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use url::Url;

/// Default SaaS base URL.
pub const SAAS_BASE_URL: &str = "https://api.typesafe.ai";
/// Default Cloudflare API base URL.
pub const CLOUDFLARE_BASE_URL: &str = "https://api.cloudflare.com";
/// Cloudflare Workers AI model id of Jev.
pub const EDGE_MODEL: &str = "typesafe/jev";
/// Context limit of the Cloudflare model.
pub const EDGE_CONTEXT_TOKENS: usize = 32_000;
/// Default local jeff server.
pub const LOCAL_BASE_URL: &str = "http://127.0.0.1:8000";
/// Tracing target of failover events.
pub const FAILOVER_TARGET: &str = "aphrody_jev::failover";

/// Connection settings of one backend.
#[derive(Clone)]
pub struct Endpoint {
    base: Url,
    token: Option<String>,
    account_id: Option<String>,
}

impl fmt::Debug for Endpoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Endpoint")
            .field("base", &self.base.as_str())
            .field("token", &self.token.as_ref().map(|_| "<redacted>"))
            .field("account_id", &self.account_id)
            .finish()
    }
}

impl Endpoint {
    /// TypeSafe SaaS endpoint.
    ///
    /// # Errors
    /// [`JevError::Config`] when `base` is not a URL.
    pub fn saas(base: &str, api_key: impl Into<String>) -> Result<Self, JevError> {
        Ok(Self {
            base: parse_base(base)?,
            token: Some(api_key.into()),
            account_id: None,
        })
    }

    /// Cloudflare Workers AI endpoint.
    ///
    /// # Errors
    /// [`JevError::Config`] when `base` is not a URL.
    pub fn edge(
        base: &str,
        account_id: impl Into<String>,
        api_token: impl Into<String>,
    ) -> Result<Self, JevError> {
        Ok(Self {
            base: parse_base(base)?,
            token: Some(api_token.into()),
            account_id: Some(account_id.into()),
        })
    }

    /// Self-hosted jeff endpoint; `api_key` is optional.
    ///
    /// # Errors
    /// [`JevError::Config`] when `base` is not a URL.
    pub fn local(base: &str, api_key: Option<String>) -> Result<Self, JevError> {
        Ok(Self {
            base: parse_base(base)?,
            token: api_key,
            account_id: None,
        })
    }

    fn url(&self, backend: Backend) -> Result<Url, JevError> {
        let path = match backend {
            Backend::Saas | Backend::Local | Backend::Native => "v1/systemone".to_owned(),
            Backend::Edge => format!(
                "client/v4/accounts/{}/ai/run",
                self.account_id.as_deref().unwrap_or_default()
            ),
        };
        self.base
            .join(&path)
            .map_err(|e| JevError::Config(e.to_string()))
    }
}

fn parse_base(base: &str) -> Result<Url, JevError> {
    let with_slash = if base.ends_with('/') {
        base.to_owned()
    } else {
        format!("{base}/")
    };
    Url::parse(&with_slash).map_err(|e| JevError::Config(format!("{base}: {e}")))
}

/// Routing thresholds.
#[derive(Debug, Clone)]
pub struct RoutingPolicy {
    /// States at or above this size go to the edge when it is configured.
    pub edge_min_tokens: usize,
    /// SaaS rolling P99 above this budget routes to the local backend.
    pub p99_budget: Duration,
    /// Number of SaaS latency samples kept.
    pub window: usize,
    /// Samples required before the P99 rule applies.
    pub min_samples: usize,
    /// While degraded, one request in `probe_every` still goes to the SaaS so
    /// its latency can recover.
    pub probe_every: u64,
    /// Per-request timeout of remote backends.
    pub remote_timeout: Duration,
    /// Per-request timeout of the local backend.
    pub local_timeout: Duration,
}

impl Default for RoutingPolicy {
    fn default() -> Self {
        Self {
            edge_min_tokens: 8_000,
            p99_budget: Duration::from_millis(500),
            window: 200,
            min_samples: 20,
            probe_every: 20,
            remote_timeout: Duration::from_secs(5),
            local_timeout: Duration::from_secs(30),
        }
    }
}

#[derive(Debug, Default)]
struct Health {
    samples: VecDeque<Duration>,
    requests: u64,
}

impl Health {
    fn record(&mut self, latency: Duration, window: usize) {
        if self.samples.len() == window {
            self.samples.pop_front();
        }
        self.samples.push_back(latency);
    }

    fn p99(&self, min_samples: usize) -> Option<Duration> {
        if self.samples.len() < min_samples.max(1) {
            return None;
        }
        let mut sorted: Vec<_> = self.samples.iter().copied().collect();
        sorted.sort_unstable();
        let rank = (sorted.len() * 99).div_ceil(100).max(1);
        Some(sorted[rank - 1])
    }
}

/// Routes decisions across the configured backends.
#[derive(Debug)]
pub struct JevRouter {
    http: reqwest::Client,
    saas: Option<Endpoint>,
    edge: Option<Endpoint>,
    local: Option<Endpoint>,
    native: Option<NativeEngine>,
    policy: RoutingPolicy,
    health: Mutex<Health>,
}

/// Which Jev implementation answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JevMode {
    /// The endpoint client for the product's existing local model service.
    Aphrody,
    /// Real Jev without a TypeSafe key, through Cloudflare Workers AI.
    Keyless,
    /// Real Jev through the TypeSafe SaaS with an API key.
    ApiKey,
}

impl std::str::FromStr for JevMode {
    type Err = JevError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "aphrody" | "native" => Ok(Self::Aphrody),
            "keyless" | "edge" | "cloudflare" => Ok(Self::Keyless),
            "api-key" | "apikey" | "saas" => Ok(Self::ApiKey),
            other => Err(JevError::Config(format!(
                "unknown Jev mode `{other}` (expected aphrody, keyless or api-key)"
            ))),
        }
    }
}

impl fmt::Display for JevMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Aphrody => "aphrody",
            Self::Keyless => "keyless",
            Self::ApiKey => "api-key",
        })
    }
}

/// Outcome of one backend attempt that may be retried elsewhere.
enum Attempt {
    Done(Response, Duration),
    /// Transport error, timeout or 5xx: eligible for failover.
    Unavailable(String),
}

impl JevRouter {
    /// Build a router; at least one backend must be set.
    ///
    /// # Errors
    /// [`JevError::NoBackend`] or [`JevError::Config`].
    pub fn new(
        saas: Option<Endpoint>,
        edge: Option<Endpoint>,
        local: Option<Endpoint>,
        policy: RoutingPolicy,
    ) -> Result<Self, JevError> {
        if saas.is_none() && edge.is_none() && local.is_none() {
            return Err(JevError::NoBackend);
        }
        Self::build(saas, edge, local, None, policy)
    }

    /// Route every decision through the supplied endpoint client.
    ///
    /// # Errors
    /// [`JevError::Config`].
    pub fn aphrody(engine: NativeEngine, policy: RoutingPolicy) -> Result<Self, JevError> {
        Self::build(None, None, None, Some(engine), policy)
    }

    /// Add the native engine as the last-resort fallback.
    #[must_use]
    pub fn with_native(mut self, engine: NativeEngine) -> Self {
        self.native = Some(engine);
        self
    }

    fn build(
        saas: Option<Endpoint>,
        edge: Option<Endpoint>,
        local: Option<Endpoint>,
        native: Option<NativeEngine>,
        policy: RoutingPolicy,
    ) -> Result<Self, JevError> {
        #[cfg(not(target_arch = "wasm32"))]
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .user_agent(concat!("aphrody-jev/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| JevError::Config(e.to_string()))?;
        Ok(Self {
            http,
            saas,
            edge,
            local,
            native,
            policy,
            health: Mutex::new(Health::default()),
        })
    }

    /// Build from the environment. `APHRODY_JEV_MODE` picks the mode
    /// (`aphrody`, `keyless`, `api-key`); without it the mode is `api-key`
    /// when `TYPESAFE_API_KEY` is set, else `keyless` when Cloudflare
    /// credentials are set, else `aphrody` when `APHRODY_JEV_ENGINE_URL` is
    /// set, else no backend.
    ///
    /// - `api-key`: `TYPESAFE_API_KEY` (+ `TYPESAFE_BASE_URL`), plus the edge for large states when
    ///   Cloudflare credentials are present.
    /// - `keyless`: `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_API_BASE_URL`).
    /// - `aphrody`: `APHRODY_JEV_ENGINE_URL` (default: the canonical
    ///   `APHRODY_AI_CHAT_BASE_URL` and its aliases), `APHRODY_JEV_ENGINE_MODEL` (default `local`),
    ///   `APHRODY_JEV_ENGINE_KEY` (optional).
    ///
    /// In the two remote modes, `JEFF_BASE_URL` (+ `JEFF_API_KEY`) and an
    /// explicit `APHRODY_JEV_ENGINE_URL` add the jeff and native fallbacks.
    ///
    /// # Errors
    /// [`JevError::NoBackend`] when nothing is configured, or
    /// [`JevError::Config`] when the selected mode lacks its credentials —
    /// including mode `aphrody` with no `APHRODY_JEV_ENGINE_URL`, no
    /// `APHRODY_AI_CHAT_BASE_URL` (or alias). Product discovery belongs to the caller.
    pub fn from_env() -> Result<Self, JevError> {
        Self::from_environment(|name| std::env::var(name).ok().filter(|v| !v.trim().is_empty()))
    }

    /// Build with a product-selected local chat endpoint; no host discovery runs here.
    /// `APHRODY_JEV_ENGINE_URL` takes precedence over the injected endpoint.
    ///
    /// # Errors
    /// [`JevError::NoBackend`] or [`JevError::Config`] for missing or invalid configuration.
    pub fn from_env_with_native_endpoint(endpoint: Option<&str>) -> Result<Self, JevError> {
        Self::from_environment_with_native_endpoint(
            |name| std::env::var(name).ok().filter(|v| !v.trim().is_empty()),
            endpoint,
        )
    }

    fn from_environment(var: impl Fn(&str) -> Option<String>) -> Result<Self, JevError> {
        Self::from_environment_with_native_endpoint(var, None)
    }

    /// Build from caller-supplied settings, including externally resolved credentials.
    /// The caller owns secret-file access and product endpoint discovery.
    ///
    /// # Errors
    /// [`JevError::NoBackend`] or [`JevError::Config`] for missing or invalid configuration.
    pub fn from_settings(
        settings: impl Fn(&str) -> Option<String>,
        native_endpoint: Option<&str>,
    ) -> Result<Self, JevError> {
        Self::from_environment_with_native_endpoint(settings, native_endpoint)
    }

    fn from_environment_with_native_endpoint(
        var: impl Fn(&str) -> Option<String>,
        endpoint: Option<&str>,
    ) -> Result<Self, JevError> {
        let native = |required: bool| -> Result<Option<NativeEngine>, JevError> {
            let explicit = var("APHRODY_JEV_ENGINE_URL");
            if explicit.is_none() && endpoint.is_none() && !required {
                return Ok(None);
            }
            let Some(url) = explicit
                .or_else(|| endpoint.map(str::to_owned))
                .or_else(|| var("APHRODY_AI_CHAT_BASE_URL"))
                .or_else(|| var("APHRODY_OSS_BASE_URL"))
                .or_else(|| var("APHRODY_LOCAL_MODEL_URL"))
            else {
                return Err(JevError::Config(
                    "mode aphrody requires a native engine: set APHRODY_JEV_ENGINE_URL, \
                     APHRODY_AI_CHAT_BASE_URL, or inject the product-selected chat endpoint"
                        .to_string(),
                ));
            };
            NativeEngine::new(
                &url,
                var("APHRODY_JEV_ENGINE_MODEL").unwrap_or_else(|| "local".into()),
                var("APHRODY_JEV_ENGINE_KEY"),
            )
            .map(Some)
        };
        let local = var("JEFF_BASE_URL")
            .map(|base| Endpoint::local(&base, var("JEFF_API_KEY")))
            .transpose()?;
        let mode = match var("APHRODY_JEV_MODE") {
            Some(mode) => mode.parse()?,
            None if var("TYPESAFE_API_KEY").is_some() => JevMode::ApiKey,
            None if var("CLOUDFLARE_API_TOKEN").is_some() => JevMode::Keyless,
            None if var("APHRODY_JEV_ENGINE_URL").is_some() || endpoint.is_some() => {
                JevMode::Aphrody
            }
            None if local.is_some() => {
                return Self::new(None, None, local, RoutingPolicy::default());
            }
            None => return Err(JevError::NoBackend),
        };
        let missing = |what: &str| JevError::Config(format!("mode {mode} requires {what}"));
        let saas = var("TYPESAFE_API_KEY")
            .map(|key| {
                Endpoint::saas(
                    &var("TYPESAFE_BASE_URL").unwrap_or_else(|| SAAS_BASE_URL.into()),
                    key,
                )
            })
            .transpose()?;
        let edge = match (var("CLOUDFLARE_ACCOUNT_ID"), var("CLOUDFLARE_API_TOKEN")) {
            (Some(account), Some(token)) => Some(Endpoint::edge(
                &var("CLOUDFLARE_API_BASE_URL").unwrap_or_else(|| CLOUDFLARE_BASE_URL.into()),
                account,
                token,
            )?),
            _ => None,
        };
        let policy = RoutingPolicy::default();
        let router = match mode {
            JevMode::Aphrody => {
                let engine = native(true)?.ok_or_else(|| missing("a native engine"))?;
                return Self::aphrody(engine, policy);
            }
            JevMode::Keyless => {
                let edge =
                    edge.ok_or_else(|| missing("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN"))?;
                Self::new(None, Some(edge), local, policy)?
            }
            JevMode::ApiKey => {
                let saas = saas.ok_or_else(|| missing("TYPESAFE_API_KEY"))?;
                Self::new(Some(saas), edge, local, policy)?
            }
        };
        Ok(match native(false)? {
            Some(engine) => router.with_native(engine),
            None => router,
        })
    }

    /// Current SaaS rolling P99, if enough samples exist.
    pub async fn saas_p99(&self) -> Option<Duration> {
        self.health.lock().await.p99(self.policy.min_samples)
    }

    /// Validate, route, fail over if needed, and validate the answers.
    ///
    /// # Errors
    /// See [`JevError`]; a non-conforming response is never accepted.
    pub async fn decide(&self, request: &Request) -> Result<Decision, JevError> {
        check_request(request)?;
        let tokens = request.estimated_tokens();
        let (primary, skipped) = self.primary(tokens).await?;

        let mut failover = skipped.map(|(from, reason)| Failover {
            from,
            to: primary,
            reason,
        });
        if let Some(event) = &failover {
            log_failover(event);
        }

        match self.attempt(primary, request).await? {
            Attempt::Done(response, latency) => Ok(Decision {
                response,
                served_by: primary,
                latency,
                failover,
            }),
            Attempt::Unavailable(reason) => {
                let fallback = self.fallback_for(primary)?;
                let event = Failover {
                    from: primary,
                    to: fallback,
                    reason,
                };
                log_failover(&event);
                failover = Some(event);
                match self.attempt(fallback, request).await? {
                    Attempt::Done(response, latency) => Ok(Decision {
                        response,
                        served_by: fallback,
                        latency,
                        failover,
                    }),
                    Attempt::Unavailable(reason) => Err(JevError::Unavailable(format!(
                        "{primary}: {}; {fallback}: {reason}",
                        failover.map(|f| f.reason).unwrap_or_default()
                    ))),
                }
            }
        }
    }

    /// Choose the primary backend; the second value records a routing-time
    /// skip of the SaaS for a degraded P99.
    async fn primary(
        &self,
        tokens: usize,
    ) -> Result<(Backend, Option<(Backend, String)>), JevError> {
        if self.edge.is_some()
            && tokens >= self.policy.edge_min_tokens
            && tokens <= EDGE_CONTEXT_TOKENS
        {
            return Ok((Backend::Edge, None));
        }
        if self.saas.is_some() {
            let mut health = self.health.lock().await;
            health.requests += 1;
            let degraded = health
                .p99(self.policy.min_samples)
                .filter(|p| *p > self.policy.p99_budget);
            let probe = health.requests % self.policy.probe_every.max(1) == 0;
            drop(health);
            return match (degraded, self.fallback_for(Backend::Saas).ok(), probe) {
                (Some(p99), Some(fallback), false) => Ok((
                    fallback,
                    Some((
                        Backend::Saas,
                        format!("p99 {}ms over budget", p99.as_millis()),
                    )),
                )),
                _ => Ok((Backend::Saas, None)),
            };
        }
        if self.edge.is_some() && tokens <= EDGE_CONTEXT_TOKENS {
            return Ok((Backend::Edge, None));
        }
        if self.local.is_some() {
            return Ok((Backend::Local, None));
        }
        if self.native.is_some() {
            return Ok((Backend::Native, None));
        }
        Err(JevError::TooLarge { tokens })
    }

    fn fallback_for(&self, primary: Backend) -> Result<Backend, JevError> {
        match primary {
            Backend::Saas | Backend::Edge if self.local.is_some() => Ok(Backend::Local),
            Backend::Saas | Backend::Edge | Backend::Local if self.native.is_some() => {
                Ok(Backend::Native)
            }
            _ => Err(JevError::Unavailable(format!(
                "{primary} failed and no fallback is configured"
            ))),
        }
    }

    fn endpoint(&self, backend: Backend) -> Option<&Endpoint> {
        match backend {
            Backend::Saas => self.saas.as_ref(),
            Backend::Edge => self.edge.as_ref(),
            Backend::Local => self.local.as_ref(),
            Backend::Native => None,
        }
    }

    async fn attempt_native(&self, request: &Request) -> Result<Attempt, JevError> {
        let engine = self.native.as_ref().ok_or(JevError::NoBackend)?;
        let started = Instant::now();
        match engine.decide(request, self.policy.local_timeout).await {
            Ok(response) => {
                check_response(request, &response)?;
                Ok(Attempt::Done(response, started.elapsed()))
            }
            Err(JevError::Unavailable(reason)) => Ok(Attempt::Unavailable(reason)),
            Err(error) => Err(error),
        }
    }

    async fn attempt(&self, backend: Backend, request: &Request) -> Result<Attempt, JevError> {
        if backend == Backend::Native {
            return self.attempt_native(request).await;
        }
        let endpoint = self.endpoint(backend).ok_or(JevError::NoBackend)?;
        let timeout = match backend {
            Backend::Local | Backend::Native => self.policy.local_timeout,
            Backend::Saas | Backend::Edge => self.policy.remote_timeout,
        };
        let mut call = self.http.post(endpoint.url(backend)?).timeout(timeout);
        if let Some(token) = &endpoint.token {
            call = call.bearer_auth(token);
        }
        call = match backend {
            Backend::Edge => call.json(&serde_json::json!({
                "model": EDGE_MODEL,
                "input": { "state": request.state, "questions": request.questions },
            })),
            Backend::Saas | Backend::Local | Backend::Native => call.json(request),
        };

        let started = Instant::now();
        let reply = match call.send().await {
            Ok(reply) => reply,
            Err(e) if e.is_timeout() => {
                return Ok(Attempt::Unavailable(format!(
                    "timeout after {}ms",
                    timeout.as_millis()
                )));
            }
            Err(_) => return Ok(Attempt::Unavailable("transport_error".into())),
        };
        let status = reply.status();
        let body = match reply.bytes().await {
            Ok(body) => body,
            Err(_) => return Ok(Attempt::Unavailable("response_body_error".into())),
        };
        let latency = started.elapsed();

        if backend == Backend::Saas {
            self.health
                .lock()
                .await
                .record(latency, self.policy.window.max(1));
        }
        if status.is_server_error() {
            return Ok(Attempt::Unavailable(format!("http {}", status.as_u16())));
        }
        if !status.is_success() {
            return Err(JevError::Rejected {
                backend,
                status: status.as_u16(),
                body: String::from_utf8_lossy(&body).chars().take(512).collect(),
            });
        }
        let response = parse_response(backend, &body)?;
        check_response(request, &response)?;
        Ok(Attempt::Done(response, latency))
    }
}

/// Cloudflare wraps model output in its API envelope.
#[derive(Deserialize)]
struct EdgeEnvelope {
    result: Response,
    #[serde(default = "yes")]
    success: bool,
}

const fn yes() -> bool {
    true
}

fn parse_response(backend: Backend, body: &[u8]) -> Result<Response, JevError> {
    let bad = |e: serde_json::Error| JevError::Format(format!("{backend}: {e}"));
    if backend == Backend::Edge {
        let value: serde_json::Value = serde_json::from_slice(body).map_err(bad)?;
        if value.get("result").is_some() {
            let envelope: EdgeEnvelope = serde_json::from_value(value).map_err(bad)?;
            if !envelope.success {
                return Err(JevError::Format(
                    "edge: envelope reports success=false".into(),
                ));
            }
            return Ok(envelope.result);
        }
        return serde_json::from_value(value).map_err(bad);
    }
    serde_json::from_slice(body).map_err(bad)
}

fn log_failover(event: &Failover) {
    tracing::warn!(
        target: FAILOVER_TARGET,
        from = %event.from,
        to = %event.to,
        reason = %event.reason,
        "jev failover"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_local_backend_does_not_require_hosted_credentials() {
        let router = super::JevRouter::from_environment(|name| {
            (name == "JEFF_BASE_URL").then(|| "http://127.0.0.1:8790".into())
        })
        .unwrap();
        assert!(router.local.is_some());
        assert!(router.saas.is_none());
        assert!(router.edge.is_none());
        assert!(router.native.is_none());
    }

    #[test]
    fn explicit_remote_mode_never_silently_selects_the_local_backend() {
        let result = super::JevRouter::from_environment(|name| match name {
            "APHRODY_JEV_MODE" => Some("api-key".into()),
            "JEFF_BASE_URL" => Some("http://127.0.0.1:8790".into()),
            _ => None,
        });
        assert!(
            matches!(result, Err(super::JevError::Config(message)) if message.contains("requires TYPESAFE_API_KEY"))
        );
    }

    #[test]
    fn injected_native_endpoint_does_not_require_host_discovery() {
        let router = JevRouter::from_environment_with_native_endpoint(
            |_| None,
            Some("http://example.invalid/v1"),
        )
        .unwrap();
        assert!(router.native.is_some());
        assert!(router.saas.is_none());
    }

    #[test]
    fn p99_uses_nearest_rank() {
        let mut health = Health::default();
        for ms in 1..=100 {
            health.record(Duration::from_millis(ms), 100);
        }
        assert_eq!(health.p99(20), Some(Duration::from_millis(99)));
        assert_eq!(Health::default().p99(20), None);
    }

    #[test]
    fn window_evicts_oldest_sample() {
        let mut health = Health::default();
        for ms in [900, 1, 1] {
            health.record(Duration::from_millis(ms), 2);
        }
        assert_eq!(health.p99(1), Some(Duration::from_millis(1)));
    }

    #[test]
    fn endpoint_urls_and_redaction() {
        let edge = Endpoint::edge("https://api.cloudflare.com", "acct", "secret").unwrap();
        assert_eq!(
            edge.url(Backend::Edge).unwrap().as_str(),
            "https://api.cloudflare.com/client/v4/accounts/acct/ai/run"
        );
        let saas = Endpoint::saas("https://api.typesafe.ai/", "secret").unwrap();
        assert_eq!(
            saas.url(Backend::Saas).unwrap().as_str(),
            "https://api.typesafe.ai/v1/systemone"
        );
        assert!(!format!("{edge:?}").contains("secret"));
    }
}
