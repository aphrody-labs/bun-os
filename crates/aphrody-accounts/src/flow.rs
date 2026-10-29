//! The OAuth 2.0 protocol steps: authorization URL, code exchange, device code, refresh, revoke.
//!
//! References: RFC 6749, RFC 7636 (PKCE), RFC 8628 (device grant), Google "OAuth 2.0 for Mobile &
//! Desktop Apps" and "...for TV and Limited-Input Device Applications", Microsoft identity platform
//! "OAuth 2.0 authorization code flow" and "device authorization grant".

use crate::error::{Error, Result};
use crate::http::{HttpRequest, HttpResponse, HttpTransport};
use crate::pkce::Pkce;
use crate::provider::{Provider, ProviderConfig};
use crate::token::{TokenResponse, TokenSet};
use serde::Deserialize;
use std::collections::BTreeSet;
use std::time::Duration;

/// Seconds since the Unix epoch.
pub fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Merge the provider's base scopes with the requested ones, de-duplicated, order preserved.
pub fn effective_scopes(cfg: &ProviderConfig, requested: &[&str]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    cfg.base_scopes()
        .iter()
        .chain(requested.iter())
        .filter(|s| seen.insert(s.to_ascii_lowercase()))
        .map(|s| (*s).to_owned())
        .collect()
}

/// Build the browser URL for the authorization code flow with PKCE.
///
/// Google gets `access_type=offline` (refresh token), `include_granted_scopes=true` (incremental
/// authorization) and `prompt=consent` when `force_consent` (otherwise Google only returns a
/// refresh token on the first grant). Microsoft gets `response_mode=query`.
pub fn authorization_url(
    cfg: &ProviderConfig,
    scopes: &[String],
    redirect_uri: &str,
    state: &str,
    pkce: &Pkce,
    login_hint: Option<&str>,
    force_consent: bool,
) -> Result<String> {
    let mut url =
        url::Url::parse(&cfg.endpoints.authorize).map_err(|e| Error::Invalid(e.to_string()))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("client_id", &cfg.client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", &scopes.join(" "))
            .append_pair("state", state)
            .append_pair("code_challenge", &pkce.challenge)
            .append_pair("code_challenge_method", "S256");
        match cfg.provider {
            Provider::Google => {
                q.append_pair("access_type", "offline")
                    .append_pair("include_granted_scopes", "true");
                if force_consent {
                    q.append_pair("prompt", "consent");
                }
            }
            Provider::Microsoft => {
                q.append_pair("response_mode", "query");
                if force_consent {
                    q.append_pair("prompt", "consent");
                }
            }
        }
        if let Some(h) = login_hint {
            q.append_pair("login_hint", h);
        }
    }
    Ok(url.into())
}

#[derive(Debug, Deserialize)]
struct OAuthErrorBody {
    error: String,
    #[serde(default)]
    error_description: String,
}

/// Parse an RFC 6749 error object out of a response, whatever its status.
fn oauth_error(resp: &HttpResponse) -> Option<Error> {
    let b: OAuthErrorBody = serde_json::from_slice(&resp.body).ok()?;
    let description = b
        .error_description
        .lines()
        .next()
        .unwrap_or_default()
        .chars()
        .take(300)
        .collect();
    Some(Error::OAuth {
        code: b.error,
        description,
    })
}

fn token_request(cfg: &ProviderConfig, mut fields: Vec<(String, String)>) -> HttpRequest {
    fields.push(("client_id".into(), cfg.client_id.clone()));
    if let Some(s) = &cfg.client_secret {
        fields.push(("client_secret".into(), s.clone()));
    }
    HttpRequest::post_form(cfg.endpoints.token.clone(), fields)
}

fn finish_token(resp: HttpResponse, now: u64, requested: &[String]) -> Result<TokenSet> {
    if !resp.is_success() {
        return Err(oauth_error(&resp).unwrap_or(Error::Api {
            status: resp.status,
            message: crate::http::api_message(&resp.body),
        }));
    }
    let t: TokenResponse = resp.parse()?;
    Ok(t.into_set(now, requested))
}

