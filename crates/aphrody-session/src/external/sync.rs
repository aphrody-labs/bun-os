// SPDX-License-Identifier: Apache-2.0
//! The sync engine: discovery, incremental ingestion, exactly-once mirror
//! writes, live-process attribution.

use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, BufRead, BufReader, BufWriter, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::Instant,
};

use chrono::Utc;
use serde_json::Value;

use super::{
    AgentKind, AgentReport, AgentRoots, ExternalRecord, LOCK_FILE_NAME, REPORT_SCHEMA_VERSION,
    Role, SessionReport, SessionSource, SyncError, SyncIssue, SyncOptions, SyncReport, agy, claude,
    codex,
    common::{Draft, LineContext, normalize_workspace, truncate_text},
    process::{LiveAgentProcess, probe_live_processes},
    state::{HEAD_BYTES, SourceState, SyncState, head_fingerprint},
};

/// Records handed to the sink (and written) per batch; bounds memory on a
/// first run over transcripts of hundreds of megabytes.
const BATCH_RECORDS: usize = 512;

/// Every transcript of the selected agents, plus the problems met while
/// looking (unreadable directories, invalid auxiliary files).
#[must_use]
pub fn discover_sources(
    roots: &AgentRoots,
    agents: &[AgentKind],
) -> (Vec<SessionSource>, Vec<SyncIssue>) {
    let mut issues = Vec::new();
    let mut sources = Vec::new();
    for agent in AgentKind::ALL
        .into_iter()
        .filter(|agent| agents.contains(agent))
    {
        let root = roots.root(agent);
        let mut found = match agent {
            AgentKind::Agy => agy::discover(root, &mut issues),
            AgentKind::Codex => codex::discover(root, &mut issues),
            AgentKind::Claude => claude::discover(root, &mut issues),
        };
        found.sort_by(|a, b| a.path.cmp(&b.path));
        sources.extend(found);
    }
    (sources, issues)
}

/// Run one sync pass with no sink beyond the mirror itself.
///
/// # Errors
///
/// See [`sync_with`].
pub fn sync(options: &SyncOptions) -> Result<SyncReport, SyncError> {
    sync_with(options, |_| Ok(()))
}

