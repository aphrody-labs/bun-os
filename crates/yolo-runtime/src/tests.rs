// SPDX-License-Identifier: Apache-2.0
use super::*;

fn create(max_operations: u32) -> YoloHandle {
    let info = YoloCreateInfo {
        struct_size: size_of::<YoloCreateInfo>() as u32,
        abi_major: ABI_MAJOR,
        abi_minor: ABI_MINOR,
        max_operations,
    };
    let mut handle = 0;
    assert_eq!(
        unsafe { yolo_runtime_create(&info, &mut handle) },
        YoloStatus::Ok
    );
    assert_ne!(handle, 0);
    handle
}

fn empty() -> YoloBuffer {
    YoloBuffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
    }
}

fn take_json(mut buffer: YoloBuffer) -> serde_json::Value {
    assert!(!buffer.data.is_null());
    let bytes = unsafe { std::slice::from_raw_parts(buffer.data, buffer.len) }.to_vec();
    unsafe { yolo_buffer_free(&mut buffer) };
    assert!(buffer.data.is_null() && buffer.len == 0);
    serde_json::from_slice(&bytes).unwrap()
}

fn last_error() -> String {
    let mut out = empty();
    assert_eq!(unsafe { yolo_last_error(&mut out) }, YoloStatus::Ok);
    take_json(out)["message"].as_str().unwrap().to_string()
}

#[test]
fn buv_and_compatibility_exports_share_handles_and_buffer_ownership() {
    let info = YoloCreateInfo {
        struct_size: size_of::<YoloCreateInfo>() as u32,
        abi_major: ABI_MAJOR,
        abi_minor: ABI_MINOR,
        max_operations: 1,
    };
    let mut runtime = 0;
    assert_eq!(buv_abi_version(), yolo_abi_version());
    // SAFETY: creation and output slots live until each native call returns.
    assert_eq!(
        unsafe { buv_runtime_create(&info, &mut runtime) },
        YoloStatus::Ok
    );
    let mut output = empty();
    assert_eq!(
        unsafe { buv_system_stats(runtime, &mut output) },
        YoloStatus::Ok
    );
    assert!(take_json(output)["os"].is_string());
    let mut identity = empty();
    assert_eq!(
        unsafe { buv_runtime_build_info(&mut identity) },
        YoloStatus::Ok
    );
    assert_eq!(take_json(identity)["name"], "buv-runtime");
    let mut legacy_identity = empty();
    assert_eq!(
        unsafe { yolo_runtime_build_info(&mut legacy_identity) },
        YoloStatus::Ok
    );
    assert_eq!(take_json(legacy_identity)["name"], "yolo-runtime");
    assert_eq!(yolo_runtime_destroy(runtime), YoloStatus::Ok);
    assert_eq!(buv_runtime_destroy(runtime), YoloStatus::InvalidHandle);
}

#[test]
fn buffer_transfer_preserves_allocation_and_initialized_length() {
    let mut bytes = Vec::with_capacity(64);
    bytes.extend_from_slice(b"abc");
    let data = bytes.as_mut_ptr();
    let capacity = bytes.capacity();
    let mut out = empty();
    assert_eq!(write_buffer(&mut out, bytes), YoloStatus::Ok);
    assert_eq!(out.data, data);
    assert_eq!(out.cap, capacity);
    assert!(out.cap > out.len);
    assert_eq!(out.len, 3);
    // SAFETY: the buffer is live; only the initialized prefix is exposed by len.
    assert_eq!(
        unsafe { std::slice::from_raw_parts(out.data, out.len) },
        b"abc"
    );
    unsafe { yolo_buffer_free(&mut out) };
    assert!(out.data.is_null());
    assert_eq!((out.len, out.cap), (0, 0));
}

#[test]
fn buffer_transfer_preserves_empty_reserved_allocation() {
    let mut bytes = Vec::with_capacity(64);
    let data = bytes.as_mut_ptr();
    let capacity = bytes.capacity();
    let mut out = empty();
    assert_eq!(write_buffer(&mut out, bytes), YoloStatus::Ok);
    assert_eq!(out.data, data);
    assert_eq!(out.len, 0);
    assert_eq!(out.cap, capacity);
    assert!(out.cap > 0);
    unsafe { yolo_buffer_free(&mut out) };
    assert!(out.data.is_null());
    assert_eq!((out.len, out.cap), (0, 0));
}

#[test]
fn buffer_transfer_preserves_empty_unallocated_parts() {
    let mut bytes = Vec::new();
    let data = bytes.as_mut_ptr();
    let mut out = empty();
    assert_eq!(write_buffer(&mut out, bytes), YoloStatus::Ok);
    assert_eq!(out.data, data);
    assert_eq!((out.len, out.cap), (0, 0));
    unsafe { yolo_buffer_free(&mut out) };
    assert!(out.data.is_null());
    assert_eq!((out.len, out.cap), (0, 0));
}

#[test]
fn buffer_free_zeroes_owned_parts_and_accepts_repeated_or_null_release() {
    let mut out = empty();
    assert_eq!(write_buffer(&mut out, vec![1, 2, 3]), YoloStatus::Ok);
    for _ in 0..2 {
        unsafe { yolo_buffer_free(&mut out) };
        assert!(out.data.is_null());
        assert_eq!((out.len, out.cap), (0, 0));
    }
    let mut zeroed = empty();
    unsafe {
        yolo_buffer_free(&mut zeroed);
        yolo_buffer_free(ptr::null_mut());
    }
    assert!(zeroed.data.is_null());
    assert_eq!((zeroed.len, zeroed.cap), (0, 0));
}

#[test]
fn buffer_transfer_rejects_null_output() {
    let mut bytes = Vec::with_capacity(64);
    bytes.extend_from_slice(b"abc");
    assert_eq!(
        write_buffer(ptr::null_mut(), bytes),
        YoloStatus::InvalidArgument
    );
    assert_eq!(last_error(), "null output buffer");
}

#[test]
fn abi_version_is_major_minor() {
    assert_eq!(yolo_abi_version(), (ABI_MAJOR << 16) | ABI_MINOR);
}

#[test]
fn additive_process_caps_accept_abi_14_and_share_the_canonical_buv_owner() {
    let info = YoloCreateInfo {
        struct_size: size_of::<YoloCreateInfo>() as u32,
        abi_major: 1,
        abi_minor: 4,
        max_operations: 1,
    };
    let mut runtime = 0;
    assert_eq!(
        unsafe { buv_runtime_create(&info, &mut runtime) },
        YoloStatus::Ok
    );
    let mut caps = empty();
    assert_eq!(
        unsafe { buv_runtime_capabilities(runtime, &mut caps) },
        YoloStatus::Ok
    );
    let caps = take_json(caps);
    assert!(
        caps.as_array()
            .unwrap()
            .iter()
            .any(|value| value == "process.stdin")
    );
    assert!(
        caps.as_array()
            .unwrap()
            .iter()
            .any(|value| value == "process.wait")
    );
    assert_eq!(buv_runtime_destroy(runtime), YoloStatus::Ok);
    let header = include_str!("../include/buv_runtime.h");
    for name in [
        "buv_process_stdin_write",
        "buv_process_stdin_close",
        "buv_process_wait_start",
    ] {
        assert!(header.contains(&format!("{name}(")));
    }
}

