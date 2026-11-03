// SPDX-License-Identifier: Apache-2.0
//! `bunos.sys`: the Bun OS Windows 11 kernel driver (WDM, Microsoft windows-drivers-rs).
//!
//! It creates `\Device\BunOS` (DACL: SYSTEM + Administrators only) and the `\\.\BunOS` link. The control codes and
//! every binary layout live in `bunos-nt-proto`, shared with the user-mode clients; requests are parsed there,
//! strictly, before the driver acts on them.
//!
//! Scope (docs/NTCORE.md section 8): only what user mode cannot do. Today that is the kernel notification callbacks
//! (process, thread, image load, registry) turned into an event ring that user mode drains. There is no memory, port,
//! MSR or code-execution primitive, by design: such an IOCTL would make this a vulnerable driver.
#![no_std]

#[cfg(not(test))]
extern crate wdk_panic;

#[cfg(not(test))]
use wdk_alloc::WdkAllocator;

#[cfg(not(test))]
#[global_allocator]
static GLOBAL_ALLOCATOR: WdkAllocator = WdkAllocator;

use bunos_nt_proto::{
    self as proto, Caps, EventsConfig, EventsHeader, IOCTL_BUNOS_CAPS, IOCTL_BUNOS_EVENTS_CONFIG,
    IOCTL_BUNOS_EVENTS_READ, IOCTL_BUNOS_PING, IOCTL_BUNOS_VERSION, Kind, ProtoError, Record, source,
};
use core::cell::UnsafeCell;
use core::ptr::null_mut;
use core::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use wdk::println;
use wdk_sys::{
    _REG_NOTIFY_CLASS, BOOLEAN, DEVICE_OBJECT, DO_BUFFERED_IO, DRIVER_OBJECT, FILE_DEVICE_SECURE_OPEN,
    FILE_DEVICE_UNKNOWN, GUID, HANDLE, IO_NO_INCREMENT, IRP, IRP_MJ_CLOSE, IRP_MJ_CREATE, IRP_MJ_DEVICE_CONTROL,
    KSPIN_LOCK, LARGE_INTEGER, NTSTATUS, PCUNICODE_STRING, PDEVICE_OBJECT, PDRIVER_OBJECT, PEPROCESS, PIMAGE_INFO,
    PIRP, PPS_CREATE_NOTIFY_INFO, PUNICODE_STRING, PVOID, REG_DELETE_KEY_INFORMATION,
    REG_DELETE_VALUE_KEY_INFORMATION, REG_SET_VALUE_KEY_INFORMATION, STATUS_BUFFER_TOO_SMALL, STATUS_DEVICE_BUSY,
    STATUS_INVALID_DEVICE_REQUEST, STATUS_INVALID_PARAMETER, STATUS_SUCCESS, UNICODE_STRING,
    ntddk::{
        CmCallbackGetKeyObjectIDEx, CmCallbackReleaseKeyObjectIDEx, CmRegisterCallbackEx, CmUnRegisterCallback,
        IoDeleteDevice, IoCreateSymbolicLink, IoDeleteSymbolicLink, IofCompleteRequest, KeAcquireSpinLockRaiseToDpc,
        KeQuerySystemTimePrecise, KeReleaseSpinLock, PsRemoveCreateThreadNotifyRoutine,
        PsRemoveLoadImageNotifyRoutine, PsSetCreateProcessNotifyRoutineEx, PsSetCreateThreadNotifyRoutine,
        PsSetLoadImageNotifyRoutine, RtlInitUnicodeString,
    },
};

// wdmsec.lib (static library): not in the wdk-sys bindings. Same contract as wdmsec.h.
#[link(name = "wdmsec", kind = "static")]
unsafe extern "system" {
    // wdmsec.h: `#define IoCreateDeviceSecure WdmlibIoCreateDeviceSecure`.
    #[link_name = "WdmlibIoCreateDeviceSecure"]
    fn IoCreateDeviceSecure(
        driver: PDRIVER_OBJECT,
        extension_size: u32,
        name: PUNICODE_STRING,
        device_type: u32,
        characteristics: u32,
        exclusive: BOOLEAN,
        sddl: PCUNICODE_STRING,
        class_guid: *const GUID,
        device: *mut PDEVICE_OBJECT,
    ) -> NTSTATUS;
}

