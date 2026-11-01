// SPDX-License-Identifier: Apache-2.0
//! HTTP + WebSocket server: viewer page, `/healthz` and the `/ws` session.

use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::backend::{MouseButton, create_backend};
use crate::encode::{encode_jpeg, frame_hash};
use crate::protocol::ClientMsg;

const VIEWER_HTML: &str = include_str!("viewer.html");

/// Options of [`serve`].
#[derive(Debug, Clone)]
pub struct ServeOptions {
    pub bind: SocketAddr,
    /// Bearer token required by `/ws`. Must not be empty.
    pub token: String,
    pub fps: u32,
    pub quality: u8,
    pub scale: u8,
}

impl Default for ServeOptions {
    fn default() -> Self {
        Self {
            bind: SocketAddr::from(([127, 0, 0, 1], 8795)),
            token: String::new(),
            fps: 15,
            quality: 70,
            scale: 1,
        }
    }
}

/// Constant-time (w.r.t. content) equality of two tokens.
fn tokens_equal(a: &str, b: &str) -> bool {
    aphrody_secrets::constant_time_eq(a.as_bytes(), b.as_bytes())
}

#[derive(Deserialize, Default)]
struct TokenQuery {
    token: Option<String>,
}

fn authorized(headers: &HeaderMap, query: &TokenQuery, expected: &str) -> bool {
    // The production desktop is reachable only through cloudflared on loopback,
    // with the whole hostname protected by Cloudflare Access. Access validates
    // this assertion at the edge, including for WebSocket upgrades, so users do
    // not need a second bearer token embedded in a URL fragment.
    if headers
        .get("cf-access-jwt-assertion")
        .is_some_and(|v| !v.as_bytes().is_empty())
    {
        return true;
    }

    let from_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.strip_prefix("Bearer ")
                .or_else(|| v.strip_prefix("bearer "))
        });
    let mut ok = false;
    if let Some(t) = from_header {
        ok |= tokens_equal(t.trim(), expected);
    }
    if let Some(t) = query.token.as_deref() {
        ok |= tokens_equal(t, expected);
    }
    ok
}

struct AppState {
    opts: ServeOptions,
}

/// Run the server until Ctrl-C.
pub async fn serve(opts: ServeOptions) -> Result<()> {
    if opts.token.is_empty() {
        bail!("refusing to serve without an authentication token");
    }
    let bind = opts.bind;
    let app = router(opts);
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .with_context(|| format!("cannot bind {bind}"))?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .context("remote desktop server failed")
}

fn router(opts: ServeOptions) -> Router {
    Router::new()
        .route("/", get(viewer))
        .route("/healthz", get(|| async { "ok" }))
        .route("/ws", get(ws_handler))
        .with_state(Arc::new(AppState { opts }))
}

async fn viewer() -> impl IntoResponse {
    (
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::REFERRER_POLICY, "no-referrer"),
        ],
        Html(VIEWER_HTML),
    )
}

