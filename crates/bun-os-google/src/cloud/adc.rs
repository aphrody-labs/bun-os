//! Application Default Credentials: keyless service-account tokens for the backend.
//!
//! Supported files (<https://google.aip.dev/auth/4110>):
//! * `impersonated_service_account`: the source credential (a service-account key or an authorized user)
//!   mints a `cloud-platform` token, then IAM Credentials `generateAccessToken` returns a short-lived token
//!   for the target account with the requested scopes. This is how the VPS acts as `aphrody-bot`.
//! * `service_account`: RS256 JWT bearer grant (RFC 7523) against `token_uri`.
//! * `authorized_user`: refresh-token grant (`gcloud auth application-default login`).
//!
//! Tokens are cached per scope set until one minute before expiry.

use super::{Cached, Error, HTTP, Result, SCOPE_CLOUD, check, env, now};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

const TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
/// Protected location on the VPS (root:ubuntu 0640).
pub const VPS_ADC: &str = "/etc/aphrody/google/adc.json";

/// A parsed credential file.
#[derive(Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Credentials {
    /// Service-account key.
    ServiceAccount {
        /// `...@....iam.gserviceaccount.com`.
        client_email: String,
        /// PKCS#8 PEM.
        private_key: String,
        /// Token endpoint.
        #[serde(default)]
        token_uri: Option<String>,
    },
    /// User refresh token.
    AuthorizedUser {
        /// OAuth client id.
        client_id: String,
        /// OAuth client secret.
        client_secret: String,
        /// Refresh token.
        refresh_token: String,
    },
    /// Impersonation chain.
    ImpersonatedServiceAccount {
        /// `.../serviceAccounts/<email>:generateAccessToken`.
        service_account_impersonation_url: String,
        /// Delegation chain.
        #[serde(default)]
        delegates: Vec<String>,
        /// Credential that calls `generateAccessToken`.
        source_credentials: Box<Credentials>,
    },
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ServiceAccount { client_email, .. } => {
                write!(f, "ServiceAccount({client_email}, key: <redacted>)")
            }
            Self::AuthorizedUser { client_id, .. } => {
                write!(f, "AuthorizedUser({client_id}, tokens: <redacted>)")
            }
            Self::ImpersonatedServiceAccount {
                service_account_impersonation_url,
                source_credentials,
                ..
            } => write!(
                f,
                "Impersonated({} via {source_credentials:?})",
                target_from_url(service_account_impersonation_url).unwrap_or("?")
            ),
        }
    }
}

fn target_from_url(url: &str) -> Option<&str> {
    url.rsplit("/serviceAccounts/")
        .next()
        .and_then(|s| s.split(':').next())
}

impl Credentials {
    /// Identity tokens are issued for: the target of an impersonation, the key's email, or `user`.
    pub fn principal(&self) -> String {
        match self {
            Self::ServiceAccount { client_email, .. } => client_email.clone(),
            Self::AuthorizedUser { .. } => "authorized-user".into(),
            Self::ImpersonatedServiceAccount {
                service_account_impersonation_url,
                ..
            } => target_from_url(service_account_impersonation_url)
                .unwrap_or("unknown")
                .to_owned(),
        }
    }
    /// Kind label for status pages.
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::ServiceAccount { .. } => "service_account",
            Self::AuthorizedUser { .. } => "authorized_user",
            Self::ImpersonatedServiceAccount { .. } => "impersonated_service_account",
        }
    }
}

/// Where ADC is looked up: `GOOGLE_APPLICATION_CREDENTIALS`, the VPS protected file, then gcloud's
/// well-known `application_default_credentials.json`.
pub fn locate() -> Option<PathBuf> {
    if let Some(p) = env("GOOGLE_APPLICATION_CREDENTIALS") {
        return Some(p.into());
    }
    if Path::new(VPS_ADC).is_file() {
        return Some(VPS_ADC.into());
    }
    let base = if cfg!(windows) {
        env("APPDATA").map(|a| PathBuf::from(a).join("gcloud"))
    } else {
        env("HOME").map(|h| PathBuf::from(h).join(".config/gcloud"))
    }?;
    let p = base.join("application_default_credentials.json");
    p.is_file().then_some(p)
}

/// Token source over one credential file.
pub struct Adc {
    creds: Credentials,
    path: PathBuf,
    cache: Mutex<HashMap<String, Cached>>,
}

