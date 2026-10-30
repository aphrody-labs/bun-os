// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Command-line driver for the RAG evaluation harness (`aphrody rag-eval`).

use std::{ffi::OsString, path::PathBuf, sync::Arc, time::Duration};

use crate::{
    EvalError, EvalOptions, EvalTarget, HttpTarget, LocalIndexTarget, McpTarget, parse_gold,
    run_eval,
};
use aphrody_rag::{
    Embedder, LlamaServerEmbedder, LlamaServerReranker, OpenAiCompatEmbedder, RagSearcher,
    RagStore, Reranker, SearchMode,
};
use clap::{Parser, ValueEnum};

/// Retrieval mode for the in-process `local` target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum LocalMode {
    Lexical,
    Vector,
    Hybrid,
}

impl From<LocalMode> for SearchMode {
    fn from(mode: LocalMode) -> Self {
        match mode {
            LocalMode::Lexical => Self::Lexical,
            LocalMode::Vector => Self::Vector,
            LocalMode::Hybrid => Self::Hybrid,
        }
    }
}

/// Embedding server dialect for the `local` target's vector modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum EmbedDialect {
    /// `llama-server` `/v1/embeddings`.
    LlamaServer,
    /// Any OpenAI-compatible `/v1/embeddings` (vLLM, Ollama, LM Studio, hosted).
    OpenaiCompat,
}

#[derive(Parser, Debug)]
#[command(
    name = "aphrody-rag-eval",
    about = "RAG evaluation and retrieval quality gate harness (P9)"
)]
struct Args {
    /// Target retrieval type: 'http' (default), 'mcp', or 'local' (in-process SQLite index).
    #[arg(long, default_value = "http")]
    target: String,

    /// Target endpoint URL: required for `http`; `mcp` defaults to the local Aphrody MCP endpoint.
    #[arg(long)]
    url: Option<String>,

    /// Read-only MCP search tool name (`rag_search`).
    #[arg(long, default_value = "rag_search")]
    mcp_tool: String,

    /// Local SQLite index built by `aphrody rag index` (required with `--target local`).
    #[arg(long, value_name = "PATH")]
    db: Option<PathBuf>,

    /// Retrieval mode for `--target local`.
    #[arg(long, value_enum, default_value_t = LocalMode::Lexical)]
    mode: LocalMode,

    /// Restrict `--target local` retrieval to indexed paths starting with this prefix.
    #[arg(long)]
    path_prefix: Option<String>,

    /// Embedding server URL for `--mode vector|hybrid` (`http://host:port`, `/v1` optional).
    #[arg(long)]
    embed_endpoint: Option<String>,

    /// Embedding server dialect for `--embed-endpoint`.
    #[arg(long, value_enum, default_value_t = EmbedDialect::LlamaServer)]
    embed_dialect: EmbedDialect,

    /// Embedding model id sent to the embedding server; must match the indexed vectors.
    #[arg(long)]
    embed_model: Option<String>,

    /// Embedding dimension; must match the indexed vectors.
    #[arg(long, default_value_t = 384)]
    vector_dim: usize,

    /// llama-server `/v1/rerank` URL enabling cross-encoder reranking on `--target local`.
    #[arg(long)]
    rerank_endpoint: Option<String>,

    /// Reranker model id for `--rerank-endpoint`.
    #[arg(long)]
    rerank_model: Option<String>,

    /// Path to gold dataset JSONL file.
    #[arg(long)]
    gold: PathBuf,

    /// Max rank depth per query (default: 10).
    #[arg(long, default_value_t = 10)]
    limit: usize,

    /// Queries per second limit for politeness (default: 2.0).
    #[arg(long, default_value_t = 2.0)]
    qps: f64,

    /// Allow mixed conditions/modes across test cases.
    #[arg(long)]
    allow_mixed: bool,

    /// Quality gate expressions (e.g. 'recall@5>=0.80', 'mrr>=0.65'). Repeatable.
    #[arg(long = "gate")]
    gates: Vec<String>,

