// SPDX-License-Identifier: Apache-2.0
//! The `nt_*` tools: low-level Windows for Bun OS, user mode first.
//!
//! WinClean is the control plane of the PC; the `bunos.sys` kernel driver (crates/bunos-nt-driver, contract in
//! crates/bunos-nt-proto) only adds what user mode cannot do — today the kernel notification callbacks (process,
//! thread, image load, registry) as an event stream. Every tool works without the driver: `nt_events_*` falls back to
//! a user-mode process poll, `nt_handles` and `nt_kernel_modules` are user-mode `NtQuerySystemInformation` calls.
//!
//! Kernel addresses are never returned (object pointers, module bases): kernel layout stays private (KASLR).

use serde_json::{Value, json};

use crate::SubsystemError;

fn bad(msg: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::InvalidArguments(msg.to_string())
}

fn failed(msg: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::Failed(msg.to_string())
}

/// Routes `nt_*` tools; `None` for any other name.
pub fn call(tool: &str, args: &Value) -> Option<Result<Value, SubsystemError>> {
    Some(match tool {
        "nt_status" => Ok(events::status()),
        "nt_events_start" => events::start(args),
        "nt_events_read" => events::read(args),
        "nt_events_stop" => Ok(events::stop()),
        "nt_handles" => handles(args),
        "nt_kernel_modules" => kernel_modules(args),
        _ => return None,
    })
}

fn limit(args: &Value, default: u64, max: u64) -> usize {
    args.get("limit").and_then(Value::as_u64).unwrap_or(default).clamp(1, max) as usize
}

// ----------------------------------------------------------------------------------------------------------------
// Pure parsers of the NtQuerySystemInformation / NtQueryObject buffers (x64 layouts), bounds-checked and unit-tested.

fn rd_u16(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?))
}
fn rd_u32(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}
fn rd_u64(b: &[u8], o: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(o..o + 8)?.try_into().ok()?))
}

/// One `SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX`, without the kernel object address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandleEntry {
    pub pid: u64,
    pub handle: u64,
    pub access: u32,
    pub type_index: u16,
    pub attributes: u32,
}

const HANDLE_ENTRY: usize = 40;

/// `SYSTEM_HANDLE_INFORMATION_EX` (class 64): `NumberOfHandles, Reserved` then 40-byte entries.
pub fn parse_handles(b: &[u8]) -> Option<Vec<HandleEntry>> {
    let count = rd_u64(b, 0)? as usize;
    let available = b.len().checked_sub(16)? / HANDLE_ENTRY;
    let n = count.min(available);
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let o = 16 + i * HANDLE_ENTRY;
        out.push(HandleEntry {
            pid: rd_u64(b, o + 8)?,
            handle: rd_u64(b, o + 16)?,
            access: rd_u32(b, o + 24)?,
            type_index: rd_u16(b, o + 30)?,
            attributes: rd_u32(b, o + 32)?,
        });
    }
    Some(out)
}

/// `OBJECT_TYPES_INFORMATION` (class 3): `NumberOfTypes` (pointer-aligned), then `OBJECT_TYPE_INFORMATION` (104
/// bytes) each followed by its name buffer, the next entry at the next 8-byte boundary. Returns (TypeIndex, name).
pub fn parse_object_types(b: &[u8]) -> Option<Vec<(u16, String)>> {
    const INFO: usize = 104;
    let count = rd_u32(b, 0)? as usize;
    let mut out = Vec::with_capacity(count.min(256));
    let mut o = 8usize;
    for _ in 0..count.min(256) {
        let len = rd_u16(b, o)? as usize;
        let max = rd_u16(b, o + 2)? as usize;
        let index = *b.get(o + 90)? as u16;
        let name_at = o + INFO;
        let raw = b.get(name_at..name_at + len.min(max))?;
        let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        out.push((index, String::from_utf16_lossy(&units)));
        o = (name_at + max + 7) & !7;
    }
    Some(out)
}

/// One `RTL_PROCESS_MODULE_INFORMATION`, without the image base.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KernelModule {
    pub name: String,
    pub path: String,
    pub size: u32,
    pub load_order: u16,
}