/// Run one sync pass. `on_batch` sees every batch of new records after it is
/// written to its mirror and before its source offset is committed; an `Err`
/// rolls the mirror back and leaves the source for the next run (reported as
/// an issue, the run goes on).
///
/// # Errors
///
/// Only failures that concern the whole run: the output directory or its
/// lock cannot be created, the state file is unreadable or corrupt, or it
/// cannot be written. Everything confined to one source is a
/// [`SyncIssue`] in the report.
pub fn sync_with<F>(options: &SyncOptions, mut on_batch: F) -> Result<SyncReport, SyncError>
where
    F: FnMut(&[ExternalRecord]) -> Result<(), String>,
{
    let started = Instant::now();
    let started_at = Utc::now();
    let output_dir = options.output_dir.as_path();
    fs::create_dir_all(output_dir).map_err(SyncError::io(output_dir))?;
    let _lock = acquire_lock(&output_dir.join(LOCK_FILE_NAME))?;

    let state_path = options.state_path();
    let mut state = SyncState::load(&state_path)?;
    let agents = options.selected_agents();

    let mut report = SyncReport {
        schema_version: REPORT_SCHEMA_VERSION,
        started_at,
        duration_ms: 0,
        output_dir: output_dir.display().to_string(),
        state_path: state_path.display().to_string(),
        records_ingested: 0,
        sources_scanned: 0,
        sources_updated: 0,
        agents: agents
            .iter()
            .map(|agent| {
                let root = options.roots.root(*agent);
                AgentReport {
                    agent: *agent,
                    root: root.display().to_string(),
                    root_exists: root.is_dir(),
                    sources: 0,
                    sources_updated: 0,
                    records: 0,
                    bytes: 0,
                    malformed_lines: 0,
                }
            })
            .collect(),
        sessions: Vec::new(),
        live_processes: None,
        memory: None,
        issues: Vec::new(),
    };

    if reconcile_short_mirrors(&mut state, output_dir, &mut report.issues) {
        state.save(&state_path)?;
    }

    let (mut sources, discovery_issues) = discover_sources(&options.roots, &agents);
    report.issues.extend(discovery_issues);
    if options.domain_filter.is_some() || options.workspace_filter.is_some() {
        sources.retain(|source| match source_matches_filters(source, options) {
            Ok(matches) => matches,
            Err(error) => {
                report.issues.push(SyncIssue::new(
                    Some(source.agent),
                    Some(&source.path),
                    error.to_string(),
                ));
                false
            }
        });
    }

    let mut outcomes: Vec<SourceOutcome> = Vec::with_capacity(sources.len());
    for source in &sources {
        let outcome = match ingest_source(source, options, &mut state, &state_path, &mut on_batch) {
            Ok(outcome) => outcome,
            Err(SourceFailure::Fatal(error)) => return Err(error),
            Err(SourceFailure::Skipped(message)) => {
                report.issues.push(SyncIssue::new(
                    Some(source.agent),
                    Some(&source.path),
                    message,
                ));
                SourceOutcome::default()
            }
        };
        if let Some(agent_report) = report
            .agents
            .iter_mut()
            .find(|entry| entry.agent == source.agent)
        {
            agent_report.sources += 1;
            agent_report.records += outcome.new_records;
            agent_report.bytes += outcome.bytes;
            agent_report.malformed_lines += outcome.malformed_lines;
            if outcome.bytes > 0 {
                agent_report.sources_updated += 1;
            }
        }
        for note in &outcome.notes {
            report.issues.push(SyncIssue::new(
                Some(source.agent),
                Some(&source.path),
                note.clone(),
            ));
        }
        outcomes.push(outcome);
    }

    report.sources_scanned = sources.len() as u64;
    report.sources_updated = outcomes.iter().filter(|outcome| outcome.bytes > 0).count() as u64;
    report.records_ingested = outcomes.iter().map(|outcome| outcome.new_records).sum();

    let live = options.probe_processes.then(probe_live_processes);
    let live_pids = live
        .as_deref()
        .map(|live| attribute_live(&sources, &state, live))
        .unwrap_or_default();
    for (index, source) in sources.iter().enumerate() {
        let new_records = outcomes[index].new_records;
        let pids = live_pids.get(&index).cloned().unwrap_or_default();
        if new_records == 0 && pids.is_empty() {
            continue;
        }
        let entry = state.sources.get(&source_key(&source.path));
        report.sessions.push(SessionReport {
            agent: source.agent,
            session_id: entry.map_or_else(
                || source.session_id.clone(),
                |entry| entry.session_id.clone(),
            ),
            title: source.title.clone(),
            workspace: entry
                .and_then(|entry| entry.workspace.clone())
                .or_else(|| source.workspace.clone()),
            source_path: source.path.display().to_string(),
            mirror_path: mirror_abs(
                output_dir,
                &entry.map_or_else(
                    || mirror_rel(source.agent, &source.session_id),
                    |entry| entry.mirror.clone(),
                ),
            )
            .display()
            .to_string(),
            new_records,
            offset: entry.map_or(0, |entry| entry.offset),
            live_pids: pids,
        });
    }
    report.live_processes = live;
    report.duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    Ok(report)
}

// ---------------------------------------------------------------------------
// Locking and mirror reconciliation
// ---------------------------------------------------------------------------

fn acquire_lock(path: &Path) -> Result<File, SyncError> {
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(path)
        .map_err(SyncError::io(path))?;
    // Advisory, exclusive, released when the handle drops (end of the run).
    file.lock().map_err(SyncError::io(path))?;
    Ok(file)
}

