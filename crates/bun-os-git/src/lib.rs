// Leaf crate on std, gix and octocrab, outside the event loop (like `bun_host`, `bun_ssh`):
// std I/O, std strings and std::process are intended here.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

// SPDX-License-Identifier: Apache-2.0
//! Native Git and GitHub primitives shared by every Aphrody repository.
//!
//! Local repository inspection is implemented with `gix`, without spawning a
//! system `git` process. GitHub REST and GraphQL calls are implemented with
//! `octocrab`; credentials are read only at runtime and are never serialized.

pub mod awesome;
mod distribution;
mod github;
pub mod history;
pub mod ingest;
pub mod project;
mod repository;
pub mod search;
pub mod source;
pub mod upstream;

pub use awesome::{
    AwesomeCategory, AwesomeIndex, AwesomeItem, PRESETS, fetch_awesome_list,
    parse_awesome_markdown, resolve_preset, search_awesome_ecosystem,
};
pub use ingest::{
    DEFAULT_IGNORE_PATTERNS, IngestOptions, IngestResult, SEPARATOR, estimate_tokens,
    format_token_count, ingest_remote, is_remote_source,
};
pub use search::{
    GitHubDocsReport, GitHubRepoDoc, RepoSearchResult, search_github_docs, search_repositories,
};

// Keep one backend version across the ecosystem while exposing the complete
// typed APIs for operations not covered by Aphrody's convenience layer.
pub use distribution::{
    CONSUMER_WORKFLOW_PATH, EcosystemOutcome, InstallMode, InstallOutcome, WorkflowState,
    audit_ecosystem_workflows, install_consumer_workflow, render_consumer_workflow,
    rollout_ecosystem_workflows,
};
pub use github::{ApiMethod, ApiResponse, GitHubClient};
pub use gix;
pub use history::{Divergence, History, HistoryOptions, Hotspot, LogEntry, repository_history};
pub use octocrab;
pub use project::{
    GitBranch, GitCommitGraph, GitCommitNode, GitDiffItem, GitTreeNode, GitWorktreeInfo,
    commit_graph, commit_log, list_branches, list_tree_at, list_worktrees,
};
pub use repository::{Change, GitHubRepository, LocalRepository, Remote, inspect_repository};
pub use source::{SourceReport, SourceRow, SourceState, source_report};

/// Errors emitted by the unified Git/GitHub surface.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A native `gix` operation failed.
    #[error("git operation failed: {0}")]
    Git(String),
    /// A GitHub API request failed before an HTTP response was received.
    #[error("GitHub request failed: {0}")]
    GitHub(#[from] octocrab::Error),
    /// GitHub returned an unsuccessful HTTP response.
    #[error("GitHub returned HTTP {status}: {body}")]
    GitHubStatus {
        /// HTTP status code.
        status: u16,
        /// Response body, kept for actionable diagnostics.
        body: String,
    },
    /// The repository identifier or remote URL is not a GitHub repository.
    #[error("invalid GitHub repository reference: {0}")]
    InvalidRepository(String),
    /// JSON input could not be decoded.
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// A filesystem operation failed.
    #[error("{operation} `{path}`: {source}")]
    Io {
        /// Human-readable operation name.
        operation: &'static str,
        /// Affected path.
        path: std::path::PathBuf,
        /// Original I/O error.
        source: std::io::Error,
    },
    /// Refused to overwrite a file that Aphrody does not own.
    #[error("refusing to overwrite unmanaged workflow `{0}`")]
    UnmanagedWorkflow(std::path::PathBuf),
    /// A local workflow path traverses a symbolic link or escapes its repository.
    #[error("unsafe workflow path `{0}`")]
    UnsafeWorkflowPath(std::path::PathBuf),
}

pub(crate) fn git_error(error: impl std::fmt::Display) -> Error {
    Error::Git(error.to_string())
}

pub(crate) fn io_error(
    operation: &'static str,
    path: impl Into<std::path::PathBuf>,
    source: std::io::Error,
) -> Error {
    Error::Io { operation, path: path.into(), source }
}
