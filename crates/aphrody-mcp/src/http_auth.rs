// SPDX-License-Identifier: Apache-2.0

//! Bearer authentication of the Streamable HTTP `/mcp` endpoint.
//!
//! `/mcp` exposes every tool of the server, so it never answers without a token. The token is read once at start from
//! the process environment (a systemd `EnvironmentFile` on a host, never the repository): `APHRODY_MCP_HTTP_TOKEN`, else
//! the AI HTTP token (`APHRODY_AI_HTTP_TOKEN`) so a deployment that already injects
//! `Authorization: Bearer <that token>` in front of the listener keeps working. The dedicated name scopes `/mcp` apart from
//! the REST gateway. A missing or too short token is fail-closed (503), a wrong or absent header is 401, the comparison is
//! constant time. `/healthz` and the REST routes are outside this layer and keep their own rules.

use std::{fmt, sync::Arc};

use axum::{
    extract::{Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::Next,
    response::Response,
};

/// Dedicated token variable of `/mcp`.
pub(crate) const TOKEN_ENV: &str = "APHRODY_MCP_HTTP_TOKEN";
/// Shortest accepted token, in bytes (a `openssl rand -hex 32` token is 64).
const MIN_TOKEN_BYTES: usize = 32;

#[derive(Clone)]
enum AuthState {
    Configured(Arc<str>),
    Missing,
    Invalid(String),
}

/// Authentication state of `/mcp`. `Debug` never prints the token.
#[derive(Clone)]
pub(crate) struct McpAuth {
    state: AuthState,
}

impl fmt::Debug for McpAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let state = match self.state {
            AuthState::Configured(_) => "configured",
            AuthState::Missing => "missing",
            AuthState::Invalid(_) => "invalid",
        };
        f.debug_struct("McpAuth").field("state", &state).finish()
    }
}