/// Device class of `\Device\BunOS`: lets an administrator override the DACL under
/// `HKLM\SYSTEM\CurrentControlSet\Control\Class\{guid}\Properties` without a rebuild (wdmsec semantics).
const DEVICE_CLASS: GUID = GUID {
    Data1: 0x6b0f_5a3e,
    Data2: 0x1d2c,
    Data3: 0x4b7a,
    Data4: [0x9a, 0x51, 0x42, 0x55, 0x4e, 0x4f, 0x53, 0x01],
};

const VERSION: &[u8] = concat!("bunos.sys ", env!("CARGO_PKG_VERSION"), "\0").as_bytes();

/// UTF-16 literal helper (no allocation in DriverEntry).
macro_rules! wide {
    ($s:expr) => {{
        const S: &str = $s;
        const N: usize = S.len() + 1;
        const W: [u16; N] = {
            let b = S.as_bytes();
            let mut w = [0u16; N];
            let mut i = 0;
            while i < b.len() {
                w[i] = b[i] as u16;
                i += 1;
            }
            w
        };
        &W
    }};
}

static DEVICE_NAME: &[u16] = wide!(proto::DEVICE_NAME);
static LINK_NAME: &[u16] = wide!("\\DosDevices\\BunOS");
static SDDL: &[u16] = wide!(proto::DEVICE_SDDL);
static ALTITUDE: &[u16] = wide!(proto::REGISTRY_ALTITUDE);

fn unicode(s: &'static [u16]) -> UNICODE_STRING {
    let mut u = UNICODE_STRING::default();
    // SAFETY: `s` is a NUL-terminated static UTF-16 buffer that outlives the UNICODE_STRING.
    unsafe { RtlInitUnicodeString(&mut u, s.as_ptr()) };
    u
}

/// The units of a kernel UNICODE_STRING (`Length` is in bytes).
///
/// # Safety
/// `s` is null or points to a valid UNICODE_STRING whose buffer stays valid for the returned lifetime.
unsafe fn units<'a>(s: *const UNICODE_STRING) -> &'a [u16] {
    if s.is_null() {
        return &[];
    }
    let s = unsafe { &*s };
    if s.Buffer.is_null() || s.Length == 0 {
        return &[];
    }
    unsafe { core::slice::from_raw_parts(s.Buffer, (s.Length / 2) as usize) }
}

// ----------------------------------------------------------------------------------------------------------------
// Event ring: fixed records in non-paged static memory, one spin lock, oldest-first drain, drop-newest on overflow.

const RING_CAPACITY: usize = 512;

struct Ring {
    head: usize,
    len: usize,
    dropped_since_read: u32,
    slots: [[u8; Record::SIZE]; RING_CAPACITY],
}

struct Global<T>(UnsafeCell<T>);
// SAFETY: every access to the inner value happens under RING_LOCK.
unsafe impl<T> Sync for Global<T> {}

static RING: Global<Ring> =
    Global(UnsafeCell::new(Ring { head: 0, len: 0, dropped_since_read: 0, slots: [[0; Record::SIZE]; RING_CAPACITY] }));
static RING_LOCK: Global<KSPIN_LOCK> = Global(UnsafeCell::new(0));
static EVENTS_TOTAL: AtomicU64 = AtomicU64::new(0);
static DROPPED_TOTAL: AtomicU32 = AtomicU32::new(0);

/// Runs `f` on the ring with RING_LOCK held (IRQL raised to DISPATCH_LEVEL: `f` must not page or wait).
fn with_ring<R>(f: impl FnOnce(&mut Ring) -> R) -> R {
    // SAFETY: RING_LOCK is a valid, zero-initialised spin lock; RING is only touched while it is held.
    unsafe {
        let irql = KeAcquireSpinLockRaiseToDpc(RING_LOCK.0.get());
        let r = f(&mut *RING.0.get());
        KeReleaseSpinLock(RING_LOCK.0.get(), irql);
        r
    }
}

fn now() -> i64 {
    let mut t = LARGE_INTEGER::default();
    // SAFETY: plain out-parameter.
    unsafe { KeQuerySystemTimePrecise(&mut t) };
    // SAFETY: QuadPart is the active member after KeQuerySystemTimePrecise.
    unsafe { t.QuadPart }
}

fn push(record: &Record) {
    let mut bytes = [0u8; Record::SIZE];
    record.encode(&mut bytes);
    EVENTS_TOTAL.fetch_add(1, Ordering::Relaxed);
    let stored = with_ring(|ring| {
        if ring.len == RING_CAPACITY {
            ring.dropped_since_read = ring.dropped_since_read.saturating_add(1);
            return false;
        }
        let slot = (ring.head + ring.len) % RING_CAPACITY;
        ring.slots[slot] = bytes;
        ring.len += 1;
        true
    });
    if !stored {
        DROPPED_TOTAL.fetch_add(1, Ordering::Relaxed);
    }
}

