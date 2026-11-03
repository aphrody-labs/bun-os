// SPDX-License-Identifier: Apache-2.0
//! `bunos-win11-chrome`: apply the macOS-style chrome to a window, or print the default descriptors.
//!
//!   bunos-win11-chrome apply <hwnd>   apply the default chrome to a window handle (decimal or 0x-hex)
//!   bunos-win11-chrome watch          apply it to every captioned top-level window, now and as they appear
//!   bunos-win11-chrome describe       print the default chrome, traffic-light and dock descriptors as JSON

use bunos_win11_chrome::{Chrome, Dock, Traffic};

#[cfg(windows)]
mod watch;

fn main() -> std::process::ExitCode {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("apply") => {
            let Some(raw) = args.next() else {
                eprintln!("usage: bunos-win11-chrome apply <hwnd>");
                return std::process::ExitCode::from(2);
            };
            let hwnd = parse_hwnd(&raw).unwrap_or_else(|| {
                eprintln!("invalid hwnd: {raw}");
                std::process::exit(2);
            });
            match bunos_win11_chrome::apply(hwnd, &Chrome::default()) {
                Ok(()) => {
                    println!("applied macOS-style chrome to hwnd {hwnd}");
                    std::process::ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("apply failed: {e}");
                    std::process::ExitCode::FAILURE
                }
            }
        }
        #[cfg(windows)]
        Some("watch") => watch::run(),
        Some("describe") | None => {
            let doc = serde_json::json!({
                "chrome": Chrome::default(),
                "traffic": Traffic::default(),
                "dock": Dock::default(),
            });
            println!("{}", serde_json::to_string_pretty(&doc).unwrap());
            std::process::ExitCode::SUCCESS
        }
        Some(other) => {
            eprintln!("unknown command '{other}'; use apply|watch|describe");
            std::process::ExitCode::from(2)
        }
    }
}

fn parse_hwnd(raw: &str) -> Option<isize> {
    raw.strip_prefix("0x").map_or_else(|| raw.parse().ok(), |hex| isize::from_str_radix(hex, 16).ok())
}
