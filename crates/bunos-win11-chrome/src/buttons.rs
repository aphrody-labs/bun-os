// SPDX-License-Identifier: Apache-2.0
//! The traffic-light overlay: one owned, layered, non-activating popup per app window, exactly over the native caption
//! buttons (`DWMWA_CAPTION_BUTTON_BOUNDS`), drawn with per-pixel alpha (`UpdateLayeredWindow`).
//!
//! Each overlay lives on its own thread. A window owned by another process's window shares that thread's input queue
//! (cross-thread owner relationships attach input), so one thread per overlay keeps a hung app from stalling the
//! hook thread or any other app's buttons. The hook thread (`watch.rs`) only posts `WM_SYNC` / `WM_CLOSE_OVERLAY`.
//!
//! Nothing runs inside the app: clicks become `PostMessage(WM_SYSCOMMAND, SC_CLOSE | SC_MINIMIZE | SC_MAXIMIZE |
//! SC_RESTORE)` to the owner, the same message its own buttons send. The overlay dies with its owner (the system
//! destroys owned windows) or with this process.

use std::{
    cell::RefCell,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
};

use bunos_win11_chrome::{
    Rgb, WatchConfig,
    paint::{self, Button},
};
use windows::{
    Win32::{
        Foundation::{COLORREF, E_FAIL, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM},
        Graphics::{
            Dwm::{DWMWA_CAPTION_BUTTON_BOUNDS, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute},
            Gdi::{
                AC_SRC_ALPHA, AC_SRC_OVER, BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BLENDFUNCTION, CreateCompatibleDC,
                CreateDIBSection, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetMonitorInfoW, GetPixel, HBITMAP,
                HDC, HGDIOBJ, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow, ReleaseDC, SelectObject,
            },
        },
        System::{
            Com::SAFEARRAY,
            LibraryLoader::GetModuleHandleW,
            Ole::{SafeArrayCreateVector, SafeArrayPutElement},
            Variant::{VARIANT, VT_BOOL, VT_BSTR, VT_I4},
        },
        UI::{
            Accessibility::{
                HIGHCONTRASTW, HCF_HIGHCONTRASTON, IInvokeProvider, IInvokeProvider_Impl,
                IRawElementProviderFragment, IRawElementProviderFragment_Impl, IRawElementProviderFragmentRoot,
                IRawElementProviderFragmentRoot_Impl, IRawElementProviderSimple, IRawElementProviderSimple_Impl,
                NavigateDirection, NavigateDirection_FirstChild, NavigateDirection_LastChild,
                NavigateDirection_NextSibling, NavigateDirection_Parent, NavigateDirection_PreviousSibling,
                ProviderOptions, ProviderOptions_ServerSideProvider, UIA_AutomationIdPropertyId,
                UIA_ButtonControlTypeId, UIA_ControlTypePropertyId, UIA_GroupControlTypeId,
                UIA_HasKeyboardFocusPropertyId, UIA_InvokePatternId, UIA_IsEnabledPropertyId,
                UIA_IsKeyboardFocusablePropertyId, UIA_NamePropertyId, UIA_PATTERN_ID, UIA_PROPERTY_ID, UiaAppendRuntimeId,
                UiaHostProviderFromHwnd, UiaRect, UiaReturnRawElementProvider, UiaRootObjectId,
            },
            HiDpi::GetDpiForWindow,
            Input::KeyboardAndMouse::{ReleaseCapture, SetCapture, TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent},
            WindowsAndMessaging::{
                CS_HREDRAW, CS_VREDRAW, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GWL_STYLE,
                GetForegroundWindow, GetMessageW, GetWindowLongPtrW, GetWindowRect, HTCLIENT, IDC_ARROW,
                IsIconic, IsWindow, IsWindowVisible, IsZoomed, KillTimer, LoadCursorW, MA_NOACTIVATE, MSG, PM_NOREMOVE,
                PeekMessageW, PostMessageW, PostQuitMessage, RegisterClassExW, SC_CLOSE, SC_MAXIMIZE, SC_MINIMIZE,
                SC_RESTORE, SPI_GETHIGHCONTRAST, SW_HIDE, SW_SHOWNOACTIVATE, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
                SetTimer, ShowWindow, SystemParametersInfoW, TranslateMessage, ULW_ALPHA, UpdateLayeredWindow,
                WM_APP, WM_CAPTURECHANGED, WM_DESTROY, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_GETOBJECT, WM_LBUTTONDOWN,
                WM_LBUTTONUP, WM_MOUSEACTIVATE, WM_MOUSELEAVE, WM_MOUSEMOVE, WM_NCHITTEST, WM_SETTINGCHANGE,
                WM_SYSCOMMAND, WM_THEMECHANGED, WM_TIMER, WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
                WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP, WindowFromPoint, GA_ROOT, GetAncestor,
            },
        },
    },
    core::{BSTR, Error, Interface, PCWSTR, Result, implement, w},
};