    /// Filter test cases by tag.
    #[arg(long)]
    tag: Option<String>,

    /// Output full evaluation report as JSON instead of markdown.
    #[arg(long)]
    json: bool,
}

/// Entry point of the `rag-eval` tool: `argv[0]` is the invocation name; returns the process exit code.
pub fn cli_main(argv: Vec<OsString>) -> i32 {
    let args = Args::parse_from(argv);
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("Error: cannot start the async runtime: {error}");
            return 1;
        }
    };
    runtime.block_on(run(args))
}

async fn run(args: Args) -> i32 {
    // reqwest is built with `rustls-no-provider`: install the process-wide rustls
    // crypto provider before any HTTP client exists (building one without it panics).
    let _ = rustls::crypto::ring::default_provider().install_default();

    let gold_text = match tokio::fs::read_to_string(&args.gold).await {
        Ok(t) => t,
        Err(err) => {
            eprintln!("Error reading gold set {}: {err}", args.gold.display());
            return 1;
        }
    };

    let cases = parse_gold(&gold_text);
    if cases.is_empty() {
        eprintln!(
            "Error: no valid gold cases parsed from {}",
            args.gold.display()
        );
        return 1;
    }

    if !args.qps.is_finite() || args.qps < 0.001 {
        eprintln!("Error: --qps must be finite and at least 0.001.");
        return 2;
    }
    let interval = Duration::from_secs_f64(1.0 / args.qps.min(2.0));

    let target: Box<dyn EvalTarget> = match args.target.as_str() {
        "mcp" => {
            if !valid_mcp_tool(&args.mcp_tool) {
                eprintln!("Error: --mcp-tool must be rag_search.");
                return 2;
            }
            Box::new(
                McpTarget::new(mcp_endpoint_url(args.url.as_deref()))
                    .with_tool_name(args.mcp_tool.clone())
                    .with_rate_limit(interval),
            )
        }
        "local" => match build_local_target(&args) {
            Ok(target) => Box::new(target),
            Err(message) => {
                eprintln!("Error: {message} (exit code 2).");
                return 2;
            }
        },
        "http" => match args.url.as_deref().filter(|url| !url.is_empty()) {
            Some(url) => Box::new(HttpTarget::new(url.to_owned()).with_rate_limit(interval)),
            None => {
                eprintln!("Error: --target http requires --url <search endpoint> (exit code 2).");
                return 2;
            }
        },
        other => {
            eprintln!(
                "Error: unknown --target `{other}`; expected http, mcp or local (exit code 2)."
            );
            return 2;
        }
    };

    let opts = EvalOptions {
        limit_k: args.limit,
        allow_mixed: args.allow_mixed,
        gates: args.gates,
        tag_filter: args.tag,
    };

    match run_eval(target.as_ref(), &cases, &opts).await {
        Ok(summary) => {
            if args.json {
                if let Ok(json_str) = serde_json::to_string_pretty(&summary) {
                    println!("{json_str}");
                }
            } else {
                println!("{}", summary.format_markdown());
            }

            if !summary.passed_gates {
                eprintln!("Gate verification failed (exit code 3).");
                3
            } else {
                0
            }
        }
        Err(EvalError::ConditionMismatch { expected, observed }) => {
            eprintln!(
                "Condition mismatch error: expected `{expected}`, observed `{observed}` (exit \
                 code 4)."
            );
            4
        }
        Err(err) => {
            eprintln!("Evaluation failed: {err}");
            1
        }
    }
}

