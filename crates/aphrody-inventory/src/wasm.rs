// SPDX-License-Identifier: Apache-2.0
//! WebAssembly modules of the Bun OS crates. Every wasm-bindgen cdylib crate of the inventory is built on the VPS
//! factory, one crate at a time through the serialized Cargo wrapper (at most four jobs), then packed with
//! `wasm-bindgen --target web` (the CLI must equal the wasm-bindgen pinned in Cargo.lock) and `wasm-opt -Oz` with the
//! JavaScriptCore-safe feature set. Output: `build/webos-wasm/<id>/` and `build/webos-wasm/status.json`. [`stage`] copies
//! the built modules into a release and returns the served URL of each.

use crate::Inventory;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Status {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub at: String,
}

/// `build/webos-wasm` under the checkout.
pub fn modules_dir(root: &Path) -> PathBuf {
    root.join("build/webos-wasm")
}

/// (member id, cargo package name) of every module crate of the inventory.
pub fn module_crates(inv: &Inventory) -> Vec<(String, String)> {
    inv.members
        .iter()
        .filter(|m| m.kind == "crates" && m.meta.get("wasm").and_then(|v| v.as_bool()) == Some(true))
        .map(|m| (m.id.clone(), m.meta.get("crateName").and_then(|v| v.as_str()).unwrap_or(&m.id).to_string()))
        .collect()
}

fn pinned_bindgen(root: &Path) -> Option<String> {
    let lock = std::fs::read_to_string(root.join("Cargo.lock")).ok()?;
    let at = lock.find("name = \"wasm-bindgen\"\nversion = \"")?;
    let rest = &lock[at + "name = \"wasm-bindgen\"\nversion = \"".len()..];
    rest.split('"').next().map(str::to_string)
}

fn tool_version(tool: &str) -> Option<String> {
    let out = Command::new(tool).arg("--version").output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).split_whitespace().nth(1).unwrap_or("").to_string())
}

fn error_lines(output: &std::process::Output) -> String {
    let text = format!("{}\n{}", String::from_utf8_lossy(&output.stderr), String::from_utf8_lossy(&output.stdout));
    let errors: Vec<&str> = text.lines().filter(|l| l.trim_start().starts_with("error")).take(4).collect();
    let lines: Vec<&str> = if errors.is_empty() { text.lines().filter(|l| !l.trim().is_empty()).rev().take(6).collect() } else { errors };
    lines.join(" | ").chars().take(800).collect()
}

fn build_one(root: &Path, out: &Path, id: &str, krate: &str) -> Result<u64, String> {
    let name = krate.replace('-', "_");
    let target_dir = std::env::var_os("CARGO_TARGET_DIR").map(PathBuf::from).unwrap_or_else(|| root.join("target"));
    let home = std::env::var("HOME").unwrap_or_default();
    let remap = format!("--remap-path-prefix={}=/aphrody --remap-path-prefix={home}/.cargo=/cargo --remap-path-prefix={home}/.rustup=/rustup", root.display());
    let rustflags = match std::env::var("RUSTFLAGS") {
        Ok(f) if !f.is_empty() => format!("{f} {remap}"),
        _ => remap,
    };
    let cargo = Command::new(root.join("scripts/aphrody/build/rust/cargo-serial.sh"))
        .current_dir(root)
        .args(["build", "--locked", "-p", krate, "--target", "wasm32-unknown-unknown", "--release", "--target-dir"])
        .arg(&target_dir)
        .env("APHRODY_LOCAL_CARGO", "1")
        .env("APHRODY_BUILD_HOST", "")
        .env("CARGO_BUILD_JOBS", "4")
        .env("RUSTFLAGS", rustflags)
        .output()
        .map_err(|e| format!("cargo-serial.sh: {e}"))?;
    if !cargo.status.success() {
        return Err(error_lines(&cargo));
    }
    let artifact = target_dir.join("wasm32-unknown-unknown/release").join(format!("{name}.wasm"));
    if !artifact.is_file() {
        return Err(format!("cargo produced no {}", artifact.display()));
    }
    let dir = out.join(id);
    let staging = out.join(format!(".{id}.tmp"));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let bindgen = Command::new("wasm-bindgen")
        .args(["--target", "web", "--out-name", &name, "--out-dir"])
        .arg(&staging)
        .arg(&artifact)
        .output()
        .map_err(|e| format!("wasm-bindgen: {e}"))?;
    if !bindgen.status.success() {
        return Err(error_lines(&bindgen));
    }
    let wasm = staging.join(format!("{name}_bg.wasm"));
    if tool_version("wasm-opt").is_some() {
        let opt = Command::new("wasm-opt")
            .args(["-Oz", "--enable-bulk-memory", "--enable-mutable-globals", "--enable-nontrapping-float-to-int", "--enable-sign-ext", "--enable-reference-types", "-o"])
            .arg(&wasm)
            .arg(&wasm)
            .output()
            .map_err(|e| format!("wasm-opt: {e}"))?;
        if !opt.status.success() {
            return Err(format!("wasm-opt: {}", error_lines(&opt)));
        }
    }
    let bytes = std::fs::read(&wasm).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"\0asm") {
        return Err(format!("{} is not a WebAssembly module", wasm.display()));
    }
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::rename(&staging, &dir).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

