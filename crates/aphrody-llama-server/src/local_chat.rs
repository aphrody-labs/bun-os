// SPDX-License-Identifier: Apache-2.0
//! A local chat model with its LoRA adapters, provisioned into a caller-owned
//! directory and served by a supervised `llama-server`.
//!
//! This is the path a desktop application takes (a bundled application ships it):
//!
//! 1. [`provision_chat`] makes the base GGUF and every adapter present in a model store rooted
//!    where the caller says (`<home>/models`), from catalog ids (the built-in catalog of
//!    `aphrody-models`, or a catalog the product declares in the same schema) or pinned
//!    references, each checked against its SHA-256;
//! 2. [`launch_chat`] reads the GGUF facts, probes the installed `llama-server`, plans the launch
//!    for this machine and starts (or attaches to) the chat daemon under the caller's state
//!    directory. The adapters are loaded inactive and given their scale once the server is up,
//!    so [`ChatEndpoint::lora`] reports what the server actually applies.

use std::path::{Path, PathBuf};

use aphrody_models::{
    Catalog, Downloader, ModelError, ModelRef, ModelStore, Progress, PullOptions, Resolved,
};
use serde::Serialize;

use crate::{
    Budget, DaemonCommand, Endpoint, EnsureOptions, LoraAdapter, LoraStatus, ManagedError,
    ModelFacts, Plan, PlanRequest, Role, ServerCapabilities, StateDirs, Supervisor,
};

/// Base model used when the caller names none: the small chat role of the catalog.
pub const DEFAULT_CHAT_MODEL: &str = aphrody_models::LocalRole::Small.default_model();

/// Catalog file roles that carry adapter weights.
const LORA_ROLES: &[&str] = &["lora", "adapter"];

/// One artefact to make present: a catalog id or a model reference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactSpec {
    /// Catalog id (declared catalog first, then the built-in one) or reference
    /// (`hf:owner/repo/file@rev`, `https://…`, `file:/path`).
    pub spec: String,
    /// Expected SHA-256 for a raw reference. A catalog entry carries its own.
    pub sha256: Option<String>,
}

impl ArtifactSpec {
    /// A spec without a caller-side digest.
    #[must_use]
    pub fn new(spec: impl Into<String>) -> Self {
        Self {
            spec: spec.into(),
            sha256: None,
        }
    }
}

/// An adapter to apply on top of the base model.
#[derive(Debug, Clone, PartialEq)]
pub struct LoraSpec {
    /// Where the adapter comes from.
    pub artifact: ArtifactSpec,
    /// Scale applied once the server is up (`1.0` = fully active).
    pub scale: f32,
}

/// What [`provision_chat`] must make present.
#[derive(Debug, Clone, Default)]
pub struct ChatProvisionRequest {
    /// Root of the model store (`<home>/models`); `None` uses the Aphrody store.
    pub models_dir: Option<PathBuf>,
    /// Catalog declared by the product, searched before the built-in one.
    pub declared: Option<Catalog>,
    /// Base model; `None` selects [`DEFAULT_CHAT_MODEL`].
    pub model: Option<ArtifactSpec>,
    /// Adapters, in load order.
    pub lora: Vec<LoraSpec>,
    /// Download again even when the bytes are present and intact.
    pub force: bool,
}

/// Progress of one artefact transfer.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProvisionProgress {
    /// `weights`, `mmproj`, `lora`, ...
    pub role: String,
    /// The spec being provisioned.
    pub spec: String,
    /// Bytes on disk so far (resumed prefix included).
    pub downloaded: u64,
    /// Total size, when known.
    pub total: Option<u64>,
}

/// One artefact made present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProvisionedArtifact {
    /// `weights`, `mmproj`, `lora`, ...
    pub role: String,
    /// The spec it was resolved from.
    pub spec: String,
    /// Catalog id, when it came from a catalog.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
    /// Canonical reference.
    pub reference: String,
    /// Absolute path on this machine.
    pub path: PathBuf,
    /// SHA-256 of the bytes on disk.
    pub sha256: String,
    /// Size in bytes.
    pub bytes: u64,
    /// Whether bytes crossed the network during this call.
    pub transferred: bool,
}

