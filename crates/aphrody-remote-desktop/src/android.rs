// SPDX-License-Identifier: Apache-2.0
//! Android sessions in the browser: a pinned scrcpy server (v5.0.1, Apache-2.0, Genymobile/scrcpy)
//! is pushed to the device over adb and streams H.264 with no re-encoding. The browser decodes it
//! with WebCodecs. Input arrives as `aphrody_webos_protocol::Input` JSON and becomes scrcpy control
//! messages (touch, scroll, keycodes, text, clipboard); the device clipboard comes back as
//! `ServerEvent::Clipboard`.
//!
//! WebSocket binary frames: `[kind u8][pts u64 BE][payload]`, kind 1 = codec config (SPS/PPS,
//! Annex B), 2 = key frame, 3 = delta frame. Text frames: `ServerEvent` JSON, plus
//! `{"t":"video","codec":"avc1.xxxxxx","width":W,"height":H}` whenever the stream starts or the
//! device rotates.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use aphrody_webos_protocol::{Input, ServerEvent};
use axum::Router;
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

pub const SCRCPY_VERSION: &str = "5.0.1";
pub const SCRCPY_SERVER_SHA256: &str = "764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536";
const REMOTE_JAR: &str = "/data/local/tmp/scrcpy-server.jar";
const VIEWER_HTML: &str = include_str!("android-viewer.html");

/// Options of [`serve_android`].
#[derive(Debug, Clone)]
pub struct AndroidOptions {
    pub bind: SocketAddr,
    pub token: String,
    /// adb serial, e.g. `127.0.0.1:5555` for the redroid container.
    pub serial: String,
    pub adb: PathBuf,
    /// Local copy of `scrcpy-server-v5.0.1` (verified against [`SCRCPY_SERVER_SHA256`]).
    pub server_jar: PathBuf,
    pub max_size: u32,
    pub max_fps: u32,
    pub bit_rate: u32,
}

struct AppState {
    opts: AndroidOptions,
    /// Generation of the newest stream: an older session stops when a newer one starts.
    generation: AtomicU64,
}

/// Run the Android gateway until Ctrl-C.
pub async fn serve_android(opts: AndroidOptions) -> Result<()> {
    if opts.token.is_empty() {
        bail!("refusing to serve without an authentication token");
    }
    verify_jar(&opts.server_jar)?;
    let bind = opts.bind;
    let listener = tokio::net::TcpListener::bind(bind).await.with_context(|| format!("cannot bind {bind}"))?;
    axum::serve(listener, router(opts))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .context("android gateway failed")
}

fn verify_jar(path: &PathBuf) -> Result<()> {
    use sha2::Digest as _;
    let bytes = std::fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    let sum: String = sha2::Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    if sum != SCRCPY_SERVER_SHA256 {
        bail!("{} is not scrcpy-server v{SCRCPY_VERSION} (sha256 {sum})", path.display());
    }
    Ok(())
}

/// Routes under `/api/android/`: viewer page, health and the stream WebSocket.
pub fn router(opts: AndroidOptions) -> Router {
    let st = Arc::new(AppState { opts, generation: AtomicU64::new(0) });
    Router::new()
        .route("/api/android/", get(viewer))
        .route("/api/android/health", get(health))
        .route("/api/android/stream", get(stream))
        .with_state(st)
}

async fn viewer() -> impl IntoResponse {
    ([(header::CACHE_CONTROL, "no-store"), (header::REFERRER_POLICY, "no-referrer")], Html(VIEWER_HTML))
}

async fn health(State(st): State<Arc<AppState>>) -> Response {
    let out = Command::new(&st.opts.adb).args(["-s", &st.opts.serial, "get-state"]).output().await;
    let device = matches!(&out, Ok(o) if String::from_utf8_lossy(&o.stdout).trim() == "device");
    axum::Json(serde_json::json!({"ok": device, "serial": st.opts.serial, "scrcpy": SCRCPY_VERSION})).into_response()
}

/// Bearer token from `Authorization` or the `bearer.<token>` WebSocket subprotocol.
fn bearer(headers: &HeaderMap) -> (Option<String>, Option<String>) {
    let auth = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")))
        .map(|s| s.trim().to_owned());
    let proto = headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').map(str::trim).find(|p| p.starts_with("bearer.")).map(str::to_owned));
    (auth, proto)
}

