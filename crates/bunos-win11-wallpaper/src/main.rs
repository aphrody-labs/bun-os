// SPDX-License-Identifier: Apache-2.0
//! `bunos-win11-wallpaper`: render the animated Bun OS wallpaper into the desktop WorkerW layer.
//!
//!   bunos-win11-wallpaper probe            find the WorkerW layer and print its handle (safe, no rendering)
//!   bunos-win11-wallpaper run [seconds]    render the aurora for N seconds (default 10), then restore
//!
//! Running draws behind the desktop icons and is fully reversible; it registers no shell.

#[cfg(windows)]
fn main() -> std::process::ExitCode {
    use std::time::Instant;

    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("probe") | None => match bunos_win11_wallpaper::worker_w::spawn_worker_w() {
            Ok(hwnd) => {
                let (x, y, w, h) = bunos_win11_wallpaper::worker_w::virtual_screen();
                println!("WorkerW 0x{hwnd:x}; virtual screen {w}x{h} at ({x},{y})");
                std::process::ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("probe failed: {e}");
                std::process::ExitCode::FAILURE
            }
        },
        Some("run") => {
            let seconds: f32 = args.next().and_then(|s| s.parse().ok()).unwrap_or(10.0);
            let mut engine = match bunos_win11_wallpaper::Engine::acquire() {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("acquire failed: {e}");
                    return std::process::ExitCode::FAILURE;
                }
            };
            let start = Instant::now();
            while start.elapsed().as_secs_f32() < seconds {
                if let Err(e) = engine.render(start.elapsed().as_secs_f32()) {
                    eprintln!("render: {e}");
                    break;
                }
            }
            println!("rendered {seconds}s; desktop restored");
            std::process::ExitCode::SUCCESS
        }
        Some(other) => {
            eprintln!("unknown command '{other}'; use probe|run");
            std::process::ExitCode::from(2)
        }
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("the wallpaper engine is Windows-only (WorkerW + wgpu)");
}
