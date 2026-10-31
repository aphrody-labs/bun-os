// SPDX-License-Identifier: Apache-2.0
//! Browser transport of the wasm client: fetch for the API, the session WebSocket, the Gamepad API and the
//! clipboard. No UI is built here; everything visible is iced/libcosmic.

use std::cell::RefCell;
use std::rc::Rc;

use aphrody_webos_protocol::{
    ApiError, GamepadState, Input, ServerEvent, SessionAvailability, SessionInfo, StartSession,
};
use cosmic::iced::Subscription;
use cosmic::iced::futures::{SinkExt, StreamExt, channel::mpsc};
use cosmic::widget::image;
use wasm_bindgen::{JsCast, JsValue, prelude::Closure};
use wasm_bindgen_futures::JsFuture;
use web_sys::{BinaryType, MessageEvent, Request, RequestInit, Response, WebSocket};

use crate::StreamEvent;

fn window() -> web_sys::Window {
    web_sys::window().expect("a browser window")
}

pub fn log_error(message: &str) {
    web_sys::console::error_1(&JsValue::from_str(message));
}

fn js_error(value: JsValue) -> String {
    value.as_string().unwrap_or_else(|| format!("{value:?}"))
}

async fn fetch(method: &str, path: &str, body: Option<String>) -> Result<(u16, String), String> {
    let init = RequestInit::new();
    init.set_method(method);
    if let Some(body) = &body {
        init.set_body(&JsValue::from_str(body));
    }
    let request = Request::new_with_str_and_init(path, &init).map_err(js_error)?;
    if body.is_some() {
        request
            .headers()
            .set("content-type", "application/json")
            .map_err(js_error)?;
    }
    let response: Response = JsFuture::from(window().fetch_with_request(&request))
        .await
        .map_err(js_error)?
        .dyn_into()
        .map_err(js_error)?;
    let text = JsFuture::from(response.text().map_err(js_error)?)
        .await
        .map_err(js_error)?
        .as_string()
        .unwrap_or_default();
    Ok((response.status(), text))
}

fn api_error(code: u16, body: &str) -> String {
    serde_json::from_str::<ApiError>(body)
        .map(|e| e.error)
        .unwrap_or_else(|_| format!("HTTP {code}"))
}