/// A mirror shorter than its committed length was deleted or cut by hand:
/// forget it and every source feeding it, so they are ingested again from
/// the start and the mirror is rebuilt. Returns whether the state changed.
fn reconcile_short_mirrors(
    state: &mut SyncState,
    output_dir: &Path,
    issues: &mut Vec<SyncIssue>,
) -> bool {
    let short: Vec<String> = state
        .mirrors
        .iter()
        .filter(|(mirror, committed)| {
            let actual = fs::metadata(mirror_abs(output_dir, mirror)).map_or(0, |meta| meta.len());
            actual < **committed
        })
        .map(|(mirror, _)| mirror.clone())
        .collect();
    for mirror in &short {
        let path = mirror_abs(output_dir, mirror);
        if path.exists()
            && let Err(error) = OpenOptions::new()
                .write(true)
                .open(&path)
                .and_then(|file| file.set_len(0))
        {
            issues.push(SyncIssue::new(
                None,
                Some(&path),
                format!("cannot reset mirror: {error}"),
            ));
        }
        let feeders: Vec<String> = state.sources_of_mirror(mirror).cloned().collect();
        for key in feeders {
            if let Some(entry) = state.sources.get_mut(&key) {
                entry.offset = 0;
                entry.head_len = 0;
                entry.head_fnv.clear();
                entry.records = 0;
            }
        }
        state.mirrors.insert(mirror.clone(), 0);
        issues.push(SyncIssue::new(
            None,
            Some(&path),
            "mirror shorter than its committed length (deleted or truncated); rebuilding it from \
             its sources",
        ));
    }
    !short.is_empty()
}

// ---------------------------------------------------------------------------
// One source
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
struct SourceOutcome {
    new_records: u64,
    bytes: u64,
    malformed_lines: u64,
    notes: Vec<String>,
}

enum SourceFailure {
    /// The state could not be persisted: stop the run.
    Fatal(SyncError),
    /// This source is left as it was; the run goes on.
    Skipped(String),
}

/// State key of a source: the path with `/` separators, without a Windows
/// verbatim prefix, case-folded on Windows — so the same file reached through
/// `CODEX_HOME=C:/x/.codex` and `C:\x\.codex` keeps one offset instead of
/// being ingested twice.
pub(super) fn source_key(path: &Path) -> String {
    normalize_workspace(&path.display().to_string())
}

/// Mirror path of a session, relative to the output directory.
pub(super) fn mirror_rel(agent: AgentKind, session_id: &str) -> String {
    let mut name: String = session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    name = name.trim_matches('.').to_owned();
    if name.is_empty() {
        name.push_str("session");
    }
    // aphrody's own rollout listing walks this directory and claims every
    // `rollout-*.jsonl`; a mirror must never look like one.
    if name.starts_with("rollout-") {
        name.insert_str(0, "ext-");
    }
    format!("{}/{name}.jsonl", agent.as_str())
}

/// Absolute path of a mirror from its `/`-separated relative key, joined
/// component by component so it prints with native separators.
pub(super) fn mirror_abs(output_dir: &Path, rel: &str) -> PathBuf {
    rel.split('/')
        .filter(|part| !part.is_empty())
        .fold(output_dir.to_path_buf(), |path, part| path.join(part))
}

fn parse_line(agent: AgentKind, value: &Value, ctx: &mut LineContext) -> Vec<Draft> {
    match agent {
        AgentKind::Agy => agy::parse_line(value, ctx),
        AgentKind::Codex => codex::parse_line(value, ctx),
        AgentKind::Claude => claude::parse_line(value, ctx),
    }
}