#[test]
fn create_rejects_incompatible_or_truncated_callers() {
    let mut handle = 0;
    let wrong_major = YoloCreateInfo {
        struct_size: size_of::<YoloCreateInfo>() as u32,
        abi_major: ABI_MAJOR + 1,
        abi_minor: 0,
        max_operations: 0,
    };
    assert_eq!(
        unsafe { yolo_runtime_create(&wrong_major, &mut handle) },
        YoloStatus::AbiMismatch
    );
    assert!(last_error().contains("ABI"));
    assert_eq!(handle, 0);

    let newer_minor = YoloCreateInfo {
        abi_major: ABI_MAJOR,
        abi_minor: ABI_MINOR + 1,
        ..wrong_major
    };
    assert_eq!(
        unsafe { yolo_runtime_create(&newer_minor, &mut handle) },
        YoloStatus::AbiMismatch
    );

    let truncated = YoloCreateInfo {
        struct_size: 4,
        abi_major: ABI_MAJOR,
        abi_minor: 0,
        max_operations: 0,
    };
    assert_eq!(
        unsafe { yolo_runtime_create(&truncated, &mut handle) },
        YoloStatus::InvalidArgument
    );

    assert_eq!(
        unsafe { yolo_runtime_create(ptr::null(), &mut handle) },
        YoloStatus::InvalidArgument
    );
    let too_many = YoloCreateInfo {
        abi_major: ABI_MAJOR,
        abi_minor: 0,
        max_operations: 1000,
        ..wrong_major
    };
    assert_eq!(
        unsafe { yolo_runtime_create(&too_many, &mut handle) },
        YoloStatus::InvalidArgument
    );
}

#[test]
fn older_caller_without_max_operations_gets_the_default() {
    // A caller built against a smaller structure (12 bytes) must still work.
    let info = YoloCreateInfo {
        struct_size: 12,
        abi_major: ABI_MAJOR,
        abi_minor: 0,
        max_operations: 999,
    };
    let mut handle = 0;
    assert_eq!(
        unsafe { yolo_runtime_create(&info, &mut handle) },
        YoloStatus::Ok
    );
    assert_eq!(yolo_runtime_destroy(handle), YoloStatus::Ok);
}

#[test]
fn handles_are_validated_and_invalidated_on_destroy() {
    let rt = create(0);
    let mut out = empty();
    assert_eq!(unsafe { yolo_system_stats(rt, &mut out) }, YoloStatus::Ok);
    let stats = take_json(out);
    assert!(!stats["os"].as_str().unwrap().is_empty());

    assert_eq!(yolo_runtime_destroy(rt), YoloStatus::Ok);
    let mut out = empty();
    assert_eq!(
        unsafe { yolo_system_stats(rt, &mut out) },
        YoloStatus::InvalidHandle
    );
    assert!(out.data.is_null());
    assert_eq!(yolo_runtime_destroy(rt), YoloStatus::InvalidHandle);

    // A recycled slot gets a new generation: the stale handle stays invalid.
    let rt2 = create(0);
    assert_ne!(rt, rt2);
    assert_eq!(yolo_runtime_destroy(rt), YoloStatus::InvalidHandle);
    assert_eq!(yolo_runtime_destroy(rt2), YoloStatus::Ok);
    assert_eq!(yolo_runtime_destroy(0), YoloStatus::InvalidHandle);
    assert_eq!(
        yolo_runtime_destroy(0xdead_beef_dead_beef),
        YoloStatus::InvalidHandle
    );
}

#[test]
fn build_info_and_capabilities_are_json() {
    let mut out = empty();
    assert_eq!(unsafe { yolo_runtime_build_info(&mut out) }, YoloStatus::Ok);
    let info = take_json(out);
    assert_eq!(info["name"], "yolo-runtime");
    assert_eq!(info["abi"], format!("{ABI_MAJOR}.{ABI_MINOR}"));
    assert_eq!(info["panic_recovery"], cfg!(panic = "unwind"));
    assert!(!info["target"].as_str().unwrap().is_empty());

    let rt = create(0);
    let mut out = empty();
    assert_eq!(
        unsafe { yolo_runtime_capabilities(rt, &mut out) },
        YoloStatus::Ok
    );
    let capabilities = take_json(out);
    let names: Vec<&str> = capabilities
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap())
        .collect();
    assert_eq!(
        names[..4],
        [
            "system.stats",
            "bench.compute",
            "process.supervise",
            "http.probe"
        ]
    );
    // Optional providers appear exactly when they are compiled in.
    for (name, enabled) in [
        ("gpu.info", cfg!(feature = "gpu")),
        ("gpu.wgsl", cfg!(feature = "gpu")),
        ("gpu.cuda", cfg!(feature = "cuda")),
    ] {
        assert_eq!(names.contains(&name), enabled, "{name}");
    }
    yolo_runtime_destroy(rt);
}

#[test]
fn benchmark_completes_and_is_released() {
    let rt = create(0);
    let mut op = 0;
    assert_eq!(
        unsafe { yolo_bench_start(rt, 1000, &mut op) },
        YoloStatus::Ok
    );
    let mut out = empty();
    assert_eq!(
        unsafe { yolo_operation_wait(op, 10_000, &mut out) },
        YoloStatus::Ok
    );
    assert!(take_json(out)["message"].as_str().unwrap().contains("1000"));
    // The result stays readable until the operation is released.
    let mut again = empty();
    assert_eq!(
        unsafe { yolo_operation_wait(op, 0, &mut again) },
        YoloStatus::Ok
    );
    take_json(again);
    assert_eq!(yolo_operation_release(op), YoloStatus::Ok);
    assert_eq!(yolo_operation_release(op), YoloStatus::InvalidHandle);
    assert_eq!(yolo_runtime_destroy(rt), YoloStatus::Ok);
}

#[test]
fn long_benchmark_can_be_cancelled_and_times_out_before() {
    let rt = create(0);
    let mut op = 0;
    assert_eq!(
        unsafe { yolo_bench_start(rt, u32::MAX, &mut op) },
        YoloStatus::Ok
    );
    let mut out = empty();
    assert_eq!(
        unsafe { yolo_operation_wait(op, 0, &mut out) },
        YoloStatus::Timeout
    );
    assert!(out.data.is_null());
    assert_eq!(yolo_operation_cancel(op), YoloStatus::Ok);
    assert_eq!(yolo_operation_cancel(op), YoloStatus::Ok);
    assert_eq!(
        unsafe { yolo_operation_wait(op, 10_000, &mut out) },
        YoloStatus::Cancelled
    );
    assert_eq!(yolo_operation_release(op), YoloStatus::Ok);
    assert_eq!(yolo_runtime_destroy(rt), YoloStatus::Ok);
}

