// SPDX-License-Identifier: Apache-2.0
//! The Bun OS session and the stream bridge (ADR-003). One session type: the unified Bun OS desktop. Until the
//! container session manager (bollard, one container of the unified image per user) lands, the session is the
//! desktop stream the host declares:
//!
//!   WEBOS_SESSION=ws://127.0.0.1:<port>/<path>     stream endpoint
//!   WEBOS_SESSION_TOKEN_FILE=/path/to/token         its access token
//!   WEBOS_SESSION_MODE=native                       the upstream speaks aphrody-webos-protocol (Input JSON in,
//!                                                   ServerEvent JSON and frames out); otherwise the
//!                                                   aphrody-remote-desktop wire is translated
//!
//! `POST /api/sessions` hands out a session id and a per-session bearer token; `GET /api/sessions/{id}/stream`
//! (WebSocket, subprotocol `bearer.<token>`) bridges the client to the upstream; binary frames pass through.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use aphrody_webos_protocol::{
    ApiError, Input, ServerEvent, SessionAvailability, SessionInfo, SessionState, StartSession,
};
use axum::{
    Json, Router,
    extract::{
        Path, State,
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio_tungstenite::tungstenite::Message as UpMessage;

#[derive(Clone)]
struct Upstream {
    url: String,
    token: Option<String>,
    /// Upstream speaks the client protocol: forward both ways unchanged, authenticate with a bearer header.
    native: bool,
}

struct Session {
    token: String,
}

#[derive(Clone)]
pub struct Sessions {
    upstream: Option<Upstream>,
    live: Arc<Mutex<HashMap<String, Session>>>,
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("system randomness");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

impl Sessions {
    pub fn from_env() -> Sessions {
        let upstream = std::env::var("WEBOS_SESSION").ok().filter(|u| !u.is_empty()).map(|url| Upstream {
            url,
            token: std::env::var("WEBOS_SESSION_TOKEN_FILE")
                .ok()
                .and_then(|path| std::fs::read_to_string(path).ok())
                .map(|t| t.trim().to_owned())
                .filter(|t| !t.is_empty()),
            native: std::env::var("WEBOS_SESSION_MODE").is_ok_and(|m| m == "native"),
        });
        Sessions { upstream, live: Arc::new(Mutex::new(HashMap::new())) }
    }

    pub fn availability(&self) -> SessionAvailability {
        SessionAvailability {
            available: self.upstream.is_some(),
            reason: self.upstream.is_none().then(|| "The Bun OS desktop is not running on this host yet.".into()),
        }
    }

    pub fn configured(&self) -> bool {
        self.upstream.is_some()
    }
}

fn error(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(ApiError {
            error: message.into(),
        }),
    )
        .into_response()
}

async fn availability(State(sessions): State<Sessions>) -> Json<SessionAvailability> {
    Json(sessions.availability())
}

async fn start(State(sessions): State<Sessions>, Json(_request): Json<StartSession>) -> Response {
    if sessions.upstream.is_none() {
        return error(StatusCode::SERVICE_UNAVAILABLE, "The Bun OS desktop is not running on this host yet.");
    }
    let id = random_hex(8);
    let token = random_hex(24);
    sessions
        .live
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(
            id.clone(),
            Session {
                token: token.clone(),
            },
        );
    let info = SessionInfo {
        stream: format!("/api/sessions/{id}/stream"),
        id,
        state: SessionState::Running,
        token,
    };
    (StatusCode::CREATED, Json(info)).into_response()
}

async fn stop(State(sessions): State<Sessions>, Path(id): Path<String>) -> StatusCode {
    match sessions
        .live
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&id)
    {
        Some(_) => StatusCode::NO_CONTENT,
        None => StatusCode::NOT_FOUND,
    }
}

async fn stream(
    State(sessions): State<Sessions>,
    Path(id): Path<String>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let offered = headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .find_map(|p| p.strip_prefix("bearer."))
        .map(str::to_owned);
    let upstream = {
        let live = sessions
            .live
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match (live.get(&id), offered.as_deref()) {
            (Some(session), Some(token)) if session.token == token => sessions.upstream.clone(),
            (Some(_), _) => {
                return error(
                    StatusCode::UNAUTHORIZED,
                    "This session token was not accepted.",
                );
            }
            (None, _) => return error(StatusCode::NOT_FOUND, "No such session."),
        }
    };
    let Some(upstream) = upstream else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "The session is no longer available.",
        );
    };
    let protocol = format!("bearer.{}", offered.unwrap_or_default());
    upgrade
        .protocols([protocol])
        .on_upgrade(move |socket| bridge(socket, upstream))
}

