// SPDX-License-Identifier: Apache-2.0
//! The shared live runner used by both the `tweak_*` MCP/CLI tools and the `bunos-win11` front end: it builds a
//! plan from a profile against the running system, saves it as JSON, applies it with a System Restore point and a
//! per-key registry export, journals every change under `%LOCALAPPDATA%\bunos\win11\journal`, verifies, and undoes
//! from the newest journal.

use std::{io, path::PathBuf};

use serde::Serialize;

use super::{Catalog, Journal, Plan, Profile, TweakError};

/// `%LOCALAPPDATA%\bunos\win11` (or `$XDG_DATA_HOME/bunos/win11` off Windows, for tests).
#[must_use]
pub fn state_dir() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("bunos").join("win11")
}

fn journal_dir() -> PathBuf {
    state_dir().join("journal")
}

fn now() -> String {
    // A sortable, filename-safe UTC stamp without pulling a formatter: seconds since the epoch.
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{secs}")
}

fn write_json(path: &std::path::Path, value: &impl Serialize) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(value)?)
}

/// Build the plan for `profile` and write it to `state_dir()/plan-<ts>.json`.
pub fn make_plan(profile: &Profile, backend: &mut dyn super::Backend) -> Result<(Plan, PathBuf), TweakError> {
    let catalog = Catalog::embedded()?;
    let tweaks = profile.select(&catalog)?;
    let ts = now();
    let plan = super::plan(backend, profile, &tweaks, &ts);
    let path = state_dir().join(format!("plan-{ts}.json"));
    write_json(&path, &plan)?;
    Ok((plan, path))
}

/// The newest journal file, if any.
#[must_use]
pub fn latest_journal() -> Option<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(journal_dir())
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    entries.sort();
    entries.pop()
}

#[cfg(windows)]
mod live_apply {
    use super::{super::live::LiveBackend, super::restore, super::touched_keys, write_json, Journal, Plan};
    use std::{io, path::PathBuf};

    /// Apply a live plan: restore point, per-key `.reg` export, then journaled apply with incremental persistence.
    /// Returns the journal path.
    pub fn apply(plan: &Plan, description: &str) -> io::Result<(Journal, PathBuf)> {
        let ts = plan.created.clone();
        let backup_dir = super::state_dir().join(format!("backup-{ts}"));
        let journal_path = super::journal_dir().join(format!("journal-{ts}.json"));

        let mut journal = Journal { started: ts.clone(), ..Journal::default() };
        journal.restore_point = restore::create_restore_point(description).ok().map(|n| format!("#{n}"));
        for (i, (hive, key)) in touched_keys(plan).into_iter().enumerate() {
            if let Ok(Some(entry)) = restore::export_key(hive, &key, &backup_dir, i) {
                journal.registry_exports.push(entry);
            }
        }
        write_json(&journal_path, &journal)?;

        let mut backend = LiveBackend;
        super::super::apply(&mut backend, plan, &mut journal, |j| {
            let _ = write_json(&journal_path, j);
        });
        write_json(&journal_path, &journal)?;
        Ok((journal, journal_path))
    }

    /// Re-detect every journaled change; returns drifting tweak ids.
    pub fn verify(journal: &Journal) -> Vec<String> {
        super::super::verify(&mut LiveBackend, journal)
    }

    /// Undo a journal file in place; returns the report and rewrites the file with `undone = true`.
    pub fn undo(path: &PathBuf) -> io::Result<super::super::UndoReport> {
        let mut journal: Journal = serde_json::from_slice(&std::fs::read(path)?)?;
        let report = super::super::undo(&mut LiveBackend, &mut journal);
        write_json(path, &journal)?;
        Ok(report)
    }
}

#[cfg(windows)]
pub use live_apply::{apply as apply_live, undo as undo_journal, verify as verify_journal};
