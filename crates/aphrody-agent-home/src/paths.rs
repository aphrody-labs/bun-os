// SPDX-License-Identifier: Apache-2.0
//! Workspace path resolution (AH-10 profile support).
//!
//! Mirrors `crates/cli/src/oc_cmd.rs::home_dir` exactly so the agent home and
//! the CLI agree on the on-disk layout, then layers profile / multi-agent
//! resolution on top:
//!
//! * `$APHRODY_WORKSPACE` — explicit override, wins over everything.
//! * `$APHRODY_PROFILE` — selects an existing `~/.aphrody/workspaces/<profile>`
//!   when present, otherwise `~/.aphrody/workspace-<profile>`.
//! * agent id — selects `~/.aphrody/workspace-<profile>` per agent when set via
//!   [`HomeOptions::agent_id`].
//! * default — `~/.aphrody/workspace`.
//!
//! Named and per-agent homes live under the homes root
//! ([`crate::homes::HomesRoot`]): `$APHRODY_HOMES_DIR`, else `[agent_home]
//! homes_dir` in `config.toml`, else `~/.aphrody/workspaces` (default layout
//! unchanged).

use std::path::{Path, PathBuf};

#[cfg(not(target_arch = "wasm32"))]
pub use aphrody_models::paths::ENV_APHRODY_HOME;

#[cfg(target_arch = "wasm32")]
pub const ENV_APHRODY_HOME: &str = "APHRODY_HOME";

use crate::{HomeError, homes::HomesRoot};
/// Environment variable that overrides the workspace directory outright.
pub const ENV_APHRODY_WORKSPACE: &str = "APHRODY_WORKSPACE";
/// Environment variable that selects a named profile.
pub const ENV_APHRODY_PROFILE: &str = "APHRODY_PROFILE";

/// Resolve the user's home directory.
///
/// Delegates to [`aphrody_models::paths::home_dir`], the single authority for
/// aphrody's on-disk layout.
///
/// # Errors
/// [`HomeError::NoHome`] when no home directory can be determined.
#[cfg(not(target_arch = "wasm32"))]
pub fn home_dir() -> Result<PathBuf, HomeError> {
    aphrody_models::paths::home_dir().map_err(|_| HomeError::NoHome)
}

#[cfg(target_arch = "wasm32")]
pub fn home_dir() -> Result<PathBuf, HomeError> {
    Err(HomeError::NoHome)
}

/// Root aphrody state directory: `$APHRODY_HOME` when set, else `~/.aphrody`.
///
/// # Errors
/// [`HomeError::NoHome`] when the variable is unset and no home can be found.
#[cfg(not(target_arch = "wasm32"))]
pub fn state_dir() -> Result<PathBuf, HomeError> {
    aphrody_models::paths::state_dir().map_err(|_| HomeError::NoHome)
}

#[cfg(target_arch = "wasm32")]
pub fn state_dir() -> Result<PathBuf, HomeError> {
    Err(HomeError::NoHome)
}

/// Sanitise a profile / agent token into a filesystem-safe suffix: keep
/// ASCII alphanumerics, `-`, `_`; map everything else to `-`; lowercase.
/// Guarantees the resolved workspace can never escape `~/.aphrody/`.
#[must_use]
pub fn sanitize_profile(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('-');
        }
    }
    // Collapse leading/trailing separators that would make an ugly dir name.
    out.trim_matches('-').to_string()
}

/// Resolve the workspace directory for an optional profile + agent id.
///
/// Resolution order (first match wins):
/// 1. `$APHRODY_WORKSPACE` (verbatim override).
/// 2. explicit `agent_id` -> `~/.aphrody/workspace-<agent>`, or `<homes root>/<agent>` when the
///    homes root is configured.
/// 3. `profile` arg or `$APHRODY_PROFILE` -> [`named_profile_workspace`].
/// 4. default -> `~/.aphrody/workspace`.
///
/// # Errors
/// Propagates [`home_dir`] failure when no override is set.
pub fn resolve_workspace(
    profile: Option<&str>,
    agent_id: Option<&str>,
) -> Result<PathBuf, HomeError> {
    if let Ok(ws) = std::env::var(ENV_APHRODY_WORKSPACE)
        && !ws.is_empty()
    {
        return Ok(PathBuf::from(ws));
    }
    let base = state_dir()?;
    if let Some(agent) = agent_id
        && let Some(home) = HomesRoot::resolve_in_lenient(&base).agent_home(agent)
    {
        return Ok(home);
    }
    let prof = profile
        .map(str::to_string)
        .or_else(|| std::env::var(ENV_APHRODY_PROFILE).ok())
        .map(|p| sanitize_profile(&p))
        .filter(|p| !p.is_empty());
    match prof {
        Some(p) => Ok(named_profile_workspace(&base, &p)),
        None => Ok(base.join("workspace")),
    }
}

/// Resolve a named profile inside an explicit state directory, independently
/// of the current agent's workspace/profile environment overrides.
///
/// The home lives under the homes root ([`HomesRoot`]); with the default root
/// an existing legacy `workspace-<profile>` directory remains a compatibility
/// fallback, and a profile with no directory yet keeps resolving to the legacy
/// path (unchanged behaviour).
#[must_use]
pub fn named_profile_workspace(state: &Path, profile: &str) -> PathBuf {
    let root = HomesRoot::resolve_in_lenient(state);
    let name = sanitize_profile(profile);
    if name.is_empty() || root.is_configured() {
        return root.home(&name);
    }
    let canonical = root.path.join(&name);
    if canonical.is_dir() {
        canonical
    } else {
        state.join(format!("workspace-{name}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn named_profile_uses_canonical_home_before_legacy_within_the_selected_state() {
        let state = tempfile::tempdir().unwrap();
        let legacy = state.path().join("workspace-docs");
        std::fs::create_dir_all(&legacy).unwrap();
        assert_eq!(named_profile_workspace(state.path(), "DOCS"), legacy);
        let canonical = state.path().join("workspaces/docs");
        std::fs::create_dir_all(&canonical).unwrap();
        assert_eq!(named_profile_workspace(state.path(), "DOCS"), canonical);
        assert_eq!(named_profile_workspace(state.path(), "../docs"), canonical);
        assert_eq!(
            named_profile_workspace(state.path(), ""),
            state.path().join("workspace")
        );
    }

    #[test]
    fn sanitize_strips_path_separators() {
        // Leading separators (from `..`, `/`) are trimmed, so a traversal
        // attempt collapses to a safe, contained suffix.
        assert_eq!(sanitize_profile("../escape"), "escape");
        assert_eq!(sanitize_profile("a/b\\c"), "a-b-c");
        assert_eq!(sanitize_profile("Prod Agent"), "prod-agent");
        assert_eq!(sanitize_profile("ok_name-1"), "ok_name-1");
    }

    #[test]
    fn sanitize_never_yields_path_traversal() {
        // No sanitised profile can contain a separator or `..`, so
        // `workspace-<profile>` always stays under `~/.aphrody/`.
        for raw in ["../../etc", "a/../../b", "..\\..\\win", "/abs/path"] {
            let s = sanitize_profile(raw);
            assert!(
                !s.contains('/') && !s.contains('\\') && !s.contains(".."),
                "leaked: {s}"
            );
        }
    }

    #[test]
    fn sanitize_trims_separator_edges() {
        assert_eq!(sanitize_profile("...x..."), "x");
        assert_eq!(sanitize_profile("///"), "");
    }
}
