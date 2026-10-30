// SPDX-License-Identifier: Apache-2.0
//! aphrody.com thin client (docs/webos/ARCHITECTURE.md, ADR-003), Rust compiled to WebAssembly with wasm-bindgen
//! and web-sys. It lists the operating systems of `GET /api/os`, starts a session with `POST /api/sessions`, shows the
//! session stream full screen on a canvas and sends keyboard, pointer, wheel, clipboard, resize and gamepad input
//! back. Every message is a type of `aphrody-webos-protocol`.
//!
//! UI choice (ADR-003): plain web-sys rather than iced/libcosmic. The client is one picker and one stream surface;
//! the stream needs browser media elements and WebSocket/WebRTC objects that iced cannot host, and an iced wasm
//! bundle (wgpu, winit, text shaping) is several megabytes against the 300 KB budget. COSMIC look comes from the
//! COSMIC dark palette in `index.html`.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use aphrody_webos_protocol::{GamepadState, Input, OsEntry, ServerEvent, SessionInfo, StartSession};
use wasm_bindgen::{JsCast, JsValue, prelude::*};
use wasm_bindgen_futures::{JsFuture, spawn_local};
use web_sys::{
    BinaryType, Blob, CanvasRenderingContext2d, Document, Element, HtmlCanvasElement, ImageBitmap, KeyboardEvent,
    MessageEvent, PointerEvent, Request, RequestInit, Response, WebSocket, WheelEvent, Window,
};

fn window() -> Window {
    web_sys::window().expect("a browser window")
}

fn document() -> Document {
    window().document().expect("a document")
}

fn el(tag: &str, class: &str, text: &str) -> Result<Element, JsValue> {
    let e = document().create_element(tag)?;
    if !class.is_empty() {
        e.set_class_name(class);
    }
    if !text.is_empty() {
        e.set_text_content(Some(text));
    }
    Ok(e)
}

fn root() -> Result<Element, JsValue> {
    document().get_element_by_id("app").ok_or_else(|| JsValue::from_str("#app is missing"))
}

fn status(text: &str) -> Result<(), JsValue> {
    let r = root()?;
    r.set_inner_html("");
    r.append_child(&el("p", "status", text)?)?;
    Ok(())
}

async fn fetch_json(method: &str, path: &str, body: Option<String>) -> Result<(u16, String), JsValue> {
    let init = RequestInit::new();
    init.set_method(method);
    if let Some(body) = body {
        init.set_body(&JsValue::from_str(&body));
    }
    let request = Request::new_with_str_and_init(path, &init)?;
    if method != "GET" {
        request.headers().set("content-type", "application/json")?;
    }
    let response: Response = JsFuture::from(window().fetch_with_request(&request)).await?.dyn_into()?;
    let text = JsFuture::from(response.text()?).await?.as_string().unwrap_or_default();
    Ok((response.status(), text))
}

fn error_text(body: &str) -> String {
    serde_json::from_str::<aphrody_webos_protocol::ApiError>(body).map(|e| e.error).unwrap_or_else(|_| body.into())
}

async fn picker() -> Result<(), JsValue> {
    status("Loading the operating systems...")?;
    let (code, body) = fetch_json("GET", "/api/os", None).await?;
    if code != 200 {
        return status(&format!("The OS catalog is unavailable ({code})."));
    }
    let entries: Vec<OsEntry> =
        serde_json::from_str(&body).map_err(|e| JsValue::from_str(&format!("bad /api/os: {e}")))?;
    let r = root()?;
    r.set_inner_html("");
    r.append_child(&el("h1", "", "Bun OS in your browser")?)?;
    r.append_child(&el("p", "lead", "Pick an operating system. It runs on Bun OS and streams to this tab.")?)?;
    let list = el("ul", "os-list", "")?;
    for entry in entries {
        let item = el("li", "", "")?;
        let button = el("button", "os", "")?;
        button.append_child(&el("strong", "", &entry.name)?)?;
        button.append_child(&el("span", "", &entry.summary)?)?;
        if !entry.available {
            button.set_attribute("disabled", "")?;
            button.append_child(&el("em", "", entry.reason.as_deref().unwrap_or("Not available on this host."))?)?;
        }
        let os = entry.id;
        let click = Closure::<dyn FnMut()>::new(move || {
            spawn_local(async move {
                if let Err(e) = start(os).await {
                    let _ = status(&format!("The session could not start: {}", e.as_string().unwrap_or_default()));
                }
            });
        });
        button.add_event_listener_with_callback("click", click.as_ref().unchecked_ref())?;
        click.forget();
        item.append_child(&button)?;
        list.append_child(&item)?;
    }
    r.append_child(&list)?;
    Ok(())
}

