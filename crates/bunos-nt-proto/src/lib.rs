// SPDX-License-Identifier: Apache-2.0
//! The `bunos.sys` wire contract (docs/NTCORE.md section 8), shared verbatim by the kernel driver and every
//! user-mode client so the two sides cannot drift.
//!
//! Every buffer crossing the user/kernel boundary is a fixed little-endian layout parsed by a function of this crate
//! that checks the exact length, the ABI number, reserved fields and every enumerated value before anything is used.
//! The parsers never index out of bounds and never panic on hostile input (see the fuzz-style tests below), which is
//! what lets the driver call them on `SystemBuffer` contents coming from user mode.
//!
//! What the contract deliberately does **not** contain: no arbitrary kernel or physical memory read/write, no I/O port
//! access, no MSR access and no code execution. Those primitives are what turns a signed driver into a "vulnerable
//! driver" (BYOVD) usable to disable security software; every control code here returns kernel-produced data
//! (versions, counters, event records), never memory chosen by the caller.
#![no_std]

#[cfg(test)]
extern crate std;

/// Version of the binary layouts below. Every request carries it; a mismatch is rejected.
pub const ABI: u32 = 1;

/// `FILE_DEVICE_UNKNOWN` (winioctl.h).
pub const FILE_DEVICE_UNKNOWN: u32 = 0x22;
/// `METHOD_BUFFERED`: the I/O manager copies input and output through one system buffer.
pub const METHOD_BUFFERED: u32 = 0;
/// `FILE_ANY_ACCESS`.
pub const FILE_ANY_ACCESS: u32 = 0;
/// `FILE_READ_ACCESS`: the I/O manager checks the handle was opened for read.
pub const FILE_READ_ACCESS: u32 = 1;
/// `FILE_WRITE_ACCESS`: the I/O manager checks the handle was opened for write.
pub const FILE_WRITE_ACCESS: u32 = 2;

/// `CTL_CODE(FILE_DEVICE_UNKNOWN, function, METHOD_BUFFERED, access)`.
pub const fn ctl_code(function: u32, access: u32) -> u32 {
    (FILE_DEVICE_UNKNOWN << 16) | (access << 14) | (function << 2) | METHOD_BUFFERED
}

/// Driver version string (UTF-8, NUL-terminated). Unchanged since ABI 0: `0x00222000`.
pub const IOCTL_BUNOS_VERSION: u32 = ctl_code(0x800, FILE_ANY_ACCESS);
/// Echo of the input buffer (round-trip probe). Unchanged since ABI 0: `0x00222004`.
pub const IOCTL_BUNOS_PING: u32 = ctl_code(0x801, FILE_ANY_ACCESS);
/// [`Caps`]: ABI, supported and active event sources, ring geometry, counters. `0x00226008`.
pub const IOCTL_BUNOS_CAPS: u32 = ctl_code(0x802, FILE_READ_ACCESS);
/// Input [`EventsConfig`]: enables exactly the given event sources (0 disables all). `0x0022E040`.
pub const IOCTL_BUNOS_EVENTS_CONFIG: u32 = ctl_code(0x810, FILE_READ_ACCESS | FILE_WRITE_ACCESS);
/// No input; output [`EventsHeader`] followed by `count` [`Record`]s, drained from the kernel ring. `0x00226044`.
pub const IOCTL_BUNOS_EVENTS_READ: u32 = ctl_code(0x811, FILE_READ_ACCESS);

/// Kernel device and Win32 link names.
pub const DEVICE_NAME: &str = r"\Device\BunOS";
pub const DEVICE_PATH: &str = r"\\.\BunOS";
/// Device object DACL: SYSTEM and Administrators only (`SDDL_DEVOBJ_SYS_ALL_ADM_ALL`), applied by
/// `IoCreateDeviceSecure`, so a standard user cannot even open `\\.\BunOS`.
pub const DEVICE_SDDL: &str = "D:P(A;;GA;;;SY)(A;;GA;;;BA)";
/// Registry callback altitude (FSFilter Activity Monitor range is for file systems; registry filters pick a unique
/// decimal string, this one is in the 360000-389999 "activity monitor" band used by monitoring-only filters).
pub const REGISTRY_ALTITUDE: &str = "385210.4207";

