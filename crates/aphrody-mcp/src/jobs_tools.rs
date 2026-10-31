// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! `aphrody_job_submit` / `aphrody_job_status` — the background job queue over
//! MCP, backed by [`aphrody_jobs`].
//!
//! # Submission executes nothing
//!
//! `aphrody_job_submit` writes one row to the `SQLite` queue under
//! `~/.aphrody/jobs/jobs.db` and returns its id. It does not run a handler, it
//! does not download weights, and it does not spawn a worker. That is the
//! whole point of a queue: an MCP call must return in milliseconds, while the
//! work it names may take an hour and must survive the caller going away. A
//! tool that transparently ran the job would reintroduce the timeout it exists
//! to avoid, and would tie the work's lifetime to the client's.
//!
//! Consequence a caller must understand: a submitted job stays `queued` until
//! a worker (`aphrody job run`) claims it. `aphrody_job_status` therefore
//! reports the queue-wide stats alongside the job, so "nothing is happening"
//! is visible rather than mistaken for slowness.
//!
//! # The queue is agnostic about the work
//!
//! `kind` names a handler and `payload` is opaque JSON. Validating `kind`
//! against an enumeration here would mean this crate had to be recompiled for
//! every new task type; instead a job whose kind no worker handles simply
//! stays queued, which [`status`] makes visible.
//!
//! # Platform gating
//!
//! Native-only: the store is a `SQLite` file on a real filesystem.

#![cfg(not(target_arch = "wasm32"))]

use std::path::PathBuf;

use aphrody_jobs::{HostAffinity, JobLogs, JobSpec, JobStore, ListFilter};
use rmcp::schemars::{self, JsonSchema};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Hard cap on a job payload (256 KiB). A payload is an argument list, not a
/// data channel: an image belongs on disk with its path in the payload. The
/// cap also bounds the `SQLite` row, keeping `claim` cheap.
const MAX_PAYLOAD_BYTES: usize = 256 * 1024;

/// Ceiling on `max_attempts`. Retrying forever turns a permanently broken job
/// into an infinite background load.
const MAX_ATTEMPTS_CEILING: u32 = 16;

/// Default number of log lines returned by `aphrody_job_status`.
const DEFAULT_LOG_TAIL: usize = 20;

/// Ceiling on the log tail, so one status call cannot pull a whole run's log
/// through the MCP transport.
const MAX_LOG_TAIL: usize = 500;

/// Placement references existing catalog hosts; it grants no remote authority.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(tag = "mode", content = "hosts", rename_all = "kebab-case")]
pub(crate) enum JobHostAffinity {
    Any,
    Hosts(Vec<String>),
}

/// Input schema for `aphrody_job_submit`.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub(crate) struct JobSubmitRequest {
    /// Handler name, e.g. `transcribe`.
    #[schemars(description = "Handler name the worker dispatches on (e.g. \"ocr\", \
                              \"transcribe\"). The queue is agnostic: an unknown kind stays \
                              queued until a worker registers a handler for it.")]
    pub kind: String,

    /// Optional persistent placement; absent means any capable local worker.
    #[serde(default)]
    pub host_affinity: Option<JobHostAffinity>,

    /// Durable caller intent key (1-256 bytes). Retry with identical arguments after a lost acknowledgement.
    #[serde(default)]
    pub idempotency_key: Option<String>,

    /// Opaque handler arguments. Max 256 KiB serialised.
    #[schemars(
        description = "Handler-specific arguments, opaque JSON object. web-pipeline accepts \
                              {args:[crawl-index|dragon-ball,...]} without aphrody/web prefixes. Max 256 KiB \
                              serialised. Pass large inputs by path, not inline."
    )]
    #[serde(default)]
    pub payload: Option<serde_json::Value>,

    /// Total runs allowed, including the first. 1 means no retry.
    #[schemars(description = "Total runs allowed including the first (1-16, default 1).")]
    #[serde(default)]
    pub max_attempts: Option<u32>,

    /// Higher runs first; ties stay FIFO.
    #[schemars(description = "Scheduling priority; higher runs first, ties stay FIFO. Default 0.")]
    #[serde(default)]
    pub priority: Option<i64>,

    /// RFC 3339 instant before which the job must not start.
    #[schemars(description = "RFC 3339 timestamp; the job is held until then. Optional.")]
    #[serde(default)]
    pub run_after: Option<String>,
}

