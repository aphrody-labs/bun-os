// SPDX-License-Identifier: Apache-2.0
#![allow(
    clippy::too_many_arguments,
    clippy::collapsible_if,
    clippy::manual_pattern_char_comparison,
    clippy::print_literal,
    clippy::trim_split_whitespace
)]
//! Safe, scriptable SSH operations using the user's OpenSSH configuration.

use std::{collections::HashMap, path::PathBuf, process::Stdio};

use clap::{Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{
    io::AsyncWriteExt,
    process::Command,
    time::{Duration, timeout},
};

pub mod in_process;
pub mod rsync;
pub mod tunnel;

#[derive(Debug, Error)]
pub enum Error {
    #[error("ssh process failed to start: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("remote command failed with exit code {code:?}: {stderr}")]
    Remote { code: Option<i32>, stderr: String },
    #[error("invalid URL: {0}")]
    InvalidUrl(String),
    #[error("invalid argument: {0}")]
    InvalidInput(String),
    #[error("SSH command exceeded its configured timeout")]
    Timeout,
    #[error("command error: {0}")]
    Clap(#[from] clap::Error),
    #[error("catalog error: {0}")]
    Catalog(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum, Serialize, Deserialize)]
pub enum Host {
    #[value(alias = "ovh-vps")]
    Vps,
    Dbfr,
    /// Omar's Windows PC through the configured OpenSSH alias `omar-pc`.
    #[value(alias = "omar-pc")]
    Omar,
    /// Omar's Windows PC through his reverse tunnel on the vps loopback (127.0.0.1:22010).
    OmarRt,
    /// Omar's WSL Ubuntu, native OpenSSH on port 2222 (mirrored networking).
    OmarWsl,
    /// Omar's WSL Ubuntu through the reverse tunnel (127.0.0.1:22011).
    OmarWslRt,
    /// The owner's Windows workstation through the configured OpenSSH alias.
    AphroPc,
}

impl Host {
    #[must_use]
    pub const fn alias(self) -> &'static str {
        match self {
            Self::Vps => "vps",
            Self::Dbfr => "dbfr",
            Self::Omar => "omar-pc",
            Self::OmarRt => "omar-rt",
            Self::OmarWsl => "omar-wsl",
            Self::OmarWslRt => "omar-wsl-rt",
            Self::AphroPc => "aphro-pc",
        }
    }

    /// Every host, in declaration order.
    pub const ALL: [Self; 7] = [
        Self::Vps,
        Self::Dbfr,
        Self::Omar,
        Self::OmarRt,
        Self::OmarWsl,
        Self::OmarWslRt,
        Self::AphroPc,
    ];

    /// Windows OpenSSH targets: their default shell is cmd.exe, not a POSIX shell.
    #[must_use]
    pub const fn is_windows(self) -> bool {
        matches!(self, Self::Omar | Self::OmarRt | Self::AphroPc)
    }

    /// Remote interpreter that reads a long command from stdin.
    #[must_use]
    pub const fn stdin_shell(self) -> &'static [&'static str] {
        if self.is_windows() {
            &[
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "-",
            ]
        } else {
            &["bash", "-s"]
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum ServiceAction {
    Status,
    IsActive,
    IsEnabled,
    Start,
    Restart,
    Stop,
    Enable,
    Disable,
}

impl ServiceAction {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::IsActive => "is-active",
            Self::IsEnabled => "is-enabled",
            Self::Start => "start",
            Self::Restart => "restart",
            Self::Stop => "stop",
            Self::Enable => "enable",
            Self::Disable => "disable",
        }
    }
}

#[derive(Debug, Parser)]
#[command(
    name = "aphrody-ssh",
    version,
    about = "Aphrody SSH operations over configured OpenSSH aliases"
)]
pub struct Cli {
    #[arg(long, global = true, default_value_t = false)]
    pub json: bool,
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Debug, Clone, Subcommand)]
pub enum Commands {
    /// Run an arbitrary remote command through the selected SSH alias.
    /// APHRODY_SSH_COMMAND_TIMEOUT_SECS selects a finite execution deadline
    /// (1..86400 seconds; default 30), independently of connection timeout.
    Exec {
        #[arg(long, value_enum)]
        host: Host,
        /// Explicit command string (alias --cmd or --command)
        #[arg(long, visible_alias = "command", short = 'c')]
        cmd: Option<String>,
        /// Command and arguments to execute
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        command: Vec<String>,
    },
    /// Manage an SSH port-forward tunnel to a remote SOCKS5 proxy (for example a Mullvad netns).
    Proxy {
        #[arg(long, value_enum, default_value = "vps")]
        host: Host,
        /// Local port for SOCKS5 forwarding (default 1080)
        #[arg(long, default_value_t = 1080)]
        port: u16,
        /// Remote SOCKS5 endpoint (`host:port`) as seen from the SSH host. The value is owned by
        /// the aphrody-infra host catalog; no private address is built in.
        #[arg(long, env = PROXY_REMOTE_ENV)]
        remote: Option<String>,
        /// Start tunnel in background (daemon mode)
        #[arg(long, short = 'd')]
        daemon: bool,
        /// Stop background tunnel running on local port
        #[arg(long)]
        stop: bool,
        /// Probe connectivity and exit IP through local proxy port
        #[arg(long)]
        status: bool,
        /// Switch remote VPS Mullvad relay country (e.g. --switch us)
        #[arg(long)]
        switch: Option<Option<String>>,
    },
    /// Print hostname, uptime, disk, memory and load.
    Status {
        #[arg(long, value_enum)]
        host: Host,
    },
    /// List sockets listening on the remote host.
    Ports {
        #[arg(long, value_enum)]
        host: Host,
    },
    /// Read systemd logs without invoking a shell locally.
    Logs {
        #[arg(long, value_enum)]
        host: Host,
        unit: String,
        #[arg(long, default_value_t = 100)]
        lines: u16,
    },
    /// Query or mutate one systemd unit. Stop/disable require --confirm.
    Service {
        #[arg(long, value_enum)]
        host: Host,
        #[arg(long, value_enum)]
        action: ServiceAction,
        unit: String,
        #[arg(long)]
        confirm: bool,
    },
    /// Perform a HEAD health check from the remote host.
    Health {
        #[arg(long, value_enum)]
        host: Host,
        url: String,
    },
    /// Compare local repositories with their remote Git checkouts.
    Compare {
        #[arg(long, value_enum)]
        host: Host,
        #[arg(long)]
        local: PathBuf,
        #[arg(long)]
        remote: String,
    },
    /// Transfer a workspace with rclone. Dry-run is the default; generated trees stay excluded.
    Sync {
        #[arg(long, value_enum)]
        host: Host,
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        destination: String,
        #[arg(long)]
        apply: bool,
    },
    /// Collect remote telemetry: CPU%, RAM, Swap, Disk I/O, Load, Sockets, and top processes.
    Monitor {
        #[arg(long, value_enum)]
        host: Host,
        #[arg(long, default_value_t = 5)]
        top: usize,
    },
    /// Check or apply kernel, sysctl, and system limit tunings for Ubuntu/OVH host.
    Tune {
        #[arg(long, value_enum)]
        host: Host,
        #[arg(long)]
        apply: bool,
    },
    /// Comprehensive health audit checking disk usage, dead processes, swap, ports, and systemd
    /// units.
    Audit {
        #[arg(long, value_enum)]
        host: Host,
        #[arg(long, default_value = "nginx,ssh,docker,systemd-journald")]
        services: String,
    },
    /// Open local port-forwards to aphrody-infra catalog services, one `ssh -N` process per
    /// alias (foreground; Ctrl+C or any child exit stops it). See also `tunnel status`.
    Tunnel {
        #[command(flatten)]
        args: tunnel::TunnelArgs,
        #[command(subcommand)]
        action: Option<TunnelAction>,
    },
    /// In-process native SFTP exploration and remote file inspection.
    Sftp {
        #[arg(long, value_enum)]
        host: Host,
        #[arg(long, default_value = "/var/www")]
        path: String,
        /// Cat remote file content to stdout
        #[arg(long)]
        cat: Option<String>,
        /// Output recursive directory tree
        #[arg(long)]
        tree: bool,
        /// Maximum tree depth (default 3)
        #[arg(long, default_value_t = 3)]
        depth: usize,
        /// Download remote file to local path
        #[arg(long)]
        get: Option<PathBuf>,
        /// Upload local file to remote destination
        #[arg(long)]
        put: Option<PathBuf>,
        /// Enable fast-rsync differential block synchronization on upload
        #[arg(long)]
        delta: bool,
    },
}

#[derive(Debug, Clone, Subcommand)]
pub enum TunnelAction {
    /// Probe every planned local port and report up/down; exits non-zero if any is down.
    Status(tunnel::TunnelArgs),
}

