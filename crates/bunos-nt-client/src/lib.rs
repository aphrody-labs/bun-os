// SPDX-License-Identifier: Apache-2.0
//! User-mode client of `bunos.sys`: `CreateFileW` + `DeviceIoControl` on `\\.\BunOS` through windows-rs.
//!
//! The control codes and layouts come from `bunos-nt-proto`, the very crate the driver parses with, so the two sides
//! cannot drift. The device DACL admits SYSTEM and Administrators only: from a non-elevated process `open` reports
//! [`Error::AccessDenied`].

pub use bunos_nt_proto::{
    self as proto, Caps, DEVICE_PATH, EventsConfig, EventsHeader, IOCTL_BUNOS_CAPS, IOCTL_BUNOS_EVENTS_CONFIG,
    IOCTL_BUNOS_EVENTS_READ, IOCTL_BUNOS_PING, IOCTL_BUNOS_VERSION, Kind, ProtoError, Record, ctl_code, source,
};

#[derive(Debug)]
pub enum Error {
    /// `\\.\BunOS` does not exist: the driver is not loaded (`ERROR_FILE_NOT_FOUND`).
    NotLoaded,
    /// The device exists but this process is not elevated (`ERROR_ACCESS_DENIED`; DACL SYSTEM + Administrators).
    AccessDenied,
    /// Any other Win32 failure, with the operation and the HRESULT text from windows-rs.
    Win32 { op: &'static str, code: i32, message: String },
    /// The driver answered with a layout this client rejects.
    Proto(ProtoError),
    /// Not Windows.
    Unsupported,
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Error::NotLoaded => write!(f, "{DEVICE_PATH} not found: bunos.sys is not loaded"),
            Error::AccessDenied => write!(f, "{DEVICE_PATH} is restricted to SYSTEM and Administrators"),
            Error::Win32 { op, code, message } => write!(f, "{op} failed ({code:#010x}): {message}"),
            Error::Proto(e) => write!(f, "bunos.sys reply rejected: {e}"),
            Error::Unsupported => write!(f, "bunos.sys exists only on Windows"),
        }
    }
}

impl std::error::Error for Error {}

impl From<ProtoError> for Error {
    fn from(e: ProtoError) -> Self {
        Error::Proto(e)
    }
}

/// One decoded event, owned (name as a Rust string).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Event {
    pub kind: Kind,
    pub time: i64,
    pub pid: u64,
    pub a0: u64,
    pub a1: u64,
    pub name: String,
    pub truncated: bool,
    pub kernel_image: bool,
}

impl From<&Record> for Event {
    fn from(r: &Record) -> Self {
        Event {
            kind: r.kind,
            time: r.time,
            pid: r.pid,
            a0: r.a0,
            a1: r.a1,
            name: String::from_utf16_lossy(r.name_units()),
            truncated: r.flags & proto::flag::NAME_TRUNCATED != 0,
            kernel_image: r.flags & proto::flag::KERNEL_IMAGE != 0,
        }
    }
}

/// Result of one drain of the kernel ring.
#[derive(Clone, Debug, Default)]
pub struct Batch {
    pub events: Vec<Event>,
    pub dropped: u32,
    pub pending: u32,
}

/// Decodes an `IOCTL_BUNOS_EVENTS_READ` reply (pure: unit-tested without the driver).
pub fn decode_batch(bytes: &[u8]) -> Result<Batch, ProtoError> {
    let (header, records) = proto::parse_events(bytes)?;
    let mut events = Vec::with_capacity(header.count as usize);
    for r in records {
        events.push(Event::from(&r?));
    }
    Ok(Batch { events, dropped: header.dropped, pending: header.pending })
}

#[cfg(windows)]
mod imp {
    use super::{Batch, Caps, DEVICE_PATH, Error, EventsConfig, IOCTL_BUNOS_CAPS, IOCTL_BUNOS_EVENTS_CONFIG};
    use super::{IOCTL_BUNOS_EVENTS_READ, IOCTL_BUNOS_PING, IOCTL_BUNOS_VERSION, Record, decode_batch, proto};
    use windows::Win32::Foundation::{
        CloseHandle, ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND, GENERIC_READ, GENERIC_WRITE, HANDLE,
    };
    use windows::Win32::Storage::FileSystem::{CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_NONE, OPEN_EXISTING};
    use windows::Win32::System::IO::DeviceIoControl;
    use windows::core::HSTRING;

    fn win32(op: &'static str, e: windows::core::Error) -> Error {
        Error::Win32 { op, code: e.code().0, message: e.message() }
    }

    /// An open handle on `\\.\BunOS`, closed on drop. The last handle closed disables every event source.
    pub struct Device(HANDLE);

    // SAFETY: a device handle may be used from any thread; the driver completes each IRP synchronously.
    unsafe impl Send for Device {}
    // SAFETY: DeviceIoControl on one handle from several threads is allowed; the driver serialises its state.
    unsafe impl Sync for Device {}

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
                Err(e) if e.code() == ERROR_ACCESS_DENIED.to_hresult() => Err(Error::AccessDenied),
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

