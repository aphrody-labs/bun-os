// SPDX-License-Identifier: Apache-2.0
//! aphrody-inventory: generate, gate and publish the Bun OS inventory, and build the WebAssembly modules.
//!
//! ```text
//! aphrody-inventory check [--root DIR] [--dist DIR]        coverage gate (exit 1 on any error)
//! aphrody-inventory write DIR [--root DIR] [--versions] [--wasm SRC]
//!                                                          write the inventory (and stage modules from SRC, default
//!                                                          build/webos-wasm, into DIR/../wasm/modules), then gate it
//! aphrody-inventory wasm-build [--root DIR] [--force] [ID ...]
//!                                                          build the module crates on the VPS factory
//! aphrody-inventory counts [--root DIR]                    print the counts per kind
//! ```

use aphrody_inventory::{Options, check, counts_line, generate, wasm, write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

fn usage() -> ExitCode {
    eprintln!(
        "usage: aphrody-inventory <check|write DIR|wasm-build|counts> [--root DIR] [--dist DIR] [--versions] [--wasm SRC] [--force] [ID ...]"
    );
    ExitCode::from(64)
}

fn checkout_root(explicit: Option<PathBuf>) -> PathBuf {
    if let Some(root) = explicit {
        return root;
    }
    let out = std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output();
    match out {
        Ok(o) if o.status.success() => PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()),
        _ => PathBuf::from("."),
    }
}

fn gate(root: &Path, inv: &aphrody_inventory::Inventory, dist: Option<&Path>) -> ExitCode {
    match check(root, inv, dist) {
        Ok(errors) if errors.is_empty() => {
            println!("inventory gate ok: every member has a surface and a description");
            ExitCode::SUCCESS
        }
        Ok(errors) => {
            eprintln!("inventory gate FAILED ({}):", errors.len());
            for e in errors.iter().take(40) {
                eprintln!("{e}");
            }
            ExitCode::FAILURE
        }
        Err(e) => {
            eprintln!("inventory gate: {e}");
            ExitCode::FAILURE
        }
    }
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        return usage();
    };
    let mut root = None;
    let mut dist = None;
    let mut wasm_src = None;
    let mut versions = false;
    let mut force = false;
    let mut positional = Vec::new();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => root = args.next().map(PathBuf::from),
            "--dist" => dist = args.next().map(PathBuf::from),
            "--wasm" => wasm_src = args.next().map(PathBuf::from),
            "--versions" => versions = true,
            "--force" => force = true,
            "-h" | "--help" => return usage(),
            other if other.starts_with("--") => return usage(),
            other => positional.push(other.to_string()),
        }
    }
    let root = checkout_root(root);
    let generate_with = |options: &Options| match generate(&root, options) {
        Ok(inv) => Some(inv),
        Err(e) => {
            eprintln!("inventory: {e}");
            None
        }
    };
    match command.as_str() {
        "counts" => {
            let Some(inv) = generate_with(&Options::default()) else {
                return ExitCode::FAILURE;
            };
            println!("{}", counts_line(&inv));
            ExitCode::SUCCESS
        }
        "check" => {
            let Some(inv) = generate_with(&Options::default()) else {
                return ExitCode::FAILURE;
            };
            println!("{}", counts_line(&inv));
            gate(&root, &inv, dist.as_deref())
        }
        "write" => {
            let Some(dir) = positional.first().map(PathBuf::from) else {
                return usage();
            };
            let src = wasm_src.unwrap_or_else(|| wasm::modules_dir(&root));
            let modules_dest = dir.join("../wasm/modules");
            let modules = match wasm::stage(&src, &modules_dest, "/wasm/modules") {
                Ok(m) => m,
                Err(e) => {
                    eprintln!("staging wasm modules: {e}");
                    return ExitCode::FAILURE;
                }
            };
            eprintln!("wasm modules staged: {}", modules.len());
            let options = Options {
                versions,
                versions_cache: None,
                wasm_modules: modules,
            };
            let Some(inv) = generate_with(&options) else {
                return ExitCode::FAILURE;
            };
            if let Err(e) = write(&dir, &inv) {
                eprintln!("writing {}: {e}", dir.display());
                return ExitCode::FAILURE;
            }
            println!("{}", counts_line(&inv));
            gate(&root, &inv, Some(&dir))
        }
        "wasm-build" => {
            if std::env::consts::OS != "linux" {
                eprintln!("Build WebAssembly modules on the VPS factory");
                return ExitCode::from(64);
            }
            let Some(inv) = generate_with(&Options::default()) else {
                return ExitCode::FAILURE;
            };
            let status = wasm::build(&root, &inv, &positional, force);
            if status.values().any(|s| !s.ok) {
                ExitCode::FAILURE
            } else {
                ExitCode::SUCCESS
            }
        }
        _ => usage(),
    }
}
