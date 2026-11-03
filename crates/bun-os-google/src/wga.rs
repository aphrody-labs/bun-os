// SPDX-License-Identifier: Apache-2.0
//! Windows Google App (WGA) & Desktop Assistant clean-room Rust implementation.
//!
//! Provides:
//! 1. Protobuf text format (`global_preferences.txtpb`) parser and serializer.
//! 2. SQLite FTS5 local files indexer (`local_files.db`).
//! 3. Unified suggestion types (local files, Drive, web search, settings, apps).
//! 4. Windows Copilot Key Provider and `wga://` protocol dispatcher.
//! 5. Google Lens multimodal query generation.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Error type for WGA operations.
#[derive(Debug)]
pub enum WgaError {
    ParseError(String),
    IoError(std::io::Error),
    #[cfg(feature = "search-cache")]
    DatabaseError(rusqlite::Error),
    InvalidUri(String),
}

impl fmt::Display for WgaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ParseError(msg) => write!(f, "WGA parse error: {msg}"),
            Self::IoError(err) => write!(f, "WGA IO error: {err}"),
            #[cfg(feature = "search-cache")]
            Self::DatabaseError(err) => write!(f, "WGA database error: {err}"),
            Self::InvalidUri(uri) => write!(f, "WGA invalid URI: {uri}"),
        }
    }
}

impl std::error::Error for WgaError {}

impl From<std::io::Error> for WgaError {
    fn from(err: std::io::Error) -> Self {
        Self::IoError(err)
    }
}

#[cfg(feature = "search-cache")]
impl From<rusqlite::Error> for WgaError {
    fn from(err: rusqlite::Error) -> Self {
        Self::DatabaseError(err)
    }
}

// -----------------------------------------------------------------------------
// Preferences & Identity (`global_preferences.txtpb`)
// -----------------------------------------------------------------------------

/// Single user profile declared in `global_preferences.txtpb`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WgaProfile {
    pub profile_id: String,
    pub display_name: String,
    pub avatar_url: String,
    pub email: String,
}

/// Global preferences for WGA desktop app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct WgaPreferences {
    pub last_active_profile_id: String,
    pub profiles: Vec<WgaProfile>,
    pub first_run_timestamp_sec: u64,
}

impl WgaPreferences {
    /// Parse from protobuf text format (`.txtpb`).
    pub fn parse_txtpb(input: &str) -> Result<Self, WgaError> {
        let mut prefs = Self::default();
        let mut current_profile: Option<WgaProfile> = None;

        for line in input.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            if line.starts_with("profiles {") {
                current_profile = Some(WgaProfile {
                    profile_id: String::new(),
                    display_name: String::new(),
                    avatar_url: String::new(),
                    email: String::new(),
                });
                continue;
            }

            if line == "}" {
                if let Some(prof) = current_profile.take() {
                    prefs.profiles.push(prof);
                }
                continue;
            }

            if let Some((k, v)) = line.split_once(':') {
                let k = k.trim();
                let v = v.trim().trim_matches('"');
                match k {
                    "last_active_profile_id" => prefs.last_active_profile_id = v.to_string(),
                    "first_run_timestamp_sec" => {
                        prefs.first_run_timestamp_sec = v.parse().unwrap_or(0);
                    }
                    "profile_id" => {
                        if let Some(ref mut p) = current_profile {
                            p.profile_id = v.to_string();
                        }
                    }
                    "display_name" => {
                        if let Some(ref mut p) = current_profile {
                            p.display_name = v.to_string();
                        }
                    }
                    "avatar_url" => {
                        if let Some(ref mut p) = current_profile {
                            p.avatar_url = v.to_string();
                        }
                    }
                    "email" => {
                        if let Some(ref mut p) = current_profile {
                            p.email = v.to_string();
                        }
                    }
                    _ => {}
                }
            }
        }

        Ok(prefs)
    }

    /// Serialize to protobuf text format (`.txtpb`).
    pub fn to_txtpb(&self) -> String {
        let mut out = String::new();
        if !self.last_active_profile_id.is_empty() {
            out.push_str(&format!(
                "last_active_profile_id: \"{}\"\n",
                self.last_active_profile_id
            ));
        }
        for p in &self.profiles {
            out.push_str("profiles {\n");
            out.push_str(&format!("  profile_id: \"{}\"\n", p.profile_id));
            out.push_str(&format!("  display_name: \"{}\"\n", p.display_name));
            out.push_str(&format!("  avatar_url: \"{}\"\n", p.avatar_url));
            out.push_str(&format!("  email: \"{}\"\n", p.email));
            out.push_str("}\n");
        }
        if self.first_run_timestamp_sec > 0 {
            out.push_str(&format!(
                "first_run_timestamp_sec: {}\n",
                self.first_run_timestamp_sec
            ));
        }
        out
    }
}

// -----------------------------------------------------------------------------
// Suggestions & Unified Search
// -----------------------------------------------------------------------------