#[test]
fn operations_are_bounded_per_runtime() {
    let rt = create(1);
    let mut first = 0;
    assert_eq!(
        unsafe { yolo_bench_start(rt, u32::MAX, &mut first) },
        YoloStatus::Ok
    );
    let mut second = 0;
    assert_eq!(
        unsafe { yolo_bench_start(rt, 10, &mut second) },
        YoloStatus::Busy
    );
    assert_eq!(second, 0);
    assert_eq!(yolo_operation_release(first), YoloStatus::Ok);
    assert_eq!(
        unsafe { yolo_bench_start(rt, 10, &mut second) },
        YoloStatus::Ok
    );
    assert_eq!(yolo_runtime_destroy(rt), YoloStatus::Ok);
}

#[test]
fn destroying_a_runtime_cancels_joins_and_invalidates_its_operations() {
    let rt = create(0);
    let mut a = 0;
    let mut b = 0;
    assert_eq!(
        unsafe { yolo_bench_start(rt, u32::MAX, &mut a) },
        YoloStatus::Ok
    );
    assert_eq!(
        unsafe { yolo_bench_start(rt, u32::MAX, &mut b) },
        YoloStatus::Ok
    );
    let started = std::time::Instant::now();
    assert_eq!(yolo_runtime_destroy(rt), YoloStatus::Ok);
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "workers must stop promptly"
    );
    let mut out = empty();
    assert_eq!(
        unsafe { yolo_operation_wait(a, 0, &mut out) },
        YoloStatus::InvalidHandle
    );
    assert_eq!(yolo_operation_cancel(b), YoloStatus::InvalidHandle);
}

#[test]
fn an_operation_handle_is_not_a_runtime_handle() {
    let rt = create(0);
    let mut op = 0;
    assert_eq!(unsafe { yolo_bench_start(rt, 10, &mut op) }, YoloStatus::Ok);
    let mut out = empty();
    assert_eq!(
        unsafe { yolo_system_stats(op, &mut out) },
        YoloStatus::InvalidHandle
    );
    assert_eq!(yolo_runtime_destroy(op), YoloStatus::InvalidHandle);
    assert_eq!(
        unsafe { yolo_operation_wait(rt, 0, &mut out) },
        YoloStatus::InvalidHandle
    );
    yolo_operation_release(op);
    yolo_runtime_destroy(rt);
}

#[test]
fn null_outputs_are_rejected() {
    let rt = create(0);
    assert_eq!(
        unsafe { yolo_system_stats(rt, ptr::null_mut()) },
        YoloStatus::InvalidArgument
    );
    assert_eq!(
        unsafe { yolo_bench_start(rt, 1, ptr::null_mut()) },
        YoloStatus::InvalidArgument
    );
    unsafe { yolo_buffer_free(ptr::null_mut()) };
    let mut zeroed = empty();
    unsafe { yolo_buffer_free(&mut zeroed) };
    yolo_runtime_destroy(rt);
}

#[test]
#[cfg(panic = "unwind")]
fn panics_become_a_status_with_an_error_message() {
    let status = guard(|| panic!("boom"));
    assert_eq!(status, YoloStatus::Panic);
    assert!(last_error().contains("boom"));
}

#[test]
fn every_exported_function_is_declared_in_the_c_header() {
    let header = include_str!("../include/yolo_runtime.h");
    for name in [
        "yolo_abi_version",
        "yolo_runtime_create",
        "yolo_runtime_destroy",
        "yolo_runtime_build_info",
        "yolo_runtime_capabilities",
        "yolo_system_stats",
        "yolo_bench_start",
        "yolo_operation_wait",
        "yolo_operation_cancel",
        "yolo_operation_release",
        "yolo_buffer_free",
        "yolo_last_error",
        "yolo_process_spawn",
        "yolo_process_status",
        "yolo_process_output_complete",
        "yolo_process_stdin_write",
        "yolo_process_stdin_close",
        "yolo_process_wait_start",
        "yolo_process_stop",
        "yolo_process_release",
        "yolo_process_read",
        "yolo_process_stop_start",
        "yolo_http_probe_start",
        "ffi_sum_squares",
    ] {
        assert!(
            header.contains(&format!("{name}(")),
            "{name} missing from yolo_runtime.h"
        );
    }
    assert!(header.contains(&format!("#define YOLO_ABI_MAJOR {ABI_MAJOR}u")));
    assert!(header.contains(&format!("#define YOLO_ABI_MINOR {ABI_MINOR}u")));
}

// Re-enter this test executable as the owned child. Payload bytes travel only through stdin.
#[test]
#[ignore = "owned process fixture, invoked by stdin/wait tests"]
fn process_pipe_child_fixture() {
    use std::io::{Read, Write};
    let Ok(mode) = std::env::var("YOLO_TEST_PIPE_CHILD") else {
        return;
    };
    #[cfg(unix)]
    if mode == "escape-reader" {
        use std::os::unix::process::CommandExt;
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "tests::process_pipe_child_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("YOLO_TEST_PIPE_CHILD", "hang")
            .stdin(std::process::Stdio::inherit())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .process_group(0);
        let escaped = command.spawn().unwrap();
        eprintln!("ESCAPED_STDIN_READER={}", escaped.id());
        std::process::exit(0);
    }
    if mode == "hang" {
        let pair = (std::sync::Mutex::new(()), std::sync::Condvar::new());
        let mut guard = pair.0.lock().unwrap();
        loop {
            guard = pair.1.wait(guard).unwrap();
        }
    }
    let mut bytes = Vec::new();
    std::io::stdin().read_to_end(&mut bytes).unwrap();
    std::io::stdout().write_all(&bytes).unwrap();
    std::io::stdout().flush().unwrap();
    std::io::stderr().write_all(b"COMPLETE_STDERR").unwrap();
    std::process::exit(7);
}

#[cfg(any(unix, windows))]
mod process_pipe {
    use super::*;
    use std::ffi::CString;