/// Window class of every overlay: GlazeWM and tacky-borders ignore it (`crates/bunos-win11/src/hyprwin.rs`).
pub const CLASS: PCWSTR = w!("BunOSTrafficLights");
/// Re-read the owner's geometry and state (posted by the hook thread, coalesced through `Slot::pending`).
pub const WM_SYNC: u32 = WM_APP + 1;
/// Destroy the overlay and end its thread.
pub const WM_CLOSE_OVERLAY: u32 = WM_APP + 2;
const TIMER_SAMPLE: usize = 1;

/// The hook thread's handle on one overlay thread.
pub struct Slot {
    pub tid: u32,
    pub pending: Arc<AtomicBool>,
    pub thread: std::thread::JoinHandle<()>,
}

impl Slot {
    /// Ask the overlay to follow its owner; at most one sync is queued at a time.
    pub fn sync(&self) -> bool {
        if self.pending.swap(true, Ordering::AcqRel) {
            return true;
        }
        // SAFETY: posting a thread message; fails only when the thread is gone.
        unsafe { windows::Win32::UI::WindowsAndMessaging::PostThreadMessageW(self.tid, WM_SYNC, WPARAM(0), LPARAM(0)) }
            .is_ok()
    }

    pub fn close(&self) {
        // SAFETY: as above.
        let _ = unsafe {
            windows::Win32::UI::WindowsAndMessaging::PostThreadMessageW(self.tid, WM_CLOSE_OVERLAY, WPARAM(0), LPARAM(0))
        };
    }
}

/// Start the overlay thread for `owner` (an `HWND` value).
pub fn spawn(owner: isize, cfg: Arc<WatchConfig>) -> Option<Slot> {
    let (tx, rx) = mpsc::channel();
    let pending = Arc::new(AtomicBool::new(false));
    let flag = pending.clone();
    let thread = std::thread::Builder::new()
        .name(format!("traffic-{owner:x}"))
        .stack_size(256 * 1024)
        .spawn(move || run(HWND(owner as *mut _), cfg, flag, tx))
        .ok()?;
    let tid = rx.recv().ok()?;
    Some(Slot { tid, pending, thread })
}

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

struct Overlay {
    hwnd: HWND,
    owner: HWND,
    cfg: Arc<WatchConfig>,
    pending: Arc<AtomicBool>,
    state: paint::State,
    /// Screen position of the overlay.
    origin: POINT,
    shown: bool,
    rendered: Option<(paint::State, POINT)>,
    tracking: bool,
    capture: Option<Button>,
    /// Title-bar colour sampled next to the buttons (`None` until the first sample).
    sampled: Option<Rgb>,
    root: Option<IRawElementProviderSimple>,
    surface: Option<Surface>,
}

struct Surface {
    dc: HDC,
    bitmap: HBITMAP,
    old: HGDIOBJ,
    bits: *mut u32,
    size: (u32, u32),
}

