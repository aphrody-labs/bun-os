// SPDX-License-Identifier: Apache-2.0
//! CUDA device discovery through the CUDA driver API.
//!
//! The driver library (`nvcuda.dll` on Windows, `libcuda.so.1` on Linux) is loaded at run time, so
//! the crate builds and runs on hosts without an NVIDIA driver; the probe then reports no device.
//! Other platforms have no CUDA driver and always report none.

use std::sync::OnceLock;

/// CUDA devices visible to the driver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CudaInfo {
    /// Number of devices reported by `cuDeviceGetCount` (always at least 1).
    pub(crate) device_count: u32,
    /// Sum of `cuDeviceTotalMem_v2` over all devices, in MiB; zero if any query fails.
    pub(crate) vram_total_mb: u32,
}

/// Returns the CUDA devices of the host, or `None` when no driver or no device is present.
///
/// The driver is queried once per process; later calls return the cached result.
pub(crate) fn probe() -> Option<CudaInfo> {
    static PROBE: OnceLock<Option<CudaInfo>> = OnceLock::new();
    *PROBE.get_or_init(driver::probe)
}

#[cfg(any(windows, target_os = "linux"))]
mod driver {
    use std::ffi::{c_int, c_uint};

    use libloading::Library;

    use super::CudaInfo;
    use crate::topology::bytes_to_mib;

    /// `CUDA_SUCCESS` from `cuda.h`.
    const CUDA_SUCCESS: c_int = 0;

    // Driver API prototypes from `cuda.h`: `CUresult` and `CUdevice` are `int`, sizes are `size_t`
    // and `CUDAAPI` is `__stdcall` on Windows, which `extern "system"` selects.
    type CuInit = unsafe extern "system" fn(flags: c_uint) -> c_int;
    type CuDeviceGetCount = unsafe extern "system" fn(count: *mut c_int) -> c_int;
    type CuDeviceGet = unsafe extern "system" fn(device: *mut c_int, ordinal: c_int) -> c_int;
    type CuDeviceTotalMem = unsafe extern "system" fn(bytes: *mut usize, device: c_int) -> c_int;

    pub(super) fn probe() -> Option<CudaInfo> {
        // `cuInit` starts driver threads that must not outlive the driver module, so the library
        // stays loaded for the rest of the process once it has been opened.
        let library: &'static Library = Box::leak(Box::new(load()?));
        query(library)
    }

    #[cfg(windows)]
    fn load() -> Option<Library> {
        use libloading::os::windows::{LOAD_LIBRARY_SEARCH_SYSTEM32, Library as WinLibrary};

        // SAFETY: nvcuda.dll is the NVIDIA driver library, whose initialisation routines are safe
        // to run in any process. Restricting the search to System32 rules out DLL search-order
        // hijacking through the working or application directory.
        unsafe { WinLibrary::load_with_flags("nvcuda.dll", LOAD_LIBRARY_SEARCH_SYSTEM32) }
            .ok()
            .map(Library::from)
    }

    #[cfg(target_os = "linux")]
    fn load() -> Option<Library> {
        ["libcuda.so.1", "libcuda.so"].into_iter().find_map(|name| {
            // SAFETY: libcuda is the NVIDIA driver library, whose initialisation routines are
            // safe to run in any process.
            unsafe { Library::new(name) }.ok()
        })
    }

    fn query(library: &Library) -> Option<CudaInfo> {
        // SAFETY: each symbol is looked up with the prototype `cuda.h` declares for it (see the
        // type aliases above), and the symbols do not outlive `library`.
        let (cu_init, cu_device_get_count, cu_device_get, cu_device_total_mem) = unsafe {
            (
                library.get::<CuInit>(b"cuInit\0").ok()?,
                library.get::<CuDeviceGetCount>(b"cuDeviceGetCount\0").ok()?,
                library.get::<CuDeviceGet>(b"cuDeviceGet\0").ok()?,
                library.get::<CuDeviceTotalMem>(b"cuDeviceTotalMem_v2\0").ok()?,
            )
        };
        device_info(*cu_init, *cu_device_get_count, *cu_device_get, *cu_device_total_mem)
    }

    fn device_info(
        cu_init: CuInit,
        cu_device_get_count: CuDeviceGetCount,
        cu_device_get: CuDeviceGet,
        cu_device_total_mem: CuDeviceTotalMem,
    ) -> Option<CudaInfo> {
        // SAFETY: `cuInit(0)` is the documented first driver call; flags must be 0.
        if unsafe { cu_init(0) } != CUDA_SUCCESS {
            return None;
        }
        let mut count: c_int = 0;
        // SAFETY: `count` is a valid, writable `int` for the duration of the call.
        if unsafe { cu_device_get_count(&raw mut count) } != CUDA_SUCCESS || count <= 0 {
            return None;
        }
        let mut vram_bytes: u64 = 0;
        let mut vram_available = true;
        for ordinal in 0..count {
            let mut device: c_int = 0;
            // SAFETY: `ordinal` is in `0..count` and `device` is a valid, writable `CUdevice`.
            if unsafe { cu_device_get(&raw mut device, ordinal) } != CUDA_SUCCESS {
                vram_available = false;
                continue;
            }
            let mut bytes: usize = 0;
            // SAFETY: `device` was returned by `cuDeviceGet` and `bytes` is a valid, writable
            // `size_t`.
            if unsafe { cu_device_total_mem(&raw mut bytes, device) } == CUDA_SUCCESS {
                vram_bytes = vram_bytes.saturating_add(u64::try_from(bytes).unwrap_or(u64::MAX));
            } else {
                vram_available = false;
            }
        }
        Some(CudaInfo {
            device_count: u32::try_from(count).ok()?,
            vram_total_mb: if vram_available { bytes_to_mib(vram_bytes) } else { 0 },
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        unsafe extern "system" fn init_ok(_flags: c_uint) -> c_int {
            CUDA_SUCCESS
        }

        unsafe extern "system" fn count_one(count: *mut c_int) -> c_int {
            // SAFETY: device_info passes a valid writable count pointer.
            unsafe { *count = 1 };
            CUDA_SUCCESS
        }

        unsafe extern "system" fn device_zero(device: *mut c_int, _ordinal: c_int) -> c_int {
            // SAFETY: device_info passes a valid writable device pointer.
            unsafe { *device = 0 };
            CUDA_SUCCESS
        }

        unsafe extern "system" fn total_mem_ok(bytes: *mut usize, _device: c_int) -> c_int {
            // SAFETY: device_info passes a valid writable size pointer.
            unsafe { *bytes = 2 * 1024 * 1024 };
            CUDA_SUCCESS
        }

        unsafe extern "system" fn total_mem_error(_bytes: *mut usize, _device: c_int) -> c_int {
            1
        }

        #[test]
        fn device_info_keeps_gpu_count_when_vram_query_fails() {
            assert_eq!(
                device_info(init_ok, count_one, device_zero, total_mem_ok),
                Some(CudaInfo { device_count: 1, vram_total_mb: 2 })
            );
            assert_eq!(
                device_info(init_ok, count_one, device_zero, total_mem_error),
                Some(CudaInfo { device_count: 1, vram_total_mb: 0 })
            );
        }
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod driver {
    use super::CudaInfo;

    /// No CUDA driver exists for this platform.
    pub(super) fn probe() -> Option<CudaInfo> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_is_cached_and_consistent() {
        let first = probe();
        assert_eq!(first, probe(), "the driver is queried once per process");
        if let Some(info) = first {
            assert!(info.device_count >= 1);
        }
    }
}
