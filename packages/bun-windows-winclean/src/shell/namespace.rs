// SPDX-License-Identifier: Apache-2.0
//! The Windows Shell namespace, in-process, exactly as Explorer uses it: known folders
//! (`IKnownFolderManager`), drives, file operations with undo/Recycle Bin (`IFileOperation`), the
//! Recycle Bin folder itself, context-menu verbs including third-party shell extensions
//! (`IContextMenu`), the property system (`IPropertyStore`) and Properties dialog
//! (`SHObjectProperties`), thumbnails through the registered `IThumbnailProvider`s
//! (`IShellItemImageFactory`), "Open with" handlers (`SHAssocEnumHandlers` / `IAssocHandler`) and
//! defaults (`IApplicationAssociationRegistration`), and "show in Explorer"
//! (`SHOpenFolderAndSelectItems`). This is what COSMIC Files, `nu_plugin_windows` and the `win`
//! CLI call so they see and drive the same namespace Explorer does.

use std::{ffi::c_void, io, time::{Duration, Instant}};

use base64::Engine as _;
use serde_json::{Map, Value, json};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, PROPERTYKEY, SIZE},
        Graphics::Gdi::{
            BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, DeleteObject, GetDC,
            GetDIBits, GetObjectW, HGDIOBJ, ReleaseDC,
        },
        Storage::FileSystem::{
            GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDriveStringsW, GetVolumeInformationW,
        },
        System::{
            Com::{
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoTaskMemFree,
                IDataObject, StructuredStorage::PropVariantToStringAlloc,
            },
            Threading::GetCurrentProcessId,
        },
        UI::{
            Shell::{
                ASSOC_FILTER_NONE, ASSOC_FILTER_RECOMMENDED, AL_EFFECTIVE, AT_FILEEXTENSION,
                AT_URLPROTOCOL, ApplicationAssociationRegistration, BHID_DataObject,
                BHID_EnumItems, BHID_SFUIObject, CMF_EXTENDEDVERBS, CMF_NORMAL,
                CMINVOKECOMMANDINFO, CMINVOKECOMMANDINFOEX, Common::ITEMIDLIST,
                FILEOPERATION_FLAGS, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOCONFIRMMKDIR,
                FOF_NOERRORUI, FOF_SILENT, FOFX_RECYCLEONDELETE, FOLDERID_RecycleBinFolder,
                FileOperation, GCS_VERBW, IApplicationAssociationRegistration, IAssocHandler,
                IContextMenu, IEnumAssocHandlers, IEnumShellItems, IFileOperation, IKnownFolderManager,
                IShellItem, IShellItem2, IShellItemImageFactory, ILFree, KF_CATEGORY_COMMON,
                KF_CATEGORY_FIXED, KF_CATEGORY_PERUSER, KF_CATEGORY_VIRTUAL, KF_FLAG_DEFAULT,
                KNOWNFOLDER_DEFINITION, KnownFolderManager, PropertiesSystem::{GPS_DEFAULT, IPropertyStore, PSGetNameFromPropertyKey},
                SHAssocEnumHandlers, SHCreateItemFromParsingName, SHEmptyRecycleBinW,
                SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND, SHGetKnownFolderItem,
                SHObjectProperties, SHOP_FILEPATH, SHOpenFolderAndSelectItems, SHParseDisplayName,
                SIGDN, SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_FILESYSPATH, SIGDN_NORMALDISPLAY,
                SIIGBF_RESIZETOFIT,
            },
            WindowsAndMessaging::{
                CreatePopupMenu, DestroyMenu, DispatchMessageW, EnumWindows, GetMenuItemCount,
                GetMenuItemInfoW, GetWindowThreadProcessId, HMENU, IsWindowVisible, MENUITEMINFOW,
                MFS_DISABLED, MFT_SEPARATOR, MIIM_FTYPE, MIIM_ID, MIIM_STATE, MIIM_STRING,
                MIIM_SUBMENU, MSG, PM_REMOVE, PeekMessageW, SW_SHOWNORMAL, TranslateMessage,
            },
        },
    },
    core::{BOOL, GUID, PCSTR, PCWSTR, PSTR, PWSTR},
};

use crate::win32::{ComScope, hresult_error, pcwstr, wide};

/// `CMIC_MASK_UNICODE` / `CMIC_MASK_FLAG_NO_UI` / `CMIC_MASK_ASYNCOK` (`shobjidl_core.h`).
const CMIC_MASK_UNICODE: u32 = 0x0000_4000;
const CMIC_MASK_FLAG_NO_UI: u32 = 0x0000_0400;
const CMD_FIRST: u32 = 1;
const CMD_LAST: u32 = 0x7FFF;