impl Drop for Surface {
    fn drop(&mut self) {
        // SAFETY: objects created by `Surface::new`, released once.
        unsafe {
            SelectObject(self.dc, self.old);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

impl Surface {
    fn new(width: u32, height: u32) -> Option<Self> {
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        // SAFETY: a 32-bit DIB selected into a memory DC; `bits` points at width*height u32 owned by the bitmap.
        unsafe {
            let dc = CreateCompatibleDC(None);
            let bitmap = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
            let old = SelectObject(dc, bitmap.into());
            Some(Self { dc, bitmap, old, bits: bits.cast(), size: (width, height) })
        }
    }
}

fn run(owner: HWND, cfg: Arc<WatchConfig>, pending: Arc<AtomicBool>, ready: mpsc::Sender<u32>) {
    // SAFETY: plain Win32 on this thread; every handle used here is owned by this thread or only queried.
    unsafe {
        let mut msg = MSG::default();
        let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE); // create the queue before announcing the thread
        let _ = ready.send(windows::Win32::System::Threading::GetCurrentThreadId());
        let Ok(instance) = GetModuleHandleW(None) else { return };
        register(instance.into());
        let Ok(hwnd) = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            CLASS,
            w!("Window controls"),
            WS_POPUP,
            0,
            0,
            0,
            0,
            Some(owner),
            None,
            Some(instance.into()),
            None,
        ) else {
            return;
        };
        let state = paint::State {
            width: 0,
            height: 0,
            scale: 1.0,
            active: false,
            hover: false,
            pressed: None,
            focus: None,
            enabled: [true; 3],
            close_only: false,
            background: cfg.chrome.caption.unwrap_or(Rgb(0x1e1e24)),
            corner: 0.0,
        };
        OVERLAY.with_borrow_mut(|o| {
            *o = Some(Overlay {
                hwnd,
                owner,
                cfg,
                pending,
                state,
                origin: POINT::default(),
                shown: false,
                rendered: None,
                tracking: false,
                capture: None,
                sampled: None,
                root: None,
                surface: None,
            });
        });
        with(Overlay::sync);
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            if msg.hwnd.is_invalid() {
                match msg.message {
                    WM_SYNC => with(Overlay::sync),
                    WM_CLOSE_OVERLAY => {
                        let _ = DestroyWindow(hwnd);
                    }
                    _ => {}
                }
                continue;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        OVERLAY.with_borrow_mut(|o| *o = None);
    }
}

fn register(instance: windows::Win32::Foundation::HINSTANCE) {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        // SAFETY: registering a window class with a static name and this module's procedure.
        unsafe {
            let class = WNDCLASSEXW {
                cbSize: size_of::<WNDCLASSEXW>() as u32,
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(proc),
                hInstance: instance,
                hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
                lpszClassName: CLASS,
                ..Default::default()
            };
            RegisterClassExW(&class);
        }
    });
}

/// Run `f` on this thread's overlay, if any (not re-entrant: callers never nest).
fn with<R: Default>(f: impl FnOnce(&mut Overlay) -> R) -> R {
    OVERLAY.with(|cell| cell.try_borrow_mut().ok().and_then(|mut o| o.as_mut().map(f)).unwrap_or_default())
}

fn rect_of(hwnd: HWND, attr: windows::Win32::Graphics::Dwm::DWMWINDOWATTRIBUTE) -> Option<RECT> {
    let mut r = RECT::default();
    // SAFETY: documented DWM getter with an exactly sized out buffer.
    unsafe { DwmGetWindowAttribute(hwnd, attr, (&raw mut r).cast(), size_of::<RECT>() as u32) }.ok()?;
    (r.right > r.left && r.bottom > r.top).then_some(r)
}

pub fn cloaked(hwnd: HWND) -> bool {
    let mut v = 0u32;
    // SAFETY: as above.
    unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&raw mut v).cast(), 4) }.is_ok() && v != 0
}

fn high_contrast() -> bool {
    let mut hc = HIGHCONTRASTW { cbSize: size_of::<HIGHCONTRASTW>() as u32, ..Default::default() };
    // SAFETY: SPI_GETHIGHCONTRAST fills the struct whose size is given.
    unsafe {
        SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            hc.cbSize,
            Some((&raw mut hc).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    }
    .is_ok()
        && hc.dwFlags.contains(HCF_HIGHCONTRASTON)
}

/// Whether `hwnd` covers its whole monitor without being maximised (exclusive or borderless full screen).
pub fn fullscreen(hwnd: HWND) -> bool {
    // SAFETY: read-only window and monitor queries.
    unsafe {
        let mut wr = RECT::default();
        if GetWindowRect(hwnd, &mut wr).is_err() || IsZoomed(hwnd).as_bool() {
            return false;
        }
        let mut mi = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut mi).as_bool() {
            return false;
        }
        let m = mi.rcMonitor;
        wr.left <= m.left && wr.top <= m.top && wr.right >= m.right && wr.bottom >= m.bottom
    }
}

