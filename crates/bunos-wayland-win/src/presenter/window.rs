// SPDX-License-Identifier: Apache-2.0
//! One Win32 window per Wayland toplevel. All state lives on the UI thread (thread_local); Win32 calls that can send
//! messages back into the window procedure (CreateWindowEx, ShowWindow, SetWindowPos, modal move/size loops,
//! DestroyWindow) always run after the state borrow is released.

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};

use windows::{
    Win32::{
        Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::{
            Dwm::{
                DWMSBT_MAINWINDOW, DWMSBT_NONE, DWMSBT_TABBEDWINDOW, DWMSBT_TRANSIENTWINDOW, DWMWA_SYSTEMBACKDROP_TYPE,
                DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DwmExtendFrameIntoClientArea,
                DwmSetWindowAttribute,
            },
            Gdi::{
                BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BeginPaint, DIB_RGB_COLORS, EndPaint, GetMonitorInfoW,
                InvalidateRect, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow, PAINTSTRUCT, SetDIBitsToDevice,
            },
        },
        UI::{
            Controls::MARGINS,
            HiDpi::{AdjustWindowRectExForDpi, GetDpiForWindow},
            Input::KeyboardAndMouse::{
                MAPVK_VK_TO_VSC_EX, MapVirtualKeyW, ReleaseCapture, SetCapture, SetFocus, TME_LEAVE, TRACKMOUSEEVENT,
                TrackMouseEvent, VK_F4, VK_F11, VK_PACKET, VkKeyScanW,
            },
            WindowsAndMessaging::*,
        },
    },
    core::{HSTRING, PCWSTR, w},
};

use super::{Inbox, Link, Options, gpu};
use crate::{
    keys,
    wire::{self, Backdrop, HostMsg, Interactive, PresenterMsg},
};

struct Win {
    id: u32,
    hwnd: HWND,
    w: u32,
    h: u32,
    pixels: Vec<u8>,
    ssd: bool,
    surface: Option<gpu::Surface>,
    translucent: bool,
    fullscreen: Option<(WINDOW_STYLE, RECT)>,
    tracking: bool,
    buttons: u32,
}

#[derive(Default)]
struct Stats {
    frames: u64,
    bytes: u64,
    apply: Duration,
    since: Option<Instant>,
}

pub(crate) struct App {
    link: Link,
    inbox: Inbox,
    opts: Options,
    gpu: Option<gpu::Device>,
    wins: HashMap<u32, Win>,
    by_hwnd: HashMap<isize, u32>,
    cursor: Option<HCURSOR>,
    keys_down: HashSet<u32>,
    /// The last WM_KEYDOWN was VK_PACKET: the next WM_CHAR carries injected text.
    packet: bool,
    stats: Stats,
    dark: bool,
}

impl App {
    pub fn new(link: Link, inbox: Inbox, opts: Options) -> Self {
        let gpu = if opts.gdi {
            None
        } else {
            match gpu::Device::new() {
                Ok(d) => {
                    eprintln!("bunos-wayland-win: D3D11 + DirectComposition flip model on {}", d.adapter);
                    Some(d)
                }
                Err(e) => {
                    eprintln!("bunos-wayland-win: no D3D11 device ({e}), GDI presentation");
                    None
                }
            }
        };
        if gpu.is_none() {
            eprintln!("bunos-wayland-win: GDI presentation (SetDIBitsToDevice)");
        }
        Self {
            link,
            inbox,
            opts,
            gpu,
            wins: HashMap::new(),
            by_hwnd: HashMap::new(),
            cursor: unsafe { LoadCursorW(None, IDC_ARROW).ok() },
            keys_down: HashSet::new(),
            packet: false,
            stats: Stats::default(),
            dark: apps_use_dark(),
        }
    }
}

fn apps_use_dark() -> bool {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW};
    let mut value: u32 = 0;
    let mut size = 4u32;
    let r = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    r.is_ok() && value == 0
}

thread_local! {
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
}

pub(crate) fn install(app: App) {
    APP.with(|a| *a.borrow_mut() = Some(app));
}

pub(crate) fn shutdown() {
    APP.with(|a| a.borrow_mut().take());
}

