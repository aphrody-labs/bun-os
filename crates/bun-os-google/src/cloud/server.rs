//! `/api/google/*` routes for the Bun OS backend (merge [`router`] into the aphrody.com axum app, or run
//! `bun-os-google serve` on loopback behind nginx).
//!
//! | Route | Access | Purpose |
//! |---|---|---|
//! | `GET /api/google/status` | public (details with admin token) | service account and owner link state |
//! | `GET /api/google/login?key=<admin>` | admin | redirect to Google consent for the owner |
//! | `GET /api/google/callback` | state-bound | OAuth redirect target; seals the refresh token |
//! | `POST /api/google/token/refresh` | admin | refresh owner and service-account tokens |
//! | `GET /api/google/token?account=owner\|service` | admin | short-lived access token for sessions |
//! | `GET /api/google/{drive/root,gmail/labels,calendar/list,youtube/channels,people/connections}` | admin | owner data |
//! | `GET /api/google/gcs/buckets` | admin | Cloud Storage as the service account |
//! | `POST /api/google/unlink` | admin | revoke and forget the owner token |
//! | `GET /api/microsoft/{login,callback}` | admin / state-bound | the owner's Microsoft account (Graph) |
//! | `GET /api/microsoft/{token,onedrive/root,outlook/messages,calendar/week}` | admin | Graph token and owner data |
//!
//! Admin = `Authorization: Bearer <APHRODY_GOOGLE_ADMIN_TOKEN>` (or `?key=` on browser routes). Without a
//! configured admin token every admin route answers 503.

use super::adc::Adc;
use super::oauth::OwnerOAuth;
use super::{Error, PROJECT, api, ct_eq, env};
use axum::Json;
use axum::Router;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

/// Shared state of the routes.
pub struct GoogleService {
    /// Service-account token source (None when no ADC is present).
    pub adc: Option<Adc>,
    /// Load error of the ADC, for status.
    pub adc_error: Option<String>,
    /// Owner account broker.
    pub owner: OwnerOAuth,
    /// Microsoft owner account broker (Graph).
    pub microsoft: OwnerOAuth,
    /// Admin bearer token.
    admin_token: Option<String>,
    /// Project for project-scoped calls.
    pub project: String,
}

impl std::fmt::Debug for GoogleService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GoogleService")
            .field("adc", &self.adc)
            .field("owner", &self.owner)
            .field("project", &self.project)
            .finish_non_exhaustive()
    }
}

impl GoogleService {
    /// From the environment (see the module docs of [`super`]).
    pub fn from_env() -> Self {
        let (adc, adc_error) = match Adc::discover() {
            Ok(a) => (Some(a), None),
            Err(e) => (None, Some(e.to_string())),
        };
        Self {
            adc,
            adc_error,
            owner: OwnerOAuth::from_env(),
            microsoft: OwnerOAuth::microsoft_from_env(),
            admin_token: env("APHRODY_GOOGLE_ADMIN_TOKEN"),
            project: env("GOOGLE_CLOUD_PROJECT").unwrap_or_else(|| PROJECT.to_owned()),
        }
    }
    fn is_admin(&self, headers: &HeaderMap, key: Option<&str>) -> Result<(), Response> {
        let Some(expected) = &self.admin_token else {
            return Err(fail(StatusCode::SERVICE_UNAVAILABLE, "APHRODY_GOOGLE_ADMIN_TOKEN is not configured"));
        };
        let bearer = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "));
        match bearer.or(key) {
            Some(given) if ct_eq(given.as_bytes(), expected.as_bytes()) => Ok(()),
            _ => Err(fail(StatusCode::UNAUTHORIZED, "admin token required")),
        }
    }
}

type Svc = State<Arc<GoogleService>>;

fn fail(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({ "ok": false, "error": msg }))).into_response()
}

fn from_error(e: &Error) -> Response {
    let code = match e {
        Error::Config(_) => StatusCode::SERVICE_UNAVAILABLE,
        Error::OAuth(_) => StatusCode::BAD_REQUEST,
        Error::Api(401 | 403, _) => StatusCode::FORBIDDEN,
        _ => StatusCode::BAD_GATEWAY,
    };
    fail(code, &e.to_string())
}

