// SPDX-License-Identifier: Apache-2.0
//! Unattended candidate training when a gold set and input are ready.

use std::{
    env,
    ffi::OsString,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use aphrody_agent_home::SyncSnapshot;

use crate::{TrainKind, TrainingJob, run_training_job};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct Config {
    version: u8,
    kind: TrainKind,
    input_path: PathBuf,
    gold_path: PathBuf,
    base_model: Option<String>,
    #[serde(default = "default_steps")]
    steps: u64,
    #[serde(default)]
    allow_cpu: bool,
}

const fn default_steps() -> u64 {
    10
}

#[derive(Serialize, Deserialize)]
struct State {
    revision: String,
    config_hash: String,
    input_hash: String,
    job_id: String,
}

fn hash_input(path: &Path, hasher: &mut blake3::Hasher) -> Result<(), Box<dyn std::error::Error>> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Err(format!("training input contains a symlink: {}", path.display()).into());
    }
    hasher.update(path.to_string_lossy().as_bytes());
    if metadata.is_dir() {
        let mut children = fs::read_dir(path)?
            .map(|entry| entry.map(|item| item.path()))
            .collect::<Result<Vec<_>, _>>()?;
        children.sort();
        for child in children {
            hash_input(&child, hasher)?;
        }
    } else if metadata.is_file() {
        let mut file = fs::File::open(path)?;
        let mut buffer = [0_u8; 65_536];
        loop {
            let size = file.read(&mut buffer)?;
            if size == 0 {
                break;
            }
            hasher.update(&buffer[..size]);
        }
    } else {
        return Err(format!(
            "training input is not a regular file or directory: {}",
            path.display()
        )
        .into());
    }
    Ok(())
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env::var("APHRODY_ROOT")?);
    let workspace = PathBuf::from(env::var("APHRODY_AGENT_HOME")?);
    let config_path = PathBuf::from(env::var("APHRODY_AGENT_TRAIN_CONFIG")?);
    let state_path = PathBuf::from(env::var("APHRODY_AGENT_TRAIN_STATE")?);
    if !config_path.is_file() {
        println!("{}", serde_json::json!({"training":"waiting_for_config"}));
        return Ok(());
    }
    let config_bytes = fs::read(&config_path)?;
    let config: Config = serde_json::from_slice(&config_bytes)?;
    if config.version != 1 || matches!(config.kind, TrainKind::DryRun) {
        return Err("training config requires version 1 and a real workload".into());
    }
    if !config.input_path.exists() || !config.gold_path.is_file() {
        println!(
            "{}",
            serde_json::json!({"training":"waiting_for_input_or_gold"})
        );
        return Ok(());
    }
    if matches!(config.kind, TrainKind::Lora)
        && config
            .base_model
            .as_ref()
            .is_none_or(|path| !std::path::Path::new(path).exists())
    {
        println!(
            "{}",
            serde_json::json!({"training":"waiting_for_base_model"})
        );
        return Ok(());
    }
    let snapshot = SyncSnapshot::capture(&workspace)?;
    let config_hash = blake3::hash(&config_bytes).to_hex().to_string();
    let mut input_hasher = blake3::Hasher::new();
    hash_input(&config.input_path, &mut input_hasher)?;
    hash_input(&config.gold_path, &mut input_hasher)?;
    let input_hash = input_hasher.finalize().to_hex().to_string();
    if let Ok(bytes) = fs::read(&state_path)
        && let Ok(previous) = serde_json::from_slice::<State>(&bytes)
        && previous.revision == snapshot.revision
        && previous.config_hash == config_hash
        && previous.input_hash == input_hash
    {
        println!(
            "{}",
            serde_json::json!({"training":"unchanged","job_id":previous.job_id})
        );
        return Ok(());
    }
    let job_id = format!(
        "unattended-{}-{}-{}",
        config.kind.as_str(),
        &snapshot.revision[..8],
        &input_hash[..8]
    );
    let state_dir = root.join(".aphrody/train/unattended");
    let output = state_dir.join("jobs").join(&job_id);
    let mut job = TrainingJob::new(&job_id, config.kind, output);
    job.input_path = Some(config.input_path);
    job.gold_path = Some(config.gold_path);
    job.base_model = config.base_model;
    job.steps = config.steps;
    job.allow_cpu = config.allow_cpu;
    let locks_dir = root.join(".aphrody/locks");
    fs::create_dir_all(&locks_dir)?;
    let outcome = run_training_job(&job, &root.join("aphrody"), &locks_dir).await?;
    let mut after_hasher = blake3::Hasher::new();
    hash_input(
        job.input_path.as_ref().expect("validated input"),
        &mut after_hasher,
    )?;
    hash_input(
        job.gold_path.as_ref().expect("validated gold"),
        &mut after_hasher,
    )?;
    if after_hasher.finalize().to_hex().as_str() != input_hash {
        return Err("training input changed during the job; candidate was not accepted".into());
    }
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let state = State {
        revision: snapshot.revision,
        config_hash,
        input_hash,
        job_id,
    };
    let temp = state_path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(&state)?)?;
    fs::rename(temp, state_path)?;
    println!(
        "{}",
        serde_json::json!({"training":"candidate_complete","job_id":state.job_id,"artifacts":outcome.artifacts.len(),"eval_metrics":outcome.eval_metrics})
    );
    Ok(())
}

/// Entry point of the former `aphrody-agent-train` binary, now reached through the `aphrody`
/// multi-call binary. `args[0]` is the program name (argv convention); the job is configured
/// through the environment, so the arguments are ignored. Returns the process exit code.
#[must_use]
pub fn cli_main(_args: Vec<OsString>) -> i32 {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("aphrody-agent-train: runtime: {error}");
            return 1;
        }
    };
    match runtime.block_on(run()) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("aphrody-agent-train: {error}");
            1
        }
    }
}