#[derive(Debug, Serialize)]
pub struct Output {
    pub host: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct MemoryStats {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub available_bytes: u64,
    pub usage_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct LoadAverage {
    pub one_minute: f64,
    pub five_minute: f64,
    pub fifteen_minute: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct DiskIoStat {
    pub device: String,
    pub reads_completed: u64,
    pub sectors_read: u64,
    pub writes_completed: u64,
    pub sectors_written: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct NetworkSocketsSummary {
    pub total_sockets: u32,
    pub tcp_established: u32,
    pub tcp_timewait: u32,
    pub tcp_closed: u32,
    pub raw_summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ProcessStat {
    pub pid: u32,
    pub user: String,
    pub cpu_percent: f32,
    pub mem_percent: f32,
    pub status: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MonitorReport {
    pub host: String,
    pub cpu_usage_percent: f64,
    pub ram: MemoryStats,
    pub swap: MemoryStats,
    pub load_average: LoadAverage,
    pub disk_io: Vec<DiskIoStat>,
    pub network_sockets: NetworkSocketsSummary,
    pub top_processes: Vec<ProcessStat>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TuneStatus {
    Optimal,
    NeedsUpdate,
    Missing,
}

pub struct SysctlTarget {
    pub key: &'static str,
    pub recommended: &'static str,
    pub category: &'static str,
    pub rationale: &'static str,
}

pub const SYSCTL_TARGETS: &[SysctlTarget] = &[
    SysctlTarget {
        key: "net.core.somaxconn",
        recommended: "65535",
        category: "network",
        rationale: "Increase listen queue backlog for high concurrency web workloads",
    },
    SysctlTarget {
        key: "net.ipv4.tcp_max_syn_backlog",
        recommended: "16384",
        category: "network",
        rationale: "Resilience against SYN flood attacks and burst connections",
    },
    SysctlTarget {
        key: "net.ipv4.tcp_fin_timeout",
        recommended: "15",
        category: "network",
        rationale: "Fast recycling of sockets in FIN-WAIT-2 state",
    },
    SysctlTarget {
        key: "net.ipv4.tcp_tw_reuse",
        recommended: "1",
        category: "network",
        rationale: "Allow reuse of TIME-WAIT sockets for outbound connections",
    },
    SysctlTarget {
        key: "net.core.rmem_max",
        recommended: "16777216",
        category: "network",
        rationale: "Maximum TCP receive buffer window size (16MB)",
    },
    SysctlTarget {
        key: "net.core.wmem_max",
        recommended: "16777216",
        category: "network",
        rationale: "Maximum TCP send buffer window size (16MB)",
    },
    SysctlTarget {
        key: "net.ipv4.ip_local_port_range",
        recommended: "10240 65535",
        category: "network",
        rationale: "Expanded ephemeral port range for reverse proxies and outbound traffic",
    },
    SysctlTarget {
        key: "net.ipv4.tcp_slow_start_after_idle",
        recommended: "0",
        category: "network",
        rationale: "Prevent TCP congestion window reset after idle periods",
    },
    SysctlTarget {
        key: "vm.swappiness",
        recommended: "10",
        category: "memory",
        rationale: "Prevent aggressive swap thrashing and prioritize active process RAM",
    },
    SysctlTarget {
        key: "vm.vfs_cache_pressure",
        recommended: "50",
        category: "memory",
        rationale: "Retain directory and inode caches longer in RAM",
    },
    SysctlTarget {
        key: "vm.page-cluster",
        recommended: "0",
        category: "memory",
        rationale: "Swap in single pages; readahead only hurts on zram",
    },
    SysctlTarget {
        key: "vm.dirty_ratio",
        recommended: "10",
        category: "memory",
        rationale: "Flush dirty pages to disk before reaching 10% of memory",
    },
    SysctlTarget {
        key: "vm.dirty_background_ratio",
        recommended: "5",
        category: "memory",
        rationale: "Begin background writeback at 5% of memory",
    },
    SysctlTarget {
        key: "fs.file-max",
        recommended: "2097152",
        category: "filesystem",
        rationale: "System-wide maximum file descriptor allocation",
    },
    SysctlTarget {
        key: "fs.inotify.max_user_watches",
        recommended: "1048576",
        category: "filesystem",
        rationale: "Prevent inotify watcher exhaustion during large builds and monitoring",
    },
    SysctlTarget {
        key: "fs.inotify.max_user_instances",
        recommended: "8192",
        category: "filesystem",
        rationale: "Increased maximum inotify client instances",
    },
    SysctlTarget {
        key: "net.ipv6.conf.all.forwarding",
        recommended: "0",
        category: "network",
        rationale: "Forwarding disables accept_ra and drops the SLAAC IPv6 route on OVH uplinks",
    },
];

/// Values follow the Aphrody Alpine server profile (91-aphrody-server.conf); hosts short on
/// RAM override the memory keys.
/// The vps keeps a static IPv6 route (accept_ra = 0) and forwards for Docker and WireGuard.
pub const SYSCTL_HOST_OVERRIDES: &[(&str, &str, &str)] = &[
    ("dbfr", "vm.swappiness", "20"),
    ("dbfr", "vm.vfs_cache_pressure", "100"),
    ("vps", "net.ipv6.conf.all.forwarding", "1"),
];

/// Capacity limits: a higher current value already satisfies the target and is never lowered.
const SYSCTL_FLOOR_KEYS: &[&str] = &[
    "net.core.somaxconn",
    "net.ipv4.tcp_max_syn_backlog",
    "net.core.rmem_max",
    "net.core.wmem_max",
    "fs.file-max",
    "fs.inotify.max_user_watches",
    "fs.inotify.max_user_instances",
];

fn normalize_sysctl_value(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sysctl_satisfies(key: &str, current: &str, recommended: &str) -> bool {
    if current == recommended {
        return true;
    }
    SYSCTL_FLOOR_KEYS.contains(&key)
        && matches!(
            (current.parse::<u64>(), recommended.parse::<u64>()),
            (Ok(c), Ok(r)) if c >= r
        )
}

pub const TUNE_SYSCTL_PATH: &str = "/etc/sysctl.d/95-aphrody-tune.conf";
const LEGACY_TUNE_SYSCTL_PATH: &str = "/etc/sysctl.d/99-aphrody-tuning.conf";

pub fn recommended_sysctl(host: &str, target: &SysctlTarget) -> &'static str {
    SYSCTL_HOST_OVERRIDES
        .iter()
        .find(|(h, k, _)| *h == host && *k == target.key)
        .map_or(target.recommended, |(_, _, v)| v)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TuneItem {
    pub key: String,
    pub current_value: String,
    pub recommended_value: String,
    pub status: TuneStatus,
    pub category: String,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TunePlan {
    pub host: String,
    pub apply: bool,
    pub items: Vec<TuneItem>,
    pub changes_required: usize,
    pub sysctl_config: String,
    pub limits_config: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuditHealthStatus {
    Healthy,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiskAudit {
    pub filesystem: String,
    pub mount: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub usage_percent: f64,
    pub warning: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ZombieProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProcessAudit {
    pub total_processes: usize,
    pub zombie_processes: Vec<ZombieProcessInfo>,
    pub warning: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SwapAudit {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: f64,
    pub warning: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PortAudit {
    pub proto: String,
    pub local_address: String,
    pub port: u16,
    pub process: String,
    pub is_public: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServiceAudit {
    pub unit: String,
    pub state: String,
    pub sub_state: String,
    pub healthy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuditReport {
    pub host: String,
    pub status: AuditHealthStatus,
    pub disk: Vec<DiskAudit>,
    pub ram: MemoryStats,
    pub process: ProcessAudit,
    pub swap: SwapAudit,
    pub ports: Vec<PortAudit>,
    pub services: Vec<ServiceAudit>,
    pub failed_units: Vec<String>,
    pub findings: Vec<String>,
}

pub fn validate_unit(unit: &str) -> Result<(), Error> {
    if unit.is_empty()
        || !unit
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".@:_-".contains(c))
    {
        return Err(Error::Remote {
            code: None,
            stderr: "invalid systemd unit".into(),
        });
    }
    Ok(())
}

pub fn validate_url(url: &str) -> Result<(), Error> {
    if !(url.starts_with("https://") || url.starts_with("http://"))
        || !url
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ":/?#[]@!$&()*+,;=%._~-".contains(c))
    {
        return Err(Error::InvalidUrl(url.into()));
    }
    Ok(())
}

pub fn validate_services_arg(services: &str) -> Result<(), Error> {
    if services.is_empty() {
        return Ok(());
    }
    for item in services.split(|c| c == ',' || c == ' ') {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".@:_-".contains(c))
        {
            return Err(Error::InvalidInput(format!(
                "invalid service name in list: {trimmed}"
            )));
        }
    }
    Ok(())
}

pub fn extract_sections(raw: &str) -> HashMap<String, String> {
    let mut sections = HashMap::new();
    let mut current_section: Option<String> = None;
    let mut buffer = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("===") && trimmed.ends_with("===") && trimmed.len() > 6 {
            if let Some(sec) = current_section.take() {
                sections.insert(sec, buffer.join("\n"));
                buffer.clear();
            }
            let name = trimmed.trim_matches('=').trim().to_string();
            current_section = Some(name);
        } else if current_section.is_some() {
            buffer.push(line);
        }
    }
    if let Some(sec) = current_section {
        sections.insert(sec, buffer.join("\n"));
    }
    sections
}

pub fn parse_loadavg(raw: &str) -> LoadAverage {
    for line in raw.lines() {
        let trimmed = line.trim();
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 3 {
            if let (Ok(m1), Ok(m5), Ok(m15)) = (
                parts[0].parse::<f64>(),
                parts[1].parse::<f64>(),
                parts[2].parse::<f64>(),
            ) {
                return LoadAverage {
                    one_minute: m1,
                    five_minute: m5,
                    fifteen_minute: m15,
                };
            }
        }
        if let Some(idx) = trimmed.find("load average:") {
            let rest = &trimmed[idx + "load average:".len()..];
            let nums: Vec<f64> = rest
                .split(',')
                .filter_map(|s| s.trim().split_whitespace().next()?.parse::<f64>().ok())
                .collect();
            if nums.len() >= 3 {
                return LoadAverage {
                    one_minute: nums[0],
                    five_minute: nums[1],
                    fifteen_minute: nums[2],
                };
            }
        }
    }
    LoadAverage::default()
}

pub fn parse_meminfo(raw: &str) -> (MemoryStats, MemoryStats) {
    let mut map: HashMap<&str, u64> = HashMap::new();
    for line in raw.lines() {
        let mut parts = line.split(':');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            let key = k.trim();
            let val_kb = v
                .split_whitespace()
                .next()
                .and_then(|n| n.parse::<u64>().ok())
                .unwrap_or(0);
            map.insert(key, val_kb * 1024);
        }
    }
    let total = *map.get("MemTotal").unwrap_or(&0);
    let free = *map.get("MemFree").unwrap_or(&0);
    let available = map.get("MemAvailable").copied().unwrap_or_else(|| {
        let buffers = map.get("Buffers").copied().unwrap_or(0);
        let cached = map.get("Cached").copied().unwrap_or(0);
        (free + buffers + cached).min(total)
    });
    let used = total.saturating_sub(available);
    let usage_percent = if total > 0 {
        (used as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    let ram = MemoryStats {
        total_bytes: total,
        used_bytes: used,
        free_bytes: free,
        available_bytes: available,
        usage_percent: (usage_percent * 10.0).round() / 10.0,
    };

    let swap_total = *map.get("SwapTotal").unwrap_or(&0);
    let swap_free = *map.get("SwapFree").unwrap_or(&0);
    let swap_used = swap_total.saturating_sub(swap_free);
    let swap_percent = if swap_total > 0 {
        (swap_used as f64 / swap_total as f64) * 100.0
    } else {
        0.0
    };

    let swap = MemoryStats {
        total_bytes: swap_total,
        used_bytes: swap_used,
        free_bytes: swap_free,
        available_bytes: swap_free,
        usage_percent: (swap_percent * 10.0).round() / 10.0,
    };

    (ram, swap)
}

pub fn parse_cpu_stat(raw: &str) -> f64 {
    let lines: Vec<&str> = raw.lines().filter(|l| l.starts_with("cpu ")).collect();
    if lines.is_empty() {
        return 0.0;
    }
    let parse_line = |l: &str| -> Option<(u64, u64)> {
        let parts: Vec<u64> = l
            .split_whitespace()
            .skip(1)
            .filter_map(|p| p.parse().ok())
            .collect();
        if parts.len() < 4 {
            return None;
        }
        let idle = parts[3] + parts.get(4).copied().unwrap_or(0);
        let total: u64 = parts.iter().sum();
        Some((idle, total))
    };

    if lines.len() >= 2 {
        if let (Some((idle1, total1)), Some((idle2, total2))) =
            (parse_line(lines[0]), parse_line(lines[1]))
        {
            let d_total = total2.saturating_sub(total1);
            let d_idle = idle2.saturating_sub(idle1);
            if d_total > 0 {
                let usage = (1.0 - (d_idle as f64 / d_total as f64)) * 100.0;
                return (usage.clamp(0.0, 100.0) * 10.0).round() / 10.0;
            }
        }
    }
    if let Some((idle, total)) = parse_line(lines[0]) {
        if total > 0 {
            let usage = (1.0 - (idle as f64 / total as f64)) * 100.0;
            return (usage.clamp(0.0, 100.0) * 10.0).round() / 10.0;
        }
    }
    0.0
}

pub fn parse_diskstats(raw: &str) -> Vec<DiskIoStat> {
    let mut stats = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 10 {
            continue;
        }
        let dev = parts[2];
        if dev.starts_with("loop") || dev.starts_with("ram") || dev.starts_with("sr") {
            continue;
        }
        let reads_completed = parts[3].parse().unwrap_or(0);
        let sectors_read = parts[5].parse().unwrap_or(0);
        let writes_completed = parts[7].parse().unwrap_or(0);
        let sectors_written = parts[9].parse().unwrap_or(0);

        stats.push(DiskIoStat {
            device: dev.to_string(),
            reads_completed,
            sectors_read,
            writes_completed,
            sectors_written,
        });
    }
    stats
}

pub fn parse_sockets(raw: &str) -> NetworkSocketsSummary {
    let mut total = 0;
    let mut established = 0;
    let mut timewait = 0;
    let mut closed = 0;

    for line in raw.lines() {
        let line_lower = line.to_lowercase();
        if line_lower.starts_with("total:") {
            if let Some(num) = line.split_whitespace().nth(1) {
                total = num.parse().unwrap_or(0);
            }
        } else if line_lower.starts_with("tcp:") {
            for token in line.split(|c| c == '(' || c == ')' || c == ',') {
                let parts: Vec<&str> = token.split_whitespace().collect();
                if parts.len() >= 2 {
                    match parts[0] {
                        "estab" => established = parts[1].parse().unwrap_or(0),
                        "timewait" => timewait = parts[1].parse().unwrap_or(0),
                        "closed" => closed = parts[1].parse().unwrap_or(0),
                        _ => {}
                    }
                }
            }
        }
    }

    NetworkSocketsSummary {
        total_sockets: total,
        tcp_established: established,
        tcp_timewait: timewait,
        tcp_closed: closed,
        raw_summary: raw.trim().lines().take(3).collect::<Vec<_>>().join(" | "),
    }
}

pub fn parse_top_processes(raw: &str, limit: usize) -> Vec<ProcessStat> {
    let mut procs = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("PID") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 6 {
            continue;
        }
        let pid = match parts[0].parse::<u32>() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let user = parts[1].to_string();
        let cpu_percent = parts[2].parse::<f32>().unwrap_or(0.0);
        let mem_percent = parts[3].parse::<f32>().unwrap_or(0.0);
        let status = parts[4].to_string();
        let command = parts[5..].join(" ");

        procs.push(ProcessStat {
            pid,
            user,
            cpu_percent,
            mem_percent,
            status,
            command,
        });
        if procs.len() >= limit {
            break;
        }
    }
    procs
}

pub fn parse_monitor_raw(host: &str, raw: &str, top: usize) -> MonitorReport {
    let sections = extract_sections(raw);
    let load_average = sections
        .get("LOADAVG")
        .map(|s| parse_loadavg(s))
        .unwrap_or_default();
    let (ram, swap) = sections
        .get("MEMINFO")
        .map(|s| parse_meminfo(s))
        .unwrap_or_default();
    let cpu_usage_percent = sections
        .get("CPU")
        .map(|s| parse_cpu_stat(s))
        .unwrap_or(0.0);
    let disk_io = sections
        .get("DISKIO")
        .map(|s| parse_diskstats(s))
        .unwrap_or_default();
    let network_sockets = sections
        .get("SOCKETS")
        .map(|s| parse_sockets(s))
        .unwrap_or_default();
    let top_processes = sections
        .get("TOP")
        .map(|s| parse_top_processes(s, top))
        .unwrap_or_default();

    MonitorReport {
        host: host.to_string(),
        cpu_usage_percent,
        ram,
        swap,
        load_average,
        disk_io,
        network_sockets,
        top_processes,
    }
}

pub fn parse_sysctl_query(host: &str, raw: &str, apply: bool) -> TunePlan {
    let mut current_map = HashMap::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some((k, v)) = trimmed.split_once('=') {
            current_map.insert(k.trim().to_string(), normalize_sysctl_value(v));
        }
    }

    let mut items = Vec::new();
    let mut changes_required = 0;

    for target in SYSCTL_TARGETS {
        let current_value = current_map
            .get(target.key)
            .cloned()
            .unwrap_or_else(|| "MISSING".to_string());

        let recommended = recommended_sysctl(host, target);
        let status = if sysctl_satisfies(target.key, &current_value, recommended) {
            TuneStatus::Optimal
        } else if current_value == "MISSING" {
            changes_required += 1;
            TuneStatus::Missing
        } else {
            changes_required += 1;
            TuneStatus::NeedsUpdate
        };

        items.push(TuneItem {
            key: target.key.to_string(),
            current_value,
            recommended_value: recommended.to_string(),
            status,
            category: target.category.to_string(),
            rationale: target.rationale.to_string(),
        });
    }

    let mut plan = TunePlan {
        host: host.to_string(),
        apply,
        items,
        changes_required,
        sysctl_config: String::new(),
        limits_config: generate_limits_conf(),
    };
    plan.sysctl_config = generate_sysctl_conf(&plan);
    plan
}

pub fn generate_sysctl_conf_from_targets(host: &str) -> String {
    let mut out = format!("# {TUNE_SYSCTL_PATH}\n# Generated by aphrody-ssh tune for {host}\n\n");
    for target in SYSCTL_TARGETS {
        out.push_str(&format!(
            "# {}\n{} = {}\n\n",
            target.rationale,
            target.key,
            recommended_sysctl(host, target)
        ));
    }
    out
}

pub fn generate_sysctl_conf(plan: &TunePlan) -> String {
    let mut out = format!(
        "# {TUNE_SYSCTL_PATH}\n# Generated by aphrody-ssh tune for {}\n\n",
        plan.host
    );
    for target in SYSCTL_TARGETS {
        let recommended = recommended_sysctl(&plan.host, target);
        let value = plan
            .items
            .iter()
            .find(|i| i.key == target.key)
            .filter(|i| sysctl_satisfies(target.key, &i.current_value, recommended))
            .map_or(recommended, |i| i.current_value.as_str());
        out.push_str(&format!(
            "# {}\n{} = {}\n\n",
            target.rationale, target.key, value
        ));
    }
    out
}

pub fn generate_limits_conf() -> String {
    String::from(
        "# /etc/security/limits.d/99-aphrody.conf\n# Generated by aphrody-ssh tune\n* soft nofile \
         1048576\n* hard nofile 1048576\n* soft nproc 65535\n* hard nproc 65535\nroot soft nofile \
         1048576\nroot hard nofile 1048576\n",
    )
}

pub fn generate_tune_apply_script(plan: &TunePlan) -> String {
    let sysctl_content = &plan.sysctl_config;
    let limits_content = &plan.limits_config;
    format!(
        "set -e\nsudo mkdir -p /etc/sysctl.d /etc/security/limits.d /var/backups/aphrody-sysctl\n\
         if [ -e {LEGACY_TUNE_SYSCTL_PATH} ]; then sudo mv {LEGACY_TUNE_SYSCTL_PATH} \
         /var/backups/aphrody-sysctl/; fi\ncat << 'EOF' | sudo tee {TUNE_SYSCTL_PATH} > \
         /dev/null\n{sysctl_content}EOF\ncat << 'EOF' | sudo tee \
         /etc/security/limits.d/99-aphrody.conf > /dev/null\n{limits_content}EOF\nsudo sysctl \
         --system > /dev/null"
    )
}

pub fn parse_audit_raw(host: &str, raw: &str) -> AuditReport {
    let sections = extract_sections(raw);

    // 1. Disk usage
    let mut disk = Vec::new();
    if let Some(disk_raw) = sections.get("DISK") {
        for line in disk_raw.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 6 || parts[0].starts_with("Filesystem") {
                continue;
            }
            let filesystem = parts[0].to_string();
            let total_bytes = parts[1].parse::<u64>().unwrap_or(0);
            let used_bytes = parts[2].parse::<u64>().unwrap_or(0);
            let free_bytes = parts[3].parse::<u64>().unwrap_or(0);
            let usage_str = parts[4].trim_end_matches('%');
            let usage_percent = usage_str.parse::<f64>().unwrap_or(0.0);
            let mount = parts[5].to_string();

            if filesystem.starts_with("/dev/")
                || mount == "/"
                || mount.starts_with("/home")
                || mount.starts_with("/var")
            {
                let warning = usage_percent >= 85.0;
                disk.push(DiskAudit {
                    filesystem,
                    mount,
                    total_bytes,
                    used_bytes,
                    free_bytes,
                    usage_percent,
                    warning,
                });
            }
        }
    }

    // 2. Processes & Zombies
    let mut total_processes = 0;
    let mut zombie_processes = Vec::new();
    if let Some(proc_raw) = sections.get("PROCESSES") {
        for line in proc_raw.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                continue;
            }
            total_processes += 1;
            let pid = parts[0].parse::<u32>().unwrap_or(0);
            let ppid = parts[1].parse::<u32>().unwrap_or(0);
            let stat = parts[2];
            let cmd = parts[3..].join(" ");

            if stat.contains('Z') || stat.contains('X') || cmd.contains("defunct") {
                zombie_processes.push(ZombieProcessInfo {
                    pid,
                    ppid,
                    command: cmd,
                });
            }
        }
    }
    let process = ProcessAudit {
        total_processes,
        warning: !zombie_processes.is_empty(),
        zombie_processes,
    };

    // 3. Memory & Swap
    let (ram, mem_swap) = sections
        .get("MEMINFO")
        .map(|s| parse_meminfo(s))
        .unwrap_or_default();
    let swap = SwapAudit {
        total_bytes: mem_swap.total_bytes,
        used_bytes: mem_swap.used_bytes,
        usage_percent: mem_swap.usage_percent,
        warning: mem_swap.total_bytes > 0 && mem_swap.usage_percent >= 50.0,
    };

    // 4. Ports
    let mut ports = Vec::new();
    if let Some(ports_raw) = sections.get("PORTS") {
        for line in ports_raw.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 5 {
                continue;
            }
            let proto = parts[0].to_string();
            let local_addr_port = parts[4];
            let (addr, port_str) = local_addr_port
                .rsplit_once(':')
                .unwrap_or((local_addr_port, "0"));
            let port = port_str.parse::<u16>().unwrap_or(0);
            let is_public = addr == "0.0.0.0" || addr == "*" || addr == "::" || addr == "[::]";
            let process = if parts.len() >= 7 {
                parts[6..].join(" ")
            } else {
                String::new()
            };

            ports.push(PortAudit {
                proto,
                local_address: addr.to_string(),
                port,
                process,
                is_public,
            });
        }
    }

    // 5. Failed units
    let mut failed_units = Vec::new();
    if let Some(failed_raw) = sections.get("FAILED_UNITS") {
        for line in failed_raw.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                if let Some(unit) = trimmed.split_whitespace().next() {
                    failed_units.push(unit.to_string());
                }
            }
        }
    }

    // 6. Monitored Services
    let mut services = Vec::new();
    if let Some(svc_raw) = sections.get("SERVICES") {
        for line in svc_raw.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let unit = parts[0].to_string();
                let state = parts[1].to_string();
                let sub_state = if parts.len() >= 3 {
                    parts[2].to_string()
                } else {
                    "unknown".to_string()
                };
                let healthy = state == "active";
                services.push(ServiceAudit {
                    unit,
                    state,
                    sub_state,
                    healthy,
                });
            }
        }
    }

    // 7. Overall Health Status & Findings
    let mut findings = Vec::new();
    let mut status = AuditHealthStatus::Healthy;

    for d in &disk {
        if d.usage_percent >= 95.0 {
            status = AuditHealthStatus::Critical;
            findings.push(format!(
                "CRITICAL: Disk partition {} mounted on {} is at {:.1}% capacity",
                d.filesystem, d.mount, d.usage_percent
            ));
        } else if d.usage_percent >= 85.0 {
            if status != AuditHealthStatus::Critical {
                status = AuditHealthStatus::Warning;
            }
            findings.push(format!(
                "WARNING: Disk partition {} mounted on {} is at {:.1}% capacity",
                d.filesystem, d.mount, d.usage_percent
            ));
        }
    }

    if swap.warning {
        if swap.usage_percent >= 80.0 {
            status = AuditHealthStatus::Critical;
            findings.push(format!(
                "CRITICAL: Severe swap exhaustion at {:.1}% ({:.1} MB used)",
                swap.usage_percent,
                swap.used_bytes as f64 / 1_048_576.0
            ));
        } else {
            if status != AuditHealthStatus::Critical {
                status = AuditHealthStatus::Warning;
            }
            findings.push(format!(
                "WARNING: Elevated swap usage at {:.1}% ({:.1} MB used)",
                swap.usage_percent,
                swap.used_bytes as f64 / 1_048_576.0
            ));
        }
    }

    if !process.zombie_processes.is_empty() {
        let pids: Vec<u32> = process.zombie_processes.iter().map(|z| z.pid).collect();
        if process.zombie_processes.len() >= 10 {
            status = AuditHealthStatus::Critical;
            findings.push(format!(
                "CRITICAL: High zombie process count ({}) detected. PIDs: {:?}",
                process.zombie_processes.len(),
                pids
            ));
        } else {
            if status != AuditHealthStatus::Critical {
                status = AuditHealthStatus::Warning;
            }
            findings.push(format!(
                "WARNING: {} zombie/dead process(es) detected. PIDs: {:?}",
                process.zombie_processes.len(),
                pids
            ));
        }
    }

    if !failed_units.is_empty() {
        if status != AuditHealthStatus::Critical {
            status = AuditHealthStatus::Warning;
        }
        findings.push(format!(
            "WARNING: {} failed systemd unit(s): {}",
            failed_units.len(),
            failed_units.join(", ")
        ));
    }

    for svc in &services {
        if !svc.healthy {
            if status != AuditHealthStatus::Critical {
                status = AuditHealthStatus::Warning;
            }
            findings.push(format!(
                "WARNING: Monitored service '{}' is not active (state: {}, sub: {})",
                svc.unit, svc.state, svc.sub_state
            ));
        }
    }

    if findings.is_empty() {
        findings.push("All system health metrics are within optimal parameters.".into());
    }

    AuditReport {
        host: host.to_string(),
        status,
        disk,
        ram,
        process,
        swap,
        ports,
        services,
        failed_units,
        findings,
    }
}

pub fn monitor_command(top: usize) -> String {
    let top_lines = top.clamp(1, 100) + 1;
    format!(
        "bash -c 'echo \"===LOADAVG===\"; cat /proc/loadavg 2>/dev/null || uptime; echo \
         \"===MEMINFO===\"; cat /proc/meminfo 2>/dev/null; echo \"===CPU===\"; grep \"^cpu \" \
         /proc/stat 2>/dev/null; sleep 0.15; grep \"^cpu \" /proc/stat 2>/dev/null; echo \
         \"===DISKIO===\"; cat /proc/diskstats 2>/dev/null; echo \"===SOCKETS===\"; ss -s \
         2>/dev/null; echo \"===TOP===\"; ps -eo pid,user,%cpu,%mem,stat,comm --sort=-%cpu \
         2>/dev/null | head -n {top_lines}'"
    )
}

pub fn tune_query_command() -> String {
    let keys = SYSCTL_TARGETS
        .iter()
        .map(|t| t.key)
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "bash -c 'for k in {keys}; do v=$(sysctl -n \"$k\" 2>/dev/null || echo \"MISSING\"); echo \
         \"$k=$v\"; done'"
    )
}

pub fn audit_command(services: &[&str]) -> String {
    let svc_list = services.join(" ");
    format!(
        "bash -c 'echo \"===DISK===\"; df -B1 -P 2>/dev/null; echo \"===PROCESSES===\"; ps -eo \
         pid,ppid,stat,comm --no-headers 2>/dev/null; echo \"===MEMINFO===\"; cat /proc/meminfo \
         2>/dev/null; echo \"===PORTS===\"; ss -lntu -H 2>/dev/null; echo \"===FAILED_UNITS===\"; \
         systemctl --failed --no-legend --plain 2>/dev/null; echo \"===SERVICES===\"; for s in \
         {svc_list}; do if [ -n \"$s\" ]; then st=$(systemctl is-active \"$s\" 2>/dev/null || \
         echo \"unknown\"); sub=$(systemctl show -p SubState --value \"$s\" 2>/dev/null || echo \
         \"unknown\"); echo \"$s $st $sub\"; fi; done'"
    )
}

/// Remote commands longer than this go through stdin: Win32-OpenSSH truncates the command
/// argument near 8 KiB (a 10 KiB build-factory script arrived as 8169 bytes on 2026-10-09).
const MAX_ARGUMENT_COMMAND: usize = 4096;

/// The script to feed to the remote stdin shell ([`Host::stdin_shell`]) when the joined command is too long for an argument.
fn stdin_script(args: &[&str]) -> Option<String> {
    let joined = args.join(" ");
    (joined.len() > MAX_ARGUMENT_COMMAND).then(|| {
        format!(
            "{joined}
"
        )
    })
}

/// Parse the finite native SSH execution timeout without modifying environment.
pub fn command_timeout_seconds(value: Option<&str>) -> Result<u64, Error> {
    let Some(value) = value else { return Ok(30) };
    let seconds = value.parse::<u64>().map_err(|_| {
        Error::InvalidInput(
            "APHRODY_SSH_COMMAND_TIMEOUT_SECS must be an integer from 1 through 86400".into(),
        )
    })?;
    if !(1..=86_400).contains(&seconds) {
        return Err(Error::InvalidInput(
            "APHRODY_SSH_COMMAND_TIMEOUT_SECS must be an integer from 1 through 86400".into(),
        ));
    }
    Ok(seconds)
}

/// Factory dispatch selects a longer finite timeout on the calling process
/// with APHRODY_SSH_COMMAND_TIMEOUT_SECS. Inspections default to thirty seconds.
pub async fn run_ssh(host: Host, args: &[&str]) -> Result<Output, Error> {
    let configured_timeout = match std::env::var("APHRODY_SSH_COMMAND_TIMEOUT_SECS") {
        Ok(value) => Some(value),
        Err(std::env::VarError::NotPresent) => None,
        Err(std::env::VarError::NotUnicode(_)) => {
            return Err(Error::InvalidInput(
                "APHRODY_SSH_COMMAND_TIMEOUT_SECS must be UTF-8".into(),
            ));
        }
    };
    let seconds = command_timeout_seconds(configured_timeout.as_deref())?;
    let script = stdin_script(args);
    let mut command = Command::new("ssh");
    command
        .args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"])
        .arg(host.alias());
    match &script {
        Some(_) => command.args(host.stdin_shell()).stdin(Stdio::piped()),
        None => command.args(args),
    };
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    if let (Some(script), Some(mut stdin)) = (script, child.stdin.take()) {
        stdin.write_all(script.as_bytes()).await?;
    }
    let output = timeout(Duration::from_secs(seconds), child.wait_with_output())
        .await
        .map_err(|_| Error::Timeout)??;
    let result = Output {
        host: host.alias().into(),
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    };
    if !output.status.success() {
        // Keep the remote stdout too: commands often redirect their diagnostics there (`2>&1`).
        let stderr = match (result.stdout.trim(), result.stderr.trim()) {
            ("", err) => err.to_owned(),
            (out, "") => out.to_owned(),
            (out, err) => format!("{out}\n{err}"),
        };
        return Err(Error::Remote {
            code: result.exit_code,
            stderr,
        });
    }
    Ok(result)
}

pub async fn local_git(path: &std::path::Path) -> Result<String, Error> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["status", "--short", "--branch"])
        .output()
        .await?;
    if !output.status.success() {
        return Err(Error::Remote {
            code: output.status.code(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().into(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub fn render(result: Output, json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&result).expect("serializable")
        );
    } else {
        print!("{}", result.stdout);
        if !result.stderr.is_empty() {
            eprint!("{}", result.stderr);
        }
    }
}

pub fn render_monitor(report: &MonitorReport, json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(report).expect("serializable")
        );
        return;
    }
    println!("=== APHRODY TELEMETRY MONITOR [{}] ===", report.host);
    println!("CPU Usage:        {:.1}%", report.cpu_usage_percent);
    println!(
        "Load Average:     1m: {:.2}, 5m: {:.2}, 15m: {:.2}",
        report.load_average.one_minute,
        report.load_average.five_minute,
        report.load_average.fifteen_minute
    );
    println!(
        "RAM Usage:        {:.2} GB / {:.2} GB ({:.1}%) [Available: {:.2} GB]",
        report.ram.used_bytes as f64 / 1_073_741_824.0,
        report.ram.total_bytes as f64 / 1_073_741_824.0,
        report.ram.usage_percent,
        report.ram.available_bytes as f64 / 1_073_741_824.0
    );
    if report.swap.total_bytes > 0 {
        println!(
            "Swap Usage:       {:.2} GB / {:.2} GB ({:.1}%)",
            report.swap.used_bytes as f64 / 1_073_741_824.0,
            report.swap.total_bytes as f64 / 1_073_741_824.0,
            report.swap.usage_percent
        );
    } else {
        println!("Swap Usage:       Disabled / None");
    }
    println!(
        "Network Sockets:  Total: {}, TCP Estab: {}, Timewait: {}, Closed: {}",
        report.network_sockets.total_sockets,
        report.network_sockets.tcp_established,
        report.network_sockets.tcp_timewait,
        report.network_sockets.tcp_closed
    );
    if !report.disk_io.is_empty() {
        println!("\nDisk I/O Statistics:");
        for io in &report.disk_io {
            println!(
                "  - {:<10} Reads: {:<8} (sectors: {:<10}) Writes: {:<8} (sectors: {:<10})",
                io.device,
                io.reads_completed,
                io.sectors_read,
                io.writes_completed,
                io.sectors_written
            );
        }
    }
    if !report.top_processes.is_empty() {
        println!("\nTop Processes:");
        println!(
            "  {:<6} {:<12} {:<6} {:<6} {:<5} {}",
            "PID", "USER", "%CPU", "%MEM", "STAT", "COMMAND"
        );
        for p in &report.top_processes {
            println!(
                "  {:<6} {:<12} {:<6.1} {:<6.1} {:<5} {}",
                p.pid, p.user, p.cpu_percent, p.mem_percent, p.status, p.command
            );
        }
    }
}