/// The routes, with state.
pub fn router(svc: Arc<GoogleService>) -> Router {
    Router::new()
        .route("/api/google/status", get(status))
        .route("/api/google/login", get(login))
        .route("/api/google/callback", get(callback))
        .route("/api/google/token/refresh", post(refresh))
        .route("/api/google/token", get(token))
        .route("/api/google/unlink", post(unlink))
        .route("/api/google/drive/root", get(drive_root))
        .route("/api/google/gmail/labels", get(gmail_labels))
        .route("/api/google/calendar/list", get(calendar_list))
        .route("/api/google/youtube/channels", get(youtube_channels))
        .route("/api/google/people/connections", get(people_connections))
        .route("/api/google/gcs/buckets", get(gcs_buckets))
        .route("/api/microsoft/login", get(ms_login))
        .route("/api/microsoft/callback", get(ms_callback))
        .route("/api/microsoft/token", get(ms_token))
        .route("/api/microsoft/onedrive/root", get(ms_onedrive_root))
        .route("/api/microsoft/outlook/messages", get(ms_outlook_messages))
        .route("/api/microsoft/calendar/week", get(ms_calendar_week))
        .with_state(svc)
}

#[derive(Deserialize, Default)]
struct KeyQuery {
    key: Option<String>,
}

async fn status(State(s): Svc, headers: HeaderMap, Query(q): Query<KeyQuery>) -> Response {
    let admin = s.is_admin(&headers, q.key.as_deref()).is_ok();
    let owner = s.owner.status().ok();
    let sa = match &s.adc {
        Some(a) => {
            let probe = a.token(&[]).await;
            json!({
                "configured": true,
                "kind": a.credentials().kind(),
                "principal": a.credentials().principal(),
                "token": probe.as_ref().map(|_| "ok").unwrap_or("error"),
                "error": probe.err().map(|e| e.to_string()),
            })
        }
        None => json!({ "configured": false, "error": s.adc_error }),
    };
    let view = |o: Option<super::oauth::OwnerStatus>| match (o, admin) {
        (Some(o), true) => serde_json::to_value(o).unwrap_or_default(),
        (Some(o), false) => json!({ "client_configured": o.client_configured, "linked": o.linked }),
        (None, _) => json!({ "client_configured": false, "linked": false }),
    };
    let owner_json = view(owner);
    let microsoft_json = view(s.microsoft.status().ok());
    Json(json!({ "ok": true, "project": s.project, "service_account": sa, "owner": owner_json, "microsoft": microsoft_json })).into_response()
}

async fn login(State(s): Svc, headers: HeaderMap, Query(q): Query<KeyQuery>) -> Response {
    start(&s, &s.owner, &headers, q).await
}

async fn ms_login(State(s): Svc, headers: HeaderMap, Query(q): Query<KeyQuery>) -> Response {
    start(&s, &s.microsoft, &headers, q).await
}

async fn start(s: &GoogleService, broker: &OwnerOAuth, headers: &HeaderMap, q: KeyQuery) -> Response {
    if let Err(r) = s.is_admin(headers, q.key.as_deref()) {
        return r;
    }
    match broker.begin().await {
        Ok(url) => Redirect::to(&url).into_response(),
        Err(e) => from_error(&e),
    }
}

#[derive(Deserialize)]
struct CallbackQuery {
    state: Option<String>,
    code: Option<String>,
    error: Option<String>,
}

async fn callback(State(s): Svc, Query(q): Query<CallbackQuery>) -> Response {
    finish(&s.owner, "Google", q).await
}

async fn ms_callback(State(s): Svc, Query(q): Query<CallbackQuery>) -> Response {
    finish(&s.microsoft, "Microsoft", q).await
}

async fn finish(broker: &OwnerOAuth, label: &str, q: CallbackQuery) -> Response {
    let page = |code: StatusCode, title: &str, body: &str| {
        (
            code,
            Html(format!(
                "<!doctype html><meta charset=utf-8><title>{title}</title><body style=\"font:16px system-ui;margin:3em\"><h1>{title}</h1><p>{body}</p>"
            )),
        )
            .into_response()
    };
    if let Some(err) = q.error {
        let err: String = err.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
        return page(StatusCode::BAD_REQUEST, &format!("{label} sign-in cancelled"), &err);
    }
    let (Some(state), Some(code)) = (q.state, q.code) else {
        return page(StatusCode::BAD_REQUEST, "Missing parameters", "state and code are required");
    };
    match broker.complete(&state, &code).await {
        Ok(st) => page(
            StatusCode::OK,
            &format!("{label} account linked"),
            &format!(
                "Bun OS can now use {} ({} scopes). You can close this tab.",
                st.email.unwrap_or_else(|| "the account".into()),
                st.scopes.len()
            ),
        ),
        Err(e) => page(StatusCode::BAD_REQUEST, &format!("{label} sign-in failed"), &e.to_string()),
    }
}

async fn refresh(State(s): Svc, headers: HeaderMap) -> Response {
    if let Err(r) = s.is_admin(&headers, None) {
        return r;
    }
    let owner = s.owner.refresh().await;
    let sa = match &s.adc {
        Some(a) => {
            a.invalidate().await;
            a.token(&[]).await.map(|_| ())
        }
        None => Err(Error::Config("no ADC".into())),
    };
    Json(json!({
        "ok": owner.is_ok() || sa.is_ok(),
        "owner": match &owner { Ok(ttl) => json!({"ok": true, "expires_in": ttl}), Err(e) => json!({"ok": false, "error": e.to_string()}) },
        "service_account": match &sa { Ok(()) => json!({"ok": true}), Err(e) => json!({"ok": false, "error": e.to_string()}) },
    }))
    .into_response()
}

