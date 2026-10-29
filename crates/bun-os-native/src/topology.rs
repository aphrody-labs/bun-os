// SPDX-License-Identifier: Apache-2.0
//! Host hardware topology: logical CPUs, physical memory, AVX2 and CUDA devices.
//!
//! Every value is probed at call time from the operating system. A value the current platform
//! cannot report is `0` / `false`, never an invented default.

use serde::{Deserialize, Serialize};

use crate::cuda;

/// Hardware topology of the host, probed by [`SystemTopology::probe`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemTopology {
    /// Logical CPUs available to this process.
    pub cpu_count: u32,
    /// Installed physical memory in MiB (`0` when the platform cannot report it).
    pub memory_total_mb: u32,
    /// Physical memory currently available in MiB (`0` when the platform cannot report it).
    pub memory_available_mb: u32,
    /// Whether the CPU supports AVX2 (always `false` outside x86 / x86_64).
    pub has_avx2: bool,
    /// Whether the CUDA driver is installed and reports at least one device.
    pub has_cuda: bool,
    /// Number of CUDA devices reported by the driver.
    pub cuda_device_count: u32,
    /// Total VRAM of all CUDA devices in MiB (`0` when the driver cannot report it).
    pub cuda_vram_total_mb: u32,
}

impl SystemTopology {
    /// Probes the host.
    ///
    /// CPU and memory figures are read on every call. The CUDA driver is queried once per process
    /// and cached, because driver initialisation is expensive and the device set does not change
    /// while the process runs.
    #[must_use]
    pub fn probe() -> Self {
        let memory = probe_memory();
        let cuda = cuda::probe();
        Self {
            cpu_count: cpu_count(),
            memory_total_mb: memory.map_or(0, |m| m.total_mb),
            memory_available_mb: memory.map_or(0, |m| m.available_mb),
            has_avx2: has_avx2(),
            has_cuda: cuda.is_some(),
            cuda_device_count: cuda.map_or(0, |c| c.device_count),
            cuda_vram_total_mb: cuda.map_or(0, |c| c.vram_total_mb),
        }
    }
}

/// Converts a byte count to whole MiB, saturating at `u32::MAX`.
pub(crate) fn bytes_to_mib(bytes: u64) -> u32 {
    u32::try_from(bytes / (1024 * 1024)).unwrap_or(u32::MAX)
}

fn cpu_count() -> u32 {
    std::thread::available_parallelism().map_or(1, |n| u32::try_from(n.get()).unwrap_or(u32::MAX))
}

#[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
fn has_avx2() -> bool {
    std::arch::is_x86_feature_detected!("avx2")
}

#[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
fn has_avx2() -> bool {
    false
}

/// Physical memory figures in MiB.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MemoryInfo {
    total_mb: u32,
    available_mb: u32,
}

#[cfg(windows)]
fn probe_memory() -> Option<MemoryInfo> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut status = MEMORYSTATUSEX {
        dwLength: u32::try_from(size_of::<MEMORYSTATUSEX>()).ok()?,
        ..Default::default()
    };
    // SAFETY: `status` is a live, writable MEMORYSTATUSEX and `dwLength` holds its size, which is
    // the only precondition of GlobalMemoryStatusEx.
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
    (ok != 0).then(|| MemoryInfo {
        total_mb: bytes_to_mib(status.ullTotalPhys),
        available_mb: bytes_to_mib(status.ullAvailPhys),
    })
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn probe_memory() -> Option<MemoryInfo> {
    parse_meminfo(&std::fs::read_to_string("/proc/meminfo").ok()?)
}

#[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
fn probe_memory() -> Option<MemoryInfo> {
    None
}

/// Parses `/proc/meminfo`. `MemAvailable` (Linux 3.14+) is preferred over `MemFree`, which
/// ignores reclaimable page cache.
#[cfg(any(target_os = "linux", target_os = "android", test))]
fn parse_meminfo(text: &str) -> Option<MemoryInfo> {
    let field = |name: &str| -> Option<u64> {
        text.lines().find_map(|line| {
            let rest = line.strip_prefix(name)?.strip_prefix(':')?;
            let kib = rest.trim().strip_suffix("kB").unwrap_or(rest).trim();
            kib.parse::<u64>().ok()
        })
    };
    let total_kib = field("MemTotal")?;
    let available_kib = field("MemAvailable")
        .or_else(|| field("MemFree"))
        .unwrap_or(0);
    Some(MemoryInfo {
        total_mb: bytes_to_mib(total_kib.saturating_mul(1024)),
        available_mb: bytes_to_mib(available_kib.saturating_mul(1024)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_to_mib_rounds_down_and_saturates() {
        assert_eq!(bytes_to_mib(0), 0);
        assert_eq!(bytes_to_mib(1024 * 1024 - 1), 0);
        assert_eq!(bytes_to_mib(3 * 1024 * 1024 + 1), 3);
        assert_eq!(bytes_to_mib(u64::MAX), u32::MAX);
    }

    #[test]
    fn parse_meminfo_prefers_mem_available() {
        let text = "MemTotal:       32768000 kB\nMemFree:         1024000 kB\n\
                    MemAvailable:   16384000 kB\nBuffers:          204800 kB\n";
        let info = parse_meminfo(text).expect("MemTotal is present");
        assert_eq!(
            info,
            MemoryInfo {
                total_mb: 32_000,
                available_mb: 16_000
            }
        );
    }

    #[test]
    fn parse_meminfo_falls_back_to_mem_free() {
        let info = parse_meminfo("MemTotal: 2048000 kB\nMemFree: 1024000 kB\n")
            .expect("MemTotal is present");
        assert_eq!(
            info,
            MemoryInfo {
                total_mb: 2_000,
                available_mb: 1_000
            }
        );
    }

    #[test]
    fn parse_meminfo_rejects_missing_total() {
        assert_eq!(parse_meminfo("MemFree: 1024 kB\n"), None);
        assert_eq!(parse_meminfo(""), None);
    }

    #[test]
    fn probe_reports_consistent_values() {
        let topology = SystemTopology::probe();
        assert!(topology.cpu_count >= 1);
        assert!(topology.memory_available_mb <= topology.memory_total_mb);
        if cfg!(any(windows, target_os = "linux")) {
            assert!(
                topology.memory_total_mb > 0,
                "memory is probed on this platform"
            );
        }
        assert_eq!(topology.has_cuda, topology.cuda_device_count > 0);
        if !topology.has_cuda {
            assert_eq!(topology.cuda_vram_total_mb, 0);
        }
    }

    #[test]
    fn topology_round_trips_through_json() {
        let topology = SystemTopology::probe();
        let json = serde_json::to_value(topology).expect("serializes");
        for key in [
            "cpu_count",
            "memory_total_mb",
            "memory_available_mb",
            "has_avx2",
            "has_cuda",
            "cuda_device_count",
            "cuda_vram_total_mb",
        ] {
            assert!(json.get(key).is_some(), "missing field {key}");
        }
        let back: SystemTopology = serde_json::from_value(json).expect("deserializes");
        assert_eq!(back, topology);
    }
}
