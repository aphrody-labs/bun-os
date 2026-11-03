//! `HostInfo`: the card of one machine. Schema version [`SCHEMA`]; `schema_json()` is the JSON
//! Schema served by `bunos host schema` and referenced by the `host_*` MCP tools.

use serde::{Deserialize, Serialize};

pub const SCHEMA: u32 = 1;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct HostInfo {
    pub schema: u32,
    pub id: String,
    /// Unix milliseconds of the collection.
    pub collected_at: u64,
    pub os: Os,
    pub kernel: Kernel,
    pub cpu: Cpu,
    pub memory: Memory,
    pub gpus: Vec<Gpu>,
    pub disks: Vec<Disk>,
    pub network: Network,
    pub uptime_s: Option<u64>,
    /// Optional additive inventory; old schema-1 cards remain readable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<EnvironmentInfo>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct EnvironmentInfo {
    /// Provider hints, not an assertion of credentials or service access.
    pub providers: Vec<String>,
    pub serverless: Option<bool>,
    pub container: Option<String>,
    pub virtualization: Option<String>,
    pub device: Option<String>,
    pub cpu_vendor: Option<String>,
    pub gpu_vendors: Vec<String>,
    pub windows_11: Option<bool>,
    pub display_protocol: Option<String>,
    /// Environment advertises a display; its connectivity is not probed.
    pub display_advertised: bool,
    pub stdin_terminal: bool,
    pub stdout_terminal: bool,
    pub real_uid: Option<u32>,
    pub effective_uid: Option<u32>,
    pub elevation: String,
    pub sudo_context: bool,
    pub parent_pid: Option<u32>,
    pub parent_name: Option<String>,
    pub parent_shell: Option<String>,
    pub default_ipv4_route: Option<bool>,
    pub default_ipv6_route: Option<bool>,
    /// No arbitrary internet request is made to establish this capability.
    pub outbound_network: Option<bool>,
    /// std's process-visible parallelism estimate, separate from hardware cores.
    pub available_parallelism: Option<u32>,
    /// Advisory concurrency bounded by already collected CPU and RAM budgets.
    pub recommended_workers: u32,
}