fn clear_ring() {
    with_ring(|ring| {
        ring.head = 0;
        ring.len = 0;
        ring.dropped_since_read = 0;
    });
}

// ----------------------------------------------------------------------------------------------------------------
// Notification callbacks. Each one only records; none alters, delays or blocks the operation it observes.

fn handle_value(h: HANDLE) -> u64 {
    h as usize as u64
}

unsafe extern "C" fn on_process(_process: PEPROCESS, pid: HANDLE, info: PPS_CREATE_NOTIFY_INFO) {
    if info.is_null() {
        push(&Record::new(Kind::ProcessExit, now(), handle_value(pid)));
        return;
    }
    // SAFETY: non-null CreateInfo is valid for the duration of the callback.
    let info = unsafe { &*info };
    let mut r = Record::new(Kind::ProcessCreate, now(), handle_value(pid));
    r.a0 = handle_value(info.ParentProcessId);
    r.a1 = handle_value(info.CreatingThreadId.UniqueProcess);
    // SAFETY: ImageFileName is null or valid during the callback.
    r.set_name(unsafe { units(info.ImageFileName) });
    push(&r);
}

unsafe extern "C" fn on_thread(pid: HANDLE, tid: HANDLE, create: BOOLEAN) {
    let kind = if create != 0 { Kind::ThreadCreate } else { Kind::ThreadExit };
    let mut r = Record::new(kind, now(), handle_value(pid));
    r.a0 = handle_value(tid);
    push(&r);
}

unsafe extern "C" fn on_image(name: PUNICODE_STRING, pid: HANDLE, info: PIMAGE_INFO) {
    let mut r = Record::new(Kind::ImageLoad, now(), handle_value(pid));
    if !info.is_null() {
        // SAFETY: ImageInfo is valid during the callback.
        let info = unsafe { &*info };
        // SAFETY: Properties is the plain-ULONG view of the bitfield union.
        let system_mode = unsafe { info.__bindgen_anon_1.Properties } & (1 << 8) != 0; // SystemModeImage
        if system_mode || pid.is_null() {
            // Kernel layout stays private (KASLR): no base or size for kernel images.
            r.flags |= proto::flag::KERNEL_IMAGE;
        } else {
            r.a0 = info.ImageBase as usize as u64;
            r.a1 = info.ImageSize;
        }
    }
    // SAFETY: FullImageName is null or valid during the callback.
    r.set_name(unsafe { units(name) });
    push(&r);
}

static REGISTRY_COOKIE: Global<LARGE_INTEGER> = Global(UnsafeCell::new(unsafe { core::mem::zeroed() }));

/// `key` object's full name, released by the caller through `CmCallbackReleaseKeyObjectIDEx`.
fn key_name(object: PVOID) -> PCUNICODE_STRING {
    let mut name: PCUNICODE_STRING = null_mut();
    // SAFETY: the cookie is the one returned by CmRegisterCallbackEx; `object` comes from the callback argument.
    let status = unsafe { CmCallbackGetKeyObjectIDEx(REGISTRY_COOKIE.0.get(), object, null_mut(), &mut name, 0) };
    if status == STATUS_SUCCESS { name } else { null_mut() }
}

fn record_registry(kind: Kind, object: PVOID, value: PUNICODE_STRING, a0: u64, a1: u64) {
    let key = key_name(object);
    let mut r = Record::new(kind, now(), 0);
    r.pid = handle_value(unsafe { wdk_sys::ntddk::PsGetCurrentProcessId() });
    r.a0 = a0;
    r.a1 = a1;
    // SAFETY: `key` is null or a valid string until released below; `value` comes from the callback argument.
    unsafe {
        if value.is_null() {
            r.set_name(units(key));
        } else {
            r.set_name_joined(units(key), units(value));
        }
        if !key.is_null() {
            CmCallbackReleaseKeyObjectIDEx(key);
        }
    }
    push(&r);
}

