//! Pure parsers of the probes' text output. No I/O here, so fixtures test them on every OS.

use std::collections::{BTreeSet, HashMap};

use crate::schema::{Address, Disk, Gpu, Memory};

pub const MIB: u64 = 1024 * 1024;

/// The memory hierarchy visible to this process, resolved through mountinfo.
pub struct MemoryCgroup {
    pub mount: String,
    pub path: String,
    pub unified: bool,
}

/// Resolve cgroup v1 memory and v2 memberships, including namespace/bind roots.
pub fn memory_cgroups(membership: &str, mountinfo: &str) -> Vec<MemoryCgroup> {
    let decode = |text: &str| {
        text.replace("\\040", " ")
            .replace("\\011", "\t")
            .replace("\\012", "\n")
            .replace("\\134", "\\")
    };
    let mut result = Vec::new();
    for line in membership.lines() {
        let mut fields = line.splitn(3, ':');
        let (Some(id), Some(controllers), Some(member)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let unified = id == "0" && controllers.is_empty();
        if !unified
            && !controllers
                .split(',')
                .any(|controller| controller == "memory")
        {
            continue;
        }
        if !member.starts_with('/') || member.split('/').any(|part| part == ".." || part == ".") {
            continue;
        }
        for mount in mountinfo.lines() {
            let Some((before, after)) = mount.split_once(" - ") else {
                continue;
            };
            let mut tail = after.split_whitespace();
            let (Some(kind), Some(_source), Some(options)) =
                (tail.next(), tail.next(), tail.next())
            else {
                continue;
            };
            if (unified && kind != "cgroup2")
                || (!unified
                    && (kind != "cgroup" || !options.split(',').any(|option| option == "memory")))
            {
                continue;
            }
            let mut head = before.split_whitespace().skip(3);
            let (Some(root), Some(mount)) = (head.next(), head.next()) else {
                continue;
            };
            let root = decode(root);
            let mount = decode(mount);
            let relative = if root == "/" {
                member.trim_start_matches('/')
            } else if member == root || member == "/" {
                ""
            } else if let Some(relative) = member.strip_prefix(&format!("{root}/")) {
                relative
            } else {
                continue;
            };
            let path = if relative.is_empty() {
                mount.clone()
            } else {
                format!("{}/{relative}", mount.trim_end_matches('/'))
            };
            result.push(MemoryCgroup {
                mount,
                path,
                unified,
            });
        }
    }
    result
}

/// Apply a finite kernel ceiling and its current usage without inventing free RAM.
pub fn constrain_memory(memory: &mut Memory, ceiling: &str, usage: Option<&str>) {
    let Some((ceiling, available)) = memory_budget(ceiling, usage) else {
        return;
    };
    memory.total_mib = memory.total_mib.min(ceiling / MIB);
    memory.available_mib = memory
        .available_mib
        .min(available / MIB)
        .min(memory.total_mib);
}

/// Bytes retained without MiB rounding for process.availableMemory().
pub fn memory_budget(ceiling: &str, usage: Option<&str>) -> Option<(u64, u64)> {
    let ceiling = ceiling.trim().parse::<u64>().ok()?;
    // cgroup v1 represents unlimited as PAGE_COUNTER_MAX (LONG_MAX rounded
    // down to a page), unlike v2's literal "max". Do not expose it as a limit.
    if ceiling >= (i64::MAX as u64 & !65535) {
        return None;
    }
    let available = usage
        .and_then(|text| text.trim().parse::<u64>().ok())
        .map(|used| ceiling.saturating_sub(used))
        .unwrap_or(0);
    Some((ceiling, available))
}

/// CPU flags worth routing on.
pub const WANTED_FLAGS: &[&str] = &[
    "avx",
    "avx2",
    "avx_vnni",
    "avx512f",
    "avx512bw",
    "avx512vnni",
    "amx_tile",
    "amx_bf16",
    "amx_int8",
];

fn kib_field(text: &str, key: &str) -> Option<u64> {
    text.lines().find_map(|line| {
        let rest = line.strip_prefix(key)?.strip_prefix(':')?;
        rest.split_whitespace().next()?.parse().ok()
    })
}

/// `/proc/meminfo`.
pub fn meminfo(text: &str) -> Memory {
    let get = |key| kib_field(text, key).unwrap_or(0) / 1024;
    let available = match kib_field(text, "MemAvailable") {
        Some(kib) => kib / 1024,
        None => {
            let kib = |key| kib_field(text, key).unwrap_or(0);
            (kib("MemFree") + kib("Buffers") + kib("Cached")) / 1024
        }
    };
    Memory {
        total_mib: get("MemTotal"),
        available_mib: available,
        swap_total_mib: get("SwapTotal"),
        swap_free_mib: get("SwapFree"),
        ..Memory::default()
    }
}

/// `/proc/pressure/memory`: `(some avg10, full avg10)`.
pub fn psi(text: &str) -> (Option<f64>, Option<f64>) {
    let avg10 = |kind: &str| {
        let line = text.lines().find(|l| l.starts_with(kind))?;
        line.split_whitespace()
            .find_map(|t| t.strip_prefix("avg10="))?
            .parse()
            .ok()
    };
    (avg10("some"), avg10("full"))
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct CpuInfo {
    pub model: String,
    pub logical: u32,
    pub physical: Option<u32>,
    pub flags: Vec<String>,
}

/// `/proc/cpuinfo` (x86 and arm64 layouts).
pub fn cpuinfo(text: &str) -> CpuInfo {
    let mut info = CpuInfo::default();
    let mut cores = BTreeSet::new();
    let (mut package, mut core) = (None::<&str>, None::<&str>);
    for line in text.lines().chain(std::iter::once("")) {
        let Some((key, value)) = line.split_once(':') else {
            if let (Some(p), Some(c)) = (package.take(), core.take()) {
                cores.insert((p, c));
            }
            continue;
        };
        let (key, value) = (key.trim(), value.trim());
        match key {
            "processor" => info.logical += 1,
            "model name" | "Model" | "Hardware" if info.model.is_empty() => {
                info.model = value.to_string()
            }
            "physical id" => package = Some(value),
            "core id" => core = Some(value),
            "flags" | "Features" if info.flags.is_empty() => {
                let have: Vec<&str> = value.split_whitespace().collect();
                info.flags = WANTED_FLAGS
                    .iter()
                    .filter(|f| have.contains(f))
                    .map(|f| (*f).to_string())
                    .collect();
            }
            _ => {}
        }
    }
    if !cores.is_empty() {
        info.physical = Some(cores.len() as u32);
    }
    info
}

/// `/etc/os-release`: `(name, version)`.
pub fn os_release(text: &str) -> (String, String) {
    let value = |key: &str| {
        text.lines().find_map(|line| {
            let rest = line.strip_prefix(key)?.strip_prefix('=')?;
            Some(
                rest.trim()
                    .trim_matches(|c| c == '"' || c == '\'')
                    .to_string(),
            )
        })
    };
    let name = value("PRETTY_NAME")
        .or_else(|| value("NAME"))
        .unwrap_or_default();
    let version = value("VERSION_ID")
        .or_else(|| value("VERSION"))
        .unwrap_or_default();
    (name, version)
}

/// `nvidia-smi --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader,nounits`.
pub fn nvidia_smi_csv(text: &str) -> Vec<Gpu> {
    text.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split(',').map(str::trim).collect();
            if f.len() < 4 || f[0].is_empty() {
                return None;
            }
            Some(Gpu {
                vendor: "nvidia".into(),
                name: f[0].to_string(),
                vram_total_mib: f[1].parse().ok()?,
                vram_free_mib: f[2].parse().ok(),
                driver: Some(f[3].to_string()),
                cuda: None,
            })
        })
        .collect()
}

