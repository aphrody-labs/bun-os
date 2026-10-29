//! Token material and id_token claims.

use crate::error::{Error, Result};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};

/// Tokens held for one account. `Debug` never prints a token value.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenSet {
    /// Short-lived bearer token.
    pub access_token: String,
    /// Long-lived refresh token (absent when the grant had no offline access).
    pub refresh_token: Option<String>,
    /// Expiry of `access_token`, seconds since the Unix epoch.
    pub expires_at: u64,
    /// Scopes the grant covers, as returned by the server.
    pub scopes: Vec<String>,
    /// OpenID Connect id_token, kept to re-derive claims.
    pub id_token: Option<String>,
}

impl std::fmt::Debug for TokenSet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenSet")
            .field("access_token", &"<redacted>")
            .field("refresh_token", &self.refresh_token.as_ref().map(|_| "<redacted>"))
            .field("expires_at", &self.expires_at)
            .field("scopes", &self.scopes)
            .finish_non_exhaustive()
    }
}

impl TokenSet {
    /// True when the access token is still valid for at least `skew` more seconds.
    pub fn is_fresh(&self, now: u64, skew: u64) -> bool {
        self.expires_at > now.saturating_add(skew)
    }
    /// Scopes in `wanted` that this grant does not cover. Matching is case-insensitive and
    /// understands Google's full-URL vs short forms (`email` == `.../auth/userinfo.email`) and
    /// Microsoft's case-insensitive scope names; a broader scope implies its `.readonly` sibling.
    pub fn missing_scopes<'a>(&self, wanted: &[&'a str]) -> Vec<&'a str> {
        wanted.iter().copied().filter(|w| !self.scopes.iter().any(|g| scope_covers(g, w))).collect()
    }
}

fn canonical(s: &str) -> String {
    let s = s.trim().to_ascii_lowercase();
    match s.as_str() {
        "https://www.googleapis.com/auth/userinfo.email" => "email".into(),
        "https://www.googleapis.com/auth/userinfo.profile" => "profile".into(),
        _ => s,
    }
}

/// Does a granted scope satisfy a wanted scope?
pub fn scope_covers(granted: &str, wanted: &str) -> bool {
    let (g, w) = (canonical(granted), canonical(wanted));
    if g == w {
        return true;
    }
    // Google: `.../auth/drive` covers `.../auth/drive.readonly` and `.../auth/drive.file`
    // is NOT implied by readonly; Microsoft: `Files.ReadWrite` covers `Files.Read`.
    if let Some(base) = w.strip_suffix(".readonly") {
        if g == base {
            return true;
        }
    }
    if let Some(base) = w.strip_suffix(".read") {
        if g.strip_suffix(".readwrite") == Some(base) {
            return true;
        }
    }
    if let Some(base) = w.strip_suffix(".read.all") {
        if g.strip_suffix(".readwrite.all") == Some(base) {
            return true;
        }
    }
    false
}

/// Token endpoint success body (RFC 6749 section 5.1).
#[derive(Debug, Deserialize)]
pub(crate) struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub expires_in: Option<u64>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
}

impl TokenResponse {
    pub(crate) fn into_set(self, now: u64, requested: &[String]) -> TokenSet {
        let scopes = match self.scope {
            Some(s) if !s.trim().is_empty() => s.split_whitespace().map(str::to_owned).collect(),
            _ => requested.to_vec(),
        };
        TokenSet {
            access_token: self.access_token,
            refresh_token: self.refresh_token,
            expires_at: now + self.expires_in.unwrap_or(3600),
            scopes,
            id_token: self.id_token,
        }
    }
}

/// Claims read from an id_token we received directly from the token endpoint over TLS.
///
/// OpenID Connect Core 3.1.3.7 lets a client skip signature validation in that case, and this
/// layer only uses the claims to label the account. Never use them to authorize anything and
/// never parse access tokens (Microsoft: "do not take dependencies on this").
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
pub struct IdClaims {
    /// Subject (pairwise for Microsoft personal accounts).
    #[serde(default)]
    pub sub: String,
    /// Object id in the directory (Microsoft).
    #[serde(default)]
    pub oid: Option<String>,
    /// Tenant id (Microsoft).
    #[serde(default)]
    pub tid: Option<String>,
    /// Email.
    #[serde(default)]
    pub email: Option<String>,
    /// UPN / sign-in name (Microsoft).
    #[serde(default)]
    pub preferred_username: Option<String>,
    /// Display name.
    #[serde(default)]
    pub name: Option<String>,
    /// Avatar URL (Google).
    #[serde(default)]
    pub picture: Option<String>,
}

impl IdClaims {
    /// Decode the payload segment of a JWT without verifying it (see the type docs).
    pub fn decode(jwt: &str) -> Result<Self> {
        let payload = jwt.split('.').nth(1).ok_or_else(|| Error::Invalid("id_token is not a JWT".into()))?;
        let bytes = URL_SAFE_NO_PAD
            .decode(payload.trim_end_matches('='))
            .map_err(|e| Error::Invalid(format!("id_token payload: {e}")))?;
        serde_json::from_slice(&bytes).map_err(Error::from)
    }
    /// Best human label: email, then UPN, then subject.
    pub fn label(&self) -> String {
        self.email.clone().or_else(|| self.preferred_username.clone()).unwrap_or_else(|| self.sub.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(scopes: &[&str]) -> TokenSet {
        TokenSet {
            access_token: "a".into(),
            refresh_token: Some("r".into()),
            expires_at: 1000,
            scopes: scopes.iter().map(|s| (*s).to_owned()).collect(),
            id_token: None,
        }
    }

    #[test]
    fn freshness_uses_the_skew() {
        let t = set(&[]);
        assert!(t.is_fresh(900, 60));
        assert!(!t.is_fresh(950, 60));
    }

    #[test]
    fn scope_matching_handles_google_and_microsoft_forms() {
        let g = set(&["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/drive"]);
        assert!(g.missing_scopes(&["email", "https://www.googleapis.com/auth/drive.readonly"]).is_empty());
        assert_eq!(
            g.missing_scopes(&["https://www.googleapis.com/auth/documents"]),
            vec!["https://www.googleapis.com/auth/documents"]
        );
        let m = set(&["Files.ReadWrite", "User.Read", "Sites.ReadWrite.All"]);
        assert!(m.missing_scopes(&["files.read", "user.read", "sites.read.all"]).is_empty());
        assert_eq!(m.missing_scopes(&["Calendars.Read"]), vec!["Calendars.Read"]);
    }

    #[test]
    fn readonly_does_not_imply_write() {
        let g = set(&["https://www.googleapis.com/auth/drive.readonly"]);
        assert_eq!(g.missing_scopes(&["https://www.googleapis.com/auth/drive"]).len(), 1);
    }

    #[test]
    fn decodes_id_token_claims() {
        let jwt = crate::testing::fake_id_token(&serde_json::json!({"sub":"1","email":"a@b.c","name":"A B"}));
        let c = IdClaims::decode(&jwt).unwrap();
        assert_eq!(c.label(), "a@b.c");
        assert_eq!(c.name.as_deref(), Some("A B"));
        assert!(IdClaims::decode("nope").is_err());
    }

    #[test]
    fn debug_hides_tokens() {
        let t = set(&["x"]);
        let d = format!("{t:?}");
        assert!(!d.contains("\"a\"") && d.contains("<redacted>"));
    }
}