pub fn render_tune(plan: &TunePlan, json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(plan).expect("serializable")
        );
        return;
    }
    println!("=== APHRODY SYSTEM TUNING [{}] ===", plan.host);
    println!(
        "Mode:                  {}",
        if plan.apply {
            "APPLY (Changes committed)"
        } else {
            "DRY-RUN (Planning only)"
        }
    );
    println!("Pending Modifications: {}", plan.changes_required);
    println!();
    println!(
        "{:<36} {:<15} {:<15} {:<14} {}",
        "PARAMETER", "CURRENT", "RECOMMENDED", "STATUS", "CATEGORY"
    );
    println!("{}", "-".repeat(95));
    for item in &plan.items {
        let status_str = match item.status {
            TuneStatus::Optimal => "OPTIMAL",
            TuneStatus::NeedsUpdate => "NEEDS_UPDATE",
            TuneStatus::Missing => "MISSING",
        };
        println!(
            "{:<36} {:<15} {:<15} {:<14} {}",
            item.key, item.current_value, item.recommended_value, status_str, item.category
        );
    }
    println!();
    if plan.apply {
        println!(
            "Configuration written to {TUNE_SYSCTL_PATH} and /etc/security/limits.d/99-aphrody.conf"
        );
        println!("Sysctl parameters successfully reloaded via `sysctl --system`.");
    } else {
        println!(
            "Run with `--apply` to apply these kernel parameters and limits to the remote host."
        );
    }
}