/// The `CUDA Version: 12.4` (or `CUDA UMD Version: 13.4`) cell of the `nvidia-smi` banner.
pub fn nvidia_cuda_version(text: &str) -> Option<String> {
    let marker = ["CUDA Version:", "CUDA UMD Version:"]
        .iter()
        .find_map(|m| text.find(m).map(|i| i + m.len()))?;
    let token = text[marker..].split_whitespace().next()?;
    token
        .starts_with(|c: char| c.is_ascii_digit())
        .then(|| token.to_string())
}

/// `lsblk -J -b -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT,ROTA,TRAN,MODEL`: device name to disk kind.
pub fn lsblk_kinds(text: &str) -> HashMap<String, String> {
    fn walk(
        node: &serde_json::Value,
        inherited: Option<&'static str>,
        out: &mut HashMap<String, String>,
    ) {
        let Some(name) = node.get("name").and_then(|v| v.as_str()) else {
            return;
        };
        let tran = node.get("tran").and_then(|v| v.as_str());
        let own = if name.starts_with("nvme") || tran == Some("nvme") {
            Some("nvme")
        } else {
            match node.get("rota") {
                Some(serde_json::Value::Bool(true)) => Some("hdd"),
                Some(serde_json::Value::Bool(false)) => Some("ssd"),
                // Older lsblk prints "0"/"1".
                Some(serde_json::Value::String(s)) if s == "1" => Some("hdd"),
                Some(serde_json::Value::String(s)) if s == "0" => Some("ssd"),
                _ => None,
            }
        };
        let is_disk = node.get("type").and_then(|v| v.as_str()) == Some("disk");
        let kind = if is_disk { own } else { inherited.or(own) };
        out.insert(name.to_string(), kind.unwrap_or("unknown").to_string());
        for child in node
            .get("children")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            walk(child, kind, out);
        }
    }
    let mut out = HashMap::new();
    if let Ok(root) = serde_json::from_str::<serde_json::Value>(text) {
        for node in root
            .get("blockdevices")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            walk(node, None, &mut out);
        }
    }
    out
}