/// `PKEY_Recycle_DeletedFrom` / `PKEY_Recycle_DateDeleted` (`{9B174B33-40FF-11D2-A27E-00C04FC30871}`, 2/3).
const PSGUID_DISPLACED: GUID = GUID::from_u128(0x9b174b33_40ff_11d2_a27e_00c04fc30871);
const PKEY_DELETED_FROM: PROPERTYKEY = PROPERTYKEY { fmtid: PSGUID_DISPLACED, pid: 2 };
const PKEY_DATE_DELETED: PROPERTYKEY = PROPERTYKEY { fmtid: PSGUID_DISPLACED, pid: 3 };

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

/// Take ownership of a CoTaskMem wide string.
fn take(text: PWSTR) -> String {
    if text.is_null() {
        return String::new();
    }
    // SAFETY: a NUL-terminated CoTaskMem string we now own.
    let out = unsafe { text.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(text.0 as *const c_void)) };
    out
}

fn item(path: &str) -> io::Result<IShellItem> {
    let wide_path = wide(path);
    // SAFETY: parses a filesystem path or any shell parsing name (`::{CLSID}`, `shell:` ...).
    unsafe { SHCreateItemFromParsingName(pcwstr(&wide_path), None) }
        .map_err(|e| hresult_error(&e, &format!("open shell item {path}")))
}

fn name(item: &IShellItem, kind: SIGDN) -> Option<String> {
    // SAFETY: returns a CoTaskMem string.
    unsafe { item.GetDisplayName(kind) }.ok().map(take)
}

fn item_json(item: &IShellItem) -> Value {
    json!({
        "name": name(item, SIGDN_NORMALDISPLAY),
        "path": name(item, SIGDN_FILESYSPATH),
        "parsingName": name(item, SIGDN_DESKTOPABSOLUTEPARSING),
    })
}

fn strings(args: &Value, key: &str) -> Vec<String> {
    match args.get(key) {
        Some(Value::String(one)) => vec![one.clone()],
        Some(Value::Array(many)) => many.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect(),
        _ => Vec::new(),
    }
}

fn first_path(args: &Value) -> io::Result<String> {
    strings(args, "path")
        .into_iter()
        .next()
        .ok_or_else(|| invalid("path is required"))
}

/// Pump this thread's messages while the process shows a visible top-level window (dialogs
/// opened in-process by verbs or `SHObjectProperties`), up to `limit`.
fn pump_while_windows(limit: Duration) {
    unsafe extern "system" fn visible(hwnd: HWND, found: LPARAM) -> BOOL {
        let mut pid = 0u32;
        // SAFETY: plain window queries on a handle provided by EnumWindows.
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == GetCurrentProcessId() && IsWindowVisible(hwnd).as_bool() {
                *(found.0 as *mut bool) = true;
                return BOOL(0);
            }
        }
        BOOL(1)
    }
    let start = Instant::now();
    let grace = Duration::from_millis(1500);
    loop {
        let mut message = MSG::default();
        // SAFETY: standard non-blocking message pump for this thread.
        unsafe {
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        let mut found = false;
        // SAFETY: the callback only writes through `found`, alive for the call.
        let _ = unsafe { EnumWindows(Some(visible), LPARAM(&raw mut found as isize)) };
        let elapsed = start.elapsed();
        if (!found && elapsed > grace) || elapsed > limit {
            break;
        }
        std::thread::sleep(Duration::from_millis(30));
    }
}

// ---------------------------------------------------------------- known folders and drives

/// `shell_known_folders`: every registered known folder with its id, canonical name, category,
/// current path (null for virtual folders) and parsing name.
pub fn known_folders() -> io::Result<Value> {
    let _com = ComScope::enter(COINIT_APARTMENTTHREADED)?;
    // SAFETY: in-process known-folder manager.
    let manager: IKnownFolderManager = unsafe { CoCreateInstance(&KnownFolderManager, None, CLSCTX_INPROC_SERVER) }
        .map_err(|e| hresult_error(&e, "create KnownFolderManager"))?;
    let mut ids: *mut GUID = std::ptr::null_mut();
    let mut count = 0u32;
    // SAFETY: returns a CoTaskMem array of `count` GUIDs.
    unsafe { manager.GetFolderIds(&mut ids, &mut count) }.map_err(|e| hresult_error(&e, "GetFolderIds"))?;
    // SAFETY: `ids` holds `count` GUIDs until freed below.
    let guids: Vec<GUID> = unsafe { std::slice::from_raw_parts(ids, count as usize) }.to_vec();
    unsafe { CoTaskMemFree(Some(ids as *const c_void)) };
    let mut folders = Vec::with_capacity(guids.len());
    for id in guids {
        // SAFETY: per-folder lookups; failures skip the folder.
        let Ok(folder) = (unsafe { manager.GetFolder(&id) }) else { continue };
        let mut definition = KNOWNFOLDER_DEFINITION::default();
        if unsafe { folder.GetFolderDefinition(&mut definition) }.is_err() {
            continue;
        }
        let path = unsafe { folder.GetPath(0) }.ok().map(take);
        let category = match definition.category {
            KF_CATEGORY_VIRTUAL => "virtual",
            KF_CATEGORY_FIXED => "fixed",
            KF_CATEGORY_COMMON => "common",
            KF_CATEGORY_PERUSER => "peruser",
            _ => "unknown",
        };
        folders.push(json!({
            "id": format!("{{{id:?}}}"),
            "name": take(definition.pszName),
            "category": category,
            "path": path,
            "parsingName": take(definition.pszParsingName),
            "relativePath": take(definition.pszRelativePath),
            "localizedName": take(definition.pszLocalizedName),
        }));
        // The remaining definition strings are freed here (FreeKnownFolderDefinitionFields is inline).
        for text in [definition.pszDescription, definition.pszTooltip, definition.pszIcon, definition.pszSecurity] {
            let _ = take(text);
        }
    }
    folders.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(json!({ "count": folders.len(), "folders": folders }))
}