async fn ws_handler(
    State(st): State<Arc<AppState>>,
    Query(q): Query<TokenQuery>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !authorized(&headers, &q, &st.opts.token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ws.on_upgrade(move |socket| session(socket, st))
}

/// Settings shared between the socket task and the worker threads.
struct Shared {
    fps: AtomicU32,
    quality: AtomicU32,
    scale: AtomicU32,
    force: AtomicBool,
    origin_x: AtomicI32,
    origin_y: AtomicI32,
    stop: AtomicBool,
}

enum Out {
    Hello(String),
    Jpeg(Vec<u8>),
    Error(String),
}

enum Input {
    Move(i32, i32),
    Button(MouseButton, bool),
    Wheel(i32, i32),
    Key(String, bool),
    Text(String),
}

async fn session(mut socket: WebSocket, st: Arc<AppState>) {
    let shared = Arc::new(Shared {
        fps: AtomicU32::new(st.opts.fps.clamp(1, 60)),
        quality: AtomicU32::new(u32::from(st.opts.quality.clamp(1, 100))),
        scale: AtomicU32::new(u32::from(st.opts.scale.clamp(1, 4))),
        force: AtomicBool::new(true),
        origin_x: AtomicI32::new(0),
        origin_y: AtomicI32::new(0),
        stop: AtomicBool::new(false),
    });
    let (out_tx, mut out_rx) = mpsc::channel::<Out>(2);
    let (in_tx, in_rx) = std::sync::mpsc::sync_channel::<Input>(512);

    let cap_shared = Arc::clone(&shared);
    let cap = std::thread::Builder::new()
        .name("rd-capture".into())
        .spawn(move || capture_loop(&cap_shared, &out_tx));
    let inp_shared = Arc::clone(&shared);
    let inp = std::thread::Builder::new()
        .name("rd-input".into())
        .spawn(move || input_loop(&inp_shared, &in_rx));
    if cap.is_err() || inp.is_err() {
        shared.stop.store(true, Ordering::Relaxed);
        return;
    }

    loop {
        tokio::select! {
            out = out_rx.recv() => match out {
                Some(Out::Hello(s)) => {
                    if socket.send(Message::Text(s.into())).await.is_err() { break; }
                }
                Some(Out::Jpeg(j)) => {
                    if socket.send(Message::Binary(j.into())).await.is_err() { break; }
                }
                Some(Out::Error(e)) => {
                    let msg = serde_json::json!({"type": "error", "message": e}).to_string();
                    let _ = socket.send(Message::Text(msg.into())).await;
                    break;
                }
                None => break,
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Text(t))) => handle_text(t.as_str(), &shared, &in_tx),
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
        }
    }
    shared.stop.store(true, Ordering::Relaxed);
}

fn handle_text(text: &str, shared: &Shared, tx: &std::sync::mpsc::SyncSender<Input>) {
    let Ok(msg) = serde_json::from_str::<ClientMsg>(text) else {
        return;
    };
    let input = match msg {
        ClientMsg::MouseMove { x, y } => {
            let s = f64::from(shared.scale.load(Ordering::Relaxed));
            Input::Move(
                shared
                    .origin_x
                    .load(Ordering::Relaxed)
                    .saturating_add((x * s).round() as i32),
                shared
                    .origin_y
                    .load(Ordering::Relaxed)
                    .saturating_add((y * s).round() as i32),
            )
        }
        ClientMsg::MouseDown { button } => Input::Button(MouseButton::parse(&button), true),
        ClientMsg::MouseUp { button } => Input::Button(MouseButton::parse(&button), false),
        ClientMsg::Wheel { dx, dy } => Input::Wheel(dx.round() as i32, -(dy.round() as i32)),
        ClientMsg::Key { code, down } => Input::Key(code, down),
        ClientMsg::Text { text } => Input::Text(text),
        ClientMsg::Config {
            fps,
            quality,
            scale,
        } => {
            if let Some(v) = fps {
                shared.fps.store(v.clamp(1, 60), Ordering::Relaxed);
            }
            if let Some(v) = quality {
                shared.quality.store(v.clamp(1, 100), Ordering::Relaxed);
            }
            if let Some(v) = scale {
                shared.scale.store(v.clamp(1, 4), Ordering::Relaxed);
            }
            shared.force.store(true, Ordering::Relaxed);
            return;
        }
    };
    // Input is best effort: a full queue drops the event rather than stalling the socket.
    let _ = tx.try_send(input);
}

