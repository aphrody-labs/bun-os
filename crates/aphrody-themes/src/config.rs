// SPDX-License-Identifier: Apache-2.0
//! The theme selection shared by every running app: a small JSON file that the shell writes and that native
//! apps watch. Same shape and normalization as the TypeScript runtime (`Selection` in `packages/themes`).
//!
//! Location: `$APHRODY_THEME_FILE`, else `%APPDATA%\aphrody\theme.json` (Windows),
//! `~/Library/Application Support/aphrody/theme.json` (macOS), `$XDG_CONFIG_HOME` or `~/.config` `/aphrody/theme.json`.

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, SystemTime},
};

use serde::{Deserialize, Serialize};

use crate::{Scheme, ThemeId};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SchemeChoice {
    Auto,
    Light,
    Dark,
}

impl SchemeChoice {
    pub fn resolve(self, system_dark: bool) -> Scheme {
        match self {
            SchemeChoice::Light => Scheme::Light,
            SchemeChoice::Dark => Scheme::Dark,
            SchemeChoice::Auto if system_dark => Scheme::Dark,
            SchemeChoice::Auto => Scheme::Light,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Selection {
    pub theme: String,
    pub scheme: SchemeChoice,
    pub accent: String,
    /// Liquid Glass slider: 0 ultra clear to 1 fully tinted; `None` keeps the theme default.
    pub transparency: Option<f32>,
}

impl Default for Selection {
    fn default() -> Self {
        Self { theme: "m3".into(), scheme: SchemeChoice::Auto, accent: ThemeId::M3.meta().default_accent.into(), transparency: None }
    }
}

impl Selection {
    pub fn theme_id(&self) -> ThemeId {
        ThemeId::parse(&self.theme).unwrap_or(ThemeId::M3)
    }

    /// Lenient parse: anything invalid falls back field by field, like `normalize` in the TypeScript runtime.
    pub fn from_json(text: &str) -> Self {
        let v: serde_json::Value = serde_json::from_str(text).unwrap_or(serde_json::Value::Null);
        let theme = v.get("theme").and_then(|t| t.as_str()).and_then(ThemeId::parse).unwrap_or(ThemeId::M3);
        let scheme = match v.get("scheme").and_then(|s| s.as_str()) {
            Some("light") => SchemeChoice::Light,
            Some("dark") => SchemeChoice::Dark,
            _ => SchemeChoice::Auto,
        };
        let meta = theme.meta();
        let accent = v
            .get("accent")
            .and_then(|a| a.as_str())
            .filter(|a| meta.accents.contains(a))
            .unwrap_or(meta.default_accent)
            .to_string();
        let transparency = v.get("transparency").and_then(|t| t.as_f64()).map(|t| t.clamp(0.0, 1.0) as f32);
        Self { theme: theme.as_str().into(), scheme, accent, transparency }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("selection serializes")
    }
}

pub fn config_path() -> PathBuf {
    if let Some(p) = std::env::var_os("APHRODY_THEME_FILE") {
        return p.into();
    }
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    };
    base.unwrap_or_else(|| PathBuf::from(".")).join("aphrody").join("theme.json")
}

/// Reads the selection; a missing or unreadable file yields the default.
pub fn read(path: &Path) -> Selection {
    fs::read_to_string(path).map(|t| Selection::from_json(&t)).unwrap_or_default()
}

/// Writes atomically (temporary file in the same directory, then rename) so watchers never see a partial file.
pub fn write(path: &Path, sel: &Selection) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, sel.to_json())?;
    fs::rename(&tmp, path)
}

/// Stops the watcher thread when dropped.
pub struct WatchHandle {
    stop: Arc<AtomicBool>,
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

fn stamp(path: &Path) -> Option<(SystemTime, u64)> {
    fs::metadata(path).ok().and_then(|m| Some((m.modified().ok()?, m.len())))
}

/// Polls `path` every `interval` and calls `on_change` with the new selection whenever the file changes and the
/// parsed selection differs from the previous one. Polling keeps this dependency-free and identical on every OS.
pub fn watch(path: PathBuf, interval: Duration, mut on_change: impl FnMut(Selection) + Send + 'static) -> WatchHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    // initial state is taken before the thread starts so a write right after `watch` returns is never missed
    let mut last_stamp = stamp(&path);
    let mut last = read(&path);
    thread::spawn(move || {
        while !flag.load(Ordering::Relaxed) {
            thread::sleep(interval);
            let now = stamp(&path);
            if now != last_stamp {
                last_stamp = now;
                let sel = read(&path);
                if sel != last {
                    last = sel.clone();
                    on_change(sel);
                }
            }
        }
    });
    WatchHandle { stop }
}
