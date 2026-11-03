// SPDX-License-Identifier: Apache-2.0
//! `bunos.sys`: the Bun OS Windows 11 kernel driver (WDM, Microsoft windows-drivers-rs).
//!
//! It creates `\Device\BunOS` and the user-visible `\\.\BunOS` link: the kernel side of the Bun OS bridge, opened by
//! the Bun OS userland through windows-rs / bun:ffi `CreateFileW` + `DeviceIoControl`. The control codes below are
//! the stable contract (docs/NT-DRIVER.md); every new kernel service is a new control code.
#![no_std]

#[cfg(not(test))]
extern crate wdk_panic;

#[cfg(not(test))]
use wdk_alloc::WdkAllocator;

#[cfg(not(test))]
#[global_allocator]
static GLOBAL_ALLOCATOR: WdkAllocator = WdkAllocator;

use core::ptr::null_mut;
use wdk::println;
use wdk_sys::{
    ntddk::{
        IoCreateDevice, IoCreateSymbolicLink, IoDeleteDevice, IoDeleteSymbolicLink, IofCompleteRequest,
        RtlInitUnicodeString,
    },
    DEVICE_OBJECT, DO_BUFFERED_IO, DRIVER_OBJECT, FILE_DEVICE_SECURE_OPEN, FILE_DEVICE_UNKNOWN, IO_NO_INCREMENT,
    IRP, IRP_MJ_CLOSE, IRP_MJ_CREATE, IRP_MJ_DEVICE_CONTROL, NTSTATUS, PCUNICODE_STRING, PDEVICE_OBJECT,
    PDRIVER_OBJECT, PIRP, STATUS_BUFFER_TOO_SMALL, STATUS_INVALID_DEVICE_REQUEST, STATUS_SUCCESS, UNICODE_STRING,
};

/// `CTL_CODE(FILE_DEVICE_UNKNOWN, function, METHOD_BUFFERED, FILE_ANY_ACCESS)`.
const fn ctl_code(function: u32) -> u32 {
    (FILE_DEVICE_UNKNOWN << 16) | (function << 2)
}
/// Returns the driver version string (UTF-8, NUL-terminated) in the output buffer.
pub const IOCTL_BUNOS_VERSION: u32 = ctl_code(0x800);
/// Echoes the input buffer back: the round-trip latency probe of the bridge.
pub const IOCTL_BUNOS_PING: u32 = ctl_code(0x801);

const VERSION: &[u8] = concat!("bunos.sys ", env!("CARGO_PKG_VERSION"), "\0").as_bytes();

/// UTF-16 literal helper for the device names (no allocation in DriverEntry).
macro_rules! wide {
    ($s:literal) => {{
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

static DEVICE_NAME: &[u16] = wide!("\\Device\\BunOS");
static LINK_NAME: &[u16] = wide!("\\DosDevices\\BunOS");

fn unicode(s: &'static [u16]) -> UNICODE_STRING {
    let mut u = UNICODE_STRING::default();
    // SAFETY: `s` is a NUL-terminated static UTF-16 buffer that outlives the UNICODE_STRING.
    unsafe { RtlInitUnicodeString(&mut u, s.as_ptr()) };
    u
}

/// # Safety
/// Called by the I/O manager with a valid driver object.
#[unsafe(export_name = "DriverEntry")]
pub unsafe extern "system" fn driver_entry(driver: PDRIVER_OBJECT, _registry_path: PCUNICODE_STRING) -> NTSTATUS {
    // SAFETY: the I/O manager passes a valid, exclusively owned driver object to DriverEntry.
    let driver: &mut DRIVER_OBJECT = unsafe { &mut *driver };
    let mut name = unicode(DEVICE_NAME);
    let mut link = unicode(LINK_NAME);
    let mut device: PDEVICE_OBJECT = null_mut();
    // SAFETY: arguments follow the IoCreateDevice contract; `device` receives the new object.
    let status = unsafe {
        IoCreateDevice(driver, 0, &mut name, FILE_DEVICE_UNKNOWN, FILE_DEVICE_SECURE_OPEN, 0, &mut device)
    };
    if status != STATUS_SUCCESS {
        println!("bunos: IoCreateDevice failed {status:#x}");
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
    driver.MajorFunction[IRP_MJ_CREATE as usize] = Some(dispatch_open_close);
    driver.MajorFunction[IRP_MJ_CLOSE as usize] = Some(dispatch_open_close);
    driver.MajorFunction[IRP_MJ_DEVICE_CONTROL as usize] = Some(dispatch_control);
    driver.DriverUnload = Some(driver_unload);
    println!("bunos: \\\\.\\BunOS ready ({})", core::str::from_utf8(&VERSION[..VERSION.len() - 1]).unwrap_or("?"));
    STATUS_SUCCESS
}

unsafe extern "C" fn driver_unload(driver: *mut DRIVER_OBJECT) {
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

unsafe extern "C" fn dispatch_open_close(_device: *mut DEVICE_OBJECT, irp: PIRP) -> NTSTATUS {
    // SAFETY: the I/O manager passes a valid IRP.
    complete(unsafe { &mut *irp }, STATUS_SUCCESS, 0)
}

unsafe extern "C" fn dispatch_control(_device: *mut DEVICE_OBJECT, irp: PIRP) -> NTSTATUS {
    // SAFETY: the I/O manager passes a valid IRP with a current stack location.
    let irp = unsafe { &mut *irp };
    let stack = unsafe { &*irp.Tail.Overlay.__bindgen_anon_2.__bindgen_anon_1.CurrentStackLocation };
    // SAFETY: for IRP_MJ_DEVICE_CONTROL the DeviceIoControl member of the parameters union is the active one.
    let params = unsafe { stack.Parameters.DeviceIoControl };
    // METHOD_BUFFERED: one system buffer holds the input and receives the output.
    let buffer = unsafe { irp.AssociatedIrp.SystemBuffer } as *mut u8;
    let input = params.InputBufferLength as usize;
    let output = params.OutputBufferLength as usize;
    match params.IoControlCode {
        IOCTL_BUNOS_VERSION => {
            if output < VERSION.len() {
                return complete(irp, STATUS_BUFFER_TOO_SMALL, 0);
            }
            // SAFETY: the system buffer is at least `output` bytes long.
            unsafe { core::ptr::copy_nonoverlapping(VERSION.as_ptr(), buffer, VERSION.len()) };
            complete(irp, STATUS_SUCCESS, VERSION.len() as u64)
        }
        // The data is already in the system buffer: returning `min(input, output)` bytes echoes it.
        IOCTL_BUNOS_PING => complete(irp, STATUS_SUCCESS, input.min(output) as u64),
        _ => complete(irp, STATUS_INVALID_DEVICE_REQUEST, 0),
    }
}
