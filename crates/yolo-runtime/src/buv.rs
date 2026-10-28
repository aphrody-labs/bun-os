// SPDX-License-Identifier: Apache-2.0
//! Canonical buv C ABI, sharing handles and allocation ownership with yolo compatibility exports.
use super::*;
use std::ffi::c_char;

pub type BuvHandle = YoloHandle;
pub type BuvStatus = YoloStatus;
pub type BuvBuffer = YoloBuffer;
pub type BuvCreateInfo = YoloCreateInfo;
pub type BuvSpawnInfo = YoloSpawnInfo;
pub type BuvProcessStatus = YoloProcessStatus;

#[unsafe(no_mangle)]
pub extern "C" fn buv_abi_version() -> u32 {
  yolo_abi_version()
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_runtime_create(
  info: *const YoloCreateInfo,
  out: *mut YoloHandle,
) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_runtime_create(info, out) }
}

#[unsafe(no_mangle)]
pub extern "C" fn buv_runtime_destroy(runtime: YoloHandle) -> YoloStatus {
  yolo_runtime_destroy(runtime)
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_runtime_capabilities(
  runtime: YoloHandle,
  out: *mut YoloBuffer,
) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_runtime_capabilities(runtime, out) }
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_system_stats(runtime: YoloHandle, out: *mut YoloBuffer) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_system_stats(runtime, out) }
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_bench_start(
  runtime: YoloHandle,
  iterations: u32,
  out_operation: *mut YoloHandle,
) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_bench_start(runtime, iterations, out_operation) }
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_operation_wait(
  operation: YoloHandle,
  timeout_ms: u32,
  out: *mut YoloBuffer,
) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_operation_wait(operation, timeout_ms, out) }
}

#[unsafe(no_mangle)]
pub extern "C" fn buv_operation_cancel(operation: YoloHandle) -> YoloStatus {
  yolo_operation_cancel(operation)
}

#[unsafe(no_mangle)]
pub extern "C" fn buv_operation_release(operation: YoloHandle) -> YoloStatus {
  yolo_operation_release(operation)
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_process_spawn(
  runtime: YoloHandle,
  info: *const YoloSpawnInfo,
  out: *mut YoloHandle,
) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_process_spawn(runtime, info, out) }
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_process_status(
  process: YoloHandle,
  out: *mut YoloProcessStatus,
) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_process_status(process, out) }
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_process_read(
  process: YoloHandle,
  stream: u32,
  mode: u32,
  out: *mut YoloBuffer,
) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_process_read(process, stream, mode, out) }
}

#[unsafe(no_mangle)]
pub extern "C" fn buv_process_stop(process: YoloHandle, grace_ms: u32) -> YoloStatus {
  yolo_process_stop(process, grace_ms)
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_process_stop_start(
  process: YoloHandle,
  grace_ms: u32,
  out_operation: *mut YoloHandle,
) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_process_stop_start(process, grace_ms, out_operation) }
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_process_output_complete(
  process: YoloHandle,
  out: *mut u32,
) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_process_output_complete(process, out) }
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_process_stdin_write(
  process: YoloHandle,
  bytes: *const u8,
  len: usize,
) -> YoloStatus {
  // SAFETY: the caller retains the readable input required by the shared owner.
  unsafe { yolo_process_stdin_write(process, bytes, len) }
}

#[unsafe(no_mangle)]
pub extern "C" fn buv_process_stdin_close(process: YoloHandle) -> YoloStatus {
  yolo_process_stdin_close(process)
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_process_wait_start(
  process: YoloHandle,
  out: *mut YoloHandle,
) -> YoloStatus {
  // SAFETY: the caller provides the writable output required by the shared owner.
  unsafe { yolo_process_wait_start(process, out) }
}

#[unsafe(no_mangle)]
pub extern "C" fn buv_process_release(process: YoloHandle) -> YoloStatus {
  yolo_process_release(process)
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_http_probe_start(
  runtime: YoloHandle,
  host: *const c_char,
  port: u16,
  path: *const c_char,
  timeout_ms: u32,
  out_operation: *mut YoloHandle,
) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_http_probe_start(runtime, host, port, path, timeout_ms, out_operation) }
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_buffer_free(buffer: *mut YoloBuffer) {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_buffer_free(buffer) }
}

/// # Safety
/// Pointer arguments follow the corresponding yolo compatibility function's contract.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_last_error(out: *mut YoloBuffer) -> YoloStatus {
  // SAFETY: caller retains the same readable and writable pointers required by the compatibility ABI.
  unsafe { yolo_last_error(out) }
}

/// # Safety
/// `out` points to a writable, library-owned-buffer result slot.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn buv_runtime_build_info(out: *mut YoloBuffer) -> YoloStatus {
  runtime_build_info(out, "buv-runtime")
}
