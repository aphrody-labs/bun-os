// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Unified RAG storage, embedding, vector scan, hybrid search, and agent tools for aphrody.
//!
//! Provides production-grade SQLite FTS5 lexical retrieval combined with dense vector
//! similarity scanning, Reciprocal Rank Fusion (RRF k=60.0), cross-encoder reranking,
//! incremental file indexing, and agent-facing toolcalls (`rag_search`, `rag_context`).

pub mod config_resolve;
pub mod embedder;
pub mod error;
pub mod home;
pub mod home_cli;
pub mod indexer;
pub mod pipeline;
pub mod postgres;
pub mod redis_cache;
pub mod reranker;
pub mod schema;
pub mod search;
pub mod store;
pub mod tools;

pub use config_resolve::{
    ResolvedEmbedConfig, ResolvedRerankConfig, rerank_available, resolve_embed, resolve_rerank,
};
#[cfg(feature = "native")]
pub use embedder::NativeEmbedder;
#[cfg(feature = "ort")]
pub use embedder::OrtEmbedder;
pub use embedder::{
    Embedder, LlamaServerEmbedder, MATRYOSHKA_512_DIM, OpenAiCompatEmbedder,
    QWEN3_QUERY_INSTRUCTION, StubEmbedder, format_query_or_passage, truncate_and_normalize_mrl,
};
pub use error::{RagError, Result};
pub use home::{HitKind, UnifiedHit, UnifiedOptions, unified_search};
pub use indexer::{IndexOptions, IndexStats, RagIndexer};
pub use postgres::{PgWebIngestResult, ingest_web_document, search_documents, stats as pg_stats};
pub use redis_cache::RedisRagCache;
#[cfg(feature = "native")]
pub use reranker::NativeReranker;
pub use reranker::{LlamaServerReranker, NoopReranker, Reranker};
pub use search::{RagSearcher, SearchMode, SearchOptions, SearchResult};
pub use store::{ChunkRecord, DocRecord, RagStats, RagStore, ScoredChunk};
pub use tools::{
    RagContextTool, RagSearchTool, WebIngestTool, register_rag_tools, register_web_ingest_tool,
    scrape_web_markdown,
};
