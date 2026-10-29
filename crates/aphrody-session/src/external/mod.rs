// SPDX-License-Identifier: Apache-2.0
//! External agent sessions: discover the transcripts the other coding agents
//! on this machine write, and mirror them incrementally into aphrody's own
//! session store.
//!
//! Three agents are understood, each through its real on-disk layout:
//!
//! | Agent | Root | Transcripts |
//! |---|---|---|
//! | Antigravity CLI (`agy`) | `~/.gemini/antigravity-cli` | `brain/<id>/.system_generated/logs/transcript.jsonl`; `cache/last_conversations.json` maps a workspace to its current conversation |
//! | Codex | `$CODEX_HOME`, else `~/.codex` | `sessions/**/rollout-*.jsonl`; `session_index.jsonl` names the threads |
//! | Claude Code | `$CLAUDE_CONFIG_DIR`, else `~/.claude` | `projects/<slug>/<session>.jsonl` |
//!
//! Every transcript line is normalised into zero or more [`ExternalRecord`]s
//! (`{agent, session_id, workspace, ts, role, text, source_path, offset}`)
//! and appended to `<output>/<agent>/<session_id>.jsonl`, where `<output>` is
//! aphrody's sessions directory (`~/.aphrody/sessions`, see
//! [`default_output_dir`]).
//!
//! ## Incrementality
//!
//! A state file (`<output>/.external-sync-state.json`) keeps, per source
//! file, the byte offset up to which it has been ingested plus a fingerprint
//! of its first bytes. A re-run reads only the complete lines appended since;
//! a trailing line without its newline (the writer is mid-write) is left for
//! the next run. A source whose head no longer matches its fingerprint, or
//! that shrank, was rewritten and is ingested again from the start.
//!
//! ## Exactly-once mirror
//!
//! The state also records the committed length of every mirror file. A mirror
//! found longer than its committed length carries the tail of a run that died
//! between writing and committing, and is cut back before anything is
//! appended; one found shorter (deleted or truncated by hand) is rebuilt from
//! its sources. A batch the caller's sink rejects is rolled back the same way,
//! so neither a crash nor a failing sink ever duplicates or loses a record.
//! Concurrent runs (a `--watch` loop and an MCP call) are serialised by an
//! exclusive lock on `<output>/.external-sync.lock`.
//!
//! Mirror file names never start with `rollout-`, so aphrody's own rollout
//! listing, which walks the same directory, never mistakes them for its own.

mod agy;
mod claude;
mod codex;
mod common;
#[cfg(feature = "memory")]
mod memory;
mod process;
mod state;
mod sync;
#[cfg(test)]
mod tests;

use std::{
    fmt, io,
    path::{Path, PathBuf},
    str::FromStr,
    time::SystemTime,
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(feature = "memory")]
pub use self::memory::{
    MEMORY_ROLES, feed_memory, memory_agent_id, memory_record_id, sync_into_memory,
    to_memory_record, workspace_memory,
};
pub use self::{
    process::{LiveAgentProcess, classify_process, probe_live_processes},
    state::{SourceState, SyncState},
    sync::{discover_sources, sync, sync_with},
};

/// Default cap on one record's `text`, in bytes. Tool outputs routinely run
/// to megabytes; the mirror keeps the head and flags the record `truncated`.
pub const DEFAULT_MAX_TEXT_BYTES: usize = 32 * 1024;

/// Name of the state file kept in the output directory.
pub const STATE_FILE_NAME: &str = ".external-sync-state.json";

/// Name of the lock file serialising concurrent runs.
pub const LOCK_FILE_NAME: &str = ".external-sync.lock";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// A failure that stops a whole sync run. Failures confined to one source
/// file are reported as [`SyncIssue`]s instead and never abort the run.
#[derive(Debug, Error)]
pub enum SyncError {
    /// No home directory could be determined for this user.
    #[error("cannot determine the home directory")]
    NoHome,
    /// aphrody's state directory could not be resolved.
    #[error("cannot resolve the aphrody state directory: {0}")]
    NoStateDir(String),
    /// Domain/profile selection is invalid.
    #[error("invalid agent domain/profile: {0}")]
    InvalidDomain(String),
    /// An agent name that is none of `agy`, `codex`, `claude`.
    #[error("unknown agent `{0}` (expected agy, codex or claude)")]
    UnknownAgent(String),
    /// Filesystem failure on `path`.
    #[error("{}: {source}", path.display())]
    Io {
        /// The file or directory the operation was about.
        path: PathBuf,
        /// The underlying error.
        #[source]
        source: io::Error,
    },
    /// The state file exists but is not a valid sync state.
    #[error(
        "sync state {} is not valid ({source}); move it aside to rebuild the mirror from scratch",
        path.display()
    )]
    CorruptState {
        /// The state file.
        path: PathBuf,
        /// The decoder error.
        #[source]
        source: serde_json::Error,
    },
    /// JSON encoding failure while writing the mirror or the state.
    #[error("json encoding failed: {0}")]
    Json(#[from] serde_json::Error),
}