/// Where the buttons go, in screen pixels: the native caption-button rectangle, inset off the DWM border.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    pub rect: RECT,
    pub scale: f32,
    pub corner: f32,
    /// `DWMWA_CAPTION_BUTTON_BOUNDS` answered (false: computed from the system metrics).
    pub native: bool,
}

/// The native caption buttons of `owner` and how they are covered.
pub fn placement(owner: HWND, close_only: bool) -> Option<Placement> {
    // SAFETY: read-only window queries.
    unsafe {
        let mut wr = RECT::default();
        GetWindowRect(owner, &mut wr).ok()?;
        let frame = rect_of(owner, DWMWA_EXTENDED_FRAME_BOUNDS).unwrap_or(wr);
        let dpi = GetDpiForWindow(owner).max(96);
        let scale = dpi as f32 / 96.0;
        let maximized = IsZoomed(owner).as_bool();
        let (mut rect, native) = match rect_of(owner, DWMWA_CAPTION_BUTTON_BOUNDS) {
            Some(b) => (
                RECT { left: wr.left + b.left, top: wr.top + b.top, right: wr.left + b.right, bottom: wr.top + b.bottom },
                true,
            ),
            None => {
                // Windows 11 caption buttons: 46 x 30 DIP each (top-aligned, 22 DIP tall-ish when maximised).
                let n = if close_only { 1 } else { 3 };
                let bw = (46.0 * scale).round() as i32;
                let bh = ((if maximized { 22.0 } else { 30.0 }) * scale).round() as i32;
                (RECT { left: frame.right - n * bw, top: frame.top, right: frame.right, bottom: frame.top + bh }, false)
            }
        };
        rect.left = rect.left.max(frame.left);
        rect.top = rect.top.max(frame.top);
        rect.right = rect.right.min(frame.right);
        rect.bottom = rect.bottom.min(frame.bottom);
        // Leave the 1 px DWM border (and the rounded corner) of a restored window visible.
        let mut corner = 0.0;
        if !maximized {
            let (at_top, at_right) = (rect.top <= frame.top, rect.right >= frame.right);
            if at_top {
                rect.top = frame.top + 1;
            }
            if at_right {
                rect.right = frame.right - 1;
            }
            if at_top && at_right {
                corner = (8.0 * scale - 1.0).max(0.0);
            }
        }
        (rect.right - rect.left >= 8 && rect.bottom - rect.top >= 8).then_some(Placement { rect, scale, corner, native })
    }
}

impl Overlay {
    fn hide(&mut self) {
        if self.shown {
            // SAFETY: our own window.
            unsafe {
                let _ = ShowWindow(self.hwnd, SW_HIDE);
            }
            self.shown = false;
        }
    }

    fn sync(&mut self) {
        self.pending.store(false, Ordering::Release);
        let owner = self.owner;
        // SAFETY: read-only queries on the owner.
        let (alive, visible, style) = unsafe {
            (
                IsWindow(Some(owner)).as_bool(),
                IsWindowVisible(owner).as_bool() && !IsIconic(owner).as_bool(),
                GetWindowLongPtrW(owner, GWL_STYLE) as u32,
            )
        };
        if !alive {
            // SAFETY: our own window.
            unsafe {
                let _ = DestroyWindow(self.hwnd);
            }
            return;
        }
        let (min, max) = (style & WS_MINIMIZEBOX.0 != 0, style & WS_MAXIMIZEBOX.0 != 0);
        let close_only = !min && !max;
        let place = placement(owner, close_only);
        let Some(place) = place.filter(|_| visible && !cloaked(owner) && !fullscreen(owner) && !high_contrast())
        else {
            self.hide();
            return;
        };
        let r = place.rect;
        let (w, h) = ((r.right - r.left) as u32, (r.bottom - r.top) as u32);
        // SAFETY: plain query.
        let active = unsafe { GetForegroundWindow() } == owner;
        let moved = self.state.width != w || self.state.height != h || self.origin != POINT { x: r.left, y: r.top };
        let reactivated = self.state.active != active;
        self.state.width = w;
        self.state.height = h;
        self.state.scale = place.scale;
        self.state.corner = place.corner;
        self.state.active = active;
        self.state.enabled = [true, min, max];
        self.state.close_only = close_only;
        self.origin = POINT { x: r.left, y: r.top };
        if self.sampled.is_none() {
            // First paint: sample now (the overlay is not on screen yet), then again once the app has repainted.
            self.sample();
        }
        if let Some(bg) = self.sampled {
            self.state.background = bg;
        }
        self.present();
        if moved || reactivated {
            // The caption colour changes with activation and settles after a move: resample once the app repainted.
            // SAFETY: a timer on our own window.
            unsafe { SetTimer(Some(self.hwnd), TIMER_SAMPLE, 180, None) };
        }
    }