impl Default for EnvironmentInfo {
    fn default() -> Self {
        Self {
            providers: Vec::new(),
            serverless: None,
            container: None,
            virtualization: None,
            device: None,
            cpu_vendor: None,
            gpu_vendors: Vec::new(),
            windows_11: None,
            display_protocol: None,
            display_advertised: false,
            stdin_terminal: false,
            stdout_terminal: false,
            real_uid: None,
            effective_uid: None,
            elevation: "unknown".into(),
            sudo_context: false,
            parent_pid: None,
            parent_name: None,
            parent_shell: None,
            default_ipv4_route: None,
            default_ipv6_route: None,
            outbound_network: None,
            available_parallelism: None,
            recommended_workers: 1,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Os {
    /// `linux`, `windows`, `macos`.
    pub family: String,
    pub name: String,
    pub version: String,
    /// Windows build number.
    pub build: Option<String>,
    pub arch: String,
    /// `glibc`, `musl` or `msvc`/`system` where there is no choice.
    pub libc: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kernel {
    pub release: String,
    pub cgroup_v2: bool,
    pub io_uring: bool,
    pub wsl: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cpu {
    pub model: String,
    pub physical_cores: Option<u32>,
    pub logical_cores: u32,
    /// Subset of `avx`, `avx2`, `avx_vnni`, `avx512f`, `avx512bw`, `avx512vnni`, `amx_tile`, `amx_bf16`, `amx_int8`.
    pub flags: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Memory {
    pub total_mib: u64,
    pub available_mib: u64,
    pub swap_total_mib: u64,
    pub swap_free_mib: u64,
    /// Linux pressure stall information (`/proc/pressure/memory`), avg10 in percent.
    pub psi_some_avg10: Option<f64>,
    pub psi_full_avg10: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gpu {
    /// `nvidia`, `amd`, `intel`, `other`.
    pub vendor: String,
    pub name: String,
    pub vram_total_mib: u64,
    /// Absent where the driver does not report it.
    pub vram_free_mib: Option<u64>,
    pub driver: Option<String>,
    pub cuda: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Disk {
    pub mount: String,
    pub device: String,
    pub fs: String,
    pub total_mib: u64,
    pub free_mib: u64,
    /// `nvme`, `ssd`, `hdd` or `unknown`.
    pub kind: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Network {
    pub wireguard: Vec<Address>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Address {
    pub iface: String,
    pub ip: String,
}

/// JSON Schema (draft 2020-12) of a [`HostInfo`].
pub fn schema_json() -> &'static str {
    SCHEMA_JSON
}

const SCHEMA_JSON: &str = r##"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://bun.sh/schemas/host-info-1.json",
  "title": "HostInfo",
  "type": "object",
  "required": ["schema", "id", "collected_at", "os", "kernel", "cpu", "memory", "gpus", "disks", "network"],
  "properties": {
    "schema": { "const": 1 },
    "id": { "type": "string" },
    "collected_at": { "type": "integer", "description": "Unix milliseconds" },
    "os": {
      "type": "object",
      "required": ["family", "name", "version", "arch", "libc"],
      "properties": {
        "family": { "enum": ["linux", "windows", "macos"] },
        "name": { "type": "string" },
        "version": { "type": "string" },
        "build": { "type": ["string", "null"] },
        "arch": { "type": "string" },
        "libc": { "type": "string" }
      }
    },
    "kernel": {
      "type": "object",
      "required": ["release", "cgroup_v2", "io_uring", "wsl"],
      "properties": {
        "release": { "type": "string" },
        "cgroup_v2": { "type": "boolean" },
        "io_uring": { "type": "boolean" },
        "wsl": { "type": "boolean" }
      }
    },
    "cpu": {
      "type": "object",
      "required": ["model", "logical_cores", "flags"],
      "properties": {
        "model": { "type": "string" },
        "physical_cores": { "type": ["integer", "null"] },
        "logical_cores": { "type": "integer" },
        "flags": { "type": "array", "items": { "type": "string" } }
      }
    },
    "memory": {
      "type": "object",
      "required": ["total_mib", "available_mib", "swap_total_mib", "swap_free_mib"],
      "properties": {
        "total_mib": { "type": "integer" },
        "available_mib": { "type": "integer" },
        "swap_total_mib": { "type": "integer" },
        "swap_free_mib": { "type": "integer" },
        "psi_some_avg10": { "type": ["number", "null"] },
        "psi_full_avg10": { "type": ["number", "null"] }
      }
    },
    "gpus": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["vendor", "name", "vram_total_mib"],
        "properties": {
          "vendor": { "enum": ["nvidia", "amd", "intel", "apple", "other"] },
          "name": { "type": "string" },
          "vram_total_mib": { "type": "integer" },
          "vram_free_mib": { "type": ["integer", "null"] },
          "driver": { "type": ["string", "null"] },
          "cuda": { "type": ["string", "null"] }
        }
      }
    },
    "disks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["mount", "device", "fs", "total_mib", "free_mib", "kind"],
        "properties": {
          "mount": { "type": "string" },
          "device": { "type": "string" },
          "fs": { "type": "string" },
          "total_mib": { "type": "integer" },
          "free_mib": { "type": "integer" },
          "kind": { "enum": ["nvme", "ssd", "hdd", "unknown"] }
        }
      }
    },
    "network": {
      "type": "object",
      "required": ["wireguard"],
      "properties": {
        "wireguard": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["iface", "ip"],
            "properties": { "iface": { "type": "string" }, "ip": { "type": "string" } }
          }
        }
      }
    },
    "uptime_s": { "type": ["integer", "null"] },
    "environment": {
      "type": ["object", "null"],
      "properties": {
        "providers": { "type": "array", "items": { "type": "string" } },
        "serverless": { "type": ["boolean", "null"] },
        "container": { "type": ["string", "null"] },
        "virtualization": { "type": ["string", "null"] },
        "device": { "type": ["string", "null"] },
        "cpu_vendor": { "type": ["string", "null"] },
        "gpu_vendors": { "type": "array", "items": { "type": "string" } },
        "windows_11": { "type": ["boolean", "null"] },
        "display_protocol": { "type": ["string", "null"] },
        "display_advertised": { "type": "boolean" },
        "stdin_terminal": { "type": "boolean" },
        "stdout_terminal": { "type": "boolean" },
        "real_uid": { "type": ["integer", "null"] },
        "effective_uid": { "type": ["integer", "null"] },
        "elevation": { "enum": ["root", "administrator", "user", "unknown"] },
        "sudo_context": { "type": "boolean" },
        "parent_pid": { "type": ["integer", "null"] },
        "parent_name": { "type": ["string", "null"] },
        "parent_shell": { "type": ["string", "null"] },
        "default_ipv4_route": { "type": ["boolean", "null"] },
        "default_ipv6_route": { "type": ["boolean", "null"] },
        "outbound_network": { "type": ["boolean", "null"] },
        "available_parallelism": { "type": ["integer", "null"], "minimum": 1 },
        "recommended_workers": { "type": "integer", "minimum": 1 }
      }
    }
  }
}"##;
