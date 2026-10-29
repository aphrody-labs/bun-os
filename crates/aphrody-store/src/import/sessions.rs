// SPDX-License-Identifier: Apache-2.0
//! Session index importer: records metadata (agent, id, size, line count, mtime) of the JSONL
//! transcripts under a sessions directory. Transcript text is **never** read into the database
//! by this importer (only newline bytes are counted); the JSONL files stay the transcript store.

use std::{
    fs::File,
    io::Read as _,
    path::{Path, PathBuf},
};

use rusqlite::params;

use super::ImportReport;
use crate::{db::HomeDb, error::Result};

const MIRROR_AGENTS: &[&str] = &["codex", "agy", "claude"];

struct Found {
    agent: String,
    id: String,
    rel: String,
    bytes: u64,
    mtime_ms: i64,
    path: PathBuf,
}

fn collect(dir: &Path, root: &Path, agent: Option<&str>, out: &mut Vec<Found>) -> Result<()> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if meta.is_dir() {
            let next = match (agent, dir == root) {
                (None, true) if MIRROR_AGENTS.contains(&name.as_str()) => Some(name.clone()),
                (None, _) => None,
                (Some(a), _) => Some(a.to_owned()),
            };
            collect(&path, root, next.as_deref().or(agent), out)?;
        } else if name.ends_with(".jsonl") {
            let stem = name.trim_end_matches(".jsonl").to_owned();
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(0));
            out.push(Found {
                agent: agent.unwrap_or("aphrody").to_owned(),
                id: stem,
                rel,
                bytes: meta.len(),
                mtime_ms,
                path,
            });
        }
    }
    Ok(())
}

fn count_lines(path: &Path) -> std::io::Result<u64> {
    let mut file = File::open(path)?;
    let mut buffer = vec![0_u8; 1 << 20];
    let mut lines = 0_u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            return Ok(lines);
        }
        lines += buffer[..read].iter().filter(|b| **b == b'\n').count() as u64;
    }
}

/// Plan the session index without writing: which transcripts are new, changed or unchanged
/// compared with the stored rows (by size). Works on a read-only database.
///
/// # Errors
///
/// SQLite failures.
pub fn plan_sessions(db: &HomeDb, sessions_dir: &Path) -> Result<ImportReport> {
    let mut report = ImportReport::new("sessions", true);
    let mut found = Vec::new();
    collect(sessions_dir, sessions_dir, None, &mut found)?;
    report.add("files_found", found.len() as u64);
    let mut stored = db
        .conn
        .prepare("SELECT source_bytes FROM sessions WHERE agent = ?1 AND id = ?2")?;
    for file in &found {
        let existing: Option<Option<i64>> = stored
            .query_row(params![file.agent, file.id], |r| r.get(0))
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        let key = match existing {
            None => "new",
            Some(bytes) if bytes == i64::try_from(file.bytes).ok() => "unchanged",
            Some(_) => "changed",
        };
        report.add(key, 1);
    }
    Ok(report)
}

/// Index the transcripts under `sessions_dir` into `sessions` (metadata only).
///
/// `domain` labels every row (the profile name, or `None` for the global home).
///
/// # Errors
///
/// SQLite failures; unreadable files are counted in `unreadable` and skipped.
pub fn import_sessions(
    db: &mut HomeDb,
    sessions_dir: &Path,
    domain: Option<&str>,
    apply: bool,
) -> Result<ImportReport> {
    let mut report = ImportReport::new("sessions", !apply);
    let mut found = Vec::new();
    collect(sessions_dir, sessions_dir, None, &mut found)?;
    report.add("files_found", found.len() as u64);
    let tx = db.conn.transaction()?;
    {
        let mut insert = tx.prepare(
            "INSERT INTO sessions (agent, id, domain, ended_at_ms, source_path, source_bytes, records)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(agent, id) DO UPDATE SET ended_at_ms = excluded.ended_at_ms,
                 source_path = excluded.source_path, source_bytes = excluded.source_bytes,
                 records = excluded.records
             WHERE sessions.source_bytes IS NOT excluded.source_bytes",
        )?;
        for file in &found {
            let Ok(lines) = count_lines(&file.path) else {
                report.add("unreadable", 1);
                continue;
            };
            let changed = insert.execute(params![
                file.agent,
                file.id,
                domain,
                file.mtime_ms,
                file.rel,
                i64::try_from(file.bytes).unwrap_or(i64::MAX),
                i64::try_from(lines).unwrap_or(i64::MAX)
            ])?;
            report.add(
                if changed == 1 {
                    "indexed_or_updated"
                } else {
                    "unchanged"
                },
                1,
            );
            report.add(&format!("agent:{}", file.agent), 1);
        }
    }
    if apply {
        tx.commit()?;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcripts_are_indexed_by_metadata_and_never_copied() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("codex")).unwrap();
        std::fs::create_dir_all(root.join("2026/09")).unwrap();
        std::fs::write(
            root.join("codex/abc.jsonl"),
            "{\"secret\":1}\n{\"secret\":2}\n",
        )
        .unwrap();
        std::fs::write(root.join("2026/09/n1.jsonl"), "{}\n").unwrap();
        std::fs::write(root.join("note.txt"), "ignored").unwrap();
        let mut db = HomeDb::open_in_memory().unwrap();

        let dry = import_sessions(&mut db, root, Some("docs"), false).unwrap();
        assert_eq!(dry.counts["files_found"], 2);
        assert_eq!(
            db.conn()
                .query_row::<i64, _, _>("SELECT count(*) FROM sessions", [], |r| r.get(0))
                .unwrap(),
            0
        );

        let applied = import_sessions(&mut db, root, Some("docs"), true).unwrap();
        assert_eq!(applied.counts["agent:codex"], 1);
        assert_eq!(applied.counts["agent:aphrody"], 1);
        let (records, domain): (i64, String) = db
            .conn()
            .query_row(
                "SELECT records, domain FROM sessions WHERE agent = 'codex'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((records, domain.as_str()), (2, "docs"));
        let messages: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(messages, 0);
        let again = import_sessions(&mut db, root, Some("docs"), true).unwrap();
        assert_eq!(again.counts["unchanged"], 2);
    }
}