/// Runs `f` on the app state; `None` when the state is already borrowed (re-entrant message) or gone.
fn with_app<R>(f: impl FnOnce(&mut App) -> R) -> Option<R> {
    APP.with(|a| a.try_borrow_mut().ok().and_then(|mut g| g.as_mut().map(f)))
}

const CLASS: PCWSTR = w!("BunOSWaylandToplevel");
const WM_MOUSELEAVE: u32 = 0x02A3;

pub(crate) fn register_class(hinstance: HINSTANCE) -> windows::core::Result<()> {
    let class = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(wndproc),
        hInstance: hinstance,
        hCursor: unsafe { LoadCursorW(None, IDC_ARROW)? },
        hIcon: unsafe { LoadIconW(None, IDI_APPLICATION)? },
        lpszClassName: CLASS,
        ..Default::default()
    };
    if unsafe { RegisterClassExW(&class) } == 0 {
        return Err(windows::core::Error::from_thread());
    }
    Ok(())
}

enum Action {
    Create { id: u32, w: u32, h: u32, ssd: bool, title: String, gpu: bool, parent: Option<(HWND, i32, i32)> },
    Title(HWND, String),
    Destroy(HWND),
    Show(HWND, SHOW_WINDOW_CMD),
    Move(HWND, u32),
    Resize(HWND, u32, u32),
    Fullscreen(HWND, bool),
}

pub(crate) fn drain_inbox() {
    loop {
        let Some(inbox) = with_app(|a| a.inbox.clone()) else { return };
        let Some(msg) = inbox.lock().unwrap().pop_front() else { return };
        let actions = with_app(|a| handle(a, msg)).unwrap_or_default();
        for act in actions {
            run_action(act);
        }
    }
}

