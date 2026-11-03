// SPDX-License-Identifier: Apache-2.0
//! Cross-platform system inventory used by the WinClean compatibility tools.
//!
//! Clipboard, services, event log, Defender, TCP table, ViGEm probe and URI launch call the
//! documented Win32 APIs in-process (see the `clipboard`, `services`, `eventlog`, `defender` and
//! `tcp` modules); no `powershell.exe`, `sc.exe`, `wevtutil`, `netstat`, `reg.exe`, `where.exe`
//! or `explorer.exe` process is started for them.

use aphrody_proc::NoWindow as _;
use std::io;

use serde::Serialize;
use sysinfo::{Disks, Networks, Signal, System};

use crate::filesystem::resolve_path;
pub use crate::{
    clipboard::{get_clipboard_text, set_clipboard_text},
    defender::get_defender_status,
    eventlog::query_event_log,
    services::{control_service, list_services},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct MemoryInfo {
    pub memory_load_percent: u32,
    pub total_physical_bytes: u64,
    pub available_physical_bytes: u64,
    pub total_page_file_bytes: u64,
    pub available_page_file_bytes: u64,
    pub total_virtual_bytes: u64,
    pub available_virtual_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct CpuInfo {
    pub logical_processors: usize,
    pub physical_cores: usize,
    pub numa_nodes: u32,
    pub cache_line_bytes: u32,
    pub l1_cache_bytes: u64,
    pub l2_cache_bytes: u64,
    pub l3_cache_bytes: u64,
    pub processor_architecture: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct CpuUsage {
    pub usage_percent: f64,
    pub idle_percent: f64,
    pub sample_interval_ms: u64,
    pub kernel_seconds: f64,
    pub user_seconds: f64,
    pub idle_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct DiskInfo {
    pub root: String,
    pub drive_type: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct DiskInfoListResponse {
    pub count: usize,
    pub disks: Vec<DiskInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct OsInfo {
    pub product_name: String,
    pub edition_id: String,
    pub display_version: String,
    pub build_number: String,
    pub ubr: String,
    pub installation_type: String,
    pub os_architecture: String,
    pub machine_name: String,
    pub user_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct NetworkAdapter {
    pub name: String,
    pub description: String,
    pub status: String,
    pub physical_address: String,
    pub speed_bps: u64,
    pub ip_addresses: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct NetworkAdapterListResponse {
    pub count: usize,
    pub adapters: Vec<NetworkAdapter>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct TcpConnection {
    pub local_address: String,
    pub local_port: u16,
    pub remote_address: String,
    pub remote_port: u16,
    pub state: String,
    pub owning_pid: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct TcpConnectionListResponse {
    pub count: usize,
    pub connections: Vec<TcpConnection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub working_set_bytes: u64,
    pub private_working_set_bytes: u64,
    pub cpu_seconds: f64,
    pub kernel_time_seconds: f64,
    pub user_time_seconds: f64,
    pub threads: usize,
    pub handles: usize,
    pub parent_pid: Option<u32>,
    pub session_id: u32,
    pub priority_class: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct ProcessListResponse {
    pub count: usize,
    pub truncated: bool,
    pub processes: Vec<ProcessInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct PowerPlan {
    pub guid: String,
    pub name: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct PowerPlanListResponse {
    pub count: usize,
    pub active_guid: String,
    pub plans: Vec<PowerPlan>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct ServiceInfo {
    pub name: String,
    pub display_name: String,
    pub status: String,
    pub start_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct ServiceListResponse {
    pub count: usize,
    pub services: Vec<ServiceInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct ScheduledTask {
    pub path: String,
    pub name: String,
    pub state: String,
    pub last_run_time_utc: String,
    pub last_task_result: i32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct ScheduledTaskListResponse {
    pub count: usize,
    pub tasks: Vec<ScheduledTask>,
}

pub fn get_memory_info() -> MemoryInfo {
    let mut system = System::new();
    system.refresh_memory();
    let total = system.total_memory();
    let available = system.available_memory();
    MemoryInfo {
        memory_load_percent: (u128::from(total.saturating_sub(available)) * 100)
            .checked_div(u128::from(total))
            .unwrap_or(0) as u32,
        total_physical_bytes: total,
        available_physical_bytes: available,
        total_page_file_bytes: system.total_swap(),
        available_page_file_bytes: system.free_swap(),
        total_virtual_bytes: total.saturating_add(system.total_swap()),
        available_virtual_bytes: available.saturating_add(system.free_swap()),
    }
}

/// Cache totals summed over every cache instance reported by
/// `GetLogicalProcessorInformationEx(RelationCache)` (same meaning as WMI `L2CacheSize`/`L3CacheSize`).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct CacheTotals {
    l1: u64,
    l2: u64,
    l3: u64,
    line: u32,
}

/// Walk a `SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX` buffer as (relationship, record bytes).
fn lpi_records(buffer: &[u8]) -> impl Iterator<Item = (u32, &[u8])> {
    let mut offset = 0usize;
    std::iter::from_fn(move || {
        let head = buffer.get(offset..offset.checked_add(8)?)?;
        let relationship = u32::from_le_bytes(head[..4].try_into().ok()?);
        let size = u32::from_le_bytes(head[4..8].try_into().ok()?) as usize;
        if size < 8 {
            return None;
        }
        let record = buffer.get(offset..offset.checked_add(size)?)?;
        offset += size;
        Some((relationship, record))
    })
}

const RELATION_NUMA_NODE: u32 = 1;
const RELATION_CACHE: u32 = 2;

fn cache_totals(buffer: &[u8]) -> CacheTotals {
    let mut totals = CacheTotals::default();
    for (relationship, record) in lpi_records(buffer) {
        // CACHE_RELATIONSHIP after the 8-byte header: Level u8, Associativity u8, LineSize u16,
        // CacheSize u32.
        if relationship != RELATION_CACHE || record.len() < 16 {
            continue;
        }
        let level = record[8];
        let line = u32::from(u16::from_le_bytes([record[10], record[11]]));
        let size = u64::from(u32::from_le_bytes([
            record[12], record[13], record[14], record[15],
        ]));
        match level {
            1 => {
                totals.l1 += size;
                totals.line = totals.line.max(line);
            }
            2 => totals.l2 += size,
            3 => totals.l3 += size,
            _ => {}
        }
    }
    totals
}

fn numa_node_count(buffer: &[u8]) -> u32 {
    let nodes = lpi_records(buffer).filter(|(relationship, _)| *relationship == RELATION_NUMA_NODE);
    u32::try_from(nodes.count()).unwrap_or(u32::MAX)
}

#[cfg(windows)]
fn logical_processor_info(relationship: u32) -> Vec<u8> {
    use windows::Win32::System::SystemInformation::{
        GetLogicalProcessorInformationEx, LOGICAL_PROCESSOR_RELATIONSHIP,
        SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
    };
    let relationship = LOGICAL_PROCESSOR_RELATIONSHIP(relationship as i32);
    let mut length = 0u32;
    // SAFETY: a null buffer with length 0 only asks for the required size.
    let _ = unsafe { GetLogicalProcessorInformationEx(relationship, None, &mut length) };
    if length == 0 {
        return Vec::new();
    }
    let mut buffer = vec![0u8; length as usize];
    // SAFETY: `buffer` is `length` writable bytes; the API fills whole records and updates `length`.
    let result = unsafe {
        GetLogicalProcessorInformationEx(
            relationship,
            Some(
                buffer
                    .as_mut_ptr()
                    .cast::<SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(),
            ),
            &mut length,
        )
    };
    if result.is_err() {
        return Vec::new();
    }
    buffer.truncate(length as usize);
    buffer
}

#[cfg(not(windows))]
fn logical_processor_info(_relationship: u32) -> Vec<u8> {
    Vec::new()
}

pub fn get_cpu_info() -> CpuInfo {
    let mut system = System::new();
    system.refresh_cpu_all();
    let logical = system.cpus().len().max(1);
    let physical = System::physical_core_count().unwrap_or(logical).max(1);
    let caches = cache_totals(&logical_processor_info(RELATION_CACHE));
    let numa = numa_node_count(&logical_processor_info(RELATION_NUMA_NODE)).max(1);
    CpuInfo {
        logical_processors: logical,
        physical_cores: physical,
        numa_nodes: numa,
        cache_line_bytes: if caches.line == 0 { 64 } else { caches.line },
        l1_cache_bytes: caches.l1,
        l2_cache_bytes: caches.l2,
        l3_cache_bytes: caches.l3,
        processor_architecture: std::env::consts::ARCH.to_owned(),
    }
}

pub fn get_cpu_usage(interval_ms: u64) -> CpuUsage {
    let interval_ms = interval_ms.clamp(50, 2_000);
    let mut system = System::new();
    system.refresh_cpu_all();
    std::thread::sleep(std::time::Duration::from_millis(interval_ms));
    system.refresh_cpu_all();
    let usage = f64::from(system.global_cpu_usage());
    CpuUsage {
        usage_percent: usage,
        idle_percent: (100.0 - usage).max(0.0),
        sample_interval_ms: interval_ms,
        kernel_seconds: 0.0,
        user_seconds: 0.0,
        idle_seconds: 0.0,
    }
}

/// Flush pending Desktop Window Manager work and report the HRESULT exactly as
/// the legacy WinClean contract does.
#[cfg(windows)]
pub fn perf_dwm_flush() -> io::Result<serde_json::Value> {
    use windows::Win32::Graphics::Dwm::DwmFlush;
    match unsafe { DwmFlush() } {
        Ok(()) => Ok(serde_json::json!({"success":true,"hr":"0x00000000"})),
        Err(error) => {
            let hr = error.code().0 as u32;
            Ok(serde_json::json!({"success":false,"hr":format!("0x{hr:08X}")}))
        }
    }
}

#[cfg(not(windows))]
pub fn perf_dwm_flush() -> io::Result<serde_json::Value> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "DwmFlush is Windows-only",
    ))
}

/// Apply Win11 PowerThrottling/EcoQoS to one process using the documented
/// `SetProcessInformation(ProcessPowerThrottling, ...)` contract.
#[cfg(windows)]
pub fn perf_set_eco_mode(pid: u32, mode: &str) -> io::Result<serde_json::Value> {
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
        PROCESS_SET_INFORMATION, ProcessPowerThrottling, SetProcessInformation,
    };
    let (control_mask, state_mask, canonical_mode) = match mode.to_ascii_lowercase().as_str() {
        "on" | "eco" => (
            PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            "on",
        ),
        "off" | "perf" => (PROCESS_POWER_THROTTLING_EXECUTION_SPEED, 0, "off"),
        "default" | "clear" => (0, 0, "default"),
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "unknown mode; use on|off|default",
            ));
        }
    };
    let handle = unsafe { OpenProcess(PROCESS_SET_INFORMATION, false, pid) }
        .map_err(|error| io::Error::new(io::ErrorKind::PermissionDenied, error.to_string()))?;
    let state = PROCESS_POWER_THROTTLING_STATE {
        Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask: control_mask,
        StateMask: state_mask,
    };
    let result = unsafe {
        SetProcessInformation(
            handle,
            ProcessPowerThrottling,
            (&state as *const PROCESS_POWER_THROTTLING_STATE).cast(),
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        )
    };
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
    result
        .map(|_| serde_json::json!({"success":true,"pid":pid,"mode":canonical_mode}))
        .map_err(|error| io::Error::new(io::ErrorKind::PermissionDenied, error.to_string()))
}

#[cfg(not(windows))]
pub fn perf_set_eco_mode(_pid: u32, _mode: &str) -> io::Result<serde_json::Value> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "EcoQoS is Windows-only",
    ))
}

pub fn list_processes(
    name_filter: Option<&str>,
    sort_by: &str,
    limit: usize,
) -> ProcessListResponse {
    let limit = limit.clamp(1, 1_000);
    let mut system = System::new_all();
    system.refresh_all();
    let needle = name_filter.map(str::to_ascii_lowercase);
    let mut processes = system
        .processes()
        .values()
        .filter_map(|process| {
            let name = process.name().to_string_lossy().into_owned();
            if needle
                .as_ref()
                .is_some_and(|value| !name.to_ascii_lowercase().contains(value))
            {
                return None;
            }
            let cpu = f64::from(process.cpu_usage()) / 100.0;
            Some(ProcessInfo {
                pid: process.pid().as_u32(),
                name,
                working_set_bytes: process.memory(),
                private_working_set_bytes: process.virtual_memory(),
                cpu_seconds: cpu,
                kernel_time_seconds: 0.0,
                user_time_seconds: 0.0,
                threads: 0,
                handles: 0,
                parent_pid: process.parent().map(|pid| pid.as_u32()),
                session_id: 0,
                priority_class: "Unknown".to_owned(),
            })
        })
        .collect::<Vec<_>>();
    match sort_by.to_ascii_lowercase().as_str() {
        "name" => processes.sort_by(|left, right| {
            left.name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase())
        }),
        "cpu" => processes.sort_by(|left, right| right.cpu_seconds.total_cmp(&left.cpu_seconds)),
        "private" => {
            processes.sort_by_key(|item| std::cmp::Reverse(item.private_working_set_bytes))
        }
        _ => processes.sort_by_key(|item| std::cmp::Reverse(item.working_set_bytes)),
    }
    let truncated = processes.len() > limit;
    processes.truncate(limit);
    let count = processes.len();
    ProcessListResponse {
        count,
        truncated,
        processes,
    }
}

pub fn kill_process(pid: Option<u32>, name: Option<&str>, _force: bool) -> String {
    let mut system = System::new_all();
    system.refresh_all();
    if let Some(pid) = pid {
        let process = sysinfo::Pid::from_u32(pid);
        return match system.process(process) {
            Some(value) if value.kill_with(Signal::Kill).unwrap_or(false) => {
                "Killed 1 process.".to_owned()
            }
            Some(_) => format!("Unable to terminate PID {pid}."),
            None => format!("No process with PID {pid}."),
        };
    }
    let Some(name) = name.filter(|value| !value.trim().is_empty()) else {
        return "No PID or process name supplied.".to_owned();
    };
    let needle = name.trim_end_matches(".exe").to_ascii_lowercase();
    let mut killed = 0usize;
    for process in system.processes().values() {
        let process_name = process.name().to_string_lossy().to_ascii_lowercase();
        if process_name.trim_end_matches(".exe") == needle
            && process.kill_with(Signal::Kill).unwrap_or(false)
        {
            killed += 1;
        }
    }
    format!("Killed {killed} process(es).")
}

pub fn wait_seconds(seconds: u64) -> String {
    let seconds = seconds.clamp(1, 120);
    std::thread::sleep(std::time::Duration::from_secs(seconds));
    format!("Waited {seconds} second(s).")
}

/// Execute a bounded PowerShell command and collect both output streams.
pub fn power_shell(command: &str, timeout_seconds: u64) -> io::Result<serde_json::Value> {
    if command.trim().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "command must be non-empty",
        ));
    }
    let timeout = timeout_seconds.clamp(1, 600);
    let mut dotnet_root: Option<std::path::PathBuf> = None;
    let executable = if cfg!(windows) {
        // PowerShell 7 built from vendor/powershell (packages/bun-dotnet-windows install) first.
        let bunos = std::path::PathBuf::from(
            std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
        )
        .join("BunOS/dotnet-windows/pshome/pwsh.exe");
        // That build is framework-dependent on .NET 11; its apphost finds a per-user runtime only through DOTNET_ROOT.
        let has_net11 = |root: &std::path::Path| {
            std::fs::read_dir(root.join("shared").join("Microsoft.NETCore.App")).is_ok_and(
                |versions| {
                    versions
                        .flatten()
                        .any(|v| v.file_name().to_string_lossy().starts_with("11."))
                },
            )
        };
        dotnet_root = std::env::var_os("LOCALAPPDATA")
            .map(|base| {
                std::path::PathBuf::from(base)
                    .join("Microsoft")
                    .join("dotnet")
            })
            .filter(|root| has_net11(root));
        let machine = std::path::PathBuf::from(
            std::env::var_os("ProgramFiles").unwrap_or_else(|| "C:\\Program Files".into()),
        )
        .join("dotnet");
        let bunos_runnable = bunos.is_file() && (dotnet_root.is_some() || has_net11(&machine));
        if !bunos_runnable {
            dotnet_root = None;
        }
        let modern = std::path::PathBuf::from(
            std::env::var_os("ProgramFiles").unwrap_or_else(|| "C:\\Program Files".into()),
        )
        .join("PowerShell/7/pwsh.exe");
        if bunos_runnable {
            bunos
        } else if modern.is_file() {
            modern
        } else {
            std::path::PathBuf::from(
                std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
            )
            .join("System32/WindowsPowerShell/v1.0/powershell.exe")
        }
    } else {
        std::path::PathBuf::from("pwsh")
    };
    let encoded_command = format!(
        "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; {command}"
    );
    let started = std::time::Instant::now();
    let mut process = std::process::Command::new(executable);
    if let Some(root) = &dotnet_root {
        process.env("DOTNET_ROOT", root);
    }
    let output = crate::wsl::capture(
        process.no_window().args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &encoded_command,
        ]),
        std::time::Duration::from_secs(timeout),
    )?;
    Ok(serde_json::json!({
        "stdout": crate::wsl::decode(&output.stdout),
        "stderr": crate::wsl::decode(&output.stderr),
        "exitCode": output.status.code(),
        "timedOut": output.timed_out,
        "outputTruncated": output.truncated,
        "durationMs": started.elapsed().as_millis(),
    }))
}