/// `shell_drives`: logical drives with type, label, filesystem and capacity.
pub fn drives() -> io::Result<Value> {
    let mut buffer = vec![0u16; 512];
    // SAFETY: fills NUL-separated root paths.
    let length = unsafe { GetLogicalDriveStringsW(Some(&mut buffer)) } as usize;
    let mut out = Vec::new();
    for root in String::from_utf16_lossy(&buffer[..length.min(buffer.len())]).split('\0').filter(|s| !s.is_empty()) {
        let wide_root = wide(root);
        // SAFETY: plain volume queries on a root path.
        let kind = match unsafe { GetDriveTypeW(pcwstr(&wide_root)) } {
            2 => "removable",
            3 => "fixed",
            4 => "network",
            5 => "cdrom",
            6 => "ramdisk",
            _ => "unknown",
        };
        let mut label = vec![0u16; 261];
        let mut fs = vec![0u16; 261];
        let mut serial = 0u32;
        let has_volume = unsafe {
            GetVolumeInformationW(pcwstr(&wide_root), Some(&mut label), Some(&mut serial), None, None, Some(&mut fs))
        }
        .is_ok();
        let (mut free, mut total) = (0u64, 0u64);
        let has_space = unsafe { GetDiskFreeSpaceExW(pcwstr(&wide_root), Some(&mut free), Some(&mut total), None) }.is_ok();
        out.push(json!({
            "root": root,
            "type": kind,
            "label": has_volume.then(|| crate::win32::from_wide(&label)),
            "filesystem": has_volume.then(|| crate::win32::from_wide(&fs)),
            "serial": has_volume.then(|| format!("{serial:08X}")),
            "freeBytes": has_space.then_some(free),
            "totalBytes": has_space.then_some(total),
        }));
    }
    Ok(json!({ "count": out.len(), "drives": out }))
}

// ---------------------------------------------------------------- IFileOperation