async fn start(os: aphrody_webos_protocol::OsId) -> Result<(), JsValue> {
    status(&format!("Starting {}...", os.name()))?;
    let w = window();
    let ratio = w.device_pixel_ratio().max(1.0);
    let width = (w.inner_width()?.as_f64().unwrap_or(1280.0) * ratio) as u32;
    let height = (w.inner_height()?.as_f64().unwrap_or(720.0) * ratio) as u32;
    let body = serde_json::to_string(&StartSession { os, width, height }).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let (code, text) = fetch_json("POST", "/api/sessions", Some(body)).await?;
    if !(200..300).contains(&code) {
        return Err(JsValue::from_str(&error_text(&text)));
    }
    let session: SessionInfo =
        serde_json::from_str(&text).map_err(|e| JsValue::from_str(&format!("bad session: {e}")))?;
    stream(session)
}

fn send(ws: &WebSocket, input: &Input) {
    if ws.ready_state() == WebSocket::OPEN
        && let Ok(text) = serde_json::to_string(input)
    {
        let _ = ws.send_with_str(&text);
    }
}

fn listen<E: JsCast + 'static>(
    target: &web_sys::EventTarget,
    name: &str,
    f: impl FnMut(E) + 'static,
) -> Result<(), JsValue> {
    let closure = Closure::<dyn FnMut(E)>::new(f);
    target.add_event_listener_with_callback(name, closure.as_ref().unchecked_ref())?;
    closure.forget();
    Ok(())
}

/// Full-screen stream: binary WebSocket messages are encoded frames (JPEG fallback path), text messages are
/// [`ServerEvent`]s; input goes back as [`Input`] JSON.
fn stream(session: SessionInfo) -> Result<(), JsValue> {
    let r = root()?;
    r.set_inner_html("");
    let canvas: HtmlCanvasElement = el("canvas", "stream", "")?.dyn_into()?;
    canvas.set_tab_index(0);
    r.append_child(&canvas)?;
    let ctx: CanvasRenderingContext2d =
        canvas.get_context("2d")?.ok_or_else(|| JsValue::from_str("no 2d context"))?.dyn_into()?;
    let location = window().location();
    let scheme = if location.protocol()? == "https:" { "wss" } else { "ws" };
    let url = format!("{scheme}://{}{}", location.host()?, session.stream);
    let protocols = js_sys::Array::of1(&JsValue::from_str(&format!("bearer.{}", session.token)));
    let ws = WebSocket::new_with_str_sequence(&url, &protocols)?;
    ws.set_binary_type(BinaryType::Blob);

    {
        let canvas = canvas.clone();
        let ctx = ctx.clone();
        let onmessage = Closure::<dyn FnMut(MessageEvent)>::new(move |event: MessageEvent| {
            if let Some(text) = event.data().as_string() {
                match serde_json::from_str::<ServerEvent>(&text) {
                    Ok(ServerEvent::Clipboard { text }) => {
                        let _ = window().navigator().clipboard().write_text(&text);
                    }
                    Ok(ServerEvent::Error { message }) => {
                        let _ = status(&format!("Session error: {message}"));
                    }
                    _ => {}
                }
                return;
            }
            let Ok(blob) = event.data().dyn_into::<Blob>() else { return };
            let canvas = canvas.clone();
            let ctx = ctx.clone();
            spawn_local(async move {
                let Ok(promise) = window().create_image_bitmap_with_blob(&blob) else { return };
                let Ok(bitmap) = JsFuture::from(promise).await else { return };
                let bitmap: ImageBitmap = bitmap.unchecked_into();
                if canvas.width() != bitmap.width() || canvas.height() != bitmap.height() {
                    canvas.set_width(bitmap.width());
                    canvas.set_height(bitmap.height());
                }
                let _ = ctx.draw_image_with_image_bitmap(&bitmap, 0.0, 0.0);
                bitmap.close();
            });
        });
        ws.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));
        onmessage.forget();
    }
    {
        let onclose = Closure::<dyn FnMut()>::new(move || {
            let _ = status("The session stream closed. Reload to pick an operating system again.");
        });
        ws.set_onclose(Some(onclose.as_ref().unchecked_ref()));
        onclose.forget();
    }

    let target: web_sys::EventTarget = canvas.clone().into();
    let to_stream = {
        let canvas = canvas.clone();
        move |x: f64, y: f64| {
            let rect = canvas.get_bounding_client_rect();
            let sx = if rect.width() > 0.0 { f64::from(canvas.width()) / rect.width() } else { 1.0 };
            let sy = if rect.height() > 0.0 { f64::from(canvas.height()) / rect.height() } else { 1.0 };
            (((x - rect.left()) * sx) as f32, ((y - rect.top()) * sy) as f32)
        }
    };
    for name in ["pointermove", "pointerdown", "pointerup"] {
        let ws = ws.clone();
        let to_stream = to_stream.clone();
        let canvas = canvas.clone();
        listen(&target, name, move |e: PointerEvent| {
            if e.type_() == "pointerdown" {
                let _ = canvas.focus();
                let _ = canvas.set_pointer_capture(e.pointer_id());
            }
            let (x, y) = to_stream(f64::from(e.client_x()), f64::from(e.client_y()));
            send(&ws, &Input::Pointer { x, y, buttons: e.buttons() as u8 });
        })?;
    }
    {
        let ws = ws.clone();
        listen(&target, "wheel", move |e: WheelEvent| {
            e.prevent_default();
            send(&ws, &Input::Wheel { dx: e.delta_x() as f32, dy: e.delta_y() as f32 });
        })?;
    }
    listen(&target, "contextmenu", |e: web_sys::Event| e.prevent_default())?;
    for (name, down) in [("keydown", true), ("keyup", false)] {
        let ws = ws.clone();
        listen(&target, name, move |e: KeyboardEvent| {
            e.prevent_default();
            send(&ws, &Input::Key { code: e.code(), key: e.key(), down });
        })?;
    }
    {
        let ws = ws.clone();
        listen(&target, "paste", move |e: web_sys::ClipboardEvent| {
            if let Some(text) = e.clipboard_data().and_then(|d| d.get_data("text/plain").ok()) {
                send(&ws, &Input::Clipboard { text });
            }
        })?;
    }
    {
        let ws = ws.clone();
        let resize = move |_: web_sys::Event| {
            let w = window();
            let ratio = w.device_pixel_ratio().max(1.0);
            let width = (w.inner_width().ok().and_then(|v| v.as_f64()).unwrap_or(1280.0) * ratio) as u32;
            let height = (w.inner_height().ok().and_then(|v| v.as_f64()).unwrap_or(720.0) * ratio) as u32;
            send(&ws, &Input::Resize { width, height });
        };
        listen(&window().into(), "resize", resize)?;
    }
    gamepads(ws)?;
    let _ = canvas.focus();
    Ok(())
}