/// Canonical suggestion types matching WGA desktop suggestion categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WgaSuggestionType {
    LocalFile,
    WebSearch,
    WebHistory,
    LocalApp,
    WindowsSetting,
    GoogleDriveFile,
    Website,
    LensMultimodal,
    AnswerWeather,
    AnswerTranslation,
    AnswerFinance,
    Unknown,
}

/// Unified search suggestion result item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WgaSuggestion {
    pub title: String,
    pub subtitle: String,
    pub suggestion_type: WgaSuggestionType,
    pub action_target: String,
    pub score: f32,
}

// -----------------------------------------------------------------------------
// Local Files Model & SQLite FTS5 Indexer (`local_files.db`)
// -----------------------------------------------------------------------------

/// Record in `local_files` table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WgaLocalFile {
    pub file_id: Option<i64>,
    pub file_path: String,
    pub parent_path: String,
    pub filename: String,
    pub extension: String,
    pub is_directory: bool,
    pub is_users_directory: bool,
    pub last_modified: i64,
}

#[cfg(feature = "search-cache")]
/// SQLite FTS5 database manager for WGA local files index (`local_files.db`).
pub struct LocalFilesDb {
    conn: rusqlite::Connection,
}

#[cfg(feature = "search-cache")]
impl LocalFilesDb {
    /// Open SQLite database at given path.
    pub fn open(path: &std::path::Path) -> Result<Self, WgaError> {
        let conn = rusqlite::Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
        Ok(Self { conn })
    }

    /// Open in-memory database for testing.
    pub fn open_in_memory() -> Result<Self, WgaError> {
        let conn = rusqlite::Connection::open_in_memory()?;
        Ok(Self { conn })
    }

    /// Initialize exact schema matching WGA's `local_files.db`.
    pub fn init_schema(&self) -> Result<(), WgaError> {
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS local_files (
              file_id INTEGER PRIMARY KEY AUTOINCREMENT,
              file_path TEXT UNIQUE COLLATE NOCASE,
              parent_path TEXT,
              filename TEXT,
              extension TEXT,
              is_directory INTEGER,
              is_users_directory INTEGER,
              last_modified INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_parent_path ON local_files(parent_path);
            CREATE VIRTUAL TABLE IF NOT EXISTS local_files_fts USING fts5(
              file_path,
              filename,
              content='local_files',
              content_rowid='file_id'
            );
            CREATE TRIGGER IF NOT EXISTS local_files_ai AFTER INSERT ON local_files BEGIN
              INSERT INTO local_files_fts(rowid, file_path, filename) VALUES (new.file_id, new.file_path, new.filename);
            END;
            CREATE TRIGGER IF NOT EXISTS local_files_ad AFTER DELETE ON local_files BEGIN
              INSERT INTO local_files_fts(local_files_fts, rowid, file_path, filename) VALUES('delete', old.file_id, old.file_path, old.filename);
            END;
            CREATE TRIGGER IF NOT EXISTS local_files_au AFTER UPDATE ON local_files BEGIN
              INSERT INTO local_files_fts(local_files_fts, rowid, file_path, filename) VALUES('delete', old.file_id, old.file_path, old.filename);
              INSERT INTO local_files_fts(rowid, file_path, filename) VALUES (new.file_id, new.file_path, new.filename);
            END;
            "#,
        )?;
        Ok(())
    }

    /// Insert or update a file record.
    pub fn upsert_file(&self, file: &WgaLocalFile) -> Result<(), WgaError> {
        self.conn.execute(
            r#"
            INSERT INTO local_files (file_path, parent_path, filename, extension, is_directory, is_users_directory, last_modified)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(file_path) DO UPDATE SET
              parent_path = excluded.parent_path,
              filename = excluded.filename,
              extension = excluded.extension,
              is_directory = excluded.is_directory,
              is_users_directory = excluded.is_users_directory,
              last_modified = excluded.last_modified;
            "#,
            rusqlite::params![
                file.file_path,
                file.parent_path,
                file.filename,
                file.extension,
                file.is_directory as i32,
                file.is_users_directory as i32,
                file.last_modified,
            ],
        )?;
        Ok(())
    }

