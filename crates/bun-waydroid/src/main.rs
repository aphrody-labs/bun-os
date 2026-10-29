// SPDX-License-Identifier: GPL-3.0-or-later
//! `bun-waydroid` CLI. Every command prints JSON on stdout so the TypeScript gateway
//! (`packages/waydroid`) and the shell can consume it. Errors go to stderr with exit code 1.

use bun_waydroid::{binder, cfg, doctor, ota};
use std::path::PathBuf;

const USAGE: &str = "bun-waydroid <command>
  doctor                                   host readiness report (binder, lxc, wayland)
  ota check  [--arch A] [--rom lineage] [--type VANILLA] [--vendor MAINLINE]
             [--system-channel URL] [--vendor-channel URL]
                                           list builds of both channels
  ota fetch  <system|vendor> --dir DIR [same options] [--current-datetime N]
                                           download the newest build, verify SHA-256, extract
  verify FILE SHA256                       check a downloaded zip against a channel id
  binder plan [--dev-list a,b,c]           binderfs nodes still to allocate
  cfg get FILE KEY                         read waydroid.cfg with upstream defaults";

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn die(msg: impl std::fmt::Display) -> ! {
    eprintln!("bun-waydroid: {msg}");
    std::process::exit(1)
}

fn urls(args: &[String]) -> (String, String) {
    let arch = flag(args, "--arch").unwrap_or_else(|| "x86_64".into());
    let sys = ota::system_channel_url(
        &flag(args, "--system-channel").unwrap_or_else(|| ota::DEFAULT_SYSTEM_CHANNEL.into()),
        &flag(args, "--rom").unwrap_or_else(|| "lineage".into()),
        &arch,
        &flag(args, "--type").unwrap_or_else(|| "VANILLA".into()),
    );
    let ven = ota::vendor_channel_url(
        &flag(args, "--vendor-channel").unwrap_or_else(|| ota::DEFAULT_VENDOR_CHANNEL.into()),
        &arch,
        &flag(args, "--vendor").unwrap_or_else(|| "MAINLINE".into()),
    );
    (sys, ven)
}

fn print(v: serde_json::Value) {
    println!("{}", serde_json::to_string_pretty(&v).unwrap());
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd: Vec<&str> = args.iter().map(String::as_str).take(2).collect();
    match cmd.as_slice() {
        ["doctor", ..] => {
            let r = doctor::run(&doctor::collect());
            print(serde_json::to_value(&r).unwrap());
            if !r.ready {
                std::process::exit(2);
            }
        }
        ["ota", "check"] => {
            let (s, v) = urls(&args);
            let sys = ota::fetch_channel(&s).unwrap_or_else(|e| die(format!("{s}: {e}")));
            let ven = ota::fetch_channel(&v).unwrap_or_else(|e| die(format!("{v}: {e}")));
            print(serde_json::json!({
                "system": { "channel": s, "latest": ota::latest(&sys), "builds": sys.len() },
                "vendor": { "channel": v, "latest": ota::latest(&ven), "builds": ven.len() },
            }));
        }
        ["ota", "fetch"] => {
            let which = args.get(2).map(String::as_str).unwrap_or("");
            let dir = PathBuf::from(flag(&args, "--dir").unwrap_or_else(|| die("--dir required")));
            let current: u64 = flag(&args, "--current-datetime").and_then(|v| v.parse().ok()).unwrap_or(0);
            let (s, v) = urls(&args);
            let url = match which {
                "system" => s,
                "vendor" => v,
                _ => die("ota fetch <system|vendor>"),
            };
            let builds = ota::fetch_channel(&url).unwrap_or_else(|e| die(e));
            let Some(b) = ota::first_newer(&builds, current) else {
                return print(serde_json::json!({ "updated": false, "reason": "up to date" }));
            };
            std::fs::create_dir_all(&dir).unwrap_or_else(|e| die(e));
            let zip = dir.join(&b.filename);
            let t = std::time::Instant::now();
            let (bytes, sha) = ota::download_verified(&b.url, &zip, &b.id).unwrap_or_else(|e| die(e));
            let dl = t.elapsed().as_secs_f64();
            let files = ota::extract(&zip, &dir).unwrap_or_else(|e| die(e));
            let _ = std::fs::remove_file(&zip);
            print(serde_json::json!({
                "updated": true, "filename": b.filename, "datetime": b.datetime, "bytes": bytes,
                "sha256": sha, "download_seconds": dl, "files": files,
            }));
        }
        ["verify", ..] => {
            let (Some(f), Some(h)) = (args.get(1), args.get(2)) else { die("verify FILE SHA256") };
            ota::verify_file(std::path::Path::new(f), h).unwrap_or_else(|e| die(e));
            print(serde_json::json!({ "ok": true }));
        }
        ["binder", "plan"] => {
            let existing: Vec<String> = match flag(&args, "--dev-list") {
                Some(l) => l.split(',').filter(|s| !s.is_empty()).map(String::from).collect(),
                None => doctor::collect().dev_names,
            };
            print(serde_json::json!({ "alloc": binder::plan_alloc(&existing), "ioctl": binder::BINDER_CTL_ADD }));
        }
        ["cfg", "get"] => {
            let (Some(f), Some(k)) = (args.get(2), args.get(3)) else { die("cfg get FILE KEY") };
            let text = std::fs::read_to_string(f).unwrap_or_default();
            let c = cfg::Config::parse(&text);
            print(serde_json::json!({ "key": k, "value": c.get_or_default(k) }));
        }
        _ => {
            eprintln!("{USAGE}");
            std::process::exit(64);
        }
    }
}
