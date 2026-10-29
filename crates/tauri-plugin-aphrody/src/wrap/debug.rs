// SPDX-License-Identifier: Apache-2.0
//! Debug bridge for Tauri 3 apps, driven by `aphrody-web` and the `aphrody_tauri_*` tools of
//! `aphrody-mcp`. It was the
//! `aphrody-tauri-debug` crate; the discovery file schema `aphrody-tauri-debug/1` and the
//! `APHRODY_TAURI_DEBUG*` variables are wire contracts and keep their names.
//!
//! ```rust,ignore
//! tauri::Builder::default()
//!     .runtime(tauri_runtime_cef::Cef::default())
//!     .plugin(tauri_plugin_aphrody::wrap::debug::init())
//! ```
//!
//! `init()` is safe to call unconditionally:
//!
//! - without the `debug-bridge` Cargo feature it returns an empty plugin and no bridge code is
//!   linked (release builds);
//! - with the feature but in a release build (`debug_assertions` off) it also returns an empty
//!   plugin;
//! - in a debug build it starts the bridge only when `APHRODY_TAURI_DEBUG` is `1`/`true`.
//!
//! The bridge is the hypothesi `tauri-plugin-mcp-bridge` integrated in `crates/ui/tauri-plugin-mcp-bridge` with the Aphrody
//! Tauri 3 patch set. It listens on `127.0.0.1` only (ephemeral port unless
//! `APHRODY_TAURI_DEBUG_PORT` is set), rejects non-loopback `Host`/`Origin` headers and requires a
//! random per-process token. The URL, token and process id are written to a `0600` discovery file
//! under `<APHRODY_HOME or ~/.aphrody>/web/tauri-debug/`, which `@aphrody/agent-browser/tauri`
//! and `aphrody-mcp` read. No capability or permission is needed in the host app.
//!
//! An app that only wants the bridge depends on the crate with
//! `default-features = false, features = ["debug-bridge"]`: the bundle server and its HTTP stack
//! are not compiled.

use std::path::{Path, PathBuf};

use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

/// Name of the empty placeholder plugin returned when the bridge is not active.
pub const PLUGIN_NAME: &str = "aphrody-debug";
/// `1` or `true` enables the bridge in debug builds.
pub const ENV_ENABLE: &str = "APHRODY_TAURI_DEBUG";
/// Fixed port; `0` or unset asks the OS for an ephemeral one.
pub const ENV_PORT: &str = "APHRODY_TAURI_DEBUG_PORT";
/// Schema identifier of the discovery file.
pub const DISCOVERY_SCHEMA: &str = "aphrody-tauri-debug/1";

/// Whether the bridge code is compiled into this build.
#[must_use]
pub const fn compiled_in() -> bool {
    cfg!(all(feature = "wrap-debug-bridge", debug_assertions))
}

