// SPDX-License-Identifier: Apache-2.0
//! Windows Application event log. Every Windows service of this crate is its own event source whose EventMessageFile
//! is this executable (message table from build.rs: IDs 1..=4 are "%1").

use anyhow::Result;
use windows_sys::Win32::{
    Foundation::HANDLE,
    System::EventLog::{
        DeregisterEventSource, EVENTLOG_ERROR_TYPE, EVENTLOG_INFORMATION_TYPE, EVENTLOG_WARNING_TYPE, RegisterEventSourceW, ReportEventW,
    },
};
use winreg::{RegKey, enums::*};

/// Service lifecycle (start, ready, stop).
pub const ID_LIFECYCLE: u32 = 1;
/// A systemd unit changed state.
pub const ID_UNIT_STATE: u32 = 2;
/// A journal entry of a mirrored unit.
pub const ID_JOURNAL: u32 = 3;
/// Failures of the service itself.
pub const ID_ERROR: u32 = 4;

const SOURCES: &str = r"SYSTEM\CurrentControlSet\Services\EventLog\Application";

#[derive(Clone, Copy)]
pub enum Level {
    Info,
    Warning,
    Error,
}

impl Level {
    /// syslog priority (0 emerg .. 7 debug) to an event type.
    pub fn from_priority(p: u8) -> Self {
        match p {
            0..=3 => Level::Error,
            4 => Level::Warning,
            _ => Level::Info,
        }
    }
}

/// Points an existing source at `exe` (install copies the binary before registering).
pub fn register_source_at(name: &str, exe: &std::path::Path) -> Result<()> {
    let (k, _) = RegKey::predef(HKEY_LOCAL_MACHINE).create_subkey(format!(r"{SOURCES}\{name}"))?;
    k.set_value("EventMessageFile", &exe.display().to_string())?;
    k.set_value("TypesSupported", &7u32)?;
    Ok(())
}

pub fn unregister_source(name: &str) {
    let _ = RegKey::predef(HKEY_LOCAL_MACHINE).delete_subkey_all(format!(r"{SOURCES}\{name}"));
}

pub struct EventLog(HANDLE);

unsafe impl Send for EventLog {}
unsafe impl Sync for EventLog {}

impl EventLog {
    pub fn open(source: &str) -> Self {
        let w: Vec<u16> = source.encode_utf16().chain(Some(0)).collect();
        EventLog(unsafe { RegisterEventSourceW(std::ptr::null(), w.as_ptr()) })
    }

    pub fn report(&self, level: Level, id: u32, msg: &str) {
        if self.0.is_null() {
            return;
        }
        // ReportEvent strings are limited to 31839 characters.
        let text: String = msg.chars().take(31_000).collect();
        let w: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
        let strings = [w.as_ptr()];
        let kind = match level {
            Level::Info => EVENTLOG_INFORMATION_TYPE,
            Level::Warning => EVENTLOG_WARNING_TYPE,
            Level::Error => EVENTLOG_ERROR_TYPE,
        };
        unsafe {
            ReportEventW(self.0, kind, 0, id, std::ptr::null_mut(), 1, 0, strings.as_ptr(), std::ptr::null());
        }
    }

    pub fn info(&self, msg: &str) {
        self.report(Level::Info, ID_LIFECYCLE, msg)
    }

    pub fn warn(&self, msg: &str) {
        self.report(Level::Warning, ID_LIFECYCLE, msg)
    }

    pub fn error(&self, msg: &str) {
        self.report(Level::Error, ID_ERROR, msg)
    }
}

impl Drop for EventLog {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                DeregisterEventSource(self.0);
            }
        }
    }
}
