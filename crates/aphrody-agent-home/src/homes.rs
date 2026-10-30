// SPDX-License-Identifier: Apache-2.0
//! The homes root: the directory that holds one subdirectory per Agent Home.
//!
//! Resolution (first match wins):
//!
//! 1. `$APHRODY_HOMES_DIR` ([`ENV_APHRODY_HOMES_DIR`]);
//! 2. `homes_dir` in the `[agent_home]` table of `<state>/config.toml`;
//! 3. default: `<state>/workspaces` (unchanged layout).
//!
//! A relative value is resolved against the state directory. With the default
//! root, the legacy layouts stay readable: a named home falls back to
//! `<state>/workspace-<name>` when `workspaces/<name>` does not exist, and an
//! agent id keeps resolving to `<state>/workspace-<agent>`. With a configured
//! root (multi-user hosts, one home per chat user), every home, named or per
//! agent, is `<root>/<sanitised name>`.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{HomeError, paths::sanitize_profile};

/// Environment variable overriding the homes root.
pub const ENV_APHRODY_HOMES_DIR: &str = "APHRODY_HOMES_DIR";

/// Directory name of the default homes root under the state directory.
pub const DEFAULT_HOMES_DIRNAME: &str = "workspaces";

/// Where the homes root came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HomesRootSource {
    /// `$APHRODY_HOMES_DIR`.
    Env,
    /// `[agent_home] homes_dir` in `<state>/config.toml`.
    Config,
    /// Passed explicitly by the caller (for example `--homes-dir`).
    Explicit,
    /// `<state>/workspaces`.
    Default,
}

/// Resolved homes root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HomesRoot {
    /// State directory (`$APHRODY_HOME` or `~/.aphrody`).
    pub state: PathBuf,
    /// Directory holding the homes.
    pub path: PathBuf,
    /// Origin of [`HomesRoot::path`].
    pub source: HomesRootSource,
}

/// One home found under the root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HomeEntry {
    /// Directory name (the sanitised home name).
    pub name: String,
    /// Absolute path.
    pub path: PathBuf,
    /// Whether this is a legacy `<state>/workspace-<name>` home.
    pub legacy: bool,
}

/// Read `[agent_home] homes_dir` from `<state>/config.toml`.
///
/// # Errors
/// [`HomeError::Config`] when the file exists but is not valid TOML.
#[cfg(not(target_arch = "wasm32"))]
pub fn configured_homes_dir(state: &Path) -> Result<Option<String>, HomeError> {
    let path = state.join("config.toml");
    let value =
        aphrody_config::load_toml_file(&path).map_err(|e| HomeError::Config(e.to_string()))?;
    Ok(value
        .as_ref()
        .and_then(aphrody_config::AgentHomeConfig::from_toml)
        .and_then(|c| c.homes_dir)
        .filter(|d| !d.trim().is_empty()))
}

/// wasm32 has no filesystem-backed `config.toml`: the root comes from the
/// explicit arguments or the default only.
#[cfg(target_arch = "wasm32")]
pub fn configured_homes_dir(_state: &Path) -> Result<Option<String>, HomeError> {
    Ok(None)
}

impl HomesRoot {
    /// Pure resolution from explicit inputs (`env` then `config`, else the
    /// default). Empty values count as unset.
    #[must_use]
    pub fn resolve_with(state: &Path, env: Option<&str>, config: Option<&str>) -> Self {
        let pick = |raw: &str| {
            let p = PathBuf::from(raw.trim());
            if p.is_absolute() { p } else { state.join(p) }
        };
        let state_buf = state.to_path_buf();
        if let Some(v) = env.filter(|v| !v.trim().is_empty()) {
            return Self {
                state: state_buf,
                path: pick(v),
                source: HomesRootSource::Env,
            };
        }
        if let Some(v) = config.filter(|v| !v.trim().is_empty()) {
            return Self {
                state: state_buf,
                path: pick(v),
                source: HomesRootSource::Config,
            };
        }
        Self {
            path: state.join(DEFAULT_HOMES_DIRNAME),
            state: state_buf,
            source: HomesRootSource::Default,
        }
    }

