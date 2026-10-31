//! Owner accounts (Google, Microsoft): OAuth 2.0 authorization code + PKCE against a Web client.
//!
//! * [`OwnerOAuth::begin`] returns the consent URL (offline access, `prompt=consent` so Google issues a
//!   refresh token, S256 challenge, random `state` held in memory for ten minutes).
//! * [`OwnerOAuth::complete`] exchanges the code, checks the account against `APHRODY_GOOGLE_OWNER_EMAIL`
//!   when set, and seals `{refresh_token, email, scopes}` with [`SealedFile`].
//! * [`OwnerOAuth::access_token`] refreshes silently and caches the access token.
//!
//! The client comes from `APHRODY_GOOGLE_OAUTH_CLIENT_ID` / `APHRODY_GOOGLE_OAUTH_CLIENT_SECRET`
//! (provisioned from Secret Manager `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` into the protected env file);
//! its authorized redirect URI must include `APHRODY_GOOGLE_OAUTH_REDIRECT`
//! (default `https://aphrody.com/api/google/callback`).

use super::store::SealedFile;
use super::{Cached, Error, HTTP, Result, check, env, now};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::Mutex;

/// Default redirect served by the backend (Google).
pub const DEFAULT_REDIRECT: &str = "https://aphrody.com/api/google/callback";
/// Default redirect served by the backend (Microsoft).
pub const DEFAULT_MICROSOFT_REDIRECT: &str = "https://aphrody.com/api/microsoft/callback";

/// Identity provider endpoints and request shape.
#[derive(Debug, Clone)]
pub struct Provider {
    /// `google` or `microsoft`.
    pub name: &'static str,
    /// Authorization endpoint.
    pub auth_uri: String,
    /// Token endpoint.
    pub token_uri: String,
    /// Revocation endpoint (Google only).
    pub revoke_uri: Option<String>,
    /// Requested scopes.
    pub scopes: Vec<String>,
    /// Extra authorization parameters.
    pub extra: Vec<(&'static str, &'static str)>,
}

impl Provider {
    /// Google OAuth 2.0 (offline access, forced consent so a refresh token is issued).
    pub fn google() -> Self {
        Self {
            name: "google",
            auth_uri: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_uri: "https://oauth2.googleapis.com/token".into(),
            revoke_uri: Some("https://oauth2.googleapis.com/revoke".into()),
            scopes: owner_scopes(),
            extra: vec![("access_type", "offline"), ("prompt", "consent"), ("include_granted_scopes", "true")],
        }
    }
    /// Microsoft identity platform v2 (`tenant`: `common`, `consumers`, `organizations` or a tenant id),
    /// Microsoft Graph delegated permissions; `offline_access` yields the refresh token.
    pub fn microsoft(tenant: &str) -> Self {
        let base = format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0");
        Self {
            name: "microsoft",
            auth_uri: format!("{base}/authorize"),
            token_uri: format!("{base}/token"),
            revoke_uri: None,
            scopes: [
                "openid", "email", "profile", "offline_access", "User.Read", "Files.ReadWrite", "Mail.ReadWrite",
                "Mail.Send", "Calendars.ReadWrite", "Contacts.ReadWrite", "Tasks.ReadWrite",
            ]
            .iter()
            .map(|s| (*s).to_owned())
            .collect(),
            extra: vec![("prompt", "select_account"), ("response_mode", "query")],
        }
    }
}
/// Default protected state directory on the VPS.
pub const DEFAULT_STATE_DIR: &str = "/etc/aphrody/google";

const G: &str = "https://www.googleapis.com/auth/";

/// Scopes requested for the owner: identity, Drive, Gmail, Calendar, YouTube, Contacts, Photos.
pub fn owner_scopes() -> Vec<String> {
    let mut v: Vec<String> = ["openid", "email", "profile"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    for s in [
        "drive",
        "gmail.modify",
        "calendar",
        "youtube",
        "contacts",
        "photoslibrary.appendonly",
        "photospicker.mediaitems.readonly",
    ] {
        v.push(format!("{G}{s}"));
    }
    v
}

/// Web OAuth client.
#[derive(Clone)]
pub struct ClientConfig {
    /// Client id.
    pub client_id: String,
    /// Client secret (Web clients have one).
    pub client_secret: Option<String>,
    /// Registered redirect URI.
    pub redirect_uri: String,
}

impl std::fmt::Debug for ClientConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ClientConfig")
            .field("client_id", &self.client_id)
            .field("client_secret", &self.client_secret.as_ref().map(|_| "<redacted>"))
            .field("redirect_uri", &self.redirect_uri)
            .finish()
    }
}

