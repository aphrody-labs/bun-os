// SPDX-License-Identifier: Apache-2.0
//! Home Agent profile state roots shared by the `memory` and `rag` commands.

use std::path::{Path, PathBuf};

use aphrody_config::Config;

pub(crate) use aphrody_diagnostics::config::{load_config, profile_workspace};

pub(crate) fn profile_state_root(config: &Config) -> miette::Result<PathBuf> {
    let base = aphrody_models::paths::state_dir()
        .map_err(|error| miette::miette!("profile state: {error}"))?;
    let workspace = profile_workspace(config)?;
    Ok(profile_state_root_at(
        &base,
        &workspace,
        config.active_profile.as_deref(),
    ))
}

fn profile_state_root_at(base: &Path, workspace: &Path, active_profile: Option<&str>) -> PathBuf {
    if active_profile.is_some() {
        return workspace.to_path_buf();
    }
    base.to_path_buf()
}