/// Event sources ([`EventsConfig::sources`], [`Caps::sources_supported`]).
pub mod source {
    /// `PsSetCreateProcessNotifyRoutineEx`: process create (with image path) and exit.
    pub const PROCESS: u32 = 1 << 0;
    /// `PsSetCreateThreadNotifyRoutine`: thread create and exit.
    pub const THREAD: u32 = 1 << 1;
    /// `PsSetLoadImageNotifyRoutine`: image (exe/dll/driver) mapping.
    pub const IMAGE: u32 = 1 << 2;
    /// `CmRegisterCallbackEx`, monitoring only: set value, delete value, delete key. Never blocks or alters an
    /// operation.
    pub const REGISTRY: u32 = 1 << 3;
    pub const ALL: u32 = PROCESS | THREAD | IMAGE | REGISTRY;

    /// Names in bit order, for clients.
    pub const NAMES: [(&str, u32); 4] =
        [("process", PROCESS), ("thread", THREAD), ("image", IMAGE), ("registry", REGISTRY)];
}

/// Event kinds ([`Record::kind`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u16)]
pub enum Kind {
    /// `pid` created by `a0` (parent pid), `a1` = creator pid; `name` = image path.
    ProcessCreate = 1,
    /// `pid` exited.
    ProcessExit = 2,
    /// Thread `a0` created in `pid`.
    ThreadCreate = 3,
    /// Thread `a0` of `pid` exited.
    ThreadExit = 4,
    /// Image `name` mapped in `pid` at `a0`, `a1` bytes. Kernel images (pid 0, [`flag::KERNEL_IMAGE`]) carry no
    /// address: kernel layout stays private (KASLR).
    ImageLoad = 5,
    /// `pid` set value: `name` = `key\value`, `a0` = value type (REG_*), `a1` = data size.
    RegistrySetValue = 6,
    /// `pid` deleted value: `name` = `key\value`.
    RegistryDeleteValue = 7,
    /// `pid` deleted key: `name` = key path.
    RegistryDeleteKey = 8,
}

impl Kind {
    pub const fn from_u16(v: u16) -> Option<Kind> {
        Some(match v {
            1 => Kind::ProcessCreate,
            2 => Kind::ProcessExit,
            3 => Kind::ThreadCreate,
            4 => Kind::ThreadExit,
            5 => Kind::ImageLoad,
            6 => Kind::RegistrySetValue,
            7 => Kind::RegistryDeleteValue,
            8 => Kind::RegistryDeleteKey,
            _ => return None,
        })
    }

    pub const fn name(self) -> &'static str {
        match self {
            Kind::ProcessCreate => "process_create",
            Kind::ProcessExit => "process_exit",
            Kind::ThreadCreate => "thread_create",
            Kind::ThreadExit => "thread_exit",
            Kind::ImageLoad => "image_load",
            Kind::RegistrySetValue => "registry_set_value",
            Kind::RegistryDeleteValue => "registry_delete_value",
            Kind::RegistryDeleteKey => "registry_delete_key",
        }
    }

    /// The source bit that produces this kind.
    pub const fn source(self) -> u32 {
        match self {
            Kind::ProcessCreate | Kind::ProcessExit => source::PROCESS,
            Kind::ThreadCreate | Kind::ThreadExit => source::THREAD,
            Kind::ImageLoad => source::IMAGE,
            Kind::RegistrySetValue | Kind::RegistryDeleteValue | Kind::RegistryDeleteKey => source::REGISTRY,
        }
    }
}

/// Record flags.
pub mod flag {
    /// `name` lost its head: the kernel kept the last [`super::NAME_MAX`] UTF-16 units (the file or value part).
    pub const NAME_TRUNCATED: u16 = 1 << 0;
    /// [`super::Kind::ImageLoad`] of a kernel-mode image; address fields are zero by design.
    pub const KERNEL_IMAGE: u16 = 1 << 1;
    pub const ALL: u16 = NAME_TRUNCATED | KERNEL_IMAGE;
}

/// Errors of the strict parsers. The driver maps each to `STATUS_INVALID_PARAMETER` or `STATUS_BUFFER_TOO_SMALL`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProtoError {
    /// Buffer length is not the exact (or minimum) size of the layout.
    Length { expected: usize, got: usize },
    /// The request was built for another ABI.
    Abi(u32),
    /// Unknown bits in a mask or flags field.
    UnknownBits(u32),
    /// A reserved field is not zero.
    Reserved,
    /// Unknown event kind.
    Kind(u16),
    /// `name_len` exceeds [`NAME_MAX`].
    NameLength(u16),
    /// `count` records do not fit in the buffer.
    Count(u32),
}

