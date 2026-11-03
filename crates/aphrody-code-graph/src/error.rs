// SPDX-License-Identifier: Apache-2.0
//! Errors of the code graph.

use thiserror::Error;

/// Result alias.
pub type Result<T, E = GraphError> = std::result::Result<T, E>;

/// Failures of graph loading, analysis and export.
#[derive(Debug, Error)]
pub enum GraphError {
    /// Home database failure.
    #[error("store error: {0}")]
    Store(#[from] aphrody_store::StoreError),
    /// SQLite failure.
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// JSON failure.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    /// The named graph source does not exist.
    #[error("unknown graph source `{0}`")]
    UnknownSource(String),
    /// A node reference matched nothing.
    #[error("no node matches `{0}`")]
    NoMatch(String),
    /// A node reference matched several nodes.
    #[error(
        "`{text}` matches {total} nodes; pass an id or `file::symbol`:\n  {}",
        candidates.join("\n  ")
    )]
    Ambiguous {
        /// The reference.
        text: String,
        /// Number of candidates.
        total: usize,
        /// First candidates: `label - file:loc [id ...] (n edges)`.
        candidates: Vec<String>,
    },
    /// A request of the JSON worker API is malformed or outside its domain.
    #[error("invalid graph request: {0}")]
    Invalid(String),
    /// A request exceeded one of its limits.
    #[error("graph limit exceeded: {0}")]
    Limit(&'static str),
    /// The operation was cancelled.
    #[error("graph operation cancelled")]
    Cancelled,
}

/// Fail with [`GraphError::Cancelled`] once `cancelled` is set.
///
/// # Errors
///
/// [`GraphError::Cancelled`] when the flag is set.
pub fn check_cancel(cancelled: &std::sync::atomic::AtomicBool) -> Result<()> {
    if cancelled.load(std::sync::atomic::Ordering::Relaxed) {
        Err(GraphError::Cancelled)
    } else {
        Ok(())
    }
}
