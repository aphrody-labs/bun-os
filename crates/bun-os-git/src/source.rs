// SPDX-License-Identifier: Apache-2.0
//! Upstream source checkouts kept outside the repository.
//!
//! Reads `tools/config/upstream-sources.json`, the manifest owned by
//! `@aphrody/workspace`, and reports each checkout's state under the source
//! root. Restoring (clone, extract, patch) stays in the workspace package;
//! this module only inspects, so it never writes.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, git_error, io_error};

/// Manifest path relative to the repository root.
pub const MANIFEST_PATH: &str = "tools/config/upstream-sources.json";

/// Environment variable overriding the manifest's source root.
pub const SOURCE_ROOT_ENV: &str = "APHRODY_SOURCE_ROOT";

#[derive(Debug, Deserialize)]
struct Manifest {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    root: String,
    sources: Vec<Source>,
    #[serde(default)]
    integrated: Vec<IntegratedSource>,
}

#[derive(Debug, Deserialize)]
struct IntegratedSource {
    #[serde(flatten)]
    source: Source,
    #[serde(rename = "integratedPath")]
    path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct Source {
    id: String,
    kind: String,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    commit: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    patches: Vec<Patch>,
}

#[derive(Debug, Deserialize)]
struct Patch {
    id: String,
    marker: Marker,
}

#[derive(Debug, Deserialize)]
struct Marker {
    file: String,
    contains: String,
}

/// State of one checkout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceState {
    /// Present, at its pin, patches applied.
    Ok,
    /// Present and recorded without a pin.
    Tracked,
    /// Directory absent.
    Missing,
    /// HEAD differs from the pinned commit, or the directory is not a checkout.
    Drift,
    /// A manifest patch is not applied.
    PatchMissing,
}

impl SourceState {
    /// Whether the state satisfies `verify`.
    #[must_use]
    pub const fn is_healthy(self) -> bool {
        matches!(self, Self::Ok | Self::Tracked)
    }
}

/// Status of one source.
#[derive(Debug, Clone, Serialize)]
pub struct SourceRow {
    /// Manifest id, also the directory name under the root.
    pub id: String,
    /// Checkout state.
    pub state: SourceState,
    /// Short human-readable detail.
    pub detail: String,
}

/// Status of every source plus directories the manifest does not list.
#[derive(Debug, Clone, Serialize)]
pub struct SourceReport {
    /// Resolved source root.
    pub root: PathBuf,
    /// One row per manifest entry.
    pub rows: Vec<SourceRow>,
    /// Directories under the root absent from the manifest.
    pub unmanaged: Vec<String>,
}

impl SourceReport {
    /// Whether every source is healthy.
    #[must_use]
    pub fn is_healthy(&self) -> bool {
        self.rows.iter().all(|row| row.state.is_healthy())
    }
}

/// Inspects every manifest source. `source_root` overrides the environment and the manifest.
pub fn source_report(
    repository: impl AsRef<Path>,
    source_root: Option<&Path>,
) -> Result<SourceReport, Error> {
    let repository = repository.as_ref();
    let manifest_path = repository.join(MANIFEST_PATH);
    let text = std::fs::read_to_string(&manifest_path)
        .map_err(|error| io_error("read manifest", &manifest_path, error))?;
    let manifest: Manifest = serde_json::from_str(&text)?;
    if manifest.schema_version != 1 {
        return Err(git_error(format!(
            "unsupported manifest schemaVersion {}",
            manifest.schema_version
        )));
    }
    let root = match source_root {
        Some(path) => repository.join(path),
        None => match std::env::var_os(SOURCE_ROOT_ENV) {
            Some(value) => repository.join(value),
            None => repository.join(&manifest.root),
        },
    };
    let mut rows: Vec<_> = manifest.sources.iter().map(|source| inspect(&root, source)).collect();
    for integrated in &manifest.integrated {
        if !integrated.path.starts_with("crates")
            || integrated
                .path
                .components()
                .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            return Err(git_error(format!(
                "{}: integratedPath must stay under crates/",
                integrated.source.id
            )));
        }
        rows.push(inspect_at(&repository.join(&integrated.path), &integrated.source));
    }
    let mut unmanaged = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let known = manifest.sources.iter().any(|source| source.id == name);
            if !known && entry.path().is_dir() {
                unmanaged.push(name);
            }
        }
        unmanaged.sort();
    }
    Ok(SourceReport { root, rows, unmanaged })
}