/// `shell_file_operation`: copy | move | rename | delete | recycle | newFolder through
/// `IFileOperation` (Explorer's engine: undo history, Recycle Bin, shell-extension copy hooks,
/// conflict UI when `ui` is true).
pub fn file_operation(args: &Value) -> io::Result<Value> {
    let _com = ComScope::enter(COINIT_APARTMENTTHREADED)?;
    let op = args.get("op").and_then(Value::as_str).ok_or_else(|| invalid("op is required"))?;
    let items = strings(args, "items");
    let ui = args.get("ui").and_then(Value::as_bool).unwrap_or(false);
    // SAFETY: in-process file operation object.
    let operation: IFileOperation = unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER) }
        .map_err(|e| hresult_error(&e, "create FileOperation"))?;
    let mut flags = FOF_ALLOWUNDO.0 as u32 | FOF_NOCONFIRMMKDIR.0 as u32;
    if !ui {
        flags |= FOF_NOCONFIRMATION.0 as u32 | FOF_SILENT.0 as u32 | FOF_NOERRORUI.0 as u32;
    }
    match op {
        "recycle" => flags |= FOFX_RECYCLEONDELETE.0 as u32,
        "delete" => flags &= !(FOF_ALLOWUNDO.0 as u32),
        _ => {}
    }
    // SAFETY: configures the pending operation.
    unsafe { operation.SetOperationFlags(FILEOPERATION_FLAGS(flags)) }.map_err(|e| hresult_error(&e, "SetOperationFlags"))?;
    let destination = || -> io::Result<IShellItem> {
        item(args.get("destination").and_then(Value::as_str).ok_or_else(|| invalid("destination is required"))?)
    };
    let new_name = args.get("newName").and_then(Value::as_str).map(wide);
    let new_name_ptr = new_name.as_ref().map_or(PCWSTR::null(), |n| pcwstr(n));
    // SAFETY: queues operations on parsed shell items; nothing runs until PerformOperations.
    unsafe {
        match op {
            "copy" | "move" => {
                let target = destination()?;
                for source in &items {
                    let source = item(source)?;
                    if op == "copy" {
                        operation.CopyItem(&source, &target, new_name_ptr, None)
                    } else {
                        operation.MoveItem(&source, &target, new_name_ptr, None)
                    }
                    .map_err(|e| hresult_error(&e, op))?;
                }
            }
            "rename" => {
                if new_name.is_none() {
                    return Err(invalid("newName is required"));
                }
                let source = item(items.first().ok_or_else(|| invalid("items is required"))?)?;
                operation.RenameItem(&source, new_name_ptr, None).map_err(|e| hresult_error(&e, "rename"))?;
            }
            "delete" | "recycle" => {
                for source in &items {
                    operation.DeleteItem(&item(source)?, None).map_err(|e| hresult_error(&e, op))?;
                }
            }
            "newFolder" => {
                if new_name.is_none() {
                    return Err(invalid("newName is required"));
                }
                operation
                    .NewItem(&destination()?, 0x10, new_name_ptr, PCWSTR::null(), None)
                    .map_err(|e| hresult_error(&e, "new folder"))?;
            }
            other => return Err(invalid(format!("unknown op {other}"))),
        }
        operation.PerformOperations().map_err(|e| hresult_error(&e, "PerformOperations"))?;
        let aborted = operation.GetAnyOperationsAborted().map(|b| b.as_bool()).unwrap_or(false);
        Ok(json!({ "op": op, "items": items, "aborted": aborted }))
    }
}

// ---------------------------------------------------------------- Recycle Bin

fn recycle_items() -> io::Result<Vec<IShellItem>> {
    // SAFETY: the Recycle Bin virtual folder and its item enumerator.
    let bin: IShellItem = unsafe { SHGetKnownFolderItem(&FOLDERID_RecycleBinFolder, KF_FLAG_DEFAULT, None) }
        .map_err(|e| hresult_error(&e, "open the Recycle Bin"))?;
    let enumerator: IEnumShellItems = unsafe { bin.BindToHandler(None, &BHID_EnumItems) }
        .map_err(|e| hresult_error(&e, "enumerate the Recycle Bin"))?;
    let mut out = Vec::new();
    loop {
        let mut slot = [None];
        let mut fetched = 0u32;
        // SAFETY: one slot per call; S_FALSE with 0 fetched ends the enumeration.
        let _ = unsafe { enumerator.Next(&mut slot, Some(&mut fetched)) };
        let [entry] = slot;
        match entry {
            Some(entry) if fetched == 1 => out.push(entry),
            _ => break,
        }
    }
    Ok(out)
}

fn item_string(item: &IShellItem, key: &PROPERTYKEY) -> Option<String> {
    let item2: IShellItem2 = windows::core::Interface::cast(item).ok()?;
    // SAFETY: CoTaskMem string out.
    unsafe { item2.GetString(key) }.ok().map(take)
}

/// `shell_recycle_bin`: list | restore | empty.
pub fn recycle_bin(args: &Value) -> io::Result<Value> {
    let _com = ComScope::enter(COINIT_APARTMENTTHREADED)?;
    let action = args.get("action").and_then(Value::as_str).unwrap_or("list");
    match action {
        "list" => {
            let items: Vec<Value> = recycle_items()?
                .iter()
                .map(|entry| {
                    let mut row = item_json(entry);
                    row["deletedFrom"] = item_string(entry, &PKEY_DELETED_FROM).into();
                    row["dateDeleted"] = item_string(entry, &PKEY_DATE_DELETED).into();
                    row
                })
                .collect();
            Ok(json!({ "count": items.len(), "items": items }))
        }
        "restore" => {
            let wanted = strings(args, "names");
            if wanted.is_empty() {
                return Err(invalid("names (display names, original paths or parsing names) is required"));
            }
            let mut restored = Vec::new();
            for entry in recycle_items()? {
                let display = name(&entry, SIGDN_NORMALDISPLAY).unwrap_or_default();
                let parsing = name(&entry, SIGDN_DESKTOPABSOLUTEPARSING).unwrap_or_default();
                // The bin's display name is the bare name, or the full original path when
                // Explorer is set to show full paths; only join the former.
                let absolute = display.contains(":\\") || display.starts_with("\\\\");
                let original = if absolute {
                    display.clone()
                } else {
                    item_string(&entry, &PKEY_DELETED_FROM)
                        .map(|dir| format!("{}\\{display}", dir.trim_end_matches('\\')))
                        .unwrap_or_default()
                };
                let hit = wanted.iter().any(|w| {
                    w.eq_ignore_ascii_case(&display) || w.eq_ignore_ascii_case(&parsing) || w.eq_ignore_ascii_case(&original)
                });
                if hit {
                    invoke_menu(&entry, Some("undelete"), None, false)?;
                    restored.push(json!({ "name": display, "restoredTo": original }));
                }
            }
            Ok(json!({ "restored": restored, "count": restored.len() }))
        }
        "empty" => {
            if args.get("confirm").and_then(Value::as_bool) != Some(true) {
                return Err(invalid("emptying the Recycle Bin is permanent: pass confirm=true"));
            }
            // SAFETY: empties every drive's Recycle Bin without UI.
            unsafe { SHEmptyRecycleBinW(None, PCWSTR::null(), SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND) }
                .or_else(|e| if e.code().0 as u32 == 0x8000_FFFF { Ok(()) } else { Err(e) })
                .map_err(|e| hresult_error(&e, "SHEmptyRecycleBin"))?;
            Ok(json!({ "emptied": true }))
        }
        other => Err(invalid(format!("unknown action {other}"))),
    }
}

