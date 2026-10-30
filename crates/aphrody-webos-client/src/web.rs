// SPDX-License-Identifier: Apache-2.0
//! Browser transport of the wasm client: fetch for the API, the session WebSocket, the Gamepad API and the
//! clipboard. No UI is built here; everything visible is iced/libcosmic.

use std::cell::RefCell;
use std::rc::Rc;

use aphrody_webos_protocol::{
    ApiError, GamepadState, Input, OsEntry, ServerEvent, SessionInfo, StartSession,
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

pub async fn catalog() -> Result<Vec<OsEntry>, String> {
    let (code, body) = fetch("GET", "/api/os", None).await?;
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
                Closure::<dyn FnMut(MessageEvent)>::new(move |event: MessageEvent| {
                    let data = event.data();
                    let item = if let Some(text) = data.as_string() {
                        serde_json::from_str::<ServerEvent>(&text)
                            .ok()
                            .map(StreamEvent::Server)
                    } else if let Ok(buffer) = data.dyn_into::<js_sys::ArrayBuffer>() {
                        decode(&js_sys::Uint8Array::new(&buffer).to_vec())
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
