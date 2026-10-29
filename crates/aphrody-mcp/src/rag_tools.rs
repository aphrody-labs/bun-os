// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! `aphrody_rag_*` — the local `aphrody-rag` index over MCP.
//!
//! The same SQLite FTS5 store the CLI builds with `aphrody rag index` and the
//! agent runtime mounts through `rag_db`. The database is resolved from
//! `$APHRODY_RAG_DB`, falling back to `~/.aphrody/rag/index.db` (the CLI's
//! default profile location).
//!
//! The embedder and reranker are resolved through
//! [`aphrody_rag::resolve_embed`] / [`aphrody_rag::resolve_rerank`] — the
//! same resolver `aphrody rag` uses — against an empty [`RagConfig`] (this
//! server never parses `config.toml`), so the canonical `APHRODY_AI_EMBED_*`
//! / `APHRODY_AI_RERANK_*` environment and every legacy
//! `APHRODY_RAG_EMBED_*` alias resolve the
//! same way the CLI does. Nothing configured or discoverable degrades to
//! lexical search, honestly reported in `fallback_reason`.
//!
//! Native-only: rusqlite and the filesystem.

#![cfg(not(target_arch = "wasm32"))]

use std::{path::PathBuf, sync::Arc};

use aphrody_config::{EmbedBackend, RagConfig};
use aphrody_rag::{
    LlamaServerEmbedder, LlamaServerReranker, OpenAiCompatEmbedder, RagSearcher, RagStore,
    SearchMode, SearchOptions, rerank_available, resolve_embed, resolve_rerank,
};
use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::json;

/// Resolve the index path: `$APHRODY_RAG_DB`, else the agent-home database
/// (`<home>/db/aphrody.sqlite`, profile from `$APHRODY_PROFILE`) when it exists, else the legacy
/// `~/.aphrody/rag/index.db`.
fn db_path() -> Option<PathBuf> {
    std::env::var_os("APHRODY_RAG_DB")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| aphrody_rag::home::existing_home_db(None))
        .or_else(|| dirs::home_dir().map(|home| home.join(".aphrody/rag/index.db")))
}

/// Open the store without creating one: an absent index is reported, never
/// silently replaced by an empty database.
fn open_store() -> Result<Arc<RagStore>, String> {
    let path = db_path().ok_or("no home directory and $APHRODY_RAG_DB unset")?;
    if !path.is_file() {
        return Err(format!(
            "RAG index not found at {} (build it with `aphrody rag index <dir>` or set \
             $APHRODY_RAG_DB)",
            path.display()
        ));
    }
    RagStore::open(&path)
        .map(Arc::new)
        .map_err(|error| format!("{}: {error}", path.display()))
}

/// Resolve and construct the query embedder, honouring
/// [`EmbedBackend::Ort`], [`EmbedBackend::LlamaServer`] and
/// [`EmbedBackend::OpenaiCompat`] alike (feature `ort` gates the first).
/// `Ok(None)` means "no embedder configured or discoverable": callers degrade
/// to lexical search, not an error.
async fn embedder_from_env() -> Result<Option<Arc<dyn aphrody_rag::Embedder>>, String> {
    let Some(resolved) = resolve_embed(&RagConfig::default()).map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    let embedder: Arc<dyn aphrody_rag::Embedder> = match resolved.backend {
        EmbedBackend::Native => {
            #[cfg(feature = "native")]
            {
                let loaded = tokio::task::spawn_blocking(move || {
                    aphrody_rag::NativeEmbedder::load_or_install(&resolved.model)
                })
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
                Arc::new(loaded)
            }
            #[cfg(not(feature = "native"))]
            {
                return Err("aphrody-rag built without feature `native`".to_string());
            }
        }
        EmbedBackend::Ort => embedder_ort(resolved.model).await?,
        EmbedBackend::LlamaServer => {
            let endpoint = resolved.endpoint.unwrap_or_default();
            Arc::new(LlamaServerEmbedder::new(
                endpoint,
                resolved.model,
                resolved.dimension,
            ))
        }
        EmbedBackend::OpenaiCompat => {
            let endpoint = resolved.endpoint.unwrap_or_default();
            Arc::new(OpenAiCompatEmbedder::new(
                endpoint,
                resolved.model,
                resolved.dimension,
                resolved.api_key,
            ))
        }
    };
    Ok(Some(embedder))
}

#[cfg(feature = "rag-ort")]
async fn embedder_ort(model: String) -> Result<Arc<dyn aphrody_rag::Embedder>, String> {
    tokio::task::spawn_blocking(move || aphrody_rag::OrtEmbedder::load(&model))
        .await
        .map_err(|error| format!("embedding worker failed: {error}"))?
        .map(|embedder| Arc::new(embedder) as Arc<dyn aphrody_rag::Embedder>)
        .map_err(|error| error.to_string())
}