fn capture_loop(shared: &Shared, tx: &mpsc::Sender<Out>) {
    let mut backend = match create_backend() {
        Ok(b) => b,
        Err(e) => {
            let _ = tx.blocking_send(Out::Error(format!("{e:#}")));
            return;
        }
    };
    let os = std::env::consts::OS;
    let name = backend.name();
    let mut last_hash: Option<u64> = None;
    let mut last_geom = (0u32, 0u32, 0i32, 0i32);
    let mut failures = 0u32;
    while !shared.stop.load(Ordering::Relaxed) {
        let started = Instant::now();
        match backend.capture() {
            Ok(frame) => {
                failures = 0;
                shared.origin_x.store(frame.origin_x, Ordering::Relaxed);
                shared.origin_y.store(frame.origin_y, Ordering::Relaxed);
                let geom = (frame.width, frame.height, frame.origin_x, frame.origin_y);
                if geom != last_geom {
                    last_geom = geom;
                    last_hash = None;
                    let hello = serde_json::json!({
                        "type": "hello",
                        "width": frame.width,
                        "height": frame.height,
                        "origin_x": frame.origin_x,
                        "origin_y": frame.origin_y,
                        "os": os,
                        "backend": name,
                    })
                    .to_string();
                    if tx.blocking_send(Out::Hello(hello)).is_err() {
                        return;
                    }
                }
                let hash = frame_hash(&frame.bgra);
                let force = shared.force.swap(false, Ordering::Relaxed);
                if force || last_hash != Some(hash) {
                    let quality = shared.quality.load(Ordering::Relaxed) as u8;
                    let scale = shared.scale.load(Ordering::Relaxed) as u8;
                    match encode_jpeg(&frame.bgra, frame.width, frame.height, quality, scale) {
                        Ok(jpeg) => {
                            if tx.blocking_send(Out::Jpeg(jpeg)).is_err() {
                                return;
                            }
                            last_hash = Some(hash);
                        }
                        Err(e) => {
                            let _ = tx.blocking_send(Out::Error(format!("{e:#}")));
                            return;
                        }
                    }
                }
            }
            Err(e) => {
                // Transient failures happen on the lock screen / secure desktop.
                failures += 1;
                if failures >= 20 {
                    let _ = tx.blocking_send(Out::Error(format!("capture failed: {e:#}")));
                    return;
                }
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
        }
        let fps = shared.fps.load(Ordering::Relaxed).clamp(1, 60);
        let period = Duration::from_micros(1_000_000 / u64::from(fps));
        if let Some(rest) = period.checked_sub(started.elapsed()) {
            std::thread::sleep(rest);
        }
    }
}

fn input_loop(shared: &Shared, rx: &std::sync::mpsc::Receiver<Input>) {
    let Ok(mut backend) = create_backend() else {
        return;
    };
    while let Ok(first) = rx.recv() {
        // Coalesce bursts of pointer moves, keep everything else in order.
        let mut batch = vec![first];
        while let Ok(next) = rx.try_recv() {
            match (batch.last_mut(), next) {
                (Some(last @ Input::Move(..)), next @ Input::Move(..)) => *last = next,
                (_, next) => batch.push(next),
            }
        }
        if shared.stop.load(Ordering::Relaxed) {
            return;
        }
        for ev in batch {
            let _ = match ev {
                Input::Move(x, y) => backend.mouse_move(x, y),
                Input::Button(b, down) => backend.mouse_button(b, down),
                Input::Wheel(dx, dy) => backend.wheel(dx, dy),
                Input::Key(code, down) => backend.key(&code, down),
                Input::Text(t) => backend.text(&t),
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_comparison() {
        assert!(tokens_equal("abc", "abc"));
        assert!(!tokens_equal("abc", "abd"));
        assert!(!tokens_equal("abc", "abcd"));
        assert!(!tokens_equal("", "a"));
        assert!(tokens_equal("", ""));
    }

    #[test]
    fn auth_header_and_query() {
        let none = TokenQuery::default();
        let mut h = HeaderMap::new();
        assert!(!authorized(&h, &none, "secret"));
        h.insert(header::AUTHORIZATION, "Bearer secret".parse().unwrap());
        assert!(authorized(&h, &none, "secret"));
        h.insert(header::AUTHORIZATION, "Bearer nope".parse().unwrap());
        assert!(!authorized(&h, &none, "secret"));
        let q = TokenQuery {
            token: Some("secret".into()),
        };
        assert!(authorized(&HeaderMap::new(), &q, "secret"));
    }

    #[test]
    fn defaults() {
        let o = ServeOptions::default();
        assert_eq!(o.bind.port(), 8795);
        assert_eq!((o.fps, o.quality, o.scale), (15, 70, 1));
        assert!(o.token.is_empty());
    }

    #[tokio::test]
    async fn refuses_empty_token() {
        assert!(serve(ServeOptions::default()).await.is_err());
    }
}