/// `RTL_PROCESS_MODULES` (class 11): `NumberOfModules` (pointer-aligned), then 296-byte entries.
pub fn parse_modules(b: &[u8]) -> Option<Vec<KernelModule>> {
    const ENTRY: usize = 296;
    let count = rd_u32(b, 0)? as usize;
    let n = count.min(b.len().checked_sub(8)? / ENTRY);
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let o = 8 + i * ENTRY;
        let size = rd_u32(b, o + 24)?;
        let load_order = rd_u16(b, o + 32)?;
        let file_at = rd_u16(b, o + 38)? as usize;
        let path_raw = b.get(o + 40..o + 296)?;
        let end = path_raw.iter().position(|&c| c == 0).unwrap_or(path_raw.len());
        let path = String::from_utf8_lossy(&path_raw[..end]).into_owned();
        let name = String::from_utf8_lossy(path_raw.get(file_at.min(end)..end).unwrap_or_default()).into_owned();
        out.push(KernelModule { name, path, size, load_order });
    }
    Some(out)
}

#[cfg(windows)]
fn query_system(class: i32) -> Result<Vec<u8>, SubsystemError> {
    use windows::Wdk::System::SystemInformation::{NtQuerySystemInformation, SYSTEM_INFORMATION_CLASS};
    const STATUS_INFO_LENGTH_MISMATCH: i32 = 0xC000_0004_u32 as i32;
    let mut size = 1usize << 16;
    loop {
        let mut buf = vec![0u8; size];
        let mut needed = 0u32;
        // SAFETY: the buffer is valid for `size` bytes; the call writes at most that much.
        let status = unsafe {
            NtQuerySystemInformation(SYSTEM_INFORMATION_CLASS(class), buf.as_mut_ptr().cast(), size as u32, &mut needed)
        };
        if status.0 == STATUS_INFO_LENGTH_MISMATCH {
            size = (needed as usize).max(size * 2);
            if size > 512 << 20 {
                return Err(failed("NtQuerySystemInformation needs more than 512 MiB"));
            }
            continue;
        }
        if status.0 < 0 {
            return Err(failed(format!("NtQuerySystemInformation({class}) failed {:#010x}", status.0)));
        }
        buf.truncate((needed as usize).min(size).max(16));
        return Ok(buf);
    }
}

#[cfg(windows)]
fn object_types() -> Vec<(u16, String)> {
    use windows::Wdk::Foundation::{NtQueryObject, OBJECT_INFORMATION_CLASS};
    let mut size = 1usize << 16;
    for _ in 0..6 {
        let mut buf = vec![0u8; size];
        let mut needed = 0u32;
        // SAFETY: null handle + ObjectTypesInformation (3) is the documented global query; buffer valid for `size`.
        let status = unsafe {
            NtQueryObject(None, OBJECT_INFORMATION_CLASS(3), Some(buf.as_mut_ptr().cast()), size as u32, Some(&mut needed))
        };
        if status.0 >= 0 {
            return parse_object_types(&buf).unwrap_or_default();
        }
        size = (needed as usize).max(size * 2);
    }
    Vec::new()
}

/// `nt_handles`: the system handle table (user mode, class 64). Without elevation only some processes are visible.
fn handles(args: &Value) -> Result<Value, SubsystemError> {
    #[cfg(windows)]
    {
        let pid = args.get("pid").and_then(Value::as_u64);
        let limit = limit(args, 500, 100_000);
        let buf = query_system(64)?;
        let all = parse_handles(&buf).ok_or_else(|| failed("short SYSTEM_HANDLE_INFORMATION_EX"))?;
        let types: std::collections::HashMap<u16, String> = object_types().into_iter().collect();
        let type_name = |i: u16| types.get(&i).cloned().unwrap_or_else(|| format!("#{i}"));
        let selected: Vec<&HandleEntry> = all.iter().filter(|h| pid.is_none_or(|p| h.pid == p)).collect();
        let mut by_type: std::collections::BTreeMap<String, u64> = Default::default();
        for h in &selected {
            *by_type.entry(type_name(h.type_index)).or_default() += 1;
        }
        let handles: Vec<Value> = selected
            .iter()
            .take(limit)
            .map(|h| {
                json!({"pid": h.pid, "handle": h.handle, "type": type_name(h.type_index),
                       "access": format!("{:#x}", h.access), "attributes": h.attributes})
            })
            .collect();
        Ok(json!({"source": "user-mode", "total": all.len(), "matched": selected.len(), "byType": by_type,
                  "handles": handles, "truncated": selected.len() > limit}))
    }
    #[cfg(not(windows))]
    {
        let _ = args;
        Err(SubsystemError::Unavailable("nt_handles is Windows-only".into()))
    }
}