pub fn render_audit(report: &AuditReport, json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(report).expect("serializable")
        );
        return;
    }
    let status_badge = match report.status {
        AuditHealthStatus::Healthy => "[HEALTHY]",
        AuditHealthStatus::Warning => "[WARNING]",
        AuditHealthStatus::Critical => "[CRITICAL]",
    };
    println!(
        "=== APHRODY HOST AUDIT [{}] {} ===",
        report.host, status_badge
    );
    println!();
    println!("[DISK USAGE]");
    if report.disk.is_empty() {
        println!("  No active mount points detected.");
    } else {
        for d in &report.disk {
            let flag = if d.warning { "! WARNING" } else { "OK" };
            println!(
                "  {:<15} on {:<12} {:.1} GB / {:.1} GB ({:.1}%) [{}]",
                d.filesystem,
                d.mount,
                d.used_bytes as f64 / 1_073_741_824.0,
                d.total_bytes as f64 / 1_073_741_824.0,
                d.usage_percent,
                flag
            );
        }
    }
    println!();
    println!("[MEMORY & SWAP]");
    println!(
        "  RAM:  {:.2} GB / {:.2} GB ({:.1}%) [Available: {:.2} GB]",
        report.ram.used_bytes as f64 / 1_073_741_824.0,
        report.ram.total_bytes as f64 / 1_073_741_824.0,
        report.ram.usage_percent,
        report.ram.available_bytes as f64 / 1_073_741_824.0
    );
    if report.swap.total_bytes > 0 {
        let swap_flag = if report.swap.warning {
            "! WARNING"
        } else {
            "OK"
        };
        println!(
            "  Swap: {:.2} GB / {:.2} GB ({:.1}%) [{}]",
            report.swap.used_bytes as f64 / 1_073_741_824.0,
            report.swap.total_bytes as f64 / 1_073_741_824.0,
            report.swap.usage_percent,
            swap_flag
        );
    } else {
        println!("  Swap: Disabled / None");
    }
    println!();
    println!("[PROCESS INTEGRITY]");
    println!(
        "  Total: {} | Zombie/Defunct: {} [{}]",
        report.process.total_processes,
        report.process.zombie_processes.len(),
        if report.process.warning {
            "! WARNING"
        } else {
            "OK"
        }
    );
    for z in &report.process.zombie_processes {
        println!(
            "    - Zombie PID: {} (PPID: {}, Command: {})",
            z.pid, z.ppid, z.command
        );
    }
    println!();
    println!("[SYSTEMD FAILED UNITS]");
    if report.failed_units.is_empty() {
        println!("  None (All units operational)");
    } else {
        for u in &report.failed_units {
            println!("  ! Failed: {}", u);
        }
    }
    println!();
    println!("[MONITORED SERVICES]");
    if report.services.is_empty() {
        println!("  No services monitored.");
    } else {
        for s in &report.services {
            let flag = if s.healthy { "OK" } else { "! INACTIVE" };
            println!(
                "  - {:<20} state: {:<10} sub: {:<10} [{}]",
                s.unit, s.state, s.sub_state, flag
            );
        }
    }
    println!();
    println!("[PUBLIC LISTENING PORTS]");
    let public_ports: Vec<&PortAudit> = report.ports.iter().filter(|p| p.is_public).collect();
    if public_ports.is_empty() {
        println!("  None");
    } else {
        for p in public_ports {
            println!(
                "  - {:<4} {:<15} port {:<5} {}",
                p.proto, p.local_address, p.port, p.process
            );
        }
    }
    println!();
    println!("------------------------------------------------------------");
    println!("Audit Findings:");
    for f in &report.findings {
        println!("  - {}", f);
    }
    println!("------------------------------------------------------------");
}