#[cfg(not(feature = "rag-ort"))]
async fn embedder_ort(_model: String) -> Result<Arc<dyn aphrody_rag::Embedder>, String> {
    Err("embed_backend=ort requires aphrody-rag built with the `ort` feature".to_owned())
}

/// Resolve and construct the cross-encoder reranker, when reranking is
/// requested.
fn reranker_from_env(enabled: bool) -> Result<Option<Arc<dyn aphrody_rag::Reranker>>, String> {
    let Some(resolved) =
        resolve_rerank(&RagConfig::default(), enabled).map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    let mut reranker = LlamaServerReranker::new(resolved.endpoint, resolved.model);
    if let Some(key) = resolved.api_key {
        reranker = reranker.with_api_key(key);
    }
    Ok(Some(Arc::new(reranker)))
}

#[derive(Debug, Deserialize, JsonSchema)]
pub(crate) struct RagSearchRequest {
    /// Natural-language or keyword query.
    pub(crate) query: String,
    /// Maximum hits (1-50, default 8).
    #[serde(default)]
    pub(crate) limit: Option<usize>,
    /// Restrict to documents whose path starts with this prefix.
    #[serde(default)]
    pub(crate) path_prefix: Option<String>,
}

async fn run(req: &RagSearchRequest) -> Result<aphrody_rag::SearchResult, String> {
    if req.query.trim().is_empty() {
        return Err("query is empty".into());
    }
    let mut searcher = RagSearcher::new(open_store()?);
    if let Some(embedder) = embedder_from_env().await? {
        searcher = searcher.with_embedder(embedder);
    }
    let rerank_requested = rerank_available(&RagConfig::default());
    if let Some(reranker) = reranker_from_env(rerank_requested)? {
        searcher = searcher.with_reranker(reranker);
    }
    let opts = SearchOptions {
        limit: req.limit.unwrap_or(8).clamp(1, 50),
        mode: SearchMode::Hybrid,
        rerank: rerank_requested,
        path_prefix: req.path_prefix.clone(),
        ..SearchOptions::default()
    };
    searcher
        .search(&req.query, &opts)
        .await
        .map_err(|error| error.to_string())
}

/// Ranked hits as JSON.
pub(crate) async fn search(req: RagSearchRequest) -> String {
    match run(&req).await {
        Ok(result) => serde_json::to_string_pretty(&result)
            .unwrap_or_else(|error| json!({ "error": error.to_string() }).to_string()),
        Err(error) => json!({ "error": error }).to_string(),
    }
}

/// Hits rendered as a citable Markdown context block for a prompt.
pub(crate) async fn context(req: RagSearchRequest) -> String {
    let result = match run(&req).await {
        Ok(result) => result,
        Err(error) => return json!({ "error": error }).to_string(),
    };
    if result.hits.is_empty() {
        return format!("No indexed passage matches `{}`.", result.query);
    }
    let mut out = String::new();
    for (rank, hit) in result.hits.iter().enumerate() {
        let chunk = &hit.chunk;
        out.push_str(&format!(
            "[{}] {}:{}-{}{}\n{}\n\n",
            rank + 1,
            chunk.path,
            chunk.start_line,
            chunk.end_line,
            chunk
                .heading
                .as_deref()
                .map(|h| format!(" — {h}"))
                .unwrap_or_default(),
            chunk.content.trim()
        ));
    }
    if let Some(reason) = result.fallback_reason {
        out.push_str(&format!(
            "(mode served: {:?}; {reason})\n",
            result.mode_served
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One test: both cases mutate `$APHRODY_RAG_DB`, so they must not race.
    #[tokio::test]
    async fn resolves_index_from_env_and_serves_hits() {
        let dir = tempfile::tempdir().expect("tempdir");

        let absent = dir.path().join("absent.db");
        // SAFETY: the only test in this binary touching this variable.
        unsafe { std::env::set_var("APHRODY_RAG_DB", &absent) };
        let out = search(RagSearchRequest {
            query: "goku".into(),
            limit: None,
            path_prefix: None,
        })
        .await;
        assert!(out.contains("RAG index not found"), "{out}");
        assert!(!absent.exists(), "a missing index must not be created");

        let db = dir.path().join("index.db");
        let store = Arc::new(RagStore::open(&db).expect("open"));
        aphrody_rag::RagIndexer::new(store)
            .index_document(
                "wiki/goku.md",
                "# Son Goku

Son Goku apprend le Kaméhaméha auprès de Kamé Sennin.
",
                64,
                0,
                &aphrody_rag::IndexOptions::default(),
            )
            .await
            .expect("index");
        // SAFETY: see above.
        unsafe { std::env::set_var("APHRODY_RAG_DB", &db) };
        let ctx = context(RagSearchRequest {
            query: "Kaméhaméha".into(),
            limit: Some(3),
            path_prefix: None,
        })
        .await;
        assert!(ctx.starts_with("[1] wiki/goku.md:"), "{ctx}");
        assert!(ctx.contains("Kamé Sennin"), "{ctx}");
    }
}