#[cfg(windows)]
pub fn trim_process_working_set(pid: u32) -> io::Result<serde_json::Value> {
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA, SetProcessWorkingSetSize,
    };
    let handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA, false, pid) }
        .map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e.to_string()))?;
    let result = unsafe { SetProcessWorkingSetSize(handle, usize::MAX, usize::MAX) };
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
    result
        .map(|_| serde_json::json!({"success":true,"pid":pid}))
        .map_err(|e| io::Error::other(e.to_string()))
}

#[cfg(not(windows))]
pub fn trim_process_working_set(_pid: u32) -> io::Result<serde_json::Value> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "working-set trimming is Windows-only",
    ))
}

/// Trims every process working set through SystemMemoryListInformation; no
/// process is terminated.
#[cfg(windows)]
pub fn empty_working_sets() -> io::Result<serde_json::Value> {
    nt_set_system_information(2).map(|status| serde_json::json!({"success":true,"action":"MemoryEmptyWorkingSets","status":status}))
}

#[cfg(not(windows))]
pub fn empty_working_sets() -> io::Result<serde_json::Value> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "working-set trimming is Windows-only",
    ))
}

#[cfg(windows)]
pub fn purge_standby_list(low_priority_only: bool) -> io::Result<serde_json::Value> {
    let command = if low_priority_only { 5 } else { 4 };
    nt_set_system_information(command).map(|status| serde_json::json!({"success":true,"action":"PerfPurgeStandbyList","lowPriorityOnly":low_priority_only,"status":status}))
}

