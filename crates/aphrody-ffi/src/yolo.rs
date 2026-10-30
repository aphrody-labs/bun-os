// SPDX-License-Identifier: Apache-2.0
//! Keeps the `yolo_*` and `ffi_sum_squares` C symbols of `yolo-runtime` in this cdylib.
//!
//! A cdylib only exports `#[no_mangle]` items from dependency rlibs that the final link
//! retains; the table below references each one so it survives. The ABI itself
//! (handles, panic containment, versioning) stays owned by `yolo-runtime`.

use yolo_runtime as rt;

struct Retained(#[allow(dead_code)] &'static [*const ()]);
// SAFETY: the table only holds addresses of immutable functions.
unsafe impl Sync for Retained {}

#[used]
static BASE: Retained = Retained(&[
    rt::yolo_buffer_free as *const (),
    rt::yolo_last_error as *const (),
    rt::yolo_abi_version as *const (),
    rt::yolo_runtime_create as *const (),
    rt::yolo_runtime_destroy as *const (),
    rt::yolo_runtime_build_info as *const (),
    rt::yolo_runtime_capabilities as *const (),
    rt::yolo_system_stats as *const (),
    rt::yolo_bench_start as *const (),
    rt::yolo_operation_wait as *const (),
    rt::yolo_operation_cancel as *const (),
    rt::yolo_operation_release as *const (),
    rt::ffi_sum_squares as *const (),
    rt::yolo_process_spawn as *const (),
    rt::yolo_process_status as *const (),
    rt::yolo_process_read as *const (),
    rt::yolo_process_output_complete as *const (),
    rt::yolo_process_stop as *const (),
    rt::yolo_process_stop_start as *const (),
    rt::yolo_process_release as *const (),
    rt::yolo_http_probe_start as *const (),
]);

#[cfg(feature = "gpu")]
#[used]
static GPU: Retained = Retained(&[rt::yolo_gpu_call_start as *const ()]);