/// `nt_kernel_modules`: loaded kernel images (user mode, class 11), names and sizes only.
fn kernel_modules(args: &Value) -> Result<Value, SubsystemError> {
    #[cfg(windows)]
    {
        let filter = args.get("name").and_then(Value::as_str).map(str::to_ascii_lowercase);
        let limit = limit(args, 500, 4_096);
        let buf = query_system(11)?;
        let mods = parse_modules(&buf).ok_or_else(|| failed("short RTL_PROCESS_MODULES"))?;
        let list: Vec<Value> = mods
            .iter()
            .filter(|m| filter.as_ref().is_none_or(|f| m.name.to_ascii_lowercase().contains(f)))
            .take(limit)
            .map(|m| json!({"name": m.name, "path": m.path, "size": m.size, "loadOrder": m.load_order}))
            .collect();
        Ok(json!({"source": "user-mode", "count": mods.len(), "modules": list,
                  "bunosLoaded": mods.iter().any(|m| m.name.eq_ignore_ascii_case("bunos.sys"))}))
    }
    #[cfg(not(windows))]
    {
        let _ = args;
        Err(SubsystemError::Unavailable("nt_kernel_modules is Windows-only".into()))
    }
}

// ----------------------------------------------------------------------------------------------------------------
// Event streams: kernel ring when bunos.sys is loaded and this process is elevated, user-mode process poll otherwise.

mod events {
    use super::{Value, bad, failed, json};
    use crate::SubsystemError;
    use bunos_nt_client::{Device, Error, Event, proto};
    use std::collections::HashMap;
    use std::sync::Mutex;

    enum Session {
        /// The open device: closing it (last handle) disables every source in the kernel.
        Kernel(Device),
        /// pid -> name of the previous poll.
        Poll(HashMap<u32, String>),
    }

    static SESSION: Mutex<Option<Session>> = Mutex::new(None);

    fn driver_state() -> (&'static str, Option<String>, Option<Value>) {
        match Device::open() {
            Ok(d) => {
                let caps = d.caps().ok().map(|c| {
                    json!({"abi": c.abi, "sourcesSupported": names(c.sources_supported),
                           "sourcesActive": names(c.sources_active), "ringCapacity": c.ring_capacity,
                           "eventsTotal": c.events_total, "droppedTotal": c.dropped_total})
                });
                ("loaded", d.version().ok(), caps)
            }
            Err(Error::AccessDenied) => ("access-denied", None, None),
            Err(_) => ("absent", None, None),
        }
    }