fn ingest_source<F>(
    source: &SessionSource,
    options: &SyncOptions,
    state: &mut SyncState,
    state_path: &Path,
    on_batch: &mut F,
) -> Result<SourceOutcome, SourceFailure>
where
    F: FnMut(&[ExternalRecord]) -> Result<(), String>,
{
    let skipped = |what: &str, error: &dyn std::fmt::Display| {
        SourceFailure::Skipped(format!("{what}: {error}"))
    };
    let key = source_key(&source.path);
    let previous = state.sources.get(&key).cloned();
    let mut outcome = SourceOutcome::default();

    let len = fs::metadata(&source.path)
        .map_err(|error| skipped("cannot stat", &error))?
        .len();
    let session_id = previous.as_ref().map_or_else(
        || source.session_id.clone(),
        |entry| entry.session_id.clone(),
    );
    let mirror = previous.as_ref().map_or_else(
        || mirror_rel(source.agent, &session_id),
        |entry| entry.mirror.clone(),
    );
    let mut start = previous.as_ref().map_or(0, |entry| entry.offset);
    let mut restarted = false;

    if let Some(entry) = previous.as_ref().filter(|entry| entry.head_len > 0) {
        let (read, digest) = head_fingerprint(&source.path, entry.head_len)
            .map_err(|error| skipped("cannot read", &error))?;
        if read < entry.head_len || digest != entry.head_fnv {
            outcome.notes.push(
                "source was rewritten (head changed); ingesting it again from the start".into(),
            );
            start = 0;
            restarted = true;
        }
    }
    if len < start {
        outcome.notes.push(format!(
            "source shrank from {start} to {len} bytes; ingesting it again from the start"
        ));
        start = 0;
        restarted = true;
    }
    let learned_workspace = source.workspace.clone();
    if len == start && !restarted {
        // Nothing new; keep a workspace the agent's own maps learned since.
        if let (Some(workspace), Some(entry)) = (learned_workspace, state.sources.get_mut(&key))
            && entry.workspace.as_deref() != Some(workspace.as_str())
        {
            entry.workspace = Some(workspace);
        }
        return Ok(outcome);
    }

    // Open the mirror and cut back what no commit covers.
    let mirror_path = mirror_abs(&options.output_dir, &mirror);
    if let Some(parent) = mirror_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| skipped("cannot create mirror directory", &error))?;
    }
    let mut committed = state.mirrors.get(&mirror).copied().unwrap_or(0);
    let mut rebuild = false;
    if restarted {
        if state.sources_of_mirror(&mirror).all(|other| *other == key) {
            // This source alone feeds the mirror: rebuild it rather than
            // append a second copy of what the rewritten source still holds.
            committed = 0;
            rebuild = true;
        } else {
            outcome.notes.push(
                "mirror is shared with other sources; records of the previous version of this \
                 source are kept"
                    .into(),
            );
        }
    }
    let mirror_file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&mirror_path)
        .map_err(|error| skipped("cannot open mirror", &error))?;
    let actual = mirror_file
        .metadata()
        .map_err(|error| skipped("cannot stat mirror", &error))?
        .len();
    if actual < committed {
        // Shrunk after this run's reconciliation (removed by hand while the
        // run held the lock). Extending it would write zeros; the next run's
        // reconciliation rebuilds it instead.
        return Err(SourceFailure::Skipped(format!(
            "mirror {} is shorter than its committed length; it is rebuilt on the next run",
            mirror_path.display()
        )));
    }
    if actual > committed {
        if !rebuild {
            outcome.notes.push(format!(
                "mirror carried {} uncommitted bytes from an interrupted run; cut back",
                actual - committed
            ));
        }
        mirror_file
            .set_len(committed)
            .map_err(|error| skipped("cannot cut mirror back", &error))?;
    }

    let mut ctx = LineContext {
        workspace: learned_workspace.clone().or_else(|| {
            if restarted {
                None
            } else {
                previous.as_ref().and_then(|entry| entry.workspace.clone())
            }
        }),
    };
    let streamed = stream_new_lines(
        source,
        &session_id,
        start,
        options.max_text_bytes,
        options.domain_filter.as_deref(),
        &mut ctx,
        &mirror_file,
        committed,
        on_batch,
        &mut outcome,
    );
    // Any failure from here on rolls the mirror back to its committed length:
    // nothing of this source is kept and nothing is lost — its offset is
    // unchanged — and a mirror shared with another source never commits this
    // one's uncommitted tail.
    let rollback = |message: String| {
        let mut message = message;
        if let Err(error) = mirror_file.set_len(committed) {
            message.push_str(&format!(
                "; rollback of {} failed: {error}",
                mirror_path.display()
            ));
        }
        SourceFailure::Skipped(message)
    };
    let end = streamed.map_err(rollback)?;
    if end == start && !restarted {
        return Ok(outcome);
    }
    let (mirror_len, head_len, head_fnv) = mirror_file
        .sync_data()
        .map_err(|error| format!("cannot flush mirror: {error}"))
        .and_then(|()| {
            mirror_file
                .metadata()
                .map_err(|error| format!("cannot stat mirror: {error}"))
        })
        .and_then(|meta| {
            head_fingerprint(&source.path, end.min(HEAD_BYTES))
                .map(|(head_len, head_fnv)| (meta.len(), head_len, head_fnv))
                .map_err(|error| format!("cannot read: {error}"))
        })
        .map_err(rollback)?;

    let records_before = if restarted {
        0
    } else {
        previous.as_ref().map_or(0, |entry| entry.records)
    };
    state.mirrors.insert(mirror.clone(), mirror_len);
    state.sources.insert(
        key,
        SourceState {
            agent: source.agent,
            session_id,
            workspace: ctx.workspace,
            offset: end,
            head_len,
            head_fnv,
            mirror,
            records: records_before + outcome.new_records,
            updated_at: Some(Utc::now()),
        },
    );
    state.save(state_path).map_err(SourceFailure::Fatal)?;
    outcome.bytes = end.saturating_sub(start);
    Ok(outcome)
}