impl std::fmt::Debug for Adc {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Adc")
            .field("path", &self.path)
            .field("creds", &self.creds)
            .finish()
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateResponse {
    access_token: String,
}

#[derive(serde::Serialize)]
struct JwtClaims<'a> {
    iss: &'a str,
    scope: String,
    aud: &'a str,
    iat: u64,
    exp: u64,
}

impl Adc {
    /// Load from [`locate`].
    pub fn discover() -> Result<Self> {
        let path = locate().ok_or_else(|| {
            Error::Config("no Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS)".into())
        })?;
        Self::from_file(&path)
    }
    /// Load a credential file.
    pub fn from_file(path: &Path) -> Result<Self> {
        let raw = std::fs::read(path)
            .map_err(|e| Error::Config(format!("{}: {e}", path.display())))?;
        let creds: Credentials = serde_json::from_slice(&raw)
            .map_err(|e| Error::Config(format!("{}: {e}", path.display())))?;
        Ok(Self {
            creds,
            path: path.to_owned(),
            cache: Mutex::new(HashMap::new()),
        })
    }
    /// The credential.
    pub fn credentials(&self) -> &Credentials {
        &self.creds
    }
    /// File the credential came from.
    pub fn path(&self) -> &Path {
        &self.path
    }
    /// Access token for `scopes` (default: `cloud-platform`).
    pub async fn token(&self, scopes: &[&str]) -> Result<String> {
        let scopes: Vec<&str> = if scopes.is_empty() {
            vec![SCOPE_CLOUD]
        } else {
            scopes.to_vec()
        };
        let key = scopes.join(" ");
        let mut cache = self.cache.lock().await;
        if let Some(c) = cache.get(&key).filter(|c| c.fresh()) {
            return Ok(c.token.clone());
        }
        let fresh = mint(&self.creds, &scopes).await?;
        let token = fresh.token.clone();
        cache.insert(key, fresh);
        Ok(token)
    }
    /// Drop cached tokens (forces a refresh on the next call).
    pub async fn invalidate(&self) {
        self.cache.lock().await.clear();
    }
}

fn mint<'a>(
    creds: &'a Credentials,
    scopes: &'a [&'a str],
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Cached>> + Send + 'a>> {
    Box::pin(async move {
        match creds {
            Credentials::ServiceAccount {
                client_email,
                private_key,
                token_uri,
            } => {
                let aud = token_uri.as_deref().unwrap_or(TOKEN_URI);
                let iat = now();
                let claims = JwtClaims {
                    iss: client_email,
                    scope: scopes.join(" "),
                    aud,
                    iat,
                    exp: iat + 3600,
                };
                let key = jsonwebtoken::EncodingKey::from_rsa_pem(private_key.as_bytes())
                    .map_err(|e| Error::Config(format!("service-account key: {e}")))?;
                let jwt = jsonwebtoken::encode(
                    &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
                    &claims,
                    &key,
                )
                .map_err(|e| Error::Config(format!("jwt: {e}")))?;
                let resp = HTTP
                    .post(aud)
                    .form(&[
                        ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                        ("assertion", jwt.as_str()),
                    ])
                    .send()
                    .await?;
                let t: TokenResponse = check(resp).await?.json().await?;
                Ok(Cached {
                    token: t.access_token,
                    expires_at: now() + t.expires_in.unwrap_or(3600),
                })
            }
            Credentials::AuthorizedUser {
                client_id,
                client_secret,
                refresh_token,
            } => {
                let resp = HTTP
                    .post(TOKEN_URI)
                    .form(&[
                        ("grant_type", "refresh_token"),
                        ("client_id", client_id.as_str()),
                        ("client_secret", client_secret.as_str()),
                        ("refresh_token", refresh_token.as_str()),
                    ])
                    .send()
                    .await?;
                let t: TokenResponse = check(resp).await?.json().await?;
                Ok(Cached {
                    token: t.access_token,
                    expires_at: now() + t.expires_in.unwrap_or(3600),
                })
            }
            Credentials::ImpersonatedServiceAccount {
                service_account_impersonation_url,
                delegates,
                source_credentials,
            } => {
                let source = mint(source_credentials, &[SCOPE_CLOUD]).await?;
                let body = serde_json::json!({
                    "scope": scopes,
                    "delegates": delegates,
                    "lifetime": "3600s",
                });
                let resp = HTTP
                    .post(service_account_impersonation_url)
                    .bearer_auth(&source.token)
                    .json(&body)
                    .send()
                    .await?;
                let g: GenerateResponse = check(resp).await?.json().await?;
                Ok(Cached {
                    token: g.access_token,
                    expires_at: now() + 3540,
                })
            }
        }
    })
}