/// Exchange an authorization code (with the PKCE verifier) for tokens.
pub fn exchange_code(
    http: &dyn HttpTransport,
    cfg: &ProviderConfig,
    code: &str,
    redirect_uri: &str,
    pkce: &Pkce,
    requested: &[String],
    now: u64,
) -> Result<TokenSet> {
    let mut fields = vec![
        ("grant_type".to_owned(), "authorization_code".to_owned()),
        ("code".to_owned(), code.to_owned()),
        ("redirect_uri".to_owned(), redirect_uri.to_owned()),
        ("code_verifier".to_owned(), pkce.verifier.clone()),
    ];
    if cfg.provider == Provider::Microsoft {
        // Entra returns only the scopes of one resource unless asked; repeating `scope` keeps it explicit.
        fields.push(("scope".into(), requested.join(" ")));
    }
    finish_token(http.execute(&token_request(cfg, fields))?, now, requested)
}

/// Use a refresh token. The result inherits the old refresh token and scopes when the server omits them
/// (Google never returns a new refresh token; Microsoft rotates it).
pub fn refresh(
    http: &dyn HttpTransport,
    cfg: &ProviderConfig,
    old: &TokenSet,
    now: u64,
) -> Result<TokenSet> {
    let Some(rt) = &old.refresh_token else {
        return Err(Error::ReauthRequired("no refresh token".into()));
    };
    let mut fields = vec![
        ("grant_type".to_owned(), "refresh_token".to_owned()),
        ("refresh_token".to_owned(), rt.clone()),
    ];
    if cfg.provider == Provider::Microsoft {
        fields.push(("scope".into(), old.scopes.join(" ")));
    }
    let mut new = finish_token(http.execute(&token_request(cfg, fields))?, now, &old.scopes)?;
    if new.refresh_token.is_none() {
        new.refresh_token.clone_from(&old.refresh_token);
    }
    if new.id_token.is_none() {
        new.id_token.clone_from(&old.id_token);
    }
    // Google omits `scope` on refresh in some responses; `into_set` then fell back to `old.scopes`.
    Ok(new)
}

/// Revoke a token at the provider (Google only; Microsoft has no per-token revocation for users:
/// the user revokes at <https://account.microsoft.com/privacy/app-access>).
pub fn revoke(http: &dyn HttpTransport, cfg: &ProviderConfig, token: &str) -> Result<bool> {
    let Some(url) = &cfg.endpoints.revoke else {
        return Ok(false);
    };
    let resp = http.execute(&HttpRequest::post_form(
        url.clone(),
        vec![("token".into(), token.to_owned())],
    ))?;
    if resp.is_success() {
        return Ok(true);
    }
    Err(oauth_error(&resp).unwrap_or(Error::Api {
        status: resp.status,
        message: crate::http::api_message(&resp.body),
    }))
}

/// Device authorization response (RFC 8628). Google names the field `verification_url`,
/// Microsoft `verification_uri`; both are accepted.
#[derive(Debug, Clone, Deserialize)]
pub struct DeviceCode {
    /// Opaque code polled on the token endpoint.
    pub device_code: String,
    /// Short code the user types.
    pub user_code: String,
    /// Where the user goes.
    #[serde(alias = "verification_url")]
    pub verification_uri: String,
    /// Pre-filled variant (Google/RFC), absent for Microsoft.
    #[serde(default)]
    pub verification_uri_complete: Option<String>,
    /// Seconds until the codes expire.
    pub expires_in: u64,
    /// Minimum seconds between polls.
    #[serde(default = "default_interval")]
    pub interval: u64,
    /// Ready-made instruction (Microsoft).
    #[serde(default)]
    pub message: Option<String>,
    /// Scopes requested, kept for the poll.
    #[serde(skip)]
    pub requested: Vec<String>,
}

fn default_interval() -> u64 {
    5
}

