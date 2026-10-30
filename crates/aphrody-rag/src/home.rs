// SPDX-License-Identifier: Apache-2.0
//! Unified retrieval over the home database: one hybrid search across document chunks, code-graph
//! nodes and memories, fused with the single reciprocal-rank-fusion implementation of
//! `aphrody-rag-core`.
//!
//! The functions here are synchronous (they borrow a [`HomeDb`]); async callers run them on a
//! blocking thread. Lexical retrieval needs no model; a vector channel joins the fusion when the
//! chunk embeddings of a model are present (later batch).

use std::collections::HashMap;

use aphrody_rag_core::fusion::rrf;
pub use aphrody_store::{HomeDb, HomeLayout, HomeScope};
use serde::{Deserialize, Serialize};

use crate::{
    error::{RagError, Result},
    store::RagStore,
};

/// What a unified hit points at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HitKind {
    /// A document chunk.
    Chunk,
    /// A code-graph node.
    Node,
    /// A memory.
    Memory,
}

impl HitKind {
    const fn tag(self) -> char {
        match self {
            Self::Chunk => 'c',
            Self::Node => 'n',
            Self::Memory => 'm',
        }
    }
}

/// One fused result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UnifiedHit {
    /// Kind.
    pub kind: HitKind,
    /// Stable key (`c:<chunk id>`, `n:<node pk>`, `m:<memory pk>`).
    pub key: String,
    /// Title: symbol or heading, node label, or memory namespace.
    pub title: String,
    /// Path of the document or source file, when any.
    pub path: Option<String>,
    /// 1-based line, when known.
    pub line: Option<usize>,
    /// Bounded excerpt.
    pub snippet: String,
    /// Fused RRF score.
    pub score: f64,
}

/// Options of [`unified_search`].
#[derive(Debug, Clone)]
pub struct UnifiedOptions {
    /// Results returned.
    pub limit: usize,
    /// Candidates fetched per channel before fusion.
    pub per_channel: usize,
    /// Channels searched (empty searches all three).
    pub kinds: Vec<HitKind>,
    /// RRF constant.
    pub rrf_k: f64,
}

impl Default for UnifiedOptions {
    fn default() -> Self {
        Self {
            limit: 10,
            per_channel: 30,
            kinds: Vec::new(),
            rrf_k: 60.0,
        }
    }
}

/// FTS5 expression for free text: quoted terms joined with OR (bm25 ranks the best matches).
fn fts_expression(query: &str) -> Option<String> {
    let terms: Vec<String> = query
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|t| t.chars().count() >= 2)
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" OR "))
}

fn parse_line(loc: Option<&str>) -> Option<usize> {
    loc?.trim_start_matches('L').parse().ok()
}

fn truncate(text: &str, max: usize) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        flat
    } else {
        format!("{}...", flat.chars().take(max).collect::<String>())
    }
}

