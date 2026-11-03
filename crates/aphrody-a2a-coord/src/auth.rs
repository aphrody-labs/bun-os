// SPDX-License-Identifier: Apache-2.0
//! Authentication shared by every listener binding, including legacy routes.
use std::{net::SocketAddr, sync::Arc};

use aphrody_a2a_server::auth::{AuthUserBuilder, StaticBearerValidator, UserBuilder};
use axum::{
    Router,
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::{Next, from_fn_with_state},
    response::Response,
};

pub(crate) fn token() -> Option<String> {
    std::env::var("APHRODY_A2A_COORD_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

pub(crate) fn validate_bind(bind: SocketAddr, token: Option<&str>) -> std::io::Result<()> {
    if !bind.ip().is_loopback() && token.is_none_or(|value| value.trim().is_empty()) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "A non-loopback A2A listener requires APHRODY_A2A_COORD_TOKEN",
        ));
    }
    Ok(())
}

pub(crate) fn protect(router: Router, token: Option<String>) -> Router {
    let Some(token) = token else { return router };
    let validator = StaticBearerValidator::new().with_token(token, "a2a-peer");
    let auth = Arc::new(AuthUserBuilder::new().with_bearer(validator));
    router.layer(from_fn_with_state(auth, require_bearer))
}

async fn require_bearer(
    State(auth): State<Arc<AuthUserBuilder>>,
    request: Request,
    next: Next,
) -> Response {
    let discovery = request.method() == Method::GET
        && matches!(
            request.uri().path(),
            "/ping" | "/health" | "/openapi.json" | "/.well-known/agent-card.json"
        );
    if discovery || matches!(auth.build(request.headers()).await, Ok(Some(_))) {
        return next.run(request).await;
    }
    // RFC 9457 problem; `error` stays for existing A2A clients.
    let mut response = aphrody_http_error::api::problem_with(
        StatusCode::UNAUTHORIZED,
        "A bearer token is required.",
        serde_json::json!({ "error": "unauthorized" }),
    );
    response.headers_mut().insert(
        axum::http::header::WWW_AUTHENTICATE,
        axum::http::HeaderValue::from_static("Bearer"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_bind_requires_credentials_before_listening() {
        for address in ["0.0.0.0:8788", "10.200.77.1:8788", "[::]:8788"] {
            assert!(validate_bind(address.parse().unwrap(), None).is_err());
            assert!(validate_bind(address.parse().unwrap(), Some(" ")).is_err());
            assert!(validate_bind(address.parse().unwrap(), Some("configured")).is_ok());
        }
        assert!(validate_bind("127.0.0.1:8788".parse().unwrap(), None).is_ok());
        assert!(validate_bind("[::1]:8788".parse().unwrap(), None).is_ok());
    }
}
