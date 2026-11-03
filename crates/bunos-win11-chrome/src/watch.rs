// SPDX-License-Identifier: Apache-2.0
//! `bunos-win11-chrome watch`: apply the chrome to every captioned top-level window now and to
//! each one shown later (an out-of-context `EVENT_OBJECT_SHOW` hook), until the process exits.
//! Nothing is patched: the DWM attributes live on each window and vanish with it.

use bunos_win11_chrome::{Chrome, apply};
use windows::Win32::{
    Foundation::{HWND, LPARAM},
    UI::{
        Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent},
        WindowsAndMessaging::{
            DispatchMessageW, EVENT_OBJECT_SHOW, EnumWindows, GA_ROOT, GWL_EXSTYLE, GWL_STYLE,
            GetAncestor, GetMessageW, GetWindowLongPtrW, IsWindowVisible, MSG, OBJID_WINDOW,
            TranslateMessage, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WS_CAPTION,
            WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        },
    },
};
use windows::core::BOOL;

fn eligible(hwnd: HWND) -> bool {
    // SAFETY: read-only window queries.
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || GetAncestor(hwnd, GA_ROOT) != hwnd {
            return false;
        }
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        style & WS_CAPTION.0 == WS_CAPTION.0 && ex & (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) == 0
    }
}

fn dress(hwnd: HWND) {
    if eligible(hwnd) {
        let _ = apply(hwnd.0 as isize, &Chrome::default());
    }
}

unsafe extern "system" fn on_window(hwnd: HWND, _: LPARAM) -> BOOL {
    dress(hwnd);
    BOOL(1)
}

unsafe extern "system" fn on_show(_: HWINEVENTHOOK, _: u32, hwnd: HWND, object: i32, child: i32, _: u32, _: u32) {
    if object == OBJID_WINDOW.0 && child == 0 {
        dress(hwnd);
    }
}

pub fn run() -> std::process::ExitCode {
    // SAFETY: enumerate current windows, then hook future shows; the hook runs on this thread's
    // message loop (out of context), so no DLL is injected anywhere.
    unsafe {
        let _ = EnumWindows(Some(on_window), LPARAM(0));
        let hook = SetWinEventHook(
            EVENT_OBJECT_SHOW,
            EVENT_OBJECT_SHOW,
            None,
            Some(on_show),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );
        if hook.is_invalid() {
            eprintln!("SetWinEventHook failed");
            return std::process::ExitCode::FAILURE;
        }
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        let _ = UnhookWinEvent(hook);
    }
    std::process::ExitCode::SUCCESS
}