impl core::fmt::Display for ProtoError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            ProtoError::Length { expected, got } => write!(f, "buffer is {got} bytes, layout needs {expected}"),
            ProtoError::Abi(v) => write!(f, "ABI {v} is not ABI {ABI}"),
            ProtoError::UnknownBits(b) => write!(f, "unknown bits {b:#x}"),
            ProtoError::Reserved => write!(f, "reserved field is not zero"),
            ProtoError::Kind(k) => write!(f, "unknown event kind {k}"),
            ProtoError::NameLength(n) => write!(f, "name length {n} exceeds {NAME_MAX}"),
            ProtoError::Count(c) => write!(f, "{c} records do not fit in the buffer"),
        }
    }
}

fn u16_at(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}
fn u32_at(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}
fn u64_at(b: &[u8], o: usize) -> u64 {
    let mut a = [0u8; 8];
    a.copy_from_slice(&b[o..o + 8]);
    u64::from_le_bytes(a)
}
fn put(b: &mut [u8], o: usize, v: &[u8]) {
    b[o..o + v.len()].copy_from_slice(v);
}

fn exact(b: &[u8], expected: usize) -> Result<(), ProtoError> {
    if b.len() == expected { Ok(()) } else { Err(ProtoError::Length { expected, got: b.len() }) }
}

/// Input of [`IOCTL_BUNOS_EVENTS_CONFIG`]: `{ abi: u32, sources: u32 }`, exactly 8 bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EventsConfig {
    pub sources: u32,
}

impl EventsConfig {
    pub const SIZE: usize = 8;

    pub fn parse(b: &[u8]) -> Result<Self, ProtoError> {
        exact(b, Self::SIZE)?;
        let abi = u32_at(b, 0);
        if abi != ABI {
            return Err(ProtoError::Abi(abi));
        }
        let sources = u32_at(b, 4);
        if sources & !source::ALL != 0 {
            return Err(ProtoError::UnknownBits(sources & !source::ALL));
        }
        Ok(EventsConfig { sources })
    }

    pub fn encode(&self) -> [u8; Self::SIZE] {
        let mut b = [0u8; Self::SIZE];
        put(&mut b, 0, &ABI.to_le_bytes());
        put(&mut b, 4, &self.sources.to_le_bytes());
        b
    }
}

/// Output of [`IOCTL_BUNOS_CAPS`], exactly 32 bytes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Caps {
    pub abi: u32,
    pub sources_supported: u32,
    pub sources_active: u32,
    pub ring_capacity: u32,
    pub record_size: u32,
    /// Records lost because the ring was full, since load.
    pub dropped_total: u32,
    /// Records produced since load.
    pub events_total: u64,
}

impl Caps {
    pub const SIZE: usize = 32;

    pub fn encode(&self) -> [u8; Self::SIZE] {
        let mut b = [0u8; Self::SIZE];
        put(&mut b, 0, &self.abi.to_le_bytes());
        put(&mut b, 4, &self.sources_supported.to_le_bytes());
        put(&mut b, 8, &self.sources_active.to_le_bytes());
        put(&mut b, 12, &self.ring_capacity.to_le_bytes());
        put(&mut b, 16, &self.record_size.to_le_bytes());
        put(&mut b, 20, &self.dropped_total.to_le_bytes());
        put(&mut b, 24, &self.events_total.to_le_bytes());
        b
    }

    pub fn parse(b: &[u8]) -> Result<Self, ProtoError> {
        exact(b, Self::SIZE)?;
        let caps = Caps {
            abi: u32_at(b, 0),
            sources_supported: u32_at(b, 4),
            sources_active: u32_at(b, 8),
            ring_capacity: u32_at(b, 12),
            record_size: u32_at(b, 16),
            dropped_total: u32_at(b, 20),
            events_total: u64_at(b, 24),
        };
        if caps.abi != ABI {
            return Err(ProtoError::Abi(caps.abi));
        }
        if (caps.sources_supported | caps.sources_active) & !source::ALL != 0 {
            return Err(ProtoError::UnknownBits((caps.sources_supported | caps.sources_active) & !source::ALL));
        }
        if caps.record_size as usize != Record::SIZE {
            return Err(ProtoError::Length { expected: Record::SIZE, got: caps.record_size as usize });
        }
        Ok(caps)
    }
}

/// Head of the [`IOCTL_BUNOS_EVENTS_READ`] output, 16 bytes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EventsHeader {
    pub abi: u32,
    pub count: u32,
    /// Records lost (ring full) since the previous read.
    pub dropped: u32,
    /// Records still queued after this read.
    pub pending: u32,
}