impl ClientConfig {
    /// From the `APHRODY_GOOGLE_OAUTH_*` keys; `None` when no client id is configured.
    pub fn from_env() -> Option<Self> {
        Self::from_env_prefix("APHRODY_GOOGLE_OAUTH", DEFAULT_REDIRECT)
    }
    /// From `<prefix>_CLIENT_ID`, `<prefix>_CLIENT_SECRET`, `<prefix>_REDIRECT`.
    pub fn from_env_prefix(prefix: &str, default_redirect: &str) -> Option<Self> {
        Some(Self {
            client_id: env(&format!("{prefix}_CLIENT_ID"))?,
            client_secret: env(&format!("{prefix}_CLIENT_SECRET")),
            redirect_uri: env(&format!("{prefix}_REDIRECT")).unwrap_or_else(|| default_redirect.to_owned()),
        })
    }
}

/// What is sealed at rest.
#[derive(Serialize, Deserialize)]
struct Stored {
    refresh_token: String,
    email: Option<String>,
    scopes: Vec<String>,
    created: u64,
}

/// Public view of the linked account.
#[derive(Debug, Clone, Serialize)]
pub struct OwnerStatus {
    /// A client id is configured.
    pub client_configured: bool,
    /// Redirect URI in use.
    pub redirect_uri: Option<String>,
    /// A refresh token is sealed.
    pub linked: bool,
    /// Linked account email.
    pub email: Option<String>,
    /// Granted scopes.
    pub scopes: Vec<String>,
    /// Unix time of the link.
    pub linked_at: Option<u64>,
}

struct Pending {
    verifier: String,
    created: u64,
}

/// Owner account broker.
pub struct OwnerOAuth {
    provider: Provider,
    client: Option<ClientConfig>,
    store: SealedFile,
    owner_email: Option<String>,
    pending: Mutex<HashMap<String, Pending>>,
    cache: Mutex<Option<Cached>>,
}

impl std::fmt::Debug for OwnerOAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OwnerOAuth")
            .field("client", &self.client)
            .field("store", &self.store.path())
            .finish_non_exhaustive()
    }
}

fn random_urlsafe(n: usize) -> Result<String> {
    let mut b = vec![0u8; n];
    getrandom::fill(&mut b).map_err(|e| Error::OAuth(format!("os randomness: {e}")))?;
    Ok(URL_SAFE_NO_PAD.encode(b))
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
}

/// `email` claim of an ID token received directly from Google's token endpoint over TLS
/// (OIDC Core 3.1.3.7 allows skipping signature validation in that case).
fn id_token_email(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let raw = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    if v["email_verified"].as_bool() == Some(false) {
        return None;
    }
    v["email"]
        .as_str()
        .or_else(|| v["preferred_username"].as_str())
        .map(str::to_lowercase)
}

impl OwnerOAuth {
    /// Google owner from the environment: `APHRODY_GOOGLE_OAUTH_*`, `APHRODY_GOOGLE_STATE_DIR`,
    /// `APHRODY_GOOGLE_OWNER_EMAIL`.
    pub fn from_env() -> Self {
        let dir = PathBuf::from(
            env("APHRODY_GOOGLE_STATE_DIR").unwrap_or_else(|| DEFAULT_STATE_DIR.to_owned()),
        );
        Self::new(
            Provider::google(),
            ClientConfig::from_env(),
            SealedFile::new(dir.join("owner-token.sealed"), dir.join("owner-token.key")),
            env("APHRODY_GOOGLE_OWNER_EMAIL").map(|e| e.to_lowercase()),
        )
    }
    /// Microsoft owner from the environment: `APHRODY_MICROSOFT_OAUTH_*`, `APHRODY_MICROSOFT_TENANT`
    /// (default `common`), `APHRODY_MICROSOFT_OWNER_EMAIL`; sealed beside the Google token.
    pub fn microsoft_from_env() -> Self {
        let dir = PathBuf::from(
            env("APHRODY_GOOGLE_STATE_DIR").unwrap_or_else(|| DEFAULT_STATE_DIR.to_owned()),
        );
        let tenant = env("APHRODY_MICROSOFT_TENANT").unwrap_or_else(|| "common".to_owned());
        Self::new(
            Provider::microsoft(&tenant),
            ClientConfig::from_env_prefix("APHRODY_MICROSOFT_OAUTH", DEFAULT_MICROSOFT_REDIRECT),
            SealedFile::new(dir.join("microsoft-owner-token.sealed"), dir.join("owner-token.key")),
            env("APHRODY_MICROSOFT_OWNER_EMAIL").map(|e| e.to_lowercase()),
        )
    }
    /// Provider of this broker.
    pub fn provider(&self) -> &Provider {
        &self.provider
    }
    /// Explicit construction.
    pub fn new(provider: Provider, client: Option<ClientConfig>, store: SealedFile, owner_email: Option<String>) -> Self {
        Self {
            provider,
            client,
            store,
            owner_email,
            pending: Mutex::new(HashMap::new()),
            cache: Mutex::new(None),
        }
    }
    fn client(&self) -> Result<&ClientConfig> {
        self.client.as_ref().ok_or_else(|| {
            Error::Config(format!("OAuth client for {} is not configured", self.provider.name))
        })
    }