/// Build the module crates (all of them, or `only`), skipping those already built unless `force`.
pub fn build(root: &Path, inv: &Inventory, only: &[String], force: bool) -> BTreeMap<String, Status> {
    let out = modules_dir(root);
    let _ = std::fs::create_dir_all(&out);
    let status_file = out.join("status.json");
    let mut status: BTreeMap<String, Status> = std::fs::read(&status_file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let crates: Vec<(String, String)> = module_crates(inv).into_iter().filter(|(id, _)| only.is_empty() || only.contains(id)).collect();
    if let (Some(pin), Some(cli)) = (pinned_bindgen(root), tool_version("wasm-bindgen")) {
        if pin != cli {
            eprintln!("wasm-bindgen CLI {cli} differs from the pinned crate {pin}: cargo install wasm-bindgen-cli --version {pin}");
            for (id, _) in &crates {
                status.insert(id.clone(), Status { ok: false, bytes: None, error: Some(format!("wasm-bindgen CLI {cli} != pinned {pin}")), at: crate::text::now_rfc3339() });
            }
            let _ = std::fs::write(&status_file, serde_json::to_vec_pretty(&status).unwrap_or_default());
            return status;
        }
    }
    eprintln!("wasm modules to build: {}", crates.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>().join(", "));
    for (id, krate) in crates {
        let built = out.join(&id).join(format!("{}_bg.wasm", krate.replace('-', "_")));
        if !force && status.get(&id).is_some_and(|s| s.ok) && built.is_file() {
            eprintln!("{id}: up to date");
            continue;
        }
        let started = Instant::now();
        let result = build_one(root, &out, &id, &krate);
        let entry = match result {
            Ok(bytes) => {
                eprintln!("{id}: ok {bytes} bytes in {}s", started.elapsed().as_secs());
                Status { ok: true, bytes: Some(bytes), error: None, at: crate::text::now_rfc3339() }
            }
            Err(error) => {
                eprintln!("{id}: failed: {error}");
                Status { ok: false, bytes: None, error: Some(error), at: crate::text::now_rfc3339() }
            }
        };
        status.insert(id, entry);
        let _ = std::fs::write(&status_file, serde_json::to_vec_pretty(&status).unwrap_or_default());
    }
    eprintln!("built {} of {} modules", status.values().filter(|s| s.ok).count(), status.len());
    status
}

/// Copy every built module (`<src>/<id>/` holding a `.wasm`) to `<dest>/<id>/`; returns member id -> served URL under
/// `url_prefix` (for example `/wasm/modules`).
pub fn stage(src: &Path, dest: &Path, url_prefix: &str) -> std::io::Result<HashMap<String, String>> {
    let mut modules = HashMap::new();
    let Ok(entries) = std::fs::read_dir(src) else { return Ok(modules) };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || !entry.path().is_dir() {
            continue;
        }
        let files: Vec<String> = std::fs::read_dir(entry.path())?.flatten().map(|f| f.file_name().to_string_lossy().into_owned()).collect();
        let Some(wasm) = files.iter().find(|f| f.ends_with("_bg.wasm")).or_else(|| files.iter().find(|f| f.ends_with(".wasm"))) else { continue };
        let target = dest.join(&name);
        std::fs::create_dir_all(&target)?;
        for f in &files {
            std::fs::copy(entry.path().join(f), target.join(f))?;
        }
        modules.insert(name.clone(), format!("{url_prefix}/{name}/{wasm}"));
    }
    Ok(modules)
}