        pub fn caps(&self) -> Result<Caps, Error> {
            let mut out = [0u8; Caps::SIZE];
            let n = self.ioctl(IOCTL_BUNOS_CAPS, &[], &mut out)?;
            Ok(Caps::parse(&out[..n])?)
        }

        /// Enables exactly `sources` (a [`proto::source`] mask; 0 disables all) and returns the resulting caps.
        pub fn configure(&self, sources: u32) -> Result<Caps, Error> {
            let input = EventsConfig { sources }.encode();
            let mut out = [0u8; Caps::SIZE];
            let n = self.ioctl(IOCTL_BUNOS_EVENTS_CONFIG, &input, &mut out)?;
            Ok(Caps::parse(&out[..n])?)
        }

        /// Drains up to `max` queued events (oldest first).
        pub fn read_events(&self, max: usize) -> Result<Batch, Error> {
            let max = max.clamp(1, 512);
            let mut out = vec![0u8; proto::EventsHeader::SIZE + max * Record::SIZE];
            let n = self.ioctl(IOCTL_BUNOS_EVENTS_READ, &[], &mut out)?;
            Ok(decode_batch(&out[..n])?)
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
    use super::{Batch, Caps, Error};

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
        pub fn caps(&self) -> Result<Caps, Error> {
            Err(Error::Unsupported)
        }
        pub fn configure(&self, _sources: u32) -> Result<Caps, Error> {
            Err(Error::Unsupported)
        }
        pub fn read_events(&self, _max: usize) -> Result<Batch, Error> {
            Err(Error::Unsupported)
        }
    }
}

pub use imp::Device;

/// True when `\\.\BunOS` can be opened (driver loaded and this process elevated).
pub fn available() -> bool {
    Device::open().is_ok()
}

/// Driver presence without needing access: `Some(true)` loaded and openable, `Some(false)` loaded but access denied
/// (not elevated), `None` not loaded / not Windows.
pub fn presence() -> Option<bool> {
    match Device::open() {
        Ok(_) => Some(true),
        Err(Error::AccessDenied) => Some(false),
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_codes_match_the_driver() {
        assert_eq!(IOCTL_BUNOS_VERSION, 0x0022_2000);
        assert_eq!(IOCTL_BUNOS_PING, 0x0022_2004);
        assert_eq!(IOCTL_BUNOS_CAPS, 0x0022_6008);
        assert_eq!(IOCTL_BUNOS_EVENTS_CONFIG, 0x0022_E040);
        assert_eq!(IOCTL_BUNOS_EVENTS_READ, 0x0022_6044);
    }

    #[test]
    fn decode_batch_owns_names() {
        let mut bytes = EventsHeader { abi: proto::ABI, count: 1, dropped: 3, pending: 7 }.encode().to_vec();
        let mut r = Record::new(Kind::ImageLoad, 10, 4);
        r.set_name(&"\\SystemRoot\\System32\\ntdll.dll".encode_utf16().collect::<Vec<_>>());
        r.a0 = 0x7ff0_0000_0000;
        let mut rec = [0u8; Record::SIZE];
        r.encode(&mut rec);
        bytes.extend_from_slice(&rec);
        let batch = decode_batch(&bytes).unwrap();
        assert_eq!((batch.dropped, batch.pending), (3, 7));
        assert_eq!(batch.events[0].name, "\\SystemRoot\\System32\\ntdll.dll");
        assert_eq!(batch.events[0].kind, Kind::ImageLoad);
    }

    #[test]
    fn device_round_trip_when_loaded() {
        let device = match Device::open() {
            Ok(d) => d,
            Err(Error::NotLoaded | Error::Unsupported | Error::AccessDenied) => {
                eprintln!("skip: {DEVICE_PATH} absent or not elevated");
                return;
            }
            Err(e) => panic!("{e}"),
        };
        assert!(device.version().unwrap().starts_with("bunos.sys "));
        let payload: Vec<u8> = (0..=255u8).collect();
        assert_eq!(device.ping(&payload).unwrap(), payload);
        let caps = device.caps().unwrap();
        assert_eq!(caps.sources_supported, source::ALL);
        let caps = device.configure(source::PROCESS | source::IMAGE).unwrap();
        assert_eq!(caps.sources_active, source::PROCESS | source::IMAGE);
        // Spawn a process so there is at least one create + image event to drain.
        let _ = std::process::Command::new("cmd.exe").args(["/c", "exit"]).status();
        let batch = device.read_events(512).unwrap();
        assert!(batch.events.iter().any(|e| e.kind == Kind::ProcessCreate && e.name.ends_with("cmd.exe")));
        assert!(batch.events.iter().any(|e| e.kind == Kind::ImageLoad));
        assert_eq!(device.configure(0).unwrap().sources_active, 0);
        // Strict parsing on the kernel side: a bad ABI is refused.
        let mut bad = EventsConfig { sources: 0 }.encode();
        bad[0] = 9;
        assert!(device.ioctl(IOCTL_BUNOS_EVENTS_CONFIG, &bad, &mut [0u8; Caps::SIZE]).is_err());
    }
}