    /// Consent URL for the owner (and remember its `state`).
    pub async fn begin(&self) -> Result<String> {
        let c = self.client()?;
        let state = random_urlsafe(24)?;
        let verifier = random_urlsafe(32)?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut pending = self.pending.lock().await;
        let cutoff = now().saturating_sub(600);
        pending.retain(|_, p| p.created >= cutoff);
        pending.insert(
            state.clone(),
            Pending {
                verifier,
                created: now(),
            },
        );
        let mut url = url::Url::parse(&self.provider.auth_uri).map_err(|e| Error::OAuth(e.to_string()))?;
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("client_id", &c.client_id)
                .append_pair("redirect_uri", &c.redirect_uri)
                .append_pair("response_type", "code")
                .append_pair("scope", &self.provider.scopes.join(" "));
            for (k, v) in &self.provider.extra {
                q.append_pair(k, v);
            }
            q.append_pair("code_challenge", &challenge)
                .append_pair("code_challenge_method", "S256")
                .append_pair("state", &state);
            if let Some(e) = &self.owner_email {
                q.append_pair("login_hint", e);
            }
        }
        Ok(url.into())
    }

    /// Finish the flow from the redirect's `state` and `code`.
    pub async fn complete(&self, state: &str, code: &str) -> Result<OwnerStatus> {
        let c = self.client()?;
        let pending = self
            .pending
            .lock()
            .await
            .remove(state)
            .filter(|p| p.created + 600 >= now())
            .ok_or_else(|| Error::OAuth("unknown or expired state".into()))?;
        let mut form = vec![
            ("grant_type", "authorization_code"),
            ("code", code),
            ("code_verifier", pending.verifier.as_str()),
            ("redirect_uri", c.redirect_uri.as_str()),
            ("client_id", c.client_id.as_str()),
        ];
        if let Some(s) = &c.client_secret {
            form.push(("client_secret", s.as_str()));
        }
        let resp = HTTP.post(&self.provider.token_uri).form(&form).send().await?;
        let t: TokenResponse = check(resp).await?.json().await?;
        let email = t.id_token.as_deref().and_then(id_token_email);
        if let Some(owner) = &self.owner_email {
            if email.as_deref() != Some(owner.as_str()) {
                // Do not keep tokens of another account.
                if let Some(revoke) = &self.provider.revoke_uri {
                    let _ = HTTP
                        .post(revoke)
                        .form(&[("token", t.access_token.as_str())])
                        .send()
                        .await;
                }
                return Err(Error::OAuth("signed-in account is not the configured owner".into()));
            }
        }
        let refresh_token = t.refresh_token.ok_or_else(|| {
            Error::OAuth(format!("{} returned no refresh token (consent was not offline)", self.provider.name))
        })?;
        let stored = Stored {
            refresh_token,
            email,
            scopes: t
                .scope
                .unwrap_or_default()
                .split_whitespace()
                .map(str::to_owned)
                .collect(),
            created: now(),
        };
        self.store.save(&stored)?;
        *self.cache.lock().await = Some(Cached {
            token: t.access_token,
            expires_at: now() + t.expires_in.unwrap_or(3600),
        });
        self.status()
    }

    /// Valid access token for the owner, refreshing when needed.
    pub async fn access_token(&self) -> Result<String> {
        let mut cache = self.cache.lock().await;
        if let Some(c) = cache.as_ref().filter(|c| c.fresh()) {
            return Ok(c.token.clone());
        }
        let fresh = self.refresh_inner().await?;
        let token = fresh.token.clone();
        *cache = Some(fresh);
        Ok(token)
    }

    /// Force a refresh; returns the new token lifetime in seconds.
    pub async fn refresh(&self) -> Result<u64> {
        let mut cache = self.cache.lock().await;
        let fresh = self.refresh_inner().await?;
        let ttl = fresh.expires_at.saturating_sub(now());
        *cache = Some(fresh);
        Ok(ttl)
    }

    async fn refresh_inner(&self) -> Result<Cached> {
        let c = self.client()?;
        let stored: Stored = self
            .store
            .load()?
            .ok_or_else(|| Error::OAuth("owner account is not linked".into()))?;
        let mut form = vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", stored.refresh_token.as_str()),
            ("client_id", c.client_id.as_str()),
        ];
        if let Some(s) = &c.client_secret {
            form.push(("client_secret", s.as_str()));
        }
        let resp = HTTP.post(&self.provider.token_uri).form(&form).send().await?;
        let t: TokenResponse = check(resp).await?.json().await?;
        if let Some(rotated) = t.refresh_token.filter(|r| *r != stored.refresh_token) {
            self.store.save(&Stored {
                refresh_token: rotated,
                ..stored
            })?;
        }
        Ok(Cached {
            token: t.access_token,
            expires_at: now() + t.expires_in.unwrap_or(3600),
        })
    }

    /// Revoke at the provider (when it has a revocation endpoint) and forget the sealed token.
    pub async fn unlink(&self) -> Result<()> {
        if let (Some(stored), Some(revoke)) = (self.store.load::<Stored>()?, &self.provider.revoke_uri) {
            let _ = HTTP
                .post(revoke)
                .form(&[("token", stored.refresh_token.as_str())])
                .send()
                .await;
        }
        *self.cache.lock().await = None;
        self.store.clear()
    }

    /// rclone remote section (`type = drive` / `onedrive`) for mounting the owner's cloud files in a session's file
    /// manager. Contains the client secret and the refresh token: write it 0600 for the session's own user only.
    pub async fn rclone_remote(&self, name: &str) -> Result<String> {
        let c = self.client()?;
        let stored: Stored = self
            .store
            .load()?
            .ok_or_else(|| Error::OAuth("owner account is not linked".into()))?;
        let access = self.access_token().await?;
        let token = serde_json::json!({
            "access_token": access.clone(),
            "token_type": "Bearer",
            "refresh_token": stored.refresh_token,
            "expiry": "2000-01-01T00:00:00Z",
        });
        let kind = if self.provider.name == "microsoft" { "onedrive" } else { "drive" };
        let mut s = format!("[{name}]\ntype = {kind}\nclient_id = {}\n", c.client_id);
        if let Some(sec) = &c.client_secret {
            s.push_str(&format!("client_secret = {sec}\n"));
        }
        if kind == "drive" {
            s.push_str("scope = drive\n");
        } else {
            let resp = HTTP
                .get("https://graph.microsoft.com/v1.0/me/drive?$select=id,driveType")
                .bearer_auth(&access)
                .send()
                .await?;
            let d: serde_json::Value = check(resp).await?.json().await?;
            s.push_str(&format!(
                "drive_id = {}\ndrive_type = {}\n",
                d["id"].as_str().unwrap_or_default(),
                d["driveType"].as_str().unwrap_or("personal")
            ));
        }
        s.push_str(&format!("token = {token}\n"));
        Ok(s)
    }

    /// Linked-account status (no token material).
    pub fn status(&self) -> Result<OwnerStatus> {
        let stored: Option<Stored> = self.store.load().unwrap_or(None);
        Ok(OwnerStatus {
            client_configured: self.client.is_some(),
            redirect_uri: self.client.as_ref().map(|c| c.redirect_uri.clone()),
            linked: stored.is_some(),
            email: stored.as_ref().and_then(|s| s.email.clone()),
            scopes: stored.as_ref().map(|s| s.scopes.clone()).unwrap_or_default(),
            linked_at: stored.as_ref().map(|s| s.created),
        })
    }
}