/// Read the complete lines of `source` from `start`, write their records to
/// `mirror` in batches and hand each batch to `on_batch`. Returns the offset
/// just past the last complete line; a trailing line without its newline is
/// not consumed.
#[allow(clippy::too_many_arguments)]
fn stream_new_lines<F>(
    source: &SessionSource,
    session_id: &str,
    start: u64,
    max_text_bytes: usize,
    domain_filter: Option<&str>,
    ctx: &mut LineContext,
    mirror: &File,
    mirror_start: u64,
    on_batch: &mut F,
    outcome: &mut SourceOutcome,
) -> Result<u64, String>
where
    F: FnMut(&[ExternalRecord]) -> Result<(), String>,
{
    let read_error = |error: io::Error| format!("cannot read {}: {error}", source.path.display());
    let write_error = |error: io::Error| format!("cannot write mirror: {error}");

    let file = File::open(&source.path).map_err(read_error)?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    reader.seek(SeekFrom::Start(start)).map_err(read_error)?;
    let mut writer = BufWriter::with_capacity(64 * 1024, mirror);
    writer
        .seek(SeekFrom::Start(mirror_start))
        .map_err(write_error)?;

    let source_path = source.path.display().to_string();
    let mut position = start;
    let mut line = Vec::with_capacity(4096);
    let mut batch: Vec<ExternalRecord> = Vec::with_capacity(BATCH_RECORDS);
    loop {
        line.clear();
        let read = reader.read_until(b'\n', &mut line).map_err(read_error)?;
        if read == 0 || line.last() != Some(&b'\n') {
            // End of file, or a line still being written.
            break;
        }
        let line_offset = position;
        position += read as u64;
        let trimmed = line.trim_ascii();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_slice::<Value>(trimmed) else {
            outcome.malformed_lines += 1;
            continue;
        };
        for (part, draft) in parse_line(source.agent, &value, ctx)
            .into_iter()
            .enumerate()
        {
            if draft.role == Role::User
                && let Some(expected) = domain_filter
                && let Some(rest) = draft.text.strip_prefix("[APHRODY_AGENT_DOMAIN=")
                && let Some((observed, _)) = rest.split_once(']')
                && observed != expected
            {
                return Err("transcript domain changed during ingestion".into());
            }
            let (text, truncated) = truncate_text(draft.text, max_text_bytes);
            batch.push(ExternalRecord {
                agent: source.agent,
                session_id: session_id.to_owned(),
                workspace: ctx.workspace.clone(),
                ts: draft.ts,
                role: draft.role,
                text,
                source_path: source_path.clone(),
                offset: line_offset,
                part: u32::try_from(part).unwrap_or(u32::MAX),
                truncated,
            });
        }
        if batch.len() >= BATCH_RECORDS {
            flush_batch(&mut writer, &mut batch, on_batch, outcome)?;
        }
    }
    flush_batch(&mut writer, &mut batch, on_batch, outcome)?;
    Ok(position)
}