impl EventsHeader {
    pub const SIZE: usize = 16;

    pub fn encode(&self) -> [u8; Self::SIZE] {
        let mut b = [0u8; Self::SIZE];
        put(&mut b, 0, &self.abi.to_le_bytes());
        put(&mut b, 4, &self.count.to_le_bytes());
        put(&mut b, 8, &self.dropped.to_le_bytes());
        put(&mut b, 12, &self.pending.to_le_bytes());
        b
    }
}

/// UTF-16 units kept per record name.
pub const NAME_MAX: usize = 104;

/// One event, 256 bytes: `kind u16, flags u16, name_len u16, reserved u16, time i64 (FILETIME, 100 ns since 1601
/// UTC), pid u64, a0 u64, a1 u64, a2 u64, name [u16; 104]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Record {
    pub kind: Kind,
    pub flags: u16,
    pub time: i64,
    pub pid: u64,
    pub a0: u64,
    pub a1: u64,
    pub a2: u64,
    pub name_len: u16,
    pub name: [u16; NAME_MAX],
}

impl Record {
    pub const SIZE: usize = 256;
    const NAME_OFFSET: usize = 48;

    pub const fn new(kind: Kind, time: i64, pid: u64) -> Self {
        Record { kind, flags: 0, time, pid, a0: 0, a1: 0, a2: 0, name_len: 0, name: [0; NAME_MAX] }
    }

    /// Stores `units`, keeping the tail when it does not fit (paths end with the interesting part).
    pub fn set_name(&mut self, units: &[u16]) {
        let start = units.len().saturating_sub(NAME_MAX);
        let tail = &units[start..];
        self.name[..tail.len()].copy_from_slice(tail);
        self.name[tail.len()..].fill(0);
        self.name_len = tail.len() as u16;
        if start > 0 {
            self.flags |= flag::NAME_TRUNCATED;
        }
    }

    /// Stores `head`, `\`, `tail` (registry `key\value`), keeping the tail of the joined string.
    pub fn set_name_joined(&mut self, head: &[u16], tail: &[u16]) {
        let total = head.len() + 1 + tail.len();
        let skip = total.saturating_sub(NAME_MAX);
        let mut n = 0usize;
        let mut i = 0usize;
        let mut push = |u: u16, n: &mut usize, name: &mut [u16; NAME_MAX]| {
            if i >= skip {
                name[*n] = u;
                *n += 1;
            }
            i += 1;
        };
        for &u in head {
            push(u, &mut n, &mut self.name);
        }
        push(b'\\' as u16, &mut n, &mut self.name);
        for &u in tail {
            push(u, &mut n, &mut self.name);
        }
        self.name[n..].fill(0);
        self.name_len = n as u16;
        if skip > 0 {
            self.flags |= flag::NAME_TRUNCATED;
        }
    }

    pub fn name_units(&self) -> &[u16] {
        &self.name[..(self.name_len as usize).min(NAME_MAX)]
    }

    pub fn encode(&self, b: &mut [u8; Self::SIZE]) {
        put(b, 0, &(self.kind as u16).to_le_bytes());
        put(b, 2, &self.flags.to_le_bytes());
        put(b, 4, &self.name_len.to_le_bytes());
        put(b, 6, &0u16.to_le_bytes());
        put(b, 8, &self.time.to_le_bytes());
        put(b, 16, &self.pid.to_le_bytes());
        put(b, 24, &self.a0.to_le_bytes());
        put(b, 32, &self.a1.to_le_bytes());
        put(b, 40, &self.a2.to_le_bytes());
        for (i, u) in self.name.iter().enumerate() {
            put(b, Self::NAME_OFFSET + 2 * i, &u.to_le_bytes());
        }
    }

    pub fn parse(b: &[u8]) -> Result<Self, ProtoError> {
        exact(b, Self::SIZE)?;
        let raw_kind = u16_at(b, 0);
        let kind = Kind::from_u16(raw_kind).ok_or(ProtoError::Kind(raw_kind))?;
        let flags = u16_at(b, 2);
        if flags & !flag::ALL != 0 {
            return Err(ProtoError::UnknownBits((flags & !flag::ALL) as u32));
        }
        let name_len = u16_at(b, 4);
        if name_len as usize > NAME_MAX {
            return Err(ProtoError::NameLength(name_len));
        }
        if u16_at(b, 6) != 0 {
            return Err(ProtoError::Reserved);
        }
        let mut name = [0u16; NAME_MAX];
        for (i, u) in name.iter_mut().enumerate() {
            *u = u16_at(b, Self::NAME_OFFSET + 2 * i);
        }
        Ok(Record {
            kind,
            flags,
            time: u64_at(b, 8) as i64,
            pid: u64_at(b, 16),
            a0: u64_at(b, 24),
            a1: u64_at(b, 32),
            a2: u64_at(b, 40),
            name_len,
            name,
        })
    }
}