fn inspect(root: &Path, source: &Source) -> SourceRow {
    inspect_at(&root.join(&source.id), source)
}

fn inspect_at(dir: &Path, source: &Source) -> SourceRow {
    let row = |state, detail: String| SourceRow { id: source.id.clone(), state, detail };
    if !dir.is_dir() {
        return row(SourceState::Missing, dir.display().to_string());
    }
    let mut head = None;
    if source.kind == "git" {
        let resolved = gix::open(dir).ok().and_then(|repo| {
            let id = repo.head_id().ok()?.to_string();
            Some(id)
        });
        match resolved {
            Some(id) => head = Some(id),
            None => return row(SourceState::Drift, "not a git checkout".into()),
        }
        if source.pinned && head != source.commit {
            let short = |value: &Option<String>| {
                value
                    .as_deref()
                    .map_or_else(|| "none".to_owned(), |sha| sha.chars().take(8).collect())
            };
            return row(
                SourceState::Drift,
                format!("HEAD {} != pin {}", short(&head), short(&source.commit)),
            );
        }
    }
    let unapplied: Vec<&str> = source
        .patches
        .iter()
        .filter(|patch| {
            std::fs::read_to_string(dir.join(&patch.marker.file))
                .map_or(true, |content| !content.contains(&patch.marker.contains))
        })
        .map(|patch| patch.id.as_str())
        .collect();
    if !unapplied.is_empty() {
        return row(SourceState::PatchMissing, unapplied.join(", "));
    }
    let detail = head
        .as_deref()
        .map(|sha| sha.chars().take(8).collect())
        .or_else(|| source.version.clone())
        .unwrap_or_default();
    row(if source.pinned { SourceState::Ok } else { SourceState::Tracked }, detail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_and_unmanaged_are_reported() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path();
        std::fs::create_dir_all(repo.join("tools").join("config")).unwrap();
        std::fs::create_dir_all(repo.join("src-root/stray")).unwrap();
        std::fs::write(
            repo.join(MANIFEST_PATH),
            r#"{"schemaVersion":1,"root":"src-root","sources":[
                {"id":"gone","kind":"git","pinned":true,"commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                {"id":"c","kind":"crate","version":"1.0.0","pinned":true,
                 "patches":[{"id":"p","marker":{"file":"f.rs","contains":"X"}}]}]}"#,
        )
        .unwrap();
        std::fs::create_dir_all(repo.join("src-root/c")).unwrap();
        let report = source_report(repo, Some(Path::new("src-root"))).unwrap();
        assert_eq!(report.rows[0].state, SourceState::Missing);
        assert_eq!(report.rows[1].state, SourceState::PatchMissing);
        assert_eq!(report.unmanaged, vec!["stray"]);
        std::fs::write(repo.join("src-root/c/f.rs"), "X").unwrap();
        let report = source_report(repo, Some(Path::new("src-root"))).unwrap();
        assert_eq!(report.rows[1].state, SourceState::Ok);
        assert!(!report.is_healthy());
    }

    #[test]
    fn integrated_sources_ignore_external_root_and_reject_escape() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path();
        std::fs::create_dir_all(repo.join("tools").join("config")).unwrap();
        std::fs::create_dir_all(repo.join("crates/native/example")).unwrap();
        let manifest = r#"{"schemaVersion":1,"root":"absent","sources":[],"integrated":[{"id":"example","kind":"crate","version":"1.0.0","pinned":true,"integratedPath":"crates/native/example","patches":[{"id":"p","marker":{"file":"f.rs","contains":"patched"}}]}]}"#;
        std::fs::write(repo.join(MANIFEST_PATH), manifest).unwrap();
        assert_eq!(source_report(repo, None).unwrap().rows[0].state, SourceState::PatchMissing);
        std::fs::write(repo.join("crates/native/example/f.rs"), "patched").unwrap();
        assert!(source_report(repo, Some(Path::new("also-absent"))).unwrap().is_healthy());
        std::fs::write(
            repo.join(MANIFEST_PATH),
            manifest.replace("crates/native/example", "crates/../../outside"),
        )
        .unwrap();
        assert!(source_report(repo, None).is_err());
    }
}