fn flush_batch<W, F>(
    writer: &mut W,
    batch: &mut Vec<ExternalRecord>,
    on_batch: &mut F,
    outcome: &mut SourceOutcome,
) -> Result<(), String>
where
    W: Write,
    F: FnMut(&[ExternalRecord]) -> Result<(), String>,
{
    if batch.is_empty() {
        return Ok(());
    }
    for record in batch.iter() {
        serde_json::to_writer(&mut *writer, record)
            .map_err(|error| format!("cannot encode record: {error}"))?;
        writer
            .write_all(b"\n")
            .map_err(|error| format!("cannot write mirror: {error}"))?;
    }
    writer
        .flush()
        .map_err(|error| format!("cannot write mirror: {error}"))?;
    on_batch(batch).map_err(|error| format!("record sink rejected a batch: {error}"))?;
    outcome.new_records += batch.len() as u64;
    batch.clear();
    Ok(())
}

// ---------------------------------------------------------------------------
// Scan explicit transcript provenance before writing or feeding any record.
fn source_matches_filters(source: &SessionSource, options: &SyncOptions) -> io::Result<bool> {
    let mut context = LineContext {
        workspace: source.workspace.clone(),
    };
    let mut domains = std::collections::HashSet::new();
    let mut first_user_domain = None;
    let mut saw_user = false;
    for line in BufReader::new(File::open(&source.path)?).lines() {
        let line = line?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        for draft in parse_line(source.agent, &value, &mut context) {
            if draft.role == Role::User {
                if !saw_user {
                    saw_user = true;
                    first_user_domain = draft
                        .text
                        .strip_prefix("[APHRODY_AGENT_DOMAIN=")
                        .and_then(|rest| rest.split_once(']'))
                        .map(|(domain, _)| domain.to_owned());
                }
                if let Some(rest) = draft.text.strip_prefix("[APHRODY_AGENT_DOMAIN=")
                    && let Some((domain, _)) = rest.split_once(']')
                {
                    domains.insert(domain.to_owned());
                }
            }
        }
    }
    let domain_matches = options.domain_filter.as_ref().is_none_or(|domain| {
        first_user_domain.as_ref() == Some(domain) && domains.len() == 1 && domains.contains(domain)
    });
    let workspace_matches = options.workspace_filter.as_ref().is_none_or(|workspace| {
        context.workspace.as_ref().is_some_and(|observed| {
            normalize_workspace(observed) == normalize_workspace(&workspace.to_string_lossy())
        })
    });
    Ok(domain_matches && workspace_matches)
}

// Live processes -> sessions
// ---------------------------------------------------------------------------