/// Run aphrody-ssh using an iterator of arguments (including the binary name as args[0]).
pub async fn run_from_args<I, T>(args: I) -> Result<(), Error>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(e) => {
            let _ = e.print();
            if e.use_stderr() {
                return Err(Error::Clap(e));
            }
            return Ok(());
        }
    };
    run(cli).await
}

/// Entry point of the former `aphrody-ssh` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn cli_main(args: Vec<std::ffi::OsString>) -> i32 {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("Error: {error}");
            return 1;
        }
    };
    match runtime.block_on(run_from_args(args)) {
        Ok(()) => 0,
        Err(Error::Clap(_)) => 2,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

pub async fn run(cli: Cli) -> Result<(), Error> {
    let (host, args): (Host, Vec<String>) = match cli.command {
        Commands::Exec { host, cmd, command } => {
            let final_cmd = match (cmd, command.is_empty()) {
                (Some(c), _) => c,
                (None, false) => command.join(" "),
                (None, true) => return Err(Error::InvalidInput("No command specified".into())),
            };
            (host, vec![final_cmd])
        }
        Commands::Proxy {
            host,
            port,
            remote,
            daemon,
            stop,
            status,
            switch,
        } => {
            handle_proxy(
                host,
                port,
                remote.as_deref(),
                daemon,
                stop,
                status,
                switch,
                cli.json,
            )
            .await?;
            return Ok(());
        }
        Commands::Status { host } => (
            host,
            vec![
            "printf 'HOST='; hostname; printf 'UPTIME='; uptime; printf 'DISK='; df -h / | tail \
             -1; printf 'MEM='; free -h | awk 'NR==2{print $3 \"/\" $2}'"
                .into(),
        ],
        ),
        Commands::Ports { host } => (host, vec!["sudo -n ss -lntup".into()]),
        Commands::Logs { host, unit, lines } => {
            validate_unit(&unit)?;
            if !(1..=5000).contains(&lines) {
                return Err(Error::Remote {
                    code: None,
                    stderr: "lines must be 1..=5000".into(),
                });
            }
            (
                host,
                vec![format!(
                    "sudo -n journalctl -u {unit} -n {lines} --no-pager"
                )],
            )
        }
        Commands::Service {
            host,
            action,
            unit,
            confirm,
        } => {
            validate_unit(&unit)?;
            if matches!(action, ServiceAction::Stop | ServiceAction::Disable) && !confirm {
                return Err(Error::Remote {
                    code: None,
                    stderr: "stop/disable require --confirm".into(),
                });
            }
            (
                host,
                vec![format!("sudo -n systemctl {} {unit}", action.as_str())],
            )
        }
        Commands::Health { host, url } => {
            validate_url(&url)?;
            (
                host,
                vec![format!(
                    "curl --fail --silent --show-error --connect-timeout 5 --max-time 20 -I -- '{url}'"
                )],
            )
        }
        Commands::Compare {
            host,
            local,
            remote,
        } => {
            let local_state = local_git(&local).await?;
            let remote_cmd = format!(
                "git -C '{}' status --short --branch",
                remote.replace('\'', "'\\''")
            );
            let result = run_ssh(host, &[&remote_cmd]).await?;
            if cli.json {
                println!(
                    "{}",
                    serde_json::json!({"host": host.alias(), "local": local.display().to_string(), "remote": remote, "local_status": local_state, "remote_status": result.stdout})
                );
            } else {
                println!(
                    "LOCAL {}\n{}REMOTE {}\n{}",
                    local.display(),
                    local_state,
                    remote,
                    result.stdout
                );
            }
            return Ok(());
        }
        Commands::Sync {
            host,
            source,
            destination,
            apply,
        } => {
            if !destination.starts_with('/')
                || destination.contains('"')
                || destination.contains('\n')
            {
                return Err(Error::Remote {
                    code: None,
                    stderr: "destination must be an absolute remote path".into(),
                });
            }
            let remote = format!("{}:{}", host.alias(), destination);
            let mut command = Command::new("rclone");
            command.args([
                "sync",
                source.to_string_lossy().as_ref(),
                &remote,
                "--exclude",
                ".git/**",
                "--exclude",
                ".env*",
                "--exclude",
                ".ssh/**",
                "--exclude",
                "node_modules/**",
                "--exclude",
                "target/**",
                "--exclude",
                ".venv/**",
                "--exclude",
                ".turbo/**",
                "--exclude",
                "dist/**",
                "--exclude",
                "*.pyc",
                "--progress",
            ]);
            if !apply {
                command.arg("--dry-run");
            }
            let output = command
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await?;
            let result = Output {
                host: host.alias().into(),
                exit_code: output.status.code(),
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            };
            if !output.status.success() {
                return Err(Error::Remote {
                    code: result.exit_code,
                    stderr: result.stderr.trim().into(),
                });
            }
            render(result, cli.json);
            return Ok(());
        }
        Commands::Monitor { host, top } => {
            if !(1..=100).contains(&top) {
                return Err(Error::InvalidInput("top must be between 1 and 100".into()));
            }
            let cmd = monitor_command(top);
            let result = run_ssh(host, &[&cmd]).await?;
            let report = parse_monitor_raw(host.alias(), &result.stdout, top);
            render_monitor(&report, cli.json);
            return Ok(());
        }
        Commands::Tune { host, apply } => {
            let query_cmd = tune_query_command();
            let result = run_ssh(host, &[&query_cmd]).await?;
            let plan = parse_sysctl_query(host.alias(), &result.stdout, apply);
            if apply && plan.changes_required > 0 {
                let apply_script = generate_tune_apply_script(&plan);
                let applied = run_ssh(host, &[&apply_script]).await?;
                if applied.exit_code != Some(0) {
                    return Err(Error::Remote {
                        code: applied.exit_code,
                        stderr: applied.stderr.trim().into(),
                    });
                }
            }
            render_tune(&plan, cli.json);
            return Ok(());
        }
        Commands::Audit { host, services } => {
            validate_services_arg(&services)?;
            let svc_list: Vec<&str> = services
                .split(|c| c == ',' || c == ' ')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect();
            let cmd = audit_command(&svc_list);
            let result = run_ssh(host, &[&cmd]).await?;
            let report = parse_audit_raw(host.alias(), &result.stdout);
            render_audit(&report, cli.json);
            return Ok(());
        }
        Commands::Tunnel { args, action } => {
            match action {
                Some(TunnelAction::Status(status_args)) => {
                    tunnel::run_tunnel_status_command(&status_args, cli.json).await?;
                }
                None => {
                    tunnel::run_tunnel_command(&args, cli.json).await?;
                }
            }
            return Ok(());
        }
        Commands::Sftp {
            host,
            path,
            cat,
            tree,
            depth,
            get,
            put,
            delta,
        } => {
            let session = in_process::InProcessSshSession::connect_host(host)
                .await
                .map_err(|e| Error::Remote {
                    code: None,
                    stderr: format!("In-process SSH connection failed: {e}"),
                })?;
            let sftp = session.sftp().await.map_err(|e| Error::Remote {
                code: None,
                stderr: format!("In-process SFTP subsystem failed: {e}"),
            })?;

            if let Some(local_src) = put {
                let content = std::fs::read(&local_src).map_err(|e| Error::Remote {
                    code: None,
                    stderr: format!("failed to read local file {:?}: {e}", local_src),
                })?;

                if delta {
                    let summary =
                        in_process::SftpDriver::upload_differential(&sftp, &content, &path)
                            .await
                            .map_err(|e| Error::Remote {
                                code: None,
                                stderr: format!("SFTP differential upload failed: {e}"),
                            })?;
                    if cli.json {
                        println!(
                            "{}",
                            serde_json::to_string_pretty(&serde_json::json!({
                                "status": "ok",
                                "mode": "differential_fast_rsync",
                                "host": host.alias(),
                                "local": local_src,
                                "remote": path,
                                "summary": summary,
                            }))
                            .expect("serializable")
                        );
                    } else {
                        println!(
                            "Uploaded (fast-rsync delta): {} -> [{}] {} (delta: {} B, savings: {}%)",
                            local_src.display(),
                            host.alias(),
                            path,
                            summary.delta_size,
                            summary.savings_percentage
                        );
                    }
                } else {
                    in_process::SftpDriver::write_file(&sftp, &path, &content)
                        .await
                        .map_err(|e| Error::Remote {
                            code: None,
                            stderr: format!("SFTP write_file failed: {e}"),
                        })?;
                    if cli.json {
                        println!(
                            "{}",
                            serde_json::json!({
                                "status": "ok",
                                "mode": "stream_full",
                                "host": host.alias(),
                                "local": local_src,
                                "remote": path,
                                "size": content.len(),
                            })
                        );
                    } else {
                        println!(
                            "Uploaded: {} -> [{}] {} ({} B)",
                            local_src.display(),
                            host.alias(),
                            path,
                            content.len()
                        );
                    }
                }
            } else if let Some(local_dst) = get {
                let content = in_process::SftpDriver::read_file(&sftp, &path)
                    .await
                    .map_err(|e| Error::Remote {
                        code: None,
                        stderr: format!("SFTP read_file failed: {e}"),
                    })?;
                if let Some(parent) = local_dst.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::write(&local_dst, &content).map_err(|e| Error::Remote {
                    code: None,
                    stderr: format!("failed to write local file {:?}: {e}", local_dst),
                })?;
                if cli.json {
                    println!(
                        "{}",
                        serde_json::json!({
                            "status": "ok",
                            "host": host.alias(),
                            "remote": path,
                            "local": local_dst,
                            "size": content.len(),
                        })
                    );
                } else {
                    println!(
                        "Downloaded: [{}] {} -> {} ({} B)",
                        host.alias(),
                        path,
                        local_dst.display(),
                        content.len()
                    );
                }
            } else if tree {
                let root_tree = in_process::SftpDriver::tree(&sftp, &path, depth)
                    .await
                    .map_err(|e| Error::Remote {
                        code: None,
                        stderr: format!("SFTP tree failed: {e}"),
                    })?;
                if cli.json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&root_tree).expect("serializable")
                    );
                } else {
                    fn print_tree(node: &in_process::SftpTreeNode, indent: usize) {
                        let pad = "  ".repeat(indent);
                        let kind = if node.entry.is_dir { "[D]" } else { "   " };
                        println!(
                            "{}{} {} ({} B)",
                            pad, kind, node.entry.name, node.entry.size
                        );
                        for child in &node.children {
                            print_tree(child, indent + 1);
                        }
                    }
                    println!("SFTP TREE [{}] {}", host.alias(), path);
                    print_tree(&root_tree, 0);
                }
            } else if let Some(target_file) = cat {
                let content = in_process::SftpDriver::read_file(&sftp, &target_file)
                    .await
                    .map_err(|e| Error::Remote {
                        code: None,
                        stderr: format!("SFTP read_file failed: {e}"),
                    })?;
                if cli.json {
                    println!(
                        "{}",
                        serde_json::json!({
                            "host": host.alias(),
                            "path": target_file,
                            "size": content.len(),
                            "content": String::from_utf8_lossy(&content)
                        })
                    );
                } else {
                    print!("{}", String::from_utf8_lossy(&content));
                }
            } else {
                let list = in_process::SftpDriver::read_dir(&sftp, &path)
                    .await
                    .map_err(|e| Error::Remote {
                        code: None,
                        stderr: format!("SFTP read_dir failed: {e}"),
                    })?;
                if cli.json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&serde_json::json!({
                            "host": host.alias(),
                            "path": path,
                            "entries": list
                        }))
                        .expect("serializable")
                    );
                } else {
                    println!("SFTP [{}] {}", host.alias(), path);
                    for item in list {
                        let kind = if item.is_dir { "DIR" } else { "FILE" };
                        println!(
                            "{:<5} {:>10} B  {:o}  {}",
                            kind, item.size, item.permissions, item.name
                        );
                    }
                }
            }
            return Ok(());
        }
    };
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    render(run_ssh(host, &refs).await?, cli.json);
    Ok(())
}

