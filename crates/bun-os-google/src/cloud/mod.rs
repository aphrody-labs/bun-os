//! Google Cloud and owner-account access for the Bun OS backend.
//!
//! * [`adc::Adc`]: keyless service-account tokens. Application Default Credentials are read from
//!   `GOOGLE_APPLICATION_CREDENTIALS` (VPS: `/etc/aphrody/google/adc.json`, an
//!   `impersonated_service_account` whose source mints tokens for `aphrody-bot@aphrody.iam.gserviceaccount.com`
//!   through the IAM Credentials `generateAccessToken` API). Plain `service_account` and `authorized_user`
//!   files work too.
//! * [`oauth::OwnerOAuth`]: the owner's Google account. Authorization code + PKCE (S256) against a Web
//!   OAuth client, offline access, the refresh token encrypted at rest with AES-256-GCM
//!   ([`store::SealedFile`]), silent refresh.
//! * [`api`]: REST calls used by the sessions and the backend (Drive, Gmail, Calendar, YouTube, People,
//!   Cloud Storage, userinfo).
//! * `server` feature: axum routes under `/api/google/*` and the `bun-os-google serve` loopback service.
//!
//! Configuration keys (environment; on the VPS from `/etc/aphrody/google.env`, root:ubuntu 0640):
//! `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `APHRODY_GOOGLE_SA`,
//! `APHRODY_GOOGLE_OAUTH_CLIENT_ID`, `APHRODY_GOOGLE_OAUTH_CLIENT_SECRET`, `APHRODY_GOOGLE_OAUTH_REDIRECT`,
//! `APHRODY_GOOGLE_OWNER_EMAIL`, `APHRODY_GOOGLE_STATE_DIR`, `APHRODY_GOOGLE_ADMIN_TOKEN`; Microsoft Graph owner:
//! `APHRODY_MICROSOFT_OAUTH_CLIENT_ID`, `APHRODY_MICROSOFT_OAUTH_CLIENT_SECRET`, `APHRODY_MICROSOFT_OAUTH_REDIRECT`,
//! `APHRODY_MICROSOFT_TENANT`, `APHRODY_MICROSOFT_OWNER_EMAIL`.
//! No value is ever logged; `Debug` impls redact secrets.

pub mod adc;
pub mod api;
pub mod oauth;
#[cfg(feature = "server")]
pub mod server;
pub mod store;

use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Errors of the cloud layer. Messages never contain token material.
#[derive(Debug)]
pub enum Error {
    /// Missing or unreadable configuration.
    Config(String),
    /// Transport failure.
    Http(String),
    /// Non-2xx answer from a Google API (status, API message).
    Api(u16, String),
    /// Sealed-store failure.
    Store(String),
    /// OAuth protocol failure (unknown state, denied consent, wrong account).
    OAuth(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Config(m) => write!(f, "configuration: {m}"),
            Self::Http(m) => write!(f, "http: {m}"),
            Self::Api(s, m) => write!(f, "google api {s}: {m}"),
            Self::Store(m) => write!(f, "store: {m}"),
            Self::OAuth(m) => write!(f, "oauth: {m}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        // reqwest errors may carry the URL; ours never put tokens in URLs.
        Self::Http(e.without_url().to_string())
    }
}

/// Result alias.
pub type Result<T> = std::result::Result<T, Error>;

/// Default project of the Bun OS backend.
pub const PROJECT: &str = "aphrody";
/// Service account the backend acts as.
pub const SERVICE_ACCOUNT: &str = "aphrody-bot@aphrody.iam.gserviceaccount.com";
/// Broad scope for service-account calls (IAM roles decide what is allowed).
pub const SCOPE_CLOUD: &str = "https://www.googleapis.com/auth/cloud-platform";

/// Shared HTTP client (rustls with the ring provider, 60 s timeout).
pub(crate) static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .user_agent("bun-os-google/1")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

pub(crate) fn env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}

/// Turn a non-2xx response into [`Error::Api`] with Google's `error.message` (or `error_description`).
pub(crate) async fn check(resp: reqwest::Response) -> Result<reqwest::Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
    let msg = v["error"]["message"]
        .as_str()
        .or_else(|| v["error_description"].as_str())
        .or_else(|| v["error"].as_str())
        .unwrap_or("no error message")
        .to_owned();
    Err(Error::Api(status.as_u16(), msg))
}

/// Constant-time byte comparison (admin token checks).
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A cached bearer token.
#[derive(Clone)]
pub(crate) struct Cached {
    pub token: String,
    pub expires_at: u64,
}

impl Cached {
    /// Valid for at least another minute.
    pub fn fresh(&self) -> bool {
        self.expires_at > now() + 60
    }
}

impl std::fmt::Debug for Cached {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Cached")
            .field("token", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}
