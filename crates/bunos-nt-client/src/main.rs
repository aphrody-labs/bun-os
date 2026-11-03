// SPDX-License-Identifier: Apache-2.0
//! `bunos-nt`: probe `\\.\BunOS`. `bunos-nt status|version|ping [text]`; exit 3 when the driver is not loaded.
use bunos_nt_client::{DEVICE_PATH, Device, Error};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("status");
    let device = match Device::open() {
        Ok(d) => d,
        Err(e @ (Error::NotLoaded | Error::Unsupported)) => {
            eprintln!("{e}");
            return ExitCode::from(3);
        }
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    let result = match cmd {
        "status" | "version" => device.version().map(|v| println!("{DEVICE_PATH}: {v}")),
        "ping" => {
            let text = args.get(1).map(String::as_str).unwrap_or("bunos");
            let start = std::time::Instant::now();
            device.ping(text.as_bytes()).map(|echo| println!("{} ({:?})", String::from_utf8_lossy(&echo), start.elapsed()))
        }
        other => {
            eprintln!("unknown command {other}: status | version | ping [text]");
            return ExitCode::from(2);
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