    /// Search files by keyword using SQLite FTS5.
    pub fn search_fts(&self, query: &str, limit: usize) -> Result<Vec<WgaLocalFile>, WgaError> {
        // Sanitize query tokens for FTS5 prefix search
        let sanitized: Vec<String> = query
            .split_whitespace()
            .map(|tok| {
                let clean = tok.replace('"', "").replace('*', "");
                format!("\"{clean}\"*")
            })
            .collect();

        if sanitized.is_empty() {
            return Ok(Vec::new());
        }

        let fts_query = sanitized.join(" ");
        let mut stmt = self.conn.prepare(
            r#"
            SELECT f.file_id, f.file_path, f.parent_path, f.filename, f.extension,
                   f.is_directory, f.is_users_directory, f.last_modified
            FROM local_files_fts match_fts
            JOIN local_files f ON f.file_id = match_fts.rowid
            WHERE local_files_fts MATCH ?1
            ORDER BY rank
            LIMIT ?2;
            "#,
        )?;

        let rows = stmt.query_map(rusqlite::params![fts_query, limit as i64], |row| {
            Ok(WgaLocalFile {
                file_id: Some(row.get(0)?),
                file_path: row.get(1)?,
                parent_path: row.get(2)?,
                filename: row.get(3)?,
                extension: row.get(4)?,
                is_directory: row.get::<_, i32>(5)? != 0,
                is_users_directory: row.get::<_, i32>(6)? != 0,
                last_modified: row.get(7)?,
            })
        })?;

        let mut results = Vec::new();
        for r in rows {
            results.push(r?);
        }
        Ok(results)
    }

    /// Get total count of indexed local files.
    pub fn count_files(&self) -> Result<usize, WgaError> {
        let count: i64 = self
            .conn
            .query_row("SELECT count(*) FROM local_files", [], |r| r.get(0))?;
        Ok(count as usize)
    }
}

// -----------------------------------------------------------------------------
// Protocol & Copilot Key Provider Dispatcher
// -----------------------------------------------------------------------------

/// Windows Google App Protocol & Shell action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WgaAction {
    Search { query: String },
    Lens { file_path: String },
    ScreenCapture,
    Settings,
    History,
    CopilotKey,
}

impl WgaAction {
    /// Parse `wga://` URI or command-line invocation.
    pub fn parse_uri(uri: &str) -> Result<Self, WgaError> {
        if uri == "wga://capture" {
            return Ok(Self::ScreenCapture);
        }
        if uri == "wga://settings" {
            return Ok(Self::Settings);
        }
        if uri == "wga://history" {
            return Ok(Self::History);
        }
        if uri == "wga://copilot" {
            return Ok(Self::CopilotKey);
        }
        if let Some(rest) = uri.strip_prefix("wga://search?q=") {
            return Ok(Self::Search {
                query: rest.to_string(),
            });
        }
        if let Some(rest) = uri.strip_prefix("wga://lens?path=") {
            return Ok(Self::Lens {
                file_path: rest.to_string(),
            });
        }
        Err(WgaError::InvalidUri(uri.to_string()))
    }

    /// Generate Google Lens search URL for an image.
    pub fn to_lens_url(image_url: &str) -> String {
        format!(
            "https://lens.google.com/uploadbyurl?url={}",
            urlencoding_simple(image_url)
        )
    }
}

fn urlencoding_simple(input: &str) -> String {
    let mut out = String::new();
    for b in input.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preferences_txtpb_roundtrip() {
        let input = r#"
last_active_profile_id: "default"
profiles {
  profile_id: "default"
  display_name: "Yohan (yohanpierre15@gmail.com)"
  avatar_url: "https://lh3.googleusercontent.com/avatar"
  email: "yohanpierre15@gmail.com"
}
first_run_timestamp_sec: 1793527200
"#;
        let prefs = WgaPreferences::parse_txtpb(input).expect("parse txtpb");
        assert_eq!(prefs.last_active_profile_id, "default");
        assert_eq!(prefs.profiles.len(), 1);
        assert_eq!(prefs.profiles[0].email, "yohanpierre15@gmail.com");
        assert_eq!(prefs.first_run_timestamp_sec, 1793527200);

        let output = prefs.to_txtpb();
        assert!(output.contains("last_active_profile_id: \"default\""));
        assert!(output.contains("email: \"yohanpierre15@gmail.com\""));
    }

    #[test]
    fn test_wga_action_parse() {
        assert_eq!(
            WgaAction::parse_uri("wga://capture").unwrap(),
            WgaAction::ScreenCapture
        );
        assert_eq!(
            WgaAction::parse_uri("wga://copilot").unwrap(),
            WgaAction::CopilotKey
        );
        assert_eq!(
            WgaAction::parse_uri("wga://search?q=bun+os").unwrap(),
            WgaAction::Search {
                query: "bun+os".into()
            }
        );
    }

    #[cfg(feature = "search-cache")]
    #[test]
    fn test_local_files_db_in_memory() {
        let db = LocalFilesDb::open_in_memory().expect("open in memory");
        db.init_schema().expect("init schema");

        let file = WgaLocalFile {
            file_id: None,
            file_path: "C:\\Users\\aphro\\Documents\\project.rs".into(),
            parent_path: "C:\\Users\\aphro\\Documents".into(),
            filename: "project.rs".into(),
            extension: "rs".into(),
            is_directory: false,
            is_users_directory: true,
            last_modified: 1700000000,
        };
        db.upsert_file(&file).expect("upsert file");
        assert_eq!(db.count_files().expect("count"), 1);

        let search = db.search_fts("project", 10).expect("fts search");
        assert_eq!(search.len(), 1);
        assert_eq!(search[0].filename, "project.rs");
    }
}
