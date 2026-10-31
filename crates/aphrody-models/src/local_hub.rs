// SPDX-License-Identifier: Apache-2.0
//! Toolkit-free model hub for Aphrody's local-AI GUIs.
//!
//! Every GUI (the iced/libcosmic clients, the WebOS server) needs the same operations: browse the
//! curated catalog, list what is installed, rank models for this machine, verify, remove and
//! pull with progress. [`ModelHub`] is that one implementation. It calls this crate in process
//! (no `aphrody model` child process, no output scraping) and returns the same JSON documents
//! the CLI's `--json` mode prints, so every client keeps one schema.
//!
//! The API carries no windowing-toolkit, IPC or async-runtime types: progress is a plain
//! callback and cancellation is any `Future<Output = ()>`. Extracted from the retired
//! `apps/aphrody-app` desktop (`src/local_ai.rs`).

use std::{future::Future, path::PathBuf, pin::pin};

use crate::{
    Catalog, Downloader, HardwareProfile, ModelRef, ModelStore, ModelTask, PullOutcome, SpeedTier,
    accel, rank_for,
};
use futures_util::future::{Either, select};
use serde_json::{Value, json};

/// Failure of a hub operation. The message is user-presentable.
#[derive(Debug, thiserror::Error)]
pub enum HubError {
    /// A model-layer failure (store, catalog resolution, transport, digest).
    #[error("{context}: {source}")]
    Model {
        /// What the hub was doing.
        context: String,
        /// The underlying error.
        #[source]
        source: crate::ModelError,
    },
    /// The request itself was invalid (unknown task, nothing fits).
    #[error("{0}")]
    Invalid(String),
    /// The caller cancelled a pull. The `.part` file is kept, so pulling again resumes.
    #[error("download of {0} stopped; pulling it again resumes from the partial file")]
    Cancelled(String),
}

impl HubError {
    fn model(context: impl Into<String>) -> impl FnOnce(crate::ModelError) -> Self {
        let context = context.into();
        move |source| Self::Model { context, source }
    }
}

/// One progress step of a pull.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullProgress {
    /// Catalog id or reference being pulled.
    pub spec: String,
    /// Artefact role (`weights`, `tokenizer`, ...).
    pub role: String,
    /// Bytes on disk so far, including a resumed prefix.
    pub downloaded: u64,
    /// Total size when the server advertised one.
    pub total: Option<u64>,
}

/// Entry point to the model store, catalog and hardware profile.
#[derive(Debug, Clone, Default)]
pub struct ModelHub {
    root: Option<PathBuf>,
}

impl ModelHub {
    /// A hub over the default store (`$APHRODY_MODELS_DIR`, else `~/.aphrody/models`).
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A hub over an explicit store root (the folder chosen in onboarding).
    #[must_use]
    pub fn with_root(root: impl Into<PathBuf>) -> Self {
        Self {
            root: Some(root.into()),
        }
    }

    /// The store, created on first use.
    ///
    /// # Errors
    ///
    /// [`HubError::Model`] when no home can be resolved or the directory cannot be created.
    pub fn store(&self) -> Result<ModelStore, HubError> {
        match &self.root {
            Some(root) => ModelStore::with_root(root),
            None => ModelStore::open(),
        }
        .map_err(HubError::model("open model store"))
    }

    /// The store root directory.
    ///
    /// # Errors
    ///
    /// See [`ModelHub::store`].
    pub fn store_root(&self) -> Result<PathBuf, HubError> {
        Ok(self.store()?.root().to_path_buf())
    }

    /// The curated catalog, optionally filtered by task name.
    ///
    /// # Errors
    ///
    /// [`HubError::Invalid`] for an unknown task.
    pub fn catalog(&self, task: Option<&str>) -> Result<Value, HubError> {
        let builtin = Catalog::builtin();
        let entries = match task.map(parse_task).transpose()? {
            Some(task) => builtin.by_task(task),
            None => builtin.entries.iter().collect(),
        };
        Ok(json!({ "count": entries.len(), "entries": entries }))
    }