#[cfg(not(windows))]
pub fn purge_standby_list(_low_priority_only: bool) -> io::Result<serde_json::Value> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "standby-list purge is Windows-only",
    ))
}

#[cfg(windows)]
fn nt_set_system_information(command: i32) -> io::Result<i32> {
    use std::{
        ffi::{CString, c_void},
        ptr::addr_of_mut,
    };

    use windows::{
        Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW},
        core::{PCSTR, PCWSTR},
    };
    type NtSetSystemInformation = unsafe extern "system" fn(i32, *mut c_void, u32) -> i32;
    // SystemMemoryListInformation answers STATUS_PRIVILEGE_NOT_HELD unless
    // SeProfileSingleProcessPrivilege is enabled, even on an elevated token.
    crate::memory::enable_privilege(windows::Win32::Security::SE_PROF_SINGLE_PROCESS_NAME)?;
    let library_name: Vec<u16> = "ntdll.dll\0".encode_utf16().collect();
    let library = unsafe { LoadLibraryW(PCWSTR(library_name.as_ptr())) }
        .map_err(|error| io::Error::new(io::ErrorKind::NotFound, error.to_string()))?;
    let symbol = CString::new("NtSetSystemInformation").expect("static symbol");
    let function = unsafe { GetProcAddress(library, PCSTR(symbol.as_ptr().cast())) }
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "NtSetSystemInformation missing"))?;
    // SAFETY: the symbol is documented with this ABI and exact signature.
    let function: NtSetSystemInformation = unsafe { std::mem::transmute(function) };
    let mut value = command;
    let status = unsafe {
        function(
            80,
            addr_of_mut!(value).cast(),
            std::mem::size_of::<i32>() as u32,
        )
    };
    if status < 0 {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "NtSetSystemInformation failed: NTSTATUS 0x{:08X}",
                status as u32
            ),
        ))
    } else {
        Ok(status)
    }
}