const PSEUDO_FS: &[&str] = &[
    "tmpfs",
    "devtmpfs",
    "overlay",
    "squashfs",
    "proc",
    "sysfs",
    "ramfs",
    "devfs",
    "efivarfs",
    "fuse.lxcfs",
    "cgroup",
    "cgroup2",
    "autofs",
    "debugfs",
    "tracefs",
    "securityfs",
    "pstore",
    "bpf",
    "configfs",
    "fusectl",
    "mqueue",
    "hugetlbfs",
    "nsfs",
    "binfmt_misc",
    "9p",
    "drvfs",
];

/// `df -P -T -B1`: real filesystems only; `kind` is filled in by the caller.
pub fn df(text: &str) -> Vec<Disk> {
    text.lines()
        .skip(1)
        .filter_map(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            if f.len() < 7 || PSEUDO_FS.contains(&f[1]) {
                return None;
            }
            let mount = f[6..].join(" ");
            let virtual_mount = ["/run", "/dev", "/sys", "/proc", "/snap"].iter().any(|p| {
                mount == *p
                    || mount
                        .strip_prefix(p)
                        .is_some_and(|rest| rest.starts_with('/'))
            });
            if virtual_mount {
                return None;
            }
            Some(Disk {
                mount,
                device: f[0].to_string(),
                fs: f[1].to_string(),
                total_mib: f[2].parse::<u64>().ok()? / MIB,
                free_mib: f[4].parse::<u64>().ok()? / MIB,
                kind: "unknown".into(),
            })
        })
        .collect()
}

pub fn wireguard_like(iface: &str, ip: &str, prefixes: &[String]) -> bool {
    let lower = iface.to_ascii_lowercase();
    lower.starts_with("wg")
        || lower.contains("wireguard")
        || prefixes.iter().any(|p| ip.starts_with(p.as_str()))
}

/// `ip -o -4 addr show`: interfaces that look like WireGuard (`wg*` name, or an address under one of
/// `prefixes`, e.g. `10.200.`).
pub fn ip_addr(text: &str, prefixes: &[String]) -> Vec<Address> {
    text.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            let iface = f.get(1)?.trim_end_matches(':');
            let at = f.iter().position(|t| *t == "inet")?;
            let ip = f.get(at + 1)?.split('/').next()?;
            wireguard_like(iface, ip, prefixes).then(|| Address {
                iface: iface.into(),
                ip: ip.into(),
            })
        })
        .collect()
}

pub type Row = HashMap<String, String>;

fn split_csv_line(line: &str) -> Vec<String> {
    let (mut out, mut cur, mut quoted) = (Vec::new(), String::new(), false);
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cur.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => out.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    out.push(cur);
    out
}

/// CSV with a header line, from `wmic ... /format:csv` or PowerShell `ConvertTo-Csv`. Keys are lowercased.
pub fn csv(text: &str) -> Vec<Row> {
    let mut lines = text
        .lines()
        .map(|l| l.trim_matches(|c| c == '\r' || c == '\u{feff}'))
        .filter(|l| !l.trim().is_empty());
    let Some(header) = lines.next() else {
        return Vec::new();
    };
    let keys: Vec<String> = split_csv_line(header)
        .iter()
        .map(|k| k.trim().to_ascii_lowercase())
        .collect();
    lines
        .map(|line| {
            let values = split_csv_line(line);
            keys.iter()
                .cloned()
                .zip(values.into_iter().map(|v| v.trim().to_string()))
                .collect()
        })
        .collect()
}

fn num(row: &Row, key: &str) -> Option<u64> {
    row.get(key)?.parse().ok()
}