// ---------------------------------------------------------------- context menus

fn context_menu(item: &IShellItem) -> io::Result<(IContextMenu, HMENU)> {
    // SAFETY: the item's IContextMenu (static verbs + every registered shell extension).
    let menu: IContextMenu = unsafe { item.BindToHandler(None, &BHID_SFUIObject) }
        .map_err(|e| hresult_error(&e, "get the context menu"))?;
    let hmenu = unsafe { CreatePopupMenu() }.map_err(|e| hresult_error(&e, "CreatePopupMenu"))?;
    // SAFETY: populates `hmenu` with command ids CMD_FIRST..=CMD_LAST.
    let hr = unsafe { menu.QueryContextMenu(hmenu, 0, CMD_FIRST, CMD_LAST, CMF_NORMAL | CMF_EXTENDEDVERBS) };
    if hr.is_err() {
        unsafe { let _ = DestroyMenu(hmenu); }
        return Err(hresult_error(&windows::core::Error::from(hr), "QueryContextMenu"));
    }
    Ok((menu, hmenu))
}

/// Canonical verb of a context-menu command id.
pub(crate) fn verb_name(menu: &IContextMenu, id: u32) -> Option<String> {
    verb_of(menu, id)
}

/// Keep dialogs opened in-process alive (see [`pump_while_windows`]).
pub(crate) fn pump_dialogs(limit: Duration) {
    pump_while_windows(limit);
}

fn verb_of(menu: &IContextMenu, id: u32) -> Option<String> {
    let mut buffer = [0u16; 256];
    // SAFETY: GCS_VERBW writes a wide string into `buffer` (passed as PSTR per the ABI).
    unsafe {
        menu.GetCommandString(
            (id - CMD_FIRST) as usize,
            GCS_VERBW,
            None,
            PSTR(buffer.as_mut_ptr().cast()),
            buffer.len() as u32,
        )
    }
    .ok()
    .map(|()| crate::win32::from_wide(&buffer))
    .filter(|v| !v.is_empty())
}

fn walk(menu: &IContextMenu, hmenu: HMENU, parent: &str, out: &mut Vec<Value>) {
    // SAFETY: read-only walk of a popup menu we own.
    let count = unsafe { GetMenuItemCount(Some(hmenu)) };
    for index in 0..count.max(0) {
        let mut text = [0u16; 512];
        let mut info = MENUITEMINFOW {
            cbSize: size_of::<MENUITEMINFOW>() as u32,
            fMask: MIIM_ID | MIIM_STRING | MIIM_SUBMENU | MIIM_FTYPE | MIIM_STATE,
            dwTypeData: PWSTR(text.as_mut_ptr()),
            cch: text.len() as u32,
            ..Default::default()
        };
        if unsafe { GetMenuItemInfoW(hmenu, index as u32, true, &mut info) }.is_err() {
            continue;
        }
        if info.fType.0 & MFT_SEPARATOR.0 != 0 {
            continue;
        }
        let label = crate::win32::from_wide(&text).replace('&', "");
        let full = if parent.is_empty() { label.clone() } else { format!("{parent} > {label}") };
        if !info.hSubMenu.is_invalid() {
            walk(menu, info.hSubMenu, &full, out);
            continue;
        }
        if info.wID < CMD_FIRST || info.wID > CMD_LAST {
            continue;
        }
        out.push(json!({
            "id": info.wID,
            "label": full,
            "verb": verb_of(menu, info.wID),
            "enabled": info.fState.0 & MFS_DISABLED.0 == 0,
        }));
    }
}

