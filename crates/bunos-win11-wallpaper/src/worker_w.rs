// SPDX-License-Identifier: Apache-2.0
//! Acquire the `WorkerW` window that sits behind the desktop icons, and host a child window in it.
//!
//! The technique is the documented-by-reverse-engineering Progman trick used by every Windows wallpaper engine:
//! send `0x052C` to `Progman`, which makes Explorer spawn a `WorkerW` between the icon `SysListView32` and the
//! wallpaper. We then enumerate top-level windows to find the `WorkerW` that owns a `SHELLDLL_DefView`-less layer
//! and create our render child under it. Closing the child restores the normal desktop; nothing is persisted.

use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::LibraryLoader::GetModuleHandleW,
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, FindWindowExW, FindWindowW, GetSystemMetrics, RegisterClassW,
            SendMessageTimeoutW, CW_USEDEFAULT, SMTO_NORMAL, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
            SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, WNDCLASSW, WS_CHILD, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_VISIBLE,
        },
    },
};

/// The virtual screen rectangle (all monitors): (x, y, width, height).
#[must_use]
pub fn virtual_screen() -> (i32, i32, i32, i32) {
    // SAFETY: GetSystemMetrics takes no pointers.
    unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    }
}

extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // SAFETY: standard default window procedure.
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// Spawn the `WorkerW` layer and return its handle value (as `isize`), or an error.
pub fn spawn_worker_w() -> Result<isize, String> {
    // SAFETY: Progman is the shell window; the magic message is the documented wallpaper trick.
    unsafe {
        let progman = FindWindowW(w!("Progman"), PCWSTR::null()).map_err(|e| e.to_string())?;
        let mut result = 0usize;
        SendMessageTimeoutW(progman, 0x052C, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, Some(&mut result));

        // Find the WorkerW that has no SHELLDLL_DefView child: that is the layer behind the icons.
        let mut worker = HWND::default();
        let mut after = HWND::default();
        loop {
            let Ok(w) = FindWindowExW(Some(progman), Some(after), w!("WorkerW"), PCWSTR::null()) else { break };
            if w.0.is_null() {
                // No sibling WorkerW under Progman: on some builds the WorkerW is a top-level window.
                worker = find_top_level_worker_w().unwrap_or_default();
                break;
            }
            if FindWindowExW(Some(w), None, w!("SHELLDLL_DefView"), PCWSTR::null()).is_err() {
                worker = w;
            }
            after = w;
        }
        if worker.0.is_null() {
            worker = find_top_level_worker_w().ok_or("no WorkerW found")?;
        }
        Ok(worker.0 as isize)
    }
}

unsafe fn find_top_level_worker_w() -> Option<HWND> {
    let mut after = HWND::default();
    loop {
        // SAFETY: documented window-enumeration calls; `after` is a valid handle or null.
        let w = unsafe { FindWindowExW(None, Some(after), w!("WorkerW"), PCWSTR::null()) }.ok()?;
        if w.0.is_null() {
            return None;
        }
        // The desktop WorkerW is a direct child candidate with a SHELLDLL_DefView sibling in the shell; accept the
        // first top-level WorkerW as a fallback.
        // SAFETY: `w` is a valid window handle returned above.
        if unsafe { FindWindowExW(Some(w), None, w!("SHELLDLL_DefView"), PCWSTR::null()) }.is_ok() {
            return Some(w);
        }
        after = w;
    }
}

/// A render child window parented into the `WorkerW` layer, spanning the virtual screen.
pub struct WallpaperWindow {
    pub hwnd: isize,
    pub width: u32,
    pub height: u32,
}

impl WallpaperWindow {
    /// Create the child window under `worker_w`.
    pub fn create(worker_w: isize) -> Result<Self, String> {
        let (x, y, w_px, h_px) = virtual_screen();
        // SAFETY: standard window-class registration and creation.
        unsafe {
            let hinstance = GetModuleHandleW(PCWSTR::null()).map_err(|e| e.to_string())?;
            let class = WNDCLASSW {
                lpfnWndProc: Some(wnd_proc),
                hInstance: hinstance.into(),
                lpszClassName: w!("BunOSWallpaper"),
                ..Default::default()
            };
            RegisterClassW(&class);
            let hwnd = CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                w!("BunOSWallpaper"),
                PCWSTR::null(),
                WS_CHILD | WS_VISIBLE,
                0,
                0,
                w_px,
                h_px,
                Some(HWND(worker_w as *mut core::ffi::c_void)),
                None,
                Some(hinstance.into()),
                None,
            )
            .map_err(|e| e.to_string())?;
            let _ = (x, y, CW_USEDEFAULT);
            Ok(Self { hwnd: hwnd.0 as isize, width: w_px.max(1) as u32, height: h_px.max(1) as u32 })
        }
    }
}