/// Number of whole records an [`IOCTL_BUNOS_EVENTS_READ`] output buffer of `len` bytes holds (0 when it cannot
/// even hold the header, which the driver rejects with `STATUS_BUFFER_TOO_SMALL`).
pub const fn records_fitting(len: usize) -> usize {
    if len < EventsHeader::SIZE { 0 } else { (len - EventsHeader::SIZE) / Record::SIZE }
}

/// Parses an [`IOCTL_BUNOS_EVENTS_READ`] output: header, then an iterator of strictly parsed records.
pub fn parse_events(b: &[u8]) -> Result<(EventsHeader, Records<'_>), ProtoError> {
    if b.len() < EventsHeader::SIZE {
        return Err(ProtoError::Length { expected: EventsHeader::SIZE, got: b.len() });
    }
    let header = EventsHeader { abi: u32_at(b, 0), count: u32_at(b, 4), dropped: u32_at(b, 8), pending: u32_at(b, 12) };
    if header.abi != ABI {
        return Err(ProtoError::Abi(header.abi));
    }
    let body = &b[EventsHeader::SIZE..];
    let needed = (header.count as usize).checked_mul(Record::SIZE).ok_or(ProtoError::Count(header.count))?;
    if needed > body.len() {
        return Err(ProtoError::Count(header.count));
    }
    Ok((header, Records { body: &body[..needed] }))
}

/// Records of a read; each item is parsed strictly.
pub struct Records<'a> {
    body: &'a [u8],
}

impl Iterator for Records<'_> {
    type Item = Result<Record, ProtoError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.body.len() < Record::SIZE {
            return None;
        }
        let (head, rest) = self.body.split_at(Record::SIZE);
        self.body = rest;
        Some(Record::parse(head))
    }
}