    fn spawn_child(runtime: YoloHandle, mode: &str, flags: u32, budget: u64) -> YoloHandle {
        let program = CString::new(std::env::current_exe().unwrap().to_str().unwrap()).unwrap();
        let args: Vec<CString> = [
            "--exact",
            "tests::process_pipe_child_fixture",
            "--ignored",
            "--nocapture",
        ]
        .into_iter()
        .map(|value| CString::new(value).unwrap())
        .collect();
        let mut pointers: Vec<_> = args.iter().map(|value| value.as_ptr()).collect();
        pointers.push(ptr::null());
        let environment = CString::new(format!("YOLO_TEST_PIPE_CHILD={mode}")).unwrap();
        let environment_pointers = [environment.as_ptr(), ptr::null()];
        #[repr(C)]
        struct Extended {
            base: YoloSpawnInfo,
            budget: u64,
        }
        let info = Extended {
            base: YoloSpawnInfo {
                struct_size: size_of::<Extended>() as u32,
                flags,
                program: program.as_ptr(),
                args: pointers.as_ptr(),
                env: environment_pointers.as_ptr(),
                cwd: ptr::null(),
            },
            budget,
        };
        let mut process = 0;
        assert_eq!(
            unsafe { yolo_process_spawn(runtime, &info.base, &mut process) },
            YoloStatus::Ok
        );
        process
    }
    fn wait_start(process: YoloHandle) -> YoloHandle {
        let mut operation = 0;
        assert_eq!(
            unsafe { yolo_process_wait_start(process, &mut operation) },
            YoloStatus::Ok
        );
        operation
    }
    fn wait(operation: YoloHandle, milliseconds: u32) -> (YoloStatus, Vec<u8>) {
        let mut output = empty();
        let status = unsafe { yolo_operation_wait(operation, milliseconds, &mut output) };
        let bytes = if output.data.is_null() {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(output.data, output.len) }.to_vec()
        };
        unsafe { yolo_buffer_free(&mut output) };
        (status, bytes)
    }
    fn read(process: YoloHandle, stream: u32) -> Vec<u8> {
        let mut output = empty();
        assert_eq!(
            unsafe { yolo_process_read(process, stream, YOLO_READ_DRAIN, &mut output) },
            YoloStatus::Ok
        );
        let bytes = unsafe { std::slice::from_raw_parts(output.data, output.len) }.to_vec();
        unsafe { yolo_buffer_free(&mut output) };
        bytes
    }

    #[test]
    fn stdin_binary_bytes_close_and_wait_preserve_complete_capture_without_polling() {
        let runtime = create(1); // The process uses its slot; waiting must still be allowed.
        let child = spawn_child(
            runtime,
            "echo",
            YOLO_SPAWN_CAPTURE_LOSSLESS | YOLO_SPAWN_PIPE_STDIN,
            0,
        );
        let bytes: Vec<u8> = (0..=255u8).cycle().take(256 * 1024).collect();
        assert_eq!(
            unsafe { buv_process_stdin_write(child, bytes.as_ptr(), bytes.len()) },
            YoloStatus::Ok
        );
        assert_eq!(buv_process_stdin_close(child), YoloStatus::Ok);
        assert_eq!(yolo_process_stdin_close(child), YoloStatus::Ok);
        assert_eq!(
            unsafe { yolo_process_stdin_write(child, bytes.as_ptr(), 1) },
            YoloStatus::InvalidArgument
        );
        let operation = wait_start(child);
        let (status, result) = wait(operation, 3000);
        assert_eq!(status, YoloStatus::Ok);
        let result: serde_json::Value = serde_json::from_slice(&result).unwrap();
        assert_eq!(result["exit_code"], 7);
        assert_eq!(result["state"], 1);
        assert_eq!(result["output_complete"], true);
        assert_eq!(result["stdin_complete"], true);
        assert!(read(child, YOLO_STREAM_STDOUT).ends_with(&bytes));
        assert_eq!(read(child, YOLO_STREAM_STDERR), b"COMPLETE_STDERR");
        assert_eq!(yolo_operation_release(operation), YoloStatus::Ok);
        assert_eq!(yolo_process_release(child), YoloStatus::Ok);
        assert_eq!(yolo_runtime_destroy(runtime), YoloStatus::Ok);
    }

    #[test]
    fn wait_cancel_unblocks_full_stdin_pipe_and_all_capture_workers() {
        let runtime = create(1);
        let child = spawn_child(
            runtime,
            "hang",
            YOLO_SPAWN_CAPTURE_LOSSLESS | YOLO_SPAWN_PIPE_STDIN,
            0,
        );
        let bytes = vec![0; YOLO_STDIN_MAX_BYTES];
        assert_eq!(
            unsafe { yolo_process_stdin_write(child, bytes.as_ptr(), bytes.len()) },
            YoloStatus::Ok
        );
        assert_eq!(
            unsafe { yolo_process_stdin_write(child, bytes.as_ptr(), 1) },
            YoloStatus::InvalidArgument
        );
        let operation = wait_start(child);
        let mut duplicate = 0;
        assert_eq!(
            unsafe { yolo_process_wait_start(child, &mut duplicate) },
            YoloStatus::Busy
        );
        assert_eq!(wait(operation, 1).0, YoloStatus::Timeout);
        let thread = std::thread::spawn(move || wait(operation, 3000).0);
        assert_eq!(yolo_operation_cancel(operation), YoloStatus::Ok);
        assert_eq!(thread.join().unwrap(), YoloStatus::Cancelled);
        assert_eq!(yolo_operation_release(operation), YoloStatus::Ok);
        let mut complete = 0;
        assert_eq!(
            unsafe { yolo_process_output_complete(child, &mut complete) },
            YoloStatus::Ok
        );
        assert_eq!(complete, 1);
        assert_eq!(yolo_process_release(child), YoloStatus::Ok);
        assert_eq!(yolo_runtime_destroy(runtime), YoloStatus::Ok);
    }

    #[test]
    fn native_wait_does_not_consume_an_additional_runtime_capacity_slot() {
        let runtime = create(2);
        let first = spawn_child(
            runtime,
            "hang",
            YOLO_SPAWN_CAPTURE_LOSSLESS | YOLO_SPAWN_PIPE_STDIN,
            0,
        );
        let operation = wait_start(first);
        let second = spawn_child(runtime, "echo", YOLO_SPAWN_CAPTURE_LOSSLESS, 0);
        let mut benchmark = 0;
        assert_eq!(
            unsafe { yolo_bench_start(runtime, 1, &mut benchmark) },
            YoloStatus::Busy
        );
        assert_eq!(yolo_operation_cancel(operation), YoloStatus::Ok);
        assert_eq!(wait(operation, 3000).0, YoloStatus::Cancelled);
        assert_eq!(yolo_operation_release(operation), YoloStatus::Ok);
        assert_eq!(yolo_process_release(first), YoloStatus::Ok);
        let second_wait = wait_start(second);
        assert_eq!(wait(second_wait, 3000).0, YoloStatus::Ok);
        assert_eq!(yolo_operation_release(second_wait), YoloStatus::Ok);
        assert_eq!(yolo_process_release(second), YoloStatus::Ok);
        assert_eq!(yolo_runtime_destroy(runtime), YoloStatus::Ok);
    }

    #[cfg(unix)]
    #[test]
    fn exited_leader_with_escaped_stdin_reader_cannot_block_native_wait() {
        let runtime = create(1);
        let child = spawn_child(
            runtime,
            "escape-reader",
            YOLO_SPAWN_CAPTURE_LOSSLESS | YOLO_SPAWN_PIPE_STDIN,
            0,
        );
        let bytes = vec![0; YOLO_STDIN_MAX_BYTES];
        assert_eq!(
            unsafe { yolo_process_stdin_write(child, bytes.as_ptr(), bytes.len()) },
            YoloStatus::Ok
        );
        let operation = wait_start(child);
        let (status, _) = wait(operation, 3000);
        let stderr = String::from_utf8(read(child, YOLO_STREAM_STDERR)).unwrap();
        let escaped: i32 = stderr
            .lines()
            .find_map(|line| line.strip_prefix("ESCAPED_STDIN_READER="))
            .unwrap()
            .parse()
            .unwrap();
        assert!(escaped > 0);
        // SAFETY: only the process group explicitly created by this fixture is targeted.
        assert_eq!(unsafe { libc::kill(-escaped, libc::SIGKILL) }, 0);
        assert_eq!(status, YoloStatus::Internal); // Accepted bytes were not consumed: never claim success.
        let mut complete = 0;
        assert_eq!(
            unsafe { yolo_process_output_complete(child, &mut complete) },
            YoloStatus::Ok
        );
        assert_eq!(complete, 1);
        assert_eq!(yolo_operation_release(operation), YoloStatus::Ok);
        assert_eq!(yolo_process_release(child), YoloStatus::Ok);
        assert_eq!(yolo_runtime_destroy(runtime), YoloStatus::Ok);
    }

    #[test]
    fn wait_propagates_capture_overflow_and_old_capture_callers_still_work() {
        let runtime = create(0);
        let child = spawn_child(
            runtime,
            "echo",
            YOLO_SPAWN_CAPTURE_LOSSLESS | YOLO_SPAWN_PIPE_STDIN,
            64,
        );
        let bytes = vec![1; 4096];
        assert_eq!(
            unsafe { yolo_process_stdin_write(child, bytes.as_ptr(), bytes.len()) },
            YoloStatus::Ok
        );
        assert_eq!(yolo_process_stdin_close(child), YoloStatus::Ok);
        let operation = wait_start(child);
        assert_eq!(wait(operation, 3000).0, YoloStatus::OutputLimit);
        yolo_operation_release(operation);
        yolo_process_release(child);
        let old = spawn_child(runtime, "echo", YOLO_SPAWN_CAPTURE_LOSSLESS, 0);
        assert_eq!(yolo_process_stdin_close(old), YoloStatus::InvalidArgument);
        assert_eq!(
            unsafe { yolo_process_stdin_write(old, ptr::null(), 0) },
            YoloStatus::InvalidArgument
        );
        let operation = wait_start(old);
        assert_eq!(wait(operation, 3000).0, YoloStatus::Ok);
        yolo_operation_release(operation);
        yolo_process_release(old);
        assert_eq!(yolo_runtime_destroy(runtime), YoloStatus::Ok);
    }

    #[test]
    fn process_release_and_runtime_destroy_are_safe_during_a_blocking_wait() {
        for destroy_runtime in [false, true] {
            let runtime = create(1);
            let child = spawn_child(
                runtime,
                "hang",
                YOLO_SPAWN_CAPTURE_LOSSLESS | YOLO_SPAWN_PIPE_STDIN,
                0,
            );
            let operation = wait_start(child);
            let thread = std::thread::spawn(move || wait(operation, 3000).0);
            if destroy_runtime {
                assert_eq!(yolo_runtime_destroy(runtime), YoloStatus::Ok);
            } else {
                assert_eq!(yolo_process_release(child), YoloStatus::Ok);
            }
            let result = thread.join().unwrap();
            if destroy_runtime {
                assert!(matches!(
                    result,
                    YoloStatus::Cancelled | YoloStatus::InvalidHandle
                ));
            } else {
                assert_eq!(result, YoloStatus::Ok);
                yolo_operation_release(operation);
                yolo_runtime_destroy(runtime);
            }
        }
    }
}

