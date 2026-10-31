// SPDX-License-Identifier: MIT
//! `aphrody-wasm-host run [--fuel N] [--timeout-ms N] [--max-memory BYTES] [--dir HOST::GUEST[:rw]] [--env K=V]
//!                        [--inherit-stdio] <component.wasm> [args...]`
//!
//! Runs a WASI 0.2 command component under the limits of the Bun OS plugin host and exits with its exit code
//! (124 on timeout, 125 when the fuel budget is exhausted, 126 on any other trap).
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use aphrody_wasm_host::{Exit, Host, Preopen, RunOptions};

fn usage() -> ExitCode {
    eprintln!(
        "usage: aphrody-wasm-host run [--fuel N] [--timeout-ms N] [--max-memory BYTES] [--dir HOST::GUEST[:rw]] \
         [--env K=V] [--inherit-stdio] <component.wasm> [args...]"
    );
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let mut argv = std::env::args().skip(1);
    if argv.next().as_deref() != Some("run") {
        return usage();
    }
    let mut opts = RunOptions::default();
    let mut file = None;
    while let Some(a) = argv.next() {
        let mut value = || argv.next().unwrap_or_default();
        match a.as_str() {
            "--fuel" => opts.fuel = value().parse().ok(),
            "--timeout-ms" => opts.timeout = value().parse().ok().filter(|&ms| ms > 0).map(Duration::from_millis),
            "--max-memory" => opts.max_memory = value().parse().unwrap_or(opts.max_memory),
            "--inherit-stdio" => opts.capture = false,
            "--env" => {
                if let Some((k, v)) = value().split_once('=') {
                    opts.env.push((k.into(), v.into()));
                }
            }
            "--dir" => {
                let spec = value();
                let (spec, writable) = match spec.strip_suffix(":rw") {
                    Some(s) => (s.to_string(), true),
                    None => (spec, false),
                };
                let (host, guest) = spec.split_once("::").map_or((spec.as_str(), spec.as_str()), |(h, g)| (h, g));
                opts.preopens.push(Preopen { host: PathBuf::from(host), guest: guest.into(), writable });
            }
            _ if a.starts_with("--") => return usage(),
            _ => {
                file = Some(a);
                opts.args.extend(argv.by_ref());
                break;
            }
        }
    }
    let Some(file) = file else { return usage() };
    let outcome = Host::new()
        .and_then(|host| {
            let bytes = std::fs::read(&file)?;
            let component = host.compile(&bytes)?;
            let name = std::path::Path::new(&file).file_name().map_or(file.clone(), |n| n.to_string_lossy().into());
            host.run(&name, &component, &opts)
        });
    match outcome {
        Ok(out) => {
            let _ = std::io::stdout().write_all(&out.stdout);
            let _ = std::io::stderr().write_all(&out.stderr);
            match out.exit {
                Exit::Code(c) => ExitCode::from(c.clamp(0, 255) as u8),
                Exit::Timeout => {
                    eprintln!("aphrody-wasm-host: timeout");
                    ExitCode::from(124)
                }
                Exit::OutOfFuel => {
                    eprintln!("aphrody-wasm-host: out of fuel");
                    ExitCode::from(125)
                }
                Exit::Trap(t) => {
                    eprintln!("aphrody-wasm-host: trap: {t}");
                    ExitCode::from(126)
                }
            }
        }
        Err(e) => {
            eprintln!("aphrody-wasm-host: {e:?}");
            ExitCode::from(1)
        }
    }
}
