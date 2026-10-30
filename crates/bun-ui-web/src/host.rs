// SPDX-License-Identifier: Apache-2.0
//! The bun-ui host (wasm32): loads `/ui/apps.json`, draws a dock, opens each app as a window whose surface is an
//! iframe on the app's bundle, and answers the [`crate::bridge`] requests the surfaces post (clipboard, OPFS storage,
//! title). Window chrome uses the COSMIC dark palette; the toolkit inside the surface renders on its own canvas
//! (wgpu/WebGPU for iced and libcosmic, the Qt wasm platform plugin, GDK Broadway).

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use wasm_bindgen::{JsCast, JsValue, prelude::*};
use wasm_bindgen_futures::{JsFuture, spawn_local};
use web_sys::{
    Document, Element, HtmlElement, HtmlIFrameElement, MessageEvent, MouseEvent, Window,
};

use crate::bridge::{Reply, Request};
use crate::{Bundle, Catalog};

const STYLE: &str = "
html,body{margin:0;height:100%;overflow:hidden;background:#1b1b1b;color:#e4e4e4;font:14px/1.4 system-ui,sans-serif}
#bunui-desk{position:absolute;inset:0 0 56px 0}
#bunui-dock{position:absolute;left:0;right:0;bottom:0;height:56px;display:flex;gap:6px;align-items:center;padding:0 10px;
 background:#262626;border-top:1px solid #3a3a3a;overflow-x:auto}
.bunui-launch{border:0;border-radius:16px;padding:8px 14px;background:#333;color:#e4e4e4;cursor:pointer;white-space:nowrap}
.bunui-launch:hover{background:#3d5c5c}.bunui-launch small{opacity:.7;margin-left:6px}
.bunui-win{position:absolute;display:flex;flex-direction:column;background:#2a2a2a;border:1px solid #444;border-radius:12px;
 box-shadow:0 8px 28px #0008;overflow:hidden;min-width:240px;min-height:160px;resize:both}
.bunui-win.focused{border-color:#63d0df}
.bunui-bar{height:36px;flex:none;display:flex;align-items:center;gap:8px;padding:0 6px 0 14px;background:#303030;cursor:move;user-select:none}
.bunui-bar span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bunui-bar button{width:24px;height:24px;border:0;border-radius:12px;background:#454545;color:#e4e4e4;cursor:pointer}
.bunui-bar button:hover{background:#c63939}
.bunui-win iframe{flex:1;border:0;width:100%;background:#1b1b1b}
.bunui-shield{position:absolute;inset:36px 0 0 0;display:none}
.dragging .bunui-shield{display:block}
";

struct Host {
    window: Window,
    document: Document,
    desk: Element,
    z: Cell<i32>,
    cascade: Cell<i32>,
    /// iframe content window (by window id) to the bundle it shows.
    windows: RefCell<HashMap<u32, (HtmlIFrameElement, Bundle, Element)>>,
    next: Cell<u32>,
}

#[wasm_bindgen(start)]
pub fn start() -> Result<(), JsValue> {
    let window = web_sys::window().ok_or("no window")?;
    let document = window.document().ok_or("no document")?;
    let body = document.body().ok_or("no body")?;
    let style = document.create_element("style")?;
    style.set_text_content(Some(STYLE));
    document.head().ok_or("no head")?.append_child(&style)?;
    let desk = document.create_element("div")?;
    desk.set_id("bunui-desk");
    let dock = document.create_element("nav")?;
    dock.set_id("bunui-dock");
    body.append_child(&desk)?;
    body.append_child(&dock)?;

    let host = Rc::new(Host {
        window: window.clone(),
        document,
        desk,
        z: Cell::new(1),
        cascade: Cell::new(0),
        windows: RefCell::new(HashMap::new()),
        next: Cell::new(1),
    });

    let on_message = {
        let host = host.clone();
        Closure::<dyn FnMut(MessageEvent)>::new(move |event: MessageEvent| host.message(event))
    };
    window.add_event_listener_with_callback("message", on_message.as_ref().unchecked_ref())?;
    on_message.forget();

    spawn_local(async move {
        match fetch_catalog(&host.window).await {
            Ok(catalog) => {
                for app in catalog.apps {
                    let _ = host.launcher(&dock, app);
                }
            }
            Err(error) => dock.set_text_content(Some(&format!("catalog unavailable: {error:?}"))),
        }
    });
    Ok(())
}

async fn fetch_catalog(window: &Window) -> Result<Catalog, JsValue> {
    let response: web_sys::Response = JsFuture::from(window.fetch_with_str("/ui/apps.json"))
        .await?
        .dyn_into()?;
    let text = JsFuture::from(response.text()?)
        .await?
        .as_string()
        .unwrap_or_default();
    serde_json::from_str(&text).map_err(|e| JsValue::from_str(&e.to_string()))
}

impl Host {
    fn launcher(self: &Rc<Self>, dock: &Element, app: Bundle) -> Result<(), JsValue> {
        let button = self.document.create_element("button")?;
        button.set_class_name("bunui-launch");
        button.set_inner_html(&format!(
            "{}<small>{}</small>",
            escape(&app.title),
            app.toolkit.as_str()
        ));
        let host = self.clone();
        let open = Closure::<dyn FnMut()>::new(move || {
            let _ = host.open(app.clone());
        });
        button.add_event_listener_with_callback("click", open.as_ref().unchecked_ref())?;
        open.forget();
        dock.append_child(&button)?;
        Ok(())
    }

    fn open(self: &Rc<Self>, app: Bundle) -> Result<(), JsValue> {
        let id = self.next.get();
        self.next.set(id + 1);
        let (w, h) = app.size.unwrap_or((900, 640));
        let offset = 40 + 32 * (self.cascade.get() % 8);
        self.cascade.set(self.cascade.get() + 1);

        let win: HtmlElement = self.document.create_element("section")?.dyn_into()?;
        win.set_class_name("bunui-win");
        let style = win.style();
        style.set_property("left", &format!("{offset}px"))?;
        style.set_property("top", &format!("{}px", offset / 2))?;
        style.set_property("width", &format!("{w}px"))?;
        style.set_property("height", &format!("{}px", h + 36))?;

        let bar = self.document.create_element("header")?;
        bar.set_class_name("bunui-bar");
        let title = self.document.create_element("span")?;
        title.set_text_content(Some(&format!("{} - {}", app.title, app.toolkit.as_str())));
        let close = self.document.create_element("button")?;
        close.set_text_content(Some("x"));
        close.set_attribute("aria-label", "Close")?;
        bar.append_child(&title)?;
        bar.append_child(&close)?;

        let frame: HtmlIFrameElement = self.document.create_element("iframe")?.dyn_into()?;
        frame.set_src(&format!(
            "{}{}",
            app.base(),
            if app.entry == "index.html" {
                ""
            } else {
                &app.entry
            }
        ));
        frame.set_attribute(
            "allow",
            "clipboard-read; clipboard-write; fullscreen; gamepad; cross-origin-isolated",
        )?;
        frame.set_title(&app.title);
        let shield = self.document.create_element("div")?;
        shield.set_class_name("bunui-shield");

        win.append_child(&bar)?;
        win.append_child(&frame)?;
        win.append_child(&shield)?;
        self.desk.append_child(&win)?;
        self.focus(&win);
        self.windows.borrow_mut().insert(id, (frame, app, title));

        // Focus on press; drag by the title bar (a shield stops the iframe from eating mouse moves).
        {
            let host = self.clone();
            let target = win.clone();
            let press = Closure::<dyn FnMut()>::new(move || host.focus(&target));
            win.add_event_listener_with_callback("mousedown", press.as_ref().unchecked_ref())?;
            press.forget();
        }
        {
            let host = self.clone();
            let target = win.clone();
            let drag = Closure::<dyn FnMut(MouseEvent)>::new(move |event: MouseEvent| {
                host.drag(&target, event)
            });
            bar.add_event_listener_with_callback("mousedown", drag.as_ref().unchecked_ref())?;
            drag.forget();
        }
        {
            let host = self.clone();
            let target = win.clone();
            let shut = Closure::<dyn FnMut()>::new(move || {
                target.remove();
                host.windows.borrow_mut().remove(&id);
            });
            close.add_event_listener_with_callback("click", shut.as_ref().unchecked_ref())?;
            shut.forget();
        }
        Ok(())
    }

    fn focus(&self, win: &HtmlElement) {
        if let Ok(list) = self.document.query_selector_all(".bunui-win.focused") {
            for i in 0..list.length() {
                if let Some(el) = list.item(i).and_then(|n| n.dyn_into::<Element>().ok()) {
                    let _ = el.class_list().remove_1("focused");
                }
            }
        }
        let _ = win.class_list().add_1("focused");
        self.z.set(self.z.get() + 1);
        let _ = win
            .style()
            .set_property("z-index", &self.z.get().to_string());
    }

    fn drag(self: &Rc<Self>, win: &HtmlElement, start: MouseEvent) {
        let (x0, y0) = (start.client_x(), start.client_y());
        let (left, top) = (win.offset_left(), win.offset_top());
        let _ = self.desk.class_list().add_1("dragging");
        let moved = {
            let win = win.clone();
            Closure::<dyn FnMut(MouseEvent)>::new(move |e: MouseEvent| {
                let style = win.style();
                let _ = style.set_property("left", &format!("{}px", left + e.client_x() - x0));
                let _ =
                    style.set_property("top", &format!("{}px", (top + e.client_y() - y0).max(0)));
            })
        };
        let up: Rc<RefCell<Option<Closure<dyn FnMut()>>>> = Rc::new(RefCell::new(None));
        let doc = self.document.clone();
        let desk = self.desk.clone();
        let moved = Rc::new(moved);
        let _ =
            doc.add_event_listener_with_callback("mousemove", (*moved).as_ref().unchecked_ref());
        let release = {
            let up = up.clone();
            let doc = doc.clone();
            let moved = moved.clone();
            Closure::<dyn FnMut()>::new(move || {
                let _ = desk.class_list().remove_1("dragging");
                let _ = doc.remove_event_listener_with_callback(
                    "mousemove",
                    (*moved).as_ref().unchecked_ref(),
                );
                if let Some(cb) = up.borrow_mut().take() {
                    let _ = doc.remove_event_listener_with_callback(
                        "mouseup",
                        cb.as_ref().unchecked_ref(),
                    );
                }
            })
        };
        let _ = doc.add_event_listener_with_callback("mouseup", release.as_ref().unchecked_ref());
        *up.borrow_mut() = Some(release);
    }

    /// Bridge: only messages from our own surfaces (same origin, a known iframe) are served.
    fn message(self: &Rc<Self>, event: MessageEvent) {
        if event.origin() != self.window.location().origin().unwrap_or_default() {
            return;
        }
        let Some(text) = js_sys::JSON::stringify(&event.data())
            .ok()
            .and_then(|s| s.as_string())
        else {
            return;
        };
        let Ok(request) = serde_json::from_str::<Request>(&text) else {
            return;
        };
        let source = event.source();
        let found = self
            .windows
            .borrow()
            .iter()
            .find_map(|(_, (frame, app, title))| {
                let content = frame.content_window()?;
                let same = source
                    .as_ref()
                    .map(|s| JsValue::from(content.clone()) == JsValue::from(s.clone()))
                    .unwrap_or(false);
                same.then(|| (content, app.clone(), title.clone()))
            });
        let Some((target, app, title)) = found else {
            return;
        };
        let namespace = format!("{}-{}", app.toolkit.as_str(), app.id);
        let navigator = self.window.navigator();
        spawn_local(async move {
            let reply = match request {
                Request::Title { text } => {
                    title.set_text_content(Some(&text));
                    None
                }
                Request::ClipboardWrite { text } => {
                    let _ = JsFuture::from(navigator.clipboard().write_text(&text)).await;
                    None
                }
                Request::ClipboardRead { id } => Some(
                    match JsFuture::from(navigator.clipboard().read_text()).await {
                        Ok(v) => Reply::Ok {
                            id,
                            text: v.as_string(),
                        },
                        Err(e) => Reply::Error {
                            id,
                            message: format!("{e:?}"),
                        },
                    },
                ),
                Request::FsRead { id, path } => {
                    Some(match opfs_read(&navigator, &namespace, &path).await {
                        Ok(text) => Reply::Ok {
                            id,
                            text: Some(text),
                        },
                        Err(e) => Reply::Error {
                            id,
                            message: format!("{e:?}"),
                        },
                    })
                }
                Request::FsWrite { id, path, text } => Some(
                    match opfs_write(&navigator, &namespace, &path, &text).await {
                        Ok(()) => Reply::Ok { id, text: None },
                        Err(e) => Reply::Error {
                            id,
                            message: format!("{e:?}"),
                        },
                    },
                ),
            };
            if let Some(reply) = reply
                && let Ok(json) = serde_json::to_string(&reply)
                && let Ok(value) = js_sys::JSON::parse(&json)
            {
                let origin = web_sys::window()
                    .and_then(|w| w.location().origin().ok())
                    .unwrap_or_default();
                let _ = target.post_message(&value, &origin);
            }
        });
    }
}

/// `<opfs root>/<namespace>/<path>`; path segments must be plain names.
async fn opfs_file(
    navigator: &web_sys::Navigator,
    namespace: &str,
    path: &str,
    create: bool,
) -> Result<web_sys::FileSystemFileHandle, JsValue> {
    let mut dir: web_sys::FileSystemDirectoryHandle =
        JsFuture::from(navigator.storage().get_directory())
            .await?
            .dyn_into()?;
    let segments: Vec<&str> = std::iter::once(namespace)
        .chain(path.split('/').filter(|s| !s.is_empty()))
        .collect();
    let (file, dirs) = segments.split_last().ok_or("empty path")?;
    if segments.iter().any(|s| *s == "." || *s == "..") || dirs.is_empty() {
        return Err("invalid path".into());
    }
    for segment in dirs {
        let options = web_sys::FileSystemGetDirectoryOptions::new();
        options.set_create(create);
        dir = JsFuture::from(dir.get_directory_handle_with_options(segment, &options))
            .await?
            .dyn_into()?;
    }
    let options = web_sys::FileSystemGetFileOptions::new();
    options.set_create(create);
    JsFuture::from(dir.get_file_handle_with_options(file, &options))
        .await?
        .dyn_into()
}

async fn opfs_read(
    navigator: &web_sys::Navigator,
    namespace: &str,
    path: &str,
) -> Result<String, JsValue> {
    let handle = opfs_file(navigator, namespace, path, false).await?;
    let file: web_sys::Blob = JsFuture::from(handle.get_file()).await?.dyn_into()?;
    Ok(JsFuture::from(file.text())
        .await?
        .as_string()
        .unwrap_or_default())
}

async fn opfs_write(
    navigator: &web_sys::Navigator,
    namespace: &str,
    path: &str,
    text: &str,
) -> Result<(), JsValue> {
    let handle = opfs_file(navigator, namespace, path, true).await?;
    let stream: web_sys::FileSystemWritableFileStream =
        JsFuture::from(handle.create_writable()).await?.dyn_into()?;
    JsFuture::from(stream.write_with_str(text)?).await?;
    JsFuture::from(stream.close()).await?;
    Ok(())
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