impl SyncError {
    pub(crate) fn io(path: impl Into<PathBuf>) -> impl FnOnce(io::Error) -> Self {
        let path = path.into();
        move |source| Self::Io { path, source }
    }
}

// ---------------------------------------------------------------------------
// Agents and roles
// ---------------------------------------------------------------------------

/// A coding agent whose sessions can be mirrored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    /// Google Antigravity CLI (`agy`).
    Agy,
    /// OpenAI Codex CLI.
    Codex,
    /// Anthropic Claude Code.
    Claude,
}

impl AgentKind {
    /// Every supported agent, in report order.
    pub const ALL: [Self; 3] = [Self::Agy, Self::Codex, Self::Claude];

    /// Stable lowercase name, also the mirror subdirectory.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Agy => "agy",
            Self::Codex => "codex",
            Self::Claude => "claude",
        }
    }
}

impl fmt::Display for AgentKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for AgentKind {
    type Err = SyncError;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "agy" | "antigravity" | "antigravity-cli" => Ok(Self::Agy),
            "codex" => Ok(Self::Codex),
            "claude" | "claude-code" => Ok(Self::Claude),
            _ => Err(SyncError::UnknownAgent(raw.to_owned())),
        }
    }
}

/// Who produced a normalised record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// A human prompt.
    User,
    /// Model text addressed to the user.
    Assistant,
    /// Harness, developer or inter-agent message; compaction notes.
    System,
    /// A tool invocation issued by the model (`name` + arguments).
    ToolCall,
    /// What a tool returned.
    ToolResult,
    /// Model reasoning that the agent stored in clear text.
    Reasoning,
}

impl Role {
    /// Stable snake-case name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::System => "system",
            Self::ToolCall => "tool_call",
            Self::ToolResult => "tool_result",
            Self::Reasoning => "reasoning",
        }
    }

    /// Map a chat-message role string (`user`, `assistant`, `developer`, ...).
    pub(crate) fn from_message_role(raw: &str) -> Self {
        match raw {
            "user" => Self::User,
            "assistant" | "model" => Self::Assistant,
            "tool" => Self::ToolResult,
            _ => Self::System,
        }
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

// ---------------------------------------------------------------------------
// The normalised record
// ---------------------------------------------------------------------------

/// One transcript entry of an external agent, normalised.
///
/// `source_path` + `offset` locate the source line (the byte offset of its
/// first byte); `part` numbers the records one line produced (a Claude Code
/// assistant line carrying text and two tool calls yields parts 0, 1, 2), so
/// `(agent, session_id, offset, part)` identifies a record uniquely.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExternalRecord {
    /// The agent that wrote the transcript.
    pub agent: AgentKind,
    /// The agent's own session / conversation / thread id.
    pub session_id: String,
    /// Working directory of the session, when the transcript names it.
    #[serde(default)]
    pub workspace: Option<String>,
    /// Timestamp of the entry, when the transcript carries one.
    #[serde(default)]
    pub ts: Option<DateTime<Utc>>,
    /// Who produced the entry.
    pub role: Role,
    /// Text content (possibly truncated, see `truncated`).
    pub text: String,
    /// Absolute path of the source transcript.
    pub source_path: String,
    /// Byte offset of the source line in `source_path`.
    pub offset: u64,
    /// Index of this record among those produced by the same source line.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub part: u32,
    /// `true` when `text` was cut at the configured byte cap.
    #[serde(default, skip_serializing_if = "is_false")]
    pub truncated: bool,
}

fn is_zero(value: &u32) -> bool {
    *value == 0
}

fn is_false(value: &bool) -> bool {
    !*value
}

// ---------------------------------------------------------------------------
// Where the agents live, and where the mirror goes
// ---------------------------------------------------------------------------

/// Root directory of each agent's data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentRoots {
    /// `~/.gemini/antigravity-cli`.
    pub agy: PathBuf,
    /// `$CODEX_HOME`, else `~/.codex`.
    pub codex: PathBuf,
    /// `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
    pub claude: PathBuf,
}

impl AgentRoots {
    /// The default layout below `home`, ignoring environment overrides.
    #[must_use]
    pub fn from_home(home: &Path) -> Self {
        Self {
            agy: home.join(".gemini").join("antigravity-cli"),
            codex: home.join(".codex"),
            claude: home.join(".claude"),
        }
    }

