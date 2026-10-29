// SPDX-License-Identifier: Apache-2.0
//! Command line of the home database (`aphrody home`): status, verified backups and the
//! legacy importers. JSON on stdout, never row content. Every importer is a dry run unless
//! `--apply` is given, and `--apply` always takes a verified backup of an existing database
//! first.

use std::{ffi::OsString, path::PathBuf};

use clap::{Args, Parser, Subcommand};

use crate::{
    HomeDb, HomeLayout, HomeScope,
    error::Result,
    import::{graphify, memory, rag, sessions},
    time::now_ms,
};

/// Home selection shared by every verb that opens the home database.
#[derive(Debug, Clone, Args)]
pub struct StoreArgs {
    /// Domain profile (`aphrody`, `ie`...); omitted selects the global home.
    #[arg(long, global = true)]
    pub profile: Option<String>,
    /// Explicit state root (default: `$APHRODY_HOME` or `~/.aphrody`).
    #[arg(long, global = true)]
    pub state: Option<PathBuf>,
}

impl StoreArgs {
    /// Resolve the layout of the selected home.
    ///
    /// # Errors
    ///
    /// Home resolution failures.
    pub fn layout(&self) -> Result<HomeLayout> {
        let scope = HomeScope::from_profile(self.profile.as_deref());
        match &self.state {
            Some(state) => HomeLayout::in_state(state, &scope),
            None => HomeLayout::resolve(&scope),
        }
    }
}

/// Home database tooling.
#[derive(Debug, Parser)]
#[command(name = "aphrody home", version, about)]
pub struct Cli {
    #[command(flatten)]
    store: StoreArgs,
    #[command(subcommand)]
    command: Command,
}

/// Verbs of the home database.
#[derive(Debug, Subcommand)]
pub enum Command {
    /// Print the layout, schema version and table counts.
    Status,
    /// Write a checksum-verified backup into the unique backup tree.
    Backup {
        /// Free text recorded in the ledger.
        #[arg(long, default_value = "manual")]
        reason: String,
    },
    /// Verify and synchronise the home database: integrity, backup ledger and the session index
    /// (preview by default; `--apply` takes a verified backup first).
    Sync {
        /// Write instead of previewing.
        #[arg(long)]
        apply: bool,
    },
    /// Import legacy stores (dry run unless `--apply`).
    Import {
        /// Write instead of counting.
        #[arg(long)]
        apply: bool,
        #[command(subcommand)]
        what: ImportWhat,
    },
}

/// Importable legacy stores.
#[derive(Debug, Subcommand)]
pub enum ImportWhat {
    /// A Graphify `graph.json`.
    Graphify {
        /// Path of `graph.json`.
        path: PathBuf,
        /// Source label (default `graph:<file stem of the parent>`).
        #[arg(long)]
        label: Option<String>,
    },
    /// A memory database (`memory_records` or `memory_items`).
    Memory {
        /// Legacy SQLite file.
        path: PathBuf,
    },
    /// A legacy RAG database.
    Rag {
        /// Legacy SQLite file.
        path: PathBuf,
    },
    /// A sessions directory (metadata only).
    Sessions {
        /// Directory (default: `<home>/sessions`).
        path: Option<PathBuf>,
    },
}

fn open_for_write(layout: &HomeLayout, apply: bool, reason: &str) -> Result<HomeDb> {
    if !apply {
        // Dry runs never touch the real file: they migrate a private in-memory copy.
        return HomeDb::open_in_memory();
    }
    if layout.db_path.exists() {
        let existing = HomeDb::open_path(&layout.db_path)?;
        existing.backup(&layout.backup_dir(now_ms()), &layout.scope.label(), reason)?;
        return Ok(existing);
    }
    HomeDb::open_path(&layout.db_path)
}

fn sync(layout: &HomeLayout, profile: Option<&str>, apply: bool) -> Result<serde_json::Value> {
    let sessions_dir = layout.home.join("sessions");
    let ro = HomeDb::open_read_only(&layout.db_path)?;
    let latest = crate::db::migrations()?.latest_version().unwrap_or(0);
    let current = ro.schema_version()?;
    let integrity = ro
        .integrity_check()
        .map(|()| "ok".to_owned())
        .unwrap_or_else(|e| e.to_string());
    let ledger = ro.verify_ledger()?;
    let plan = sessions::plan_sessions(&ro, &sessions_dir)?;
    drop(ro);
    let mut out = serde_json::json!({
        "mode": if apply { "apply" } else { "preview" },
        "db": layout.db_path,
        "schema": { "current": current, "latest": latest },
        "integrity": integrity,
        "backups": ledger,
        "sessions": plan,
    });
    if apply {
        if integrity != "ok" {
            return Err(crate::error::StoreError::Integrity(integrity));
        }
        let mut db = open_for_write(layout, true, "pre-sync")?;
        let applied = sessions::import_sessions(&mut db, &sessions_dir, profile, true)?;
        db.set_sync("sessions", "last_sync_ms", &now_ms().to_string(), None)?;
        out["applied"] = serde_json::to_value(applied)?;
        out["schema"]["current"] = db.schema_version()?.into();
    }
    Ok(out)
}