unsafe extern "C" fn on_registry(_context: PVOID, class: PVOID, argument: PVOID) -> NTSTATUS {
    if argument.is_null() {
        return STATUS_SUCCESS;
    }
    // SAFETY: Argument2's type is fixed by the notify class (wdm.h REG_NOTIFY_CLASS table).
    unsafe {
        match class as usize as i32 {
            _REG_NOTIFY_CLASS::RegNtPreSetValueKey => {
                let i = &*(argument as *const REG_SET_VALUE_KEY_INFORMATION);
                record_registry(Kind::RegistrySetValue, i.Object, i.ValueName, i.Type as u64, i.DataSize as u64);
            }
            _REG_NOTIFY_CLASS::RegNtPreDeleteValueKey => {
                let i = &*(argument as *const REG_DELETE_VALUE_KEY_INFORMATION);
                record_registry(Kind::RegistryDeleteValue, i.Object, i.ValueName, 0, 0);
            }
            _REG_NOTIFY_CLASS::RegNtPreDeleteKey => {
                let i = &*(argument as *const REG_DELETE_KEY_INFORMATION);
                record_registry(Kind::RegistryDeleteKey, i.Object, null_mut(), 0, 0);
            }
            _ => {}
        }
    }
    // Monitoring only: never block, never alter.
    STATUS_SUCCESS
}

// ----------------------------------------------------------------------------------------------------------------
// Source registration. Serialised by CONFIG_BUSY; ACTIVE mirrors exactly what is registered with the kernel.

static ACTIVE: AtomicU32 = AtomicU32::new(0);
static CONFIG_BUSY: AtomicBool = AtomicBool::new(false);
static OPEN_HANDLES: AtomicU32 = AtomicU32::new(0);
static DRIVER: Global<PDRIVER_OBJECT> = Global(UnsafeCell::new(null_mut()));

fn enable(bit: u32) -> NTSTATUS {
    // SAFETY: the routines are 'static functions of this image; they are removed before unload.
    unsafe {
        match bit {
            source::PROCESS => PsSetCreateProcessNotifyRoutineEx(Some(on_process), 0),
            source::THREAD => PsSetCreateThreadNotifyRoutine(Some(on_thread)),
            source::IMAGE => PsSetLoadImageNotifyRoutine(Some(on_image)),
            source::REGISTRY => {
                let altitude = unicode(ALTITUDE);
                CmRegisterCallbackEx(
                    Some(on_registry),
                    &altitude,
                    (*DRIVER.0.get()).cast(),
                    null_mut(),
                    REGISTRY_COOKIE.0.get(),
                    null_mut(),
                )
            }
            _ => STATUS_INVALID_PARAMETER,
        }
    }
}

fn disable(bit: u32) {
    // SAFETY: only called for a bit whose routine is registered (tracked in ACTIVE). Each removal waits for
    // in-flight callbacks to return.
    unsafe {
        let _ = match bit {
            source::PROCESS => PsSetCreateProcessNotifyRoutineEx(Some(on_process), 1),
            source::THREAD => PsRemoveCreateThreadNotifyRoutine(Some(on_thread)),
            source::IMAGE => PsRemoveLoadImageNotifyRoutine(Some(on_image)),
            source::REGISTRY => CmUnRegisterCallback(*REGISTRY_COOKIE.0.get()),
            _ => STATUS_SUCCESS,
        };
    }
}

/// Makes the registered set equal `wanted`. On a failure, sources already switched keep their new state and the
/// failing status is returned; ACTIVE always reflects reality.
fn apply_sources(wanted: u32) -> NTSTATUS {
    if CONFIG_BUSY.swap(true, Ordering::Acquire) {
        return STATUS_DEVICE_BUSY;
    }
    let mut status = STATUS_SUCCESS;
    for (_, bit) in source::NAMES {
        let active = ACTIVE.load(Ordering::Relaxed) & bit != 0;
        let want = wanted & bit != 0;
        if want && !active {
            let s = enable(bit);
            if s == STATUS_SUCCESS {
                ACTIVE.fetch_or(bit, Ordering::Relaxed);
            } else {
                println!("bunos: enabling source {bit:#x} failed {s:#x}");
                status = s;
            }
        } else if !want && active {
            disable(bit);
            ACTIVE.fetch_and(!bit, Ordering::Relaxed);
        }
    }
    if ACTIVE.load(Ordering::Relaxed) == 0 {
        clear_ring();
    }
    CONFIG_BUSY.store(false, Ordering::Release);
    status
}

// ----------------------------------------------------------------------------------------------------------------
// Driver entry, unload, dispatch.

