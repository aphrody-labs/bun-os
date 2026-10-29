// SPDX-License-Identifier: Apache-2.0
//! Tauri adapter for the desktop's Models hub.
//!
//! All model logic (catalog, store, recommendations, verification, resumable SHA-256-checked
//! pulls) lives in the toolkit-free `aphrody-local-ai` crate, which calls `aphrody-models` in
//! process. This module only maps Tauri state, events and commands onto it: no `aphrody model`
//! child process, no CLI output parsing. `pull` streams progress to the webviews as
//! [`PULL_EVENT`]; stopping a pull drops the transfer, and the next pull of the same id resumes
//! from the `.part` file.
//!
//! Hardware facts come from the `aphrody-native` topology probe (RAM, AVX2, CUDA VRAM) and from
//! the in-process `aphrody-models` accelerator probe for GPU names. A value that cannot be
//! probed is `null`, never a guessed default.

use std::{collections::HashMap, path::PathBuf};

use crate::local_ai::{HubError, ModelHub};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

/// Event carrying `{ id, role, downloaded, total }` for every progress step of a pull.
pub const PULL_EVENT: &str = "aphrody://model-pull";

/// Pulls in flight, keyed by catalog id; sending on the channel stops the pull.
#[derive(Default)]
pub struct Pulls(std::sync::Mutex<HashMap<String, oneshot::Sender<()>>>);

impl Pulls {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, oneshot::Sender<()>>> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// File of the vendored store plugin holding the UI preferences (m3/packages/app-ui/src/preferences.ts).
const PREFERENCES_STORE: &str = "preferences.json";

/// The models folder chosen in onboarding (`preferences.modelsDir`), when one is set.
///
/// The hub uses it, and the broker passes it to the in-process app-server as an option
/// (`AppServer::with_models_dir`), so the hub and the agent always see the same store. It is
/// read when the agent starts: a folder chosen later takes effect at the next backend start.
/// Nothing exports it through the process environment.
#[must_use]
pub fn stored_models_dir(app: &AppHandle) -> Option<String> {
    use tauri_plugin_store::StoreExt as _;
    let preferences = app.store(PREFERENCES_STORE).ok()?.get("preferences")?;
    let dir = preferences.get("modelsDir")?.as_str()?.trim();
    (!dir.is_empty()).then(|| dir.to_owned())
}

/// The model hub over the store root the user picked, else the default store.
fn hub(app: &AppHandle) -> ModelHub {
    stored_models_dir(app).map_or_else(ModelHub::new, ModelHub::with_root)
}

fn message(error: &HubError) -> String {
    error.to_string()
}

/// Run a blocking hub call (disk hashing, registry reads, NVML) off the async runtime.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, HubError> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("model task failed: {error}"))?
        .map_err(|error| message(&error))
}

/// The curated catalog.
#[tauri::command]
pub async fn aphrody_model_catalog(app: AppHandle) -> Result<Value, String> {
    let hub = hub(&app);
    blocking(move || hub.catalog(None)).await
}

/// Installed artefacts.
#[tauri::command]
pub async fn aphrody_model_list(app: AppHandle) -> Result<Value, String> {
    let hub = hub(&app);
    blocking(move || hub.installed(None)).await
}

/// Catalog ranked for this machine.
#[tauri::command]
pub async fn aphrody_model_recommend(
    app: AppHandle,
    task: String,
    prefer: String,
) -> Result<Value, String> {
    let hub = hub(&app);
    blocking(move || hub.recommend(&task, &prefer)).await
}

/// Re-hash the installed bytes of `id` against the recorded SHA-256.
#[tauri::command]
pub async fn aphrody_model_verify(app: AppHandle, id: String) -> Result<Value, String> {
    let hub = hub(&app);
    blocking(move || hub.verify(&id)).await
}

/// Delete `id` from the store.
#[tauri::command]
pub async fn aphrody_model_remove(app: AppHandle, id: String) -> Result<Value, String> {
    let hub = hub(&app);
    blocking(move || hub.remove(&id)).await
}

/// The store root in use.
#[tauri::command]
pub async fn aphrody_model_store_root(app: AppHandle) -> Result<String, String> {
    let hub = hub(&app);
    blocking(move || hub.store_root().map(|root| root.display().to_string())).await
}