/// `1`, `true`, `yes` and `on` (any case) enable the bridge.
#[must_use]
pub fn parse_enabled(value: Option<&str>) -> bool {
    value.is_some_and(|raw| {
        matches!(
            raw.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

/// A valid port number, or `0` (ephemeral) for anything else.
#[must_use]
pub fn parse_port(value: Option<&str>) -> u16 {
    value
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .unwrap_or(0)
}

/// Directory holding one discovery file per running debug-enabled app.
#[must_use]
pub fn discovery_dir(aphrody_home: Option<&Path>, home: Option<&Path>) -> Option<PathBuf> {
    let base = match aphrody_home {
        Some(path) if !path.as_os_str().is_empty() => path.to_path_buf(),
        _ => home?.join(".aphrody"),
    };
    Some(base.join("web").join("tauri-debug"))
}

/// Contents of the discovery file. The token is part of it by design: the file is `0600`.
#[must_use]
pub fn discovery_json(
    addr: std::net::SocketAddr,
    token: &str,
    pid: u32,
    exe: &str,
    started_at_ms: u128,
) -> serde_json::Value {
    serde_json::json!({
        "schema": DISCOVERY_SCHEMA,
        "pid": pid,
        "exe": exe,
        "ws": format!("ws://{addr}"),
        "host": addr.ip().to_string(),
        "port": addr.port(),
        "token": token,
        "startedAtMs": started_at_ms,
        "tauri": tauri::VERSION,
        "bridge": "tauri-plugin-mcp-bridge 0.13.0 (aphrody tauri3 patch set)",
    })
}

/// File name of the discovery file of this process.
#[must_use]
pub fn discovery_file_name(exe: &str, pid: u32) -> String {
    let stem: String = exe
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{stem}-{pid}.json")
}

/// Returns the plugin to register. See the crate documentation for when it is active.
#[must_use]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    #[cfg(all(feature = "wrap-debug-bridge", debug_assertions))]
    {
        if let Some(plugin) = bridge::build::<R>() {
            return plugin;
        }
    }
    Builder::new(PLUGIN_NAME).build()
}

#[cfg(all(feature = "wrap-debug-bridge", debug_assertions))]
mod bridge {
    use std::{
        io::Write as _,
        time::{SystemTime, UNIX_EPOCH},
    };

    use tauri::{Runtime, plugin::TauriPlugin};

    use super::{
        ENV_ENABLE, ENV_PORT, discovery_dir, discovery_file_name, discovery_json, parse_enabled,
        parse_port,
    };

    fn random_token() -> String {
        format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        )
    }

    /// Writes the discovery file atomically with mode 0600 (directory 0700). Failures are logged
    /// to stderr only: a debug aid must never abort the app.
    fn publish(addr: std::net::SocketAddr, token: &str) {
        let aphrody_home = std::env::var_os("APHRODY_HOME").map(std::path::PathBuf::from);
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(std::path::PathBuf::from);
        let Some(dir) = discovery_dir(aphrody_home.as_deref(), home.as_deref()) else {
            eprintln!("[aphrody-tauri-debug] no home directory; discovery file not written");
            return;
        };
        let pid = std::process::id();
        let exe = std::env::current_exe()
            .ok()
            .and_then(|path| {
                path.file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| "tauri-app".to_owned());
        let started = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        let body = discovery_json(addr, token, pid, &exe, started).to_string();
        let name = discovery_file_name(&exe, pid);
        let result = (|| -> std::io::Result<()> {
            create_private_dir(&dir)?;
            let tmp = dir.join(format!(".{name}.tmp"));
            let mut file = private_file(&tmp)?;
            file.write_all(body.as_bytes())?;
            file.sync_all()?;
            std::fs::rename(&tmp, dir.join(&name))
        })();
        match result {
            Ok(()) => eprintln!(
                "[aphrody-tauri-debug] bridge on ws://{addr} (discovery: {})",
                dir.join(&name).display()
            ),
            Err(error) => {
                eprintln!("[aphrody-tauri-debug] could not write the discovery file: {error}")
            }
        }
    }

    #[cfg(unix)]
    fn create_private_dir(dir: &std::path::Path) -> std::io::Result<()> {
        use std::os::unix::fs::DirBuilderExt as _;
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)
    }

    #[cfg(not(unix))]
    fn create_private_dir(dir: &std::path::Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)
    }

    #[cfg(unix)]
    fn private_file(path: &std::path::Path) -> std::io::Result<std::fs::File> {
        use std::os::unix::fs::OpenOptionsExt as _;
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
    }

    #[cfg(not(unix))]
    fn private_file(path: &std::path::Path) -> std::io::Result<std::fs::File> {
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)
    }

    pub(super) fn build<R: Runtime>() -> Option<TauriPlugin<R>> {
        if !parse_enabled(std::env::var(ENV_ENABLE).ok().as_deref()) {
            return None;
        }
        let token = random_token();
        let published = token.clone();
        Some(
            tauri_plugin_mcp_bridge::Builder::new()
                .bind_address("127.0.0.1")
                .base_port(parse_port(std::env::var(ENV_PORT).ok().as_deref()))
                .token(&token)
                .on_listen(move |addr| publish(addr, &published))
                .build(),
        )
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn enabling_is_explicit() {
        for on in ["1", "true", "TRUE", " yes ", "On"] {
            assert!(parse_enabled(Some(on)), "{on}");
        }
        for off in ["", "0", "false", "no", "maybe"] {
            assert!(!parse_enabled(Some(off)), "{off}");
        }
        assert!(!parse_enabled(None));
    }

    #[test]
    fn ports_fall_back_to_ephemeral() {
        assert_eq!(parse_port(Some("9333")), 9333);
        for bad in [
            None,
            Some(""),
            Some("0"),
            Some("70000"),
            Some("-1"),
            Some("abc"),
        ] {
            assert_eq!(parse_port(bad), 0, "{bad:?}");
        }
    }

    #[test]
    fn discovery_directory_prefers_aphrody_home() {
        let dir = discovery_dir(Some(Path::new("/data/aph")), Some(Path::new("/home/u"))).unwrap();
        assert_eq!(dir, Path::new("/data/aph/web/tauri-debug"));
        let dir = discovery_dir(None, Some(Path::new("/home/u"))).unwrap();
        assert_eq!(dir, Path::new("/home/u/.aphrody/web/tauri-debug"));
        assert!(discovery_dir(None, None).is_none());
        assert!(discovery_dir(Some(Path::new("")), None).is_none());
    }

    #[test]
    fn discovery_document_carries_the_connection_data() {
        let addr: std::net::SocketAddr = "127.0.0.1:43211".parse().unwrap();
        let json = discovery_json(addr, "tok", 42, "model-view", 7);
        assert_eq!(json["schema"], DISCOVERY_SCHEMA);
        assert_eq!(json["ws"], "ws://127.0.0.1:43211");
        assert_eq!(json["port"], 43211);
        assert_eq!(json["pid"], 42);
        assert_eq!(json["token"], "tok");
        assert_eq!(
            discovery_file_name("model view/../x", 5),
            "model_view____x-5.json"
        );
    }

    #[test]
    fn without_the_feature_nothing_is_compiled_in() {
        assert_eq!(
            compiled_in(),
            cfg!(all(feature = "wrap-debug-bridge", debug_assertions))
        );
    }
}