/// Search chunks, graph nodes and memories of the home database and fuse the channels.
///
/// # Errors
///
/// SQLite failures. A database without the graph or memory tables (older schema) simply
/// contributes nothing for that channel.
pub fn unified_search(
    db: &HomeDb,
    query: &str,
    options: &UnifiedOptions,
) -> Result<Vec<UnifiedHit>> {
    let Some(expression) = fts_expression(query) else {
        return Ok(Vec::new());
    };
    let wants = |kind: HitKind| options.kinds.is_empty() || options.kinds.contains(&kind);
    let limit = i64::try_from(options.per_channel).unwrap_or(30);
    let mut hits: HashMap<String, UnifiedHit> = HashMap::new();
    let mut lists: Vec<Vec<String>> = Vec::new();

    let mut run = |sql: &str,
                   build: &dyn Fn(&rusqlite::Row<'_>) -> rusqlite::Result<UnifiedHit>|
     -> Result<()> {
        let mut statement = match db.conn().prepare(sql) {
            Ok(s) => s,
            Err(rusqlite::Error::SqliteFailure(_, Some(message)))
                if message.contains("no such table") =>
            {
                return Ok(());
            }
            Err(error) => return Err(RagError::Sqlite(error)),
        };
        let rows = statement.query_map(rusqlite::params![expression, limit], |r| build(r))?;
        let mut keys = Vec::new();
        for row in rows {
            let hit = row?;
            keys.push(hit.key.clone());
            hits.entry(hit.key.clone()).or_insert(hit);
        }
        lists.push(keys);
        Ok(())
    };

    if wants(HitKind::Chunk) {
        run(
            "SELECT c.id, d.path, COALESCE(c.symbol, c.heading, ''), c.start_line,
                    snippet(chunks_fts, 0, '', '', '...', 24)
             FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN docs d ON d.id = c.doc_id
             WHERE chunks_fts MATCH ?1 ORDER BY bm25(chunks_fts) LIMIT ?2",
            &|r| {
                Ok(UnifiedHit {
                    kind: HitKind::Chunk,
                    key: format!("{}:{}", HitKind::Chunk.tag(), r.get::<_, i64>(0)?),
                    title: r.get(2)?,
                    path: Some(r.get(1)?),
                    line: usize::try_from(r.get::<_, i64>(3)?).ok(),
                    snippet: truncate(&r.get::<_, String>(4)?, 240),
                    score: 0.0,
                })
            },
        )?;
    }
    if wants(HitKind::Node) {
        run(
            "SELECT n.pk, n.label, n.file_path, n.loc, n.kind, COALESCE(c.name, '')
             FROM graph_nodes_fts f JOIN graph_nodes n ON n.pk = f.rowid
             LEFT JOIN graph_communities c ON c.source_id = n.source_id AND c.id = n.community
             WHERE graph_nodes_fts MATCH ?1 ORDER BY bm25(graph_nodes_fts) LIMIT ?2",
            &|r| {
                let loc: Option<String> = r.get(3)?;
                Ok(UnifiedHit {
                    kind: HitKind::Node,
                    key: format!("{}:{}", HitKind::Node.tag(), r.get::<_, i64>(0)?),
                    title: r.get(1)?,
                    path: r.get(2)?,
                    line: parse_line(loc.as_deref()),
                    snippet: format!(
                        "{} in community {}",
                        r.get::<_, String>(4)?,
                        r.get::<_, String>(5)?
                    ),
                    score: 0.0,
                })
            },
        )?;
    }
    if wants(HitKind::Memory) {
        run(
            "SELECT m.pk, m.ns, snippet(memories_fts, 0, '', '', '...', 24)
             FROM memories_fts JOIN memories m ON m.pk = memories_fts.rowid
             WHERE memories_fts MATCH ?1 ORDER BY bm25(memories_fts) LIMIT ?2",
            &|r| {
                Ok(UnifiedHit {
                    kind: HitKind::Memory,
                    key: format!("{}:{}", HitKind::Memory.tag(), r.get::<_, i64>(0)?),
                    title: r.get(1)?,
                    path: None,
                    line: None,
                    snippet: truncate(&r.get::<_, String>(2)?, 240),
                    score: 0.0,
                })
            },
        )?;
    }

    let slices: Vec<&[String]> = lists.iter().map(Vec::as_slice).collect();
    let mut fused = Vec::new();
    for (key, score) in rrf(&slices, options.rrf_k).into_iter().take(options.limit) {
        if let Some(mut hit) = hits.remove(&key) {
            hit.score = score;
            fused.push(hit);
        }
    }
    Ok(fused)
}

/// Scope of a profile name, falling back to `$APHRODY_PROFILE` (agent-home semantics) and then
/// to the global home.
#[must_use]
pub fn scope_for(profile: Option<&str>) -> HomeScope {
    match profile
        .map(str::to_owned)
        .or_else(|| std::env::var("APHRODY_PROFILE").ok())
    {
        Some(p) => HomeScope::from_profile(Some(&p)),
        None => HomeScope::Global,
    }
}

/// Path of the home database of `profile` when it exists (never created here).
#[must_use]
pub fn existing_home_db(profile: Option<&str>) -> Option<std::path::PathBuf> {
    let layout = HomeLayout::resolve(&scope_for(profile)).ok()?;
    layout.db_path.is_file().then_some(layout.db_path)
}

/// Unified search over the home database of `profile` as a JSON value (the MCP and CLI payload).
///
/// # Errors
///
/// A missing home database or SQLite failures.
pub fn home_query_json(
    profile: Option<&str>,
    query: &str,
    options: &UnifiedOptions,
) -> Result<serde_json::Value> {
    let path = existing_home_db(profile).ok_or_else(|| {
        RagError::Other("no home database yet (run `aphrody home index`)".to_owned())
    })?;
    let db = HomeDb::open_read_only(&path).map_err(|e| RagError::Other(e.to_string()))?;
    let hits = unified_search(&db, query, options)?;
    Ok(serde_json::json!({ "query": query, "db": path, "hits": hits }))
}

/// Layout, schema version and table counts of the home database of `profile`.
///
/// # Errors
///
/// Home resolution or SQLite failures.
pub fn home_status_json(profile: Option<&str>) -> Result<serde_json::Value> {
    let args = aphrody_store::cli::StoreArgs {
        profile: match scope_for(profile) {
            HomeScope::Global => None,
            HomeScope::Profile(p) => Some(p),
        },
        state: None,
    };
    aphrody_store::cli::run(&args, &aphrody_store::cli::Command::Status)
        .map_err(|e| RagError::Other(e.to_string()))
}

impl RagStore {
    /// Open the RAG store of a home: the home database is created and migrated first (the RAG
    /// tables are its baseline), so retrieval, graph, memories and sessions share one file.
    ///
    /// # Errors
    ///
    /// Migration or open failures.
    pub fn open_home(scope: &HomeScope) -> Result<Self> {
        let layout = HomeLayout::resolve(scope).map_err(|e| RagError::Other(e.to_string()))?;
        Self::open_home_layout(&layout)
    }

    /// [`Self::open_home`] for an explicit layout (tests, tooling).
    ///
    /// # Errors
    ///
    /// Migration or open failures.
    pub fn open_home_layout(layout: &HomeLayout) -> Result<Self> {
        drop(HomeDb::open(layout).map_err(|e| RagError::Other(e.to_string()))?);
        Self::open(&layout.db_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded() -> HomeDb {
        let db = HomeDb::open_in_memory().unwrap();
        let c = db.conn();
        c.execute_batch(
            "INSERT INTO docs (path, hash, mtime_ms, size_bytes) VALUES ('docs/rag.md', 'h', 1, 1);
             INSERT INTO chunks (doc_id, chunk_index, heading, content, start_line, end_line, token_count)
                VALUES (1, 0, 'Hybrid search', 'reciprocal rank fusion merges lexical and vector candidates', 10, 12, 9);
             INSERT INTO sources (kind, label, created_at_ms, updated_at_ms) VALUES ('code-graph', 'graph:t', 1, 1);
             INSERT INTO graph_nodes (source_id, node_id, label, kind, file_path, loc, community)
                VALUES (1, 'n1', 'RagSearcher', 'code', 'crates/ai/rag/src/search.rs', 'L81', 3);
             INSERT INTO graph_communities (source_id, id, name, size) VALUES (1, 3, 'RagSearcher', 1);
             INSERT INTO memories (id, ns, content, created_at_ms, updated_at_ms)
                VALUES ('m1', 'agent', 'remember that fusion uses k equals sixty', 1, 1);",
        )
        .unwrap();
        db
    }

    #[test]
    fn one_query_returns_chunks_nodes_and_memories_fused() {
        let db = seeded();
        let hits = unified_search(&db, "fusion", &UnifiedOptions::default()).unwrap();
        let kinds: Vec<HitKind> = hits.iter().map(|h| h.kind).collect();
        assert!(
            kinds.contains(&HitKind::Chunk) && kinds.contains(&HitKind::Memory),
            "{kinds:?}"
        );
        let chunk = hits.iter().find(|h| h.kind == HitKind::Chunk).unwrap();
        assert_eq!(chunk.path.as_deref(), Some("docs/rag.md"));
        assert_eq!(chunk.line, Some(10));
        assert!(hits.windows(2).all(|w| w[0].score >= w[1].score));
    }

    #[test]
    fn graph_nodes_are_found_by_label_and_carry_their_location() {
        let db = seeded();
        let hits = unified_search(&db, "RagSearcher", &UnifiedOptions::default()).unwrap();
        let node = hits
            .iter()
            .find(|h| h.kind == HitKind::Node)
            .expect("node hit");
        assert_eq!(node.path.as_deref(), Some("crates/ai/rag/src/search.rs"));
        assert_eq!(node.line, Some(81));
        assert!(node.snippet.contains("community RagSearcher"));
    }

    #[test]
    fn kinds_filter_and_empty_queries_are_handled() {
        let db = seeded();
        let only_memory = UnifiedOptions {
            kinds: vec![HitKind::Memory],
            ..UnifiedOptions::default()
        };
        let hits = unified_search(&db, "fusion", &only_memory).unwrap();
        assert!(hits.iter().all(|h| h.kind == HitKind::Memory));
        assert!(
            unified_search(&db, "!!", &UnifiedOptions::default())
                .unwrap()
                .is_empty()
        );
        assert!(
            unified_search(&db, "zzzznothing", &UnifiedOptions::default())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn explicit_profiles_select_their_own_scope() {
        assert_eq!(scope_for(Some("docs")), HomeScope::Profile("docs".into()));
    }

    #[tokio::test]
    async fn the_rag_store_opens_on_the_home_database_and_sees_the_same_rows() {
        let state = tempfile::tempdir().unwrap();
        let layout =
            HomeLayout::in_state(state.path(), &HomeScope::Profile("docs".into())).unwrap();
        let store = RagStore::open_home_layout(&layout).unwrap();
        store
            .upsert_doc("a.md", "h", None, None, 1, 1)
            .await
            .unwrap();
        let db = HomeDb::open_read_only(&layout.db_path).unwrap();
        assert_eq!(db.schema_version().unwrap(), 7);
        let docs: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM docs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(docs, 1);
    }
}