#[cfg(windows)]
pub fn set_process_affinity(pid: u32, requested: usize) -> io::Result<serde_json::Value> {
    use windows::Win32::System::Threading::{
        GetProcessAffinityMask, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_INFORMATION,
        SetProcessAffinityMask,
    };
    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_SET_INFORMATION,
            false,
            pid,
        )
    }
    .map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e.to_string()))?;
    let mut previous = 0usize;
    let mut system = 0usize;
    unsafe { GetProcessAffinityMask(handle, &mut previous, &mut system) }
        .map_err(|e| io::Error::other(e.to_string()))?;
    let target = if requested == 0 {
        system
    } else {
        requested & system
    };
    if target == 0 {
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "affinity mask has no valid system CPU",
        ));
    }
    unsafe { SetProcessAffinityMask(handle, target) }
        .map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e.to_string()))?;
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
    Ok(
        serde_json::json!({"previousMask":format!("0x{previous:X}"),"newMask":format!("0x{target:X}")}),
    )
}

#[cfg(not(windows))]
pub fn set_process_affinity(_pid: u32, _requested: usize) -> io::Result<serde_json::Value> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "process affinity is Windows-only",
    ))
}

#[cfg(windows)]
pub fn set_process_priority(pid: u32, priority: &str) -> io::Result<serde_json::Value> {
    use windows::Win32::System::Threading::{
        ABOVE_NORMAL_PRIORITY_CLASS, BELOW_NORMAL_PRIORITY_CLASS, GetPriorityClass,
        HIGH_PRIORITY_CLASS, IDLE_PRIORITY_CLASS, NORMAL_PRIORITY_CLASS, OpenProcess,
        PROCESS_QUERY_INFORMATION, PROCESS_SET_INFORMATION, REALTIME_PRIORITY_CLASS,
        SetPriorityClass,
    };
    let class = match priority.to_ascii_lowercase().as_str() {
        "idle" => IDLE_PRIORITY_CLASS,
        "belownormal" => BELOW_NORMAL_PRIORITY_CLASS,
        "normal" => NORMAL_PRIORITY_CLASS,
        "abovenormal" => ABOVE_NORMAL_PRIORITY_CLASS,
        "high" => HIGH_PRIORITY_CLASS,
        "realtime" => REALTIME_PRIORITY_CLASS,
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "unknown priority class",
            ));
        }
    };
    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_SET_INFORMATION,
            false,
            pid,
        )
    }
    .map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e.to_string()))?;
    let previous = unsafe { GetPriorityClass(handle) };
    unsafe { SetPriorityClass(handle, class) }
        .map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e.to_string()))?;
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
    Ok(serde_json::json!({"previousClass":previous,"newClass":priority}))
}