/// # Safety
/// Called by the I/O manager with a valid driver object.
#[unsafe(export_name = "DriverEntry")]
pub unsafe extern "system" fn driver_entry(driver: PDRIVER_OBJECT, _registry_path: PCUNICODE_STRING) -> NTSTATUS {
    // SAFETY: DriverEntry runs once, before any dispatch or callback.
    unsafe { *DRIVER.0.get() = driver };
    // SAFETY: the I/O manager passes a valid, exclusively owned driver object to DriverEntry.
    let driver: &mut DRIVER_OBJECT = unsafe { &mut *driver };
    let mut name = unicode(DEVICE_NAME);
    let mut link = unicode(LINK_NAME);
    let sddl = unicode(SDDL);
    let mut device: PDEVICE_OBJECT = null_mut();
    // SAFETY: arguments follow the IoCreateDeviceSecure contract; `device` receives the new object.
    let status = unsafe {
        IoCreateDeviceSecure(
            driver,
            0,
            &mut name,
            FILE_DEVICE_UNKNOWN,
            FILE_DEVICE_SECURE_OPEN,
            0,
            &sddl,
            &DEVICE_CLASS,
            &mut device,
        )
    };
    if status != STATUS_SUCCESS {
        println!("bunos: IoCreateDeviceSecure failed {status:#x}");
        return status;
    }
    // SAFETY: both names are valid UNICODE_STRINGs; on failure the device is deleted before returning.
    let status = unsafe { IoCreateSymbolicLink(&mut link, &mut name) };
    if status != STATUS_SUCCESS {
        unsafe { IoDeleteDevice(device) };
        return status;
    }
    // SAFETY: `device` was just created and is owned by this driver.
    unsafe { (*device).Flags |= DO_BUFFERED_IO };
    driver.MajorFunction[IRP_MJ_CREATE as usize] = Some(dispatch_create);
    driver.MajorFunction[IRP_MJ_CLOSE as usize] = Some(dispatch_close);
    driver.MajorFunction[IRP_MJ_DEVICE_CONTROL as usize] = Some(dispatch_control);
    driver.DriverUnload = Some(driver_unload);
    println!("bunos: \\\\.\\BunOS ready ({})", core::str::from_utf8(&VERSION[..VERSION.len() - 1]).unwrap_or("?"));
    STATUS_SUCCESS
}

unsafe extern "C" fn driver_unload(driver: *mut DRIVER_OBJECT) {
    // Callbacks first: after this no routine of the image can run.
    let _ = apply_sources(0);
    let mut link = unicode(LINK_NAME);
    // SAFETY: the link and the single device were created in DriverEntry.
    unsafe {
        let _ = IoDeleteSymbolicLink(&mut link);
        IoDeleteDevice((*driver).DeviceObject);
    }
    println!("bunos: unloaded");
}

fn complete(irp: &mut IRP, status: NTSTATUS, information: u64) -> NTSTATUS {
    irp.IoStatus.__bindgen_anon_1.Status = status;
    irp.IoStatus.Information = information;
    // SAFETY: the IRP is owned by this dispatch routine and completed exactly once.
    unsafe { IofCompleteRequest(irp, IO_NO_INCREMENT as i8) };
    status
}

unsafe extern "C" fn dispatch_create(_device: *mut DEVICE_OBJECT, irp: PIRP) -> NTSTATUS {
    // The DACL (SDDL above) already restricted the open to SYSTEM and Administrators.
    OPEN_HANDLES.fetch_add(1, Ordering::AcqRel);
    // SAFETY: the I/O manager passes a valid IRP.
    complete(unsafe { &mut *irp }, STATUS_SUCCESS, 0)
}

unsafe extern "C" fn dispatch_close(_device: *mut DEVICE_OBJECT, irp: PIRP) -> NTSTATUS {
    // The last consumer gone: stop observing, nothing is left running for nobody (PASSIVE_LEVEL here).
    if OPEN_HANDLES.fetch_sub(1, Ordering::AcqRel) == 1 {
        let _ = apply_sources(0);
    }
    // SAFETY: the I/O manager passes a valid IRP.
    complete(unsafe { &mut *irp }, STATUS_SUCCESS, 0)
}

fn proto_status(e: ProtoError) -> NTSTATUS {
    match e {
        ProtoError::Length { expected, got } if got < expected => STATUS_BUFFER_TOO_SMALL,
        _ => STATUS_INVALID_PARAMETER,
    }
}

fn caps() -> Caps {
    Caps {
        abi: proto::ABI,
        sources_supported: source::ALL,
        sources_active: ACTIVE.load(Ordering::Relaxed),
        ring_capacity: RING_CAPACITY as u32,
        record_size: Record::SIZE as u32,
        dropped_total: DROPPED_TOTAL.load(Ordering::Relaxed),
        events_total: EVENTS_TOTAL.load(Ordering::Relaxed),
    }
}