fn invoke_menu(target: &IShellItem, verb: Option<&str>, id: Option<u32>, wait: bool) -> io::Result<Value> {
    let (menu, hmenu) = context_menu(target)?;
    let verb_ansi = verb.map(|v| std::ffi::CString::new(v).unwrap_or_default());
    let verb_wide = verb.map(wide);
    let mut info = CMINVOKECOMMANDINFOEX {
        cbSize: size_of::<CMINVOKECOMMANDINFOEX>() as u32,
        fMask: CMIC_MASK_UNICODE | if wait { 0 } else { CMIC_MASK_FLAG_NO_UI },
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    match (&verb_ansi, &verb_wide, id) {
        (Some(ansi), Some(wide_verb), _) => {
            info.lpVerb = PCSTR(ansi.as_ptr().cast());
            info.lpVerbW = pcwstr(wide_verb);
        }
        (_, _, Some(id)) => {
            // MAKEINTRESOURCE(offset) in both slots.
            let offset = (id - CMD_FIRST) as usize;
            info.lpVerb = PCSTR(offset as *const u8);
            info.lpVerbW = PCWSTR(offset as *const u16);
        }
        _ => {
            unsafe { let _ = DestroyMenu(hmenu); }
            return Err(invalid("verb or id is required"));
        }
    }
    // SAFETY: the EX struct is a superset of CMINVOKECOMMANDINFO (cbSize tells the handler).
    let outcome = unsafe { menu.InvokeCommand((&raw const info).cast::<CMINVOKECOMMANDINFO>()) };
    if wait {
        pump_while_windows(Duration::from_secs(3600));
    }
    unsafe { let _ = DestroyMenu(hmenu); }
    outcome.map_err(|e| hresult_error(&e, "InvokeCommand"))?;
    Ok(json!({ "invoked": verb.map(str::to_owned).or_else(|| id.map(|i| i.to_string())) }))
}

/// `shell_context_menu`: list the verbs Explorer shows for an item (static, dynamic and
/// shell-extension entries, flattened with `Parent > Child` labels), or invoke one by verb or id.
pub fn context_menu_tool(args: &Value) -> io::Result<Value> {
    let _com = ComScope::enter(COINIT_APARTMENTTHREADED)?;
    let path = first_path(args)?;
    let target = item(&path)?;
    match args.get("action").and_then(Value::as_str).unwrap_or("list") {
        "list" => {
            let (menu, hmenu) = context_menu(&target)?;
            let mut verbs = Vec::new();
            walk(&menu, hmenu, "", &mut verbs);
            unsafe { let _ = DestroyMenu(hmenu); }
            Ok(json!({ "path": path, "count": verbs.len(), "verbs": verbs }))
        }
        "invoke" => invoke_menu(
            &target,
            args.get("verb").and_then(Value::as_str),
            args.get("id").and_then(Value::as_u64).map(|n| n as u32),
            args.get("wait").and_then(Value::as_bool).unwrap_or(true),
        ),
        "popup" => {
            drop(target);
            super::popup::show(
                &strings(args, "path"),
                args.get("x").and_then(Value::as_i64).map(|v| v as i32),
                args.get("y").and_then(Value::as_i64).map(|v| v as i32),
            )
        }
        other => Err(invalid(format!("unknown action {other}"))),
    }
}

// ---------------------------------------------------------------- properties

/// `shell_properties`: `read` returns every property-system value of the item keyed by canonical
/// name (`System.Size`, `System.Media.Duration`, ...); `dialog` opens Explorer's Properties sheet
/// and keeps it alive until it is closed.
pub fn properties(args: &Value) -> io::Result<Value> {
    let _com = ComScope::enter(COINIT_APARTMENTTHREADED)?;
    let path = first_path(args)?;
    match args.get("action").and_then(Value::as_str).unwrap_or("read") {
        "read" => {
            let target: IShellItem2 = windows::core::Interface::cast(&item(&path)?)
                .map_err(|e| hresult_error(&e, "IShellItem2"))?;
            // SAFETY: read-only property store of the item.
            let store: IPropertyStore = unsafe { target.GetPropertyStore(GPS_DEFAULT) }
                .map_err(|e| hresult_error(&e, "GetPropertyStore"))?;
            let count = unsafe { store.GetCount() }.map_err(|e| hresult_error(&e, "GetCount"))?;
            let mut map = Map::new();
            for index in 0..count {
                let mut key = PROPERTYKEY::default();
                if unsafe { store.GetAt(index, &mut key) }.is_err() {
                    continue;
                }
                let Ok(value) = (unsafe { store.GetValue(&key) }) else { continue };
                let text = unsafe { PropVariantToStringAlloc(&value) }.ok().map(take);
                let label = unsafe { PSGetNameFromPropertyKey(&key) }
                    .ok()
                    .map(take)
                    .unwrap_or_else(|| format!("{{{:?}}} {}", key.fmtid, key.pid));
                if let Some(text) = text.filter(|t| !t.is_empty()) {
                    map.insert(label, Value::String(text));
                }
            }
            Ok(json!({ "path": path, "properties": map }))
        }
        "dialog" => {
            let wide_path = wide(&path);
            // SAFETY: opens the Properties sheet in this process.
            let shown = unsafe { SHObjectProperties(None, SHOP_FILEPATH, pcwstr(&wide_path), PCWSTR::null()) };
            if !shown.as_bool() {
                return Err(io::Error::other(format!("SHObjectProperties failed for {path}")));
            }
            pump_while_windows(Duration::from_secs(3600));
            Ok(json!({ "path": path, "closed": true }))
        }
        other => Err(invalid(format!("unknown action {other}"))),
    }
}

// ---------------------------------------------------------------- thumbnails

/// `shell_thumbnail`: the thumbnail Explorer would draw (registered `IThumbnailProvider`, else the
/// icon) as PNG, written to `output` or returned base64.
pub fn thumbnail(args: &Value) -> io::Result<Value> {
    let _com = ComScope::enter(COINIT_APARTMENTTHREADED)?;
    let path = first_path(args)?;
    let size = args.get("size").and_then(Value::as_u64).unwrap_or(256).clamp(16, 2560) as i32;
    let factory: IShellItemImageFactory = windows::core::Interface::cast(&item(&path)?)
        .map_err(|e| hresult_error(&e, "IShellItemImageFactory"))?;
    // SAFETY: returns an HBITMAP we own and delete below.
    let bitmap = unsafe { factory.GetImage(SIZE { cx: size, cy: size }, SIIGBF_RESIZETOFIT) }
        .map_err(|e| hresult_error(&e, "GetImage"))?;
    let result = (|| {
        let mut header = BITMAP::default();
        // SAFETY: reads the bitmap header.
        if unsafe { GetObjectW(HGDIOBJ(bitmap.0), size_of::<BITMAP>() as i32, Some((&raw mut header).cast())) } == 0 {
            return Err(io::Error::other("GetObject failed"));
        }
        let (width, height) = (header.bmWidth, header.bmHeight);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        // SAFETY: copies the bitmap as top-down 32-bit BGRA into `pixels`.
        let lines = unsafe {
            let dc = GetDC(None);
            let lines = GetDIBits(dc, bitmap, 0, height as u32, Some(pixels.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
            ReleaseDC(None, dc);
            lines
        };
        if lines == 0 {
            return Err(io::Error::other("GetDIBits failed"));
        }
        let opaque = pixels.chunks_exact(4).all(|px| px[3] == 0);
        for px in pixels.chunks_exact_mut(4) {
            px.swap(0, 2);
            if opaque {
                px[3] = 255;
            }
        }
        let image = image::RgbaImage::from_raw(width as u32, height as u32, pixels)
            .ok_or_else(|| io::Error::other("bitmap size mismatch"))?;
        let mut png = Vec::new();
        image
            .write_to(&mut io::Cursor::new(&mut png), image::ImageFormat::Png)
            .map_err(io::Error::other)?;
        Ok((width, height, png))
    })();
    // SAFETY: we own the HBITMAP.
    unsafe { let _ = DeleteObject(HGDIOBJ(bitmap.0)); }
    let (width, height, png) = result?;
    match args.get("output").and_then(Value::as_str) {
        Some(output) => {
            std::fs::write(output, &png)?;
            Ok(json!({ "path": path, "width": width, "height": height, "output": output, "bytes": png.len() }))
        }
        None => Ok(json!({
            "path": path, "width": width, "height": height, "mimeType": "image/png",
            "dataBase64": base64::engine::general_purpose::STANDARD.encode(png),
        })),
    }
}

// ---------------------------------------------------------------- open with / defaults

fn extension_of(args: &Value) -> io::Result<String> {
    if let Some(ext) = args.get("extension").and_then(Value::as_str) {
        return Ok(if ext.starts_with('.') || ext.contains(':') || !ext.contains('.') && ext.len() > 5 { ext.to_owned() } else { format!(".{ext}") });
    }
    let path = first_path(args)?;
    std::path::Path::new(&path)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .ok_or_else(|| invalid(format!("{path} has no extension")))
}

fn handlers(extension: &str, recommended_only: bool) -> io::Result<Vec<IAssocHandler>> {
    let wide_ext = wide(extension);
    let filter = if recommended_only { ASSOC_FILTER_RECOMMENDED } else { ASSOC_FILTER_NONE };
    // SAFETY: the "Open with" handler enumeration Explorer uses.
    let enumerator: IEnumAssocHandlers = unsafe { SHAssocEnumHandlers(pcwstr(&wide_ext), filter) }
        .map_err(|e| hresult_error(&e, "SHAssocEnumHandlers"))?;
    let mut out = Vec::new();
    loop {
        let mut slot = [None];
        let mut fetched = 0u32;
        let _ = unsafe { enumerator.Next(&mut slot, Some(&mut fetched)) };
        let [handler] = slot;
        match handler {
            Some(handler) if fetched == 1 => out.push(handler),
            _ => break,
        }
    }
    Ok(out)
}

fn current_default(query: &str) -> Option<String> {
    // SAFETY: in-process association registration object.
    let registration: IApplicationAssociationRegistration =
        unsafe { CoCreateInstance(&ApplicationAssociationRegistration, None, CLSCTX_INPROC_SERVER) }.ok()?;
    let kind = if query.starts_with('.') { AT_FILEEXTENSION } else { AT_URLPROTOCOL };
    let wide_query = wide(query.trim_end_matches(':'));
    unsafe { registration.QueryCurrentDefault(pcwstr(&wide_query), kind, AL_EFFECTIVE) }.ok().map(take)
}

/// `shell_open_with`: list the "Open with" handlers (and current default ProgID) for an extension
/// or path, or open a path with a chosen handler (matched by name, executable path or UI name).
pub fn open_with(args: &Value) -> io::Result<Value> {
    let _com = ComScope::enter(COINIT_APARTMENTTHREADED)?;
    let extension = extension_of(args)?;
    match args.get("action").and_then(Value::as_str).unwrap_or("list") {
        "list" => {
            let recommended_only = args.get("recommended").and_then(Value::as_bool).unwrap_or(false);
            let list: Vec<Value> = handlers(&extension, recommended_only)?
                .iter()
                .map(|handler| unsafe {
                    let mut icon = PWSTR::null();
                    let mut index = 0;
                    let icon = handler.GetIconLocation(&mut icon, &mut index).ok().map(|()| format!("{},{index}", take(icon)));
                    json!({
                        "name": handler.GetName().ok().map(take),
                        "uiName": handler.GetUIName().ok().map(take),
                        "recommended": handler.IsRecommended().0 == 0,
                        "icon": icon,
                    })
                })
                .collect();
            Ok(json!({ "extension": extension, "default": current_default(&extension), "count": list.len(), "handlers": list }))
        }
        "invoke" => {
            let path = first_path(args)?;
            let wanted = args.get("handler").and_then(Value::as_str).ok_or_else(|| invalid("handler is required"))?;
            let handler = handlers(&extension, false)?
                .into_iter()
                .find(|h| unsafe {
                    let names = [h.GetName().ok().map(take), h.GetUIName().ok().map(take)];
                    names.iter().flatten().any(|n| n.eq_ignore_ascii_case(wanted) || n.to_ascii_lowercase().ends_with(&format!("\\{}", wanted.to_ascii_lowercase())))
                })
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("no handler `{wanted}` for {extension}")))?;
            // SAFETY: the item's data object handed to the handler, as Explorer's "Open with" does.
            let data: IDataObject = unsafe { item(&path)?.BindToHandler(None, &BHID_DataObject) }
                .map_err(|e| hresult_error(&e, "BHID_DataObject"))?;
            unsafe { handler.Invoke(&data) }.map_err(|e| hresult_error(&e, "IAssocHandler::Invoke"))?;
            Ok(json!({ "path": path, "handler": wanted }))
        }
        "default" => Ok(json!({ "query": extension, "default": current_default(&extension) })),
        other => Err(invalid(format!("unknown action {other}"))),
    }
}

// ---------------------------------------------------------------- reveal in Explorer

/// `shell_reveal`: open an Explorer window on the item's folder with the item(s) selected.
pub fn reveal(args: &Value) -> io::Result<Value> {
    let _com = ComScope::enter(COINIT_APARTMENTTHREADED)?;
    let path = first_path(args)?;
    let wide_path = wide(&path);
    let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
    // SAFETY: parse to an absolute PIDL, select it in its parent folder, free the PIDL.
    unsafe {
        SHParseDisplayName(pcwstr(&wide_path), None, &mut pidl, 0, None)
            .map_err(|e| hresult_error(&e, &format!("parse {path}")))?;
        let result = SHOpenFolderAndSelectItems(pidl, None, 0);
        ILFree(Some(pidl));
        result.map_err(|e| hresult_error(&e, "SHOpenFolderAndSelectItems"))?;
    }
    Ok(json!({ "revealed": path }))
}