    /// Installed artefacts, optionally filtered by task name.
    ///
    /// # Errors
    ///
    /// Unknown task, or the registry cannot be read.
    pub fn installed(&self, task: Option<&str>) -> Result<Value, HubError> {
        let store = self.store()?;
        let mut installed = store
            .list()
            .map_err(HubError::model("read model registry"))?;
        if let Some(task) = task.map(parse_task).transpose()? {
            let ids: Vec<&str> = Catalog::builtin()
                .by_task(task)
                .into_iter()
                .map(|e| e.id.as_str())
                .collect();
            installed.retain(|m| m.catalog_id.as_deref().is_some_and(|id| ids.contains(&id)));
        }
        let total: u64 = installed.iter().map(|m| m.bytes).sum();
        Ok(json!({
            "root": store.root(),
            "count": installed.len(),
            "total_bytes": total,
            "models": installed.iter().map(|m| json!({
                "ref": m.reference.to_string(),
                "path": m.path,
                "bytes": m.bytes,
                "sha256": m.sha256,
                "format": m.format.as_str(),
                "catalog_id": m.catalog_id,
                "installed_at": m.installed_at_rfc3339(),
                "last_used_at": m.last_used_at_rfc3339(),
            })).collect::<Vec<_>>(),
        }))
    }

    /// Hardware profile (NVML in process; absent GPUs degrade to CPU only).
    #[must_use]
    pub fn hardware(&self) -> HardwareProfile {
        accel::probe()
    }

    /// The catalog ranked for `task` on this machine. `prefer` is `fast`, `balanced` or `quality`.
    ///
    /// # Errors
    ///
    /// Unknown task or preference, or nothing in the catalog fits this machine.
    pub fn recommend(&self, task: &str, prefer: &str) -> Result<Value, HubError> {
        let task = parse_task(task)?;
        let prefer = parse_speed(prefer)?;
        let profile = accel::probe();
        let ranked = rank_for(Catalog::builtin(), task, &profile, prefer);
        let Some(top) = ranked.first() else {
            return Err(HubError::Invalid(format!(
                "no catalogued model for task `{task}` fits this machine"
            )));
        };
        Ok(json!({
            "task": task.as_str(),
            "prefer": prefer.as_str(),
            "hardware": profile,
            "ranked": ranked,
            "top": top.id,
        }))
    }

    /// Re-hash every artefact of `spec` against the recorded SHA-256 (blocking, I/O bound).
    ///
    /// A corrupt artefact is a successful call with `"intact": false`, never an error.
    ///
    /// # Errors
    ///
    /// The spec does not resolve, or an artefact cannot be read.
    pub fn verify(&self, spec: &str) -> Result<Value, HubError> {
        let store = self.store()?;
        let mut reports = Vec::new();
        for reference in resolve_refs(spec)? {
            reports.push(
                store
                    .verify(&reference)
                    .map_err(HubError::model(format!("verify `{reference}`")))?,
            );
        }
        let intact = reports.iter().all(crate::VerifyReport::is_intact);
        Ok(json!({ "spec": spec, "intact": intact, "artifacts": reports }))
    }

    /// Delete every artefact of `spec` from the store.
    ///
    /// # Errors
    ///
    /// The spec does not resolve, or an artefact is not installed.
    pub fn remove(&self, spec: &str) -> Result<Value, HubError> {
        let store = self.store()?;
        let mut removed = Vec::new();
        for reference in resolve_refs(spec)? {
            removed.push(
                store
                    .remove(&reference)
                    .map_err(HubError::model(format!("remove `{reference}`")))?,
            );
        }
        let reclaimed: u64 = removed.iter().map(|m| m.bytes).sum();
        Ok(json!({
            "spec": spec,
            "removed": removed.iter().map(|m| m.reference.to_string()).collect::<Vec<_>>(),
            "reclaimed_bytes": reclaimed,
        }))
    }

