// SPDX-License-Identifier: Apache-2.0
//! User-mode client of `bunos.sys`: `CreateFileW` + `DeviceIoControl` on `\\.\BunOS` through windows-rs.
//!
//! The control codes mirror `crates/bunos-nt-driver/src/lib.rs` (the contract, docs/NTCORE.md "bunos.sys"); the
//! unit tests pin their numeric values so both sides cannot drift silently.

/// `FILE_DEVICE_UNKNOWN` (winioctl.h).
pub const FILE_DEVICE_UNKNOWN: u32 = 0x22;

/// `CTL_CODE(FILE_DEVICE_UNKNOWN, function, METHOD_BUFFERED, FILE_ANY_ACCESS)`.
pub const fn ctl_code(function: u32) -> u32 {
    (FILE_DEVICE_UNKNOWN << 16) | (function << 2)
}

/// Driver version string (UTF-8, NUL-terminated).
pub const IOCTL_BUNOS_VERSION: u32 = ctl_code(0x800);
/// Echo of the input buffer: the bridge round-trip probe.
pub const IOCTL_BUNOS_PING: u32 = ctl_code(0x801);

/// Win32 path of the device link created by the driver.
pub const DEVICE_PATH: &str = r"\\.\BunOS";

#[derive(Debug)]
pub enum Error {
    /// `\\.\BunOS` does not exist: the driver is not loaded (`ERROR_FILE_NOT_FOUND`).
    NotLoaded,
    /// Any other Win32 failure, with the operation and the HRESULT text from windows-rs.
    Win32 { op: &'static str, code: i32, message: String },
    /// Not Windows.
    Unsupported,
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Error::NotLoaded => write!(f, "{DEVICE_PATH} not found: bunos.sys is not loaded"),
            Error::Win32 { op, code, message } => write!(f, "{op} failed ({code:#010x}): {message}"),
            Error::Unsupported => write!(f, "bunos.sys exists only on Windows"),
        }
    }
}

impl std::error::Error for Error {}

#[cfg(windows)]
mod imp {
    use super::{DEVICE_PATH, Error, IOCTL_BUNOS_PING, IOCTL_BUNOS_VERSION};
    use windows::Win32::Foundation::{CloseHandle, ERROR_FILE_NOT_FOUND, GENERIC_READ, GENERIC_WRITE, HANDLE};
    use windows::Win32::Storage::FileSystem::{CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_NONE, OPEN_EXISTING};
    use windows::Win32::System::IO::DeviceIoControl;
    use windows::core::HSTRING;

    fn win32(op: &'static str, e: windows::core::Error) -> Error {
        Error::Win32 { op, code: e.code().0, message: e.message() }
    }

    /// An open handle on `\\.\BunOS`, closed on drop.
    pub struct Device(HANDLE);

    // SAFETY: a device handle may be used from any thread; the driver completes each IRP synchronously.
    unsafe impl Send for Device {}

    impl Device {
        pub fn open() -> Result<Self, Error> {
            // SAFETY: CreateFileW on a NUL-terminated wide path; the returned handle is owned by Device.
            let handle = unsafe {
                CreateFileW(
                    &HSTRING::from(DEVICE_PATH),
                    (GENERIC_READ | GENERIC_WRITE).0,
                    FILE_SHARE_NONE,
                    None,
                    OPEN_EXISTING,
                    FILE_FLAGS_AND_ATTRIBUTES(0),
                    None,
                )
            };
            match handle {
                Ok(h) => Ok(Device(h)),
                Err(e) if e.code() == ERROR_FILE_NOT_FOUND.to_hresult() => Err(Error::NotLoaded),
                Err(e) => Err(win32("CreateFileW", e)),
            }
        }

        /// One METHOD_BUFFERED round trip; returns the number of bytes the driver wrote to `output`.
        pub fn ioctl(&self, code: u32, input: &[u8], output: &mut [u8]) -> Result<usize, Error> {
            let mut returned = 0u32;
            // SAFETY: both buffers are valid for their lengths for the duration of the synchronous call.
            unsafe {
                DeviceIoControl(
                    self.0,
                    code,
                    (!input.is_empty()).then_some(input.as_ptr().cast()),
                    input.len() as u32,
                    (!output.is_empty()).then_some(output.as_mut_ptr().cast()),
                    output.len() as u32,
                    Some(&mut returned),
                    None,
                )
            }
            .map_err(|e| win32("DeviceIoControl", e))?;
            Ok(returned as usize)
        }

        pub fn version(&self) -> Result<String, Error> {
            let mut buf = [0u8; 128];
            let n = self.ioctl(IOCTL_BUNOS_VERSION, &[], &mut buf)?;
            let bytes = &buf[..n];
            let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
            Ok(String::from_utf8_lossy(&bytes[..end]).into_owned())
        }

        pub fn ping(&self, data: &[u8]) -> Result<Vec<u8>, Error> {
            let mut out = vec![0u8; data.len()];
            let n = self.ioctl(IOCTL_BUNOS_PING, data, &mut out)?;
            out.truncate(n);
            Ok(out)
        }
    }

    impl Drop for Device {
        fn drop(&mut self) {
            // SAFETY: the handle came from CreateFileW and is closed exactly once.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Error;

    pub struct Device;

    impl Device {
        pub fn open() -> Result<Self, Error> {
            Err(Error::Unsupported)
        }
        pub fn ioctl(&self, _code: u32, _input: &[u8], _output: &mut [u8]) -> Result<usize, Error> {
            Err(Error::Unsupported)
        }
        pub fn version(&self) -> Result<String, Error> {
            Err(Error::Unsupported)
        }
        pub fn ping(&self, _data: &[u8]) -> Result<Vec<u8>, Error> {
            Err(Error::Unsupported)
        }
    }
}

pub use imp::Device;

/// True when `\\.\BunOS` can be opened (driver loaded and accessible).
pub fn available() -> bool {
    Device::open().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_codes_match_the_driver() {
        // CTL_CODE(0x22, 0x800/0x801, METHOD_BUFFERED = 0, FILE_ANY_ACCESS = 0).
        assert_eq!(IOCTL_BUNOS_VERSION, 0x0022_2000);
        assert_eq!(IOCTL_BUNOS_PING, 0x0022_2004);
    }

    #[test]
    fn device_round_trip_when_loaded() {
        let device = match Device::open() {
            Ok(d) => d,
            Err(Error::NotLoaded | Error::Unsupported) => {
                eprintln!("skip: {DEVICE_PATH} absent (driver not loaded)");
                return;
            }
            Err(e) => panic!("{e}"),
        };
        assert!(device.version().unwrap().starts_with("bunos.sys "));
        let payload: Vec<u8> = (0..=255u8).collect();
        assert_eq!(device.ping(&payload).unwrap(), payload);
    }
}