    /// The roots for the current user: the home directory from the `dirs`
    /// crate, with the overrides the agents themselves honour (`CODEX_HOME`,
    /// `CLAUDE_CONFIG_DIR`) applied when set and non-empty.
    ///
    /// # Errors
    ///
    /// [`SyncError::NoHome`] when no home directory can be determined.
    pub fn discover() -> Result<Self, SyncError> {
        let home = dirs::home_dir().ok_or(SyncError::NoHome)?;
        let mut roots = Self::from_home(&home);
        if let Some(codex) = non_empty_env("CODEX_HOME") {
            roots.codex = codex;
        }
        if let Some(claude) = non_empty_env("CLAUDE_CONFIG_DIR") {
            roots.claude = claude;
        }
        Ok(roots)
    }

    /// The root of `agent`.
    #[must_use]
    pub fn root(&self, agent: AgentKind) -> &Path {
        match agent {
            AgentKind::Agy => &self.agy,
            AgentKind::Codex => &self.codex,
            AgentKind::Claude => &self.claude,
        }
    }
}

fn non_empty_env(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// aphrody's sessions directory (`$APHRODY_HOME/sessions`, else
/// `~/.aphrody/sessions`), resolved through `aphrody_models::paths`, the
/// single authority for the state directory.
///
/// # Errors
///
/// [`SyncError::NoStateDir`] when the state directory cannot be resolved.
pub fn default_output_dir() -> Result<PathBuf, SyncError> {
    aphrody_models::paths::sessions_dir().map_err(|error| SyncError::NoStateDir(error.to_string()))
}

/// Canonical allowlisted domain profile. Existing global stores are never migrated.
pub fn domain_profile_dir(domain: &str) -> Result<PathBuf, SyncError> {
    if !matches!(domain, "aphrody" | "ie") {
        return Err(SyncError::InvalidDomain(domain.into()));
    }
    let state = aphrody_models::paths::state_dir()
        .map_err(|error| SyncError::NoStateDir(error.to_string()))?;
    let canonical = state.join("workspaces").join(domain);
    let selected = non_empty_env("APHRODY_WORKSPACE").unwrap_or_else(|| canonical.clone());
    if !selected.join("AGENTS.md").is_file()
        || selected.canonicalize().ok() != canonical.canonicalize().ok()
    {
        return Err(SyncError::InvalidDomain(
            "workspace must match the selected domain profile".into(),
        ));
    }
    Ok(selected)
}

/// What one sync run does.
#[derive(Debug, Clone)]
pub struct SyncOptions {
    /// Where the agents keep their data.
    pub roots: AgentRoots,
    /// Mirror root; receives `<agent>/<session_id>.jsonl`, the state file and
    /// the lock file.
    pub output_dir: PathBuf,
    /// Agents to sync. Empty means all of them.
    pub agents: Vec<AgentKind>,
    /// Cap on one record's text, in bytes (`0` disables the cap).
    pub max_text_bytes: usize,
    /// Match running agent processes (sysinfo) to the sessions they write.
    pub probe_processes: bool,
    /// Require an explicit launcher domain marker; unknown sessions are excluded.
    pub domain_filter: Option<String>,
    /// Optional exact code workspace filter.
    pub workspace_filter: Option<PathBuf>,
}

impl SyncOptions {
    /// Sync every agent from `roots` into `output_dir`, without process
    /// probing.
    #[must_use]
    pub fn new(roots: AgentRoots, output_dir: impl Into<PathBuf>) -> Self {
        Self {
            roots,
            output_dir: output_dir.into(),
            agents: AgentKind::ALL.to_vec(),
            max_text_bytes: DEFAULT_MAX_TEXT_BYTES,
            probe_processes: false,
            domain_filter: None,
            workspace_filter: None,
        }
    }

    /// [`AgentRoots::discover`] into [`default_output_dir`].
    ///
    /// # Errors
    ///
    /// Propagates [`AgentRoots::discover`] and [`default_output_dir`].
    pub fn discover() -> Result<Self, SyncError> {
        let mut options = Self::new(AgentRoots::discover()?, default_output_dir()?);
        if let Some(domain) = std::env::var("APHRODY_AGENT_DOMAIN")
            .ok()
            .filter(|domain| !domain.is_empty())
        {
            options.output_dir = domain_profile_dir(&domain)?.join("sessions");
            options.domain_filter = Some(domain);
        }
        Ok(options)
    }

    /// Restrict to an explicit launcher domain; untagged sessions are excluded.
    #[must_use]
    pub fn with_domain(mut self, domain: impl Into<String>) -> Self {
        self.domain_filter = Some(domain.into());
        self
    }

    /// Restrict to one exact code workspace.
    #[must_use]
    pub fn with_workspace(mut self, workspace: impl Into<PathBuf>) -> Self {
        self.workspace_filter = Some(workspace.into());
        self
    }

    /// Restrict the run to `agents` (empty keeps all of them).
    #[must_use]
    pub fn with_agents(mut self, agents: Vec<AgentKind>) -> Self {
        self.agents = agents;
        self
    }

    /// Enable or disable live-process enrichment.
    #[must_use]
    pub fn with_probe_processes(mut self, probe: bool) -> Self {
        self.probe_processes = probe;
        self
    }

    /// Set the per-record text cap (`0` disables it).
    #[must_use]
    pub fn with_max_text_bytes(mut self, max: usize) -> Self {
        self.max_text_bytes = max;
        self
    }

    /// The selected agents, deduplicated, in [`AgentKind::ALL`] order.
    #[must_use]
    pub fn selected_agents(&self) -> Vec<AgentKind> {
        AgentKind::ALL
            .into_iter()
            .filter(|agent| self.agents.is_empty() || self.agents.contains(agent))
            .collect()
    }

    /// Path of the state file.
    #[must_use]
    pub fn state_path(&self) -> PathBuf {
        self.output_dir.join(STATE_FILE_NAME)
    }
}

// ---------------------------------------------------------------------------
// Discovery result
// ---------------------------------------------------------------------------

/// One transcript file found on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSource {
    /// The agent that writes it.
    pub agent: AgentKind,
    /// The transcript file.
    pub path: PathBuf,
    /// Session id derived from the layout (directory or file name).
    pub session_id: String,
    /// Workspace known without reading the transcript (agy's maps).
    pub workspace: Option<String>,
    /// Human title, when the agent keeps one (Codex session index, agy
    /// conversation metadata).
    pub title: Option<String>,
    /// `true` when the agent itself names this the current conversation of
    /// its workspace (agy's `last_conversations.json`).
    pub current: bool,
    /// Last modification time of the transcript.
    pub modified: Option<SystemTime>,
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/// A problem confined to one source (or one auxiliary file). The run goes on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncIssue {
    /// The agent concerned, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentKind>,
    /// The file concerned, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// What happened.
    pub message: String,
}

