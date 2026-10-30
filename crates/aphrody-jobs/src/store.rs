// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! The persistent queue: one `SQLite` file, one row per job.
//!
//! # Why a lease rather than a flag
//!
//! A worker does not set `state = running` and hope. It takes a **lease**: a
//! deadline it must keep pushing forward with [`JobStore::heartbeat`]. A worker
//! killed mid-job (power cut, `SIGKILL`, a laptop lid) stops heartbeating, the
//! lease expires, and [`JobStore::recover`] returns the job to the queue.
//!
//! The alternative — a boolean "claimed" column — cannot tell a running job
//! from an abandoned one, so a crash strands work forever in a state that reads
//! as healthy. That is the failure this module exists to prevent.
//!
//! # Concurrency
//!
//! The claim is a single `UPDATE … WHERE id = (SELECT … LIMIT 1)` inside an
//! immediate transaction, so two workers racing for the same job cannot both
//! win: the second one's `WHERE state = 'queued'` no longer matches.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, Utc};
use rusqlite::{Connection, OptionalExtension as _, params};

use crate::{
    error::{JobError, Result},
    spec::{HostAffinity, Job, JobSpec, JobState},
};

/// Schema version written to `PRAGMA user_version`.
const SCHEMA_VERSION: i64 = 3;

/// Default lease length. Long enough that a slow model load does not lose the
/// claim, short enough that a crashed worker's job is picked up the same
/// minute.
pub const DEFAULT_LEASE: Duration = Duration::seconds(60);

/// Filters for [`JobStore::list`].
#[derive(Debug, Clone, Default)]
pub struct ListFilter {
    /// Restrict to one state.
    pub state: Option<JobState>,
    /// Restrict to one handler kind.
    pub kind: Option<String>,
    /// Cap the number of rows. `None` means every match.
    pub limit: Option<u32>,
}

impl ListFilter {
    /// Only jobs in `state`.
    #[must_use]
    pub const fn state(mut self, state: JobState) -> Self {
        self.state = Some(state);
        self
    }

    /// Only jobs of `kind`.
    #[must_use]
    pub fn kind(mut self, kind: impl Into<String>) -> Self {
        self.kind = Some(kind.into());
        self
    }

    /// At most `limit` rows.
    #[must_use]
    pub const fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }
}

/// Counts per state, for a one-line status report.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct QueueStats {
    /// Waiting for a worker.
    pub queued: u64,
    /// Claimed and in flight.
    pub running: u64,
    /// Finished successfully.
    pub succeeded: u64,
    /// Out of attempts.
    pub failed: u64,
    /// Cancelled by a caller.
    pub cancelled: u64,
}

impl QueueStats {
    /// Every job the store knows about.
    #[must_use]
    pub const fn total(&self) -> u64 {
        self.queued + self.running + self.succeeded + self.failed + self.cancelled
    }
}

/// What [`JobStore::recover`] put back.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct RecoveryReport {
    /// Jobs whose lease had expired and that were returned to the queue.
    pub requeued: Vec<String>,
    /// Jobs whose lease had expired with no attempts left, marked failed.
    pub exhausted: Vec<String>,
}

impl RecoveryReport {
    /// Whether the previous run left nothing behind.
    #[must_use]
    pub fn is_clean(&self) -> bool {
        self.requeued.is_empty() && self.exhausted.is_empty()
    }
}

/// The queue.
#[derive(Debug)]
pub struct JobStore {
    conn: Connection,
    path: Option<PathBuf>,
}