/// Polls the Gamepad API every animation frame and sends a full snapshot of each pad that changed.
fn gamepads(ws: WebSocket) -> Result<(), JsValue> {
    let last: Rc<RefCell<[Option<GamepadState>; 4]>> = Rc::new(RefCell::new([None, None, None, None]));
    let frame: Rc<RefCell<Option<Closure<dyn FnMut()>>>> = Rc::new(RefCell::new(None));
    let again = frame.clone();
    let running = Rc::new(Cell::new(true));
    *frame.borrow_mut() = Some(Closure::new(move || {
        if !running.get() || ws.ready_state() == WebSocket::CLOSED {
            running.set(false);
            return;
        }
        if let Ok(pads) = window().navigator().get_gamepads() {
            for slot in 0..4u32 {
                let pad = pads.get(slot).dyn_into::<web_sys::Gamepad>().ok();
                let state = pad.map(|pad| {
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
                    GamepadState { pad: slot as u8, connected: pad.connected(), buttons, axes }
                });
                let mut last = last.borrow_mut();
                let previous = &mut last[slot as usize];
                match (&state, previous.as_ref()) {
                    (Some(now), Some(before)) if now == before => {}
                    (Some(now), _) => {
                        send(&ws, &Input::Gamepad(now.clone()));
                        *previous = state.clone();
                    }
                    (None, Some(before)) => {
                        send(&ws, &Input::Gamepad(GamepadState { connected: false, ..before.clone() }));
                        *previous = None;
                    }
                    (None, None) => {}
                }
            }
        }
        if let Some(f) = again.borrow().as_ref() {
            let _ = window().request_animation_frame(f.as_ref().unchecked_ref());
        }
    }));
    if let Some(f) = frame.borrow().as_ref() {
        window().request_animation_frame(f.as_ref().unchecked_ref())?;
    }
    std::mem::forget(frame);
    Ok(())
}

#[wasm_bindgen(start)]
pub fn main() {
    spawn_local(async {
        if let Err(e) = picker().await {
            let _ = status(&format!("aphrody.com could not start: {}", e.as_string().unwrap_or_else(|| format!("{e:?}"))));
        }
    });
}