    /// Sample the title-bar colour just left of the native buttons, when that pixel belongs to the owner.
    fn sample(&mut self) {
        let (x, y) = (self.origin.x - (4.0 * self.state.scale) as i32, self.origin.y + (self.state.height as i32 / 4).max(2));
        // SAFETY: point query and a one-pixel read of the composed screen.
        unsafe {
            let under = WindowFromPoint(POINT { x, y });
            if GetAncestor(under, GA_ROOT) != self.owner {
                return;
            }
            let dc = GetDC(None);
            let c: COLORREF = GetPixel(dc, x, y);
            ReleaseDC(None, dc);
            if c.0 != 0xFFFF_FFFF {
                let (r, g, b) = (c.0 & 0xff, (c.0 >> 8) & 0xff, (c.0 >> 16) & 0xff);
                self.sampled = Some(Rgb((r << 16) | (g << 8) | b));
            }
        }
    }

    fn present(&mut self) {
        let key = (self.state, self.origin);
        if self.rendered == Some(key) && self.shown {
            return;
        }
        let (w, h) = (self.state.width, self.state.height);
        if self.surface.as_ref().is_none_or(|s| s.size != (w, h)) {
            self.surface = Surface::new(w, h);
        }
        let Some(surface) = &self.surface else { return };
        if self.rendered.is_none_or(|(s, _)| s != self.state) {
            let pixels = paint::render(&self.state, &self.cfg.traffic, &self.cfg.buttons);
            // SAFETY: the DIB holds exactly w*h pixels.
            unsafe { std::ptr::copy_nonoverlapping(pixels.as_ptr(), surface.bits, pixels.len()) };
        }
        let blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
        };
        let size = SIZE { cx: w as i32, cy: h as i32 };
        let src = POINT::default();
        // SAFETY: our own layered window and DC.
        unsafe {
            let _ = UpdateLayeredWindow(
                self.hwnd,
                None,
                Some(&self.origin),
                Some(&size),
                Some(surface.dc),
                Some(&src),
                COLORREF(0),
                Some(&blend),
                ULW_ALPHA,
            );
            if !self.shown {
                let _ = ShowWindow(self.hwnd, SW_SHOWNOACTIVATE);
                self.shown = true;
            }
        }
        self.rendered = Some(key);
    }

    fn act(&self, button: Button) {
        // SAFETY: posting the owner's own caption commands.
        unsafe {
            let cmd = match button {
                Button::Close => SC_CLOSE,
                Button::Minimize => SC_MINIMIZE,
                Button::Zoom if IsZoomed(self.owner).as_bool() => SC_RESTORE,
                Button::Zoom => SC_MAXIMIZE,
            };
            let _ = PostMessageW(Some(self.owner), WM_SYSCOMMAND, WPARAM(cmd as usize), LPARAM(0));
        }
    }

    fn local(lparam: LPARAM) -> (f32, f32) {
        let x = (lparam.0 & 0xffff) as i16 as f32;
        let y = ((lparam.0 >> 16) & 0xffff) as i16 as f32;
        (x + 0.5, y + 0.5)
    }

    fn hit(&self, lparam: LPARAM) -> Option<Button> {
        let (x, y) = Self::local(lparam);
        paint::hit(&self.state, &self.cfg.traffic, x, y)
    }

    /// Screen bounds of `button`'s hit area, for UIA.
    fn bounds(&self, button: Button) -> UiaRect {
        let (l, r) = paint::hit_span(&self.state, &self.cfg.traffic, button).unwrap_or((0.0, 0.0));
        UiaRect {
            left: f64::from(self.origin.x) + f64::from(l),
            top: f64::from(self.origin.y),
            width: f64::from(r - l),
            height: f64::from(self.state.height),
        }
    }

    fn drawn(&self, button: Button) -> bool {
        !self.state.close_only || button == Button::Close
    }
}

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        WM_NCHITTEST => return LRESULT(HTCLIENT as isize),
        WM_MOUSEMOVE => {
            with(|o| {
                if !o.tracking {
                    let mut tme = TRACKMOUSEEVENT {
                        cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                        dwFlags: TME_LEAVE,
                        hwndTrack: hwnd,
                        dwHoverTime: 0,
                    };
                    // SAFETY: tracking our own window.
                    let _ = unsafe { TrackMouseEvent(&mut tme) };
                    o.tracking = true;
                }
                o.state.hover = true;
                o.state.pressed = o.capture.filter(|&c| o.hit(lparam) == Some(c));
                o.present();
            });
            return LRESULT(0);
        }
        WM_MOUSELEAVE => {
            with(|o| {
                o.tracking = false;
                if o.capture.is_none() {
                    o.state.hover = false;
                    o.state.pressed = None;
                    o.present();
                }
            });
            return LRESULT(0);
        }
        WM_LBUTTONDOWN => {
            with(|o| {
                if let Some(b) = o.hit(lparam) {
                    // SAFETY: capturing to our own window.
                    unsafe { SetCapture(hwnd) };
                    o.capture = Some(b);
                    o.state.pressed = Some(b);
                    o.present();
                }
            });
            return LRESULT(0);
        }
        WM_LBUTTONUP => {
            let action = with(|o| {
                let target = o.capture.take().filter(|&c| o.hit(lparam) == Some(c));
                o.state.pressed = None;
                if target.is_some() {
                    o.state.hover = false;
                }
                o.present();
                target.map(|b| (b, o.owner))
            });
            // SAFETY: releasing our own capture (outside the borrow: it sends WM_CAPTURECHANGED).
            let _ = unsafe { ReleaseCapture() };
            if let Some((b, _)) = action {
                with(|o| o.act(b));
            }
            return LRESULT(0);
        }
        WM_CAPTURECHANGED => {
            with(|o| {
                if o.capture.take().is_some() {
                    o.state.pressed = None;
                    o.present();
                }
            });
            return LRESULT(0);
        }
        WM_TIMER if wparam.0 == TIMER_SAMPLE => {
            // SAFETY: our own timer.
            let _ = unsafe { KillTimer(Some(hwnd), TIMER_SAMPLE) };
            with(|o| {
                o.sample();
                if let Some(bg) = o.sampled {
                    o.state.background = bg;
                }
                o.present();
            });
            return LRESULT(0);
        }
        // Positioned explicitly from the owner's geometry; never take the system's suggested rectangle.
        WM_DPICHANGED => {
            with(Overlay::sync);
            return LRESULT(0);
        }
        WM_SETTINGCHANGE | WM_DISPLAYCHANGE | WM_THEMECHANGED => {
            with(Overlay::sync);
        }
        WM_GETOBJECT if lparam.0 as i32 == UiaRootObjectId => {
            let root = with(|o| {
                Some(o.root.get_or_insert_with(|| Root { hwnd: hwnd.0 as isize }.into()).clone())
            });
            if let Some(root) = root {
                // SAFETY: documented UIA server-side handshake.
                return unsafe { UiaReturnRawElementProvider(hwnd, wparam, lparam, &root) };
            }
        }
        WM_DESTROY => {
            // SAFETY: tell UIA the providers are gone, then end the thread's loop.
            unsafe {
                let _ = UiaReturnRawElementProvider(hwnd, WPARAM(0), LPARAM(0), None::<&IRawElementProviderSimple>);
                PostQuitMessage(0);
            }
        }
        _ => {}
    }
    // SAFETY: default processing.
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