/// Run one verb of the home database.
///
/// # Errors
///
/// Home, database or importer failures.
pub fn run(store: &StoreArgs, command: &Command) -> Result<serde_json::Value> {
    let layout = store.layout()?;
    match command {
        Command::Status => {
            let exists = layout.db_path.exists();
            let mut out = serde_json::json!({
                "scope": layout.scope.label(),
                "home": layout.home,
                "db": layout.db_path,
                "exists": exists,
            });
            if exists {
                let db = HomeDb::open_read_only(&layout.db_path)?;
                out["schema_version"] = db.schema_version()?.into();
                let mut tables = serde_json::Map::new();
                for table in [
                    "sources",
                    "files",
                    "docs",
                    "chunks",
                    "vectors",
                    "graph_nodes",
                    "graph_edges",
                    "memories",
                    "sessions",
                    "messages",
                    "backups",
                ] {
                    let n: Option<i64> = db
                        .conn()
                        .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                        .ok();
                    if let Some(n) = n {
                        tables.insert(table.to_owned(), n.into());
                    }
                }
                out["tables"] = tables.into();
            }
            Ok(out)
        }
        Command::Sync { apply } => sync(&layout, store.profile.as_deref(), *apply),
        Command::Backup { reason } => {
            let db = HomeDb::open_path(&layout.db_path)?;
            let report = db.backup(&layout.backup_dir(now_ms()), &layout.scope.label(), reason)?;
            Ok(serde_json::to_value(report)?)
        }
        Command::Import { apply, what } => {
            let mut db = open_for_write(&layout, *apply, "pre-import")?;
            let report = match what {
                ImportWhat::Graphify { path, label } => {
                    let label = label.clone().unwrap_or_else(|| {
                        let name = path
                            .parent()
                            .and_then(|p| p.parent())
                            .and_then(|p| p.file_name())
                            .map_or_else(
                                || "graph".to_owned(),
                                |n| n.to_string_lossy().into_owned(),
                            );
                        format!("graph:{name}")
                    });
                    graphify::import_graph_json(&mut db, path, &label, None, *apply)?
                }
                ImportWhat::Memory { path } => {
                    let origin = format!(
                        "legacy:{}",
                        path.file_name()
                            .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
                    );
                    memory::import_memories(&mut db, path, &origin, *apply)?
                }
                ImportWhat::Rag { path } => {
                    let label = format!(
                        "legacy-rag:{}",
                        path.file_name()
                            .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
                    );
                    rag::import_rag(&mut db, path, &label, *apply)?
                }
                ImportWhat::Sessions { path } => {
                    let dir = path.clone().unwrap_or_else(|| layout.home.join("sessions"));
                    sessions::import_sessions(&mut db, &dir, store.profile.as_deref(), *apply)?
                }
            };
            Ok(serde_json::to_value(report)?)
        }
    }
}

/// Entry point of `aphrody home` (multi-call convention: `args[0]` is the invocation name).
#[must_use]
pub fn cli_main(args: Vec<OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(error) => {
            let _ = error.print();
            return i32::from(error.use_stderr());
        }
    };
    match run(&cli.store, &cli.command) {
        Ok(value) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&value).unwrap_or_default()
            );
            0
        }
        Err(error) => {
            eprintln!("aphrody home: {error}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(state: &std::path::Path) -> StoreArgs {
        StoreArgs {
            profile: Some("ie".into()),
            state: Some(state.to_path_buf()),
        }
    }

    #[test]
    fn sync_previews_without_writing_and_applies_with_a_verified_backup() {
        let state = tempfile::tempdir().unwrap();
        let layout = args(state.path()).layout().unwrap();
        // A home with one database and one transcript.
        drop(HomeDb::open_path(&layout.db_path).unwrap());
        std::fs::create_dir_all(layout.home.join("sessions/codex")).unwrap();
        std::fs::write(layout.home.join("sessions/codex/s1.jsonl"), "{}\n{}\n").unwrap();
        let before = std::fs::read(&layout.db_path).unwrap();

        let preview = run(&args(state.path()), &Command::Sync { apply: false }).unwrap();
        assert_eq!(preview["mode"], "preview");
        assert_eq!(preview["integrity"], "ok");
        assert_eq!(preview["sessions"]["counts"]["new"], 1);
        assert_eq!(
            std::fs::read(&layout.db_path).unwrap(),
            before,
            "a preview must not touch the database"
        );
        assert!(
            !layout.state.join("private").exists(),
            "a preview must not create backups"
        );

        let applied = run(&args(state.path()), &Command::Sync { apply: true }).unwrap();
        assert_eq!(applied["mode"], "apply");
        assert_eq!(applied["applied"]["counts"]["indexed_or_updated"], 1);
        let backups = layout.backup_dir(now_ms());
        let produced: Vec<_> = std::fs::read_dir(&backups).unwrap().flatten().collect();
        assert!(
            produced
                .iter()
                .any(|e| e.file_name().to_string_lossy().ends_with(".sqlite"))
        );
        assert!(
            produced
                .iter()
                .any(|e| e.file_name().to_string_lossy().ends_with(".sha256"))
        );

        let again = run(&args(state.path()), &Command::Sync { apply: false }).unwrap();
        assert_eq!(again["sessions"]["counts"]["unchanged"], 1);
        assert_eq!(again["backups"]["verified"], 1);
    }

    #[test]
    fn sync_without_a_database_is_an_error_not_a_creation() {
        let state = tempfile::tempdir().unwrap();
        assert!(run(&args(state.path()), &Command::Sync { apply: false }).is_err());
        assert!(!args(state.path()).layout().unwrap().db_path.exists());
    }
}