/// Input schema for `aphrody_job_status`.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub(crate) struct JobStatusRequest {
    /// Job id returned by `aphrody_job_submit`. Omit to list recent jobs.
    #[schemars(description = "Job id to inspect. Omit to list recent jobs instead.")]
    #[serde(default)]
    pub id: Option<String>,

    /// Restrict a listing to one state.
    #[schemars(
        description = "Filter a listing by state: queued, running, succeeded, failed, \
                              cancelled. Ignored when `id` is set."
    )]
    #[serde(default)]
    pub state: Option<String>,

    /// Restrict a listing to one handler kind.
    #[schemars(description = "Filter a listing by handler kind. Ignored when `id` is set.")]
    #[serde(default)]
    pub kind: Option<String>,

    /// Cap on listed rows (1..=200, default 20).
    #[schemars(description = "Max rows returned by a listing (1-200, default 20).")]
    #[serde(default)]
    pub limit: Option<u32>,

    /// Log lines to return for a single job (0..=500, default 20).
    #[schemars(
        description = "Trailing NDJSON log lines to include for a single job (0-500, \
                              default 20). Ignored for listings."
    )]
    #[serde(default)]
    pub log_tail: Option<u32>,
}

/// Cancel a durable job; a running handler stops at its fenced heartbeat.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub(crate) struct JobCancelRequest {
    pub id: String,
}