#[derive(Deserialize)]
struct TokenQuery {
    account: Option<String>,
    scope: Option<String>,
}

async fn token(State(s): Svc, headers: HeaderMap, Query(q): Query<TokenQuery>) -> Response {
    if let Err(r) = s.is_admin(&headers, None) {
        return r;
    }
    let res = match q.account.as_deref().unwrap_or("owner") {
        "owner" => s.owner.access_token().await,
        "service" => match &s.adc {
            Some(a) => {
                let scopes: Vec<&str> = q.scope.as_deref().map(|v| v.split_whitespace().collect()).unwrap_or_default();
                a.token(&scopes).await
            }
            None => Err(Error::Config("no ADC".into())),
        },
        _ => return fail(StatusCode::BAD_REQUEST, "account must be owner or service"),
    };
    match res {
        Ok(t) => (
            [(header::CACHE_CONTROL, "no-store")],
            Json(json!({ "ok": true, "access_token": t, "token_type": "Bearer" })),
        )
            .into_response(),
        Err(e) => from_error(&e),
    }
}

async fn unlink(State(s): Svc, headers: HeaderMap) -> Response {
    if let Err(r) = s.is_admin(&headers, None) {
        return r;
    }
    match s.owner.unlink().await {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => from_error(&e),
    }
}

macro_rules! owner_route {
    ($name:ident, $call:expr) => {
        async fn $name(State(s): Svc, headers: HeaderMap) -> Response {
            if let Err(r) = s.is_admin(&headers, None) {
                return r;
            }
            let t = match s.owner.access_token().await {
                Ok(t) => t,
                Err(e) => return from_error(&e),
            };
            #[allow(clippy::redundant_closure_call)]
            match ($call)(t).await {
                Ok(v) => Json(v).into_response(),
                Err(e) => from_error(&e),
            }
        }
    };
}

owner_route!(drive_root, |t: String| async move { api::drive_root(&t, 50).await });
owner_route!(gmail_labels, |t: String| async move { api::gmail_labels(&t).await });
owner_route!(calendar_list, |t: String| async move { api::calendar_list(&t).await });
owner_route!(youtube_channels, |t: String| async move { api::youtube_my_channels(&t).await });
owner_route!(people_connections, |t: String| async move { api::people_connections(&t, 100).await });

async fn gcs_buckets(State(s): Svc, headers: HeaderMap) -> Response {
    if let Err(r) = s.is_admin(&headers, None) {
        return r;
    }
    let Some(a) = &s.adc else {
        return fail(StatusCode::SERVICE_UNAVAILABLE, "no ADC");
    };
    let res = match a.token(&[]).await {
        Ok(t) => api::gcs_buckets(&t, &s.project).await,
        Err(e) => Err(e),
    };
    match res {
        Ok(v) => Json(v).into_response(),
        Err(e) => from_error(&e),
    }
}

async fn ms_token(State(s): Svc, headers: HeaderMap) -> Response {
    if let Err(r) = s.is_admin(&headers, None) {
        return r;
    }
    match s.microsoft.access_token().await {
        Ok(t) => (
            [(header::CACHE_CONTROL, "no-store")],
            Json(json!({ "ok": true, "access_token": t, "token_type": "Bearer" })),
        )
            .into_response(),
        Err(e) => from_error(&e),
    }
}

macro_rules! ms_route {
    ($name:ident, $call:expr) => {
        async fn $name(State(s): Svc, headers: HeaderMap) -> Response {
            if let Err(r) = s.is_admin(&headers, None) {
                return r;
            }
            let t = match s.microsoft.access_token().await {
                Ok(t) => t,
                Err(e) => return from_error(&e),
            };
            #[allow(clippy::redundant_closure_call)]
            match ($call)(t).await {
                Ok(v) => Json(v).into_response(),
                Err(e) => from_error(&e),
            }
        }
    };
}

/// RFC 3339 UTC timestamp of a Unix time (civil-from-days, proleptic Gregorian).
fn rfc3339(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

ms_route!(ms_onedrive_root, |t: String| async move { api::onedrive_root(&t).await });
ms_route!(ms_outlook_messages, |t: String| async move { api::outlook_messages(&t, 25).await });
ms_route!(ms_calendar_week, |t: String| async move {
    let now = super::now();
    api::graph_calendar_view(&t, &rfc3339(now), &rfc3339(now + 7 * 86_400)).await
});