#[cfg(not(windows))]
pub fn set_process_priority(_pid: u32, _priority: &str) -> io::Result<serde_json::Value> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "process priority is Windows-only",
    ))
}

pub fn launch_app(
    target: &str,
    args: Option<&str>,
    working_directory: Option<&str>,
) -> std::io::Result<String> {
    if target.trim().is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "target must be non-empty",
        ));
    }
    if target.contains(':') && !std::path::Path::new(target).is_absolute() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "shell URI launch requires the Windows broker",
        ));
    }
    let mut command = std::process::Command::new(target).no_window();
    if let Some(arguments) = args {
        command.args(arguments.split_whitespace());
    }
    if let Some(directory) = working_directory {
        command.current_dir(resolve_path(directory)?);
    }
    let child = command.spawn()?;
    Ok(format!("Launched '{target}' with PID {}.", child.id()))
}

pub fn list_power_plans() -> std::io::Result<PowerPlanListResponse> {
    if !cfg!(windows) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "power plans are Windows-only",
        ));
    }
    let output = std::process::Command::new("powercfg")
        .no_window()
        .arg("/list")
        .output()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let mut plans = Vec::new();
    for line in text.lines() {
        let Some(guid) = line
            .split_whitespace()
            .find(|value| value.len() >= 32 && value.matches('-').count() >= 4)
        else {
            continue;
        };
        let is_active = line.contains('*');
        let name = line
            .split_once('(')
            .and_then(|(_, rest)| rest.split(')').next())
            .unwrap_or("Unknown")
            .trim()
            .to_owned();
        plans.push(PowerPlan {
            guid: guid.trim_matches(['{', '}']).to_owned(),
            name,
            is_active,
        });
    }
    let active_guid = plans
        .iter()
        .find(|plan| plan.is_active)
        .map(|plan| plan.guid.clone())
        .unwrap_or_default();
    Ok(PowerPlanListResponse {
        count: plans.len(),
        active_guid,
        plans,
    })
}

pub fn get_active_power_plan() -> std::io::Result<PowerPlan> {
    let plans = list_power_plans()?;
    plans
        .plans
        .into_iter()
        .find(|plan| plan.is_active)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no active power plan"))
}

