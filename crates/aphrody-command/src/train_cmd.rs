// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! CLI commands for machine learning training, fine-tuning, and model promotion (P10).

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use aphrody_train::{
    PromoteCriteria, PromoteVerdict, Registry, TrainKind, TrainingJob, acquire_training_lease,
    evaluate_candidate, find_python_train_project, register_promoted_model, run_training_job,
};
use clap::{Args, Subcommand, ValueEnum};
use miette::{IntoDiagnostic, Result};

#[derive(Debug, Args)]
pub(crate) struct TrainArgs {
    #[command(subcommand)]
    action: TrainAction,
}

#[derive(Debug, Subcommand)]
enum TrainAction {
    /// Show training status, GPU lock availability, and active jobs.
    Status,
    /// Test acquiring the exclusive GPU training lease (preempts llama-server).
    Lease {
        /// Hold the lease for the given number of seconds before releasing.
        #[arg(long, default_value_t = 5)]
        seconds: u64,
    },
    /// Run a training or fine-tuning job.
    Run {
        /// Kind of training job to execute.
        #[arg(long, value_enum, default_value_t = JobKind::DryRun)]
        kind: JobKind,
        /// Unique job identifier.
        #[arg(long)]
        id: Option<String>,
        /// Number of training steps.
        #[arg(long, default_value_t = 10)]
        steps: usize,
        /// Allow CPU fallback if CUDA is unavailable.
        #[arg(long)]
        allow_cpu: bool,
        /// Output directory for artifacts and events.jsonl.
        #[arg(long)]
        out_dir: Option<PathBuf>,
        /// Input chunks, triples, or rollout directory, depending on kind.
        #[arg(long)]
        input: Option<PathBuf>,
        /// Untouched gold JSONL used by triples and rollout dataset guards.
        #[arg(long)]
        gold: Option<PathBuf>,
        /// Base model for embed, rerank, or LoRA training.
        #[arg(long)]
        base_model: Option<String>,
    },
    /// Apply the training registry migrations (schema `training`) over the direct
    /// `APHRODY_TRAINING_DATABASE_URL`.
    RegistryMigrate,
    /// Gate a candidate on measured shadow-index A/B scores, install it in the
    /// model store when it passes, and record the verdict in the registry.
    Promote {
        /// Path to the candidate model artifact file.
        #[arg(long)]
        artifact: PathBuf,
        /// Target model family name (e.g. "multilingual-e5-small-finetuned").
        #[arg(long)]
        name: String,
        /// JSON evaluation report measured on the untouched gold set against the
        /// shadow index: `{"baseline":{"recall_at_5":f,"tags":{..}},"candidate":{..}}`.
        #[arg(long)]
        eval: PathBuf,
        /// Registry kind of the promoted artifact (e.g. `embed`, `rerank`).
        #[arg(long, default_value = "embed")]
        kind: String,
        /// Registry artifact id of the candidate; when set, the verdict is
        /// recorded in the training registry.
        #[arg(long)]
        artifact_id: Option<String>,
        /// Registry artifact id of the baseline.
        #[arg(long)]
        baseline_artifact_id: Option<String>,
        /// Minimum Recall@5 improvement.
        #[arg(long, default_value_t = 0.01)]
        min_delta: f64,
        /// Maximum per-tag regression.
        #[arg(long, default_value_t = 0.03)]
        max_tag_regression: f64,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum JobKind {
    DryRun,
    Triples,
    Embed,
    Rerank,
    Lora,
    DatasetRollouts,
    DatasetDpo,
}

impl From<JobKind> for TrainKind {
    fn from(kind: JobKind) -> Self {
        match kind {
            JobKind::DryRun => TrainKind::DryRun,
            JobKind::Triples => TrainKind::Triples,
            JobKind::Embed => TrainKind::Embed,
            JobKind::Rerank => TrainKind::Rerank,
            JobKind::Lora => TrainKind::Lora,
            JobKind::DatasetRollouts => TrainKind::DatasetRollouts,
            JobKind::DatasetDpo => TrainKind::DatasetDpo,
        }
    }
}

/// Measured scores of one side of the shadow-index A/B evaluation.
#[derive(Debug, serde::Deserialize)]
struct EvalSide {
    recall_at_5: f64,
    tags: BTreeMap<String, f64>,
}

/// Shadow-index A/B evaluation report on the untouched gold set.
#[derive(Debug, serde::Deserialize)]
struct EvalReport {
    baseline: EvalSide,
    candidate: EvalSide,
}

struct PromoteRequest<'a> {
    artifact: &'a Path,
    name: &'a str,
    eval: &'a Path,
    kind: &'a str,
    artifact_id: Option<&'a str>,
    baseline_artifact_id: Option<&'a str>,
    criteria: PromoteCriteria,
}

fn load_eval_report(path: &Path) -> Result<EvalReport> {
    let bytes = std::fs::read(path)
        .map_err(|e| miette::miette!("read evaluation report {}: {e}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|e| miette::miette!("parse evaluation report {}: {e}", path.display()))
}

async fn promote(req: PromoteRequest<'_>) -> Result<()> {
    let report = load_eval_report(req.eval)?;
    let verdict = evaluate_candidate(
        report.baseline.recall_at_5,
        report.candidate.recall_at_5,
        &report.baseline.tags,
        &report.candidate.tags,
        req.artifact,
        &req.criteria,
    );

    let mut summary = serde_json::json!({
        "name": req.name,
        "kind": req.kind,
        "artifact": req.artifact.display().to_string(),
    });
    match &verdict {
        PromoteVerdict::Promoted {
            model_id,
            delta_recall_at_5,
            sha256,
            ..
        } => {
            let store = aphrody_models::ModelStore::open()
                .map_err(|e| miette::miette!("open model store: {e}"))?;
            let installed = register_promoted_model(&store, req.artifact)
                .map_err(|e| miette::miette!("install promoted model `{}`: {e}", req.name))?;
            summary["verdict"] = "promoted".into();
            summary["model_id"] = model_id.clone().into();
            summary["delta_recall_at_5"] = (*delta_recall_at_5).into();
            summary["sha256"] = sha256.clone().into();
            summary["installed"] = format!("{installed:?}").into();
        }
        PromoteVerdict::Rejected {
            reason,
            delta_recall_at_5,
            max_regression_observed,
        } => {
            summary["verdict"] = "rejected".into();
            summary["reason"] = reason.clone().into();
            summary["delta_recall_at_5"] = (*delta_recall_at_5).into();
            summary["max_regression_observed"] = (*max_regression_observed).into();
        }
    }

    if let Some(artifact_id) = req.artifact_id {
        let registry = Registry::from_env()
            .map_err(|e| miette::miette!("open training registry: {e}"))?
            .ok_or_else(|| {
                miette::miette!("--artifact-id given but APHRODY_TRAINING_DATABASE_URL is not set")
            })?;
        let decided_by = std::env::var("USERNAME")
            .or_else(|_| std::env::var("USER"))
            .unwrap_or_else(|_| "aphrody-train-cli".to_owned());
        let promotion_id = registry
            .record_verdict(
                req.kind,
                req.name,
                artifact_id,
                req.baseline_artifact_id,
                &verdict,
                &decided_by,
            )
            .await
            .map_err(|e| miette::miette!("record promotion verdict: {e}"))?;
        summary["promotion_id"] = promotion_id.into();
    }

    println!(
        "{}",
        serde_json::to_string_pretty(&summary).into_diagnostic()?
    );
    if verdict.is_promoted() {
        Ok(())
    } else {
        Err(miette::miette!("Model `{}` was not promoted", req.name))
    }
}

pub(crate) async fn run(args: TrainArgs) -> Result<()> {
    if let TrainAction::Promote {
        artifact,
        name,
        eval,
        kind,
        artifact_id,
        baseline_artifact_id,
        min_delta,
        max_tag_regression,
    } = &args.action
    {
        return promote(PromoteRequest {
            artifact,
            name,
            eval,
            kind,
            artifact_id: artifact_id.as_deref(),
            baseline_artifact_id: baseline_artifact_id.as_deref(),
            criteria: PromoteCriteria {
                min_delta_recall_at_5: *min_delta,
                max_tag_regression: *max_tag_regression,
            },
        })
        .await;
    }
    if matches!(args.action, TrainAction::RegistryMigrate) {
        let report = Registry::migrate_from_env()
            .await
            .map_err(|e| miette::miette!("Training registry migration failed: {e}"))?
            .ok_or_else(|| {
                miette::miette!("APHRODY_TRAINING_DATABASE_URL is not set; nothing to migrate")
            })?;
        let applied: Vec<String> = report
            .applied
            .iter()
            .map(|(v, name)| format!("{v:04}_{name}"))
            .collect();
        let summary = serde_json::json!({
            "applied": applied,
            "already_applied": report.already_applied,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&summary).into_diagnostic()?
        );
        return Ok(());
    }
    let state_dir = aphrody_models::paths::state_dir().into_diagnostic()?;
    let locks_dir = state_dir.join("locks");
    std::fs::create_dir_all(&locks_dir).into_diagnostic()?;

    match args.action {
        TrainAction::Status => {
            let gpu_lock = locks_dir.join("gpu.lock");
            let is_locked = gpu_lock.exists();
            let repo_root = std::env::current_dir().into_diagnostic()?;
            let py_root = find_python_train_project(&repo_root);
            let py_train_exists = py_root
                .join("packages/ai/py/aphrody-train/pyproject.toml")
                .is_file();

            let status = serde_json::json!({
                "gpu_lock_active": is_locked,
                "locks_dir": locks_dir.display().to_string(),
                "python_train_project": py_train_exists,
                "python_workspace": py_root.display().to_string(),
                "state_dir": state_dir.display().to_string(),
            });
            println!(
                "{}",
                serde_json::to_string_pretty(&status).into_diagnostic()?
            );
        }
        TrainAction::Lease { seconds } => {
            println!("Acquiring exclusive GPU training lease...");
            let lease = acquire_training_lease(
                &locks_dir,
                "train-cli-probe",
                std::time::Duration::from_secs(seconds),
            )
            .map_err(|e| miette::miette!("Failed to acquire GPU lease: {e}"))?;
            println!("GPU lease acquired successfully. Holding for {seconds} seconds...");
            tokio::time::sleep(tokio::time::Duration::from_secs(seconds)).await;
            drop(lease);
            println!("GPU lease released.");
        }
        TrainAction::Run {
            kind,
            id,
            steps,
            allow_cpu,
            out_dir,
            input,
            gold,
            base_model,
        } => {
            let job_id = id.unwrap_or_else(|| format!("train-{}", chrono::Utc::now().timestamp()));
            let out = out_dir.unwrap_or_else(|| state_dir.join("train").join(&job_id));
            std::fs::create_dir_all(&out).into_diagnostic()?;

            let mut job = TrainingJob::new(&job_id, kind.into(), &out);
            job.steps = steps as u64;
            job.allow_cpu = allow_cpu;
            job.input_path = input;
            if let Some(path) = &job.input_path {
                println!("Input: {}", path.display());
            }
            job.gold_path = gold;
            job.base_model = base_model;

            let repo_root = std::env::current_dir().into_diagnostic()?;
            println!("Starting training job `{job_id}` (kind={kind:?}, steps={steps})...");

            let outcome = run_training_job(&job, &repo_root, &locks_dir)
                .await
                .map_err(|e| miette::miette!("Training job failed: {e}"))?;

            println!(
                "Job `{}` completed successfully. Emitted {} artifacts.",
                outcome.job_id,
                outcome.artifacts.len()
            );
            for (name, path, sha256) in &outcome.artifacts {
                println!("  - {name}: {} (sha256: {})", path.display(), sha256);
            }
        }
        TrainAction::Promote { .. } => unreachable!("promotion was refused before state access"),
        TrainAction::RegistryMigrate => {
            unreachable!("registry migration returned before state access")
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn promote_without_eval_report_fails_before_install() {
        let temp = tempfile::tempdir().unwrap();
        let args = TrainArgs {
            action: TrainAction::Promote {
                artifact: temp.path().join("candidate.onnx"),
                name: "candidate".to_owned(),
                eval: temp.path().join("missing-eval.json"),
                kind: "embed".to_owned(),
                artifact_id: None,
                baseline_artifact_id: None,
                min_delta: 0.01,
                max_tag_regression: 0.03,
            },
        };
        let error = run(args).await.unwrap_err().to_string();
        assert!(error.contains("read evaluation report"));
    }
}
