// SPDX-License-Identifier: Apache-2.0
//! `aphrody-embed`: local embedding processes over the pure-Rust engine.
//!
//! - `aphrody-embed worker`: framed stdio worker for the unified Aphrody bridge.
//! - `aphrody-embed serve --port <port> [--host <ip>] [--model-dir <dir>] [--threads <n>]`:
//!   OpenAI-compatible `/v1/embeddings` for the multilingual E5 space. Port and host also come from `APHRODY_EMBED_PORT` /
//!   `APHRODY_EMBED_HOST`, the model directory from
//!   `APHRODY_EMBED_MODEL_DIR`. Serving never downloads.
//! - `aphrody-embed install [--model-dir <dir>]`: fetch and verify the pinned E5 files.

mod worker;

use std::{ffi::OsString, net::IpAddr, path::PathBuf};

use crate::{
    native::{ModelFiles, ensure_model, find_model},
    server::{NATIVE_MODEL, ServerConfig, serve},
};

const USAGE: &str = "usage: aphrody-embed worker | serve --port <port> [--host <ip>] [--model-dir <dir>] [--threads <n>] | install [--model-dir <dir>]";

fn env(names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|v| !v.trim().is_empty()))
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn model_dir(args: &[String]) -> Option<PathBuf> {
    flag(args, "--model-dir")
        .or_else(|| env(&["APHRODY_EMBED_MODEL_DIR"]))
        .map(PathBuf::from)
}

fn server_config(args: &[String]) -> Result<ServerConfig, String> {
    let host = flag(args, "--host")
        .or_else(|| env(&["APHRODY_EMBED_HOST"]))
        .unwrap_or_else(|| "127.0.0.1".into());
    let host: IpAddr = host.parse().map_err(|_| format!("invalid host {host}"))?;
    let port = flag(args, "--port")
        .or_else(|| env(&["APHRODY_EMBED_PORT"]))
        .ok_or("set --port or APHRODY_EMBED_PORT")?;
    let port: u16 = port
        .parse()
        .ok()
        .filter(|p| *p > 0)
        .ok_or(format!("invalid port {port}"))?;
    let threads = match flag(args, "--threads") {
        Some(n) => n.parse().map_err(|_| format!("invalid thread count {n}"))?,
        None => 0,
    };
    Ok(ServerConfig {
        addr: (host, port).into(),
        model_dir: model_dir(args),
        threads,
    })
}

fn install(args: &[String]) -> Result<(), String> {
    let spec = find_model(NATIVE_MODEL).ok_or("E5 missing from the manifest")?;
    let dir = model_dir(args).unwrap_or_else(|| spec.default_dir());
    let dir = ensure_model(&spec, &dir).map_err(|e| e.to_string())?;
    println!(
        "{{\"status\":\"cached\",\"model\":\"{}\",\"dir\":{:?}}}",
        spec.versioned_id(),
        dir.display().to_string()
    );
    Ok(())
}

/// Entry point of the former `aphrody-embed` binary, now reached through the `aphrody`
/// multi-call binary. `args[0]` is the program name (argv convention). Returns the process exit
/// code.
#[must_use]
pub fn cli_main(args: Vec<OsString>) -> i32 {
    let args: Vec<String> = args
        .into_iter()
        .skip(1)
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    if args
        .iter()
        .any(|arg| matches!(arg.as_str(), "--help" | "-h"))
    {
        println!("{USAGE}");
        return 0;
    }
    let result = match args.first().map(String::as_str) {
        Some("worker") => worker::run().map_err(|e| e.to_string()),
        Some("install") => install(&args),
        Some("serve") => server_config(&args).and_then(|config| {
            let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
            println!(
                "{{\"status\":\"listening\",\"addr\":\"{}\",\"model\":\"{}\"}}",
                config.addr,
                crate::server::SERVED_MODEL
            );
            runtime.block_on(serve(config)).map_err(|e| e.to_string())
        }),
        _ => Err(USAGE.to_owned()),
    };
    match result {
        Ok(()) => 0,
        Err(message) => {
            eprintln!("aphrody-embed: {message}");
            2
        }
    }
}
