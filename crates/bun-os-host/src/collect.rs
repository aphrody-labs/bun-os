//! Collector: reads `/proc`, `/sys` and runs read-only probes (`nvidia-smi`, `lsblk`, `df`, `ip`,
//! PowerShell/`wmic` on Windows), then hands the text to [`crate::parse`]. A missing probe leaves its
//! section empty; collection never fails.

use std::io::Read;
#[cfg(all(unix, not(target_os = "macos")))]
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::parse;
#[cfg(not(target_os = "macos"))]
use crate::schema::Gpu;
use crate::schema::{Cpu, HostInfo, Kernel, Network, Os, SCHEMA};

const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

/// Runs `program args`, returning stdout on success. Killed after [`PROBE_TIMEOUT`].
pub fn run(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let deadline = Instant::now() + PROBE_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let bytes = reader.join().ok()?;
    status?
        .success()
        .then(|| String::from_utf8_lossy(&bytes).into_owned())
}

fn read(path: &str) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// Live process memory ceiling/headroom in bytes, from visible kernel cgroups.
/// `None` means no finite ceiling was observed; it does not promise free RAM.
#[cfg(all(unix, not(target_os = "macos")))]
pub fn cgroup_memory_budget() -> Option<(u64, u64)> {
    let membership = read("/proc/self/cgroup")?;
    let mountinfo = read("/proc/self/mountinfo")?;
    let mut budget: Option<(u64, u64)> = None;
    for hierarchy in parse::memory_cgroups(&membership, &mountinfo) {
        let root = Path::new(&hierarchy.mount);
        let mut directory = Path::new(&hierarchy.path);
        // Parents include sibling allocations in their current usage.
        while directory.starts_with(root) {
            let (limit_file, usage_file) = if hierarchy.unified {
                ("memory.max", "memory.current")
            } else {
                ("memory.limit_in_bytes", "memory.usage_in_bytes")
            };
            if let Some(ceiling) = read(&directory.join(limit_file).to_string_lossy()) {
                let usage = read(&directory.join(usage_file).to_string_lossy());
                if let Some((ceiling, available)) = parse::memory_budget(&ceiling, usage.as_deref())
                {
                    budget = Some(match budget {
                        Some((previous_limit, previous_available)) => (
                            previous_limit.min(ceiling),
                            previous_available.min(available),
                        ),
                        None => (ceiling, available),
                    });
                }
            }
            if directory == root {
                break;
            }
            let Some(parent) = directory.parent() else {
                break;
            };
            directory = parent;
        }
    }
    budget
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Host id: `BUN_HOST_ID`, else the machine name.
pub fn default_id() -> String {
    for key in ["BUN_HOST_ID", "COMPUTERNAME", "HOSTNAME"] {
        if let Some(v) = std::env::var(key).ok().filter(|v| !v.trim().is_empty()) {
            return v.trim().to_ascii_lowercase();
        }
    }
    read("/etc/hostname")
        .or_else(|| run("hostname", &[]))
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

#[cfg(not(target_os = "macos"))]
fn wg_prefixes() -> Vec<String> {
    let value = std::env::var("BUN_HOST_WG_PREFIXES").unwrap_or_else(|_| "10.200.,10.8.".into());
    value
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn nvidia_smi() -> Option<(Vec<Gpu>, Option<String>)> {
    let query = [
        "--query-gpu=name,memory.total,memory.free,driver_version",
        "--format=csv,noheader,nounits",
    ];
    let mut programs = vec!["nvidia-smi"];
    if cfg!(unix) {
        programs.push("/usr/lib/wsl/lib/nvidia-smi");
    }
    let (program, csv) = programs
        .into_iter()
        .find_map(|p| run(p, &query).map(|out| (p, out)))?;
    let mut gpus = parse::nvidia_smi_csv(&csv);
    if gpus.is_empty() {
        return None;
    }
    let cuda = run(program, &[]).and_then(|banner| parse::nvidia_cuda_version(&banner));
    for gpu in &mut gpus {
        gpu.cuda.clone_from(&cuda);
    }
    Some((gpus, cuda))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn sysfs_gpus() -> Vec<Gpu> {
    let Ok(entries) = std::fs::read_dir("/sys/class/drm") else {
        return Vec::new();
    };
    let mut cards: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    cards.sort();
    let mut gpus = Vec::new();
    for card in cards {
        let name = card.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let is_card = name
            .strip_prefix("card")
            .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()));
        if !is_card {
            continue;
        }
        let dev = card.join("device");
        let vendor = match read(&dev.join("vendor").to_string_lossy())
            .as_deref()
            .map(str::trim)
        {
            Some("0x1002") => "amd",
            Some("0x8086") => "intel",
            // NVIDIA goes through nvidia-smi; virtual adapters (virtio, bochs) are not GPUs to route to.
            _ => continue,
        };
        let mib = |file: &str| {
            read(&dev.join(file).to_string_lossy())
                .and_then(|s| s.trim().parse::<u64>().ok())
                .map(|b| b / parse::MIB)
        };
        let total = mib("mem_info_vram_total").unwrap_or(0);
        let used = mib("mem_info_vram_used");
        let device_id = read(&dev.join("device").to_string_lossy())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let driver = std::fs::read_link(dev.join("driver"))
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
        gpus.push(Gpu {
            vendor: vendor.into(),
            name: format!("{} GPU {device_id}", vendor.to_ascii_uppercase()),
            vram_total_mib: total,
            vram_free_mib: used.map(|u| total.saturating_sub(u)),
            driver,
            cuda: None,
        });
    }
    gpus
}

#[cfg(unix)]
pub fn collect(id: &str) -> HostInfo {
    #[cfg(target_os = "macos")]
    {
        collect_macos(id)
    }
    #[cfg(not(target_os = "macos"))]
    collect_linux(id)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn collect_linux(id: &str) -> HostInfo {
    let release = read("/proc/sys/kernel/osrelease")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let wsl = release.to_ascii_lowercase().contains("microsoft")
        || read("/proc/version").is_some_and(|v| v.to_ascii_lowercase().contains("microsoft"));
    let io_uring = match read("/proc/sys/kernel/io_uring_disabled") {
        Some(v) => v.trim() == "0",
        None => {
            let mut parts = release
                .split(|c: char| !c.is_ascii_digit())
                .filter(|s| !s.is_empty())
                .map(|s| s.parse::<u32>().unwrap_or(0));
            let (major, minor) = (parts.next().unwrap_or(0), parts.next().unwrap_or(0));
            (major, minor) >= (5, 10)
        }
    };
    let (os_name, os_version) = read("/etc/os-release")
        .or_else(|| read("/usr/lib/os-release"))
        .map(|t| parse::os_release(&t))
        .unwrap_or_default();
    let musl = Path::new("/lib")
        .read_dir()
        .into_iter()
        .flatten()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().starts_with("ld-musl-"));
    let cpu = read("/proc/cpuinfo")
        .map(|t| parse::cpuinfo(&t))
        .unwrap_or_default();
    let mut memory = read("/proc/meminfo")
        .map(|t| parse::meminfo(&t))
        .unwrap_or_default();
    if let Some((ceiling, available)) = cgroup_memory_budget() {
        memory.total_mib = memory.total_mib.min(ceiling / parse::MIB);
        memory.available_mib = memory
            .available_mib
            .min(available / parse::MIB)
            .min(memory.total_mib);
    }
    if let Some((some, full)) = read("/proc/pressure/memory").map(|t| parse::psi(&t)) {
        memory.psi_some_avg10 = some;
        memory.psi_full_avg10 = full;
    }

    let mut gpus = Vec::new();
    if let Some((nvidia, _)) = nvidia_smi() {
        gpus.extend(nvidia);
    }
    gpus.extend(sysfs_gpus());

    let kinds = run(
        "lsblk",
        &[
            "-J",
            "-b",
            "-o",
            "NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT,ROTA,TRAN,MODEL",
        ],
    )
    .map(|t| parse::lsblk_kinds(&t))
    .unwrap_or_default();
    let mut disks = run("df", &["-P", "-T", "-B1"])
        .map(|t| parse::df(&t))
        .unwrap_or_default();
    for disk in &mut disks {
        let name = disk.device.rsplit('/').next().unwrap_or("");
        if let Some(kind) = kinds.get(name) {
            disk.kind.clone_from(kind);
        }
    }
    disks.dedup_by(|a, b| a.device == b.device);

    let network = Network {
        wireguard: run("ip", &["-o", "-4", "addr", "show"])
            .map(|t| parse::ip_addr(&t, &wg_prefixes()))
            .unwrap_or_default(),
    };
    let uptime_s = read("/proc/uptime")
        .and_then(|t| t.split_whitespace().next()?.split('.').next()?.parse().ok());

    let mut info = HostInfo {
        environment: None,
        schema: SCHEMA,
        id: id.to_string(),
        collected_at: now_ms(),
        os: Os {
            family: "linux".into(),
            name: os_name,
            version: os_version,
            build: None,
            arch: std::env::consts::ARCH.into(),
            libc: if musl { "musl" } else { "glibc" }.into(),
        },
        kernel: Kernel {
            release,
            cgroup_v2: Path::new("/sys/fs/cgroup/cgroup.controllers").exists(),
            io_uring,
            wsl,
        },
        cpu: Cpu {
            model: cpu.model,
            physical_cores: cpu.physical,
            logical_cores: cpu.logical.max(1),
            flags: cpu.flags,
        },
        memory,
        gpus,
        disks,
        network,
        uptime_s,
    };
    info.environment = Some(crate::environment::collect(&info));
    info
}

#[cfg(target_os = "macos")]
fn collect_macos(id: &str) -> HostInfo {
    use crate::schema::{Disk, Memory};
    let sysctl = |key: &str| run("sysctl", &["-n", key]).map(|s| s.trim().to_string());
    let total = sysctl("hw.memsize")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
        / parse::MIB;
    let version = run("sw_vers", &["-productVersion"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let disks = run("df", &["-P", "-k"])
        .map(|t| {
            t.lines()
                .skip(1)
                .filter_map(|l| {
                    let f: Vec<&str> = l.split_whitespace().collect();
                    (f.len() >= 6 && f[0].starts_with("/dev/") && f[5] == "/").then(|| Disk {
                        mount: f[5..].join(" "),
                        device: f[0].into(),
                        fs: "apfs".into(),
                        total_mib: f[1].parse::<u64>().unwrap_or(0) / 1024,
                        free_mib: f[3].parse::<u64>().unwrap_or(0) / 1024,
                        kind: "ssd".into(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let boot = sysctl("kern.boottime").and_then(|s| {
        s.split("sec = ")
            .nth(1)?
            .split(',')
            .next()?
            .trim()
            .parse::<u64>()
            .ok()
    });
    let mut info = HostInfo {
        environment: None,
        schema: SCHEMA,
        id: id.to_string(),
        collected_at: now_ms(),
        os: Os {
            family: "macos".into(),
            name: "macOS".into(),
            version,
            build: None,
            arch: std::env::consts::ARCH.into(),
            libc: "system".into(),
        },
        kernel: Kernel {
            release: sysctl("kern.osrelease").unwrap_or_default(),
            ..Kernel::default()
        },
        cpu: Cpu {
            model: sysctl("machdep.cpu.brand_string").unwrap_or_default(),
            physical_cores: sysctl("hw.physicalcpu").and_then(|s| s.parse().ok()),
            logical_cores: sysctl("hw.logicalcpu")
                .and_then(|s| s.parse().ok())
                .unwrap_or(1),
            flags: Vec::new(),
        },
        memory: Memory {
            total_mib: total,
            available_mib: total,
            ..Memory::default()
        },
        gpus: Vec::new(),
        disks,
        network: Network::default(),
        uptime_s: boot.map(|b| (now_ms() / 1000).saturating_sub(b)),
    };
    info.environment = Some(crate::environment::collect(&info));
    info
}

/// PowerShell, else `wmic`, for a CIM class: CSV with a header line.
#[cfg(windows)]
fn cim(class: &str, props: &[&str]) -> Option<String> {
    let list = props.join(",");
    let script = format!(
        "Get-CimInstance {class} | Select-Object {list} | ConvertTo-Csv -NoTypeInformation"
    );
    run(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", &script],
    )
    .filter(|t| !t.trim().is_empty())
    .or_else(|| run("wmic", &["path", class, "get", &list, "/format:csv"]))
}

#[cfg(windows)]
pub fn collect(id: &str) -> HostInfo {
    use crate::schema::Disk;
    let system = cim(
        "Win32_OperatingSystem",
        &[
            "Caption",
            "Version",
            "BuildNumber",
            "TotalVisibleMemorySize",
            "FreePhysicalMemory",
            "TotalVirtualMemorySize",
            "FreeVirtualMemory",
        ],
    )
    .and_then(|t| parse::windows_system(&t))
    .unwrap_or_default();
    let (model, physical, logical) = cim(
        "Win32_Processor",
        &["Name", "NumberOfCores", "NumberOfLogicalProcessors"],
    )
    .and_then(|t| parse::windows_cpu(&t))
    .unwrap_or_default();
    #[cfg(target_arch = "x86_64")]
    let mut flags = Vec::new();
    #[cfg(not(target_arch = "x86_64"))]
    let flags = Vec::new();
    #[cfg(target_arch = "x86_64")]
    {
        macro_rules! probe {
            ($($feature:tt => $flag:expr),*) => {$(if std::arch::is_x86_feature_detected!($feature) { flags.push($flag.to_string()); })*};
        }
        probe!("avx" => "avx", "avx2" => "avx2", "avx512f" => "avx512f", "avx512bw" => "avx512bw", "avx512vnni" => "avx512vnni");
    }

    let mut gpus = cim(
        "Win32_VideoController",
        &["Name", "AdapterRAM", "DriverVersion"],
    )
    .map(|t| parse::windows_gpus(&t))
    .unwrap_or_default();
    if let Some((nvidia, _)) = nvidia_smi() {
        gpus.retain(|g| g.vendor != "nvidia");
        gpus.splice(0..0, nvidia);
    }

    let kind = run(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", "Get-PhysicalDisk | Select-Object FriendlyName,MediaType,BusType | ConvertTo-Csv -NoTypeInformation"],
    )
    .map(|t| parse::windows_disk_kind(&t))
    .unwrap_or_else(|| "unknown".into());
    let disks: Vec<Disk> = cim(
        "Win32_LogicalDisk",
        &["DeviceID", "FileSystem", "Size", "FreeSpace", "DriveType"],
    )
    .map(|t| parse::windows_disks(&t, &kind))
    .unwrap_or_default();

    let wireguard = run(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", "Get-NetIPAddress -AddressFamily IPv4 | Select-Object InterfaceAlias,IPAddress | ConvertTo-Csv -NoTypeInformation"],
    )
    .map(|t| parse::windows_addresses(&t, &wg_prefixes()))
    .unwrap_or_default();
    let uptime_s = run("powershell.exe", &["-NoProfile", "-NonInteractive", "-Command", "[int64]((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalSeconds"])
        .and_then(|t| t.trim().parse::<u64>().ok());

    let build: Option<String> = Some(system.build.clone()).filter(|b| !b.is_empty());
    let mut info = HostInfo {
        environment: None,
        schema: SCHEMA,
        id: id.to_string(),
        collected_at: now_ms(),
        os: Os {
            family: "windows".into(),
            name: system.caption,
            version: system.version.clone(),
            build,
            arch: std::env::consts::ARCH.into(),
            libc: "msvc".into(),
        },
        kernel: Kernel {
            release: system.version,
            cgroup_v2: false,
            io_uring: false,
            wsl: false,
        },
        cpu: Cpu {
            model,
            physical_cores: Some(physical).filter(|n| *n > 0),
            logical_cores: logical.max(1),
            flags,
        },
        memory: system.memory,
        gpus,
        disks,
        network: Network { wireguard },
        uptime_s,
    };
    info.environment = Some(crate::environment::collect(&info));
    info
}

#[cfg(not(any(unix, windows)))]
pub fn collect(id: &str) -> HostInfo {
    HostInfo {
        schema: SCHEMA,
        id: id.to_string(),
        collected_at: now_ms(),
        ..HostInfo::default()
    }
}