/// Start the device grant.
pub fn start_device(
    http: &dyn HttpTransport,
    cfg: &ProviderConfig,
    scopes: &[String],
) -> Result<DeviceCode> {
    let fields = vec![
        ("client_id".to_owned(), cfg.client_id.clone()),
        ("scope".to_owned(), scopes.join(" ")),
    ];
    let resp = http.execute(&HttpRequest::post_form(
        cfg.endpoints.device.clone(),
        fields,
    ))?;
    if !resp.is_success() {
        return Err(oauth_error(&resp).unwrap_or(Error::Api {
            status: resp.status,
            message: crate::http::api_message(&resp.body),
        }));
    }
    let mut d: DeviceCode = resp.parse()?;
    d.requested = scopes.to_vec();
    Ok(d)
}

/// Result of one poll of the device grant.
#[derive(Debug)]
pub enum DevicePoll {
    /// The user has not finished; poll again after `interval`.
    Pending,
    /// Polling too fast; add 5 seconds to the interval.
    SlowDown,
    /// Signed in.
    Done(TokenSet),
}

/// Poll once.
pub fn poll_device(
    http: &dyn HttpTransport,
    cfg: &ProviderConfig,
    dc: &DeviceCode,
    now: u64,
) -> Result<DevicePoll> {
    let mut fields = vec![
        (
            "grant_type".to_owned(),
            "urn:ietf:params:oauth:grant-type:device_code".to_owned(),
        ),
        ("device_code".to_owned(), dc.device_code.clone()),
    ];
    // Microsoft public clients send no secret; Google's device flow requires the client secret.
    if cfg.provider == Provider::Google
        && let Some(s) = &cfg.client_secret
    {
        fields.push(("client_secret".into(), s.clone()));
    }
    fields.push(("client_id".into(), cfg.client_id.clone()));
    let resp = http.execute(&HttpRequest::post_form(cfg.endpoints.token.clone(), fields))?;
    if resp.is_success() {
        return Ok(DevicePoll::Done(finish_token(resp, now, &dc.requested)?));
    }
    match oauth_error(&resp) {
        Some(Error::OAuth { code, .. }) if code == "authorization_pending" => {
            Ok(DevicePoll::Pending)
        }
        Some(Error::OAuth { code, .. }) if code == "slow_down" => Ok(DevicePoll::SlowDown),
        Some(Error::OAuth { code, description })
            if matches!(code.as_str(), "access_denied" | "authorization_declined") =>
        {
            Err(Error::Denied(if description.is_empty() {
                code
            } else {
                description
            }))
        }
        Some(Error::OAuth { code, .. })
            if matches!(code.as_str(), "expired_token" | "code_expired") =>
        {
            Err(Error::Timeout)
        }
        Some(e) => Err(e),
        None => Err(Error::Api {
            status: resp.status,
            message: crate::http::api_message(&resp.body),
        }),
    }
}