/// `Win32_VideoController` (Name, AdapterRAM, DriverVersion). `AdapterRAM` is a 32-bit field: it
/// caps at 4 GiB, so `nvidia-smi` figures replace it where available.
pub fn windows_gpus(text: &str) -> Vec<Gpu> {
    csv(text)
        .iter()
        .filter_map(|row| {
            let name = row.get("name").filter(|n| !n.is_empty())?;
            if name.contains("Basic Display") || name.contains("Remote Display") {
                return None;
            }
            let lower = name.to_ascii_lowercase();
            let vendor = if lower.contains("nvidia") {
                "nvidia"
            } else if lower.contains("amd") || lower.contains("radeon") {
                "amd"
            } else if lower.contains("intel") {
                "intel"
            } else {
                "other"
            };
            Some(Gpu {
                vendor: vendor.into(),
                name: name.clone(),
                vram_total_mib: num(row, "adapterram").unwrap_or(0) / MIB,
                vram_free_mib: None,
                driver: row.get("driverversion").filter(|d| !d.is_empty()).cloned(),
                cuda: None,
            })
        })
        .collect()
}

/// `Win32_LogicalDisk` (DeviceID, FileSystem, Size, FreeSpace, DriveType); fixed disks only.
pub fn windows_disks(text: &str, kind: &str) -> Vec<Disk> {
    csv(text)
        .iter()
        .filter(|row| num(row, "drivetype") == Some(3))
        .filter_map(|row| {
            let id = row.get("deviceid")?;
            Some(Disk {
                mount: format!("{id}\\"),
                device: id.clone(),
                fs: row.get("filesystem").cloned().unwrap_or_default(),
                total_mib: num(row, "size")? / MIB,
                free_mib: num(row, "freespace").unwrap_or(0) / MIB,
                kind: kind.into(),
            })
        })
        .collect()
}

/// `Get-PhysicalDisk` (MediaType, BusType): one kind when every disk agrees, else `unknown`.
pub fn windows_disk_kind(text: &str) -> String {
    let kinds: BTreeSet<&'static str> = csv(text)
        .iter()
        .map(|row| {
            let bus = row
                .get("bustype")
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();
            let media = row
                .get("mediatype")
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();
            match (bus.as_str(), media.as_str()) {
                ("nvme", _) => "nvme",
                (_, "hdd") => "hdd",
                (_, "ssd") => "ssd",
                _ => "unknown",
            }
        })
        .collect();
    match kinds.len() {
        1 => kinds.into_iter().next().unwrap_or("unknown").to_string(),
        _ => "unknown".into(),
    }
}

/// `Get-NetIPAddress` rows (InterfaceAlias, IPAddress).
pub fn windows_addresses(text: &str, prefixes: &[String]) -> Vec<Address> {
    csv(text)
        .iter()
        .filter_map(|row| {
            let iface = row.get("interfacealias")?;
            let ip = row.get("ipaddress")?;
            wireguard_like(iface, ip, prefixes).then(|| Address {
                iface: iface.clone(),
                ip: ip.clone(),
            })
        })
        .collect()
}

#[derive(Debug, Default, PartialEq)]
pub struct WindowsSystem {
    pub caption: String,
    pub version: String,
    pub build: String,
    pub memory: Memory,
}

/// `Win32_OperatingSystem` (Caption, Version, BuildNumber, memory sizes in KiB).
pub fn windows_system(text: &str) -> Option<WindowsSystem> {
    let rows = csv(text);
    let row = rows.first()?;
    let kib = |k| num(row, k).unwrap_or(0) / 1024;
    let total = kib("totalvisiblememorysize");
    // The virtual size is RAM plus the page file.
    let swap_total = kib("totalvirtualmemorysize").saturating_sub(total);
    Some(WindowsSystem {
        caption: row.get("caption").cloned().unwrap_or_default(),
        version: row.get("version").cloned().unwrap_or_default(),
        build: row.get("buildnumber").cloned().unwrap_or_default(),
        memory: Memory {
            total_mib: total,
            available_mib: kib("freephysicalmemory"),
            swap_total_mib: swap_total,
            swap_free_mib: kib("freevirtualmemory").min(swap_total),
            ..Memory::default()
        },
    })
}

/// `Win32_Processor` (Name, NumberOfCores, NumberOfLogicalProcessors), summed over sockets.
pub fn windows_cpu(text: &str) -> Option<(String, u32, u32)> {
    let rows = csv(text);
    let first = rows.first()?;
    let sum = |k| rows.iter().filter_map(|r| num(r, k)).sum::<u64>() as u32;
    Some((
        first.get("name").cloned().unwrap_or_default(),
        sum("numberofcores"),
        sum("numberoflogicalprocessors"),
    ))
}