async fn stream(State(st): State<Arc<AppState>>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    let (auth, proto) = bearer(&headers);
    let given = auth.or_else(|| proto.as_deref().and_then(|p| p.strip_prefix("bearer.")).map(str::to_owned)).unwrap_or_default();
    if !aphrody_secrets::constant_time_eq(given.as_bytes(), st.opts.token.as_bytes()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let ws = match proto {
        Some(p) => ws.protocols([p]),
        None => ws,
    };
    ws.on_upgrade(move |socket| async move {
        let generation = st.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Err(e) = session(socket, Arc::clone(&st), generation).await {
            eprintln!("android session ended: {e:#}");
        }
    })
}

// ---- adb + scrcpy server ------------------------------------------------------------------------

struct Device {
    child: Child,
    port: u16,
    adb: PathBuf,
    serial: String,
}

impl Drop for Device {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
        let _ = std::process::Command::new(&self.adb).args(["-s", &self.serial, "forward", "--remove", &format!("tcp:{}", self.port)]).output();
    }
}

async fn adb(opts: &AndroidOptions, args: &[&str]) -> Result<String> {
    let out = Command::new(&opts.adb).arg("-s").arg(&opts.serial).args(args).output().await.context("adb")?;
    if !out.status.success() {
        bail!("adb {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

async fn start_device(opts: &AndroidOptions) -> Result<(Device, TcpStream, TcpStream)> {
    if opts.serial.contains(':') {
        let _ = Command::new(&opts.adb).args(["connect", &opts.serial]).output().await;
    }
    adb(opts, &["push", &opts.server_jar.to_string_lossy(), REMOTE_JAR]).await?;
    let mut r = [0u8; 4];
    getrandom::fill(&mut r).map_err(|e| anyhow::anyhow!("random: {e}"))?;
    let scid = u32::from_le_bytes(r) & 0x7fff_ffff;
    let scid_hex = format!("{scid:08x}");
    let mut args = vec![
        format!("CLASSPATH={REMOTE_JAR}"),
        "app_process".into(),
        "/".into(),
        "com.genymobile.scrcpy.Server".into(),
        SCRCPY_VERSION.into(),
        format!("scid={scid_hex}"),
        "tunnel_forward=true".into(),
        "audio=false".into(),
        "control=true".into(),
        "video_codec=h264".into(),
        "cleanup=false".into(),
        "log_level=info".into(),
    ];
    if opts.max_size > 0 {
        args.push(format!("max_size={}", opts.max_size));
    }
    if opts.max_fps > 0 {
        args.push(format!("max_fps={}", opts.max_fps));
    }
    if opts.bit_rate > 0 {
        args.push(format!("video_bit_rate={}", opts.bit_rate));
    }
    let child = Command::new(&opts.adb)
        .arg("-s")
        .arg(&opts.serial)
        .arg("shell")
        .args(&args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .context("cannot start the scrcpy server")?;
    let port: u16 = adb(opts, &["forward", "tcp:0", &format!("localabstract:scrcpy_{scid_hex}")]).await?.parse().context("adb forward port")?;
    let device = Device { child, port, adb: opts.adb.clone(), serial: opts.serial.clone() };
    // adb accepts at once; the server is up when the first socket yields its dummy byte.
    let mut video = None;
    for _ in 0..100 {
        if let Ok(s) = TcpStream::connect(("127.0.0.1", port)).await {
            let mut b = [0u8; 1];
            if let Ok(Ok(1)) = tokio::time::timeout(Duration::from_millis(1500), s.peek(&mut b)).await {
                video = Some(s);
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let video = video.context("the scrcpy server did not accept a connection")?;
    let control = TcpStream::connect(("127.0.0.1", port)).await.context("scrcpy control socket")?;
    video.set_nodelay(true)?;
    control.set_nodelay(true)?;
    Ok((device, video, control))
}

/// `avc1.PPCCLL` from the SPS of an Annex B config packet.
fn avc_codec(annexb: &[u8]) -> Option<String> {
    let mut i = 0;
    while i + 4 < annexb.len() {
        if annexb[i] == 0 && annexb[i + 1] == 0 && annexb[i + 2] == 1 {
            let n = i + 3;
            if annexb[n] & 0x1f == 7 && n + 3 < annexb.len() {
                return Some(format!("avc1.{:02x}{:02x}{:02x}", annexb[n + 1], annexb[n + 2], annexb[n + 3]));
            }
        }
        i += 1;
    }
    None
}

enum Out {
    Text(String),
    Binary(Vec<u8>),
}

async fn video_loop(mut video: TcpStream, tx: mpsc::Sender<Out>, size: Arc<(AtomicU64, AtomicU64)>) -> Result<()> {
    let mut b = [0u8; 1];
    video.read_exact(&mut b).await?; // dummy byte
    let mut name = [0u8; 64];
    video.read_exact(&mut name).await?;
    let codec_id = video.read_u32().await?;
    if codec_id != 0x6832_3634 {
        bail!("unexpected codec id {codec_id:#x}");
    }
    let mut codec = String::from("avc1.42c028");
    loop {
        let mut head = [0u8; 12];
        video.read_exact(&mut head).await?;
        let hi = u32::from_be_bytes([head[0], head[1], head[2], head[3]]);
        let lo = u32::from_be_bytes([head[4], head[5], head[6], head[7]]);
        let third = u32::from_be_bytes([head[8], head[9], head[10], head[11]]);
        if hi & 0x8000_0000 != 0 {
            size.0.store(u64::from(lo), Ordering::Relaxed);
            size.1.store(u64::from(third), Ordering::Relaxed);
            let msg = serde_json::json!({"t": "video", "codec": codec, "width": lo, "height": third});
            if tx.send(Out::Text(msg.to_string())).await.is_err() {
                return Ok(());
            }
            continue;
        }
        let config = hi & 0x4000_0000 != 0;
        let key = hi & 0x2000_0000 != 0;
        let pts = (u64::from(hi & 0x1fff_ffff) << 32) | u64::from(lo);
        let mut data = vec![0u8; third as usize + 9];
        video.read_exact(&mut data[9..]).await?;
        data[0] = if config { 1 } else if key { 2 } else { 3 };
        data[1..9].copy_from_slice(&pts.to_be_bytes());
        if config && let Some(c) = avc_codec(&data[9..]) {
            codec = c;
            let (w, h) = (size.0.load(Ordering::Relaxed), size.1.load(Ordering::Relaxed));
            let msg = serde_json::json!({"t": "video", "codec": codec, "width": w, "height": h});
            if tx.send(Out::Text(msg.to_string())).await.is_err() {
                return Ok(());
            }
        }
        // Never drop a frame: a missing delta corrupts the picture until the next key frame.
        if tx.send(Out::Binary(data)).await.is_err() {
            return Ok(());
        }
    }
}

async fn device_messages(mut control: OwnedReadHalf, tx: mpsc::Sender<Out>) -> Result<()> {
    loop {
        match control.read_u8().await? {
            0 => {
                let len = control.read_u32().await? as usize;
                let mut text = vec![0u8; len.min(1 << 22)];
                control.read_exact(&mut text).await?;
                let ev = ServerEvent::Clipboard { text: String::from_utf8_lossy(&text).into_owned() };
                if tx.send(Out::Text(serde_json::to_string(&ev)?)).await.is_err() {
                    return Ok(());
                }
            }
            1 => {
                control.read_u64().await?;
            }
            2 => {
                control.read_u16().await?;
                let n = control.read_u16().await? as usize;
                let mut skip = vec![0u8; n];
                control.read_exact(&mut skip).await?;
            }
            t => bail!("unknown scrcpy device message {t}"),
        }
    }
}

// ---- input -> scrcpy control messages ---------------------------------------------------------

const AMETA_SHIFT: i32 = 0x41;
const AMETA_ALT: i32 = 0x12;
const AMETA_CTRL: i32 = 0x3000;
const AMETA_META: i32 = 0x3_0000;

/// Android `KeyEvent` keycode of a `KeyboardEvent.code`.
fn android_keycode(code: &str) -> Option<i32> {
    if let Some(l) = code.strip_prefix("Key") {
        let b = l.as_bytes();
        if b.len() == 1 && b[0].is_ascii_uppercase() {
            return Some(29 + i32::from(b[0] - b'A'));
        }
    }
    if let Some(d) = code.strip_prefix("Digit") {
        let b = d.as_bytes();
        if b.len() == 1 && b[0].is_ascii_digit() {
            return Some(7 + i32::from(b[0] - b'0'));
        }
    }
    if let Some(n) = code.strip_prefix('F').and_then(|n| n.parse::<i32>().ok())
        && (1..=12).contains(&n)
    {
        return Some(130 + n);
    }
    Some(match code {
        "Enter" | "NumpadEnter" => 66,
        "Backspace" => 67,
        "Delete" => 112,
        "Tab" => 61,
        "Escape" | "BrowserBack" => 4,
        "Space" => 62,
        "ArrowUp" => 19,
        "ArrowDown" => 20,
        "ArrowLeft" => 21,
        "ArrowRight" => 22,
        "Home" => 122,
        "End" => 123,
        "PageUp" => 92,
        "PageDown" => 93,
        "Insert" => 124,
        "Minus" => 69,
        "Equal" => 70,
        "BracketLeft" => 71,
        "BracketRight" => 72,
        "Backslash" => 73,
        "Semicolon" => 74,
        "Quote" => 75,
        "Slash" => 76,
        "Comma" => 55,
        "Period" => 56,
        "Backquote" => 68,
        "ShiftLeft" => 59,
        "ShiftRight" => 60,
        "ControlLeft" => 113,
        "ControlRight" => 114,
        "AltLeft" => 57,
        "AltRight" => 58,
        "MetaLeft" | "OSLeft" => 117,
        "MetaRight" | "OSRight" => 118,
        "CapsLock" => 115,
        "ContextMenu" => 82,
        "AudioVolumeUp" => 24,
        "AudioVolumeDown" => 25,
        "BrowserHome" => 3,
        _ => return None,
    })
}

fn touch(action: u8, x: i32, y: i32, w: u16, h: u16) -> Vec<u8> {
    let mut m = Vec::with_capacity(32);
    m.push(2);
    m.push(action);
    m.extend_from_slice(&0xffff_ffff_ffff_fffe_u64.to_be_bytes());
    m.extend_from_slice(&x.to_be_bytes());
    m.extend_from_slice(&y.to_be_bytes());
    m.extend_from_slice(&w.to_be_bytes());
    m.extend_from_slice(&h.to_be_bytes());
    m.extend_from_slice(&(if action == 1 { 0u16 } else { 0xffff }).to_be_bytes());
    m.extend_from_slice(&0i32.to_be_bytes()); // action button (mouse only)
    m.extend_from_slice(&0i32.to_be_bytes()); // buttons (mouse only)
    m
}

fn keycode(down: bool, code: i32, meta: i32) -> Vec<u8> {
    let mut m = vec![0, u8::from(!down)];
    m.extend_from_slice(&code.to_be_bytes());
    m.extend_from_slice(&0i32.to_be_bytes());
    m.extend_from_slice(&meta.to_be_bytes());
    m
}

fn with_text(kind: u8, prefix: &[u8], text: &str) -> Vec<u8> {
    let mut m = vec![kind];
    m.extend_from_slice(prefix);
    m.extend_from_slice(&u32::try_from(text.len()).unwrap_or(u32::MAX).to_be_bytes());
    m.extend_from_slice(text.as_bytes());
    m
}

fn scroll(x: i32, y: i32, w: u16, h: u16, dx: f32, dy: f32) -> Vec<u8> {
    let f = |n: f32| ((n.clamp(-16.0, 16.0) / 16.0) * 32767.0).round() as i16;
    let mut m = vec![3];
    m.extend_from_slice(&x.to_be_bytes());
    m.extend_from_slice(&y.to_be_bytes());
    m.extend_from_slice(&w.to_be_bytes());
    m.extend_from_slice(&h.to_be_bytes());
    m.extend_from_slice(&f(dx).to_be_bytes());
    m.extend_from_slice(&f(dy).to_be_bytes());
    m.extend_from_slice(&0i32.to_be_bytes());
    m
}

#[derive(Default)]
struct InputState {
    buttons: u8,
    x: i32,
    y: i32,
    meta: i32,
    clip_seq: u64,
}

fn translate(input: Input, s: &mut InputState, size: &(AtomicU64, AtomicU64)) -> Vec<Vec<u8>> {
    let w = u16::try_from(size.0.load(Ordering::Relaxed)).unwrap_or(u16::MAX);
    let h = u16::try_from(size.1.load(Ordering::Relaxed)).unwrap_or(u16::MAX);
    match input {
        Input::Pointer { x, y, buttons } => {
            s.x = x.round() as i32;
            s.y = y.round() as i32;
            let (was, now) = (s.buttons & 1 != 0, buttons & 1 != 0);
            let back_edge = buttons & 2 != 0 && s.buttons & 2 == 0;
            s.buttons = buttons;
            let mut out = Vec::new();
            match (was, now) {
                (false, true) => out.push(touch(0, s.x, s.y, w, h)),
                (true, true) => out.push(touch(2, s.x, s.y, w, h)),
                (true, false) => out.push(touch(1, s.x, s.y, w, h)),
                (false, false) => {}
            }
            if back_edge {
                out.push(keycode(true, 4, 0));
                out.push(keycode(false, 4, 0));
            }
            out
        }
        Input::Wheel { dx, dy } => vec![scroll(s.x, s.y, w, h, -dx / 50.0, -dy / 50.0)],
        Input::Key { code, key, down } => {
            let bit = match code.as_str() {
                "ShiftLeft" | "ShiftRight" => AMETA_SHIFT,
                "ControlLeft" | "ControlRight" => AMETA_CTRL,
                "AltLeft" | "AltRight" => AMETA_ALT,
                "MetaLeft" | "MetaRight" | "OSLeft" | "OSRight" => AMETA_META,
                _ => 0,
            };
            if bit != 0 {
                if down { s.meta |= bit } else { s.meta &= !bit }
            }
            let chorded = s.meta & (AMETA_CTRL | AMETA_ALT | AMETA_META) != 0;
            if !chorded && bit == 0 && key.chars().count() == 1 {
                return if down { vec![with_text(1, &[], &key)] } else { Vec::new() };
            }
            android_keycode(&code).map(|k| vec![keycode(down, k, s.meta)]).unwrap_or_default()
        }
        Input::Clipboard { text } => {
            s.clip_seq += 1;
            let mut prefix = s.clip_seq.to_be_bytes().to_vec();
            prefix.push(1); // paste: the browser only sends its clipboard on a paste gesture
            vec![with_text(9, &prefix, &text)]
        }
        Input::Resize { .. } | Input::Gamepad(_) => Vec::new(),
    }
}

async fn session(mut socket: WebSocket, st: Arc<AppState>, generation: u64) -> Result<()> {
    let (device, video, control) = match start_device(&st.opts).await {
        Ok(v) => v,
        Err(e) => {
            let ev = ServerEvent::Error { message: format!("{e:#}") };
            let _ = socket.send(Message::Text(serde_json::to_string(&ev)?.into())).await;
            return Err(e);
        }
    };
    let (ctl_read, mut ctl_write): (OwnedReadHalf, OwnedWriteHalf) = control.into_split();
    let size = Arc::new((AtomicU64::new(0), AtomicU64::new(0)));
    let (tx, mut rx) = mpsc::channel::<Out>(8);
    let video_task = tokio::spawn(video_loop(video, tx.clone(), Arc::clone(&size)));
    let msg_task = tokio::spawn(device_messages(ctl_read, tx));
    let running = serde_json::to_string(&ServerEvent::State { state: aphrody_webos_protocol::SessionState::Running })?;
    socket.send(Message::Text(running.into())).await?;
    let mut input = InputState::default();
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    let result = loop {
        tokio::select! {
            out = rx.recv() => match out {
                Some(Out::Text(t)) => if socket.send(Message::Text(t.into())).await.is_err() { break Ok(()) },
                Some(Out::Binary(b)) => if socket.send(Message::Binary(b.into())).await.is_err() { break Ok(()) },
                None => break Err(anyhow::anyhow!("the device stream ended")),
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Text(t))) => {
                    if let Ok(i) = serde_json::from_str::<Input>(t.as_str()) {
                        for m in translate(i, &mut input, &size) {
                            if ctl_write.write_all(&m).await.is_err() { break; }
                        }
                    }
                }
                Some(Ok(Message::Close(_)) | Err(_)) | None => break Ok(()),
                Some(Ok(_)) => {}
            },
            _ = tick.tick() => if st.generation.load(Ordering::SeqCst) != generation { break Ok(()) },
        }
    };
    video_task.abort();
    msg_task.abort();
    drop(device);
    result
}