    fn names(mask: u32) -> Vec<&'static str> {
        proto::source::NAMES.iter().filter(|(_, b)| mask & b != 0).map(|(n, _)| *n).collect()
    }

    pub fn status() -> Value {
        let (driver, version, caps) = driver_state();
        let session = match &*SESSION.lock().unwrap_or_else(|e| e.into_inner()) {
            Some(Session::Kernel(_)) => "kernel",
            Some(Session::Poll(_)) => "user-mode",
            None => "none",
        };
        json!({
            "driver": driver,
            "device": proto::DEVICE_PATH,
            "version": version,
            "caps": caps,
            "abi": proto::ABI,
            "eventSession": session,
            "fallback": "user-mode (WinClean Win32/NT APIs); events degrade to a process poll",
        })
    }

    fn snapshot() -> HashMap<u32, String> {
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        system.processes().iter().map(|(pid, p)| (pid.as_u32(), p.name().to_string_lossy().into_owned())).collect()
    }

    pub fn start(args: &Value) -> Result<Value, SubsystemError> {
        let text = args.get("sources").and_then(Value::as_str).unwrap_or("process,image");
        let mask = proto::parse_sources(text).ok_or_else(|| bad(format!("unknown source in {text}")))?;
        let mut session = SESSION.lock().unwrap_or_else(|e| e.into_inner());
        *session = None;
        let force_poll = args.get("userMode").and_then(Value::as_bool).unwrap_or(false);
        if !force_poll && let Ok(device) = Device::open() {
            let caps = device.configure(mask).map_err(failed)?;
            *session = Some(Session::Kernel(device));
            return Ok(json!({"source": "kernel", "sourcesActive": names(caps.sources_active)}));
        }
        *session = Some(Session::Poll(snapshot()));
        Ok(json!({"source": "user-mode", "sourcesActive": ["process"],
                  "note": "bunos.sys not loaded or not elevated: process create/exit by polling; thread, image and registry need the driver"}))
    }

    fn event_json(e: &Event) -> Value {
        json!({"kind": e.kind.name(), "time": e.time, "pid": e.pid, "a0": e.a0, "a1": e.a1, "name": e.name,
               "truncated": e.truncated, "kernelImage": e.kernel_image})
    }

    /// FILETIME now (100 ns since 1601), the clock of the kernel records.
    fn filetime_now() -> i64 {
        let unix = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        (unix.as_nanos() / 100) as i64 + 116_444_736_000_000_000
    }

    pub fn read(args: &Value) -> Result<Value, SubsystemError> {
        let max = args.get("max").and_then(Value::as_u64).unwrap_or(256).clamp(1, 512) as usize;
        let mut session = SESSION.lock().unwrap_or_else(|e| e.into_inner());
        match session.as_mut() {
            None => Err(bad("no event session: call nt_events_start first")),
            Some(Session::Kernel(device)) => {
                let batch = device.read_events(max).map_err(failed)?;
                Ok(json!({"source": "kernel", "events": batch.events.iter().map(event_json).collect::<Vec<_>>(),
                          "dropped": batch.dropped, "pending": batch.pending}))
            }
            Some(Session::Poll(previous)) => {
                let current = snapshot();
                let now = filetime_now();
                let mut events = Vec::new();
                for (pid, name) in &current {
                    if !previous.contains_key(pid) {
                        events.push(json!({"kind": "process_create", "time": now, "pid": pid, "name": name}));
                    }
                }
                for (pid, name) in previous.iter() {
                    if !current.contains_key(pid) {
                        events.push(json!({"kind": "process_exit", "time": now, "pid": pid, "name": name}));
                    }
                }
                *previous = current;
                let pending = events.len().saturating_sub(max);
                events.truncate(max);
                Ok(json!({"source": "user-mode", "events": events, "dropped": pending, "pending": 0}))
            }
        }
    }

    pub fn stop() -> Value {
        let mut session = SESSION.lock().unwrap_or_else(|e| e.into_inner());
        let was = match session.take() {
            Some(Session::Kernel(device)) => {
                let _ = device.configure(0);
                "kernel"
            }
            Some(Session::Poll(_)) => "user-mode",
            None => "none",
        };
        json!({"stopped": was})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_parse_and_bound() {
        let mut b = vec![0u8; 16 + 2 * HANDLE_ENTRY];
        b[0] = 5; // claims 5, only 2 fit
        b[16 + 8] = 4; // pid 4
        b[16 + 16] = 0x10; // handle
        b[16 + 24..16 + 28].copy_from_slice(&0x1f_0003u32.to_le_bytes());
        b[16 + 30] = 7; // type index
        let h = parse_handles(&b).unwrap();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0], HandleEntry { pid: 4, handle: 0x10, access: 0x1f_0003, type_index: 7, attributes: 0 });
        assert!(parse_handles(&[0; 8]).is_none());
    }

    #[test]
    fn object_types_walk() {
        let name: Vec<u8> = "Process".encode_utf16().flat_map(u16::to_le_bytes).collect();
        let mut b = vec![0u8; 8];
        b[0] = 1;
        let mut info = vec![0u8; 104];
        info[0..2].copy_from_slice(&(name.len() as u16).to_le_bytes());
        info[2..4].copy_from_slice(&(name.len() as u16 + 2).to_le_bytes());
        info[90] = 7;
        b.extend_from_slice(&info);
        b.extend_from_slice(&name);
        b.extend_from_slice(&[0, 0]);
        assert_eq!(parse_object_types(&b).unwrap(), vec![(7, "Process".to_string())]);
        b[0] = 2; // second entry missing: rejected, not panicking
        assert!(parse_object_types(&b).is_none());
    }

    #[test]
    fn modules_parse() {
        let mut b = vec![0u8; 8 + 296];
        b[0] = 1;
        let path = b"\\SystemRoot\\system32\\ntoskrnl.exe";
        b[8 + 24..8 + 28].copy_from_slice(&0x0100_0000u32.to_le_bytes());
        b[8 + 38..8 + 40].copy_from_slice(&21u16.to_le_bytes());
        b[8 + 40..8 + 40 + path.len()].copy_from_slice(path);
        let m = parse_modules(&b).unwrap();
        assert_eq!(m[0].name, "ntoskrnl.exe");
        assert_eq!(m[0].size, 0x0100_0000);
    }

    #[test]
    fn parsers_survive_random_input() {
        let mut s = 0x1234_5678_9abc_def0u64;
        for _ in 0..20_000 {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            let len = (s % 2048) as usize;
            let b: Vec<u8> = (0..len).map(|i| (s.rotate_left(i as u32 % 64) >> 3) as u8).collect();
            let _ = parse_handles(&b);
            let _ = parse_object_types(&b);
            let _ = parse_modules(&b);
        }
    }

    #[test]
    fn status_without_driver_reports_fallback() {
        let s = call("nt_status", &json!({})).unwrap().unwrap();
        assert!(["absent", "access-denied", "loaded"].contains(&s["driver"].as_str().unwrap()));
    }
}