    /// Use an explicit root (relative values join the state directory).
    #[must_use]
    pub fn explicit(state: &Path, path: &Path) -> Self {
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            state.join(path)
        };
        Self {
            state: state.to_path_buf(),
            path,
            source: HomesRootSource::Explicit,
        }
    }

    /// Resolve inside an explicit state directory from the process environment
    /// and `<state>/config.toml`.
    ///
    /// # Errors
    /// [`HomeError::Config`] for a malformed `config.toml`.
    pub fn resolve_in(state: &Path) -> Result<Self, HomeError> {
        let env = std::env::var(ENV_APHRODY_HOMES_DIR).ok();
        let config = if env.as_deref().is_some_and(|v| !v.trim().is_empty()) {
            None
        } else {
            configured_homes_dir(state)?
        };
        Ok(Self::resolve_with(state, env.as_deref(), config.as_deref()))
    }

    /// Like [`HomesRoot::resolve_in`], but a malformed `config.toml` falls back
    /// to the default root with a warning instead of failing (used by the
    /// infallible path helpers).
    #[must_use]
    pub fn resolve_in_lenient(state: &Path) -> Self {
        Self::resolve_in(state).unwrap_or_else(|e| {
            tracing::warn!(error = %e, "ignoring [agent_home] config; using the default homes root");
            let env = std::env::var(ENV_APHRODY_HOMES_DIR).ok();
            Self::resolve_with(state, env.as_deref(), None)
        })
    }

    /// Resolve from the process state directory.
    ///
    /// # Errors
    /// [`HomeError::NoHome`] without a state directory, [`HomeError::Config`]
    /// for a malformed `config.toml`.
    pub fn resolve() -> Result<Self, HomeError> {
        Self::resolve_in(&crate::paths::state_dir()?)
    }

    /// Whether the root was configured (env or config) rather than defaulted.
    #[must_use]
    pub fn is_configured(&self) -> bool {
        self.source != HomesRootSource::Default
    }

    /// Path of the home called `name` (sanitised). With the default root an
    /// existing legacy `<state>/workspace-<name>` is honoured when
    /// `workspaces/<name>` is absent. An empty name selects
    /// `<state>/workspace`.
    #[must_use]
    pub fn home(&self, name: &str) -> PathBuf {
        let name = sanitize_profile(name);
        if name.is_empty() {
            return self.state.join("workspace");
        }
        let canonical = self.path.join(&name);
        if self.is_configured() || canonical.is_dir() {
            return canonical;
        }
        let legacy = self.state.join(format!("workspace-{name}"));
        if legacy.is_dir() { legacy } else { canonical }
    }

    /// Path of a per-agent home. Default root: `<state>/workspace-<agent>`
    /// (unchanged); configured root: `<root>/<agent>`. `None` when the id
    /// sanitises to nothing.
    #[must_use]
    pub fn agent_home(&self, agent_id: &str) -> Option<PathBuf> {
        let s = sanitize_profile(agent_id);
        if s.is_empty() {
            return None;
        }
        Some(if self.is_configured() {
            self.path.join(s)
        } else {
            self.state.join(format!("workspace-{s}"))
        })
    }

    /// Path a new home called `name` is created at (never a legacy path).
    ///
    /// # Errors
    /// [`HomeError::InvalidHomeName`] when the name sanitises to nothing.
    pub fn new_home_path(&self, name: &str) -> Result<PathBuf, HomeError> {
        let s = sanitize_profile(name);
        if s.is_empty() {
            return Err(HomeError::InvalidHomeName(name.to_string()));
        }
        Ok(self.path.join(s))
    }

    /// List the homes under the root (sorted by name), plus the legacy
    /// `<state>/workspace-<name>` homes when the root is the default one.
    ///
    /// # Errors
    /// [`HomeError::Io`] when an existing directory cannot be read.
    pub fn list(&self) -> Result<Vec<HomeEntry>, HomeError> {
        let mut out = Vec::new();
        for (dir, legacy) in [(&self.path, false), (&self.state, true)] {
            if legacy && self.is_configured() {
                continue;
            }
            let entries = match std::fs::read_dir(dir) {
                Ok(e) => e,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(HomeError::io(dir, e)),
            };
            for entry in entries {
                let entry = entry.map_err(|e| HomeError::io(dir, e))?;
                if !entry
                    .file_type()
                    .map_err(|e| HomeError::io(entry.path(), e))?
                    .is_dir()
                {
                    continue;
                }
                let raw = entry.file_name().to_string_lossy().into_owned();
                let name = if legacy {
                    match raw.strip_prefix("workspace-") {
                        Some(n) if !n.is_empty() => n.to_string(),
                        _ => continue,
                    }
                } else if raw.starts_with('.') {
                    continue;
                } else {
                    raw
                };
                if legacy && out.iter().any(|h: &HomeEntry| h.name == name) {
                    continue;
                }
                out.push(HomeEntry {
                    name,
                    path: entry.path(),
                    legacy,
                });
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name).then(a.legacy.cmp(&b.legacy)));
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_root_is_unchanged() {
        let state = tempfile::tempdir().unwrap();
        let root = HomesRoot::resolve_with(state.path(), None, None);
        assert_eq!(root.path, state.path().join("workspaces"));
        assert_eq!(root.source, HomesRootSource::Default);
        assert_eq!(
            root.agent_home("Bot 1").unwrap(),
            state.path().join("workspace-bot-1")
        );
        assert_eq!(root.home("docs"), state.path().join("workspaces/docs"));
        std::fs::create_dir_all(state.path().join("workspace-docs")).unwrap();
        assert_eq!(root.home("docs"), state.path().join("workspace-docs"));
        assert_eq!(root.home(""), state.path().join("workspace"));
    }

    #[test]
    fn env_wins_over_config_and_relative_values_join_the_state() {
        let state = tempfile::tempdir().unwrap();
        let root = HomesRoot::resolve_with(state.path(), Some("/data/homes"), Some("cfg"));
        assert_eq!(root.path, PathBuf::from("/data/homes"));
        assert_eq!(root.source, HomesRootSource::Env);
        let root = HomesRoot::resolve_with(state.path(), Some("  "), Some("users"));
        assert_eq!(root.path, state.path().join("users"));
        assert_eq!(root.source, HomesRootSource::Config);
        // Configured roots put agent homes inside the root, never legacy paths.
        std::fs::create_dir_all(state.path().join("workspace-x")).unwrap();
        assert_eq!(root.home("x"), state.path().join("users/x"));
        assert_eq!(
            root.agent_home("user:42").unwrap(),
            state.path().join("users/user-42")
        );
        assert!(root.agent_home("::").is_none());
    }

    #[test]
    fn config_toml_supplies_the_root() {
        let state = tempfile::tempdir().unwrap();
        std::fs::write(
            state.path().join("config.toml"),
            "[agent_home]\nhomes_dir = \"people\"\n",
        )
        .unwrap();
        assert_eq!(
            configured_homes_dir(state.path()).unwrap().as_deref(),
            Some("people")
        );
        std::fs::write(state.path().join("config.toml"), "not = [valid").unwrap();
        assert!(matches!(
            configured_homes_dir(state.path()),
            Err(HomeError::Config(_))
        ));
        let lenient = HomesRoot::resolve_in_lenient(state.path());
        assert!(lenient.path.ends_with("workspaces") || lenient.source == HomesRootSource::Env);
    }

    #[test]
    fn list_merges_canonical_and_legacy_homes() {
        let state = tempfile::tempdir().unwrap();
        for d in [
            "workspaces/aphrody",
            "workspaces/.hidden",
            "workspace-docs",
            "workspace-aphrody",
        ] {
            std::fs::create_dir_all(state.path().join(d)).unwrap();
        }
        let root = HomesRoot::resolve_with(state.path(), None, None);
        let names: Vec<_> = root
            .list()
            .unwrap()
            .into_iter()
            .map(|h| (h.name, h.legacy))
            .collect();
        assert_eq!(
            names,
            [("aphrody".to_string(), false), ("docs".to_string(), true)]
        );
        assert!(root.new_home_path("..").is_err());
    }
}