/// Local default: `aphrody-mcp http`'s own `--bind` default is
/// `127.0.0.1:8789`, serving the MCP endpoint at `/mcp`
/// (`crates/aphrody-mcp/src/main.rs`'s `TopCommand::Http` and `http_app()`).
/// `mcp.aphrody.com`/`aphrody.com/mcp` is not a route this eval tool can rely
/// on: yolo's `infra/config/host/nginx/routes.json` marks it `status: retired`
/// (its backing `aphrody-site` origin is retired), so a hard-coded public URL
/// here would silently point at nothing. `APHRODY_MCP_HTTP_URL` lets a
/// deployment that does expose a live MCP HTTP origin override this without a
/// rebuild; `--url` (CLI) still wins over both.
const DEFAULT_MCP_URL: &str = "http://127.0.0.1:8789/mcp";

fn default_mcp_url() -> String {
    std::env::var("APHRODY_MCP_HTTP_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_MCP_URL.to_owned())
}

fn mcp_endpoint_url(explicit: Option<&str>) -> String {
    explicit.map(str::to_owned).unwrap_or_else(default_mcp_url)
}

fn valid_mcp_tool(name: &str) -> bool {
    name == "rag_search"
}

/// Normalise `raw` into a full `/v1/<suffix>` endpoint, accepting a server
/// root, a `/v1` base or the complete URL.
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

/// Validate the `local` target flags without opening anything.
fn validate_local_args(args: &Args) -> Result<PathBuf, String> {
    let db = args
        .db
        .clone()
        .ok_or("--target local requires --db <PATH>")?;
    if !db.is_file() {
        return Err(format!(
            "local index `{}` does not exist; run `aphrody rag index` first",
            db.display()
        ));
    }
    if args.mode != LocalMode::Lexical {
        if args.embed_endpoint.as_deref().is_none_or(str::is_empty) {
            return Err(format!("--mode {:?} requires --embed-endpoint", args.mode).to_lowercase());
        }
        if args.embed_model.as_deref().is_none_or(str::is_empty) {
            return Err(format!("--mode {:?} requires --embed-model", args.mode).to_lowercase());
        }
        if args.vector_dim == 0 {
            return Err("--vector-dim must be greater than zero".to_owned());
        }
    }
    if args.rerank_endpoint.is_some() != args.rerank_model.is_some() {
        return Err("--rerank-endpoint and --rerank-model must be given together".to_owned());
    }
    Ok(db)
}

/// Open the local SQLite index and assemble the in-process retrieval target.
fn build_local_target(args: &Args) -> Result<LocalIndexTarget, String> {
    let db = validate_local_args(args)?;
    let store =
        RagStore::open(&db).map_err(|err| format!("cannot open `{}`: {err}", db.display()))?;
    let mut searcher = RagSearcher::new(Arc::new(store));

    if args.mode != LocalMode::Lexical {
        // Both unwraps are guaranteed by `validate_local_args`.
        let raw = args.embed_endpoint.as_deref().unwrap_or_default();
        let model = args.embed_model.as_deref().unwrap_or_default();
        let api_key = std::env::var("APHRODY_RAG_API_KEY")
            .ok()
            .filter(|key| !key.is_empty());
        let embedder: Arc<dyn Embedder> = match args.embed_dialect {
            EmbedDialect::LlamaServer => Arc::new(LlamaServerEmbedder::new(
                endpoint(raw, "embeddings"),
                model,
                args.vector_dim,
            )),
            EmbedDialect::OpenaiCompat => Arc::new(OpenAiCompatEmbedder::new(
                endpoint(raw, "embeddings"),
                model,
                args.vector_dim,
                api_key,
            )),
        };
        searcher = searcher.with_embedder(embedder);
    }

    let rerank = match (&args.rerank_endpoint, &args.rerank_model) {
        (Some(url), Some(model)) => {
            let mut reranker = LlamaServerReranker::new(url, model);
            if let Ok(key) = std::env::var("APHRODY_RAG_API_KEY")
                && !key.is_empty()
            {
                reranker = reranker.with_api_key(key);
            }
            let reranker: Arc<dyn Reranker> = Arc::new(reranker);
            searcher = searcher.with_reranker(reranker);
            true
        }
        _ => false,
    };

    let mut target = LocalIndexTarget::new(Arc::new(searcher))
        .with_mode(args.mode.into())
        .with_rerank(rerank);
    if let Some(prefix) = &args.path_prefix {
        target = target.with_path_prefix(prefix.clone());
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_accepts_only_read_only_mcp_search_tools() {
        assert!(valid_mcp_tool("rag_search"));
        assert!(!valid_mcp_tool("delete_document"));
    }

    #[test]
    fn mcp_default_uses_the_local_aphrody_mcp_http_origin() {
        // No APHRODY_MCP_HTTP_URL set in the test environment: falls back to
        // aphrody-mcp's own `http --bind` default (127.0.0.1:8789/mcp), never
        // the retired public aphrody.com/mcp route.
        if std::env::var("APHRODY_MCP_HTTP_URL").is_ok() {
            return; // environment override present: skip, don't assert on it.
        }
        assert_eq!(mcp_endpoint_url(None), "http://127.0.0.1:8789/mcp");
        assert_eq!(
            mcp_endpoint_url(Some("http://127.0.0.1:8000/mcp")),
            "http://127.0.0.1:8000/mcp"
        );
    }

    fn args(extra: &[&str]) -> Args {
        let mut argv = vec![
            "aphrody-rag-eval",
            "--gold",
            "gold.jsonl",
            "--target",
            "local",
        ];
        argv.extend_from_slice(extra);
        Args::parse_from(argv)
    }

    #[test]
    fn endpoint_accepts_base_v1_or_full_url() {
        assert_eq!(
            endpoint("http://h:1", "embeddings"),
            "http://h:1/v1/embeddings"
        );
        assert_eq!(
            endpoint("http://h:1/v1", "embeddings"),
            "http://h:1/v1/embeddings"
        );
        assert_eq!(
            endpoint("http://h:1/v1/embeddings/", "embeddings"),
            "http://h:1/v1/embeddings"
        );
    }

    #[test]
    fn local_target_requires_db() {
        let err = validate_local_args(&args(&[])).unwrap_err();
        assert!(err.contains("--db"), "{err}");
    }

    #[test]
    fn local_target_rejects_missing_index() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("absent.db");
        let err = validate_local_args(&args(&["--db", missing.to_str().unwrap()])).unwrap_err();
        assert!(err.contains("does not exist"), "{err}");
    }

    #[test]
    fn vector_modes_require_an_embedding_server() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("index.db");
        drop(RagStore::open(&db).unwrap());
        let db = db.to_str().unwrap();

        let err = validate_local_args(&args(&["--db", db, "--mode", "hybrid"])).unwrap_err();
        assert!(err.contains("--embed-endpoint"), "{err}");

        let err = validate_local_args(&args(&[
            "--db",
            db,
            "--mode",
            "hybrid",
            "--embed-endpoint",
            "http://127.0.0.1:8080",
        ]))
        .unwrap_err();
        assert!(err.contains("--embed-model"), "{err}");

        let err =
            validate_local_args(&args(&["--db", db, "--rerank-endpoint", "http://x"])).unwrap_err();
        assert!(err.contains("--rerank-model"), "{err}");
    }

    #[test]
    fn lexical_local_target_opens_an_existing_index() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("index.db");
        drop(RagStore::open(&db).unwrap());
        let target = build_local_target(&args(&["--db", db.to_str().unwrap()])).unwrap();
        assert_eq!(target.name(), "local:in-process");
    }

    #[test]
    fn hybrid_local_target_builds_with_an_embedding_server() {
        // The embedder owns a reqwest client; rustls needs its provider first.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("index.db");
        drop(RagStore::open(&db).unwrap());
        let target = build_local_target(&args(&[
            "--db",
            db.to_str().unwrap(),
            "--mode",
            "hybrid",
            "--embed-endpoint",
            "http://127.0.0.1:8080",
            "--embed-model",
            "multilingual-e5-small",
        ]))
        .unwrap();
        assert_eq!(target.name(), "local:in-process");
    }
}
