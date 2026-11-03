// SPDX-License-Identifier: Apache-2.0
//! `bunos-nt`: probe and drive `\\.\BunOS`.
//!
//! `bunos-nt status|version|caps|ping [text]|events [sources] [seconds]`. `events` enables the sources (default
//! `process,image`), prints one JSON line per kernel event for `seconds` (default 10), then disables them.
//! Exit 3 when the driver is not loaded, 4 when not elevated.
use bunos_nt_client::{DEVICE_PATH, Device, Error, Event, proto};
use std::process::ExitCode;
use std::time::{Duration, Instant};

fn json_event(e: &Event) -> String {
    let name = e.name.replace('\\', "\\\\").replace('"', "\\\"");
    format!(
        "{{\"kind\":\"{}\",\"time\":{},\"pid\":{},\"a0\":{},\"a1\":{},\"name\":\"{name}\",\"truncated\":{},\"kernelImage\":{}}}",
        e.kind.name(),
        e.time,
        e.pid,
        e.a0,
        e.a1,
        e.truncated,
        e.kernel_image
    )
}

fn run(device: &Device, args: &[String]) -> Result<(), Error> {
    let cmd = args.first().map(String::as_str).unwrap_or("status");
    match cmd {
        "status" | "version" => device.version().map(|v| println!("{DEVICE_PATH}: {v}")),
        "caps" => device.caps().map(|c| println!("{c:?}")),
        "ping" => {
            let text = args.get(1).map(String::as_str).unwrap_or("bunos");
            let start = Instant::now();
            device.ping(text.as_bytes()).map(|echo| println!("{} ({:?})", String::from_utf8_lossy(&echo), start.elapsed()))
        }
        "events" => {
            let sources = args.get(1).map(String::as_str).unwrap_or("process,image");
            let Some(mask) = proto::parse_sources(sources) else {
                eprintln!("unknown source in {sources}: process,thread,image,registry,all");
                std::process::exit(2);
            };
            let seconds: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(10);
            device.configure(mask)?;
            let end = Instant::now() + Duration::from_secs(seconds);
            let result = (|| {
                while Instant::now() < end {
                    let batch = device.read_events(512)?;
                    for e in &batch.events {
                        println!("{}", json_event(e));
                    }
                    if batch.dropped > 0 {
                        eprintln!("dropped {} events (ring full)", batch.dropped);
                    }
                    if batch.pending == 0 {
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
                Ok(())
            })();
            device.configure(0)?;
            result
        }
        other => {
            eprintln!("unknown command {other}: status | version | caps | ping [text] | events [sources] [seconds]");
            std::process::exit(2);
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let device = match Device::open() {
        Ok(d) => d,
        Err(e @ (Error::NotLoaded | Error::Unsupported)) => {
            eprintln!("{e}");
            return ExitCode::from(3);
        }
        Err(e @ Error::AccessDenied) => {
            eprintln!("{e}");
            return ExitCode::from(4);
        }
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    match run(&device, &args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