fn pretty(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

fn error_envelope(code: &str, reason: impl Into<String>) -> String {
    pretty(&json!({ "error": code, "reason": reason.into() }))
}

/// Resolve the `~/.aphrody` root the same way `aphrody-models` does.
///
/// Duplicated rather than imported because the models crate keeps its resolver
/// private, and because the jobs queue must not need a model store to exist
/// before it can accept a submission.
fn aphrody_root() -> Result<PathBuf, String> {
    // Same authority the CLI uses, so `aphrody job list` and the MCP job
    // tools address one queue rather than two.
    aphrody_models::paths::state_dir()
        .map_err(|_| "cannot locate the aphrody state directory: set APHRODY_HOME".to_owned())
}

/// Open the queue, creating `~/.aphrody/jobs/` on first use.
fn open_store() -> Result<(JobStore, JobLogs), String> {
    let root = aphrody_root()?;
    let db = aphrody_jobs::default_db_path(&root);
    if let Some(parent) = db.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let store = JobStore::open(&db).map_err(|e| format!("cannot open {}: {e}", db.display()))?;
    Ok((store, JobLogs::new(aphrody_jobs::default_log_dir(&root))))
}

/// Validate and build the [`JobSpec`] a request describes.
fn build_spec(req: &JobSubmitRequest) -> Result<JobSpec, String> {
    let kind = req.kind.trim();
    if kind.is_empty() {
        return Err("kind must be a non-empty string".to_owned());
    }

    let payload = req.payload.clone().unwrap_or_else(|| json!({}));
    let encoded_len = serde_json::to_string(&payload).map_or(usize::MAX, |s| s.len());
    if encoded_len > MAX_PAYLOAD_BYTES {
        return Err(format!(
            "payload is {encoded_len}B (> max {MAX_PAYLOAD_BYTES}B)"
        ));
    }

    if kind == "web-pipeline" {
        let object = payload
            .as_object()
            .ok_or("web-pipeline payload must be an object")?;
        if object.len() != 1 || !object.contains_key("args") {
            return Err("web-pipeline payload accepts only args".into());
        }
        let args = object["args"]
            .as_array()
            .ok_or("web-pipeline args must be an array")?;
        if args.iter().any(|arg| !arg.is_string())
            || !matches!(
                args.first().and_then(serde_json::Value::as_str),
                Some("crawl-index")
            )
        {
            return Err("web-pipeline args must start with crawl-index".into());
        }
    }
    let mut spec = JobSpec::new(kind, payload);
    if let Some(affinity) = &req.host_affinity {
        spec = spec.with_host_affinity(match affinity {
            JobHostAffinity::Any => HostAffinity::Any,
            JobHostAffinity::Hosts(hosts) => {
                if hosts.is_empty()
                    || hosts.len() > 64
                    || hosts
                        .iter()
                        .any(|host| host.trim().is_empty() || host.len() > 128)
                {
                    return Err(
                        "hosts must contain 1-64 non-empty catalog identities (max 128 bytes each)"
                            .into(),
                    );
                }
                HostAffinity::Hosts(hosts.clone())
            }
        });
    }
    if let Some(key) = &req.idempotency_key {
        if key.trim().is_empty() || key.len() > 256 {
            return Err("idempotency_key must contain 1-256 bytes".into());
        }
        spec = spec.with_idempotency_key(key);
    }
    if let Some(attempts) = req.max_attempts {
        if attempts == 0 || attempts > MAX_ATTEMPTS_CEILING {
            return Err(format!(
                "max_attempts must be in 1..={MAX_ATTEMPTS_CEILING} (got {attempts})"
            ));
        }
        spec = spec.with_max_attempts(attempts);
    }
    if let Some(priority) = req.priority {
        spec = spec.with_priority(priority);
    }
    if let Some(raw) = req.run_after.as_deref() {
        let when = chrono::DateTime::parse_from_rfc3339(raw)
            .map_err(|e| format!("run_after {raw:?} is not RFC 3339: {e}"))?
            .with_timezone(&chrono::Utc);
        spec = spec.run_after(when);
    }
    Ok(spec)
}

fn stats_value(store: &JobStore) -> serde_json::Value {
    store
        .stats()
        .map_or_else(|e| json!({ "error": e.to_string() }), |s| json!(s))
}

/// Dispatch `aphrody_job_submit`.
///
/// Returns the assigned id immediately. Nothing is executed or downloaded.
pub(crate) async fn submit(req: JobSubmitRequest) -> String {
    let spec = match build_spec(&req) {
        Ok(spec) => spec,
        Err(reason) => return error_envelope("JOB_BAD_REQUEST", reason),
    };

    // `rusqlite` is synchronous; a write on the reactor thread would block
    // every other tool sharing this runtime.
    let joined = tokio::task::spawn_blocking(move || {
        let (store, logs) = open_store()?;
        let job = store
            .submit(&spec)
            .map_err(|e| format!("submit failed: {e}"))?;
        let log_path = logs.path_for(&job.id);
        let stats = stats_value(&store);
        let db = store.path().map(|p| p.display().to_string());
        Ok::<_, String>((job, log_path, stats, db))
    })
    .await;

    let (job, log_path, stats, db) = match joined {
        Ok(Ok(tuple)) => tuple,
        Ok(Err(reason)) => return error_envelope("JOB_STORE_ERROR", reason),
        Err(err) => return error_envelope("JOB_INTERNAL", format!("submit task panicked: {err}")),
    };

    pretty(&json!({
        "id": job.id,
        "kind": job.kind,
        "state": job.state.as_str(),
        "priority": job.priority,
        "host_affinity": job.host_affinity,
        "idempotency_key": job.idempotency_key,
        "max_attempts": job.max_attempts,
        "created_at": job.created_at,
        "run_after": job.run_after,
        "log_path": log_path.display().to_string(),
        "db_path": db,
        "queue": stats,
        // Stated on every submission because "queued forever" and "slow" look
        // identical from the client side.
        "note": "queued only; a worker (`aphrody job run`) must be running for it to execute",
    }))
}

/// Dispatch `aphrody_job_status`: one job with its logs, or a filtered listing.
pub(crate) async fn status(req: JobStatusRequest) -> String {
    let state = match req
        .state
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        None => None,
        Some(raw) => match aphrody_jobs::JobState::parse(&raw.to_ascii_lowercase()) {
            Some(state) => Some(state),
            None => {
                return error_envelope(
                    "JOB_BAD_REQUEST",
                    format!(
                        "unknown state {raw:?}; expected queued, running, succeeded, failed or \
                         cancelled"
                    ),
                );
            }
        },
    };
    if let Some(limit) = req.limit
        && (limit == 0 || limit > 200)
    {
        return error_envelope(
            "JOB_BAD_REQUEST",
            format!("limit must be in 1..=200 (got {limit})"),
        );
    }
    let tail = match req.log_tail {
        None => DEFAULT_LOG_TAIL,
        Some(n) if n as usize <= MAX_LOG_TAIL => n as usize,
        Some(n) => {
            return error_envelope(
                "JOB_BAD_REQUEST",
                format!("log_tail must be in 0..={MAX_LOG_TAIL} (got {n})"),
            );
        }
    };

    let id = req
        .id
        .clone()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());
    let kind = req.kind.clone();
    let limit = req.limit.unwrap_or(20);

    let joined = tokio::task::spawn_blocking(move || {
        let (store, logs) = open_store()?;
        let stats = stats_value(&store);

        if let Some(id) = id {
            let job = store.get(&id).map_err(|e| format!("job {id}: {e}"))?;
            // A best-effort read: a job that has not started yet has no log
            // file, which is not an error.
            let lines = if tail == 0 {
                Vec::new()
            } else {
                logs.read(&job.id, Some(tail)).unwrap_or_default()
            };
            return Ok::<_, String>(json!({
                "job": job,
                "log_path": logs.path_for(&job.id),
                "logs": lines,
                "queue": stats,
            }));
        }

        let mut filter = ListFilter::default().limit(limit);
        if let Some(state) = state {
            filter = filter.state(state);
        }
        if let Some(kind) = kind.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            filter = filter.kind(kind);
        }
        let jobs = store
            .list(&filter)
            .map_err(|e| format!("list failed: {e}"))?;
        Ok(json!({ "count": jobs.len(), "jobs": jobs, "queue": stats }))
    })
    .await;

    match joined {
        Ok(Ok(value)) => pretty(&value),
        Ok(Err(reason)) => error_envelope("JOB_STORE_ERROR", reason),
        Err(err) => error_envelope("JOB_INTERNAL", format!("status task panicked: {err}")),
    }
}