/// The chat model, ready to launch.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProvisionedChat {
    /// Name the API reports (the base spec).
    pub model_id: String,
    /// Base GGUF weights.
    pub weights: PathBuf,
    /// Vision projector, when the entry has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mmproj: Option<PathBuf>,
    /// Adapters with their scale, in load order.
    pub lora: Vec<LoraAdapter>,
    /// Every artefact, base first.
    pub artifacts: Vec<ProvisionedArtifact>,
}

/// Make the base model and its adapters present in the model store.
///
/// Artefacts already present and intact are not transferred again; an
/// interrupted transfer resumes. A `file:` reference is used in place (an
/// adapter shipped by an installer) after its digest is checked.
///
/// # Errors
///
/// [`ManagedError::Model`] on resolution, transfer, digest or store failure;
/// [`ManagedError::MissingWeights`] when a spec resolves to no usable file.
pub async fn provision_chat(
    request: &ChatProvisionRequest,
    mut on_progress: impl FnMut(&ProvisionProgress),
) -> Result<ProvisionedChat, ManagedError> {
    let store = match &request.models_dir {
        Some(root) => {
            std::fs::create_dir_all(root)?;
            ModelStore::with_root(root)?
        }
        None => ModelStore::open()?,
    };
    let downloader = Downloader::new()?;
    let builtin = Catalog::builtin();
    let declared = request.declared.as_ref();

    let base = request
        .model
        .clone()
        .unwrap_or_else(|| ArtifactSpec::new(DEFAULT_CHAT_MODEL));
    let resolved = builtin.resolve_with(declared, &base.spec)?;
    let base_files = files_of(&resolved, &base, None);
    let mut artifacts = Vec::new();
    for (role, reference, sha256) in base_files {
        let artifact = pull_one(
            &store,
            &downloader,
            &resolved,
            &base.spec,
            &role,
            &reference,
            sha256,
            request.force,
            &mut on_progress,
        )
        .await?;
        artifacts.push(artifact);
    }
    let weights = artifacts
        .iter()
        .find(|artifact| artifact.role == "weights")
        .or_else(|| artifacts.first())
        .map(|artifact| artifact.path.clone())
        .ok_or_else(|| ManagedError::MissingWeights {
            model: base.spec.clone(),
        })?;
    let mmproj = artifacts
        .iter()
        .find(|artifact| artifact.role == "mmproj")
        .map(|artifact| artifact.path.clone());

    let mut lora = Vec::with_capacity(request.lora.len());
    for adapter in &request.lora {
        let resolved = builtin.resolve_with(declared, &adapter.artifact.spec)?;
        let files = files_of(&resolved, &adapter.artifact, Some(LORA_ROLES));
        let Some((role, reference, sha256)) = files.into_iter().next() else {
            return Err(ManagedError::MissingWeights {
                model: adapter.artifact.spec.clone(),
            });
        };
        let artifact = pull_one(
            &store,
            &downloader,
            &resolved,
            &adapter.artifact.spec,
            &role,
            &reference,
            sha256,
            request.force,
            &mut on_progress,
        )
        .await?;
        lora.push(LoraAdapter {
            path: artifact.path.clone(),
            scale: adapter.scale,
        });
        artifacts.push(artifact);
    }

    Ok(ProvisionedChat {
        model_id: base.spec,
        weights,
        mmproj,
        lora,
        artifacts,
    })
}

/// Whether every artefact of `request` is already on disk, without hashing or
/// downloading anything (what a model listing asks before offering a model).
///
/// # Errors
///
/// [`ManagedError::Model`] when a spec does not resolve or the store cannot be opened.
pub fn chat_present(request: &ChatProvisionRequest) -> Result<bool, ManagedError> {
    let store = match &request.models_dir {
        Some(root) if !root.is_dir() => return Ok(false),
        Some(root) => ModelStore::with_root(root)?,
        None => ModelStore::open()?,
    };
    let builtin = Catalog::builtin();
    let declared = request.declared.as_ref();
    let base = request
        .model
        .clone()
        .unwrap_or_else(|| ArtifactSpec::new(DEFAULT_CHAT_MODEL));
    let mut wanted = files_of(&builtin.resolve_with(declared, &base.spec)?, &base, None);
    for adapter in &request.lora {
        let resolved = builtin.resolve_with(declared, &adapter.artifact.spec)?;
        wanted.extend(
            files_of(&resolved, &adapter.artifact, Some(LORA_ROLES))
                .into_iter()
                .take(1),
        );
    }
    Ok(wanted.iter().all(|(_, reference, _)| match reference {
        ModelRef::Local(path) => path.is_file(),
        other => store.path_for(other).is_file(),
    }))
}

