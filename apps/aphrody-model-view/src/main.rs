// SPDX-License-Identifier: Apache-2.0
//! `aphrody-model-view <model.glb|model.gltf|model.obj|scene.json> [--size N] [--dark]`
//!
//! Shows only the 3D on the desktop: a frameless, transparent, always-on-top window whose
//! transparent webview handles input while `aphrody-tauri-3d` draws the model natively
//! underneath (DirectComposition + DX12 on Windows, per-pixel alpha). The file is watched and
//! reloaded on change, so agents control the view by rewriting it (`render3d_view`).
//!
//! The window is created without a GDI redirection bitmap, so it is composed only from the
//! DirectComposition layer and the WebView2 child (`--gdi` keeps the blur-behind path).
//!
//! Left drag orbits, right drag moves the window, the wheel zooms, double click re-frames and
//! Escape closes.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    path::PathBuf,
    time::{Duration, SystemTime},
};

use aphrody_tauri_3d::ModelOptions;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_runtime_wry::Wry;

struct Args {
    path: PathBuf,
    size: Option<u32>,
    dark: bool,
    gdi: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut path = None;
    let mut size = None;
    let mut dark = false;
    let mut gdi = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--size" => {
                let value = args.next().ok_or("--size needs a value")?;
                size = Some(
                    value
                        .parse()
                        .map_err(|_| format!("invalid --size {value}"))?,
                );
            }
            "--dark" => dark = true,
            "--gdi" => gdi = true,
            "-h" | "--help" => {
                return Err(
                    "usage: aphrody-model-view <model.glb|.gltf|.obj|scene.json> [--size \
                            N] [--dark] [--gdi]"
                        .into(),
                );
            }
            other if path.is_none() => path = Some(PathBuf::from(other)),
            other => return Err(format!("unexpected argument {other}")),
        }
    }
    let path = path.ok_or("missing model path")?;
    let path = std::fs::canonicalize(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Args {
        path,
        size,
        dark,
        gdi,
    })
}

fn modified(path: &PathBuf) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

// Tauri's generated context uses process::exit internally; this is outside our source.
#[allow(clippy::exit)]
fn main() -> std::process::ExitCode {
    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}");
            return std::process::ExitCode::from(2);
        }
    };
    let result = tauri::Builder::default()
        .runtime(Wry::default())
        .plugin(aphrody_tauri_3d::init())
        // Empty unless built with `--features debug-bridge` in a debug build and started with
        // APHRODY_TAURI_DEBUG=1; see docs/guides/web/TAURI-DEBUG.md.
        .plugin(tauri_plugin_aphrody::wrap::debug::init())
        .setup(move |app| {
            let size = f64::from(args.size.unwrap_or(640));
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("aphrody model")
                    .inner_size(size, size)
                    .center()
                    .decorations(false)
                    .transparent(true)
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .no_redirection_bitmap(!args.gdi)
                    .build()?;
            let info = aphrody_tauri_3d::attach_window(&window.as_ref().window())?;
            log::info!("native 3D layer: {info:?}");
            let options = ModelOptions {
                dark: Some(args.dark),
                ..ModelOptions::default()
            };
            aphrody_tauri_3d::load_path(app.handle(), "main", &args.path, &options)?;

            // Live reload: agents and editors control the view by rewriting the file.
            let handle = app.handle().clone();
            let path = args.path.clone();
            std::thread::spawn(move || {
                let mut seen = modified(&path);
                loop {
                    std::thread::sleep(Duration::from_millis(250));
                    let now = modified(&path);
                    if now.is_some() && now != seen {
                        seen = now;
                        // Let the writer finish before reading.
                        std::thread::sleep(Duration::from_millis(60));
                        let (inner, file) = (handle.clone(), path.clone());
                        let _ = handle.run_on_main_thread(move || {
                            let options = ModelOptions {
                                dark: Some(args.dark),
                                ..ModelOptions::default()
                            };
                            if let Err(error) =
                                aphrody_tauri_3d::load_path(&inner, "main", &file, &options)
                            {
                                eprintln!("reload {}: {error}", file.display());
                            }
                        });
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("aphrody-model-view: {error}");
        return std::process::ExitCode::FAILURE;
    }
    std::process::ExitCode::SUCCESS
}