/// Download `id`, streaming progress as [`PULL_EVENT`].
///
/// Resolves with the pull report once every artefact is on disk and digest-checked.
#[tauri::command]
pub async fn aphrody_model_pull(
    app: AppHandle,
    pulls: State<'_, Pulls>,
    id: String,
    force: Option<bool>,
) -> Result<Value, String> {
    let (cancel, cancelled) = oneshot::channel::<()>();
    {
        let mut running = pulls.lock();
        if running.contains_key(&id) {
            return Err(format!("{id} is already downloading"));
        }
        running.insert(id.clone(), cancel);
    }
    // Progress is throttled to whole percentage points per role: a large transfer delivers tens
    // of thousands of chunks and every event crosses the IPC bridge.
    let mut last: Option<(String, u64)> = None;
    let events = app.clone();
    let result = hub(&app)
        .pull(
            &id,
            force.unwrap_or(false),
            async move {
                // A dropped sender (entry removed without cancelling) must not cancel the pull.
                if cancelled.await.is_err() {
                    std::future::pending::<()>().await;
                }
            },
            |progress| {
                let percent = progress
                    .total
                    .filter(|total| *total > 0)
                    .map_or(0, |total| progress.downloaded.saturating_mul(100) / total);
                let key = (progress.role.clone(), percent);
                if last.as_ref() != Some(&key) {
                    last = Some(key);
                    let _ = events.emit(
                        PULL_EVENT,
                        json!({
                            "id": progress.spec,
                            "role": progress.role,
                            "downloaded": progress.downloaded,
                            "total": progress.total,
                        }),
                    );
                }
            },
        )
        .await;
    pulls.lock().remove(&id);
    result.map_err(|error| message(&error))
}

/// Stop the pull of `id`. Returns whether one was running.
#[tauri::command]
pub fn aphrody_model_cancel(pulls: State<'_, Pulls>, id: String) -> bool {
    pulls
        .lock()
        .remove(&id)
        .is_some_and(|cancel| cancel.send(()).is_ok())
}

/// A probed figure, `null` when the platform reported nothing (the probe's `0`).
fn known(value: u32) -> Value {
    if value == 0 {
        Value::Null
    } else {
        json!(value)
    }
}

/// Host hardware for the Models hub: RAM, AVX2 and CUDA VRAM from the `aphrody-native`
/// topology probe, GPU names and VRAM from the in-process `aphrody-models` accelerator probe.
#[tauri::command]
pub async fn aphrody_hardware_telemetry(app: AppHandle) -> Result<Value, String> {
    let topology =
        tauri::async_runtime::spawn_blocking(aphrody_native::NativePlatform::get_topology)
            .await
            .map_err(|error| format!("hardware probe: {error}"))?;
    let hub = hub(&app);
    let profile = tauri::async_runtime::spawn_blocking(move || hub.hardware())
        .await
        .map_err(|error| format!("hardware probe: {error}"))?;
    let avx2 = if cfg!(any(target_arch = "x86", target_arch = "x86_64")) {
        json!(topology.has_avx2)
    } else {
        Value::Null
    };
    let gpus = serde_json::to_value(&profile.gpus).map_err(|error| error.to_string());
    let (gpus, gpu_error) = match gpus {
        Ok(gpus) => (gpus, Value::Null),
        Err(error) => (Value::Null, json!(error)),
    };
    Ok(json!({
        "cpuThreads": known(topology.cpu_count),
        "memoryTotalMb": known(topology.memory_total_mb),
        "memoryAvailableMb": known(topology.memory_available_mb),
        "avx2": avx2,
        "cudaVramTotalMb": if topology.has_cuda { known(topology.cuda_vram_total_mb) } else { Value::Null },
        "gpus": gpus,
        "gpuError": gpu_error,
    }))
}

/// External model store candidate and detected status.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExternalStoreStatus {
    pub id: String,
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub model_count: Option<usize>,
}

fn resolve_user_home(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .home_dir()
        .ok()
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
}

/// Scan standard external model store directories (Ollama, LM Studio, HuggingFace)
/// without assumptions or mock data.
#[tauri::command]
pub async fn aphrody_model_scan_external(
    app: AppHandle,
) -> Result<Vec<ExternalStoreStatus>, String> {
    let home = resolve_user_home(&app);
    let mut results = Vec::new();

    let candidates = [
        (
            "ollama",
            "Ollama",
            std::env::var("OLLAMA_MODELS").ok().map(PathBuf::from),
            vec![".ollama", "models"],
        ),
        (
            "lm-studio",
            "LM Studio",
            None,
            vec![".cache", "lm-studio", "models"],
        ),
        (
            "huggingface",
            "HuggingFace",
            std::env::var("HF_HOME")
                .ok()
                .map(|p| PathBuf::from(p).join("hub")),
            vec![".cache", "huggingface", "hub"],
        ),
    ];

    for (id, name, env_override, subpath_parts) in candidates {
        let path = if let Some(override_path) = env_override {
            override_path
        } else if let Some(ref h) = home {
            let mut p = h.clone();
            for part in subpath_parts {
                p.push(part);
            }
            p
        } else {
            continue;
        };

        let exists = path.is_dir();
        let model_count = if exists {
            std::fs::read_dir(&path).ok().map(|entries| {
                entries
                    .flatten()
                    .filter(|entry| {
                        let file_name = entry.file_name();
                        let name_str = file_name.to_string_lossy();
                        !name_str.starts_with('.') && !name_str.ends_with(".TAG")
                    })
                    .count()
            })
        } else {
            None
        };

        results.push(ExternalStoreStatus {
            id: id.to_string(),
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            exists,
            model_count,
        });
    }

    Ok(results)
}