impl SyncIssue {
    pub(crate) fn new(
        agent: Option<AgentKind>,
        path: Option<&Path>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            agent,
            path: path.map(|path| path.display().to_string()),
            message: message.into(),
        }
    }
}

/// Per-agent totals of one run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentReport {
    /// The agent.
    pub agent: AgentKind,
    /// Its data root.
    pub root: String,
    /// Whether that root exists on this machine.
    pub root_exists: bool,
    /// Transcript files found.
    pub sources: u64,
    /// Transcript files that yielded new lines this run.
    pub sources_updated: u64,
    /// Records appended to the mirror this run.
    pub records: u64,
    /// Source bytes consumed this run.
    pub bytes: u64,
    /// Source lines that were not valid JSON (skipped, counted).
    pub malformed_lines: u64,
}

/// A session that received records this run, or that a live agent process
/// is writing right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionReport {
    /// The agent.
    pub agent: AgentKind,
    /// The agent's session id.
    pub session_id: String,
    /// Human title, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Workspace, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    /// The source transcript.
    pub source_path: String,
    /// The mirror file.
    pub mirror_path: String,
    /// Records appended this run.
    pub new_records: u64,
    /// Bytes of the source ingested so far (the committed offset).
    pub offset: u64,
    /// Pids of live agent processes attributed to this session.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub live_pids: Vec<u32>,
}

/// What a memory feed did (filled by `sync_into_memory`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryFeedReport {
    /// The memory provider kind (`sqlite_local`, `mem0`, ...).
    pub provider: String,
    /// Records written into it this run.
    pub records_fed: u64,
    /// Roles that are fed (the others stay in the mirror only).
    pub roles: Vec<Role>,
}

/// The JSON summary of one sync run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncReport {
    /// Schema version of this summary.
    pub schema_version: u32,
    /// When the run started.
    pub started_at: DateTime<Utc>,
    /// Wall-clock duration of the run.
    pub duration_ms: u64,
    /// Mirror root.
    pub output_dir: String,
    /// State file.
    pub state_path: String,
    /// Records appended to mirrors this run, all agents together.
    pub records_ingested: u64,
    /// Transcript files found.
    pub sources_scanned: u64,
    /// Transcript files that yielded new lines.
    pub sources_updated: u64,
    /// Per-agent totals, in [`AgentKind::ALL`] order.
    pub agents: Vec<AgentReport>,
    /// Sessions that received records, or that a live process writes.
    pub sessions: Vec<SessionReport>,
    /// Live agent processes; `None` when probing was disabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live_processes: Option<Vec<LiveAgentProcess>>,
    /// Memory feed summary; `None` when no memory feed ran.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<MemoryFeedReport>,
    /// Non-fatal problems.
    pub issues: Vec<SyncIssue>,
}

/// Current [`SyncReport::schema_version`].
pub const REPORT_SCHEMA_VERSION: u32 = 1;