    /// Download `spec` (a catalog id or a pinned reference), resumable and digest-checked.
    ///
    /// `on_progress` runs once per received chunk; throttle in the adapter. When `cancel`
    /// completes first the transfer is dropped and [`HubError::Cancelled`] is returned; the
    /// `.part` file stays so the next pull resumes.
    ///
    /// # Errors
    ///
    /// Resolution, transport, digest or filesystem failures, or cancellation.
    pub async fn pull(
        &self,
        spec: &str,
        force: bool,
        cancel: impl Future<Output = ()>,
        mut on_progress: impl FnMut(PullProgress),
    ) -> Result<Value, HubError> {
        let store = self.store()?;
        let downloader = Downloader::new().map_err(HubError::model("build HTTP client"))?;
        let transfer = crate::pull_spec(&store, &downloader, spec, force, |role, p| {
            on_progress(PullProgress {
                spec: spec.to_owned(),
                role: role.to_owned(),
                downloaded: p.downloaded,
                total: p.total,
            });
        });
        let outcomes = match select(pin!(transfer), pin!(cancel)).await {
            Either::Left((result, _)) => {
                result.map_err(HubError::model(format!("pull `{spec}`")))?
            }
            Either::Right(((), _)) => return Err(HubError::Cancelled(spec.to_owned())),
        };
        let transferred: u64 = outcomes
            .iter()
            .filter(|o| o.transferred())
            .map(|o| o.model().bytes)
            .sum();
        let total: u64 = outcomes.iter().map(|o| o.model().bytes).sum();
        Ok(json!({
            "spec": spec,
            "artifacts": outcomes.iter().map(|o| {
                let m = o.model();
                json!({
                    "ref": m.reference.to_string(),
                    "path": m.path,
                    "bytes": m.bytes,
                    "sha256": m.sha256,
                    "format": m.format.as_str(),
                    "outcome": outcome_label(o),
                })
            }).collect::<Vec<_>>(),
            "transferred_bytes": transferred,
            "total_bytes": total,
        }))
    }
}

/// Stable machine-readable word for what a pull did (same words as the CLI).
const fn outcome_label(outcome: &PullOutcome) -> &'static str {
    match outcome {
        PullOutcome::AlreadyPresent(_) => "already-present",
        PullOutcome::Downloaded(_) => "downloaded",
        PullOutcome::Adopted(_) => "adopted",
    }
}

fn resolve_refs(spec: &str) -> Result<Vec<ModelRef>, HubError> {
    let resolved = Catalog::builtin()
        .resolve(spec)
        .map_err(HubError::model(format!("resolve `{spec}`")))?;
    Ok(resolved
        .artifacts()
        .into_iter()
        .map(|(reference, _)| reference)
        .collect())
}

fn parse_task(raw: &str) -> Result<ModelTask, HubError> {
    ModelTask::from_str_opt(raw).ok_or_else(|| {
        let valid: Vec<&str> = ModelTask::all().iter().map(|t| t.as_str()).collect();
        HubError::Invalid(format!(
            "unknown task `{raw}` (expected one of: {})",
            valid.join(", ")
        ))
    })
}

fn parse_speed(raw: &str) -> Result<SpeedTier, HubError> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "fast" => Ok(SpeedTier::Fast),
        "balanced" => Ok(SpeedTier::Balanced),
        "quality" => Ok(SpeedTier::Quality),
        other => Err(HubError::Invalid(format!(
            "unknown preference `{other}` (expected one of: fast, balanced, quality)"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_task_lists_valid_ones() {
        let error = ModelHub::new().catalog(Some("nonsense")).unwrap_err();
        assert!(error.to_string().contains("expected one of"));
    }

    #[test]
    fn preference_is_case_insensitive() {
        assert!(matches!(parse_speed(" Fast "), Ok(SpeedTier::Fast)));
        assert!(parse_speed("slow").is_err());
    }

    #[test]
    fn empty_store_lists_nothing_under_an_explicit_root() {
        let dir = tempfile::tempdir().unwrap();
        let hub = ModelHub::with_root(dir.path());
        let listing = hub.installed(None).unwrap();
        assert_eq!(listing["count"], 0);
        assert_eq!(hub.store_root().unwrap(), dir.path());
    }

    #[test]
    fn catalog_is_not_empty_and_counts_match() {
        let catalog = ModelHub::new().catalog(None).unwrap();
        let entries = catalog["entries"].as_array().unwrap();
        assert!(!entries.is_empty());
        assert_eq!(catalog["count"], entries.len());
    }
}