/// Poll until done, denied or expired, honoring `interval` and `slow_down`. `sleep` is injectable.
pub fn wait_device(
    http: &dyn HttpTransport,
    cfg: &ProviderConfig,
    dc: &DeviceCode,
    now: &dyn Fn() -> u64,
    sleep: &dyn Fn(Duration),
) -> Result<TokenSet> {
    let deadline = now() + dc.expires_in;
    let mut interval = dc.interval.max(1);
    loop {
        sleep(Duration::from_secs(interval));
        if now() >= deadline {
            return Err(Error::Timeout);
        }
        match poll_device(http, cfg, dc, now())? {
            DevicePoll::Done(t) => return Ok(t),
            DevicePoll::Pending => {}
            DevicePoll::SlowDown => interval += 5,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::Tenant;
    use crate::testing::{ScriptedTransport, fake_id_token};
    use serde_json::json;
    use std::cell::Cell;

    fn gcfg() -> ProviderConfig {
        ProviderConfig::google("cid.apps.googleusercontent.com", Some("sek".into()))
    }

    #[test]
    fn google_url_has_pkce_offline_and_incremental() {
        let p = Pkce::from_verifier("v".repeat(43));
        let scopes = effective_scopes(&gcfg(), &["https://www.googleapis.com/auth/drive.file"]);
        let u = authorization_url(
            &gcfg(),
            &scopes,
            "http://127.0.0.1:5555",
            "st",
            &p,
            Some("me@x.y"),
            true,
        )
        .unwrap();
        let url = url::Url::parse(&u).unwrap();
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], p.challenge);
        assert_eq!(q["access_type"], "offline");
        assert_eq!(q["include_granted_scopes"], "true");
        assert_eq!(q["prompt"], "consent");
        assert_eq!(q["login_hint"], "me@x.y");
        assert_eq!(
            q["scope"],
            "openid email profile https://www.googleapis.com/auth/drive.file"
        );
        assert!(
            !u.contains("sek"),
            "client secret must never be in the browser URL"
        );
    }

    #[test]
    fn microsoft_url_uses_tenant_and_offline_access() {
        let c = ProviderConfig::microsoft("app-id", Tenant::Consumers);
        let scopes = effective_scopes(&c, &["Files.ReadWrite", "offline_access"]);
        assert_eq!(
            scopes
                .iter()
                .filter(|s| s.as_str() == "offline_access")
                .count(),
            1
        );
        let u = authorization_url(
            &c,
            &scopes,
            "http://localhost:6000",
            "st",
            &Pkce::from_verifier("v".repeat(43)),
            None,
            false,
        )
        .unwrap();
        assert!(
            u.starts_with("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?")
        );
        assert!(u.contains("response_mode=query") && !u.contains("prompt="));
    }

    #[test]
    fn code_exchange_sends_verifier_and_secret_and_parses_tokens() {
        let id = fake_id_token(&json!({"sub":"42","email":"o@example.com"}));
        let http = ScriptedTransport::new().on(
            "oauth2.googleapis.com/token",
            HttpResponse::json(
                200,
                &json!({"access_token":"AT","expires_in":3599,"refresh_token":"RT","scope":"openid https://www.googleapis.com/auth/userinfo.email","id_token":id,"token_type":"Bearer"}),
            ),
        );
        let p = Pkce::from_verifier("v".repeat(43));
        let t = exchange_code(
            &http,
            &gcfg(),
            "CODE",
            "http://127.0.0.1:1",
            &p,
            &["openid".into()],
            1000,
        )
        .unwrap();
        assert_eq!(t.access_token, "AT");
        assert_eq!(t.refresh_token.as_deref(), Some("RT"));
        assert_eq!(t.expires_at, 4599);
        let body = http.requests()[0].body_text();
        assert!(body.contains("grant_type=authorization_code") && body.contains("code=CODE"));
        assert!(
            body.contains(&format!("code_verifier={}", p.verifier))
                && body.contains("client_secret=sek")
        );
    }

    #[test]
    fn refresh_keeps_google_refresh_token_and_scopes() {
        let http = ScriptedTransport::new().on(
            "token",
            HttpResponse::json(
                200,
                &json!({"access_token":"AT2","expires_in":3600,"token_type":"Bearer"}),
            ),
        );
        let old = TokenSet {
            access_token: "AT".into(),
            refresh_token: Some("RT".into()),
            expires_at: 0,
            scopes: vec!["openid".into(), "x".into()],
            id_token: Some("idt".into()),
        };
        let n = refresh(&http, &gcfg(), &old, 10).unwrap();
        assert_eq!(
            (n.access_token.as_str(), n.refresh_token.as_deref()),
            ("AT2", Some("RT"))
        );
        assert_eq!(n.scopes, old.scopes);
        assert_eq!(n.id_token.as_deref(), Some("idt"));
        assert!(
            http.requests()[0]
                .body_text()
                .contains("grant_type=refresh_token")
        );
    }

    #[test]
    fn microsoft_refresh_rotates_the_refresh_token() {
        let c = ProviderConfig::microsoft("app", Tenant::Common);
        let http = ScriptedTransport::new().on(
            "/token",
            HttpResponse::json(200, &json!({"access_token":"B","refresh_token":"RT-new","expires_in":3600,"scope":"User.Read"})),
        );
        let old = TokenSet {
            access_token: "A".into(),
            refresh_token: Some("RT-old".into()),
            expires_at: 0,
            scopes: vec!["User.Read".into()],
            id_token: None,
        };
        let n = refresh(&http, &c, &old, 0).unwrap();
        assert_eq!(n.refresh_token.as_deref(), Some("RT-new"));
        assert!(!http.requests()[0].body_text().contains("client_secret"));
    }

    #[test]
    fn invalid_grant_surfaces_as_oauth_error() {
        let http = ScriptedTransport::new().on(
            "token",
            HttpResponse::json(400, &json!({"error":"invalid_grant","error_description":"Token has been expired or revoked."})),
        );
        let old = TokenSet {
            access_token: "A".into(),
            refresh_token: Some("R".into()),
            expires_at: 0,
            scopes: vec![],
            id_token: None,
        };
        match refresh(&http, &gcfg(), &old, 0) {
            Err(Error::OAuth { code, .. }) => assert_eq!(code, "invalid_grant"),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn device_flow_google_pending_slowdown_then_done() {
        let http = ScriptedTransport::new()
            .on(
                "device/code",
                HttpResponse::json(
                    200,
                    &json!({"device_code":"DC","user_code":"ABCD-EFGH","verification_url":"https://www.google.com/device","expires_in":1800,"interval":5}),
                ),
            )
            .on("token", HttpResponse::json(428, &json!({"error":"authorization_pending"})))
            .on("token", HttpResponse::json(403, &json!({"error":"slow_down"})))
            .on("token", HttpResponse::json(200, &json!({"access_token":"AT","expires_in":3600,"refresh_token":"RT","scope":"https://www.googleapis.com/auth/drive.file"})));
        let cfg = gcfg();
        let dc = start_device(
            &http,
            &cfg,
            &["https://www.googleapis.com/auth/drive.file".into()],
        )
        .unwrap();
        assert_eq!(dc.verification_uri, "https://www.google.com/device");
        assert_eq!(dc.user_code, "ABCD-EFGH");
        let slept = Cell::new(Vec::<u64>::new());
        let t = wait_device(&http, &cfg, &dc, &|| 100, &|d| {
            let mut v = slept.take();
            v.push(d.as_secs());
            slept.set(v);
        })
        .unwrap();
        assert_eq!(t.access_token, "AT");
        assert_eq!(
            slept.take(),
            vec![5, 5, 10],
            "slow_down adds five seconds to the interval"
        );
        let poll = http.requests()[1].body_text();
        assert!(poll.contains("device_code=DC") && poll.contains("client_secret=sek"));
    }

    #[test]
    fn device_flow_microsoft_declined_and_expired() {
        let c = ProviderConfig::microsoft("app", Tenant::Consumers);
        let dc = DeviceCode {
            device_code: "D".into(),
            user_code: "U".into(),
            verification_uri: "https://microsoft.com/devicelogin".into(),
            verification_uri_complete: None,
            expires_in: 900,
            interval: 5,
            message: None,
            requested: vec![],
        };
        let http = ScriptedTransport::new().on(
            "/token",
            HttpResponse::json(400, &json!({"error":"authorization_declined"})),
        );
        assert!(matches!(
            poll_device(&http, &c, &dc, 0),
            Err(Error::Denied(_))
        ));
        let http = ScriptedTransport::new().on(
            "/token",
            HttpResponse::json(400, &json!({"error":"expired_token"})),
        );
        assert!(matches!(
            poll_device(&http, &c, &dc, 0),
            Err(Error::Timeout)
        ));
        assert!(!http.requests()[0].body_text().contains("client_secret"));
    }

    #[test]
    fn microsoft_has_no_revocation_endpoint() {
        let c = ProviderConfig::microsoft("app", Tenant::Common);
        assert!(!revoke(&ScriptedTransport::new(), &c, "t").unwrap());
        let http = ScriptedTransport::new().on(
            "revoke",
            HttpResponse {
                status: 200,
                ..Default::default()
            },
        );
        assert!(revoke(&http, &gcfg(), "t").unwrap());
    }
}