/// Parses a source list such as `"process,image"` or `"all"` / `"none"` into a mask.
pub fn parse_sources(text: &str) -> Option<u32> {
    let mut mask = 0;
    for part in text.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        mask |= match part {
            "all" => source::ALL,
            "none" => 0,
            other => source::NAMES.iter().find(|(n, _)| *n == other)?.1,
        };
    }
    Some(mask)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::vec::Vec;

    /// Deterministic xorshift64*: the fuzz corpus is reproducible without a dependency.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        fn bytes(&mut self, n: usize) -> Vec<u8> {
            (0..n).map(|_| self.next() as u8).collect()
        }
    }

    #[test]
    fn control_codes_are_pinned() {
        assert_eq!(IOCTL_BUNOS_VERSION, 0x0022_2000);
        assert_eq!(IOCTL_BUNOS_PING, 0x0022_2004);
        assert_eq!(IOCTL_BUNOS_CAPS, 0x0022_6008);
        assert_eq!(IOCTL_BUNOS_EVENTS_CONFIG, 0x0022_E040);
        assert_eq!(IOCTL_BUNOS_EVENTS_READ, 0x0022_6044);
    }

    #[test]
    fn config_is_strict() {
        let ok = EventsConfig { sources: source::PROCESS | source::IMAGE };
        assert_eq!(EventsConfig::parse(&ok.encode()), Ok(ok));
        assert!(matches!(EventsConfig::parse(&[0; 7]), Err(ProtoError::Length { .. })));
        assert!(matches!(EventsConfig::parse(&[0; 9]), Err(ProtoError::Length { .. })));
        let mut b = ok.encode();
        b[0] = 2;
        assert_eq!(EventsConfig::parse(&b), Err(ProtoError::Abi(2)));
        let mut b = ok.encode();
        b[4] = 0x10;
        assert_eq!(EventsConfig::parse(&b), Err(ProtoError::UnknownBits(0x10)));
    }

    #[test]
    fn record_round_trip_and_truncation() {
        let mut r = Record::new(Kind::ProcessCreate, 133_000_000_000_000_000, 4242);
        let long: Vec<u16> = "C:\\".encode_utf16().chain(core::iter::repeat_n(b'a' as u16, 200)).chain("\\bun.exe".encode_utf16()).collect();
        r.set_name(&long);
        assert_eq!(r.name_len as usize, NAME_MAX);
        assert!(r.flags & flag::NAME_TRUNCATED != 0);
        assert!(std::string::String::from_utf16(r.name_units()).unwrap().ends_with("\\bun.exe"));
        let mut b = [0u8; Record::SIZE];
        r.encode(&mut b);
        assert_eq!(Record::parse(&b), Ok(r));

        let mut j = Record::new(Kind::RegistrySetValue, 1, 2);
        let key: Vec<u16> = "\\REGISTRY\\MACHINE\\SOFTWARE\\Bun".encode_utf16().collect();
        let val: Vec<u16> = "Mode".encode_utf16().collect();
        j.set_name_joined(&key, &val);
        assert_eq!(std::string::String::from_utf16(j.name_units()).unwrap(), "\\REGISTRY\\MACHINE\\SOFTWARE\\Bun\\Mode");
        assert_eq!(j.flags, 0);
        let long_key: Vec<u16> = core::iter::repeat_n(b'k' as u16, 300).collect();
        j.set_name_joined(&long_key, &val);
        assert_eq!(j.name_len as usize, NAME_MAX);
        assert!(std::string::String::from_utf16(j.name_units()).unwrap().ends_with("k\\Mode"));
    }

    #[test]
    fn events_parse_checks_count_against_length() {
        let mut out = Vec::new();
        out.extend_from_slice(&EventsHeader { abi: ABI, count: 2, dropped: 1, pending: 0 }.encode());
        let mut rec = [0u8; Record::SIZE];
        Record::new(Kind::ThreadCreate, 5, 6).encode(&mut rec);
        out.extend_from_slice(&rec);
        assert_eq!(parse_events(&out).err(), Some(ProtoError::Count(2)));
        out.extend_from_slice(&rec);
        let (h, it) = parse_events(&out).unwrap();
        assert_eq!(h.count, 2);
        assert_eq!(it.filter(Result::is_ok).count(), 2);
        let mut huge = EventsHeader { abi: ABI, count: u32::MAX, dropped: 0, pending: 0 }.encode().to_vec();
        huge.extend_from_slice(&rec);
        assert_eq!(parse_events(&huge).err(), Some(ProtoError::Count(u32::MAX)));
        assert_eq!(records_fitting(15), 0);
        assert_eq!(records_fitting(16 + 256 * 3 + 255), 3);
    }

    #[test]
    fn sources_text() {
        assert_eq!(parse_sources("process, image"), Some(source::PROCESS | source::IMAGE));
        assert_eq!(parse_sources("all"), Some(source::ALL));
        assert_eq!(parse_sources("none"), Some(0));
        assert_eq!(parse_sources("kernel"), None);
    }

    /// Fuzz-style: 200k random buffers of random lengths through every parser. No panic, and anything accepted
    /// re-encodes to the same bytes (the parsers accept only canonical encodings).
    #[test]
    fn parsers_survive_random_input() {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        for i in 0..200_000u32 {
            let len = match i % 4 {
                0 => EventsConfig::SIZE,
                1 => Record::SIZE,
                2 => Caps::SIZE,
                _ => (rng.next() % 1200) as usize,
            };
            let mut b = rng.bytes(len);
            // Bias toward the valid ABI so the deeper checks are reached.
            if len >= 4 && rng.next() % 2 == 0 {
                b[..4].copy_from_slice(&ABI.to_le_bytes());
            }
            if let Ok(c) = EventsConfig::parse(&b) {
                assert_eq!(&c.encode()[..], &b[..]);
            }
            if let Ok(c) = Caps::parse(&b) {
                assert_eq!(&c.encode()[..], &b[..]);
            }
            if len == Record::SIZE {
                let mut r = b.clone();
                r[0] = (1 + rng.next() % 8) as u8;
                r[1] = 0;
                if let Ok(rec) = Record::parse(&r) {
                    let mut again = [0u8; Record::SIZE];
                    rec.encode(&mut again);
                    assert_eq!(&again[..], &r[..]);
                }
            }
            if let Ok((h, it)) = parse_events(&b) {
                assert!(h.count as usize * Record::SIZE <= b.len() - EventsHeader::SIZE);
                assert_eq!(it.count(), h.count as usize);
            }
        }
    }
}
