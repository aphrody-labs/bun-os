//! Same-origin embedding contract, shared with GridCraft and PdfCraft at the message boundary.
//! `?host=parent`: ready/open/save/dirty/failed messages prefixed with `wordcraft:`.
//! The host owns persistence and must keep its leave-page guard active while a save is pending or failed.
use std::cell::Cell;
use std::rc::Rc;
use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};
use wordcraft_ui_egui::{Inbox, Services};

#[derive(Clone)]
pub struct Bridge {
    window: web_sys::Window,
    parent: web_sys::Window,
    origin: String,
    reported: Rc<Cell<Option<bool>>>,
}
impl Bridge {
    pub fn new() -> Option<Self> {
        let window = web_sys::window()?;
        let parent = window.parent().ok().flatten()?;
        if js_sys::Object::is(&parent, &window) {
            return None;
        }
        let origin = window.location().origin().ok()?;
        if origin == "null" {
            return None;
        }
        Some(Self {
            window,
            parent,
            origin,
            reported: Rc::default(),
        })
    }
    fn send(&self, kind: &str, fields: &[(&str, JsValue)]) -> Result<(), String> {
        let data = js_sys::Object::new();
        js_sys::Reflect::set(&data, &"type".into(), &kind.into()).map_err(error)?;
        for (key, value) in fields {
            js_sys::Reflect::set(&data, &(*key).into(), value).map_err(error)?;
        }
        self.parent.post_message(&data, &self.origin).map_err(error)
    }
    pub fn ready(&self) {
        if let Err(e) = self.send(
            "wordcraft:ready",
            &[("version", env!("CARGO_PKG_VERSION").into())],
        ) {
            log::error!("host ready: {e}");
        }
    }
    pub fn failed(&self, e: &str) {
        if let Err(e) = self.send("wordcraft:failed", &[("error", e.into())]) {
            log::error!("host failure: {e}");
        }
    }
    pub fn connect(
        &self,
        services: &mut Services,
        inbox: Inbox,
        ctx: egui::Context,
    ) -> Result<(), String> {
        let bridge = self.clone();
        let on_message = Closure::<dyn FnMut(web_sys::MessageEvent)>::new(
            move |event: web_sys::MessageEvent| {
                if event.origin() != bridge.origin
                    || !event
                        .source()
                        .is_some_and(|s| js_sys::Object::is(&s, &bridge.parent))
                {
                    return;
                }
                let data = event.data();
                let kind = js_sys::Reflect::get(&data, &"type".into())
                    .ok()
                    .and_then(|v| v.as_string());
                if kind.as_deref() == Some("wordcraft:ping") {
                    bridge.ready();
                    return;
                }
                if kind.as_deref() != Some("wordcraft:open") {
                    return;
                }
                let name = js_sys::Reflect::get(&data, &"name".into())
                    .ok()
                    .and_then(|v| v.as_string());
                let bytes = js_sys::Reflect::get(&data, &"bytes".into()).ok();
                let (Some(name), Some(bytes)) = (name, bytes) else {
                    bridge.failed("Missing document name or bytes");
                    return;
                };
                if name.is_empty() || name.len() > 255 || name.contains(['/', '\\', '\0']) {
                    bridge.failed("Invalid document name");
                    return;
                }
                let array = if bytes.is_instance_of::<js_sys::Uint8Array>() {
                    bytes.unchecked_into::<js_sys::Uint8Array>()
                } else if bytes.is_instance_of::<js_sys::ArrayBuffer>() {
                    js_sys::Uint8Array::new(&bytes)
                } else {
                    bridge.failed("Invalid document bytes");
                    return;
                };
                if array.length() == 0 || array.length() > 20 * 1024 * 1024 {
                    bridge.failed("Document must be between 1 byte and 20 MiB");
                    return;
                }
                match inbox.lock() {
                    Ok(mut queue) => {
                        queue.push((name, array.to_vec()));
                        ctx.request_repaint();
                    }
                    Err(_) => bridge.failed("Document queue unavailable"),
                }
            },
        );
        self.window
            .add_event_listener_with_callback("message", on_message.as_ref().unchecked_ref())
            .map_err(error)?;
        on_message.forget();
        let bridge = self.clone();
        services.download = Some(Box::new(move |path, bytes| {
            if bytes.len() > 20 * 1024 * 1024 {
                return Err("Document exceeds host limit".into());
            }
            let name = path.rsplit(['/', '\\']).next().unwrap_or("document.docx");
            bridge.send(
                "wordcraft:save",
                &[
                    ("name", name.into()),
                    ("bytes", js_sys::Uint8Array::from(bytes).buffer().into()),
                ],
            )
        }));
        let bridge = self.clone();
        let previous = services.on_dirty.take();
        services.on_dirty = Some(Box::new(move |dirty| {
            if let Some(f) = &previous {
                f(dirty);
            }
            if bridge.reported.get() != Some(dirty) {
                if let Err(e) = bridge.send("wordcraft:dirty", &[("dirty", dirty.into())]) {
                    log::error!("host dirty: {e}");
                } else {
                    bridge.reported.set(Some(dirty));
                }
            }
        }));
        Ok(())
    }
}
fn error(e: JsValue) -> String {
    e.as_string().unwrap_or_else(|| format!("{e:?}"))
}