// ------------------------------------------------------------------------------------------------------------ UIA

fn variant_i32(v: i32) -> VARIANT {
    let mut var = VARIANT::default();
    // SAFETY: writing the active union member together with its tag.
    unsafe {
        (*var.Anonymous.Anonymous).vt = VT_I4;
        (*var.Anonymous.Anonymous).Anonymous.lVal = v;
    }
    var
}

fn variant_bool(v: bool) -> VARIANT {
    let mut var = VARIANT::default();
    // SAFETY: as above.
    unsafe {
        (*var.Anonymous.Anonymous).vt = VT_BOOL;
        (*var.Anonymous.Anonymous).Anonymous.boolVal =
            windows::Win32::Foundation::VARIANT_BOOL(if v { -1 } else { 0 });
    }
    var
}

fn variant_str(s: &str) -> VARIANT {
    let mut var = VARIANT::default();
    // SAFETY: as above; the BSTR is owned by the VARIANT and freed by the caller (UIA).
    unsafe {
        (*var.Anonymous.Anonymous).vt = VT_BSTR;
        (*var.Anonymous.Anonymous).Anonymous.bstrVal = std::mem::ManuallyDrop::new(BSTR::from(s));
    }
    var
}

fn gone() -> Error {
    // UIA_E_ELEMENTNOTAVAILABLE
    Error::from_hresult(windows::core::HRESULT(0x8004_0201_u32 as i32))
}

