// SPDX-License-Identifier: Apache-2.0
//! Sessions and the stream bridge (ADR-003). Until the container session manager (session agent, bollard) lands,
//! the sessions are the running desktops the host declares, one per OS:
//!
//!   WEBOS_SESSION_<OS>=ws://127.0.0.1:<port>/ws          stream endpoint of an `aphrody-remote-desktop` process
//!   WEBOS_SESSION_<OS>_TOKEN_FILE=/path/to/token         its access token (query `?token=`)
//!
//!   WEBOS_SESSION_<OS>_MODE=native                        the upstream already speaks aphrody-webos-protocol
//!                                                          (Input JSON in, ServerEvent JSON and frames out)
//!
//! with `<OS>` one of POP_OS, REDOX, ANDROID, WINE, PROTON. `POST /api/sessions` hands out a session id and a
//! per-session bearer token; `GET /api/sessions/{id}/stream` (WebSocket, subprotocol `bearer.<token>`) bridges the
//! client to the upstream desktop and translates `aphrody-webos-protocol` [`Input`] into the remote-desktop wire
//! (`{type: mouse_move|mouse_down|mouse_up|wheel|key|text}`); binary frames pass through unchanged.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use aphrody_webos_protocol::{
    ApiError, Input, OsEntry, OsId, ServerEvent, SessionInfo, SessionState, StartSession,
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
    os: OsId,
    token: String,
}

#[derive(Clone)]
pub struct Sessions {
    upstreams: Arc<HashMap<OsId, Upstream>>,
    live: Arc<Mutex<HashMap<String, Session>>>,
}

fn env_key(os: OsId) -> &'static str {
    match os {
        OsId::PopOs => "POP_OS",
        OsId::Redox => "REDOX",
        OsId::Android => "ANDROID",
        OsId::Wine => "WINE",
        OsId::Proton => "PROTON",
    }
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("system randomness");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

impl Sessions {
    pub fn from_env() -> Sessions {
        let mut upstreams = HashMap::new();
        for os in OsId::ALL {
            let key = env_key(os);
            if let Ok(url) = std::env::var(format!("WEBOS_SESSION_{key}")) {
                let token = std::env::var(format!("WEBOS_SESSION_{key}_TOKEN_FILE"))
                    .ok()
                    .and_then(|path| std::fs::read_to_string(path).ok())
                    .map(|t| t.trim().to_owned())
                    .filter(|t| !t.is_empty());
                let native =
                    std::env::var(format!("WEBOS_SESSION_{key}_MODE")).is_ok_and(|m| m == "native");
                upstreams.insert(os, Upstream { url, token, native });
            }
        }
        Sessions {
            upstreams: Arc::new(upstreams),
            live: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn catalog(&self) -> Vec<OsEntry> {
        OsId::ALL
            .iter()
            .map(|&id| {
                let available = self.upstreams.contains_key(&id);
                OsEntry {
                    id,
                    name: id.name().into(),
                    summary: id.summary().into(),
                    available,
                    reason: (!available)
                        .then(|| "No session of this system runs on this host yet.".into()),
                }
            })
            .collect()
    }

    pub fn configured(&self) -> usize {
        self.upstreams.len()
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

async fn catalog(State(sessions): State<Sessions>) -> Json<Vec<OsEntry>> {
    Json(sessions.catalog())
}

async fn start(State(sessions): State<Sessions>, Json(request): Json<StartSession>) -> Response {
    if !sessions.upstreams.contains_key(&request.os) {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            &format!("No {} session runs on this host yet.", request.os.name()),
        );
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
                os: request.os,
                token: token.clone(),
            },
        );
    let info = SessionInfo {
        stream: format!("/api/sessions/{id}/stream"),
        id,
        os: request.os,
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
            (Some(session), Some(token)) if session.token == token => {
                sessions.upstreams.get(&session.os).cloned()
            }
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
        .route("/api/os", get(catalog))
        .route("/api/sessions", post(start))
        .route("/api/sessions/{id}", axum::routing::delete(stop))
        .route("/api/sessions/{id}/stream", get(stream))
        .with_state(sessions)
}