pub async fn availability() -> Result<SessionAvailability, String> {
    let (code, body) = fetch("GET", "/api/session", None).await?;
    if code != 200 {
        return Err(api_error(code, &body));
    }
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

pub async fn start(request: StartSession) -> Result<SessionInfo, String> {
    let body = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    let (code, text) = fetch("POST", "/api/sessions", Some(body)).await?;
    if !(200..300).contains(&code) {
        return Err(api_error(code, &text));
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub fn write_clipboard(text: &str) {
    let _ = window().navigator().clipboard().write_text(text);
}

fn decode(bytes: &[u8]) -> Option<StreamEvent> {
    let frame = ::image::load_from_memory(bytes).ok()?.into_rgba8();
    let (width, height) = frame.dimensions();
    Some(StreamEvent::Frame(
        image::Handle::from_rgba(width, height, frame.into_raw()),
        width,
        height,
    ))
}

/// H.264 session video through WebCodecs: `ServerEvent::Video` configures a `VideoDecoder`; binary chunks are
/// `[kind u8][pts u64 BE, µs][Annex B]` with kind 1 SPS/PPS (kept and prepended to the next key frame), 2 key, 3 delta.
/// Decoded `VideoFrame`s are drawn on an `OffscreenCanvas` and handed to iced as RGBA (the zero-copy wgpu external
/// texture path replaces this copy when our iced fork exposes it).
struct H264 {
    decoder: JsValue,
    config: Vec<u8>,
}

fn set(object: &js_sys::Object, key: &str, value: &JsValue) {
    let _ = js_sys::Reflect::set(object, &JsValue::from_str(key), value);
}

fn call(target: &JsValue, method: &str, args: &js_sys::Array) -> Result<JsValue, JsValue> {
    let function: js_sys::Function = js_sys::Reflect::get(target, &JsValue::from_str(method))?.dyn_into()?;
    function.apply(target, args)
}

/// `new <name>(arg)` on a WebCodecs constructor of the global scope. WebCodecs is reached through js-sys reflection:
/// web-sys gates it behind `web_sys_unstable_apis`, which changes stable 2D canvas signatures that softbuffer uses.
fn construct(name: &str, arg: &JsValue) -> Result<JsValue, JsValue> {
    let constructor: js_sys::Function = js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str(name))?
        .dyn_into()
        .map_err(|_| JsValue::from_str(&format!("{name} is not supported by this browser")))?;
    js_sys::Reflect::construct(&constructor, &js_sys::Array::of1(arg))
}

impl H264 {
    fn new(codec: &str, width: u32, height: u32, out: mpsc::UnboundedSender<StreamEvent>) -> Result<H264, String> {
        let canvas = web_sys::OffscreenCanvas::new(width.max(1), height.max(1)).map_err(js_error)?;
        let context: web_sys::OffscreenCanvasRenderingContext2d = canvas
            .get_context("2d")
            .map_err(js_error)?
            .ok_or("no 2d context")?
            .dyn_into()
            .map_err(js_error)?;
        let output = Closure::<dyn FnMut(JsValue)>::new(move |frame: JsValue| {
            let dimension = |key: &str| {
                js_sys::Reflect::get(&frame, &JsValue::from_str(key)).ok().and_then(|v| v.as_f64()).unwrap_or(0.0) as u32
            };
            let (w, h) = (dimension("displayWidth"), dimension("displayHeight"));
            if w > 0 && h > 0 {
                if canvas.width() != w || canvas.height() != h {
                    canvas.set_width(w);
                    canvas.set_height(h);
                }
                let drawn = call(
                    &context,
                    "drawImage",
                    &js_sys::Array::of3(&frame, &JsValue::from_f64(0.0), &JsValue::from_f64(0.0)),
                );
                if drawn.is_ok()
                    && let Ok(pixels) = context.get_image_data(0.0, 0.0, f64::from(w), f64::from(h))
                {
                    let _ = out.unbounded_send(StreamEvent::Frame(image::Handle::from_rgba(w, h, pixels.data().0), w, h));
                }
            }
            let _ = call(&frame, "close", &js_sys::Array::new());
        });
        let error = Closure::<dyn FnMut(JsValue)>::new(|e: JsValue| log_error(&format!("video decoder: {}", js_error(e))));
        let init = js_sys::Object::new();
        set(&init, "output", output.as_ref());
        set(&init, "error", error.as_ref());
        let decoder = construct("VideoDecoder", &init).map_err(js_error)?;
        output.forget();
        error.forget();
        let config = js_sys::Object::new();
        set(&config, "codec", &JsValue::from_str(codec));
        set(&config, "codedWidth", &JsValue::from_f64(f64::from(width)));
        set(&config, "codedHeight", &JsValue::from_f64(f64::from(height)));
        set(&config, "optimizeForLatency", &JsValue::TRUE);
        set(&config, "hardwareAcceleration", &JsValue::from_str("prefer-hardware"));
        call(&decoder, "configure", &js_sys::Array::of1(&config)).map_err(js_error)?;
        Ok(H264 { decoder, config: Vec::new() })
    }

    fn chunk(&mut self, bytes: &[u8]) {
        if bytes.len() < 9 {
            return;
        }
        let pts = u64::from_be_bytes(bytes[1..9].try_into().unwrap_or([0; 8]));
        let payload = &bytes[9..];
        let (data, kind) = match bytes[0] {
            1 => {
                self.config = payload.to_vec();
                return;
            }
            2 => ([self.config.as_slice(), payload].concat(), "key"),
            _ => (payload.to_vec(), "delta"),
        };
        let init = js_sys::Object::new();
        set(&init, "type", &JsValue::from_str(kind));
        set(&init, "timestamp", &JsValue::from_f64(pts as f64));
        set(&init, "data", &js_sys::Uint8Array::from(data.as_slice()));
        if let Ok(chunk) = construct("EncodedVideoChunk", &init) {
            let _ = call(&self.decoder, "decode", &js_sys::Array::of1(&chunk));
        }
    }
}

/// The session stream: binary messages are encoded frames, text messages are [`ServerEvent`]s, and [`Input`] sent
/// through the [`StreamEvent::Ready`] sender goes back as JSON.
pub fn stream(session: SessionInfo) -> Subscription<StreamEvent> {
    Subscription::run_with((session.stream, session.token), |(path, token)| {
        let (path, token) = (path.clone(), token.clone());
        cosmic::iced::stream::channel(64, async move |mut out: mpsc::Sender<StreamEvent>| {
            let location = window().location();
            let scheme = if location.protocol().as_deref() == Ok("https:") {
                "wss"
            } else {
                "ws"
            };
            let url = format!("{scheme}://{}{}", location.host().unwrap_or_default(), path);
            let protocols = js_sys::Array::of1(&JsValue::from_str(&format!("bearer.{token}")));
            let ws = match WebSocket::new_with_str_sequence(&url, &protocols) {
                Ok(ws) => ws,
                Err(error) => {
                    let _ = out.send(StreamEvent::Closed(js_error(error))).await;
                    return;
                }
            };
            ws.set_binary_type(BinaryType::Arraybuffer);
            let (incoming, mut events) = mpsc::unbounded::<StreamEvent>();
            let on_message = {
                let incoming = incoming.clone();
                let mut video: Option<H264> = None;
                Closure::<dyn FnMut(MessageEvent)>::new(move |event: MessageEvent| {
                    let data = event.data();
                    let item = if let Some(text) = data.as_string() {
                        let parsed = serde_json::from_str::<ServerEvent>(&text).ok();
                        if let Some(ServerEvent::Video {
                            codec,
                            width,
                            height,
                        }) = &parsed
                        {
                            match H264::new(codec, *width, *height, incoming.clone()) {
                                Ok(decoder) => video = Some(decoder),
                                Err(e) => {
                                    log_error(&format!("WebCodecs H.264 is unavailable: {e}"))
                                }
                            }
                        }
                        parsed.map(StreamEvent::Server)
                    } else if let Ok(buffer) = data.dyn_into::<js_sys::ArrayBuffer>() {
                        let bytes = js_sys::Uint8Array::new(&buffer).to_vec();
                        match video.as_mut() {
                            Some(video) => {
                                video.chunk(&bytes);
                                None
                            }
                            None => decode(&bytes),
                        }
                    } else {
                        None
                    };
                    if let Some(item) = item {
                        let _ = incoming.unbounded_send(item);
                    }
                })
            };
            ws.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
            let (input_tx, mut input_rx) = mpsc::unbounded::<Input>();
            let on_open = {
                let incoming = incoming.clone();
                Closure::<dyn FnMut()>::new(move || {
                    let _ = incoming.unbounded_send(StreamEvent::Ready(input_tx.clone()));
                })
            };
            ws.set_onopen(Some(on_open.as_ref().unchecked_ref()));
            let on_close = {
                let incoming = incoming.clone();
                Closure::<dyn FnMut()>::new(move || {
                    let _ =
                        incoming.unbounded_send(StreamEvent::Closed("connection closed".into()));
                })
            };
            ws.set_onclose(Some(on_close.as_ref().unchecked_ref()));
            loop {
                cosmic::iced::futures::select! {
                    event = events.next() => match event {
                        Some(event) => {
                            let closed = matches!(event, StreamEvent::Closed(_));
                            if out.send(event).await.is_err() || closed { break; }
                        }
                        None => break,
                    },
                    input = input_rx.next() => {
                        if let Some(input) = input
                            && ws.ready_state() == WebSocket::OPEN
                            && let Ok(text) = serde_json::to_string(&input)
                        {
                            let _ = ws.send_with_str(&text);
                        }
                    },
                }
            }
            let _ = ws.close();
            drop((on_message, on_open, on_close));
        })
    })
}

async fn next_frame() {
    let promise = js_sys::Promise::new(&mut |resolve, _| {
        let _ = window().request_animation_frame(&resolve);
    });
    let _ = JsFuture::from(promise).await;
}

/// Gamepad API polled every animation frame; a full snapshot is sent whenever a pad changes.
pub fn gamepads() -> Subscription<Input> {
    Subscription::run(|| {
        cosmic::iced::stream::channel(16, async move |mut out: mpsc::Sender<Input>| {
            let last: Rc<RefCell<[Option<GamepadState>; 4]>> =
                Rc::new(RefCell::new([None, None, None, None]));
            loop {
                next_frame().await;
                let Ok(pads) = window().navigator().get_gamepads() else {
                    continue;
                };
                for slot in 0..4u32 {
                    let state = pads
                        .get(slot)
                        .dyn_into::<web_sys::Gamepad>()
                        .ok()
                        .map(|pad| {
                            let mut buttons = [0.0f32; 17];
                            for (i, b) in pad.buttons().iter().take(17).enumerate() {
                                if let Ok(b) = b.dyn_into::<web_sys::GamepadButton>() {
                                    buttons[i] = b.value() as f32;
                                }
                            }
                            let mut axes = [0.0f32; 4];
                            for (i, a) in pad.axes().iter().take(4).enumerate() {
                                axes[i] = a.as_f64().unwrap_or(0.0) as f32;
                            }
                            GamepadState {
                                pad: slot as u8,
                                connected: pad.connected(),
                                buttons,
                                axes,
                            }
                        });
                    let send = {
                        let mut last = last.borrow_mut();
                        let previous = &mut last[slot as usize];
                        let send = match (&state, previous.as_ref()) {
                            (Some(now), Some(before)) if now == before => None,
                            (Some(now), _) => Some(now.clone()),
                            (None, Some(before)) => Some(GamepadState {
                                connected: false,
                                ..before.clone()
                            }),
                            (None, None) => None,
                        };
                        *previous = state;
                        send
                    };
                    if let Some(snapshot) = send
                        && out.send(Input::Gamepad(snapshot)).await.is_err()
                    {
                        return;
                    }
                }
            }
        })
    })
}