/// The files a resolved spec stands for, as `(role, reference, sha256)`.
///
/// `only` keeps the catalog files of those roles (the adapter of an entry that
/// also lists its base); when none match, the primary file is used.
fn files_of(
    resolved: &Resolved<'_>,
    spec: &ArtifactSpec,
    only: Option<&[&str]>,
) -> Vec<(String, ModelRef, Option<String>)> {
    match resolved {
        Resolved::Catalog(entry) => {
            let selected: Vec<_> = entry
                .files
                .iter()
                .filter(|file| only.is_none_or(|roles| roles.contains(&file.role.as_str())))
                .map(|file| {
                    (
                        file.role.clone(),
                        file.reference.clone(),
                        file.sha256.clone(),
                    )
                })
                .collect();
            if selected.is_empty() {
                entry
                    .primary()
                    .map(|file| {
                        (
                            file.role.clone(),
                            file.reference.clone(),
                            file.sha256.clone(),
                        )
                    })
                    .into_iter()
                    .collect()
            } else {
                selected
            }
        }
        Resolved::Direct(reference) => {
            let role = if only.is_some() { "lora" } else { "weights" };
            vec![(role.to_owned(), reference.clone(), spec.sha256.clone())]
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn pull_one(
    store: &ModelStore,
    downloader: &Downloader,
    resolved: &Resolved<'_>,
    spec: &str,
    role: &str,
    reference: &ModelRef,
    sha256: Option<String>,
    force: bool,
    on_progress: &mut impl FnMut(&ProvisionProgress),
) -> Result<ProvisionedArtifact, ManagedError> {
    let expected = sha256.map(|digest| aphrody_models::digest::normalize_digest(&digest));
    let options = PullOptions {
        expected_sha256: expected.clone(),
        force,
        catalog_id: resolved.catalog_id().map(ToOwned::to_owned),
    };
    let mut throttle = Throttle::default();
    let outcome = downloader
        .pull(store, reference, &options, |progress: Progress| {
            if throttle.due(progress) {
                on_progress(&ProvisionProgress {
                    role: role.to_owned(),
                    spec: spec.to_owned(),
                    downloaded: progress.downloaded,
                    total: progress.total,
                });
            }
        })
        .await?;
    let model = outcome.model();
    // The downloader checks transferred bytes; an adopted local file is checked here.
    if let Some(expected) = expected
        && model.sha256 != expected
    {
        return Err(ModelError::ChecksumMismatch {
            model: reference.to_string(),
            expected,
            actual: model.sha256.clone(),
        }
        .into());
    }
    Ok(ProvisionedArtifact {
        role: role.to_owned(),
        spec: spec.to_owned(),
        catalog_id: resolved.catalog_id().map(ToOwned::to_owned),
        reference: reference.to_string(),
        path: model.path.clone(),
        sha256: model.sha256.clone(),
        bytes: model.bytes,
        transferred: outcome.transferred(),
    })
}

/// Report a transfer about every percent (or every 16 MiB when the size is unknown).
#[derive(Default)]
struct Throttle {
    last: Option<u64>,
}

impl Throttle {
    fn due(&mut self, progress: Progress) -> bool {
        let step = progress
            .total
            .map_or(16 << 20, |total| (total / 100).max(1));
        let due = self
            .last
            .is_none_or(|last| progress.downloaded >= last + step)
            || progress.total == Some(progress.downloaded);
        if due {
            self.last = Some(progress.downloaded);
        }
        due
    }
}

/// Launch knobs of the chat server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatLaunchOptions {
    /// Context size; `None` uses the chat default capped by the model.
    pub ctx: Option<u32>,
    /// Concurrent request slots.
    pub parallel: u8,
    /// Device memory left free, in MiB.
    pub margin_mib: u32,
    /// Name the API reports; `None` uses the base spec.
    pub alias: Option<String>,
    /// Raw arguments appended last.
    pub extra_args: Vec<String>,
    /// Timeouts and idle policy.
    pub ensure: EnsureOptions,
}

impl Default for ChatLaunchOptions {
    fn default() -> Self {
        Self {
            ctx: None,
            parallel: 1,
            margin_mib: crate::DEFAULT_MARGIN_MIB,
            alias: None,
            extra_args: Vec::new(),
            ensure: EnsureOptions::default(),
        }
    }
}

/// A ready chat server.
#[derive(Debug, Clone, PartialEq)]
pub struct ChatEndpoint {
    /// The plan it was started with.
    pub plan: Plan,
    /// The supervised instance.
    pub endpoint: Endpoint,
    /// Adapters as the server reports them (scale actually applied); empty
    /// when the build has no adapter endpoint.
    pub lora: Vec<LoraStatus>,
}

/// Start the chat daemon for a provisioned model under `state_root`, or attach
/// to the running instance with the same spec.
///
/// # Errors
///
/// [`ManagedError`] when the GGUF cannot be read, the server build cannot be
/// probed, it lacks a feature the plan requires, or the daemon fails to start.
pub async fn launch_chat(
    binary: &Path,
    state_root: &Path,
    daemon: DaemonCommand,
    model: &ProvisionedChat,
    options: &ChatLaunchOptions,
) -> Result<ChatEndpoint, ManagedError> {
    let probe_binary = binary.to_path_buf();
    let weights = model.weights.clone();
    let (facts, capabilities, budget) = tokio::task::spawn_blocking(move || {
        let facts = ModelFacts::read(&weights)?;
        let capabilities = ServerCapabilities::probe(&probe_binary)?;
        let budget = Budget::from_profile(&aphrody_models::accel::probe());
        Ok::<_, ManagedError>((facts, capabilities, budget))
    })
    .await
    .map_err(|error| ManagedError::Task(error.to_string()))??;

    let alias = options
        .alias
        .clone()
        .unwrap_or_else(|| model.model_id.clone());
    let mut request = PlanRequest::new(Role::Chat, alias);
    request.ctx = options.ctx;
    request.parallel = options.parallel.max(1);
    request.margin_mib = options.margin_mib;
    request.mmproj.clone_from(&model.mmproj);
    request.lora.clone_from(&model.lora);
    request.extra_args.clone_from(&options.extra_args);
    let plan = crate::plan(&facts, &capabilities, budget, &request);
    plan.spec
        .validate_capabilities(&capabilities)
        .map_err(|reason| ManagedError::Task(reason.to_owned()))?;

    std::fs::create_dir_all(state_root)?;
    let supervisor = Supervisor::new(StateDirs::new(state_root), daemon);
    let endpoint = supervisor.ensure(binary, &plan, options.ensure).await?;
    let lora = if model.lora.is_empty() {
        Vec::new()
    } else {
        endpoint.client().lora_adapters().await.unwrap_or_default()
    };
    Ok(ChatEndpoint {
        plan,
        endpoint,
        lora,
    })
}

/// Find a `llama-server` executable.
///
/// In order: `explicit` (the binary, or a directory holding it or `bin/` with
/// it), `APHRODY_LLAMA_BIN`, `APHRODY_LLAMA_DIR`, the directories `extra_dirs`
/// (each searched directly, under `llama/` and under `bin/`), the newest
/// `llama-*` runtime of the Aphrody runtimes directory, then `PATH`.
#[must_use]
pub fn locate_llama_server(explicit: Option<&Path>, extra_dirs: &[PathBuf]) -> Option<PathBuf> {
    let name = format!("llama-server{}", std::env::consts::EXE_SUFFIX);
    let in_dir = |dir: &Path| {
        [
            dir.join(&name),
            dir.join("bin").join(&name),
            dir.join("llama").join(&name),
        ]
        .into_iter()
        .find(|path| path.is_file())
    };
    let named = |path: &Path| {
        if path.is_file() {
            Some(path.to_path_buf())
        } else {
            in_dir(path)
        }
    };
    if let Some(found) = explicit.and_then(named) {
        return Some(found);
    }
    let from_env = |key: &str| std::env::var_os(key).filter(|value| !value.is_empty());
    if let Some(found) = from_env("APHRODY_LLAMA_BIN").and_then(|v| named(Path::new(&v))) {
        return Some(found);
    }
    if let Some(found) = from_env("APHRODY_LLAMA_DIR").and_then(|v| in_dir(Path::new(&v))) {
        return Some(found);
    }
    if let Some(found) = extra_dirs.iter().find_map(|dir| in_dir(dir)) {
        return Some(found);
    }
    if let Ok(root) = aphrody_models::paths::runtimes_dir()
        && let Ok(entries) = std::fs::read_dir(&root)
    {
        let mut dirs: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_dir()
                    && path
                        .file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with("llama-"))
            })
            .collect();
        dirs.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
        if let Some(found) = dirs.iter().find_map(|dir| in_dir(dir)) {
            return Some(found);
        }
    }
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|dir| dir.join(&name))
            .find(|path| path.is_file())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_chat_model_is_a_catalogued_llama_model() {
        let entry = Catalog::builtin()
            .get(DEFAULT_CHAT_MODEL)
            .expect("catalog entry");
        assert_eq!(entry.backend, aphrody_models::Backend::LlamaCpp);
        assert_eq!(entry.task, aphrody_models::ModelTask::TextGeneration);
    }

    #[test]
    fn raw_adapter_reference_keeps_the_caller_digest() {
        let spec = ArtifactSpec {
            spec: "file:/opt/app/models/adapter.gguf".into(),
            sha256: Some("ab".repeat(32)),
        };
        let resolved = Catalog::builtin().resolve(&spec.spec).unwrap();
        let files = files_of(&resolved, &spec, Some(LORA_ROLES));
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].0, "lora");
        assert_eq!(files[0].2.as_deref(), Some("ab".repeat(32).as_str()));
    }

    #[test]
    fn declared_entry_selects_its_adapter_file() {
        let declared = Catalog::from_json(
            r#"{"version":1,"entries":[{"id":"chat-lora","title":"t","task":"text-generation",
            "backend":"llama-cpp","summary":"s","files":[
              {"role":"weights","ref":"file:/m/base.gguf","sha256":"00"},
              {"role":"lora","ref":"file:/m/lora.gguf","sha256":"11"}],
            "license":{"spdx":"Apache-2.0","url":"https://example.invalid","commercial_use":"permitted"}}]}"#,
            "declared.json",
        )
        .unwrap();
        let spec = ArtifactSpec::new("chat-lora");
        let resolved = Catalog::builtin()
            .resolve_with(Some(&declared), &spec.spec)
            .unwrap();
        let files = files_of(&resolved, &spec, Some(LORA_ROLES));
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].1.to_string(), "file:/m/lora.gguf");
        let base = files_of(&resolved, &spec, None);
        assert_eq!(base.len(), 2);
    }

    #[tokio::test]
    async fn installer_shipped_adapter_is_used_in_place_and_digest_checked() {
        let dir = tempfile::tempdir().unwrap();
        let adapter = dir.path().join("adapter.gguf");
        std::fs::write(&adapter, b"GGUF-adapter").unwrap();
        let good = aphrody_models::digest::sha256_hex(b"GGUF-adapter");
        let store = ModelStore::with_root(dir.path().join("models")).unwrap();
        let downloader = Downloader::new().unwrap();
        let reference = ModelRef::Local(adapter.clone());
        let resolved = Resolved::Direct(reference.clone());
        let ok = pull_one(
            &store,
            &downloader,
            &resolved,
            "file:adapter",
            "lora",
            &reference,
            Some(good.to_uppercase()),
            false,
            &mut |_| {},
        )
        .await
        .unwrap();
        assert_eq!(ok.sha256, good);
        assert!(!ok.transferred);
        let bad = pull_one(
            &store,
            &downloader,
            &resolved,
            "file:adapter",
            "lora",
            &reference,
            Some("0".repeat(64)),
            false,
            &mut |_| {},
        )
        .await;
        assert!(matches!(
            bad,
            Err(ManagedError::Model(ModelError::ChecksumMismatch { .. }))
        ));
    }

    #[test]
    fn throttle_reports_each_percent_and_the_end() {
        let mut throttle = Throttle::default();
        let at = |downloaded| Progress {
            downloaded,
            total: Some(1000),
        };
        assert!(throttle.due(at(1)));
        assert!(!throttle.due(at(5)));
        assert!(throttle.due(at(11)));
        assert!(throttle.due(at(1000)));
    }

    #[test]
    fn explicit_directory_is_searched_for_the_server() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("llama");
        std::fs::create_dir_all(&bin).unwrap();
        let name = format!("llama-server{}", std::env::consts::EXE_SUFFIX);
        std::fs::write(bin.join(&name), b"").unwrap();
        assert_eq!(
            locate_llama_server(Some(dir.path()), &[]),
            Some(bin.join(&name))
        );
        assert_eq!(
            locate_llama_server(None, &[dir.path().to_path_buf()]),
            Some(bin.join(&name))
        );
    }
}