/// Read the overlay of this thread without holding the borrow across UIA calls.
fn read<R>(f: impl FnOnce(&Overlay) -> R) -> Result<R> {
    OVERLAY.with(|cell| cell.try_borrow().ok().and_then(|o| o.as_ref().map(f))).ok_or_else(gone)
}

/// The overlay's fragment root: a group named "Window controls" with the three buttons as children.
#[implement(IRawElementProviderSimple, IRawElementProviderFragment, IRawElementProviderFragmentRoot)]
struct Root {
    hwnd: isize,
}

/// One caption button.
#[implement(IRawElementProviderSimple, IRawElementProviderFragment, IInvokeProvider)]
struct Child {
    hwnd: isize,
    button: Button,
}

fn child(hwnd: isize, button: Button) -> IRawElementProviderFragment {
    Child { hwnd, button }.into()
}

fn drawn_buttons() -> Result<Vec<Button>> {
    read(|o| Button::ALL.into_iter().filter(|&b| o.drawn(b)).collect())
}

impl IRawElementProviderSimple_Impl for Root_Impl {
    fn ProviderOptions(&self) -> Result<ProviderOptions> {
        Ok(ProviderOptions_ServerSideProvider)
    }

    fn GetPatternProvider(&self, _: UIA_PATTERN_ID) -> Result<windows::core::IUnknown> {
        Err(Error::empty())
    }

    fn GetPropertyValue(&self, id: UIA_PROPERTY_ID) -> Result<VARIANT> {
        Ok(match id {
            UIA_NamePropertyId => variant_str("Window controls"),
            UIA_ControlTypePropertyId => variant_i32(UIA_GroupControlTypeId.0),
            UIA_AutomationIdPropertyId => variant_str("bunos-traffic-lights"),
            _ => VARIANT::default(),
        })
    }

    fn HostRawElementProvider(&self) -> Result<IRawElementProviderSimple> {
        // SAFETY: the host provider of our own window.
        unsafe { UiaHostProviderFromHwnd(HWND(self.hwnd as *mut _)) }
    }
}

impl IRawElementProviderFragment_Impl for Root_Impl {
    fn Navigate(&self, direction: NavigateDirection) -> Result<IRawElementProviderFragment> {
        let drawn = drawn_buttons()?;
        let pick = match direction {
            NavigateDirection_FirstChild => drawn.first().copied(),
            NavigateDirection_LastChild => drawn.last().copied(),
            _ => None,
        };
        pick.map(|b| child(self.hwnd, b)).ok_or_else(Error::empty)
    }

    fn GetRuntimeId(&self) -> Result<*mut SAFEARRAY> {
        Ok(std::ptr::null_mut())
    }

    fn BoundingRectangle(&self) -> Result<UiaRect> {
        Ok(UiaRect::default())
    }

    fn GetEmbeddedFragmentRoots(&self) -> Result<*mut SAFEARRAY> {
        Ok(std::ptr::null_mut())
    }

    fn SetFocus(&self) -> Result<()> {
        Ok(())
    }

    fn FragmentRoot(&self) -> Result<IRawElementProviderFragmentRoot> {
        self.cast()
    }
}

impl IRawElementProviderFragmentRoot_Impl for Root_Impl {
    fn ElementProviderFromPoint(&self, x: f64, y: f64) -> Result<IRawElementProviderFragment> {
        let b = read(|o| {
            paint::hit(&o.state, &o.cfg.traffic, (x - f64::from(o.origin.x)) as f32, (y - f64::from(o.origin.y)) as f32)
        })?;
        match b {
            Some(b) => Ok(child(self.hwnd, b)),
            None => self.cast(),
        }
    }