pub fn set_active_power_plan(guid: &str) -> std::io::Result<String> {
    if !cfg!(windows) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "power plans are Windows-only",
        ));
    }
    let normalized = guid.trim().trim_matches(['{', '}']).to_ascii_lowercase();
    if !valid_guid(&normalized) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid power-plan GUID",
        ));
    }
    let output = std::process::Command::new("powercfg")
        .no_window()
        .args(["/setactive", normalized.as_str()])
        .output()?;
    if !output.status.success() {
        return Err(std::io::Error::other(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    Ok(format!("Activated power plan '{normalized}'."))
}

pub fn list_scheduled_tasks(folder: &str) -> std::io::Result<ScheduledTaskListResponse> {
    if !cfg!(windows) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "scheduled tasks are Windows-only",
        ));
    }
    let folder = if folder.trim().is_empty() {
        "\\"
    } else {
        folder.trim()
    };
    if folder
        .bytes()
        .any(|byte| byte.is_ascii_control() || matches!(byte, b'"' | b'\''))
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid task folder",
        ));
    }
    let targeted = std::process::Command::new("schtasks")
        .no_window()
        .args(["/Query", "/TN", folder, "/FO", "CSV", "/V", "/NH"])
        .output()?;
    let output = if targeted.status.success() && !targeted.stdout.is_empty() {
        targeted.stdout
    } else {
        std::process::Command::new("schtasks")
            .no_window()
            .args(["/Query", "/FO", "CSV", "/V", "/NH"])
            .output()?
            .stdout
    };
    let prefix = folder.trim_end_matches('\\');
    let mut tasks = Vec::new();
    for line in String::from_utf8_lossy(&output).lines() {
        let fields = parse_csv_row(line);
        if fields.len() < 4 {
            continue;
        }
        let path = fields[1].clone();
        if !prefix.is_empty()
            && prefix != "\\"
            && !path
                .to_ascii_lowercase()
                .starts_with(&prefix.to_ascii_lowercase())
        {
            continue;
        }
        let state = fields[3].clone();
        let last_run = fields.get(5).cloned().unwrap_or_default();
        let last_result = fields
            .get(6)
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let name = path.rsplit('\\').next().unwrap_or(&path).to_owned();
        tasks.push(ScheduledTask {
            path,
            name,
            state: state.clone(),
            last_run_time_utc: last_run,
            last_task_result: last_result,
            enabled: !state.eq_ignore_ascii_case("Disabled"),
        });
    }
    Ok(ScheduledTaskListResponse {
        count: tasks.len(),
        tasks,
    })
}

pub fn control_scheduled_task(action: &str, path: &str) -> std::io::Result<String> {
    if !cfg!(windows) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "scheduled tasks are Windows-only",
        ));
    }
    let path = path.trim();
    if path.is_empty()
        || path
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b'"')
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid task path",
        ));
    }
    let args: Vec<&str> = match action {
        "run" => vec!["/Run", "/TN", path],
        "enable" => vec!["/Change", "/TN", path, "/Enable"],
        "disable" => vec!["/Change", "/TN", path, "/Disable"],
        _ => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "unsupported task action",
            ));
        }
    };
    let output = std::process::Command::new("schtasks")
        .no_window()
        .args(args)
        .output()?;
    if !output.status.success() {
        return Err(std::io::Error::other(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    let verb = match action {
        "run" => "Ran",
        "enable" => "Enabled",
        _ => "Disabled",
    };
    Ok(format!("{verb} scheduled task '{path}'."))
}

fn parse_csv_row(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '"' if quoted && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => {
                fields.push(current.clone());
                current.clear();
            }
            other => current.push(other),
        }
    }
    fields.push(current);
    fields
}

fn valid_guid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn validate_wsl_distribution(distribution: &str) -> io::Result<()> {
    if distribution.trim().is_empty()
        || distribution.len() > 128
        || distribution
            .chars()
            .any(|character| character.is_control() || character == '"')
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid WSL distribution",
        ));
    }
    Ok(())
}

pub fn wsl_get_status() -> serde_json::Value {
    crate::wsl::result(&["--status".to_owned()])
}

pub fn wsl_list_distributions() -> serde_json::Value {
    crate::wsl::result(&["--list".to_owned(), "--verbose".to_owned()])
}

pub fn wsl_list_processes(distribution: &str) -> io::Result<serde_json::Value> {
    validate_wsl_distribution(distribution)?;
    Ok(crate::wsl::result(&[
        "--distribution".to_owned(),
        distribution.to_owned(),
        "--exec".to_owned(),
        "/usr/bin/ps".to_owned(),
        "-eo".to_owned(),
        "pid,ppid,comm,args".to_owned(),
    ]))
}

pub fn wsl_read_only_probe(distribution: &str, probe: &str) -> io::Result<serde_json::Value> {
    validate_wsl_distribution(distribution)?;
    let command: &[&str] = match probe.trim().to_ascii_lowercase().as_str() {
        "system-info" => &["/usr/bin/uname", "-a"],
        "re-toolchain" => &[
            "/usr/bin/dpkg-query",
            "--show",
            "gdb",
            "gdb-multiarch",
            "radare2",
            "yara",
            "binwalk",
            "qemu-user",
            "clang",
            "lldb",
        ],
        "processes" => &["/usr/bin/ps", "-eo", "pid,ppid,comm,args"],
        "mounts" => &["/usr/bin/findmnt", "--json"],
        "network" => &["/usr/sbin/ip", "-brief", "address"],
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "probe must be system-info, re-toolchain, processes, mounts, or network",
            ));
        }
    };
    let mut args = vec![
        "--distribution".to_owned(),
        distribution.to_owned(),
        "--exec".to_owned(),
    ];
    args.extend(command.iter().map(|value| (*value).to_owned()));
    Ok(crate::wsl::result(&args))
}

pub fn wsl_execute(distribution: &str, command: &[String]) -> io::Result<serde_json::Value> {
    validate_wsl_distribution(distribution)?;
    if command.is_empty()
        || command.len() > 64
        || command
            .iter()
            .any(|arg| arg.is_empty() || arg.len() > 8192 || arg.chars().any(char::is_control))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "command must contain 1..64 safe arguments",
        ));
    }
    let mut args = vec![
        "--distribution".to_owned(),
        distribution.to_owned(),
        "--exec".to_owned(),
    ];
    args.extend(command.iter().cloned());
    Ok(crate::wsl::result(&args))
}