fn handle(app: &mut App, msg: HostMsg) -> Vec<Action> {
    match msg {
        HostMsg::Hello { version, host } => {
            eprintln!("bunos-wayland-win: host `{host}` protocol v{version}");
            vec![]
        }
        HostMsg::ToplevelNew { id, parent, x, y, width, height, ssd, title, app_id } => {
            let title = if title.is_empty() { app_id } else { title };
            let parent = app.wins.get(&parent).map(|p| (p.hwnd, x, y));
            vec![Action::Create { id, w: width, h: height, ssd, title, gpu: app.gpu.is_some(), parent }]
        }
        HostMsg::ToplevelMeta { id, title, app_id } => match app.wins.get(&id) {
            Some(w) => vec![Action::Title(w.hwnd, if title.is_empty() { app_id } else { title })],
            None => vec![],
        },
        HostMsg::ToplevelRequest { id, states, minimize, interactive, edges } => {
            let Some(w) = app.wins.get(&id) else { return vec![] };
            let hwnd = w.hwnd;
            let mut out = Vec::new();
            match interactive {
                Interactive::Move => out.push(Action::Move(hwnd, BTN_LEFT_HELD)),
                Interactive::Resize => out.push(Action::Resize(hwnd, edges, BTN_LEFT_HELD)),
                Interactive::None => {
                    if minimize {
                        out.push(Action::Show(hwnd, SW_MINIMIZE));
                    } else if states & wire::STATE_FULLSCREEN != 0 {
                        out.push(Action::Fullscreen(hwnd, true));
                    } else if states & wire::STATE_MAXIMIZED != 0 {
                        out.push(Action::Show(hwnd, SW_MAXIMIZE));
                    } else if w.fullscreen.is_some() {
                        out.push(Action::Fullscreen(hwnd, false));
                    } else {
                        out.push(Action::Show(hwnd, SW_RESTORE));
                    }
                }
            }
            out
        }
        HostMsg::ToplevelEffect { id, backdrop, translucent } => {
            if let Some(w) = app.wins.get_mut(&id) {
                w.translucent = translucent;
                let b = if super::transparency_enabled() { backdrop } else { Backdrop::None };
                apply_backdrop(w.hwnd, b, app.dark);
            }
            vec![]
        }
        HostMsg::ToplevelClosed { id } => match app.wins.remove(&id) {
            Some(w) => {
                app.by_hwnd.remove(&(w.hwnd.0 as isize));
                vec![Action::Destroy(w.hwnd)]
            }
            None => vec![],
        },
        HostMsg::Frame { id, seq, width, height, rects, codec, raw_len, data, .. } => {
            let started = Instant::now();
            let gpu = app.gpu.as_ref();
            if let Some(w) = app.wins.get_mut(&id) {
                if w.w != width || w.h != height {
                    w.w = width;
                    w.h = height;
                    w.pixels = vec![0; width as usize * height as usize * 4];
                    if let (Some(g), Some(s)) = (gpu, w.surface.as_mut()) {
                        if let Err(e) = g.resize(s, width, height) {
                            eprintln!("bunos-wayland-win: resize swap chain: {e}");
                        }
                    }
                }
                match wire::apply_rects(&mut w.pixels, width, &rects, codec, raw_len, &data) {
                    Ok(()) => match (gpu, w.surface.as_ref()) {
                        (Some(g), Some(s)) => {
                            if let Err(e) = g.present(s, &w.pixels, width, &rects, app.opts.vsync) {
                                eprintln!("bunos-wayland-win: present: {e}");
                            }
                        }
                        _ => {
                            for r in &rects {
                                let rc = RECT {
                                    left: r.x as i32,
                                    top: r.y as i32,
                                    right: (r.x + r.w) as i32,
                                    bottom: (r.y + r.h) as i32,
                                };
                                unsafe {
                                    let _ = InvalidateRect(Some(w.hwnd), Some(&rc), false);
                                }
                            }
                        }
                    },
                    Err(e) => eprintln!("bunos-wayland-win: frame {id}/{seq}: {e}"),
                }
            }
            app.link.send(PresenterMsg::FrameAck { id, seq });
            app.stats.frames += 1;
            app.stats.bytes += data.len() as u64 + 32;
            app.stats.apply += started.elapsed();
            let since = *app.stats.since.get_or_insert_with(Instant::now);
            if app.opts.stats && since.elapsed() >= Duration::from_secs(5) {
                let secs = since.elapsed().as_secs_f64();
                eprintln!(
                    "bunos-wayland-win: {:.1} fps, {:.2} MB/s in, apply+present {:.2} ms/frame ({})",
                    app.stats.frames as f64 / secs,
                    app.stats.bytes as f64 / secs / 1e6,
                    app.stats.apply.as_secs_f64() * 1e3 / app.stats.frames.max(1) as f64,
                    if app.gpu.is_some() { "d3d11 flip" } else { "gdi" },
                );
                app.stats = Stats::default();
            }
            vec![]
        }
        HostMsg::Cursor { name } => {
            app.cursor = cursor_for(&name);
            unsafe {
                SetCursor(app.cursor);
            }
            vec![]
        }
        HostMsg::Bye { reason } => {
            eprintln!("bunos-wayland-win: host: {reason}");
            vec![]
        }
    }
}

/// Marker: the interactive move/resize was started by a held left button (CSD title bar or edge).
const BTN_LEFT_HELD: u32 = keys::BTN_LEFT;

fn cursor_for(name: &str) -> Option<HCURSOR> {
    if name.is_empty() {
        return None;
    }
    let id = match name {
        "text" | "vertical-text" => IDC_IBEAM,
        "pointer" | "hand1" | "hand2" => IDC_HAND,
        "wait" | "watch" => IDC_WAIT,
        "progress" => IDC_APPSTARTING,
        "crosshair" | "cell" => IDC_CROSS,
        "move" | "all-scroll" | "grab" | "grabbing" | "fleur" => IDC_SIZEALL,
        "ew-resize" | "e-resize" | "w-resize" | "col-resize" => IDC_SIZEWE,
        "ns-resize" | "n-resize" | "s-resize" | "row-resize" => IDC_SIZENS,
        "nwse-resize" | "nw-resize" | "se-resize" => IDC_SIZENWSE,
        "nesw-resize" | "ne-resize" | "sw-resize" => IDC_SIZENESW,
        "not-allowed" | "no-drop" => IDC_NO,
        "help" => IDC_HELP,
        _ => IDC_ARROW,
    };
    unsafe { LoadCursorW(None, id).ok() }
}