    fn GetFocus(&self) -> Result<IRawElementProviderFragment> {
        read(|o| o.state.focus)?.map(|b| child(self.hwnd, b)).ok_or_else(Error::empty)
    }
}

impl IRawElementProviderSimple_Impl for Child_Impl {
    fn ProviderOptions(&self) -> Result<ProviderOptions> {
        Ok(ProviderOptions_ServerSideProvider)
    }

    fn GetPatternProvider(&self, id: UIA_PATTERN_ID) -> Result<windows::core::IUnknown> {
        if id == UIA_InvokePatternId {
            let invoke: IInvokeProvider = self.cast()?;
            return invoke.cast();
        }
        Err(Error::empty())
    }

    fn GetPropertyValue(&self, id: UIA_PROPERTY_ID) -> Result<VARIANT> {
        let b = self.button;
        let (enabled, focused) = read(|o| (o.state.enabled[b.index()], o.state.focus == Some(b)))?;
        Ok(match id {
            UIA_NamePropertyId => variant_str(b.name()),
            UIA_ControlTypePropertyId => variant_i32(UIA_ButtonControlTypeId.0),
            UIA_AutomationIdPropertyId => variant_str(b.automation_id()),
            UIA_IsEnabledPropertyId => variant_bool(enabled),
            UIA_IsKeyboardFocusablePropertyId => variant_bool(enabled),
            UIA_HasKeyboardFocusPropertyId => variant_bool(focused),
            _ => VARIANT::default(),
        })
    }

    fn HostRawElementProvider(&self) -> Result<IRawElementProviderSimple> {
        Err(Error::empty())
    }
}

impl IRawElementProviderFragment_Impl for Child_Impl {
    fn Navigate(&self, direction: NavigateDirection) -> Result<IRawElementProviderFragment> {
        if direction == NavigateDirection_Parent {
            let root: IRawElementProviderFragment = Root { hwnd: self.hwnd }.into();
            return Ok(root);
        }
        let drawn = drawn_buttons()?;
        let i = drawn.iter().position(|&b| b == self.button).ok_or_else(gone)?;
        let next = match direction {
            NavigateDirection_NextSibling => drawn.get(i + 1).copied(),
            NavigateDirection_PreviousSibling => i.checked_sub(1).and_then(|j| drawn.get(j).copied()),
            _ => None,
        };
        next.map(|b| child(self.hwnd, b)).ok_or_else(Error::empty)
    }

    fn GetRuntimeId(&self) -> Result<*mut SAFEARRAY> {
        // SAFETY: a two-element VT_I4 vector, handed to UIA which frees it.
        unsafe {
            let sa = SafeArrayCreateVector(VT_I4, 0, 2);
            if sa.is_null() {
                return Err(E_FAIL.into());
            }
            for (i, v) in [UiaAppendRuntimeId as i32, self.button.index() as i32 + 1].into_iter().enumerate() {
                SafeArrayPutElement(sa, &(i as i32), (&raw const v).cast())?;
            }
            Ok(sa)
        }
    }

    fn BoundingRectangle(&self) -> Result<UiaRect> {
        read(|o| o.bounds(self.button))
    }

    fn GetEmbeddedFragmentRoots(&self) -> Result<*mut SAFEARRAY> {
        Ok(std::ptr::null_mut())
    }

    fn SetFocus(&self) -> Result<()> {
        let b = self.button;
        OVERLAY.with(|cell| {
            if let Ok(mut o) = cell.try_borrow_mut()
                && let Some(o) = o.as_mut()
            {
                o.state.focus = Some(b);
                o.present();
            }
        });
        Ok(())
    }

    fn FragmentRoot(&self) -> Result<IRawElementProviderFragmentRoot> {
        Root { hwnd: self.hwnd }.into_interface::<IRawElementProviderFragmentRoot>().cast()
    }
}

impl IInvokeProvider_Impl for Child_Impl {
    fn Invoke(&self) -> Result<()> {
        let b = self.button;
        let enabled = read(|o| o.state.enabled[b.index()])?;
        if !enabled {
            return Err(Error::from_hresult(windows::core::HRESULT(0x8013_1509_u32 as i32))); // UIA_E_ELEMENTNOTENABLED
        }
        read(|o| o.act(b))
    }
}