async fn handle_proxy(
    host: Host,
    port: u16,
    remote: Option<&str>,
    daemon: bool,
    stop: bool,
    status: bool,
    switch: Option<Option<String>>,
    json: bool,
) -> Result<(), Error> {
    // 1. Switch relay on VPS if requested
    if let Some(country_opt) = switch {
        let country = country_opt.as_deref().unwrap_or("us");
        let cmd = format!("sudo /usr/local/bin/mullvad-switch-relay {}", country);
        let out = run_ssh(host, &[&cmd]).await?;
        if json {
            println!(
                "{}",
                serde_json::json!({
                    "action": "switch",
                    "country": country,
                    "output": out.stdout.trim()
                })
            );
        } else {
            print!("{}", out.stdout);
        }
        return Ok(());
    }

    // 2. Stop tunnel if requested
    if stop {
        let remote = require_proxy_remote(remote)?;
        tunnel::kill_ssh_forwards(&format!("{port}:{remote}"));

        if json {
            println!(
                "{}",
                serde_json::json!({
                    "action": "stop",
                    "port": port,
                    "remote": remote,
                    "status": "stopped"
                })
            );
        } else {
            println!("[SSH Proxy] Tunnel vers {remote} sur port {port} arrêté.");
        }
        return Ok(());
    }

    // 3. Status probe
    if status {
        return probe_proxy_status(host, port, json).await;
    }

    let remote = require_proxy_remote(remote)?;

    // 4. Daemon mode
    if daemon {
        #[cfg(target_os = "windows")]
        {
            let arg_list = format!("'-N', '-L', '{}:{}', '{}'", port, remote, host.alias());
            let _ = std::process::Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-Command",
                    &format!(
                        "Start-Process ssh -ArgumentList {} -WindowStyle Hidden",
                        arg_list
                    ),
                ])
                .status();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("ssh")
                .args([
                    "-f",
                    "-N",
                    "-L",
                    &format!("{}:{}", port, remote),
                    host.alias(),
                ])
                .status();
        }

        tokio::time::sleep(Duration::from_millis(1500)).await;
        return probe_proxy_status(host, port, json).await;
    }

    // 5. Default interactive mode: probe first, if already working print status, otherwise launch
    //    foreground
    let probe = check_local_socks5(port).await;
    if probe.is_ok() {
        return probe_proxy_status(host, port, json).await;
    }

    println!(
        "[SSH Proxy] Démarrage du tunnel en avant-plan : 127.0.0.1:{} -> {} ({})",
        port,
        remote,
        host.alias()
    );
    println!("[SSH Proxy] Utilisez Ctrl+C pour interrompre le tunnel.");

    let mut child = Command::new("ssh")
        .args(["-N", "-L", &format!("{}:{}", port, remote), host.alias()])
        .spawn()?;

    tokio::select! {
        res = child.wait() => {
            let status = res?;
            if !status.success() {
                return Err(Error::Remote {
                    code: status.code(),
                    stderr: "SSH tunnel process terminated with non-zero exit code".into(),
                });
            }
        }
        _ = tokio::signal::ctrl_c() => {
            let _ = child.kill().await;
            println!("\n[SSH Proxy] Tunnel fermé.");
        }
    }

    Ok(())
}

/// Environment variable that supplies the remote SOCKS5 endpoint for `proxy`.
pub const PROXY_REMOTE_ENV: &str = "APHRODY_SSH_PROXY_REMOTE";

fn require_proxy_remote(remote: Option<&str>) -> Result<&str, Error> {
    match remote.map(str::trim) {
        Some(value) if !value.is_empty() => Ok(value),
        _ => Err(Error::InvalidInput(format!(
            "proxy needs --remote <host:port> or {PROXY_REMOTE_ENV}; the endpoint is \
                 published by              aphrody-infra"
        ))),
    }
}

