// SPDX-License-Identifier: Apache-2.0
//! `aphrody-rag-core` — the pure, `wasm32-unknown-unknown`-safe heart of the
//! aphrody RAG layer (`docs/plans/codex-oss.md` phases P8/P9).
//!
//! Three independent pieces, all free of I/O, threads, and SQLite:
//!
//! 1. **Chunkers** ([`chunk`], plus one module per source kind): split a file into retrieval-sized,
//!    line-addressed [`chunk::Chunk`]s. Pick one by path via [`chunk::chunker_for_path`], or
//!    construct a specific [`chunk::Chunker`] directly.
//! 2. **Fusion** ([`fusion`]): Reciprocal Rank Fusion, source-weighted re-ranking with a
//!    guaranteed-quota promotion pass, Maximal Marginal Relevance diversification, and the small
//!    vector kernels (dot, cosine, int8 quantization, bounded-heap exact top-k) a retrieval
//!    pipeline needs around them.
//! 3. **Eval** ([`eval`]): a bit-for-bit port of the TypeScript reference's retrieval eval harness
//!    (`apps/bot/src/lib/rag-eval.ts` + `apps/bot/scripts/ rag-eval.ts`), so aphrody's RAG can be
//!    benchmarked against the TypeScript reference's production numbers on the same gold set and the same metric
//!    definitions.
//!
//! ## wasm32 support
//!
//! [`rust_chunker`], [`markdown_chunker`], [`structural_chunker`],
//! [`prose_chunker`], [`fusion`], and [`eval`] compile for
//! `wasm32-unknown-unknown` unconditionally. [`jsts_chunker`] (feature
//! `oxc`, default-on) depends on the `oxc_parser` toolchain, whose wasm32
//! story this crate does not verify; a `wasm32-unknown-unknown` consumer
//! should build with `--no-default-features` and fall back to
//! [`structural_chunker::StructuralChunker`] for JS/TS (already what
//! [`chunk::chunker_for_path`] does when the `oxc` feature is off).
//!
//! ## Example
//!
//! ```
//! use aphrody_rag_core::{ChunkOptions, chunker_for_path};
//!
//! let source = "fn greet() {\n    println!(\"hi\");\n}\n";
//! let chunks =
//!     chunker_for_path("src/lib.rs").chunk("src/lib.rs", source, &ChunkOptions::default());
//! assert_eq!(chunks.len(), 1);
//! assert_eq!(chunks[0].symbol.as_deref(), Some("greet"));
//! ```

#![forbid(unsafe_code)]

pub mod api;
mod chunk;
mod markdown_chunker;
mod prose_chunker;
mod rust_chunker;
mod structural_chunker;
pub mod text;
pub mod vectors_f32;
pub mod vectors_f64;

#[cfg(feature = "oxc")]
mod jsts_chunker;

pub mod eval;
pub mod fusion;

pub use chunk::{
    Chunk, ChunkKind, ChunkOptions, Chunker, Language, LengthUnit, chunker_for_path,
    detect_language,
};
#[cfg(feature = "oxc")]
pub use jsts_chunker::JsTsChunker;
pub use markdown_chunker::MarkdownChunker;
pub use prose_chunker::ProseChunker;
pub use rust_chunker::RustChunker;
pub use structural_chunker::StructuralChunker;
