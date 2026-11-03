// SPDX-License-Identifier: Apache-2.0
//! Explorer's own context menu as a popup (`shell_context_menu` action `popup`): one or more
//! items through `IShellItemArray` -> `IContextMenu`, shown with `TrackPopupMenuEx` on a hidden
//! owner window that forwards owner-draw and dynamic-submenu messages ("Send to", "Open with",
//! "New") to `IContextMenu3`/`IContextMenu2`, exactly as Explorer does. The chosen command runs
//! in-process and dialogs it opens (Properties, Open with) stay alive until closed.

use std::{cell::RefCell, io, time::Duration};

use serde_json::{Value, json};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
        System::Com::COINIT_APARTMENTTHREADED,
        UI::{
            Shell::{
                BHID_SFUIObject, CMF_EXTENDEDVERBS, CMF_NORMAL, CMINVOKECOMMANDINFO,
                CMINVOKECOMMANDINFOEX, Common::ITEMIDLIST, IContextMenu, IContextMenu2,
                IContextMenu3, ILFree, IShellItemArray, SHCreateShellItemArrayFromIDLists,
                SHParseDisplayName,
            },
            WindowsAndMessaging::{
                CallWindowProcW, CreatePopupMenu, CreateWindowExW, DestroyMenu, DestroyWindow,
                GWLP_WNDPROC, GetCursorPos, PostMessageW, SW_SHOWNORMAL, SetForegroundWindow,
                SetWindowLongPtrW, TPM_RETURNCMD, TPM_RIGHTBUTTON, TrackPopupMenuEx, WM_DRAWITEM,
                WM_INITMENUPOPUP, WM_MEASUREITEM, WM_MENUCHAR, WM_NULL, WNDPROC, WS_EX_TOOLWINDOW,
                WS_POPUP,
            },
        },
    },
    core::{Interface, PCSTR, PCWSTR, w},
};

use crate::win32::{ComScope, hresult_error, pcwstr, wide};

const CMD_FIRST: u32 = 1;
const CMD_LAST: u32 = 0x7FFF;
const CMIC_MASK_UNICODE: u32 = 0x0000_4000;
const CMIC_MASK_PTINVOKE: u32 = 0x2000_0000;

thread_local! {
    static ACTIVE: RefCell<Option<(IContextMenu, WNDPROC)>> = const { RefCell::new(None) };
}

unsafe extern "system" fn forward(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    ACTIVE.with(|active| {
        let active = active.borrow();
        let Some((menu, previous)) = active.as_ref() else {
            return LRESULT(0);
        };
        if matches!(msg, WM_INITMENUPOPUP | WM_DRAWITEM | WM_MEASUREITEM | WM_MENUCHAR) {
            if let Ok(menu3) = menu.cast::<IContextMenu3>() {
                let mut result = LRESULT(0);
                // SAFETY: documented IContextMenu3 message forwarding.
                if unsafe { menu3.HandleMenuMsg2(msg, wparam, lparam, Some(&mut result)) }.is_ok() {
                    return result;
                }
            } else if let Ok(menu2) = menu.cast::<IContextMenu2>() {
                // SAFETY: documented IContextMenu2 message forwarding.
                if unsafe { menu2.HandleMenuMsg(msg, wparam, lparam) }.is_ok() {
                    return LRESULT(0);
                }
            }
        }
        // SAFETY: chain to the STATIC class's original procedure.
        unsafe { CallWindowProcW(*previous, hwnd, msg, wparam, lparam) }
    })
}

fn menu_for(paths: &[String]) -> io::Result<IContextMenu> {
    let mut pidls: Vec<*mut ITEMIDLIST> = Vec::with_capacity(paths.len());
    let result = (|| {
        for path in paths {
            let wide_path = wide(path);
            let mut pidl = std::ptr::null_mut();
            // SAFETY: one absolute PIDL per path, freed below.
            unsafe { SHParseDisplayName(pcwstr(&wide_path), None, &mut pidl, 0, None) }
                .map_err(|e| hresult_error(&e, &format!("parse {path}")))?;
            pidls.push(pidl);
        }
        let refs: Vec<*const ITEMIDLIST> = pidls.iter().map(|p| p.cast_const()).collect();
        // SAFETY: the multi-selection item array Explorer builds its menu from.
        let array: IShellItemArray = unsafe { SHCreateShellItemArrayFromIDLists(&refs) }
            .map_err(|e| hresult_error(&e, "SHCreateShellItemArrayFromIDLists"))?;
        unsafe { array.BindToHandler(None, &BHID_SFUIObject) }.map_err(|e| hresult_error(&e, "context menu"))
    })();
    for pidl in pidls {
        // SAFETY: each PIDL came from SHParseDisplayName.
        unsafe { ILFree(Some(pidl)) };
    }
    result
}