/// reqwest's `rustls-no-provider` feature needs an explicit process-level
/// `CryptoProvider` before the first TLS handshake, or the client panics with
/// "Could not automatically determine the process-level CryptoProvider".
static INIT_CRYPTO: std::sync::Once = std::sync::Once::new();
fn ensure_crypto_provider() {
    INIT_CRYPTO.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

pub async fn check_local_socks5(port: u16) -> Result<serde_json::Value, String> {
    ensure_crypto_provider();
    let proxy =
        reqwest::Proxy::all(format!("socks5://127.0.0.1:{port}")).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;
    client
        .get("https://ipinfo.io/json")
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

async fn probe_proxy_status(host: Host, port: u16, json: bool) -> Result<(), Error> {
    let local_res = check_local_socks5(port).await;
    match local_res {
        Ok(v) => {
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "tunnel": "active",
                        "port": port,
                        "exit_ip": v.get("ip"),
                        "country": v.get("country"),
                        "city": v.get("city"),
                        "org": v.get("org")
                    })
                );
            } else {
                println!("[SSH Proxy] Tunnel ACTIF sur 127.0.0.1:{}", port);
                println!(
                    "  Sortie IP    : {}",
                    v.get("ip").and_then(|x| x.as_str()).unwrap_or("inconnu")
                );
                println!(
                    "  Pays / Ville : {} ({})",
                    v.get("country").and_then(|x| x.as_str()).unwrap_or("?"),
                    v.get("city").and_then(|x| x.as_str()).unwrap_or("?")
                );
                println!(
                    "  Opérateur    : {}",
                    v.get("org").and_then(|x| x.as_str()).unwrap_or("?")
                );
            }
        }
        Err(_) => {
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "tunnel": "inactive",
                        "port": port,
                        "error": "Local SOCKS5 port not reachable"
                    })
                );
            } else {
                println!("[SSH Proxy] Tunnel INACTIF sur 127.0.0.1:{}", port);
                println!("  Pour le démarrer en arrière-plan : aphrody ssh proxy -d");
            }
        }
    }

    // Interroger également le statut du VPS
    let vps_out = run_ssh(host, &["proxy-status"]).await;
    if let Ok(out) = vps_out {
        if !json {
            println!("\n[VPS Proxy Remote Info]");
            for line in out.stdout.lines() {
                if line.starts_with("• ") {
                    println!("  {}", line);
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn long_commands_go_through_stdin() {
        assert_eq!(super::stdin_script(&["uptime"]), None);
        let long = "x".repeat(super::MAX_ARGUMENT_COMMAND);
        assert_eq!(super::stdin_script(&[&long]), None);
        let script = super::stdin_script(&[&long, "y"]).expect("long command");
        assert_eq!(script.len(), super::MAX_ARGUMENT_COMMAND + 3);
        assert!(script.ends_with(
            " y
"
        ));
    }

    use std::path::Path;

    use clap::CommandFactory;

    use super::*;

    #[test]
    fn command_timeout_is_finite_and_explicit() {
        assert_eq!(command_timeout_seconds(None).expect("default"), 30);
        assert_eq!(
            command_timeout_seconds(Some("14400")).expect("factory duration"),
            14_400
        );
        for invalid in ["", "0", "86401", "-1", "1.5", "unlimited"] {
            assert!(command_timeout_seconds(Some(invalid)).is_err(), "{invalid}");
        }
    }

    #[test]
    fn unit_validation_rejects_shell_chars() {
        assert!(validate_unit("nginx;id").is_err());
    }

    #[test]
    fn health_validation_requires_http() {
        assert!(validate_url("file:///tmp/x").is_err());
    }

    #[test]
    fn aliases_are_stable() {
        assert_eq!(Host::Vps.alias(), "vps");
        assert_eq!(Host::Dbfr.alias(), "dbfr");
        assert_eq!(Host::Omar.alias(), "omar-pc");
        assert_eq!(Host::OmarWsl.alias(), "omar-wsl");
        assert_eq!(Host::AphroPc.alias(), "aphro-pc");
        assert!(Host::Omar.is_windows() && !Host::OmarWsl.is_windows());
        assert_eq!(Host::AphroPc.stdin_shell()[0], "powershell");
        assert_eq!(Host::OmarWslRt.stdin_shell(), ["bash", "-s"]);
        for host in Host::ALL {
            assert_eq!(
                <Host as clap::ValueEnum>::from_str(host.alias(), false).unwrap(),
                host
            );
        }
    }

    #[test]
    fn ovh_vps_cli_alias_selects_the_configured_vps_host() {
        let cli =
            Cli::try_parse_from(["aphrody-ssh", "status", "--host", "ovh-vps"]).expect("valid CLI");
        match cli.command {
            Commands::Status { host: Host::Vps } => {}
            _ => panic!("ovh-vps must resolve to the VPS host"),
        }
    }

    #[test]
    fn services_validation_accepts_valid_names() {
        assert!(validate_services_arg("nginx,ssh,docker,systemd-journald").is_ok());
        assert!(validate_services_arg("nginx ssh").is_ok());
        assert!(validate_services_arg("").is_ok());
    }

    #[test]
    fn services_validation_rejects_malicious_input() {
        assert!(validate_services_arg("nginx; rm -rf /").is_err());
        assert!(validate_services_arg("nginx && echo 1").is_err());
        assert!(validate_services_arg("`whoami`").is_err());
        assert!(validate_services_arg("$(id)").is_err());
    }

    #[test]
    fn parse_loadavg_from_procfs() {
        let output = "0.45 0.32 0.18 2/950 14231\n";
        let load = parse_loadavg(output);
        assert!((load.one_minute - 0.45).abs() < 1e-6);
        assert!((load.five_minute - 0.32).abs() < 1e-6);
        assert!((load.fifteen_minute - 0.18).abs() < 1e-6);
    }

    #[test]
    fn parse_loadavg_from_uptime() {
        let output = " 08:30:15 up 42 days,  3:12,  2 users,  load average: 1.15, 0.85, 0.50\n";
        let load = parse_loadavg(output);
        assert!((load.one_minute - 1.15).abs() < 1e-6);
        assert!((load.five_minute - 0.85).abs() < 1e-6);
        assert!((load.fifteen_minute - 0.50).abs() < 1e-6);
    }

    #[test]
    fn parse_meminfo_computes_ram_and_swap() {
        let output = "\
MemTotal:       16000000 kB
MemFree:         4000000 kB
MemAvailable:    8000000 kB
Buffers:          500000 kB
Cached:          3500000 kB
SwapTotal:       4000000 kB
SwapFree:        3000000 kB
";
        let (ram, swap) = parse_meminfo(output);
        assert_eq!(ram.total_bytes, 16_000_000 * 1024);
        assert_eq!(ram.available_bytes, 8_000_000 * 1024);
        assert_eq!(ram.used_bytes, 8_000_000 * 1024);
        assert!((ram.usage_percent - 50.0).abs() < 1e-6);

        assert_eq!(swap.total_bytes, 4_000_000 * 1024);
        assert_eq!(swap.free_bytes, 3_000_000 * 1024);
        assert_eq!(swap.used_bytes, 1_000_000 * 1024);
        assert!((swap.usage_percent - 25.0).abs() < 1e-6);
    }

    #[test]
    fn parse_cpu_stat_two_readings() {
        let output = "\
cpu  1000 0 500 8500 0 0 0 0 0 0
cpu  1100 0 550 8850 0 0 0 0 0 0
";
        let cpu = parse_cpu_stat(output);
        assert!((cpu - 30.0).abs() < 1e-1);
    }

    #[test]
    fn parse_diskstats_filtering() {
        let output = "\
   7       0 loop0 0 0 0 0 0 0 0 0 0 0 0
   8       0 sda 1500 20 30000 450 800 10 16000 320 0 120 770
   8       1 sda1 1000 0 20000 300 500 0 10000 200 0 80 500
";
        let stats = parse_diskstats(output);
        assert_eq!(stats.len(), 2);
        assert_eq!(stats[0].device, "sda");
        assert_eq!(stats[0].reads_completed, 1500);
        assert_eq!(stats[0].sectors_read, 30000);
        assert_eq!(stats[0].writes_completed, 800);
        assert_eq!(stats[0].sectors_written, 16000);
    }

    #[test]
    fn parse_sockets_summary() {
        let output = "\
Total: 345
TCP:   50 (estab 25, closed 3, orphaned 0, timewait 5)
Transport Total     IP        IPv6
RAW	  0         0         0        
UDP	  6         4         2        
";
        let sockets = parse_sockets(output);
        assert_eq!(sockets.total_sockets, 345);
        assert_eq!(sockets.tcp_established, 25);
        assert_eq!(sockets.tcp_closed, 3);
        assert_eq!(sockets.tcp_timewait, 5);
    }

    #[test]
    fn parse_top_processes_parsing() {
        let output = "\
  PID USER     %CPU %MEM STAT COMMAND
  101 root      4.5  2.0 S    systemd-journald
  202 ubuntu    2.1  5.0 S    bun run server.ts
";
        let procs = parse_top_processes(output, 5);
        assert_eq!(procs.len(), 2);
        assert_eq!(procs[0].pid, 101);
        assert_eq!(procs[0].user, "root");
        assert!((procs[0].cpu_percent - 4.5).abs() < 1e-6);
        assert_eq!(procs[1].pid, 202);
        assert_eq!(procs[1].command, "bun run server.ts");
    }

    #[test]
    fn parse_monitor_raw_complete() {
        let raw = "\
===LOADAVG===
0.10 0.20 0.15 1/500 1234
===MEMINFO===
MemTotal:       8000000 kB
MemFree:        2000000 kB
MemAvailable:   4000000 kB
SwapTotal:      2000000 kB
SwapFree:       1500000 kB
===CPU===
cpu  500 0 200 4300 0 0 0 0 0 0
cpu  550 0 220 4430 0 0 0 0 0 0
===DISKIO===
   8       0 sda 500 0 10000 100 200 0 4000 50 0 40 150
===SOCKETS===
Total: 120
TCP:   20 (estab 10, closed 1, orphaned 0, timewait 2)
===TOP===
  PID USER     %CPU %MEM STAT COMMAND
    1 root      0.0  0.1 S    /sbin/init
";
        let report = parse_monitor_raw("vps", raw, 5);
        assert_eq!(report.host, "vps");
        assert!((report.load_average.one_minute - 0.10).abs() < 1e-6);
        assert!((report.ram.usage_percent - 50.0).abs() < 1e-6);
        assert!((report.swap.usage_percent - 25.0).abs() < 1e-6);
        assert_eq!(report.disk_io.len(), 1);
        assert_eq!(report.network_sockets.tcp_established, 10);
        assert_eq!(report.top_processes.len(), 1);
        assert_eq!(report.top_processes[0].pid, 1);
    }

    #[test]
    fn parse_sysctl_tuning_plan() {
        let raw = "\
net.core.somaxconn=128
net.ipv4.tcp_max_syn_backlog=16384
vm.swappiness=60
";
        let plan = parse_sysctl_query("vps", raw, false);
        assert_eq!(plan.host, "vps");
        assert!(!plan.apply);
        let somaxconn = plan
            .items
            .iter()
            .find(|i| i.key == "net.core.somaxconn")
            .unwrap();
        assert_eq!(somaxconn.current_value, "128");
        assert_eq!(somaxconn.recommended_value, "65535");
        assert_eq!(somaxconn.status, TuneStatus::NeedsUpdate);

        let syn = plan
            .items
            .iter()
            .find(|i| i.key == "net.ipv4.tcp_max_syn_backlog")
            .unwrap();
        assert_eq!(syn.status, TuneStatus::Optimal);

        let swappiness = plan
            .items
            .iter()
            .find(|i| i.key == "vm.swappiness")
            .unwrap();
        assert_eq!(swappiness.status, TuneStatus::NeedsUpdate);

        assert!(plan.changes_required >= 2);
    }

    #[test]
    fn generate_sysctl_conf_format() {
        let plan = parse_sysctl_query("vps", "net.core.somaxconn=128\n", false);
        let conf = generate_sysctl_conf(&plan);
        assert!(conf.contains("net.core.somaxconn = 65535"));
        assert!(conf.contains("vm.swappiness = 10"));
        assert!(conf.contains("net.ipv6.conf.all.forwarding = 1"));
        assert!(generate_tune_apply_script(&plan).contains(TUNE_SYSCTL_PATH));
    }

    #[test]
    fn sysctl_floor_and_whitespace() {
        let raw = "fs.file-max=4194304\nnet.ipv4.ip_local_port_range=10240\t65535\n";
        let plan = parse_sysctl_query("vps", raw, false);
        let fmax = plan.items.iter().find(|i| i.key == "fs.file-max").unwrap();
        assert_eq!(fmax.status, TuneStatus::Optimal);
        let range = plan
            .items
            .iter()
            .find(|i| i.key == "net.ipv4.ip_local_port_range")
            .unwrap();
        assert_eq!(range.status, TuneStatus::Optimal);
        assert!(generate_sysctl_conf(&plan).contains("fs.file-max = 4194304"));
        let dbfr = parse_sysctl_query("dbfr", "", false);
        assert!(generate_sysctl_conf(&dbfr).contains("net.ipv6.conf.all.forwarding = 0"));
    }

    #[test]
    fn sysctl_host_overrides_dbfr() {
        let raw = "vm.swappiness=20\nvm.vfs_cache_pressure=50\n";
        let plan = parse_sysctl_query("dbfr", raw, false);
        let swappiness = plan
            .items
            .iter()
            .find(|i| i.key == "vm.swappiness")
            .unwrap();
        assert_eq!(swappiness.status, TuneStatus::Optimal);
        let cache = plan
            .items
            .iter()
            .find(|i| i.key == "vm.vfs_cache_pressure")
            .unwrap();
        assert_eq!(cache.recommended_value, "100");
        assert!(plan.sysctl_config.contains("vm.swappiness = 20"));
    }

    #[test]
    fn parse_audit_raw_healthy() {
        let raw = "\
===DISK===
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/sda1 100000000 20000000 80000000 20% /
===PROCESSES===
  1   0 S init
  2   0 S kthreadd
===MEMINFO===
MemTotal:       8000000 kB
MemFree:        4000000 kB
MemAvailable:   6000000 kB
SwapTotal:      2000000 kB
SwapFree:       1800000 kB
===PORTS===
tcp LISTEN 0 4096 127.0.0.1:5432 0.0.0.0:* users:((\"postgres\",pid=500,fd=3))
tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:((\"sshd\",pid=600,fd=3))
===FAILED_UNITS===
===SERVICES===
nginx active running
ssh active running
";
        let report = parse_audit_raw("vps", raw);
        assert_eq!(report.status, AuditHealthStatus::Healthy);
        assert_eq!(report.disk.len(), 1);
        assert_eq!(report.process.zombie_processes.len(), 0);
        assert_eq!(report.failed_units.len(), 0);
        assert_eq!(report.services.len(), 2);
        assert!(report.services[0].healthy);
        assert!(report.services[1].healthy);
    }

    #[test]
    fn parse_audit_raw_warning_on_high_disk() {
        let raw = "\
===DISK===
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/sda1 100000000 89000000 11000000 89% /
===PROCESSES===
  1   0 S init
===MEMINFO===
MemTotal:       8000000 kB
MemFree:        4000000 kB
MemAvailable:   6000000 kB
SwapTotal:      2000000 kB
SwapFree:       1800000 kB
===PORTS===
===FAILED_UNITS===
===SERVICES===
";
        let report = parse_audit_raw("vps", raw);
        assert_eq!(report.status, AuditHealthStatus::Warning);
        assert!(report.findings.iter().any(|f| f.contains("WARNING: Disk")));
    }

    #[test]
    fn parse_audit_raw_critical_on_full_disk() {
        let raw = "\
===DISK===
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/sda1 100000000 97000000 3000000 97% /
===PROCESSES===
  1   0 S init
===MEMINFO===
MemTotal:       8000000 kB
MemFree:        4000000 kB
MemAvailable:   6000000 kB
SwapTotal:      2000000 kB
SwapFree:       1800000 kB
===PORTS===
===FAILED_UNITS===
===SERVICES===
";
        let report = parse_audit_raw("vps", raw);
        assert_eq!(report.status, AuditHealthStatus::Critical);
        assert!(report.findings.iter().any(|f| f.contains("CRITICAL: Disk")));
    }

    #[test]
    fn parse_audit_raw_detects_zombies_and_failed_units() {
        let raw = "\
===DISK===
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/sda1 100000000 20000000 80000000 20% /
===PROCESSES===
  1   0 S init
 999   1 Z <defunct>
===MEMINFO===
MemTotal:       8000000 kB
MemFree:        4000000 kB
MemAvailable:   6000000 kB
SwapTotal:      2000000 kB
SwapFree:       1800000 kB
===PORTS===
===FAILED_UNITS===
bad-worker.service loaded failed failed Bad Worker Service
===SERVICES===
nginx failed failed
";
        let report = parse_audit_raw("vps", raw);
        assert_eq!(report.status, AuditHealthStatus::Warning);
        assert_eq!(report.process.zombie_processes.len(), 1);
        assert_eq!(report.process.zombie_processes[0].pid, 999);
        assert_eq!(report.failed_units.len(), 1);
        assert_eq!(report.services.len(), 1);
        assert!(!report.services[0].healthy);
    }

    #[test]
    fn cli_subcommands_parse_correctly() {
        let mon = Cli::try_parse_from(["aphrody-ssh", "monitor", "--host", "vps", "--top", "10"])
            .unwrap();
        match mon.command {
            Commands::Monitor {
                host: Host::Vps,
                top,
            } => assert_eq!(top, 10),
            _ => panic!("Expected Monitor command"),
        }

        let tune =
            Cli::try_parse_from(["aphrody-ssh", "tune", "--host", "dbfr", "--apply"]).unwrap();
        match tune.command {
            Commands::Tune {
                host: Host::Dbfr,
                apply,
            } => assert!(apply),
            _ => panic!("Expected Tune command"),
        }

        let audit = Cli::try_parse_from([
            "aphrody-ssh",
            "audit",
            "--host",
            "vps",
            "--services",
            "nginx,ssh",
        ])
        .unwrap();
        match audit.command {
            Commands::Audit {
                host: Host::Vps,
                services,
            } => assert_eq!(services, "nginx,ssh"),
            _ => panic!("Expected Audit command"),
        }

        let exec = Cli::try_parse_from([
            "aphrody-ssh",
            "exec",
            "--host",
            "vps",
            "curl",
            "-s",
            "https://ipinfo.io",
        ])
        .unwrap();
        match exec.command {
            Commands::Exec {
                host: Host::Vps,
                command,
                ..
            } => {
                assert_eq!(command, vec!["curl", "-s", "https://ipinfo.io"]);
            }
            _ => panic!("Expected Exec command"),
        }

        let proxy =
            Cli::try_parse_from(["aphrody-ssh", "proxy", "--host", "vps", "--status"]).unwrap();
        match proxy.command {
            Commands::Proxy {
                host: Host::Vps,
                status,
                ..
            } => assert!(status),
            _ => panic!("Expected Proxy command"),
        }

        let proxy = Cli::try_parse_from([
            "aphrody-ssh",
            "proxy",
            "--host",
            "vps",
            "--remote",
            "socks.internal:1080",
        ])
        .unwrap();
        match proxy.command {
            Commands::Proxy { remote, .. } => {
                assert_eq!(remote.as_deref(), Some("socks.internal:1080"));
            }
            _ => panic!("Expected Proxy command"),
        }

        assert!(Cli::try_parse_from(["aphrody-ssh", "deploy", "--host", "vps"]).is_err());
    }

    #[test]
    fn proxy_remote_is_required_and_trimmed() {
        assert!(require_proxy_remote(None).is_err());
        assert!(require_proxy_remote(Some("  ")).is_err());
        assert_eq!(require_proxy_remote(Some(" h:1 ")).unwrap(), "h:1");
    }

    #[test]
    fn cli_definition_is_valid() {
        Cli::command().debug_assert();
    }

    #[test]
    fn tunnel_command_parses_with_defaults() {
        let cli = Cli::try_parse_from(["aphrody-ssh", "tunnel"]).unwrap();
        match cli.command {
            Commands::Tunnel { args, action } => {
                assert!(args.services.is_none());
                assert_eq!(args.offset, tunnel::DEFAULT_OFFSET);
                assert!(args.catalog.is_none());
                assert!(!args.dry_run);
                assert!(action.is_none());
            }
            _ => panic!("Expected Tunnel command"),
        }
    }

    #[test]
    fn tunnel_command_parses_flags() {
        let cli = Cli::try_parse_from([
            "aphrody-ssh",
            "tunnel",
            "--services",
            "db-tunnel,redis",
            "--offset",
            "500",
            "--catalog",
            "infra/config/service-catalog.json",
            "--dry-run",
        ])
        .unwrap();
        match cli.command {
            Commands::Tunnel { args, action } => {
                assert_eq!(args.services.as_deref(), Some("db-tunnel,redis"));
                assert_eq!(args.offset, 500);
                assert_eq!(
                    args.catalog.as_deref(),
                    Some(Path::new("infra/config/service-catalog.json"))
                );
                assert!(args.dry_run);
                assert!(action.is_none());
            }
            _ => panic!("Expected Tunnel command"),
        }
    }

    #[test]
    fn tunnel_status_subcommand_parses() {
        let cli = Cli::try_parse_from([
            "aphrody-ssh",
            "tunnel",
            "status",
            "--services",
            "redis",
            "--json",
        ])
        .unwrap();
        assert!(cli.json);
        match cli.command {
            Commands::Tunnel {
                action: Some(TunnelAction::Status(status_args)),
                ..
            } => {
                assert_eq!(status_args.services.as_deref(), Some("redis"));
            }
            _ => panic!("Expected Tunnel status subcommand"),
        }
    }
}
