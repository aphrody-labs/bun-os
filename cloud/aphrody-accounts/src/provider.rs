//! Identity providers, tenants, OAuth client configuration and endpoints.
//!
//! Endpoints verified 2026-10-29 against
//! <https://developers.google.com/identity/protocols/oauth2> and
//! <https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow>.

use serde::{Deserialize, Serialize};

/// Which identity platform an account lives on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    /// Google Account (OAuth 2.0 / OpenID Connect).
    Google,
    /// Microsoft account or Entra work/school account (Microsoft identity platform v2.0).
    Microsoft,
}

impl Provider {
    /// Stable lower-case name, also the account id prefix.
    pub const fn as_str(self) -> &'static str {
        match self {
            Provider::Google => "google",
            Provider::Microsoft => "microsoft",
        }
    }
    /// Parse `google` / `microsoft` (also `ms`, `entra`).
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "google" => Some(Provider::Google),
            "microsoft" | "ms" | "entra" | "msa" => Some(Provider::Microsoft),
            _ => None,
        }
    }
}

/// Entra tenant segment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tenant {
    /// Work/school and personal accounts.
    Common,
    /// Personal Microsoft accounts only.
    Consumers,
    /// Work/school accounts only.
    Organizations,
    /// One directory, by GUID or verified domain.
    Id(String),
}

impl Tenant {
    /// URL path segment.
    pub fn segment(&self) -> &str {
        match self {
            Tenant::Common => "common",
            Tenant::Consumers => "consumers",
            Tenant::Organizations => "organizations",
            Tenant::Id(id) => id,
        }
    }
    /// Parse a CLI/env value.
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "common" => Tenant::Common,
            "consumers" => Tenant::Consumers,
            "organizations" => Tenant::Organizations,
            _ => Tenant::Id(s.to_owned()),
        }
    }
}

/// Endpoint set of one provider/tenant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Endpoints {
    /// Authorization endpoint (browser).
    pub authorize: String,
    /// Token endpoint.
    pub token: String,
    /// Device authorization endpoint.
    pub device: String,
    /// Token revocation endpoint (Microsoft has none for user tokens).
    pub revoke: Option<String>,
    /// OpenID userinfo endpoint.
    pub userinfo: Option<String>,
}

impl Endpoints {
    /// Google endpoints.
    pub fn google() -> Self {
        Self {
            authorize: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token: "https://oauth2.googleapis.com/token".into(),
            device: "https://oauth2.googleapis.com/device/code".into(),
            revoke: Some("https://oauth2.googleapis.com/revoke".into()),
            userinfo: Some("https://openidconnect.googleapis.com/v1/userinfo".into()),
        }
    }
    /// Microsoft identity platform v2.0 endpoints for a tenant.
    pub fn microsoft(tenant: &Tenant) -> Self {
        let base = format!("https://login.microsoftonline.com/{}/oauth2/v2.0", tenant.segment());
        Self {
            authorize: format!("{base}/authorize"),
            token: format!("{base}/token"),
            device: format!("{base}/devicecode"),
            revoke: None,
            userinfo: Some("https://graph.microsoft.com/oidc/userinfo".into()),
        }
    }
}

/// One registered OAuth client (the application identity, not a user).
///
/// Google "Desktop app" clients carry a client secret that Google documents as not confidential;
/// Microsoft public clients carry none. Neither is ever printed: `Debug` redacts it.
#[derive(Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    /// Identity platform.
    pub provider: Provider,
    /// Application (client) id.
    pub client_id: String,
    /// Client secret, when the client type has one.
    pub client_secret: Option<String>,
    /// Entra tenant (ignored for Google).
    pub tenant: Tenant,
    /// Endpoints (overridable for tests).
    pub endpoints: Endpoints,
}

impl std::fmt::Debug for ProviderConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProviderConfig")
            .field("provider", &self.provider)
            .field("client_id", &self.client_id)
            .field("client_secret", &self.client_secret.as_ref().map(|_| "<redacted>"))
            .field("tenant", &self.tenant)
            .finish_non_exhaustive()
    }
}

impl ProviderConfig {
    /// Google "Desktop app" client.
    pub fn google(client_id: impl Into<String>, client_secret: Option<String>) -> Self {
        Self {
            provider: Provider::Google,
            client_id: client_id.into(),
            client_secret,
            tenant: Tenant::Common,
            endpoints: Endpoints::google(),
        }
    }
    /// Microsoft public client (mobile and desktop application platform) for a tenant.
    pub fn microsoft(client_id: impl Into<String>, tenant: Tenant) -> Self {
        let endpoints = Endpoints::microsoft(&tenant);
        Self { provider: Provider::Microsoft, client_id: client_id.into(), client_secret: None, tenant, endpoints }
    }
    /// Scopes always requested on top of the caller's (identity claims, refresh token for Microsoft).
    pub fn base_scopes(&self) -> &'static [&'static str] {
        match self.provider {
            Provider::Google => &["openid", "email", "profile"],
            Provider::Microsoft => &["openid", "email", "profile", "offline_access"],
        }
    }
    /// Host used in the loopback `redirect_uri`. Entra matches `http://localhost` ignoring the port;
    /// Google accepts `http://127.0.0.1:<port>` for Desktop clients.
    pub fn loopback_host(&self) -> &'static str {
        match self.provider {
            Provider::Google => "127.0.0.1",
            Provider::Microsoft => "localhost",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn microsoft_endpoints_follow_the_tenant() {
        let e = Endpoints::microsoft(&Tenant::Consumers);
        assert_eq!(e.authorize, "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
        assert_eq!(e.device, "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode");
        assert_eq!(
            Endpoints::microsoft(&Tenant::Id("contoso.onmicrosoft.com".into())).token,
            "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token"
        );
    }

    #[test]
    fn debug_redacts_the_client_secret() {
        let c = ProviderConfig::google("id.apps.googleusercontent.com", Some("GOCSPX-supersecret".into()));
        let dbg = format!("{c:?}");
        assert!(!dbg.contains("supersecret"));
        assert!(dbg.contains("<redacted>"));
    }

    #[test]
    fn parses_names() {
        assert_eq!(Provider::parse("Entra"), Some(Provider::Microsoft));
        assert_eq!(Tenant::parse("ORGANIZATIONS"), Tenant::Organizations);
        assert_eq!(Tenant::parse("72f988bf-86f1-41af-91ab-2d7cd011db47").segment(), "72f988bf-86f1-41af-91ab-2d7cd011db47");
    }
}
