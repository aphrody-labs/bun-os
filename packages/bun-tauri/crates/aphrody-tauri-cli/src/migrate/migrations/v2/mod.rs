// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

//! Migrates a Tauri v2 app to v3.

use crate::{
    Result, VersionMetadata,
    error::Context,
    helpers::{app_paths::Dirs, npm::PackageManager},
};

use std::path::Path;

pub(crate) mod config;
mod manifest;
mod source;

const RUNTIME_CRATE: &str = "tauri-runtime-cef";

/// Official plugins, published as `tauri-plugin-<name>` and `@aphrody/plugin-<name>`.
const OFFICIAL_PLUGINS: &[&str] = &[
    "autostart",
    "barcode-scanner",
    "biometric",
    "cli",
    "clipboard-manager",
    "deep-link",
    "dialog",
    "fs",
    "geolocation",
    "global-shortcut",
    "haptics",
    "http",
    "localhost",
    "log",
    "nfc",
    "notification",
    "opener",
    "os",
    "persisted-scope",
    "positioner",
    "process",
    "shell",
    "single-instance",
    "sql",
    "store",
    "stronghold",
    "updater",
    "upload",
    "websocket",
    "window-state",
];

pub fn run(dirs: &Dirs) -> Result<()> {
    migrate_tauri_dir(dirs.tauri)?;
    migrate_npm_dependencies(dirs.frontend)?;
    Ok(())
}

/// Migrates the Cargo manifest, the configuration and the Rust sources of the app.
fn migrate_tauri_dir(tauri_dir: &Path) -> Result<()> {
    let metadata = version_metadata()?;

    let manifest =
        manifest::migrate(tauri_dir, &metadata).context("Could not migrate Cargo manifest")?;
    config::migrate(tauri_dir).context("Could not migrate config")?;
    let source = source::migrate(tauri_dir, manifest.uses_runtime)
        .context("Could not migrate Rust sources")?;

    if manifest.uses_runtime && !source.runtime_selected {
        log::warn!(
            "Could not find `tauri::Builder::default()`, select the runtime with `.runtime(tauri_runtime_cef::Cef::default())` on your `tauri::Builder`"
        );
    }

    Ok(())
}

fn migrate_npm_dependencies(frontend_dir: &Path) -> Result<()> {
    let pm = PackageManager::from_project(frontend_dir);
    let npm_version = format!("^{}", generic_dependency_version());

    let packages = ["@aphrody/cli".to_string(), "@aphrody/api".to_string()]
        .into_iter()
        .chain(
            OFFICIAL_PLUGINS
                .iter()
                .map(|plugin| format!("@aphrody/plugin-{plugin}")),
        );

    let mut install_deps = Vec::new();
    for pkg in packages {
        let version = pm
            .current_package_version(&pkg, frontend_dir)
            .unwrap_or_default()
            .unwrap_or_default();
        if version.starts_with('2') {
            install_deps.push(format!("{pkg}@{npm_version}"));
        }
    }

    if !install_deps.is_empty() {
        pm.install(&install_deps, frontend_dir)?;
    }

    Ok(())
}

fn version_metadata() -> Result<VersionMetadata> {
    serde_json::from_str(include_str!("../../../../metadata-v2.json"))
        .context("failed to parse version metadata")
}

fn generic_dependency_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        path::{Path, PathBuf},
    };

    fn fixture_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src/migrate/migrations/v2/fixtures")
    }

    fn copy_dir(from: &Path, to: &Path) {
        for entry in walkdir::WalkDir::new(from) {
            let entry = entry.unwrap();
            let target = to.join(entry.path().strip_prefix(from).unwrap());
            if entry.file_type().is_dir() {
                std::fs::create_dir_all(&target).unwrap();
            } else {
                std::fs::copy(entry.path(), &target).unwrap();
            }
        }
    }

    fn read_files(dir: &Path) -> BTreeMap<PathBuf, String> {
        walkdir::WalkDir::new(dir)
            .into_iter()
            .map(|e| e.unwrap())
            .filter(|e| e.file_type().is_file())
            .map(|e| {
                (
                    e.path().strip_prefix(dir).unwrap().to_path_buf(),
                    std::fs::read_to_string(e.path()).unwrap(),
                )
            })
            .collect()
    }

    /// Migrates a copy of `fixtures/<name>` and snapshots each of its files.
    fn migrate_fixture(name: &str) {
        let temp_dir = tempfile::tempdir().unwrap();
        copy_dir(&fixture_dir().join(name), temp_dir.path());

        super::migrate_tauri_dir(temp_dir.path()).expect("failed to migrate");
        let migrated = read_files(temp_dir.path());
        // the exact versions come from `metadata-v2.json` and change on every release
        let metadata = super::version_metadata().unwrap();
        let filters = [
            &metadata.tauri,
            &metadata.tauri_build,
            &metadata.tauri_plugin,
            &metadata.tauri_runtime_wry,
        ]
        .map(|version| (format!("\"{}\"", regex::escape(version)), "\"[version]\""));
        let filters = filters
            .iter()
            .map(|(pattern, replacement)| (pattern.as_str(), *replacement))
            .collect::<Vec<_>>();
        insta::with_settings!({ filters => filters }, {
          for (file, contents) in &migrated {
            let snapshot_name = format!("{name}__{}", file.display()).replace(['/', '\\'], "__");
            insta::assert_snapshot!(snapshot_name, contents);
          }
        });

        // migrating again is a no-op
        super::migrate_tauri_dir(temp_dir.path()).expect("failed to migrate again");
        pretty_assertions::assert_eq!(read_files(temp_dir.path()), migrated);
    }

    #[test]
    fn migration_targets_owned_release_and_remains_idempotent() {
        let mut manifest: toml_edit::DocumentMut = "[package]\nname = \"app\"\nversion = \"1.0.0\"\n[dependencies]\ntauri = \"2.0.0\"\n[build-dependencies]\ntauri-build = \"2.0.0\"\n".parse().unwrap();
        super::manifest::migrate_manifest(&mut manifest, &super::version_metadata().unwrap());
        assert_eq!(
            manifest["dependencies"]["tauri"]["package"].as_str(),
            Some("aphrody-tauri")
        );
        assert_eq!(
            manifest["dependencies"]["tauri"]["version"].as_str(),
            Some("1.4.4")
        );
        assert_eq!(
            manifest["dependencies"]["tauri-runtime-cef"]["package"].as_str(),
            Some("aphrody-tauri-runtime-cef")
        );
        assert_eq!(
            manifest["build-dependencies"]["tauri-build"]["package"].as_str(),
            Some("aphrody-tauri-build")
        );
        let before = manifest.to_string();
        super::manifest::migrate_manifest(&mut manifest, &super::version_metadata().unwrap());
        assert_eq!(manifest.to_string(), before);
    }

    #[test]
    fn migrate_app() {
        migrate_fixture("app");
    }

    #[test]
    fn migrate_app_without_default_features() {
        migrate_fixture("no-default-features");
    }

    #[test]
    fn migrate_app_without_wry() {
        migrate_fixture("no-wry");
    }
}
