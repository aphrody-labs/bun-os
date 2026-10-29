// SPDX-License-Identifier: Apache-2.0
//! Desktop binary entry point: a thin shell over [`aphrody_app_lib::run`].
//!
//! The agent runs inside this process, so this executable is also what the managed
//! `llama-server` supervisor re-executes as `<exe> __llama-daemon ...`. That argument is
//! answered here, before any window exists, and never reaches Tauri
//! (see `aphrody_app_lib::llama_daemon`). `--host-info` and `--runtime-host` are the Yolo desktop
//! SDK contract (`aphrody_app_lib::runtime_host`), also answered before any window exists;
//! `--showcase` opens the M3 showcase window next to the desktop.
//!
//! The default runtime is the system webview (wry). With the `cef` feature this executable is also its own
//! CEF renderer, GPU, network and utility process, so `#[cef_entry_point]` hands every `--type=` child to
//! Chromium before anything else runs.

// Hide the console window on Windows release builds (kept in debug so log output shows).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

use aphrody_app_lib::runtime_host;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[cfg_attr(feature = "cef", tauri_runtime_cef::cef_entry_point)]
fn main() -> ExitCode {
    if let Some(code) = aphrody_app_lib::llama_daemon::run_if_requested(std::env::args_os()) {
        return code;
    }
    let args: Vec<_> = std::env::args_os().collect();
    if runtime_host::has_flag(&args, runtime_host::HOST_INFO_FLAG) {
        println!("{}", runtime_host::host_info());
        return ExitCode::SUCCESS;
    }
    if runtime_host::has_flag(&args, runtime_host::RUNTIME_HOST_FLAG) {
        return match aphrody_app_lib::run_runtime_host() {
            Ok(code) => u8::try_from(code).map_or(ExitCode::FAILURE, ExitCode::from),
            Err(error) => {
                eprintln!("aphrody-app: {error}");
                ExitCode::FAILURE
            }
        };
    }
    aphrody_app_lib::run();
    ExitCode::SUCCESS
}