/// Remote-desktop wire messages for one protocol input; `buttons` keeps the last DOM button mask.
fn translate(input: Input, buttons: &mut u8) -> Vec<serde_json::Value> {
    match input {
        Input::Pointer { x, y, buttons: now } => {
            let mut out = vec![json!({ "type": "mouse_move", "x": x, "y": y })];
            for (bit, name) in [(1u8, "left"), (2, "right"), (4, "middle")] {
                let (was, is) = (*buttons & bit != 0, now & bit != 0);
                if is && !was {
                    out.push(json!({ "type": "mouse_down", "button": name }));
                } else if was && !is {
                    out.push(json!({ "type": "mouse_up", "button": name }));
                }
            }
            *buttons = now;
            out
        }
        Input::Wheel { dx, dy } => vec![json!({ "type": "wheel", "dx": dx, "dy": dy })],
        Input::Key { code, down, .. } => vec![json!({ "type": "key", "code": code, "down": down })],
        // The remote-desktop backends type clipboard text into the focused window.
        Input::Clipboard { text } => vec![json!({ "type": "text", "text": text })],
        Input::Resize { .. } | Input::Gamepad(_) => Vec::new(),
    }
}

async fn bridge(socket: WebSocket, upstream: Upstream) {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let url = match (&upstream.token, upstream.native) {
        (Some(token), false) => {
            format!(
                "{}{}token={token}",
                upstream.url,
                if upstream.url.contains('?') { '&' } else { '?' }
            )
        }
        _ => upstream.url.clone(),
    };
    let (mut client_tx, mut client_rx) = socket.split();
    let mut request = match url.as_str().into_client_request() {
        Ok(request) => request,
        Err(e) => {
            let event = ServerEvent::Error {
                message: format!("bad desktop stream address: {e}"),
            };
            let _ = client_tx
                .send(WsMessage::Text(
                    serde_json::to_string(&event).unwrap_or_default().into(),
                ))
                .await;
            return;
        }
    };
    if let (Some(token), true) = (&upstream.token, upstream.native)
        && let Ok(value) = format!("Bearer {token}").parse()
    {
        request.headers_mut().insert("authorization", value);
    }
    let native = upstream.native;
    let remote = match tokio_tungstenite::connect_async(request).await {
        Ok((remote, _)) => remote,
        Err(e) => {
            let event = ServerEvent::Error {
                message: format!("the desktop stream is unreachable: {e}"),
            };
            let _ = client_tx
                .send(WsMessage::Text(
                    serde_json::to_string(&event).unwrap_or_default().into(),
                ))
                .await;
            return;
        }
    };
    if !native {
        let state = ServerEvent::State {
            state: SessionState::Running,
        };
        let _ = client_tx
            .send(WsMessage::Text(
                serde_json::to_string(&state).unwrap_or_default().into(),
            ))
            .await;
    }
    let (mut remote_tx, mut remote_rx) = remote.split();
    let down = async {
        while let Some(Ok(message)) = remote_rx.next().await {
            let forwarded = match message {
                UpMessage::Binary(frame) => WsMessage::Binary(frame),
                UpMessage::Text(text) if native => WsMessage::Text(text.as_str().into()),
                UpMessage::Close(_) => break,
                // hello/config replies of the remote-desktop wire are not part of the client protocol.
                _ => continue,
            };
            if client_tx.send(forwarded).await.is_err() {
                break;
            }
        }
    };
    let up = async {
        let mut buttons = 0u8;
        while let Some(Ok(message)) = client_rx.next().await {
            let WsMessage::Text(text) = message else {
                if matches!(message, WsMessage::Close(_)) {
                    break;
                }
                continue;
            };
            if native {
                if remote_tx
                    .send(UpMessage::Text(text.as_str().into()))
                    .await
                    .is_err()
                {
                    return;
                }
                continue;
            }
            let Ok(input) = serde_json::from_str::<Input>(&text) else {
                continue;
            };
            for wire in translate(input, &mut buttons) {
                if remote_tx
                    .send(UpMessage::Text(wire.to_string().into()))
                    .await
                    .is_err()
                {
                    return;
                }
            }
        }
    };
    tokio::select! {
        () = down => {}
        () = up => {}
    }
}

pub fn router(sessions: Sessions) -> Router {
    Router::new()
        .route("/api/session", get(availability))
        .route("/api/sessions", post(start))
        .route("/api/sessions/{id}", axum::routing::delete(stop))
        .route("/api/sessions/{id}/stream", get(stream))
        .with_state(sessions)
}