#[cfg(unix)]
mod process {
    use super::*;
    use std::ffi::CString;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::Instant;

    fn cstrings(items: &[&str]) -> (Vec<CString>, Vec<*const std::ffi::c_char>) {
        let owned: Vec<CString> = items.iter().map(|s| CString::new(*s).unwrap()).collect();
        let mut pointers: Vec<*const std::ffi::c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        pointers.push(ptr::null());
        (owned, pointers)
    }

    fn spawn(
        rt: YoloHandle,
        program: &str,
        args: &[&str],
        env: &[&str],
    ) -> (YoloStatus, YoloHandle) {
        let program = CString::new(program).unwrap();
        let (_args_owned, args_ptrs) = cstrings(args);
        let (_env_owned, env_ptrs) = cstrings(env);
        let info = YoloSpawnInfo {
            struct_size: size_of::<YoloSpawnInfo>() as u32,
            flags: YOLO_SPAWN_NULL_STDIO,
            program: program.as_ptr(),
            args: args_ptrs.as_ptr(),
            env: env_ptrs.as_ptr(),
            cwd: ptr::null(),
        };
        let mut handle = 0;
        let status = unsafe { yolo_process_spawn(rt, &info, &mut handle) };
        (status, handle)
    }

    fn status_of(process: YoloHandle) -> YoloProcessStatus {
        let mut out = YoloProcessStatus {
            struct_size: size_of::<YoloProcessStatus>() as u32,
            state: 9,
            exit_code: 0,
            signal: 0,
            pid: 0,
        };
        assert_eq!(
            unsafe { yolo_process_status(process, &mut out) },
            YoloStatus::Ok
        );
        out
    }