pub fn wsl_send_signal(
    distribution: &str,
    process_id: u32,
    signal: &str,
) -> io::Result<serde_json::Value> {
    validate_wsl_distribution(distribution)?;
    if process_id == 0
        || !matches!(
            signal.trim().to_ascii_uppercase().as_str(),
            "HUP" | "INT" | "TERM" | "KILL"
        )
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "processId must be positive and signal must be HUP, INT, TERM, or KILL",
        ));
    }
    wsl_execute(
        distribution,
        &[
            "/bin/kill".to_owned(),
            "-s".to_owned(),
            signal.trim().to_ascii_uppercase(),
            process_id.to_string(),
        ],
    )
}

pub fn get_disk_info() -> DiskInfoListResponse {
    let disks = Disks::new_with_refreshed_list()
        .list()
        .iter()
        .map(|disk| DiskInfo {
            root: disk.mount_point().display().to_string(),
            drive_type: if disk.is_removable() {
                "Removable"
            } else {
                "Fixed"
            }
            .to_owned(),
            total_bytes: disk.total_space(),
            free_bytes: disk.available_space(),
            available_bytes: disk.available_space(),
        })
        .collect::<Vec<_>>();
    DiskInfoListResponse {
        count: disks.len(),
        disks,
    }
}

/// One value of `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion` as text (empty when absent).
fn current_version_value(name: &str) -> String {
    crate::registry::get_value(
        "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
        name,
    )
    .ok()
    .map(|value| registry_text(&value["Value"]))
    .unwrap_or_default()
}

fn registry_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Number(number) => number.to_string(),
        _ => String::new(),
    }
}

fn or_fallback(value: String, fallback: impl FnOnce() -> String) -> String {
    if value.is_empty() { fallback() } else { value }
}

pub fn get_os_info() -> OsInfo {
    OsInfo {
        product_name: System::long_os_version().unwrap_or_default(),
        edition_id: current_version_value("EditionID"),
        display_version: or_fallback(current_version_value("DisplayVersion"), || {
            System::os_version().unwrap_or_default()
        }),
        build_number: or_fallback(current_version_value("CurrentBuildNumber"), || {
            System::kernel_version().unwrap_or_default()
        }),
        ubr: current_version_value("UBR"),
        installation_type: current_version_value("InstallationType"),
        os_architecture: std::env::consts::ARCH.to_owned(),
        machine_name: System::host_name().unwrap_or_default(),
        user_name: std::env::var("USERNAME")
            .or_else(|_| std::env::var("USER"))
            .unwrap_or_default(),
    }
}

pub fn get_network_adapters() -> NetworkAdapterListResponse {
    let networks = Networks::new_with_refreshed_list();
    let adapters = networks
        .iter()
        .map(|(name, network)| NetworkAdapter {
            name: name.clone(),
            description: name.clone(),
            status: network.operational_state().to_string(),
            physical_address: network
                .mac_address()
                .0
                .iter()
                .map(|byte| format!("{byte:02X}"))
                .collect::<Vec<_>>()
                .join(""),
            speed_bps: 0,
            ip_addresses: network
                .ip_networks()
                .iter()
                .map(ToString::to_string)
                .collect(),
        })
        .collect::<Vec<_>>();
    NetworkAdapterListResponse {
        count: adapters.len(),
        adapters,
    }
}

pub fn list_tcp_connections(
    state_filter: Option<&str>,
) -> std::io::Result<TcpConnectionListResponse> {
    let filter = state_filter
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let connections: Vec<TcpConnection> = crate::tcp::connections()?
        .into_iter()
        .filter(|row| filter.is_none_or(|state| row.state.eq_ignore_ascii_case(state)))
        .collect();
    Ok(TcpConnectionListResponse {
        count: connections.len(),
        connections,
    })
}

/// Probe the ViGEmBus virtual gamepad stack without subprocesses: the driver's service key
/// (Registry API), its service state (SCM API) and `ViGEmClient.dll` on the DLL search path
/// (`SearchPathW`).
#[cfg(windows)]
pub fn gamepad_environment() -> std::io::Result<serde_json::Value> {
    let registry_exists = crate::winreg::key_exists(
        crate::registry::Hive::LocalMachine,
        r"SYSTEM\CurrentControlSet\Services\ViGEmBus",
    );
    let service_running =
        crate::services::service_status("ViGEmBus").is_ok_and(|status| status == "Running");
    let client_path = search_path("ViGEmClient.dll");
    Ok(serde_json::json!({
        "registryKeyExists": registry_exists,
        "serviceRunning": service_running,
        "clientLibraryFound": client_path.is_some(),
        "clientLibraryPath": client_path,
    }))
}

/// Full path of `file` on the standard search path (`SearchPathW` with a null path).
#[cfg(windows)]
fn search_path(file: &str) -> Option<String> {
    use windows::{Win32::Storage::FileSystem::SearchPathW, core::PCWSTR};

    let name = crate::win32::wide(file);
    let mut buffer = vec![0u16; 260];
    loop {
        // SAFETY: `name` is NUL-terminated and `buffer` is writable for its length.
        let length = unsafe {
            SearchPathW(
                PCWSTR::null(),
                crate::win32::pcwstr(&name),
                PCWSTR::null(),
                Some(&mut buffer),
                None,
            )
        } as usize;
        if length == 0 {
            return None;
        }
        if length < buffer.len() {
            return Some(crate::win32::from_wide(&buffer[..length]));
        }
        // The returned length includes the terminator when the buffer was too small.
        buffer.resize(length + 1, 0);
    }
}