/// Drains up to `max` records into `out` (header first); returns the bytes written.
fn drain(out: &mut [u8], max: usize) -> usize {
    let (count, dropped, pending) = with_ring(|ring| {
        let n = ring.len.min(max);
        for i in 0..n {
            let slot = (ring.head + i) % RING_CAPACITY;
            let at = EventsHeader::SIZE + i * Record::SIZE;
            out[at..at + Record::SIZE].copy_from_slice(&ring.slots[slot]);
        }
        ring.head = (ring.head + n) % RING_CAPACITY;
        ring.len -= n;
        let dropped = core::mem::take(&mut ring.dropped_since_read);
        (n, dropped, ring.len)
    });
    let header = EventsHeader { abi: proto::ABI, count: count as u32, dropped, pending: pending as u32 };
    out[..EventsHeader::SIZE].copy_from_slice(&header.encode());
    EventsHeader::SIZE + count * Record::SIZE
}

unsafe extern "C" fn dispatch_control(_device: *mut DEVICE_OBJECT, irp: PIRP) -> NTSTATUS {
    // SAFETY: the I/O manager passes a valid IRP with a current stack location.
    let irp = unsafe { &mut *irp };
    let stack = unsafe { &*irp.Tail.Overlay.__bindgen_anon_2.__bindgen_anon_1.CurrentStackLocation };
    // SAFETY: for IRP_MJ_DEVICE_CONTROL the DeviceIoControl member of the parameters union is the active one.
    let params = unsafe { stack.Parameters.DeviceIoControl };
    // METHOD_BUFFERED: one system buffer of max(input, output) bytes holds the input and receives the output. It is
    // null when both lengths are zero.
    let buffer = unsafe { irp.AssociatedIrp.SystemBuffer } as *mut u8;
    let input_len = params.InputBufferLength as usize;
    let output_len = params.OutputBufferLength as usize;
    let size = input_len.max(output_len);
    // SAFETY: the I/O manager allocated `size` bytes for the system buffer (non-null whenever size > 0).
    let system: &mut [u8] =
        if buffer.is_null() || size == 0 { &mut [] } else { unsafe { core::slice::from_raw_parts_mut(buffer, size) } };
    match params.IoControlCode {
        IOCTL_BUNOS_VERSION => {
            if output_len < VERSION.len() {
                return complete(irp, STATUS_BUFFER_TOO_SMALL, 0);
            }
            system[..VERSION.len()].copy_from_slice(VERSION);
            complete(irp, STATUS_SUCCESS, VERSION.len() as u64)
        }
        // The data is already in the system buffer: returning `min(input, output)` bytes echoes it.
        IOCTL_BUNOS_PING => complete(irp, STATUS_SUCCESS, input_len.min(output_len) as u64),
        IOCTL_BUNOS_CAPS => {
            if input_len != 0 {
                return complete(irp, STATUS_INVALID_PARAMETER, 0);
            }
            if output_len < Caps::SIZE {
                return complete(irp, STATUS_BUFFER_TOO_SMALL, 0);
            }
            system[..Caps::SIZE].copy_from_slice(&caps().encode());
            complete(irp, STATUS_SUCCESS, Caps::SIZE as u64)
        }
        IOCTL_BUNOS_EVENTS_CONFIG => {
            let config = match EventsConfig::parse(&system[..input_len]) {
                Ok(c) => c,
                Err(e) => return complete(irp, proto_status(e), 0),
            };
            let status = apply_sources(config.sources);
            // Answer with the resulting capabilities when there is room, so the caller sees what is active.
            let written = if output_len >= Caps::SIZE {
                system[..Caps::SIZE].copy_from_slice(&caps().encode());
                Caps::SIZE as u64
            } else {
                0
            };
            complete(irp, status, if status == STATUS_SUCCESS { written } else { 0 })
        }
        IOCTL_BUNOS_EVENTS_READ => {
            if input_len != 0 {
                return complete(irp, STATUS_INVALID_PARAMETER, 0);
            }
            if output_len < EventsHeader::SIZE {
                return complete(irp, STATUS_BUFFER_TOO_SMALL, 0);
            }
            let max = proto::records_fitting(output_len);
            let written = drain(&mut system[..output_len], max);
            complete(irp, STATUS_SUCCESS, written as u64)
        }
        _ => complete(irp, STATUS_INVALID_DEVICE_REQUEST, 0),
    }
}