fn apply_backdrop(hwnd: HWND, backdrop: Backdrop, dark: bool) {
    unsafe {
        let dark: i32 = dark as i32;
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark as *const _ as *const _, 4);
        let corner = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &corner as *const _ as *const _, 4);
        let kind = match backdrop {
            Backdrop::None => DWMSBT_NONE,
            Backdrop::Mica => DWMSBT_MAINWINDOW,
            Backdrop::Acrylic => DWMSBT_TRANSIENTWINDOW,
            Backdrop::MicaAlt => DWMSBT_TABBEDWINDOW,
        };
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, &kind as *const _ as *const _, 4);
        // The backdrop is drawn under the whole window; translucent client pixels let it through.
        let m = if backdrop == Backdrop::None {
            MARGINS::default()
        } else {
            MARGINS { cxLeftWidth: -1, cxRightWidth: -1, cyTopHeight: -1, cyBottomHeight: -1 }
        };
        let _ = DwmExtendFrameIntoClientArea(hwnd, &m);
    }
}

fn run_action(act: Action) {
    match act {
        Action::Create { id, w, h, ssd, title, gpu, parent } => create(id, w, h, ssd, &title, gpu, parent),
        Action::Title(hwnd, t) => unsafe {
            let _ = SetWindowTextW(hwnd, &HSTRING::from(t));
        },
        Action::Destroy(hwnd) => unsafe {
            let _ = DestroyWindow(hwnd);
        },
        Action::Show(hwnd, cmd) => unsafe {
            let _ = ShowWindow(hwnd, cmd);
        },
        Action::Move(hwnd, button) => {
            unsafe {
                let _ = ReleaseCapture();
                // SC_MOVE | HTCAPTION: the native move loop (Aero Snap, snap layouts, shake).
                SendMessageW(hwnd, WM_SYSCOMMAND, Some(WPARAM(0xF012)), Some(LPARAM(0)));
            }
            release_after_modal(hwnd, button);
        }
        Action::Resize(hwnd, edges, button) => {
            // xdg_toplevel.resize_edge -> WMSZ_*
            let wmsz = match edges {
                1 => 3,  // top
                2 => 6,  // bottom
                4 => 1,  // left
                5 => 4,  // top-left
                6 => 7,  // bottom-left
                8 => 2,  // right
                9 => 5,  // top-right
                10 => 8, // bottom-right
                _ => 0,
            };
            if wmsz != 0 {
                unsafe {
                    let _ = ReleaseCapture();
                    SendMessageW(hwnd, WM_SYSCOMMAND, Some(WPARAM(0xF000 + wmsz)), Some(LPARAM(0)));
                }
                release_after_modal(hwnd, button);
            }
        }
        Action::Fullscreen(hwnd, on) => set_fullscreen(hwnd, on),
    }
}

/// The modal move/size loop swallows the button release; tell the client the button is up again.
fn release_after_modal(hwnd: HWND, button: u32) {
    with_app(|a| {
        if let Some(&id) = a.by_hwnd.get(&(hwnd.0 as isize)) {
            if let Some(w) = a.wins.get_mut(&id) {
                w.buttons = 0;
            }
            let t = a.link.now_ms();
            a.link.send(PresenterMsg::PointerButton { id, button, pressed: false, time_ms: t });
        }
    });
}

fn set_fullscreen(hwnd: HWND, on: bool) {
    let saved = with_app(|a| {
        let id = *a.by_hwnd.get(&(hwnd.0 as isize))?;
        let w = a.wins.get_mut(&id)?;
        Some(if on {
            if w.fullscreen.is_some() {
                return None;
            }
            let style = WINDOW_STYLE(unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32);
            let mut rc = RECT::default();
            unsafe {
                let _ = GetWindowRect(hwnd, &mut rc);
            }
            w.fullscreen = Some((style, rc));
            (style, rc, true)
        } else {
            let (style, rc) = w.fullscreen.take()?;
            (style, rc, false)
        })
    })
    .flatten();
    let Some((style, rc, entering)) = saved else { return };
    unsafe {
        if entering {
            let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            let _ = GetMonitorInfoW(mon, &mut mi);
            let r = mi.rcMonitor;
            SetWindowLongW(hwnd, GWL_STYLE, (style.0 & !(WS_OVERLAPPEDWINDOW.0)) as i32 | WS_POPUP.0 as i32);
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOP),
                r.left,
                r.top,
                r.right - r.left,
                r.bottom - r.top,
                SWP_FRAMECHANGED | SWP_NOOWNERZORDER,
            );
        } else {
            SetWindowLongW(hwnd, GWL_STYLE, style.0 as i32);
            let _ = SetWindowPos(
                hwnd,
                None,
                rc.left,
                rc.top,
                rc.right - rc.left,
                rc.bottom - rc.top,
                SWP_FRAMECHANGED | SWP_NOOWNERZORDER | SWP_NOZORDER,
            );
        }
    }
    send_configure(hwnd);
}