impl JobStore {
    /// Open (creating if needed) the queue at `path`.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] when the file cannot be opened or the schema
    /// cannot be applied.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        let store = Self {
            conn,
            path: Some(path.to_path_buf()),
        };
        store.migrate()?;
        Ok(store)
    }

    /// An in-memory queue, for tests and one-shot runs.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] when the schema cannot be applied.
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn, path: None };
        store.migrate()?;
        Ok(store)
    }

    /// The backing file, or `None` for an in-memory queue.
    #[must_use]
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    fn migrate(&self) -> Result<()> {
        // WAL keeps a reader (`aphrody job list`) from blocking the worker
        // that is writing heartbeats; `busy_timeout` makes a contended claim
        // wait instead of returning SQLITE_BUSY to the caller.
        self.conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             CREATE TABLE IF NOT EXISTS jobs (
                 id               TEXT PRIMARY KEY,
                 kind             TEXT NOT NULL,
                 payload          TEXT NOT NULL,
                 state            TEXT NOT NULL,
                 attempts         INTEGER NOT NULL DEFAULT 0,
                 max_attempts     INTEGER NOT NULL DEFAULT 1,
                 priority         INTEGER NOT NULL DEFAULT 0,
                 created_at       TEXT NOT NULL,
                 updated_at       TEXT NOT NULL,
                 run_after        TEXT,
                 lease_expires_at TEXT,
                 worker           TEXT,
                 result           TEXT,
                 last_error       TEXT,
                 host_affinity    TEXT NOT NULL DEFAULT '{\"mode\":\"any\"}',
                 idempotency_key  TEXT
             );
             CREATE INDEX IF NOT EXISTS jobs_ready
                 ON jobs (state, priority DESC, created_at);
             CREATE INDEX IF NOT EXISTS jobs_lease ON jobs (state, lease_expires_at);",
        )?;
        // Serialize additive schema upgrades across concurrently starting services.
        // If migration fails, this newly opened connection is dropped and SQLite rolls back.
        self.conn.execute_batch("BEGIN IMMEDIATE")?;
        let affinity_exists: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('jobs') WHERE name = 'host_affinity')",
            [],
            |row| row.get(0),
        )?;
        if !affinity_exists {
            self.conn.execute_batch("ALTER TABLE jobs ADD COLUMN host_affinity TEXT NOT NULL DEFAULT '{\"mode\":\"any\"}'")?;
        }
        let key_exists: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('jobs') WHERE name = 'idempotency_key')",
            [],
            |row| row.get(0),
        )?;
        if !key_exists {
            self.conn
                .execute_batch("ALTER TABLE jobs ADD COLUMN idempotency_key TEXT")?;
        }
        self.conn.execute_batch("CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL")?;
        self.conn
            .pragma_update(None, "user_version", SCHEMA_VERSION)?;
        self.conn.execute_batch("COMMIT")?;
        Ok(())
    }

    /// Enqueue `spec` and return the created job.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] on write failure.
    pub fn submit(&self, spec: &JobSpec) -> Result<Job> {
        self.submit_at(spec, Utc::now())
    }

    /// [`Self::submit`] with an explicit clock, so ordering is testable.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] on write failure.
    pub fn submit_at(&self, spec: &JobSpec, now: DateTime<Utc>) -> Result<Job> {
        if let HostAffinity::Hosts(hosts) = &spec.host_affinity
            && (hosts.is_empty() || hosts.iter().any(|host| host.trim().is_empty()))
        {
            return Err(JobError::InvalidSpec(
                "host affinity needs nonempty host identities".to_owned(),
            ));
        }
        if let Some(key) = &spec.idempotency_key
            && (key.trim().is_empty() || key.len() > 256)
        {
            return Err(JobError::InvalidSpec(
                "idempotency key must contain 1-256 bytes".into(),
            ));
        }
        let job = Job {
            id: uuid::Uuid::new_v4().to_string(),
            kind: spec.kind.clone(),
            payload: spec.payload.clone(),
            state: JobState::Queued,
            attempts: 0,
            max_attempts: spec.max_attempts.max(1),
            priority: spec.priority,
            created_at: now,
            updated_at: now,
            run_after: spec.run_after,
            lease_expires_at: None,
            worker: None,
            result: None,
            last_error: None,
            host_affinity: spec.host_affinity.clone(),
            idempotency_key: spec.idempotency_key.clone(),
        };
        let inserted = self.conn.execute(
            "INSERT INTO jobs
                (id, kind, payload, state, attempts, max_attempts, priority,
                 created_at, updated_at, run_after, host_affinity, idempotency_key)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, ?7, ?8, ?9, ?10)
             ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",
            params![
                job.id,
                job.kind,
                serde_json::to_string(&job.payload)?,
                job.state.as_str(),
                job.max_attempts,
                job.priority,
                rfc3339(now),
                job.run_after.map(rfc3339),
                serde_json::to_string(&job.host_affinity)?,
                job.idempotency_key,
            ],
        )?;
        if inserted == 0 {
            let id: String = self.conn.query_row(
                "SELECT id FROM jobs WHERE idempotency_key=?1",
                params![spec.idempotency_key],
                |row| row.get(0),
            )?;
            let existing = self.get(&id)?;
            if existing.kind != spec.kind
                || existing.payload != spec.payload
                || existing.host_affinity != spec.host_affinity
                || existing.max_attempts != spec.max_attempts.max(1)
                || existing.priority != spec.priority
                || existing.run_after.map(rfc3339) != spec.run_after.map(rfc3339)
            {
                return Err(JobError::InvalidSpec(
                    "idempotency key already names a different job intent".into(),
                ));
            }
            return Ok(existing);
        }
        Ok(job)
    }

    /// Claim the next runnable job for `worker`, taking a lease of `lease`.
    ///
    /// Returns `None` when nothing is runnable — an empty queue and a queue
    /// whose jobs are all held back by `run_after` are the same answer to a
    /// worker loop.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] on write failure, [`JobError::Corrupt`] when the
    /// claimed row does not decode.
    pub fn claim(&self, worker: &str, lease: Duration) -> Result<Option<Job>> {
        self.claim_at(worker, lease, Utc::now())
    }

    /// [`Self::claim`] with an explicit clock.
    ///
    /// # Errors
    ///
    /// As [`Self::claim`].
    pub fn claim_at(
        &self,
        worker: &str,
        lease: Duration,
        now: DateTime<Utc>,
    ) -> Result<Option<Job>> {
        self.claim_filtered_at(worker, None, None, lease, now)
    }

    /// Claim only a kind handled by this worker and placement allowed for its host.
    /// An empty capability list claims nothing and spends no retry budget.
    ///
    /// # Errors
    /// As [`Self::claim`], or [`JobError::InvalidWorkerConfig`] for a nonpositive lease.
    pub fn claim_matching(
        &self,
        worker: &str,
        host: Option<&str>,
        kinds: &[&str],
        lease: Duration,
    ) -> Result<Option<Job>> {
        self.claim_filtered_at(worker, host, Some(kinds), lease, Utc::now())
    }

    fn claim_filtered_at(
        &self,
        worker: &str,
        host: Option<&str>,
        kinds: Option<&[&str]>,
        lease: Duration,
        now: DateTime<Utc>,
    ) -> Result<Option<Job>> {
        if lease <= Duration::zero() {
            return Err(JobError::InvalidWorkerConfig("lease must be positive"));
        }
        if kinds.is_some_and(<[&str]>::is_empty) {
            return Ok(None);
        }
        let kinds_json = kinds.map(serde_json::to_string).transpose()?;
        // One statement, so two workers cannot both take the same row: the
        // loser's `state = 'queued'` predicate no longer holds.
        let claimed: Option<String> = self
            .conn
            .query_row(
                "UPDATE jobs
                    SET state = 'running',
                        attempts = attempts + 1,
                        worker = ?1,
                        lease_expires_at = ?2,
                        updated_at = ?3
                  WHERE id = (
                      SELECT id FROM jobs
                       WHERE state = 'queued'
                         AND (run_after IS NULL OR run_after <= ?3)
                         AND (?4 IS NULL OR kind IN (SELECT value FROM json_each(?4)))
                         AND (json_extract(host_affinity, '$.mode') = 'any'
                              OR (?5 IS NOT NULL AND EXISTS(
                                  SELECT 1 FROM json_each(host_affinity, '$.hosts') WHERE value = ?5
                              )))
                       ORDER BY priority DESC, created_at ASC
                       LIMIT 1
                  )
              RETURNING id",
                params![worker, rfc3339(now + lease), rfc3339(now), kinds_json, host],
                |row| row.get(0),
            )
            .optional()?;

        match claimed {
            Some(id) => self.get(&id).map(Some),
            None => Ok(None),
        }
    }

    /// Push the lease of a running job forward.
    ///
    /// Returns `false` when the job is no longer the caller's to hold — it was
    /// cancelled, or recovery already handed it to someone else. A worker that
    /// sees `false` must stop: continuing would mean two workers doing the same
    /// job and both writing a result.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] on write failure.
    pub fn heartbeat(&self, id: &str, worker: &str, lease: Duration) -> Result<bool> {
        self.heartbeat_at(id, worker, lease, Utc::now())
    }

    /// Extend only this exact claim generation; a reclaimed job may reuse the worker name.
    ///
    /// # Errors
    /// [`JobError::Sqlite`] on write failure.
    pub fn heartbeat_owned(
        &self,
        id: &str,
        worker: &str,
        attempt: u32,
        lease: Duration,
    ) -> Result<bool> {
        let now = Utc::now();
        let changed = self.conn.execute(
            "UPDATE jobs SET lease_expires_at=?1, updated_at=?2
             WHERE id=?3 AND worker=?4 AND attempts=?5 AND state='running'",
            params![rfc3339(now + lease), rfc3339(now), id, worker, attempt],
        )?;
        Ok(changed == 1)
    }

    /// Finish only the exact claim still owned by the caller, without overwriting cancellation/recovery.
    /// Returns `None` when that claim no longer exists.
    ///
    /// # Errors
    /// [`JobError::Sqlite`] or [`JobError::Json`] on persistence failure.
    pub fn succeed_owned(
        &self,
        id: &str,
        worker: &str,
        attempt: u32,
        result: &serde_json::Value,
    ) -> Result<Option<Job>> {
        let changed = self.conn.execute(
            "UPDATE jobs SET state='succeeded', result=?1, worker=NULL, lease_expires_at=NULL, updated_at=?2
             WHERE id=?3 AND worker=?4 AND attempts=?5 AND state='running'",
            params![serde_json::to_string(result)?, rfc3339(Utc::now()), id, worker, attempt],
        )?;
        if changed == 1 {
            self.get(id).map(Some)
        } else {
            Ok(None)
        }
    }

    /// Record a handler failure only while its claim generation is still owned.
    /// A permanent failure does not retry; a retryable one follows the stored attempt budget.
    ///
    /// # Errors
    /// [`JobError::Sqlite`] or [`JobError::UnknownJob`] on persistence failure.
    pub fn fail_owned(
        &self,
        id: &str,
        worker: &str,
        attempt: u32,
        error: &str,
        retryable: bool,
        backoff: Duration,
    ) -> Result<Option<Job>> {
        let job = self.get(id)?;
        if job.state != JobState::Running
            || job.worker.as_deref() != Some(worker)
            || job.attempts != attempt
        {
            return Ok(None);
        }
        let retry = retryable && job.has_attempts_left();
        let now = Utc::now();
        let changed = self.conn.execute(
            "UPDATE jobs SET state=?1, worker=NULL, lease_expires_at=NULL, last_error=?2, run_after=?3, updated_at=?4
             WHERE id=?5 AND worker=?6 AND attempts=?7 AND state='running'",
            params![if retry {"queued"} else {"failed"}, error, retry.then(||rfc3339(now + backoff)),rfc3339(now),id,worker,attempt],
        )?;
        if changed == 1 {
            self.get(id).map(Some)
        } else {
            Ok(None)
        }
    }

    /// [`Self::heartbeat`] with an explicit clock.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] on write failure.
    pub fn heartbeat_at(
        &self,
        id: &str,
        worker: &str,
        lease: Duration,
        now: DateTime<Utc>,
    ) -> Result<bool> {
        let changed = self.conn.execute(
            "UPDATE jobs
                SET lease_expires_at = ?1, updated_at = ?2
              WHERE id = ?3 AND worker = ?4 AND state = 'running'",
            params![rfc3339(now + lease), rfc3339(now), id, worker],
        )?;
        Ok(changed == 1)
    }

    /// Mark a running job successful.
    ///
    /// # Errors
    ///
    /// [`JobError::UnknownJob`] when the id is absent,
    /// [`JobError::BadTransition`] when the job is not running.
    pub fn succeed(&self, id: &str, result: &serde_json::Value) -> Result<Job> {
        let job = self.get(id)?;
        if job.state != JobState::Running {
            return Err(JobError::BadTransition {
                id: id.to_owned(),
                state: job.state,
                action: "succeed",
            });
        }
        self.conn.execute(
            "UPDATE jobs
                SET state = 'succeeded', result = ?1, lease_expires_at = NULL,
                    worker = NULL, updated_at = ?2
              WHERE id = ?3",
            params![serde_json::to_string(result)?, rfc3339(Utc::now()), id],
        )?;
        self.get(id)
    }

    /// Record a failed run: back to the queue when attempts remain, otherwise
    /// terminal `failed`.
    ///
    /// Returns the job in its new state, so a caller can log "retrying" versus
    /// "giving up" from the value rather than by re-reading.
    ///
    /// # Errors
    ///
    /// [`JobError::UnknownJob`] when the id is absent,
    /// [`JobError::BadTransition`] when the job is not running.
    pub fn fail(&self, id: &str, error: &str) -> Result<Job> {
        self.fail_at(id, error, Utc::now(), None)
    }

    /// [`Self::fail`] with an explicit clock and an optional backoff before the
    /// job becomes runnable again.
    ///
    /// # Errors
    ///
    /// As [`Self::fail`].
    pub fn fail_at(
        &self,
        id: &str,
        error: &str,
        now: DateTime<Utc>,
        backoff: Option<Duration>,
    ) -> Result<Job> {
        let job = self.get(id)?;
        if job.state != JobState::Running {
            return Err(JobError::BadTransition {
                id: id.to_owned(),
                state: job.state,
                action: "fail",
            });
        }

        if job.has_attempts_left() {
            let run_after = backoff.map(|b| rfc3339(now + b));
            self.conn.execute(
                "UPDATE jobs
                    SET state = 'queued', worker = NULL, lease_expires_at = NULL,
                        last_error = ?1, run_after = ?2, updated_at = ?3
                  WHERE id = ?4",
                params![error, run_after, rfc3339(now), id],
            )?;
        } else {
            self.conn.execute(
                "UPDATE jobs
                    SET state = 'failed', worker = NULL, lease_expires_at = NULL,
                        last_error = ?1, updated_at = ?2
                  WHERE id = ?3",
                params![error, rfc3339(now), id],
            )?;
        }
        self.get(id)
    }

    /// Fail a running job outright, whatever attempts remain.
    ///
    /// For failures retrying cannot fix — a malformed payload, a missing input
    /// file. Spending the remaining attempts on them produces the same error N
    /// times and buries it under its own repeats.
    ///
    /// # Errors
    ///
    /// [`JobError::UnknownJob`] when the id is absent,
    /// [`JobError::BadTransition`] when the job is not running.
    pub fn fail_permanently(&self, id: &str, error: &str) -> Result<Job> {
        let job = self.get(id)?;
        if job.state != JobState::Running {
            return Err(JobError::BadTransition {
                id: id.to_owned(),
                state: job.state,
                action: "fail",
            });
        }
        self.conn.execute(
            "UPDATE jobs
                SET state = 'failed', worker = NULL, lease_expires_at = NULL,
                    last_error = ?1, updated_at = ?2
              WHERE id = ?3",
            params![error, rfc3339(Utc::now()), id],
        )?;
        self.get(id)
    }

    /// Cancel a job.
    ///
    /// A running job is not killed: the state flips, its worker sees `false`
    /// from the next [`Self::heartbeat`] and stops. Claiming otherwise would be
    /// a lie about a child process this crate does not own.
    ///
    /// # Errors
    ///
    /// [`JobError::UnknownJob`] when the id is absent,
    /// [`JobError::BadTransition`] when the job already finished.
    pub fn cancel(&self, id: &str) -> Result<Job> {
        let job = self.get(id)?;
        if job.state.is_terminal() {
            return Err(JobError::BadTransition {
                id: id.to_owned(),
                state: job.state,
                action: "cancel",
            });
        }
        self.conn.execute(
            "UPDATE jobs
                SET state = 'cancelled', worker = NULL, lease_expires_at = NULL,
                    updated_at = ?1
              WHERE id = ?2",
            params![rfc3339(Utc::now()), id],
        )?;
        self.get(id)
    }

    /// Return jobs whose lease has expired to the queue.
    ///
    /// This is what makes a crash survivable, and it must be called before a
    /// worker starts consuming — otherwise the jobs a killed process was
    /// holding stay `running` forever and read as healthy.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] on write failure.
    pub fn recover(&self) -> Result<RecoveryReport> {
        self.recover_at(Utc::now())
    }

    /// [`Self::recover`] with an explicit clock.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] on write failure.
    pub fn recover_at(&self, now: DateTime<Utc>) -> Result<RecoveryReport> {
        let stale: Vec<(String, u32, u32)> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, attempts, max_attempts FROM jobs
                  WHERE state = 'running'
                    AND lease_expires_at IS NOT NULL
                    AND lease_expires_at <= ?1",
            )?;
            let rows = stmt.query_map(params![rfc3339(now)], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, u32>(2)?,
                ))
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };

        let mut report = RecoveryReport::default();
        for (id, attempts, max_attempts) in stale {
            if attempts < max_attempts {
                self.conn.execute(
                    "UPDATE jobs
                        SET state = 'queued', worker = NULL, lease_expires_at = NULL,
                            last_error = ?1, updated_at = ?2
                      WHERE id = ?3",
                    params![
                        "lease expired: the worker holding this job stopped",
                        rfc3339(now),
                        id
                    ],
                )?;
                report.requeued.push(id);
            } else {
                self.conn.execute(
                    "UPDATE jobs
                        SET state = 'failed', worker = NULL, lease_expires_at = NULL,
                            last_error = ?1, updated_at = ?2
                      WHERE id = ?3",
                    params![
                        "lease expired with no attempts left: the worker holding this job stopped",
                        rfc3339(now),
                        id
                    ],
                )?;
                report.exhausted.push(id);
            }
        }
        Ok(report)
    }

    /// Fetch one job.
    ///
    /// # Errors
    ///
    /// [`JobError::UnknownJob`] when the id is absent, [`JobError::Corrupt`]
    /// when the row does not decode.
    pub fn get(&self, id: &str) -> Result<Job> {
        self.conn
            .query_row(
                &format!("SELECT {COLUMNS} FROM jobs WHERE id = ?1"),
                params![id],
                |row| Ok(row_to_job(row)),
            )
            .optional()?
            .ok_or_else(|| JobError::UnknownJob(id.to_owned()))?
    }

    /// List jobs, newest submission first.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] on read failure, [`JobError::Corrupt`] when a row
    /// does not decode.
    pub fn list(&self, filter: &ListFilter) -> Result<Vec<Job>> {
        let mut sql = format!("SELECT {COLUMNS} FROM jobs");
        let mut clauses: Vec<String> = Vec::new();
        let mut binds: Vec<String> = Vec::new();
        if let Some(state) = filter.state {
            binds.push(state.as_str().to_owned());
            clauses.push(format!("state = ?{}", binds.len()));
        }
        if let Some(kind) = &filter.kind {
            binds.push(kind.clone());
            clauses.push(format!("kind = ?{}", binds.len()));
        }
        if !clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&clauses.join(" AND "));
        }
        sql.push_str(" ORDER BY created_at DESC");
        if let Some(limit) = filter.limit {
            use core::fmt::Write as _;
            let _ = write!(sql, " LIMIT {limit}");
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let params = rusqlite::params_from_iter(binds.iter());
        let rows = stmt.query_map(params, |row| Ok(row_to_job(row)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .collect()
    }

    /// Counts per state.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] on read failure.
    pub fn stats(&self) -> Result<QueueStats> {
        let mut stmt = self
            .conn
            .prepare("SELECT state, COUNT(*) FROM jobs GROUP BY state")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        let mut stats = QueueStats::default();
        for row in rows {
            let (label, tally) = row?;
            let count = u64::try_from(tally).unwrap_or(0);
            match JobState::parse(&label) {
                Some(JobState::Queued) => stats.queued = count,
                Some(JobState::Running) => stats.running = count,
                Some(JobState::Succeeded) => stats.succeeded = count,
                Some(JobState::Failed) => stats.failed = count,
                Some(JobState::Cancelled) => stats.cancelled = count,
                // An unknown state in the file is data from another version;
                // it must not make a status report fail.
                None => {}
            }
        }
        Ok(stats)
    }

    /// Delete terminal jobs older than `before`, and report how many went.
    ///
    /// Running and queued jobs are never removed, whatever their age: a job
    /// held back by a long `run_after` is not garbage.
    ///
    /// # Errors
    ///
    /// [`JobError::Sqlite`] on write failure.
    pub fn purge_before(&self, before: DateTime<Utc>) -> Result<u64> {
        let removed = self.conn.execute(
            "DELETE FROM jobs
              WHERE state IN ('succeeded', 'failed', 'cancelled')
                AND updated_at < ?1",
            params![rfc3339(before)],
        )?;
        Ok(removed as u64)
    }
}

/// Column list, kept in one place so `get` and `list` cannot drift apart.
const COLUMNS: &str = "id, kind, payload, state, attempts, max_attempts, priority, created_at, \
                       updated_at, run_after, lease_expires_at, worker, result, last_error, host_affinity, idempotency_key";

fn rfc3339(when: DateTime<Utc>) -> String {
    when.to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
}

fn parse_time(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// Decode one row. Returns the crate's `Result` inside rusqlite's, so a corrupt
/// row is reported with its id instead of collapsing into a generic SQL error.
fn row_to_job(row: &rusqlite::Row<'_>) -> Result<Job> {
    let id: String = row.get(0)?;
    let corrupt = |reason: String| JobError::Corrupt {
        id: id.clone(),
        reason,
    };

    let payload_raw: String = row.get(2)?;
    let payload = serde_json::from_str(&payload_raw)
        .map_err(|e| corrupt(format!("payload is not JSON: {e}")))?;

    let state_raw: String = row.get(3)?;
    let state = JobState::parse(&state_raw)
        .ok_or_else(|| corrupt(format!("unknown state `{state_raw}`")))?;

    let created_raw: String = row.get(7)?;
    let created_at = parse_time(&created_raw)
        .ok_or_else(|| corrupt(format!("created_at is not RFC 3339: `{created_raw}`")))?;
    let updated_raw: String = row.get(8)?;
    let updated_at = parse_time(&updated_raw)
        .ok_or_else(|| corrupt(format!("updated_at is not RFC 3339: `{updated_raw}`")))?;

    let result_raw: Option<String> = row.get(12)?;
    let result = match result_raw {
        Some(raw) => Some(
            serde_json::from_str(&raw).map_err(|e| corrupt(format!("result is not JSON: {e}")))?,
        ),
        None => None,
    };

    let host_affinity = serde_json::from_str(&row.get::<_, String>(14)?)
        .map_err(|error| corrupt(format!("invalid host affinity: {error}")))?;
    Ok(Job {
        id,
        kind: row.get(1)?,
        payload,
        state,
        attempts: row.get(4)?,
        max_attempts: row.get(5)?,
        priority: row.get(6)?,
        created_at,
        updated_at,
        run_after: row
            .get::<_, Option<String>>(9)?
            .as_deref()
            .and_then(parse_time),
        lease_expires_at: row
            .get::<_, Option<String>>(10)?
            .as_deref()
            .and_then(parse_time),
        worker: row.get(11)?,
        result,
        last_error: row.get(13)?,
        host_affinity,
        idempotency_key: row.get(15)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lost_acknowledgement_retry_returns_the_durable_job_after_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs.db");
        let spec = JobSpec::new(
            "web-pipeline",
            serde_json::json!({"args":["crawl-index","https://aphrody.com"]}),
        )
        .with_host_affinity(HostAffinity::Hosts(vec!["vps".into()]))
        .with_idempotency_key("worker:intent:42");
        let store = JobStore::open(&path).unwrap();
        let submitted = store.submit(&spec).unwrap();
        let first = store.get(&submitted.id).unwrap();
        drop(store); // The acknowledgement never reached the caller.
        let store = JobStore::open(&path).unwrap();
        let retry = store.submit(&spec).unwrap();
        assert_eq!(retry, first);
        assert_eq!(store.stats().unwrap().queued, 1);
        let mut collision = spec.clone();
        collision.payload = serde_json::json!({"args":["dragon-ball"]});
        assert!(matches!(
            store.submit(&collision),
            Err(JobError::InvalidSpec(_))
        ));
        collision = spec.clone();
        collision.host_affinity = HostAffinity::Hosts(vec!["wsl".into()]);
        assert!(matches!(
            store.submit(&collision),
            Err(JobError::InvalidSpec(_))
        ));
        let cancelled = store.cancel(&first.id).unwrap();
        assert_eq!(store.submit(&spec).unwrap(), cancelled);
        assert_eq!(store.stats().unwrap().cancelled, 1);
    }

    #[test]
    fn concurrent_remote_retries_create_one_intent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs.db");
        let stores = [
            JobStore::open(&path).unwrap(),
            JobStore::open(&path).unwrap(),
        ];
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_> = stores
            .into_iter()
            .map(|store| {
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let spec = JobSpec::new(
                        "web-pipeline",
                        serde_json::json!({"args":["crawl-index","https://aphrody.com"]}),
                    )
                    .with_idempotency_key("same-intent");
                    barrier.wait();
                    store.submit(&spec).unwrap().id
                })
            })
            .collect();
        let ids: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(ids[0], ids[1]);
        assert_eq!(JobStore::open(path).unwrap().stats().unwrap().queued, 1);
    }

    fn spec(kind: &str) -> JobSpec {
        JobSpec::new(kind, serde_json::json!({ "n": 1 }))
    }

    #[test]
    fn a_submitted_job_is_queued_and_readable_back() {
        let store = JobStore::in_memory().unwrap();
        let job = store.submit(&spec("transcribe")).unwrap();
        let read = store.get(&job.id).unwrap();
        assert_eq!(read.state, JobState::Queued);
        assert_eq!(read.kind, "transcribe");
        assert_eq!(read.payload, serde_json::json!({ "n": 1 }));
        assert_eq!(read.attempts, 0);
    }

    #[test]
    fn an_unknown_id_is_named_in_the_error() {
        let store = JobStore::in_memory().unwrap();
        let err = store.get("nope").unwrap_err();
        assert!(matches!(err, JobError::UnknownJob(id) if id == "nope"));
    }

    #[test]
    fn claiming_takes_priority_first_then_submission_order() {
        let store = JobStore::in_memory().unwrap();
        let t0 = Utc::now();
        let low_first = store.submit_at(&spec("a"), t0).unwrap();
        let low_second = store
            .submit_at(&spec("b"), t0 + Duration::seconds(1))
            .unwrap();
        let high = store
            .submit_at(&spec("c").with_priority(10), t0 + Duration::seconds(2))
            .unwrap();

        let order: Vec<String> = (0..3)
            .map(|_| store.claim("w", DEFAULT_LEASE).unwrap().unwrap().id)
            .collect();
        assert_eq!(order, vec![high.id, low_first.id, low_second.id]);
    }

    #[test]
    fn a_job_held_back_by_run_after_is_not_claimable_yet() {
        let store = JobStore::in_memory().unwrap();
        let now = Utc::now();
        store
            .submit_at(&spec("later").run_after(now + Duration::hours(1)), now)
            .unwrap();
        assert!(store.claim_at("w", DEFAULT_LEASE, now).unwrap().is_none());
        assert!(
            store
                .claim_at("w", DEFAULT_LEASE, now + Duration::hours(2))
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn two_workers_cannot_claim_the_same_job() {
        let store = JobStore::in_memory().unwrap();
        store.submit(&spec("only-one")).unwrap();
        assert!(store.claim("worker-a", DEFAULT_LEASE).unwrap().is_some());
        assert!(store.claim("worker-b", DEFAULT_LEASE).unwrap().is_none());
    }

    #[test]
    fn claiming_increments_attempts_and_records_the_worker() {
        let store = JobStore::in_memory().unwrap();
        store.submit(&spec("x")).unwrap();
        let claimed = store.claim("worker-a", DEFAULT_LEASE).unwrap().unwrap();
        assert_eq!(claimed.attempts, 1);
        assert_eq!(claimed.worker.as_deref(), Some("worker-a"));
        assert_eq!(claimed.state, JobState::Running);
        assert!(claimed.lease_expires_at.is_some());
    }

    #[test]
    fn success_stores_the_result_and_releases_the_lease() {
        let store = JobStore::in_memory().unwrap();
        store.submit(&spec("x")).unwrap();
        let claimed = store.claim("w", DEFAULT_LEASE).unwrap().unwrap();
        let done = store
            .succeed(&claimed.id, &serde_json::json!({ "text": "ok" }))
            .unwrap();
        assert_eq!(done.state, JobState::Succeeded);
        assert_eq!(done.result, Some(serde_json::json!({ "text": "ok" })));
        assert!(done.lease_expires_at.is_none());
        assert!(done.worker.is_none());
    }

    #[test]
    fn a_failure_with_attempts_left_returns_to_the_queue() {
        let store = JobStore::in_memory().unwrap();
        store.submit(&spec("x").with_max_attempts(2)).unwrap();
        let claimed = store.claim("w", DEFAULT_LEASE).unwrap().unwrap();
        let after = store.fail(&claimed.id, "boom").unwrap();
        assert_eq!(after.state, JobState::Queued);
        assert_eq!(after.attempts, 1);
        assert_eq!(after.last_error.as_deref(), Some("boom"));
        // And it is claimable again.
        assert!(store.claim("w", DEFAULT_LEASE).unwrap().is_some());
    }

    #[test]
    fn the_last_failure_is_terminal() {
        let store = JobStore::in_memory().unwrap();
        store.submit(&spec("x")).unwrap();
        let claimed = store.claim("w", DEFAULT_LEASE).unwrap().unwrap();
        let after = store.fail(&claimed.id, "boom").unwrap();
        assert_eq!(after.state, JobState::Failed);
        assert!(store.claim("w", DEFAULT_LEASE).unwrap().is_none());
    }

    #[test]
    fn a_backoff_holds_the_retry_back() {
        let store = JobStore::in_memory().unwrap();
        let now = Utc::now();
        store
            .submit_at(&spec("x").with_max_attempts(2), now)
            .unwrap();
        let claimed = store.claim_at("w", DEFAULT_LEASE, now).unwrap().unwrap();
        store
            .fail_at(&claimed.id, "boom", now, Some(Duration::minutes(5)))
            .unwrap();
        assert!(store.claim_at("w", DEFAULT_LEASE, now).unwrap().is_none());
        assert!(
            store
                .claim_at("w", DEFAULT_LEASE, now + Duration::minutes(6))
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn succeeding_a_job_that_is_not_running_is_refused() {
        let store = JobStore::in_memory().unwrap();
        let job = store.submit(&spec("x")).unwrap();
        let err = store
            .succeed(&job.id, &serde_json::json!(null))
            .unwrap_err();
        assert!(matches!(
            err,
            JobError::BadTransition {
                state: JobState::Queued,
                action: "succeed",
                ..
            }
        ));
    }

    #[test]
    fn a_crashed_worker_s_job_is_requeued_once_its_lease_expires() {
        let store = JobStore::in_memory().unwrap();
        let now = Utc::now();
        store
            .submit_at(&spec("x").with_max_attempts(3), now)
            .unwrap();
        let claimed = store
            .claim_at("dead-worker", Duration::seconds(30), now)
            .unwrap()
            .unwrap();

        // Before the deadline, recovery must not touch a healthy claim.
        assert!(
            store
                .recover_at(now + Duration::seconds(10))
                .unwrap()
                .is_clean()
        );

        let report = store.recover_at(now + Duration::seconds(31)).unwrap();
        assert_eq!(report.requeued, vec![claimed.id.clone()]);
        let job = store.get(&claimed.id).unwrap();
        assert_eq!(job.state, JobState::Queued);
        assert!(job.worker.is_none());
        assert!(job.last_error.as_deref().unwrap().contains("lease expired"));
    }

    #[test]
    fn an_expired_lease_with_no_attempts_left_fails_instead_of_looping() {
        let store = JobStore::in_memory().unwrap();
        let now = Utc::now();
        store.submit_at(&spec("x"), now).unwrap();
        let claimed = store
            .claim_at("dead", Duration::seconds(30), now)
            .unwrap()
            .unwrap();
        let report = store.recover_at(now + Duration::seconds(31)).unwrap();
        assert_eq!(report.exhausted, vec![claimed.id.clone()]);
        assert_eq!(store.get(&claimed.id).unwrap().state, JobState::Failed);
    }

    #[test]
    fn a_heartbeat_extends_the_lease_and_only_for_its_owner() {
        let store = JobStore::in_memory().unwrap();
        let now = Utc::now();
        store.submit_at(&spec("x"), now).unwrap();
        let claimed = store
            .claim_at("mine", Duration::seconds(30), now)
            .unwrap()
            .unwrap();

        // Twenty seconds in, the owner pushes its deadline out to now+50.
        let mid = now + Duration::seconds(20);
        assert!(
            store
                .heartbeat_at(&claimed.id, "mine", Duration::seconds(30), mid)
                .unwrap()
        );
        // Another worker cannot extend a lease it does not hold.
        assert!(
            !store
                .heartbeat_at(&claimed.id, "theirs", Duration::seconds(30), mid)
                .unwrap()
        );

        // The original deadline has passed, but the heartbeat moved it: the job
        // must not be reclaimed from a worker that is demonstrably alive.
        assert!(
            store
                .recover_at(now + Duration::seconds(31))
                .unwrap()
                .is_clean()
        );
        // Past the extended deadline it is stale again.
        assert!(
            !store
                .recover_at(now + Duration::seconds(51))
                .unwrap()
                .is_clean()
        );
    }

    #[test]
    fn a_cancelled_job_stops_its_worker_at_the_next_heartbeat() {
        let store = JobStore::in_memory().unwrap();
        store.submit(&spec("x")).unwrap();
        let claimed = store.claim("w", DEFAULT_LEASE).unwrap().unwrap();
        store.cancel(&claimed.id).unwrap();
        // This is the signal the worker loop reads: the claim is gone.
        assert!(!store.heartbeat(&claimed.id, "w", DEFAULT_LEASE).unwrap());
        assert_eq!(store.get(&claimed.id).unwrap().state, JobState::Cancelled);
    }

    #[test]
    fn a_finished_job_cannot_be_cancelled() {
        let store = JobStore::in_memory().unwrap();
        store.submit(&spec("x")).unwrap();
        let claimed = store.claim("w", DEFAULT_LEASE).unwrap().unwrap();
        store.succeed(&claimed.id, &serde_json::json!(1)).unwrap();
        assert!(matches!(
            store.cancel(&claimed.id).unwrap_err(),
            JobError::BadTransition {
                action: "cancel",
                ..
            }
        ));
    }

    #[test]
    fn listing_filters_on_state_and_kind() {
        let store = JobStore::in_memory().unwrap();
        store.submit(&spec("ocr")).unwrap();
        store.submit(&spec("transcribe")).unwrap();
        let claimed = store.claim("w", DEFAULT_LEASE).unwrap().unwrap();

        assert_eq!(store.list(&ListFilter::default()).unwrap().len(), 2);
        assert_eq!(
            store
                .list(&ListFilter::default().kind("ocr"))
                .unwrap()
                .len(),
            1
        );
        let running = store
            .list(&ListFilter::default().state(JobState::Running))
            .unwrap();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].id, claimed.id);
        assert_eq!(
            store.list(&ListFilter::default().limit(1)).unwrap().len(),
            1
        );
    }

    #[test]
    fn stats_count_every_state() {
        let store = JobStore::in_memory().unwrap();
        for _ in 0..3 {
            store.submit(&spec("x")).unwrap();
        }
        let claimed = store.claim("w", DEFAULT_LEASE).unwrap().unwrap();
        store.succeed(&claimed.id, &serde_json::json!(0)).unwrap();
        let stats = store.stats().unwrap();
        assert_eq!(stats.queued, 2);
        assert_eq!(stats.succeeded, 1);
        assert_eq!(stats.total(), 3);
    }

    #[test]
    fn purge_removes_finished_work_and_spares_the_pending() {
        let store = JobStore::in_memory().unwrap();
        store.submit(&spec("x")).unwrap();
        let claimed = store.claim("w", DEFAULT_LEASE).unwrap().unwrap();
        store.succeed(&claimed.id, &serde_json::json!(0)).unwrap();
        store.submit(&spec("still-queued")).unwrap();

        let removed = store
            .purge_before(Utc::now() + Duration::seconds(1))
            .unwrap();
        assert_eq!(removed, 1);
        let left = store.list(&ListFilter::default()).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].kind, "still-queued");
    }

    #[test]
    fn the_queue_survives_reopening_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("jobs.db");
        let id = {
            let store = JobStore::open(&path).unwrap();
            store.submit(&spec("persisted")).unwrap().id
        };
        let store = JobStore::open(&path).unwrap();
        assert_eq!(store.get(&id).unwrap().kind, "persisted");
        assert_eq!(store.path(), Some(path.as_path()));
    }

    #[test]
    fn claims_match_both_handler_capabilities_and_durable_host_placement() {
        let store = JobStore::in_memory().unwrap();
        let unknown = store.submit(&spec("foreign").with_priority(100)).unwrap();
        let pc = store
            .submit(
                &spec("native")
                    .with_host_affinity(HostAffinity::Hosts(vec!["windows-local".to_owned()]))
                    .with_priority(20),
            )
            .unwrap();
        let vps = store
            .submit(&spec("native").with_host_affinity(HostAffinity::Hosts(vec!["vps".to_owned()])))
            .unwrap();
        assert!(
            store
                .claim_matching("none", Some("vps"), &[], DEFAULT_LEASE)
                .unwrap()
                .is_none()
        );
        assert!(store.claim("unplaced", DEFAULT_LEASE).unwrap().is_some());
        assert_eq!(store.get(&unknown.id).unwrap().attempts, 1);
        let chosen = store
            .claim_matching("vps-worker", Some("vps"), &["native"], DEFAULT_LEASE)
            .unwrap()
            .unwrap();
        assert_eq!(chosen.id, vps.id);
        assert_eq!(store.get(&pc.id).unwrap().attempts, 0);
        assert_eq!(
            store
                .claim_matching(
                    "pc-worker",
                    Some("windows-local"),
                    &["native"],
                    DEFAULT_LEASE
                )
                .unwrap()
                .unwrap()
                .id,
            pc.id
        );
    }

    #[test]
    fn host_affinity_survives_restart_and_legacy_schema_migration_preserves_running_work() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs.db");
        let placed;
        {
            let store = JobStore::open(&path).unwrap();
            placed = store
                .submit(&spec("x").with_host_affinity(HostAffinity::Hosts(vec!["dbfr".to_owned()])))
                .unwrap();
        }
        let legacy;
        {
            let store = JobStore::open(&path).unwrap();
            assert_eq!(
                store.get(&placed.id).unwrap().host_affinity,
                placed.host_affinity
            );
            assert!(
                store
                    .claim_matching("vps", Some("vps"), &["x"], DEFAULT_LEASE)
                    .unwrap()
                    .is_none()
            );
            legacy = store
                .claim_matching("dbfr", Some("dbfr"), &["x"], DEFAULT_LEASE)
                .unwrap()
                .unwrap();
            // Simulate the prior additive schema only in this disposable fixture.
            store
                .conn
                .execute_batch("ALTER TABLE jobs DROP COLUMN host_affinity; DROP INDEX jobs_idempotency; ALTER TABLE jobs DROP COLUMN idempotency_key; PRAGMA user_version=1;")
                .unwrap();
        }
        let upgraded = JobStore::open(&path).unwrap();
        let running = upgraded.get(&legacy.id).unwrap();
        assert_eq!(running.state, JobState::Running);
        assert_eq!(running.worker, legacy.worker);
        assert_eq!(running.payload, legacy.payload);
        assert_eq!(running.host_affinity, HostAffinity::Any);
    }

    #[test]
    fn concurrent_connections_cannot_duplicate_a_placed_claim() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs.db");
        let store = JobStore::open(&path).unwrap();
        store
            .submit(&spec("x").with_host_affinity(HostAffinity::Hosts(vec!["vps".to_owned()])))
            .unwrap();
        let a = JobStore::open(&path).unwrap();
        let b = JobStore::open(&path).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let left_barrier = std::sync::Arc::clone(&barrier);
        let left = std::thread::spawn(move || {
            left_barrier.wait();
            a.claim_matching("a", Some("vps"), &["x"], DEFAULT_LEASE)
                .unwrap()
        });
        let right = std::thread::spawn(move || {
            barrier.wait();
            b.claim_matching("b", Some("vps"), &["x"], DEFAULT_LEASE)
                .unwrap()
        });
        assert_eq!(
            usize::from(left.join().unwrap().is_some())
                + usize::from(right.join().unwrap().is_some()),
            1
        );
    }

    #[test]
    fn impossible_placement_and_nonpositive_leases_are_rejected_without_claiming() {
        let store = JobStore::in_memory().unwrap();
        assert!(
            store
                .submit(&spec("x").with_host_affinity(HostAffinity::Hosts(vec![])))
                .is_err()
        );
        assert!(
            store
                .submit(&spec("x").with_host_affinity(HostAffinity::Hosts(vec![" ".to_owned()])))
                .is_err()
        );
        let job = store.submit(&spec("x")).unwrap();
        assert!(store.claim("w", Duration::zero()).is_err());
        assert_eq!(store.get(&job.id).unwrap().attempts, 0);
    }

    #[test]
    fn a_stale_claim_cannot_heartbeat_or_finish_a_new_generation_with_the_same_worker_name() {
        let store = JobStore::in_memory().unwrap();
        let now = Utc::now();
        let job = store
            .submit_at(&spec("x").with_max_attempts(3), now)
            .unwrap();
        let old = store
            .claim_at("same-name", Duration::seconds(1), now)
            .unwrap()
            .unwrap();
        store.recover_at(now + Duration::seconds(2)).unwrap();
        let new = store
            .claim_at("same-name", DEFAULT_LEASE, now + Duration::seconds(2))
            .unwrap()
            .unwrap();
        assert_eq!(new.attempts, old.attempts + 1);
        assert!(
            !store
                .heartbeat_owned(&job.id, "same-name", old.attempts, DEFAULT_LEASE)
                .unwrap()
        );
        assert!(
            store
                .succeed_owned(
                    &job.id,
                    "same-name",
                    old.attempts,
                    &serde_json::json!({"stale":true})
                )
                .unwrap()
                .is_none()
        );
        assert!(
            store
                .fail_owned(
                    &job.id,
                    "same-name",
                    old.attempts,
                    "old error",
                    true,
                    Duration::zero()
                )
                .unwrap()
                .is_none()
        );
        assert_eq!(store.get(&job.id).unwrap().state, JobState::Running);
        store.cancel(&job.id).unwrap();
        assert!(
            store
                .succeed_owned(
                    &job.id,
                    "same-name",
                    new.attempts,
                    &serde_json::json!({"cancelled":true})
                )
                .unwrap()
                .is_none()
        );
        assert_eq!(store.get(&job.id).unwrap().state, JobState::Cancelled);
    }

    #[test]
    fn a_corrupt_row_is_reported_with_its_id_not_as_a_sql_error() {
        let store = JobStore::in_memory().unwrap();
        let job = store.submit(&spec("x")).unwrap();
        store
            .conn
            .execute(
                "UPDATE jobs SET state = 'not-a-state' WHERE id = ?1",
                params![job.id],
            )
            .unwrap();
        match store.get(&job.id).unwrap_err() {
            JobError::Corrupt { id, reason } => {
                assert_eq!(id, job.id);
                assert!(reason.contains("not-a-state"), "{reason}");
            }
            other => panic!("unexpected: {other}"),
        }
    }
}