/// Dispatch the existing queue's cancellation through authenticated MCP.
pub(crate) async fn cancel(req: JobCancelRequest) -> String {
    let id = req.id.trim();
    if id.is_empty() || id.len() > 128 {
        return error_envelope("JOB_BAD_REQUEST", "id must contain 1-128 bytes");
    }
    let id = id.to_owned();
    let joined = tokio::task::spawn_blocking(move || {
        let (store, _) = open_store()?;
        let job = store
            .cancel(&id)
            .map_err(|error| format!("cancel failed: {error}"))?;
        Ok::<_, String>(json!({"job":job,"queue":stats_value(&store)}))
    })
    .await;
    match joined {
        Ok(Ok(value)) => pretty(&value),
        Ok(Err(reason)) => error_envelope("JOB_STORE_ERROR", reason),
        Err(error) => error_envelope("JOB_INTERNAL", format!("cancel task panicked: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(kind: &str) -> JobSubmitRequest {
        JobSubmitRequest {
            kind: kind.to_owned(),
            host_affinity: None,
            idempotency_key: None,
            payload: None,
            max_attempts: None,
            priority: None,
            run_after: None,
        }
    }

    #[test]
    fn both_schemas_expose_their_documented_fields() {
        let submit = serde_json::to_string(&rmcp::schemars::schema_for!(JobSubmitRequest))
            .expect("schema serialise");
        for field in [
            "kind",
            "payload",
            "host_affinity",
            "idempotency_key",
            "max_attempts",
            "priority",
            "run_after",
        ] {
            assert!(
                submit.contains(&format!("\"{field}\"")),
                "submit missing {field}"
            );
        }
        let status = serde_json::to_string(&rmcp::schemars::schema_for!(JobStatusRequest))
            .expect("schema serialise");
        for field in ["id", "state", "kind", "limit", "log_tail"] {
            assert!(
                status.contains(&format!("\"{field}\"")),
                "status missing {field}"
            );
        }
    }

    #[test]
    fn web_arguments_and_placement_survive_submission_and_cancellation() {
        let request: JobSubmitRequest = serde_json::from_value(json!({
            "kind": "web-pipeline",
            "payload": {"args":["crawl-index","https://aphrody.com","--label","fleet-probe"]},
            "host_affinity": {"mode":"hosts","hosts":["vps","wsl"]},
            "idempotency_key": "remote-intent-test"
        }))
        .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let store = JobStore::open(dir.path().join("jobs.db")).unwrap();
        let job = store.submit(&build_spec(&request).unwrap()).unwrap();
        assert_eq!(
            job.host_affinity,
            HostAffinity::Hosts(vec!["vps".into(), "wsl".into()])
        );
        assert_eq!(job.state, aphrody_jobs::JobState::Queued);
        assert_eq!(job.attempts, 0);
        assert_eq!(
            store.submit(&build_spec(&request).unwrap()).unwrap().id,
            job.id
        );
        let cancelled = store.cancel(&job.id).unwrap();
        assert_eq!(cancelled.state, aphrody_jobs::JobState::Cancelled);
        drop(store);
        assert_eq!(
            JobStore::open(dir.path().join("jobs.db"))
                .unwrap()
                .get(&job.id)
                .unwrap(),
            cancelled
        );
    }

    #[test]
    fn web_shell_payload_and_empty_placement_are_refused() {
        for payload in [
            json!({"args": []}),
            json!({"args":["aphrody","web"]}),
            json!({"args":["status"]}),
            json!({"args":["crawl-index",3]}),
            json!({"args":["crawl-index"],"shell":"forbidden"}),
        ] {
            let mut request = req("web-pipeline");
            request.payload = Some(payload);
            assert!(build_spec(&request).is_err());
        }
        let mut request = req("transcribe");
        request.host_affinity = Some(JobHostAffinity::Hosts(vec![]));
        assert!(build_spec(&request).is_err());
        request.host_affinity = Some(JobHostAffinity::Hosts(vec![" ".into()]));
        assert!(build_spec(&request).is_err());
    }

    #[tokio::test]
    async fn blank_cancel_id_is_rejected_before_opening_the_store() {
        let result: serde_json::Value =
            serde_json::from_str(&cancel(JobCancelRequest { id: " ".into() }).await).unwrap();
        assert_eq!(result["error"], "JOB_BAD_REQUEST");
        let schema = serde_json::to_value(rmcp::schemars::schema_for!(JobCancelRequest)).unwrap();
        assert!(schema["properties"].get("id").is_some());
    }

    #[test]
    fn an_empty_kind_is_refused() {
        assert!(build_spec(&req("   ")).is_err());
    }

    #[test]
    fn a_missing_payload_defaults_to_an_empty_object() {
        let spec = build_spec(&req("ocr")).expect("spec");
        assert_eq!(spec.payload, json!({}));
        assert_eq!(spec.max_attempts, 1);
        assert_eq!(spec.priority, 0);
        assert!(spec.run_after.is_none());
    }

    #[test]
    fn an_oversized_payload_is_refused() {
        let mut r = req("ocr");
        r.payload = Some(json!({ "blob": "x".repeat(MAX_PAYLOAD_BYTES) }));
        let err = build_spec(&r).unwrap_err();
        assert!(err.contains("max"), "unexpected reason: {err}");
    }

    #[test]
    fn attempts_outside_the_ceiling_are_refused() {
        let mut r = req("ocr");
        r.max_attempts = Some(0);
        assert!(build_spec(&r).is_err());
        r.max_attempts = Some(MAX_ATTEMPTS_CEILING + 1);
        assert!(build_spec(&r).is_err());
        r.max_attempts = Some(3);
        assert_eq!(build_spec(&r).expect("spec").max_attempts, 3);
    }

    #[test]
    fn run_after_must_be_rfc_3339() {
        let mut r = req("ocr");
        r.run_after = Some("tomorrow".to_owned());
        assert!(build_spec(&r).is_err());
        r.run_after = Some("2026-09-07T10:00:00Z".to_owned());
        assert!(build_spec(&r).expect("spec").run_after.is_some());
    }

    #[test]
    fn submission_writes_a_row_and_runs_nothing() {
        // The contract of the tool, asserted against a real store: after
        // submitting, the job is `queued` — not running, not succeeded.
        let dir = tempfile::tempdir().expect("tempdir");
        let store = JobStore::open(dir.path().join("jobs.db")).expect("open");
        let job = store
            .submit(&build_spec(&req("transcribe")).expect("spec"))
            .expect("submit");
        assert_eq!(job.state, aphrody_jobs::JobState::Queued);
        assert_eq!(job.attempts, 0);
        assert!(job.result.is_none());
        assert_eq!(store.get(&job.id).expect("get").id, job.id);
        assert_eq!(store.stats().expect("stats").queued, 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn a_bad_state_filter_is_refused() {
        let request = JobStatusRequest {
            id: None,
            state: Some("banana".to_owned()),
            kind: None,
            limit: None,
            log_tail: None,
        };
        let value: serde_json::Value =
            serde_json::from_str(&status(request).await).expect("parse envelope");
        assert_eq!(value["error"], "JOB_BAD_REQUEST");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn an_out_of_range_limit_is_refused() {
        let request = JobStatusRequest {
            id: None,
            state: None,
            kind: None,
            limit: Some(0),
            log_tail: None,
        };
        let value: serde_json::Value =
            serde_json::from_str(&status(request).await).expect("parse envelope");
        assert_eq!(value["error"], "JOB_BAD_REQUEST");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn an_empty_kind_reaches_the_caller_as_a_structured_error() {
        let value: serde_json::Value =
            serde_json::from_str(&submit(req("")).await).expect("parse envelope");
        assert_eq!(value["error"], "JOB_BAD_REQUEST");
    }
}