fn create(id: u32, w: u32, h: u32, ssd: bool, title: &str, gpu: bool, parent: Option<(HWND, i32, i32)>) {
    let popup = parent.is_some();
    let style = if popup { WS_POPUP } else { WS_OVERLAPPEDWINDOW };
    let mut ex = if gpu { WS_EX_NOREDIRECTIONBITMAP } else { WINDOW_EX_STYLE(0) };
    if popup {
        // Menus and tooltips: owned by the parent, never activated, not in Alt+Tab or the taskbar.
        ex |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
    }
    let (px, py) = match parent {
        Some((p, x, y)) => {
            let mut pt = POINT { x, y };
            unsafe {
                let _ = windows::Win32::Graphics::Gdi::ClientToScreen(p, &mut pt);
            }
            (pt.x, pt.y)
        }
        None => (CW_USEDEFAULT, CW_USEDEFAULT),
    };
    let ssd = ssd && !popup;
    let dpi = unsafe { windows::Win32::UI::HiDpi::GetDpiForSystem() };
    let mut rc = RECT { left: 0, top: 0, right: w as i32, bottom: h as i32 };
    if ssd {
        unsafe {
            let _ = AdjustWindowRectExForDpi(&mut rc, style, false, ex, dpi);
        }
    }
    let hinstance = unsafe { windows::Win32::System::LibraryLoader::GetModuleHandleW(None).unwrap_or_default() };
    let hwnd = unsafe {
        CreateWindowExW(
            ex,
            CLASS,
            &HSTRING::from(title),
            style,
            px,
            py,
            rc.right - rc.left,
            rc.bottom - rc.top,
            parent.map(|p| p.0),
            None,
            Some(hinstance.into()),
            None,
        )
    };
    let hwnd = match hwnd {
        Ok(h) => h,
        Err(e) => {
            eprintln!("bunos-wayland-win: CreateWindowEx: {e}");
            return;
        }
    };
    with_app(|a| {
        let surface = a.gpu.as_ref().and_then(|g| match g.surface(hwnd, w, h, true) {
            Ok(s) => Some(s),
            Err(e) => {
                eprintln!("bunos-wayland-win: swap chain: {e}");
                None
            }
        });
        apply_backdrop(hwnd, if popup { Backdrop::None } else { a.opts.backdrop }, a.dark);
        a.by_hwnd.insert(hwnd.0 as isize, id);
        a.wins.insert(
            id,
            Win {
                id,
                hwnd,
                w,
                h,
                pixels: vec![0; w as usize * h as usize * 4],
                ssd,
                surface,
                translucent: false,
                fullscreen: None,
                tracking: false,
                buttons: 0,
            },
        );
    });
    unsafe {
        if !ssd {
            // Client-side decorations: drop the Win32 caption and borders (WM_NCCALCSIZE), keep DWM shadow/snap.
            let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER);
        }
        if popup {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = SetFocus(Some(hwnd));
        }
    }
}

fn send_configure(hwnd: HWND) {
    let mut rc = RECT::default();
    unsafe {
        let _ = GetClientRect(hwnd, &mut rc);
    }
    let (cw, ch) = ((rc.right - rc.left).max(0) as u32, (rc.bottom - rc.top).max(0) as u32);
    if cw == 0 || ch == 0 {
        return;
    }
    let zoomed = unsafe { IsZoomed(hwnd).as_bool() };
    let active = unsafe { GetForegroundWindow() } == hwnd;
    with_app(|a| {
        let Some(&id) = a.by_hwnd.get(&(hwnd.0 as isize)) else { return };
        let full = a.wins.get(&id).map(|w| w.fullscreen.is_some()).unwrap_or(false);
        let mut states = 0;
        if active {
            states |= wire::STATE_ACTIVATED;
        }
        if zoomed {
            states |= wire::STATE_MAXIMIZED;
        }
        if full {
            states |= wire::STATE_FULLSCREEN;
        }
        a.link.send(PresenterMsg::Configure { id, width: cw, height: ch, states });
    });
}

