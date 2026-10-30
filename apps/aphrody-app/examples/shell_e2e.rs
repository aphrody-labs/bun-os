// SPDX-License-Identifier: Apache-2.0
//! Real-webview end-to-end host of the `aphrody-shell-tauri` plugin (it was the
//! `aphrody-shell-tauri-e2e` crate).
//!
//! The page of `examples/shell_e2e/frontend` runs the WASM shell through a real CEF webview
//! and the permission-checked plugin IPC, then reports its result through `report`, which prints
//! it and exits. The desktop's own `main` window and capability are reused: only the assets are
//! swapped for the directory named by `APHRODY_SHELL_E2E_FRONTEND`, which
//! `scripts/aphrody/build/desktop/e2e.ts` assembles (WASM package and transpiled transports).
//! Build it with `--features custom-protocol` so the window serves those assets.

use std::{
    borrow::Cow,
    path::{Component, Path, PathBuf},
};

use tauri::{
    Assets,
    utils::assets::{AssetKey, AssetsIter, CspHash},
};

/// Assets read from a directory at run time; nothing outside the directory is reachable.
struct DirAssets(PathBuf);

impl DirAssets {
    fn resolve(&self, key: &str) -> Option<PathBuf> {
        let mut path = self.0.clone();
        for component in Path::new(key.trim_start_matches('/')).components() {
            match component {
                Component::Normal(part) => path.push(part),
                _ => return None,
            }
        }
        Some(path)
    }
}

impl<R: tauri::Runtime> Assets<R> for DirAssets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        std::fs::read(self.resolve(key.as_ref())?)
            .ok()
            .map(Cow::Owned)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }

    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

#[tauri::command]
fn report(text: String) {
    println!("E2E_RESULT:{text}");
    std::process::exit(0);
}

// `tauri::generate_context!()` expands to code that calls `std::process::exit`.
#[allow(clippy::exit)]
#[cfg_attr(feature = "cef", tauri_runtime_cef::cef_entry_point)]
fn main() {
    let Some(frontend) = std::env::var_os("APHRODY_SHELL_E2E_FRONTEND") else {
        eprintln!("shell_e2e: set APHRODY_SHELL_E2E_FRONTEND (run bun run desktop:e2e)");
        std::process::exit(2);
    };
    let mut context: tauri::Context = tauri::generate_context!();
    context.set_assets(Box::new(DirAssets(PathBuf::from(frontend))));
    let config = context.config_mut();
    config.app.windows.retain(|window| window.label == "main");
    // The page carries inline scripts that no asset hash covers.
    config.app.security.csp = None;
    config.app.security.dev_csp = None;
    tauri::Builder::default()
        .runtime(aphrody_app_lib::webview::runtime())
        .plugin(aphrody_shell_tauri::init())
        .on_page_load(|_, payload| eprintln!("page {:?} {}", payload.event(), payload.url()))
        .invoke_handler(tauri::generate_handler![report])
        .build(context)
        .expect("build shell e2e app")
        .run(|_, _| {});
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assets_never_leave_their_directory() {
        let assets = DirAssets(PathBuf::from("/frontend"));
        assert_eq!(
            assets.resolve("/pkg/a.js"),
            Some(PathBuf::from("/frontend/pkg/a.js"))
        );
        assert_eq!(assets.resolve("/../etc/passwd"), None);
        assert_eq!(assets.resolve("/pkg/../../x"), None);
    }
}
