// SPDX-License-Identifier: Apache-2.0
//! Local retrieval commands shared by CLI and in-process hosts.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use aphrody_config::{CliOverrides, EmbedBackend, RagConfig, RagMode};
use aphrody_rag::{
    Embedder, IndexOptions, LlamaServerEmbedder, LlamaServerReranker, OpenAiCompatEmbedder,
    OrtEmbedder, RagIndexer, RagSearcher, RagStore, Reranker, SearchMode, SearchOptions,
    resolve_embed, resolve_rerank,
};
use aphrody_toolcall::ToolExecutor;
use clap::{Args, Subcommand, ValueEnum};
use miette::IntoDiagnostic;

#[derive(Debug, Args)]
pub(crate) struct RagArgs {
    /// Explicit local index path; defaults to the active profile state directory.
    #[arg(long, global = true)]
    db: Option<PathBuf>,
    #[command(subcommand)]
    action: RagAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum RagModeArg {
    Lexical,
    Vector,
    Hybrid,
    HybridRerank,
}

#[derive(Debug, Subcommand)]
enum RagAction {
    /// Index a directory incrementally, including vectors when configured.
    Index {
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// Scrape one URL through Aphrody OS and index it in the local AI RAG store.
    WebIngest {
        url: String,
        /// Replace chunks even when the page content is unchanged.
        #[arg(long)]
        force: bool,
    },
    /// Search the index and report source paths, lines and effective mode.
    Search {
        query: String,
        #[arg(long, default_value_t = 5)]
        limit: usize,
        /// Override the retrieval mode selected by `[rag].mode`.
        #[arg(long, value_enum)]
        mode: Option<RagModeArg>,
        /// Optional language filter ('fr', 'ja').
        #[arg(long)]
        lang: Option<String>,
        /// Optional entity filter.
        #[arg(long)]
        entity: Option<String>,
        /// Optional kind filter ('databook', 'interview', etc.).
        #[arg(long)]
        kind: Option<String>,
    },
    /// Assemble source context for a model prompt.
    Context {
        query: String,
        #[arg(long, default_value_t = 2000)]
        token_budget: usize,
        /// Override the retrieval mode selected by `[rag].mode`.
        #[arg(long, value_enum)]
        mode: Option<RagModeArg>,
    },
    /// Report document, chunk and vector counts.
    Stats,
}

struct Pipeline {
    embedder: Option<Arc<dyn Embedder>>,
    reranker: Option<Arc<dyn Reranker>>,
    mode: SearchMode,
    rerank: bool,
    rerank_top_n: usize,
}

impl Pipeline {
    fn searcher(&self, store: Arc<RagStore>) -> RagSearcher {
        let mut searcher = RagSearcher::new(store);
        if let Some(embedder) = &self.embedder {
            searcher = searcher.with_embedder(Arc::clone(embedder));
        }
        if let Some(reranker) = &self.reranker {
            searcher = searcher.with_reranker(Arc::clone(reranker));
        }
        searcher
    }
}

fn expand_path(path: &str, state_root: &Path) -> miette::Result<PathBuf> {
    if let Some(suffix) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        let home = aphrody_models::paths::home_dir().into_diagnostic()?;
        Ok(home.join(suffix))
    } else if Path::new(path).is_absolute() {
        Ok(PathBuf::from(path))
    } else {
        Ok(state_root.join(path))
    }
}

fn endpoint(raw: &str, suffix: &str) -> String {
    let raw = raw.trim_end_matches('/');
    if raw.ends_with(suffix) {
        raw.to_owned()
    } else if raw.ends_with("/v1") {
        format!("{raw}/{suffix}")
    } else {
        format!("{raw}/v1/{suffix}")
    }
}

fn effective_mode(argument: Option<RagModeArg>, configured: Option<RagMode>) -> RagModeArg {
    argument.unwrap_or_else(|| match configured.unwrap_or(RagMode::Lexical) {
        RagMode::Lexical => RagModeArg::Lexical,
        RagMode::Hybrid => RagModeArg::Hybrid,
        RagMode::HybridRerank => RagModeArg::HybridRerank,
    })
}

fn postgres_url(explicit_local_db: bool, configured: Option<String>) -> Option<String> {
    (!explicit_local_db)
        .then_some(configured)
        .flatten()
        .filter(|url| !url.trim().is_empty())
}

fn search_mode(mode: RagModeArg) -> SearchMode {
    match mode {
        RagModeArg::Lexical => SearchMode::Lexical,
        RagModeArg::Vector => SearchMode::Vector,
        RagModeArg::Hybrid | RagModeArg::HybridRerank => SearchMode::Hybrid,
    }
}

/// Resolves and constructs an embedder through [`aphrody_rag::resolve_embed`]
/// — the one place model, dimension, backend and endpoint are decided from
/// `[rag]`, the canonical `APHRODY_AI_EMBED_*` environment, and the local
/// model catalog (CLAUDE.md §7: no more per-surface ad-hoc resolution).
async fn build_embedder(config: &RagConfig) -> miette::Result<Option<Arc<dyn Embedder>>> {
    let Some(resolved) = resolve_embed(config).into_diagnostic()? else {
        return Ok(None);
    };

    let embedder: Arc<dyn Embedder> = match resolved.backend {
        EmbedBackend::Native => {
            #[cfg(feature = "native")]
            {
                let model = resolved.model.clone();
                let loaded = tokio::task::spawn_blocking(move || {
                    aphrody_rag::NativeEmbedder::load_or_install(&model)
                })
                .await
                .into_diagnostic()?
                .into_diagnostic()?;
                Arc::new(loaded)
            }
            #[cfg(not(feature = "native"))]
            {
                return Err(miette::miette!(
                    "native embedding backend selected but aphrody-rag was built without the `native` feature"
                ));
            }
        }
        EmbedBackend::Ort => {
            let model = resolved.model.clone();
            let loaded = tokio::task::spawn_blocking(move || OrtEmbedder::load(&model))
                .await
                .into_diagnostic()?
                .into_diagnostic()?;
            if loaded.dimension() != resolved.dimension {
                return Err(miette::miette!(
                    "resolved embedding dimension {} does not match local model `{}` dimension {}",
                    resolved.dimension,
                    loaded.model_id(),
                    loaded.dimension()
                ));
            }
            Arc::new(loaded)
        }
        EmbedBackend::LlamaServer => {
            // The resolver guarantees `endpoint` for HTTP backends.
            let raw = resolved.endpoint.as_deref().unwrap_or_default();
            Arc::new(LlamaServerEmbedder::new(
                endpoint(raw, "embeddings"),
                resolved.model,
                resolved.dimension,
            ))
        }
        EmbedBackend::OpenaiCompat => {
            let raw = resolved.endpoint.as_deref().unwrap_or_default();
            Arc::new(OpenAiCompatEmbedder::new(
                endpoint(raw, "embeddings"),
                resolved.model,
                resolved.dimension,
                resolved.api_key,
            ))
        }
    };
    Ok(Some(embedder))
}

/// Resolves and constructs a reranker through
/// [`aphrody_rag::resolve_rerank`]. `enabled` mirrors the requested search
/// mode: reranking is opt-in per search, not per process.
fn build_reranker(config: &RagConfig, enabled: bool) -> miette::Result<Option<Arc<dyn Reranker>>> {
    let Some(resolved) = resolve_rerank(config, enabled).into_diagnostic()? else {
        return Ok(None);
    };
    let mut reranker = LlamaServerReranker::new(resolved.endpoint, resolved.model);
    if let Some(key) = resolved.api_key {
        reranker = reranker.with_api_key(key);
    }
    Ok(Some(Arc::new(reranker)))
}

async fn build_pipeline(config: &RagConfig, mode: RagModeArg) -> miette::Result<Pipeline> {
    let needs_vectors = !matches!(mode, RagModeArg::Lexical);
    let embedder = if needs_vectors {
        build_embedder(config).await?
    } else {
        None
    };
    let rerank = matches!(mode, RagModeArg::HybridRerank);
    Ok(Pipeline {
        embedder,
        reranker: build_reranker(config, rerank)?,
        mode: search_mode(mode),
        rerank,
        rerank_top_n: config.rerank_top_n.unwrap_or(25).clamp(1, 100),
    })
}

pub(crate) async fn run(args: RagArgs, overrides: CliOverrides) -> miette::Result<()> {
    let config = crate::profile::load_config(&overrides)?;
    let state_root = crate::profile::profile_state_root(&config)?;
    let explicit_local_db = args.db.is_some();
    let db = match (args.db, config.rag.db_path.as_deref()) {
        (Some(db), _) => db,
        (None, Some(path)) => expand_path(path, &state_root)?,
        (None, None) => state_root.join("rag/index.db"),
    };
    if let Some(database_url) = postgres_url(
        explicit_local_db,
        std::env::var("APHRODY_MCP_DATABASE_URL").ok(),
    ) {
        match &args.action {
            RagAction::WebIngest { url, force } => {
                let markdown = aphrody_rag::scrape_web_markdown(
                    url,
                    *force,
                    std::time::Duration::from_secs(90),
                )
                .await
                .map_err(|message| miette::miette!("web-ingest: {message}"))?;
                let result =
                    aphrody_rag::ingest_web_document(&database_url, url, &markdown, *force)
                        .await
                        .map_err(|message| miette::miette!("web-ingest: {message}"))?;
                println!("{}", serde_json::to_string(&result).into_diagnostic()?);
                return Ok(());
            }
            RagAction::Search {
                query,
                limit,
                mode,
                lang,
                entity,
                kind,
            } => {
                if effective_mode(*mode, config.rag.mode) != RagModeArg::Lexical {
                    return Err(miette::miette!(
                        "PostgreSQL RAG supports lexical search only; use --mode lexical"
                    ));
                }
                if lang.is_some() || entity.is_some() || kind.is_some() {
                    return Err(miette::miette!(
                        "PostgreSQL RAG does not support --lang, --entity or --kind; use the local SQLite index"
                    ));
                }
                let result = aphrody_rag::search_documents(&database_url, query, *limit)
                    .await
                    .map_err(|message| miette::miette!("rag search: {message}"))?;
                println!("{}", serde_json::to_string(&result).into_diagnostic()?);
                return Ok(());
            }
            RagAction::Stats => {
                let result = aphrody_rag::pg_stats(&database_url)
                    .await
                    .map_err(|message| miette::miette!("rag stats: {message}"))?;
                println!("{}", serde_json::to_string(&result).into_diagnostic()?);
                return Ok(());
            }
            RagAction::Index { .. } | RagAction::Context { .. } => {
                return Err(miette::miette!(
                    "this RAG command uses the local SQLite index; pass --db explicitly"
                ));
            }
        }
    }
    if matches!(
        &args.action,
        RagAction::Index { .. } | RagAction::WebIngest { .. }
    ) {
        if let Some(parent) = db.parent().filter(|parent| !parent.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent).into_diagnostic()?;
        }
    } else if !db.is_file() {
        return Err(miette::miette!(
            "RAG index does not exist; run `aphrody rag index` first"
        ));
    }
    let store = Arc::new(RagStore::open(&db).into_diagnostic()?);
    match args.action {
        RagAction::Index { path } => {
            if !path.is_dir() {
                return Err(miette::miette!("RAG source must be an existing directory"));
            }
            let embedder = build_embedder(&config.rag).await?;
            let mut indexer = RagIndexer::new(store);
            if let Some(embedder) = embedder {
                indexer = indexer.with_embedder(embedder);
            }
            let stats = indexer
                .index_directory(path, &IndexOptions::default())
                .await
                .into_diagnostic()?;
            println!("{}", serde_json::to_string(&stats).into_diagnostic()?);
            if !stats.errors.is_empty() {
                return Err(miette::miette!(
                    "RAG indexing incomplete: {} file errors",
                    stats.errors.len()
                ));
            }
        }
        RagAction::WebIngest { url, force } => {
            let embedder = build_embedder(&config.rag).await?;
            if let Some(embedder) = &embedder {
                store
                    .ensure_embedding_model(embedder.model_id())
                    .await
                    .into_diagnostic()?;
            }
            let mut indexer = RagIndexer::new(store);
            if let Some(embedder) = embedder {
                indexer = indexer.with_embedder(embedder);
            }
            let output = aphrody_rag::WebIngestTool::new(Arc::new(indexer))
                .handle(serde_json::json!({ "url": url, "force": force }))
                .await
                .into_diagnostic()?;
            if output.is_error {
                return Err(miette::miette!("{}", output.content));
            }
            println!("{}", output.content);
        }
        RagAction::Search {
            query, limit, mode, ..
        } => {
            if !(1..=100).contains(&limit) {
                return Err(miette::miette!("RAG limit must be between 1 and 100"));
            }
            let redis_url = std::env::var("APHRODY_REDIS_URL")
                .or_else(|_| std::env::var("REDIS_URL"))
                .ok();
            let redis_cache =
                aphrody_rag::RedisRagCache::from_url(redis_url.as_deref(), Some("aphrody:rag:"));
            let mode_arg = effective_mode(mode, config.rag.mode);
            let mode_str = format!("{mode_arg:?}");

            if let Some(cached) = redis_cache.get_rag_result(&query, &mode_str).await {
                println!("{cached}");
                return Ok(());
            }

            let pipeline = build_pipeline(&config.rag, mode_arg).await?;
            let result = pipeline
                .searcher(store)
                .search(
                    &query,
                    &SearchOptions {
                        mode: pipeline.mode,
                        limit,
                        rerank: pipeline.rerank,
                        rerank_top_n: pipeline.rerank_top_n,
                        ..Default::default()
                    },
                )
                .await
                .into_diagnostic()?;
            let json_str = serde_json::to_string(&result).into_diagnostic()?;
            redis_cache
                .cache_rag_result(&query, &mode_str, &json_str)
                .await;
            println!("{json_str}");
        }
        RagAction::Context {
            query,
            token_budget,
            mode,
        } => {
            if token_budget == 0 {
                return Err(miette::miette!(
                    "RAG token budget must be greater than zero"
                ));
            }
            let requested = effective_mode(mode, config.rag.mode);
            let pipeline = build_pipeline(&config.rag, requested).await?;
            let mode = match pipeline.mode {
                SearchMode::Lexical => "lexical",
                SearchMode::Vector => "vector",
                SearchMode::Hybrid => "hybrid",
            };
            let result = aphrody_rag::RagContextTool::new(Arc::new(pipeline.searcher(store)))
                .handle(serde_json::json!({
                    "query": query,
                    "token_budget": token_budget,
                    "mode": mode,
                    "rerank": pipeline.rerank,
                    "rerank_top_n": pipeline.rerank_top_n,
                }))
                .await
                .into_diagnostic()?;
            println!("{}", result.content);
        }
        RagAction::Stats => println!(
            "{}",
            serde_json::to_string(&store.stats().await.into_diagnostic()?).into_diagnostic()?
        ),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_accepts_base_or_full_url() {
        assert_eq!(
            endpoint("http://127.0.0.1:8080", "embeddings"),
            "http://127.0.0.1:8080/v1/embeddings"
        );
        assert_eq!(
            endpoint("http://127.0.0.1:8080/v1/embeddings", "embeddings"),
            "http://127.0.0.1:8080/v1/embeddings"
        );
        assert_eq!(
            endpoint("http://127.0.0.1:8080/v1", "embeddings"),
            "http://127.0.0.1:8080/v1/embeddings"
        );
    }

    #[test]
    fn explicit_mode_overrides_profile_mode() {
        assert_eq!(
            effective_mode(Some(RagModeArg::Vector), Some(RagMode::Lexical)),
            RagModeArg::Vector
        );
        assert_eq!(
            effective_mode(None, Some(RagMode::HybridRerank)),
            RagModeArg::HybridRerank
        );
        assert_eq!(effective_mode(None, None), RagModeArg::Lexical);
    }

    #[test]
    fn relative_database_path_is_profile_scoped() {
        let root = Path::new("profile-root");
        assert_eq!(
            expand_path("rag/custom.db", root).unwrap(),
            root.join("rag/custom.db")
        );
    }

    #[test]
    fn explicit_database_path_overrides_postgres_without_exposing_the_dsn() {
        assert_eq!(
            postgres_url(false, Some("postgres://private".to_owned())),
            Some("postgres://private".to_owned())
        );
        assert_eq!(
            postgres_url(true, Some("postgres://private".to_owned())),
            None
        );
        assert_eq!(postgres_url(false, Some("  ".to_owned())), None);
    }
}