fn lparam_xy(l: LPARAM) -> (f64, f64) {
    let x = (l.0 & 0xffff) as i16 as f64;
    let y = ((l.0 >> 16) & 0xffff) as i16 as f64;
    (x, y)
}

fn send_key(scancode: u32, extended: bool, pressed: bool) {
    let Some(code) = keys::scancode_to_evdev(scancode, extended) else { return };
    with_app(|a| {
        if pressed {
            a.keys_down.insert(code);
        } else if !a.keys_down.remove(&code) {
            return;
        }
        let t = a.link.now_ms();
        a.link.send(PresenterMsg::Key { keycode: code, pressed, time_ms: t });
    });
}

/// Types one character as the physical key (plus Shift / AltGr) that produces it on the active layout.
fn type_char(c: char) {
    let mut units = [0u16; 2];
    let encoded = c.encode_utf16(&mut units);
    if encoded.len() != 1 {
        return;
    }
    let r = unsafe { VkKeyScanW(units[0]) };
    if r == -1 {
        return;
    }
    let (vk, mods) = ((r & 0xff) as u32, ((r >> 8) & 0xff) as u8);
    let vsc = unsafe { MapVirtualKeyW(vk, MAPVK_VK_TO_VSC_EX) };
    let (sc, ext) = (vsc & 0xff, vsc & 0xff00 == 0xe000);
    let altgr = mods & 6 == 6;
    let shift = mods & 1 != 0;
    if altgr {
        send_key(0x38, true, true);
    } else if mods & 2 != 0 {
        send_key(0x1d, false, true);
    }
    if shift {
        send_key(0x2a, false, true);
    }
    send_key(sc, ext, true);
    send_key(sc, ext, false);
    if shift {
        send_key(0x2a, false, false);
    }
    if altgr {
        send_key(0x38, true, false);
    } else if mods & 2 != 0 {
        send_key(0x1d, false, false);
    }
}