    fn wait_exited(process: YoloHandle) -> YoloProcessStatus {
        for _ in 0..500 {
            let status = status_of(process);
            if status.state == 1 {
                return status;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("process did not exit");
    }

    #[test]
    fn spawn_reports_exit_code_and_environment() {
        let rt = create(0);
        let (status, process) = spawn(
            rt,
            "sh",
            &["-c", "exit $YOLO_TEST_CODE"],
            &["YOLO_TEST_CODE=3"],
        );
        assert_eq!(status, YoloStatus::Ok);
        let done = wait_exited(process);
        assert_eq!((done.exit_code, done.signal), (3, 0));
        assert!(done.pid > 0);
        assert_eq!(yolo_process_release(process), YoloStatus::Ok);
        assert_eq!(yolo_process_release(process), YoloStatus::InvalidHandle);
        yolo_runtime_destroy(rt);
    }

    fn spawn_flags(
        rt: YoloHandle,
        flags: u32,
        program: &str,
        args: &[&str],
    ) -> (YoloStatus, YoloHandle) {
        let program = CString::new(program).unwrap();
        let (_args_owned, args_ptrs) = cstrings(args);
        let info = YoloSpawnInfo {
            struct_size: size_of::<YoloSpawnInfo>() as u32,
            flags,
            program: program.as_ptr(),
            args: args_ptrs.as_ptr(),
            env: ptr::null(),
            cwd: ptr::null(),
        };
        let mut handle = 0;
        let status = unsafe { yolo_process_spawn(rt, &info, &mut handle) };
        (status, handle)
    }

    fn read_stream(process: YoloHandle, stream: u32, mode: u32) -> String {
        let mut out = empty();
        assert_eq!(
            unsafe { yolo_process_read(process, stream, mode, &mut out) },
            YoloStatus::Ok
        );
        let bytes = if out.data.is_null() {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(out.data, out.len) }.to_vec()
        };
        unsafe { yolo_buffer_free(&mut out) };
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn captured_output_is_drained_or_peeked_and_bounded() {
        let rt = create(0);
        let (status, process) = spawn_flags(
            rt,
            YOLO_SPAWN_CAPTURE,
            "sh",
            &["-c", "echo first-line; echo to-stderr >&2; sleep 0.3"],
        );
        assert_eq!(status, YoloStatus::Ok);
        wait_exited(process);
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(
            read_stream(process, YOLO_STREAM_STDERR, YOLO_READ_PEEK),
            "to-stderr\n"
        );
        assert_eq!(
            read_stream(process, YOLO_STREAM_STDERR, YOLO_READ_PEEK),
            "to-stderr\n"
        );
        assert_eq!(
            read_stream(process, YOLO_STREAM_STDOUT, YOLO_READ_DRAIN),
            "first-line\n"
        );
        assert_eq!(
            read_stream(process, YOLO_STREAM_STDOUT, YOLO_READ_DRAIN),
            ""
        );
        let mut out = empty();
        assert_eq!(
            unsafe { yolo_process_read(process, 9, 0, &mut out) },
            YoloStatus::InvalidArgument
        );
        assert_eq!(
            unsafe { yolo_process_read(process, 1, 9, &mut out) },
            YoloStatus::InvalidArgument
        );
        yolo_process_release(process);

        // 200 KiB of output: only the last 64 KiB are kept and the child never blocks on a full pipe.
        let (_, noisy) = spawn_flags(
            rt,
            YOLO_SPAWN_CAPTURE,
            "sh",
            &["-c", "head -c 204800 /dev/zero | tr '\\0' x"],
        );
        wait_exited(noisy);
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(
            read_stream(noisy, YOLO_STREAM_STDOUT, YOLO_READ_PEEK).len(),
            64 * 1024
        );
        yolo_process_release(noisy);
        yolo_runtime_destroy(rt);
    }

    fn read_bytes(process: YoloHandle, stream: u32) -> Result<Vec<u8>, YoloStatus> {
        let mut out = empty();
        let status = unsafe { yolo_process_read(process, stream, YOLO_READ_DRAIN, &mut out) };
        if status != YoloStatus::Ok {
            return Err(status);
        }
        let bytes = unsafe { std::slice::from_raw_parts(out.data, out.len) }.to_vec();
        unsafe { yolo_buffer_free(&mut out) };
        Ok(bytes)
    }

    #[test]
    fn lossless_capture_preserves_large_binary_outputs_and_joins_readers() {
        let rt = create(0);
        let (_, child) = spawn_flags(
            rt,
            YOLO_SPAWN_CAPTURE_LOSSLESS,
            "sh",
            &[
                "-c",
                "head -c 204800 /dev/zero; printf '\\377\\376\\200' >&2",
            ],
        );
        wait_exited(child);
        // Stop joins both readers; no arbitrary post-exit sleep is needed for the final drain.
        assert_eq!(yolo_process_stop(child, 0), YoloStatus::Ok);
        let mut complete = 0;
        assert_eq!(
            unsafe { yolo_process_output_complete(child, &mut complete) },
            YoloStatus::Ok
        );
        assert_eq!(complete, 1);
        assert_eq!(
            read_bytes(child, YOLO_STREAM_STDOUT).unwrap(),
            vec![0; 204800]
        );
        assert_eq!(
            read_bytes(child, YOLO_STREAM_STDERR).unwrap(),
            vec![255, 254, 128]
        );
        assert!(read_bytes(child, YOLO_STREAM_STDOUT).unwrap().is_empty());
        yolo_process_release(child);
        yolo_runtime_destroy(rt);
    }

    #[repr(C)]
    struct SpawnV14 {
        base: YoloSpawnInfo,
        capture_limit: u64,
    }

    #[test]
    fn lossless_budget_is_total_across_drains_and_never_silently_truncates() {
        let rt = create(0);
        let program = CString::new("sh").unwrap();
        let (_args_owned, args_ptrs) = cstrings(&["-c", "printf 12345678; sleep 0.1; printf 9"]);
        let info = SpawnV14 {
            base: YoloSpawnInfo {
                struct_size: size_of::<SpawnV14>() as u32,
                flags: YOLO_SPAWN_CAPTURE_LOSSLESS,
                program: program.as_ptr(),
                args: args_ptrs.as_ptr(),
                env: ptr::null(),
                cwd: ptr::null(),
            },
            capture_limit: 8,
        };
        let mut child = 0;
        assert_eq!(
            unsafe { yolo_process_spawn(rt, &info.base, &mut child) },
            YoloStatus::Ok
        );
        let mut initial = Vec::new();
        for _ in 0..100 {
            initial.extend(read_bytes(child, YOLO_STREAM_STDOUT).unwrap());
            if initial.len() == 8 {
                break;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(initial, b"12345678");
        wait_exited(child);
        yolo_process_stop(child, 0);
        assert_eq!(
            read_bytes(child, YOLO_STREAM_STDOUT),
            Err(YoloStatus::OutputLimit)
        );
        assert!(last_error().contains("8 byte capture budget"));
        // The error remains visible on subsequent reads, even after draining earlier chunks.
        assert_eq!(
            read_bytes(child, YOLO_STREAM_STDOUT),
            Err(YoloStatus::OutputLimit)
        );
        yolo_process_release(child);
        yolo_runtime_destroy(rt);
    }

    #[test]
    fn capture_rejects_unknown_flags_and_null_output_without_losing_data() {
        let rt = create(0);
        assert_eq!(
            spawn_flags(rt, 16, "true", &[]).0,
            YoloStatus::InvalidArgument
        );
        assert_eq!(
            spawn_flags(
                rt,
                YOLO_SPAWN_CAPTURE | YOLO_SPAWN_CAPTURE_LOSSLESS,
                "true",
                &[]
            )
            .0,
            YoloStatus::InvalidArgument
        );
        let (_, child) = spawn_flags(
            rt,
            YOLO_SPAWN_CAPTURE_LOSSLESS,
            "sh",
            &["-c", "printf bytes"],
        );
        wait_exited(child);
        yolo_process_stop(child, 0);
        assert_eq!(
            unsafe { yolo_process_read(child, 1, 0, ptr::null_mut()) },
            YoloStatus::InvalidArgument
        );
        assert_eq!(read_bytes(child, 1).unwrap(), b"bytes");
        assert_eq!(
            unsafe { yolo_process_output_complete(child, ptr::null_mut()) },
            YoloStatus::InvalidArgument
        );
        yolo_process_release(child);
        yolo_runtime_destroy(rt);
    }

    #[test]
    fn release_after_leader_exit_kills_descendants_and_joins_capture_workers() {
        let rt = create(0);
        let (_, child) = spawn_flags(rt, YOLO_SPAWN_CAPTURE, "sh", &["-c", "sleep 60 & exit 0"]);
        let pid = status_of(child).pid as i32;
        wait_exited(child);
        assert_eq!(yolo_process_release(child), YoloStatus::Ok);
        assert!(
            group_is_gone(pid),
            "descendant survived leader exit and handle release"
        );
        yolo_runtime_destroy(rt);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn escaped_writer_cannot_prevent_capture_worker_shutdown() {
        let rt = create(0);
        let (_, child) = spawn_flags(
            rt,
            YOLO_SPAWN_CAPTURE_LOSSLESS,
            "sh",
            &["-c", "setsid sh -c 'echo $$; sleep 60' & exit 0"],
        );
        wait_exited(child);
        let mut pid_bytes = Vec::new();
        for _ in 0..200 {
            pid_bytes.extend(read_bytes(child, YOLO_STREAM_STDOUT).unwrap());
            if pid_bytes.contains(&b'\n') {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let escaped: i32 = String::from_utf8(pid_bytes)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let started = Instant::now();
        let stopped = yolo_process_stop(child, 0);
        let read = read_bytes(child, YOLO_STREAM_STDOUT);
        let mut complete = 0;
        let completion = unsafe { yolo_process_output_complete(child, &mut complete) };
        // The fixture deliberately escaped the owned process group; reclaim it explicitly.
        unsafe { libc::kill(-escaped, libc::SIGKILL) };
        yolo_process_release(child);
        yolo_runtime_destroy(rt);
        assert_eq!(stopped, YoloStatus::Ok);
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(read, Err(YoloStatus::Internal));
        assert_eq!((completion, complete), (YoloStatus::Ok, 1));
        assert!(group_is_gone(escaped));
    }

    #[test]
    fn capture_and_null_stdio_are_exclusive() {
        let rt = create(0);
        let (status, _) = spawn_flags(rt, YOLO_SPAWN_CAPTURE | YOLO_SPAWN_NULL_STDIO, "true", &[]);
        assert_eq!(status, YoloStatus::InvalidArgument);
        yolo_runtime_destroy(rt);
    }

    #[test]
    fn a_bare_key_removes_a_variable_from_the_inherited_environment() {
        let rt = create(0);
        unsafe { std::env::set_var("YOLO_TEST_INHERITED", "yes") };
        let (_, kept) = spawn(rt, "sh", &["-c", "test -n \"$YOLO_TEST_INHERITED\""], &[]);
        assert_eq!(wait_exited(kept).exit_code, 0);
        let (_, removed) = spawn(
            rt,
            "sh",
            &["-c", "test -z \"$YOLO_TEST_INHERITED\""],
            &["YOLO_TEST_INHERITED"],
        );
        assert_eq!(wait_exited(removed).exit_code, 0);
        yolo_process_release(kept);
        yolo_process_release(removed);
        yolo_runtime_destroy(rt);
    }

    #[test]
    fn spawn_errors_are_structured() {
        let rt = create(0);
        let (status, handle) = spawn(rt, "/nonexistent/binary", &[], &[]);
        assert_eq!(status, YoloStatus::Internal);
        assert_eq!(handle, 0);
        assert!(last_error().contains("cannot spawn"));
        let (status, _) = spawn(rt, "sh", &[], &["=NO_KEY"]);
        assert_eq!(status, YoloStatus::InvalidArgument);
        let mut out = 0;
        assert_eq!(
            unsafe { yolo_process_spawn(rt, ptr::null(), &mut out) },
            YoloStatus::InvalidArgument
        );
        yolo_runtime_destroy(rt);
    }

    /// True once no live member answers in the group. Killed orphans can linger as zombies when the
    /// container init does not reap them (CI), so on Linux a zombie does not count as alive.
    fn group_is_gone(pgid: i32) -> bool {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if unsafe { libc::kill(-pgid, 0) } == -1 {
                return true;
            }
            #[cfg(target_os = "linux")]
            if !linux_group_has_live_member(pgid) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[cfg(target_os = "linux")]
    fn linux_group_has_live_member(pgid: i32) -> bool {
        let Ok(entries) = std::fs::read_dir("/proc") else {
            return true;
        };
        entries.flatten().any(|entry| {
            let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) else {
                return false;
            };
            // "pid (comm) state ppid pgrp ..." — comm may contain spaces, so split after the last ')'
            let Some(rest) = stat.rsplit_once(')').map(|(_, rest)| rest) else {
                return false;
            };
            let mut fields = rest.split_whitespace();
            let state = fields.next();
            let group = fields.nth(1).and_then(|g| g.parse::<i32>().ok());
            group == Some(pgid) && state != Some("Z")
        })
    }

    #[test]
    fn stop_terminates_the_whole_process_group() {
        let rt = create(0);
        // The shell backgrounds a child and waits: stopping must take both down.
        let (_, process) = spawn(rt, "sh", &["-c", "sleep 60 & wait"], &[]);
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(status_of(process).state, 0);
        let pid = status_of(process).pid as i32;
        let started = Instant::now();
        assert_eq!(yolo_process_stop(process, 2000), YoloStatus::Ok);
        assert!(started.elapsed() < Duration::from_secs(5));
        let done = status_of(process);
        assert_eq!(done.state, 1);
        assert_eq!(done.signal, libc::SIGTERM);
        // the group leader is gone and no member of the group answers any more
        assert!(
            group_is_gone(pid),
            "a member of process group {pid} is still alive"
        );
        yolo_process_release(process);
        yolo_runtime_destroy(rt);
    }

    #[test]
    fn asynchronous_stop_runs_on_a_worker_and_ignores_the_operation_limit() {
        let rt = create(1);
        let (_, process) = spawn(rt, "sh", &["-c", "sleep 60 & wait"], &[]);
        // the limit (1) is exhausted by the process itself, a stop must still start
        let mut op = 0;
        assert_eq!(
            unsafe { yolo_process_stop_start(process, 2000, &mut op) },
            YoloStatus::Ok
        );
        let mut out = empty();
        assert_eq!(
            unsafe { yolo_operation_wait(op, 10_000, &mut out) },
            YoloStatus::Ok
        );
        let result = take_json(out);
        assert_eq!(result["signal"], libc::SIGTERM);
        assert_eq!(status_of(process).state, 1);
        assert_eq!(yolo_operation_release(op), YoloStatus::Ok);
        let mut none = 0;
        assert_eq!(
            unsafe { yolo_process_stop_start(0, 0, &mut none) },
            YoloStatus::InvalidHandle
        );
        yolo_process_release(process);
        yolo_runtime_destroy(rt);
    }

    #[test]
    fn a_process_ignoring_sigterm_is_killed_after_the_grace_period() {
        let rt = create(0);
        let (_, process) = spawn(
            rt,
            "sh",
            &["-c", "trap '' TERM; while :; do sleep 1; done"],
            &[],
        );
        std::thread::sleep(Duration::from_millis(100));
        let started = Instant::now();
        assert_eq!(yolo_process_stop(process, 200), YoloStatus::Ok);
        assert!(started.elapsed() >= Duration::from_millis(200));
        assert_eq!(status_of(process).signal, libc::SIGKILL);
        yolo_process_release(process);
        yolo_runtime_destroy(rt);
    }

    #[test]
    fn processes_count_against_the_operation_limit_and_die_with_the_runtime() {
        let rt = create(1);
        let (status, process) = spawn(rt, "sleep", &["60"], &[]);
        assert_eq!(status, YoloStatus::Ok);
        let mut op = 0;
        assert_eq!(
            unsafe { yolo_bench_start(rt, 10, &mut op) },
            YoloStatus::Busy
        );
        let (status, _) = spawn(rt, "sleep", &["60"], &[]);
        assert_eq!(status, YoloStatus::Busy);
        let pid = status_of(process).pid as i32;
        assert_eq!(yolo_runtime_destroy(rt), YoloStatus::Ok);
        assert_eq!(yolo_process_stop(process, 0), YoloStatus::InvalidHandle);
        assert_eq!(
            unsafe { libc::kill(-pid, 0) },
            -1,
            "the runtime must not leave its process running"
        );
    }

    fn serve_once(response: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0u8; 256];
                let _ = stream.read(&mut buffer);
                let _ = stream.write_all(response.as_bytes());
            }
        });
        port
    }

    fn probe(rt: YoloHandle, port: u16, path: &str) -> (YoloStatus, serde_json::Value) {
        let host = CString::new("127.0.0.1").unwrap();
        let path = CString::new(path).unwrap();
        let mut op = 0;
        let status =
            unsafe { yolo_http_probe_start(rt, host.as_ptr(), port, path.as_ptr(), 1000, &mut op) };
        if status != YoloStatus::Ok {
            return (status, serde_json::Value::Null);
        }
        let mut out = empty();
        assert_eq!(
            unsafe { yolo_operation_wait(op, 10_000, &mut out) },
            YoloStatus::Ok
        );
        let value = take_json(out);
        assert_eq!(yolo_operation_release(op), YoloStatus::Ok);
        (YoloStatus::Ok, value)
    }

    #[test]
    fn http_probe_reads_the_status_line_and_reports_unreachable_as_data() {
        let rt = create(0);
        let port = serve_once("HTTP/1.1 204 No Content\r\n\r\n");
        assert_eq!(
            probe(rt, port, "/json/version"),
            (YoloStatus::Ok, serde_json::json!({ "status": 204 }))
        );

        let port = serve_once("garbage");
        let (status, value) = probe(rt, port, "/");
        assert_eq!(status, YoloStatus::Ok);
        assert!(
            value["status"].is_null() && value["error"].as_str().unwrap().contains("not an HTTP")
        );

        // a closed port: connection refused is "not ready yet", reported as data
        let closed = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let (status, value) = probe(rt, closed, "/");
        assert_eq!(status, YoloStatus::Ok);
        assert!(value["status"].is_null());

        assert_eq!(probe(rt, 1, "no-slash").0, YoloStatus::InvalidArgument);
        assert_eq!(probe(rt, 1, "/a b").0, YoloStatus::InvalidArgument);
        assert_eq!(probe(0, 1, "/").0, YoloStatus::InvalidHandle);
        yolo_runtime_destroy(rt);
    }
}

#[cfg(windows)]
mod windows_process {
    use super::*;
    use std::ffi::CString;
    use std::time::Instant;

    fn spawn_cmd(rt: YoloHandle, command: &str) -> YoloHandle {
        let program = CString::new("cmd.exe").unwrap();
        let owned = [
            CString::new("/d").unwrap(),
            CString::new("/c").unwrap(),
            CString::new(command).unwrap(),
        ];
        let mut args: Vec<*const std::ffi::c_char> = owned.iter().map(|c| c.as_ptr()).collect();
        args.push(ptr::null());
        let info = YoloSpawnInfo {
            struct_size: size_of::<YoloSpawnInfo>() as u32,
            flags: YOLO_SPAWN_NULL_STDIO,
            program: program.as_ptr(),
            args: args.as_ptr(),
            env: ptr::null(),
            cwd: ptr::null(),
        };
        let mut handle = 0;
        assert_eq!(
            unsafe { yolo_process_spawn(rt, &info, &mut handle) },
            YoloStatus::Ok
        );
        handle
    }

    fn tree_of(process: YoloHandle) -> Arc<crate::process::ProcState> {
        match lock(registry()).get(process) {
            Some(Entry::Process { state, .. }) => Arc::clone(state),
            _ => panic!("not a process handle"),
        }
    }

    #[test]
    fn stop_terminates_the_whole_job() {
        let rt = create(0);
        // cmd starts a background ping and runs a second one: three processes in the job.
        let process = spawn_cmd(
            rt,
            "start /b ping -n 60 127.0.0.1 >nul & ping -n 60 127.0.0.1 >nul",
        );
        let state = tree_of(process);
        let deadline = Instant::now() + Duration::from_secs(10);
        while state.tree_active() < 3 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            state.tree_active() >= 3,
            "job holds {} processes",
            state.tree_active()
        );
        let started = Instant::now();
        assert_eq!(yolo_process_stop(process, 2000), YoloStatus::Ok);
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(state.tree_active(), 0, "a descendant survived the stop");
        yolo_process_release(process);
        yolo_runtime_destroy(rt);
    }

    #[test]
    fn destroying_the_runtime_kills_descendants() {
        let rt = create(0);
        let process = spawn_cmd(
            rt,
            "start /b ping -n 60 127.0.0.1 >nul & ping -n 60 127.0.0.1 >nul",
        );
        let state = tree_of(process);
        let deadline = Instant::now() + Duration::from_secs(10);
        while state.tree_active() < 3 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(yolo_runtime_destroy(rt), YoloStatus::Ok);
        assert_eq!(state.tree_active(), 0);
    }
}
