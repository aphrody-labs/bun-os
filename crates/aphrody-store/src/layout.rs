// SPDX-License-Identifier: Apache-2.0
//! Home layout: where the database of the global home or of a domain profile lives.
//!
//! The state root is the one authority of `aphrody-models::paths` (`APHRODY_HOME`, else
//! `~/.aphrody`), reached through `aphrody-agent-home`. Profile homes follow the agent-home
//! rule (`workspaces/<profile>`, legacy `workspace-<profile>`); the unprofiled global home is
//! the state root itself. The database is always `<home>/db/aphrody.sqlite`.

use std::path::{Path, PathBuf};

use aphrody_agent_home::paths::{named_profile_workspace, sanitize_profile, state_dir};

use crate::{
    error::{Result, StoreError},
    time::date_string,
};

/// File name of the home database inside `<home>/db/`.
pub const DB_FILE: &str = "aphrody.sqlite";

/// Which home a database belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HomeScope {
    /// The unprofiled home: the state root (`~/.aphrody`).
    Global,
    /// A domain profile home (`aphrody`, `ie`, ...), isolated from every other.
    Profile(String),
}

impl HomeScope {
    /// Scope from an optional profile name (`None` or empty selects the global home).
    #[must_use]
    pub fn from_profile(profile: Option<&str>) -> Self {
        match profile.map(str::trim).filter(|p| !p.is_empty()) {
            Some(p) => Self::Profile(p.to_owned()),
            None => Self::Global,
        }
    }

    /// Stable label used in file names and ledgers (`global` or the sanitised profile).
    #[must_use]
    pub fn label(&self) -> String {
        match self {
            Self::Global => "global".to_owned(),
            Self::Profile(p) => sanitize_profile(p),
        }
    }
}

/// Resolved paths of one home.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HomeLayout {
    /// Scope this layout was resolved for.
    pub scope: HomeScope,
    /// State root (`~/.aphrody` or `$APHRODY_HOME`).
    pub state: PathBuf,
    /// Home directory of the scope.
    pub home: PathBuf,
    /// Database file `<home>/db/aphrody.sqlite`.
    pub db_path: PathBuf,
}

impl HomeLayout {
    /// Resolve the layout of `scope` from the process environment.
    ///
    /// # Errors
    ///
    /// [`StoreError::Home`] when no state directory can be determined,
    /// [`StoreError::InvalidProfile`] for a profile that sanitises to nothing.
    pub fn resolve(scope: &HomeScope) -> Result<Self> {
        let state = state_dir().map_err(|e| StoreError::Home(e.to_string()))?;
        Self::in_state(&state, scope)
    }

    /// Resolve the layout of `scope` inside an explicit state root (tests, tooling).
    ///
    /// # Errors
    ///
    /// [`StoreError::InvalidProfile`] for a profile that sanitises to nothing.
    pub fn in_state(state: &Path, scope: &HomeScope) -> Result<Self> {
        let home = match scope {
            HomeScope::Global => state.to_path_buf(),
            HomeScope::Profile(name) => {
                if sanitize_profile(name).is_empty() {
                    return Err(StoreError::InvalidProfile(name.clone()));
                }
                named_profile_workspace(state, name)
            }
        };
        let db_path = home.join("db").join(DB_FILE);
        Ok(Self {
            scope: scope.clone(),
            state: state.to_path_buf(),
            home,
            db_path,
        })
    }

    /// Directory of the consolidated, checksum-verified backups of the given day
    /// (`<state>/private/backups/aphrody-unique/<YYYY-MM-DD>`, ADR D12).
    #[must_use]
    pub fn backup_dir(&self, unix_ms: i64) -> PathBuf {
        self.state
            .join("private")
            .join("backups")
            .join("aphrody-unique")
            .join(date_string(unix_ms))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn global_home_is_the_state_root() {
        let state = tempfile::tempdir().unwrap();
        let layout = HomeLayout::in_state(state.path(), &HomeScope::Global).unwrap();
        assert_eq!(layout.home, state.path());
        assert_eq!(layout.db_path, state.path().join("db/aphrody.sqlite"));
    }

    #[test]
    fn profiles_resolve_inside_their_own_home_and_never_share_a_file() {
        let state = tempfile::tempdir().unwrap();
        let legacy = state.path().join("workspace-docs");
        std::fs::create_dir_all(&legacy).unwrap();
        let docs = HomeLayout::in_state(state.path(), &HomeScope::Profile("DOCS".into())).unwrap();
        assert_eq!(docs.home, legacy);
        std::fs::create_dir_all(state.path().join("workspaces/docs")).unwrap();
        let docs = HomeLayout::in_state(state.path(), &HomeScope::Profile("docs".into())).unwrap();
        assert_eq!(
            docs.db_path,
            state.path().join("workspaces/docs/db/aphrody.sqlite")
        );
        let ie = HomeLayout::in_state(state.path(), &HomeScope::Profile("ie".into())).unwrap();
        let global = HomeLayout::in_state(state.path(), &HomeScope::Global).unwrap();
        assert_ne!(docs.db_path, ie.db_path);
        assert_ne!(docs.db_path, global.db_path);
    }

    #[test]
    fn traversal_in_a_profile_stays_inside_the_state_root() {
        let state = tempfile::tempdir().unwrap();
        let layout =
            HomeLayout::in_state(state.path(), &HomeScope::Profile("../../etc".into())).unwrap();
        assert!(layout.db_path.starts_with(state.path()));
        assert!(matches!(
            HomeLayout::in_state(state.path(), &HomeScope::Profile("///".into())),
            Err(StoreError::InvalidProfile(_))
        ));
    }

    #[test]
    fn backups_live_under_the_unique_backup_tree() {
        let state = tempfile::tempdir().unwrap();
        let layout = HomeLayout::in_state(state.path(), &HomeScope::Global).unwrap();
        assert_eq!(
            layout.backup_dir(1_791_290_096_000),
            state
                .path()
                .join("private/backups/aphrody-unique/2026-10-06")
        );
    }

    #[test]
    fn scope_from_profile() {
        assert_eq!(HomeScope::from_profile(None), HomeScope::Global);
        assert_eq!(HomeScope::from_profile(Some("  ")), HomeScope::Global);
        assert_eq!(HomeScope::from_profile(Some("ie")).label(), "ie");
    }
}