/// Windows synthesises a left Ctrl press before every AltGr (right Alt) press; Linux would see Ctrl+AltGr.
fn is_fake_altgr_ctrl(scancode: u32, extended: bool) -> bool {
    if scancode != 0x1d || extended {
        return false;
    }
    let mut next = MSG::default();
    unsafe {
        if PeekMessageW(&mut next, None, WM_KEYFIRST, WM_KEYLAST, PM_NOREMOVE).as_bool() {
            let sc = ((next.lParam.0 >> 16) & 0xff) as u32;
            let ext = (next.lParam.0 >> 24) & 1 == 1;
            return sc == 0x38 && ext && next.time == GetMessageTime() as u32;
        }
    }
    false
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let id = with_app(|a| a.by_hwnd.get(&(hwnd.0 as isize)).copied()).flatten();
    let Some(id) = id else { return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) } };
    match msg {
        WM_NCCALCSIZE if wparam.0 != 0 => {
            let ssd = with_app(|a| a.wins.get(&id).map(|w| w.ssd)).flatten().unwrap_or(true);
            let full = with_app(|a| a.wins.get(&id).map(|w| w.fullscreen.is_some())).flatten().unwrap_or(false);
            if ssd && !full {
                return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
            }
            if unsafe { IsZoomed(hwnd).as_bool() } {
                // A maximized frameless window would overhang the monitor by the frame thickness.
                let p = unsafe { &mut *(lparam.0 as *mut NCCALCSIZE_PARAMS) };
                let dpi = unsafe { GetDpiForWindow(hwnd) };
                let f = unsafe {
                    windows::Win32::UI::HiDpi::GetSystemMetricsForDpi(SM_CXFRAME, dpi)
                        + windows::Win32::UI::HiDpi::GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)
                };
                p.rgrc[0].left += f;
                p.rgrc[0].right -= f;
                p.rgrc[0].top += f;
                p.rgrc[0].bottom -= f;
            }
            LRESULT(0)
        }
        WM_SIZE => {
            if wparam.0 as u32 != SIZE_MINIMIZED {
                send_configure(hwnd);
            }
            LRESULT(0)
        }
        WM_DPICHANGED => {
            let r = unsafe { &*(lparam.0 as *const RECT) };
            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    None,
                    r.left,
                    r.top,
                    r.right - r.left,
                    r.bottom - r.top,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
            LRESULT(0)
        }
        WM_ERASEBKGND => LRESULT(1),
        WM_MOUSEACTIVATE
            if unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32 & WS_EX_NOACTIVATE.0 != 0 =>
        {
            LRESULT(MA_NOACTIVATE as isize)
        }
        WM_PAINT => {
            let mut ps = PAINTSTRUCT::default();
            let hdc = unsafe { BeginPaint(hwnd, &mut ps) };
            with_app(|a| {
                if a.gpu.is_some() {
                    return;
                }
                let Some(w) = a.wins.get(&id) else { return };
                if w.w == 0 || w.h == 0 {
                    return;
                }
                let bmi = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: w.w as i32,
                        biHeight: -(w.h as i32),
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                unsafe {
                    SetDIBitsToDevice(
                        hdc,
                        0,
                        0,
                        w.w,
                        w.h,
                        0,
                        0,
                        0,
                        w.h,
                        w.pixels.as_ptr() as *const _,
                        &bmi,
                        DIB_RGB_COLORS,
                    );
                }
            });
            unsafe {
                let _ = EndPaint(hwnd, &ps);
            }
            LRESULT(0)
        }
        WM_SETCURSOR if (lparam.0 & 0xffff) as u32 == HTCLIENT => {
            let c = with_app(|a| a.cursor).flatten();
            unsafe { SetCursor(c) };
            LRESULT(1)
        }
        WM_MOUSEMOVE => {
            let (x, y) = lparam_xy(lparam);
            let start_tracking = with_app(|a| {
                let t = a.link.now_ms();
                a.link.send(PresenterMsg::PointerMotion { id, x, y, time_ms: t });
                let w = a.wins.get_mut(&id)?;
                let s = !w.tracking;
                w.tracking = true;
                Some(s)
            })
            .flatten()
            .unwrap_or(false);
            if start_tracking {
                let mut tme = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE,
                    hwndTrack: hwnd,
                    dwHoverTime: 0,
                };
                unsafe {
                    let _ = TrackMouseEvent(&mut tme);
                }
            }
            LRESULT(0)
        }
        WM_MOUSELEAVE => {
            with_app(|a| {
                if let Some(w) = a.wins.get_mut(&id) {
                    w.tracking = false;
                }
                a.link.send(PresenterMsg::PointerLeave { id });
            });
            LRESULT(0)
        }
        WM_LBUTTONDOWN | WM_LBUTTONUP | WM_RBUTTONDOWN | WM_RBUTTONUP | WM_MBUTTONDOWN | WM_MBUTTONUP
        | WM_XBUTTONDOWN | WM_XBUTTONUP => {
            let (button, pressed) = match msg {
                WM_LBUTTONDOWN => (keys::BTN_LEFT, true),
                WM_LBUTTONUP => (keys::BTN_LEFT, false),
                WM_RBUTTONDOWN => (keys::BTN_RIGHT, true),
                WM_RBUTTONUP => (keys::BTN_RIGHT, false),
                WM_MBUTTONDOWN => (keys::BTN_MIDDLE, true),
                WM_MBUTTONUP => (keys::BTN_MIDDLE, false),
                _ => {
                    let x = ((wparam.0 >> 16) & 0xffff) as u16;
                    (if x == 1 { keys::BTN_SIDE } else { keys::BTN_EXTRA }, msg == WM_XBUTTONDOWN)
                }
            };
            let (x, y) = lparam_xy(lparam);
            let held = with_app(|a| {
                let t = a.link.now_ms();
                // Position first: the client must know where the click happened.
                a.link.send(PresenterMsg::PointerMotion { id, x, y, time_ms: t });
                a.link.send(PresenterMsg::PointerButton { id, button, pressed, time_ms: t });
                let w = a.wins.get_mut(&id)?;
                let bit = 1 << (button - keys::BTN_LEFT);
                if pressed {
                    w.buttons |= bit;
                } else {
                    w.buttons &= !bit;
                }
                Some(w.buttons)
            })
            .flatten()
            .unwrap_or(0);
            unsafe {
                if pressed {
                    SetCapture(hwnd);
                } else if held == 0 {
                    let _ = ReleaseCapture();
                }
            }
            if msg == WM_XBUTTONDOWN || msg == WM_XBUTTONUP { LRESULT(1) } else { LRESULT(0) }
        }
        WM_MOUSEWHEEL | WM_MOUSEHWHEEL => {
            let delta = ((wparam.0 >> 16) & 0xffff) as i16 as i32;
            with_app(|a| {
                let t = a.link.now_ms();
                let m = if msg == WM_MOUSEWHEEL {
                    // Windows: positive = away from the user (up); Wayland: positive = down.
                    PresenterMsg::PointerAxis { id, dx: 0.0, dy: -delta as f64 * 15.0 / 120.0, v120_x: 0, v120_y: -delta, time_ms: t }
                } else {
                    PresenterMsg::PointerAxis { id, dx: delta as f64 * 15.0 / 120.0, dy: 0.0, v120_x: delta, v120_y: 0, time_ms: t }
                };
                a.link.send(m);
            });
            LRESULT(0)
        }
        WM_KEYDOWN | WM_SYSKEYDOWN | WM_KEYUP | WM_SYSKEYUP => {
            let pressed = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            let repeat = (lparam.0 >> 30) & 1 == 1;
            let mut scancode = ((lparam.0 >> 16) & 0xff) as u32;
            let mut extended = (lparam.0 >> 24) & 1 == 1;
            let vk = wparam.0 as u16;
            if scancode == 0 && vk != VK_PACKET.0 {
                // SendInput without KEYEVENTF_SCANCODE (automation, remote tools): recover the physical key.
                let vsc = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC_EX) };
                scancode = vsc & 0xff;
                extended = vsc & 0xff00 == 0xe000;
            }
            with_app(|a| a.packet = vk == VK_PACKET.0);
            if vk == VK_PACKET.0 {
                return LRESULT(0);
            }
            if vk == VK_F11.0 && pressed && !repeat {
                let full = with_app(|a| a.wins.get(&id).map(|w| w.fullscreen.is_some())).flatten().unwrap_or(false);
                set_fullscreen(hwnd, !full);
                return LRESULT(0);
            }
            if !(pressed && repeat) && !is_fake_altgr_ctrl(scancode, extended) {
                send_key(scancode, extended, pressed);
            }
            if msg == WM_SYSKEYDOWN && vk == VK_F4.0 {
                // Alt+F4 closes like a Win32 app (WM_CLOSE -> xdg_toplevel.close).
                return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
            }
            LRESULT(0)
        }
        WM_CHAR if with_app(|a| a.packet).unwrap_or(false) => {
            // Injected or IME text (VK_PACKET) has no scan code: type it with the active layout.
            if let Some(c) = char::from_u32(wparam.0 as u32) {
                type_char(c);
            }
            LRESULT(0)
        }
        WM_SYSCHAR | WM_CHAR => LRESULT(0),
        WM_SETFOCUS | WM_KILLFOCUS => {
            let focused = msg == WM_SETFOCUS;
            with_app(|a| {
                if !focused {
                    let t = a.link.now_ms();
                    for code in a.keys_down.drain() {
                        a.link.send(PresenterMsg::Key { keycode: code, pressed: false, time_ms: t });
                    }
                }
                a.link.send(PresenterMsg::Focus { id, focused });
            });
            send_configure(hwnd);
            LRESULT(0)
        }
        WM_CLOSE => {
            with_app(|a| a.link.send(PresenterMsg::Close { id }));
            LRESULT(0)
        }
        WM_GETMINMAXINFO => {
            let mmi = unsafe { &mut *(lparam.0 as *mut MINMAXINFO) };
            mmi.ptMinTrackSize = POINT { x: 120, y: 80 };
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

#[allow(dead_code)]
fn _id(w: &Win) -> u32 {
    w.id
}
