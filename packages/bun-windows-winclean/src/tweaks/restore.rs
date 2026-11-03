// SPDX-License-Identifier: Apache-2.0
//! Safety net before a live apply: a System Restore point (`SRSetRestorePointW`) and a `.reg` export of every
//! registry key the plan touches (`reg.exe export`, re-importable with `reg import`).

use std::{io, path::Path};

use aphrody_proc::NoWindow as _;
use windows::Win32::System::Restore::{
    APPLICATION_INSTALL, BEGIN_SYSTEM_CHANGE, END_SYSTEM_CHANGE, RESTOREPOINTINFOW, SRSetRestorePointW, STATEMGRSTATUS,
};

use super::RegHive;

/// Create a restore point named `description`; returns its sequence number. Needs elevation and System
/// Protection on the system drive. Windows skips creation when another point was made in the last 24 hours
/// (the call still succeeds); the caller records the sequence number either way.
pub fn create_restore_point(description: &str) -> io::Result<i64> {
    let mut desc = [0u16; 256];
    for (dst, src) in desc.iter_mut().zip(description.encode_utf16().take(255)) {
        *dst = src;
    }
    let info = RESTOREPOINTINFOW {
        dwEventType: BEGIN_SYSTEM_CHANGE,
        dwRestorePtType: APPLICATION_INSTALL,
        szDescription: desc,
        ..Default::default()
    };
    let mut status = STATEMGRSTATUS::default();
    // SAFETY: both structs are fully initialised and outlive the call.
    if !unsafe { SRSetRestorePointW(&info, &mut status) }.as_bool() {
        return Err(io::Error::from_raw_os_error(status.nStatus.0 as i32));
    }
    let end = RESTOREPOINTINFOW { dwEventType: END_SYSTEM_CHANGE, llSequenceNumber: status.llSequenceNumber, ..info };
    let mut end_status = STATEMGRSTATUS::default();
    // SAFETY: as above.
    let _ = unsafe { SRSetRestorePointW(&end, &mut end_status) };
    Ok(status.llSequenceNumber)
}

/// Export `hive\key` to `dir/<n>.reg`; returns `None` when the key does not exist yet (nothing to back up).
pub fn export_key(h: RegHive, key: &str, dir: &Path, n: usize) -> io::Result<Option<String>> {
    std::fs::create_dir_all(dir)?;
    let root = match h {
        RegHive::Machine => "HKLM",
        RegHive::User => "HKCU",
    };
    let full = format!(r"{root}\{key}");
    let file = dir.join(format!("{n:03}.reg"));
    let out = std::process::Command::new("reg").no_window().args(["export", &full]).arg(&file).arg("/y").output()?;
    if out.status.success() {
        Ok(Some(format!("{full} -> {}", file.display())))
    } else {
        Ok(None)
    }
}