/// Show the menu for `paths` at `(x, y)` (screen coordinates; `None` = cursor) and run the chosen
/// command. Returns the chosen id and canonical verb, or `chosen: null` when dismissed.
pub fn show(paths: &[String], x: Option<i32>, y: Option<i32>) -> io::Result<Value> {
    if paths.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "path is required"));
    }
    let _com = ComScope::enter(COINIT_APARTMENTTHREADED)?;
    let menu = menu_for(paths)?;
    let mut cursor = POINT::default();
    // SAFETY: cursor position as the default anchor.
    let _ = unsafe { GetCursorPos(&mut cursor) };
    let (x, y) = (x.unwrap_or(cursor.x), y.unwrap_or(cursor.y));
    // SAFETY: a hidden tool window owns the popup and receives the handler's messages.
    let owner = unsafe {
        CreateWindowExW(WS_EX_TOOLWINDOW, w!("STATIC"), PCWSTR::null(), WS_POPUP, x, y, 1, 1, None, None, None, None)
    }
    .map_err(|e| hresult_error(&e, "CreateWindowEx"))?;
    // SAFETY: subclass the owner; the previous procedure is restored implicitly by DestroyWindow.
    let previous: WNDPROC = unsafe {
        std::mem::transmute::<isize, WNDPROC>(SetWindowLongPtrW(owner, GWLP_WNDPROC, forward as *const () as isize))
    };
    ACTIVE.with(|active| *active.borrow_mut() = Some((menu.clone(), previous)));
    let outcome = (|| {
        let hmenu = unsafe { CreatePopupMenu() }.map_err(|e| hresult_error(&e, "CreatePopupMenu"))?;
        // SAFETY: fills the popup with command ids CMD_FIRST..=CMD_LAST.
        let hr = unsafe { menu.QueryContextMenu(hmenu, 0, CMD_FIRST, CMD_LAST, CMF_NORMAL | CMF_EXTENDEDVERBS) };
        if hr.is_err() {
            unsafe {
                let _ = DestroyMenu(hmenu);
            }
            return Err(hresult_error(&windows::core::Error::from(hr), "QueryContextMenu"));
        }
        // SAFETY: modal popup; TPM_RETURNCMD returns the chosen id (0 = dismissed). The WM_NULL
        // post is the documented fix for menus that do not close on the first click elsewhere.
        let chosen = unsafe {
            let _ = SetForegroundWindow(owner);
            let id = TrackPopupMenuEx(hmenu, (TPM_RETURNCMD | TPM_RIGHTBUTTON).0, x, y, owner, None).0 as u32;
            let _ = PostMessageW(Some(owner), WM_NULL, WPARAM(0), LPARAM(0));
            id
        };
        let result = if chosen >= CMD_FIRST {
            let offset = (chosen - CMD_FIRST) as usize;
            let verb = super::namespace::verb_name(&menu, chosen);
            let info = CMINVOKECOMMANDINFOEX {
                cbSize: size_of::<CMINVOKECOMMANDINFOEX>() as u32,
                fMask: CMIC_MASK_UNICODE | CMIC_MASK_PTINVOKE,
                hwnd: owner,
                lpVerb: PCSTR(offset as *const u8),
                lpVerbW: PCWSTR(offset as *const u16),
                nShow: SW_SHOWNORMAL.0,
                ptInvoke: POINT { x, y },
                ..Default::default()
            };
            // SAFETY: the EX struct extends CMINVOKECOMMANDINFO (cbSize tells the handler).
            let invoked = unsafe { menu.InvokeCommand((&raw const info).cast::<CMINVOKECOMMANDINFO>()) };
            if invoked.is_ok() {
                super::namespace::pump_dialogs(Duration::from_secs(3600));
            }
            invoked.map_err(|e| hresult_error(&e, "InvokeCommand"))?;
            json!({ "chosen": chosen, "verb": verb })
        } else {
            json!({ "chosen": null })
        };
        unsafe {
            let _ = DestroyMenu(hmenu);
        }
        Ok(result)
    })();
    ACTIVE.with(|active| *active.borrow_mut() = None);
    unsafe {
        let _ = DestroyWindow(owner);
    }
    outcome.map(|mut value| {
        value["paths"] = json!(paths);
        value
    })
}