/// Open a URI with its registered handler (`ShellExecuteW` "open"), e.g. `steam://`.
#[cfg(windows)]
pub fn shell_open(uri: &str) -> std::io::Result<()> {
    use windows::{
        Win32::{
            System::Com::{COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE},
            UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        },
        core::PCWSTR,
    };

    // ShellExecute may hand the URI to a shell extension, which requires COM.
    let _com = crate::win32::ComScope::enter(COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)?;
    let verb = crate::win32::wide("open");
    let target = crate::win32::wide(uri);
    // SAFETY: both strings are NUL-terminated; no parameters or working directory.
    let instance = unsafe {
        ShellExecuteW(
            None,
            crate::win32::pcwstr(&verb),
            crate::win32::pcwstr(&target),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // Values above 32 mean success; smaller values are SE_ERR_* / Win32 error codes.
    let code = instance.0 as usize;
    if code > 32 {
        Ok(())
    } else {
        let kind = match code {
            2 | 3 | 31 => std::io::ErrorKind::NotFound, // file/path not found, SE_ERR_NOASSOC
            5 => std::io::ErrorKind::PermissionDenied,
            _ => std::io::ErrorKind::Other,
        };
        Err(std::io::Error::new(
            kind,
            format!("ShellExecuteW could not open {uri} (code {code})"),
        ))
    }
}

#[cfg(not(windows))]
pub fn gamepad_environment() -> std::io::Result<serde_json::Value> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "ViGEm diagnostics are Windows-only",
    ))
}

pub fn list_listening_ports() -> std::io::Result<TcpConnectionListResponse> {
    list_tcp_connections(Some("Listen"))
}

pub fn get_system_profile() -> serde_json::Value {
    let os = get_os_info();
    let cpu = get_cpu_info();
    let memory = get_memory_info();
    serde_json::json!({
        "os": os.product_name,
        "domain": os.machine_name,
        "status": "Rust system inventory",
        "cpu": format!("{} logical / {} physical", cpu.logical_processors, cpu.physical_cores),
        "gpu": "Unavailable from portable sysinfo",
        "ram": format!("{} GB", memory.total_physical_bytes / 1024 / 1024 / 1024)
    })
}

#[cfg(test)]
mod hardware_tests {
    use super::*;

    fn cache_record(level: u8, line: u16, size: u32) -> Vec<u8> {
        let mut record = vec![0u8; 48];
        record[..4].copy_from_slice(&RELATION_CACHE.to_le_bytes());
        record[4..8].copy_from_slice(&48u32.to_le_bytes());
        record[8] = level;
        record[10..12].copy_from_slice(&line.to_le_bytes());
        record[12..16].copy_from_slice(&size.to_le_bytes());
        record
    }

    #[test]
    fn cache_totals_sum_every_instance_per_level() {
        let mut buffer = Vec::new();
        for _ in 0..2 {
            buffer.extend(cache_record(1, 64, 32 * 1024));
            buffer.extend(cache_record(1, 64, 48 * 1024));
            buffer.extend(cache_record(2, 64, 2 * 1024 * 1024));
        }
        buffer.extend(cache_record(3, 64, 30 * 1024 * 1024));
        let totals = cache_totals(&buffer);
        assert_eq!(totals.l1, 2 * (32 + 48) * 1024);
        assert_eq!(totals.l2, 4 * 1024 * 1024);
        assert_eq!(totals.l3, 30 * 1024 * 1024);
        assert_eq!(totals.line, 64);
    }

    #[test]
    fn truncated_or_empty_buffers_do_not_panic() {
        assert_eq!(cache_totals(&[]), CacheTotals::default());
        let record = cache_record(3, 64, 1024);
        assert_eq!(cache_totals(&record[..20]), CacheTotals::default());
        assert_eq!(numa_node_count(&[0u8; 4]), 0);
    }

    #[test]
    fn numa_records_are_counted() {
        let mut node = vec![0u8; 16];
        node[..4].copy_from_slice(&RELATION_NUMA_NODE.to_le_bytes());
        node[4..8].copy_from_slice(&16u32.to_le_bytes());
        assert_eq!(numa_node_count(&[node.clone(), node].concat()), 2);
    }

    #[test]
    fn registry_values_render_as_text() {
        assert_eq!(registry_text(&serde_json::json!("Core")), "Core");
        assert_eq!(registry_text(&serde_json::json!(2956)), "2956");
        assert_eq!(registry_text(&serde_json::json!(null)), "");
        assert_eq!(or_fallback(String::new(), || "x".into()), "x");
    }

    #[cfg(windows)]
    #[test]
    fn live_cpu_and_os_info_are_populated() {
        let cpu = get_cpu_info();
        assert!(cpu.l1_cache_bytes > 0 && cpu.l2_cache_bytes > 0 && cpu.l3_cache_bytes > 0);
        assert!(cpu.numa_nodes >= 1);
        let os = get_os_info();
        assert!(!os.ubr.is_empty() && os.ubr.chars().all(|c| c.is_ascii_digit()));
        assert!(!os.edition_id.is_empty() && !os.installation_type.is_empty());
        assert!(!os.build_number.is_empty());
    }
}