/// The token to enforce, from an injected environment lookup: `APHRODY_MCP_HTTP_TOKEN`, else the AI HTTP token.
/// `Ok(None)` when nothing is set, `Err` when the value is shorter than 32 bytes (no fallback to the other name).
pub(crate) fn resolve_token(
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Option<String>, String> {
    let dedicated = env(TOKEN_ENV).filter(|value| !value.trim().is_empty());
    let (name, token) = match dedicated {
        Some(token) => (TOKEN_ENV, Some(token)),
        None => (
            "APHRODY_AI_HTTP_TOKEN",
            aphrody_config::ai_env::HTTP_TOKEN.resolve_with(env),
        ),
    };
    match token.map(|value| value.trim().to_owned()) {
        Some(token) if token.len() < MIN_TOKEN_BYTES => {
            Err(format!("{name} must be at least {MIN_TOKEN_BYTES} bytes"))
        }
        other => Ok(other),
    }
}

impl McpAuth {
    /// Read the token from the process environment, once.
    pub(crate) fn from_env() -> Self {
        Self::from_lookup(&|name| std::env::var(name).ok())
    }

    pub(crate) fn from_lookup(env: &dyn Fn(&str) -> Option<String>) -> Self {
        let state = match resolve_token(env) {
            Ok(Some(token)) => AuthState::Configured(token.into()),
            Ok(None) => AuthState::Missing,
            Err(reason) => AuthState::Invalid(reason),
        };
        Self { state }
    }

    /// Log what an operator must fix when `/mcp` will refuse every request.
    pub(crate) fn warn_if_unusable(&self) {
        match &self.state {
            AuthState::Configured(_) => {}
            AuthState::Missing => tracing::error!(
                "{TOKEN_ENV} is not set: /mcp answers 503 to every request (REST and /healthz are unaffected)"
            ),
            AuthState::Invalid(reason) => {
                tracing::error!("{reason}: /mcp answers 503 to every request");
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn with_token(token: &str) -> Self {
        Self {
            state: AuthState::Configured(token.into()),
        }
    }

    #[cfg(test)]
    pub(crate) fn unconfigured() -> Self {
        Self {
            state: AuthState::Missing,
        }
    }
}

/// The token of an `Authorization: Bearer <token>` value (scheme case-insensitive).
fn bearer(value: &str) -> Option<&str> {
    let (scheme, token) = value.split_once(' ')?;
    scheme.eq_ignore_ascii_case("Bearer").then(|| token.trim())
}

fn refusal(status: StatusCode, message: &str) -> Response {
    let mut response =
        aphrody_http_error::error_response(status, status.as_u16().to_string(), message, None);
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if status == StatusCode::UNAUTHORIZED {
        headers.insert(
            header::WWW_AUTHENTICATE,
            HeaderValue::from_static("Bearer realm=\"aphrody-mcp\""),
        );
    }
    response
}

/// Middleware of the `/mcp` router: 503 without a usable token, 401 without the right one.
pub(crate) async fn require_bearer(
    State(auth): State<McpAuth>,
    request: Request,
    next: Next,
) -> Response {
    match &auth.state {
        AuthState::Configured(expected) => {
            let supplied = request
                .headers()
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .and_then(bearer);
            if supplied.is_some_and(|token| {
                aphrody_secrets::constant_time_eq(token.as_bytes(), expected.as_bytes())
            }) {
                next.run(request).await
            } else {
                refusal(StatusCode::UNAUTHORIZED, "Unauthorized")
            }
        }
        AuthState::Missing => refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "MCP HTTP token is not configured",
        ),
        AuthState::Invalid(reason) => refusal(StatusCode::SERVICE_UNAVAILABLE, reason),
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, time::Duration};

    use axum::{Router, middleware, routing::post};

    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        move |name| map.get(name).cloned()
    }

    #[test]
    fn nothing_set_means_no_token() {
        assert_eq!(resolve_token(&lookup(&[])), Ok(None));
        assert_eq!(resolve_token(&lookup(&[(TOKEN_ENV, "   ")])), Ok(None));
    }

    #[test]
    fn the_dedicated_variable_wins_and_the_ai_http_token_is_the_fallback() {
        let other = "f".repeat(40);
        assert_eq!(
            resolve_token(&lookup(&[
                (TOKEN_ENV, TOKEN),
                ("APHRODY_AI_HTTP_TOKEN", &other)
            ])),
            Ok(Some(TOKEN.to_owned()))
        );
        assert_eq!(
            resolve_token(&lookup(&[("APHRODY_AI_HTTP_TOKEN", TOKEN)])),
            Ok(Some(TOKEN.to_owned()))
        );
    }

    #[test]
    fn a_short_token_is_refused_and_never_falls_back() {
        assert!(resolve_token(&lookup(&[(TOKEN_ENV, "short")])).is_err());
        assert!(
            resolve_token(&lookup(&[
                (TOKEN_ENV, "short"),
                ("APHRODY_AI_HTTP_TOKEN", TOKEN)
            ]))
            .is_err()
        );
        assert!(
            resolve_token(&lookup(&[(
                "APHRODY_AI_HTTP_TOKEN",
                "x".repeat(31).as_str()
            )]))
            .is_err()
        );
        assert!(resolve_token(&lookup(&[(TOKEN_ENV, "x".repeat(32).as_str())])).is_ok());
    }

    #[test]
    fn the_token_is_trimmed_like_an_environment_file_value() {
        let padded = format!("{TOKEN}\n");
        assert_eq!(
            resolve_token(&lookup(&[(TOKEN_ENV, &padded)])),
            Ok(Some(TOKEN.to_owned()))
        );
    }

    #[test]
    fn debug_never_prints_the_token() {
        let text = format!("{:?}", McpAuth::with_token(TOKEN));
        assert!(
            !text.contains(TOKEN) && !text.contains(&TOKEN[..8]),
            "{text}"
        );
    }

    #[test]
    fn the_bearer_scheme_is_case_insensitive_and_strict() {
        assert_eq!(bearer("Bearer abc"), Some("abc"));
        assert_eq!(bearer("bearer abc"), Some("abc"));
        assert_eq!(bearer("BEARER abc"), Some("abc"));
        assert_eq!(bearer("Basic abc"), None);
        assert_eq!(bearer("Bearerabc"), None);
        assert_eq!(bearer("abc"), None);
    }

    async fn serve(auth: McpAuth) -> std::net::SocketAddr {
        let app = Router::new()
            .route("/mcp", post(|| async { "tools" }))
            .layer(middleware::from_fn_with_state(auth, require_bearer));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await });
        address
    }

    async fn call(address: std::net::SocketAddr, authorization: Option<&str>) -> reqwest::Response {
        let mut request = reqwest::Client::new()
            .post(format!("http://{address}/mcp"))
            .timeout(Duration::from_secs(5));
        if let Some(value) = authorization {
            request = request.header("Authorization", value);
        }
        request.send().await.unwrap()
    }

    #[tokio::test]
    async fn the_right_token_passes_and_every_other_request_is_refused() {
        let address = serve(McpAuth::with_token(TOKEN)).await;
        assert_eq!(
            call(address, Some(&format!("Bearer {TOKEN}")))
                .await
                .status(),
            200
        );
        assert_eq!(
            call(address, Some(&format!("bearer {TOKEN}")))
                .await
                .status(),
            200
        );

        let refused = call(address, None).await;
        assert_eq!(refused.status(), 401);
        assert!(
            refused.headers()["www-authenticate"]
                .to_str()
                .unwrap()
                .starts_with("Bearer")
        );
        assert_eq!(refused.headers()["cache-control"], "no-store");
        let body = refused.text().await.unwrap();
        assert!(!body.contains(TOKEN));

        for wrong in [
            format!("Bearer {TOKEN}x"),
            format!("Bearer {}", &TOKEN[..TOKEN.len() - 1]),
            format!("Bearer {}", TOKEN.to_uppercase()),
            format!("Basic {TOKEN}"),
            format!("Token {TOKEN}"),
            TOKEN.to_owned(),
            "Bearer ".to_owned(),
        ] {
            assert_eq!(call(address, Some(&wrong)).await.status(), 401, "{wrong}");
        }
    }

    #[tokio::test]
    async fn without_a_usable_token_the_endpoint_is_closed() {
        let missing = serve(McpAuth::unconfigured()).await;
        assert_eq!(call(missing, None).await.status(), 503);
        assert_eq!(
            call(missing, Some(&format!("Bearer {TOKEN}")))
                .await
                .status(),
            503
        );

        let invalid = serve(McpAuth::from_lookup(&lookup(&[(TOKEN_ENV, "short")]))).await;
        let response = call(invalid, Some("Bearer short")).await;
        assert_eq!(response.status(), 503);
        assert!(response.text().await.unwrap().contains("at least 32 bytes"));
    }
}