/// Attribute each live process to the session it is most likely writing:
/// among the sources of its agent whose workspace is the process's working
/// directory, the one the agent names current (agy), else the most recently
/// modified. Returns source index -> pids.
fn attribute_live(
    sources: &[SessionSource],
    state: &SyncState,
    live: &[LiveAgentProcess],
) -> HashMap<usize, Vec<u32>> {
    let mut best: HashMap<(AgentKind, String), usize> = HashMap::new();
    for (index, source) in sources.iter().enumerate() {
        let workspace = state
            .sources
            .get(&source_key(&source.path))
            .and_then(|entry| entry.workspace.clone())
            .or_else(|| source.workspace.clone());
        let Some(workspace) = workspace else { continue };
        let slot = best
            .entry((source.agent, normalize_workspace(&workspace)))
            .or_insert(index);
        let incumbent = &sources[*slot];
        let better = (source.current, source.modified) > (incumbent.current, incumbent.modified);
        if better {
            *slot = index;
        }
    }
    let mut attributed: HashMap<usize, Vec<u32>> = HashMap::new();
    for process in live {
        let Some(cwd) = process.cwd.as_deref() else {
            continue;
        };
        if let Some(index) = best.get(&(process.agent, normalize_workspace(cwd))) {
            attributed.entry(*index).or_default().push(process.pid);
        }
    }
    attributed
}

#[cfg(test)]
mod domain_isolation_tests {
    use super::*;
    #[test]
    fn same_checkout_sessions_require_one_matching_user_domain() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollout-domain.jsonl");
        let source = SessionSource {
            agent: AgentKind::Codex,
            path: path.clone(),
            session_id: "fixture".into(),
            workspace: None,
            title: None,
            current: false,
            modified: None,
        };
        let options = SyncOptions::new(AgentRoots::from_home(dir.path()), dir.path().join("out"))
            .with_domain("ie")
            .with_workspace("/repo");
        let write = |domains: &[&str], role: &str| {
            let mut lines = vec![
                serde_json::json!({"type":"session_meta","payload":{"cwd":"/repo"}}).to_string(),
            ];
            for domain in domains {
                lines.push(serde_json::json!({"type":"response_item","payload":{"type":"message","role":role,"content":[{"type":"input_text","text":format!("[APHRODY_AGENT_DOMAIN={domain}]\ntask")} ]}}).to_string());
            }
            fs::write(&path, lines.join("\n") + "\n").unwrap();
        };
        write(&["ie"], "user");
        assert!(source_matches_filters(&source, &options).unwrap());
        write(&["aphrody"], "user");
        assert!(!source_matches_filters(&source, &options).unwrap());
        write(&[], "user");
        assert!(!source_matches_filters(&source, &options).unwrap());
        write(&["ie", "aphrody"], "user");
        assert!(!source_matches_filters(&source, &options).unwrap());
        let mirror = File::create(dir.path().join("mirror.jsonl")).unwrap();
        let mut context = LineContext::default();
        let mut outcome = SourceOutcome::default();
        let mut fed = Vec::new();
        let result = stream_new_lines(
            &source,
            "fixture",
            0,
            0,
            Some("ie"),
            &mut context,
            &mirror,
            0,
            &mut |records: &[ExternalRecord]| {
                fed.extend(records.iter().cloned());
                Ok(())
            },
            &mut outcome,
        );
        assert!(result.is_err());
        assert!(
            fed.is_empty(),
            "cross-domain records must not reach the memory sink"
        );
        write(&["ie"], "user");
        let tagged = fs::read_to_string(&path).unwrap();
        let unknown = serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"untagged earlier task"}]}}).to_string();
        let bootstrap = serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions"}],"internal_chat_message_metadata_passthrough":{"content_item_kinds":["agents_md.instructions","environments.environment_context"]}}}).to_string();
        write(&["ie"], "user");
        let original = std::fs::read_to_string(&path).unwrap();
        std::fs::write(&path, format!("{bootstrap}\n{original}")).unwrap();
        assert!(source_matches_filters(&source, &options).unwrap());
        fs::write(&path, format!("{unknown}\n{tagged}")).unwrap();
        assert!(!source_matches_filters(&source, &options).unwrap());
        write(&["ie"], "assistant");
        assert!(!source_matches_filters(&source, &options).unwrap());
        write(&["ie"], "user");
        assert!(!source_matches_filters(&source, &options.with_workspace("/other")).unwrap());
    }
}
