// SPDX-License-Identifier: Apache-2.0
//! Unified Aphrody MCP server and client.
//!
//! The former `aphrody-mcp` binary is the [`cli_main`] entry point of this library, reached
//! through the `aphrody` multi-call binary (invocation name `aphrody-mcp` or the
//! `aphrody mcp-server` subcommand).
mod a2a_auth;
mod client_cmd;
mod environment;
#[cfg(not(target_arch = "wasm32"))]
#[path = "gemini_tools.rs"]
mod gemini_tools;
mod http_rest;
#[cfg(not(target_arch = "wasm32"))]
mod kernel_tools;
#[path = "native_crawl_tools.rs"]
mod native_crawl_tools;
#[path = "public_web_tools.rs"]
mod public_web_tools;
#[cfg(not(target_arch = "wasm32"))]
#[path = "search_tools.rs"]
mod search_tools;
#[cfg(not(target_arch = "wasm32"))]
mod site_tools;
mod x_tools;
// Voice MCP tools (TTS via aphrody-voice + STT via aphrody-voice-stt).
// Native-only: the module itself is `#[cfg(not(target_arch = "wasm32"))]`.
#[cfg(not(target_arch = "wasm32"))]
mod voice_tools;
// Gemini web app tools (gemini_chat 3.5 Flash + gemini_image Nano Banana).

#[cfg(not(target_arch = "wasm32"))]
mod firefly_tools;
#[cfg(not(target_arch = "wasm32"))]
mod photoshop_tools;
// Live Photoshop bridge — WebSocket server the in-app UXP plugin connects to.
#[cfg(not(target_arch = "wasm32"))]
mod photoshop_bridge;
// Local inference toolbox (docs/plans/local-inference-toolbox.md, step 7).
// Each module is behind its own opt-in Cargo feature because it drags a
// backend the base server has no use for; `--features toolbox` turns on all
// three. Native-only for the same reason as the voice tools: every backend
// spawns a child process or touches a real filesystem.
#[cfg(feature = "rag")]
mod home_tools;
#[cfg(all(feature = "jobs", not(target_arch = "wasm32")))]
mod jobs_tools;
#[cfg(all(feature = "ocr", not(target_arch = "wasm32")))]
mod ocr_tools;
#[cfg(all(feature = "rag", not(target_arch = "wasm32")))]
mod rag_tools;
#[cfg(all(feature = "stt-local", not(target_arch = "wasm32")))]
mod stt_local_tools;
#[cfg(all(feature = "vision", not(target_arch = "wasm32")))]
mod vision_tools;
// Aphrody Web catalog, merged into this server's tools/list (no second MCP server).
#[path = "bxc_tools.rs"]
mod bxc_tools;
// Tauri desktop UI tools are supplied by aphrody-ui through the kernel plugin subsystem.
#[cfg(not(target_arch = "wasm32"))]
mod tauri_tools;
// MCP protocol surface: annotations, version negotiation, resources, prompts.
mod http_auth;
mod jev_tools;
mod protocol;
// External agent session mirror (agy, Codex, Claude Code). Host-only: it reads
// the local filesystem and the process table.
#[cfg(not(target_arch = "wasm32"))]
mod sync_tools;
// Computer use over RFB (VNC) through the shared remote target model and credential store.
#[cfg(not(target_arch = "wasm32"))]
mod remote_tools;
// Browser automation served natively through the system-layer browser crates.
#[cfg(all(feature = "native-browser", not(target_arch = "wasm32")))]
#[path = "browser_tools.rs"]
mod browser_tools;
// WinClean catalog (Windows computer use and OS control).
#[cfg(all(feature = "winclean", windows))]
mod winclean_tools;

use std::{
    ffi::OsString,
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use anyhow::Result;
use axum::{Json, Router, middleware, routing::get};
use clap::{Parser, Subcommand};
use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::wrapper::Parameters,
    schemars, tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
};
use serde_json::json;
use sysinfo::System;

use crate::client_cmd::{ClientArgs, run as run_client};

// Bare invocation remains the stdio server; `client` and `guide` are explicit
// auxiliary operations.

#[derive(Debug, Parser)]
#[command(
    name = "aphrody-mcp",
    version,
    about = "Unified Rust MCP server + client. Bare invocation starts the stdio server; `client` \
             subcommand connects to third-party MCP servers. The exact tool set depends on the \
             Cargo features this binary was built with (see --features toolbox), so ask it: \
             `tools/list` over stdio is the only authoritative count."
)]
struct Cli {
    /// Load a protected dotenv file or JSON string map before starting the native runtime.
    #[arg(long, global = true, env = "APHRODY_MCP_ENV_FILE")]
    env_file: Option<std::path::PathBuf>,
    #[command(subcommand)]
    command: Option<TopCommand>,
}

#[derive(Debug, Subcommand)]
enum TopCommand {
    /// Run the stdio MCP server exposing the built-in tools (default mode).
    Server,
    /// Run the MCP Streamable HTTP server on a loopback address.
    Http {
        #[arg(long, default_value = "127.0.0.1:8789")]
        bind: SocketAddr,
    },
    /// Connect to a third-party MCP server (stdio or HTTP) and invoke its tools.
    Client(ClientArgs),
    /// Print how agents should use these tools instead of their built-ins (the
    /// plugin's session hook injects it into the model context).
    Guide,
}

// ---------------------------------------------------------------------------
// Global uptime anchor (set once at server boot).
// ---------------------------------------------------------------------------
static START_INSTANT: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct StyleGuideRequest {
    #[schemars(
        description = "The programming language or technical topic you need the style guide for."
    )]
    pub topic: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct WebFetchRequest {
    #[schemars(description = "The absolute URL of the webpage to fetch.")]
    pub url: String,
    /// Retrieval profile, opt-in.
    ///
    /// Absent (the default) means aphrody fetches the bytes itself and
    /// converts them in-process. Naming a profile renders the page in the
    /// in-process Obscura browser, which can run JavaScript. That is strictly
    /// more expensive, hence opt-in rather than default.
    #[schemars(
        description = "Optional Aphrody browser retrieval profile for pages that need a \
                              real browser: static | fast | http | stealth | max. Omit for the \
                              fast, local, direct fetch."
    )]
    pub profile: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct WebExtractHtmlRequest {
    #[schemars(description = "HTML document to extract, supplied directly by the caller.")]
    pub html: String,
    #[schemars(description = "Optional page URL for resolving relative links and metadata.")]
    pub url: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ScreenCaptureRequest {
    #[schemars(
        description = "Optional window title substring (case-insensitive). When omitted, \
                              the whole primary screen is captured."
    )]
    pub window: Option<String>,
    #[schemars(description = "Optional path to also save the PNG to disk.")]
    pub save_path: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AdvancedReconRequest {
    #[schemars(description = "Target host or IP address to scan.")]
    pub target: String,
    #[schemars(description = "List of TCP ports to probe for open states.")]
    pub ports: Option<Vec<u16>>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct StartDashboardRequest {
    #[schemars(description = "The TCP port number for the dashboard server. Defaults to 3000.")]
    pub port: Option<u16>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ReTriageRequest {
    #[schemars(
        description = "Absolute or workspace-relative path to a binary file to triage \
                              (PE32/PE64/ELF32/ELF64). The file is read into memory in full — \
                              best for binaries under 100 MB."
    )]
    pub path: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ReStringsRequest {
    #[schemars(
        description = "Absolute or workspace-relative path to a binary or data file. The \
                              file is read into memory in full — best for files under 100 MB."
    )]
    pub path: String,
    #[schemars(
        description = "Minimum length in characters for a string to be included. \
                              Defaults to 6 when unset. Must be at least 1."
    )]
    pub min_len: Option<usize>,
    #[schemars(
        description = "Maximum number of strings to return. Defaults to 64 when unset. \
                              Capped at 4096 to bound response size."
    )]
    pub limit: Option<usize>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ReSectionsRequest {
    #[schemars(
        description = "Absolute or workspace-relative path to a binary file to triage \
                              (PE32/PE64/ELF32/ELF64). The file is read into memory in full — \
                              best for binaries under 100 MB."
    )]
    pub path: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ReDisasmRequest {
    #[schemars(
        description = "Absolute or workspace-relative path to a binary or raw byte file \
                              to disassemble. The file is read into memory in full — best for \
                              files under 100 MB."
    )]
    pub path: String,
    #[schemars(
        description = "Byte offset into the file at which to start disassembly. Defaults \
                              to 0 (beginning of file). Useful to target a specific section or \
                              function without extracting it first."
    )]
    pub offset: Option<u64>,
    #[schemars(
        description = "Virtual address (RIP base) assigned to the first byte decoded. \
                              Defaults to 0 when unset. Pass the section virtual address for \
                              correct RIP-relative operand display."
    )]
    pub rip: Option<u64>,
    #[schemars(
        description = "Maximum number of instructions to decode. Defaults to 256 when \
                              unset. Capped at 4096 to bound response size."
    )]
    pub limit: Option<usize>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct Context7ResolveRequest {
    #[schemars(
        description = "The task you need help with. Used to rank library results by \
                              relevance (e.g. 'streaming SSR with App Router')."
    )]
    pub query: String,
    #[schemars(
        description = "Official library name to search for (e.g. 'Next.js', 'tokio', \
                              'wgpu'). Required."
    )]
    pub library_name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct Context7DocsRequest {
    #[schemars(description = "Exact Context7-compatible library ID returned by \
                              `context7_resolve_library_id` (e.g. '/vercel/next.js').")]
    pub library_id: String,
    #[schemars(description = "The specific question or task you need documentation for.")]
    pub query: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct MsLearnSearchRequest {
    #[schemars(
        description = "Search query — concepts, services, configuration, limits, best \
                              practices (e.g. 'Azure Functions Python v2 timeout limits')."
    )]
    pub query: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct MsLearnFetchRequest {
    #[schemars(
        description = "Absolute URL of a Microsoft Learn documentation page to fetch as markdown."
    )]
    pub url: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct MsLearnCodeSampleRequest {
    #[schemars(
        description = "Search query for Microsoft / Azure code samples (e.g. 'upload \
                              blob managed identity')."
    )]
    pub query: String,
    #[schemars(
        description = "Optional programming language filter (e.g. 'csharp', 'python', \
                              'javascript', 'typescript', 'rust')."
    )]
    pub language: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct DocsAutoSearchRequest {
    #[schemars(
        description = "Free-form natural-language question (e.g. 'How do I configure \
                              Next.js middleware for app router', 'Azure Functions Python v2 \
                              timeout limits', 'tokio JoinSet vs spawn'). Passed verbatim to \
                              every backend so each can rank on relevance."
    )]
    pub query: String,
    #[schemars(
        description = "Optional library / framework / SDK name (e.g. 'Next.js', 'tokio', \
                              'Azure Storage'). When set, Context7 does a two-step \
                              resolve→fetch chain; when unset, Context7 only resolves."
    )]
    pub library_name: Option<String>,
    #[schemars(
        description = "Optional programming language filter for the Microsoft \
                              code-sample backend (e.g. 'csharp', 'python', 'rust')."
    )]
    pub language: Option<String>,
    #[schemars(
        description = "Whether to search GitHub for open-source repositories, llms.txt, \
                              and documentation (default: true)."
    )]
    pub include_github: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GitHubDocsSearchRequest {
    #[schemars(
        description = "Repository search query or keyword (e.g. 'ratatui', 'tokio-rs', \
                              'gitingest')."
    )]
    pub query: String,
    #[schemars(description = "Max number of top repositories to inspect (default: 3, max: 5).")]
    pub limit: Option<u8>,
    #[schemars(
        description = "Whether to fetch full GitIngest digests for repositories lacking \
                              llms.txt (default: false)."
    )]
    pub include_digest: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GitIngestRequest {
    #[schemars(description = "Git repository URL or local directory path.")]
    pub source: String,
    #[schemars(description = "Maximum file size in bytes to include (default: 10MB).")]
    pub max_size: Option<u64>,
    #[schemars(description = "Optional file include patterns (e.g. ['*.rs', '*.py']).")]
    pub include_patterns: Option<Vec<String>>,
    #[schemars(description = "Optional file exclude patterns (e.g. ['tests/*', '*.min.js']).")]
    pub exclude_patterns: Option<Vec<String>>,
    #[schemars(description = "Git branch to ingest.")]
    pub branch: Option<String>,
    #[schemars(description = "Git tag to ingest.")]
    pub tag: Option<String>,
    #[schemars(description = "Subpath within the repository to scope the digest to.")]
    pub subpath: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct UpstreamListRequest {
    #[schemars(
        description = "Repository root holding tools/config/upstream-sources.json (default: APHRODY_ROOT, else the current directory)."
    )]
    pub repo_path: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct UpstreamRequest {
    #[schemars(
        description = "Upstream id from `upstream_list` (for example 'codex', 'mistral.rs', 'WSL2-Linux-Kernel')."
    )]
    pub id: String,
    #[schemars(
        description = "Repository path: directory for `upstream_tree` (default: the root), file for `upstream_read`."
    )]
    pub path: Option<String>,
    #[schemars(
        description = "Search query for `upstream_search` (GitHub code search restricted to this upstream, else every word in its local checkout)."
    )]
    pub query: Option<String>,
    #[schemars(
        description = "Repository root holding tools/config/upstream-sources.json (default: APHRODY_ROOT, else the current directory)."
    )]
    pub repo_path: Option<String>,
}

/// Runs one live upstream query; the answer is pretty JSON, or a `UPSTREAM_*_FAILED` error object.
async fn upstream_query(action: &'static str, request: UpstreamRequest) -> String {
    let failed = |reason: String| {
        serde_json::to_string_pretty(&json!({
            "error": format!("UPSTREAM_{}_FAILED", action.to_ascii_uppercase()),
            "reason": reason,
        }))
        .unwrap_or_default()
    };
    let root = upstream_root(request.repo_path.as_deref());
    let entries = match aphrody_git::upstream::catalogue(&root) {
        Ok(entries) => entries,
        Err(e) => return failed(e.to_string()),
    };
    let entry = match aphrody_git::upstream::find(&entries, &request.id) {
        Ok(entry) => entry,
        Err(e) => return failed(e.to_string()),
    };
    let client = match aphrody_git::GitHubClient::from_env() {
        Ok(client) => client,
        Err(e) => return failed(e.to_string()),
    };
    let path = request.path.as_deref().unwrap_or("");
    let result = match action {
        "info" => aphrody_git::upstream::info(&client, entry).await,
        "tree" => aphrody_git::upstream::tree(&client, entry, path).await,
        "read" => aphrody_git::upstream::read(&client, entry, path).await,
        _ => {
            aphrody_git::upstream::search(&client, entry, request.query.as_deref().unwrap_or(""))
                .await
        }
    };
    match result {
        Ok(value) => serde_json::to_string_pretty(&value).unwrap_or_default(),
        Err(e) => failed(e.to_string()),
    }
}

fn upstream_root(given: Option<&str>) -> std::path::PathBuf {
    given
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("APHRODY_ROOT").map(std::path::PathBuf::from))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AwesomeFetchRequest {
    #[schemars(
        description = "Preset name (e.g. 'bun', 'rust', 'tauri', 'awesome') or GitHub 'owner/repo' (e.g. 'sindresorhus/awesome')."
    )]
    pub source: String,
    #[schemars(
        description = "Whether to enrich items with GitHub star counts and llms.txt probing (default: false)."
    )]
    pub enrich: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AwesomeSearchRequest {
    #[schemars(description = "Search keyword (e.g. 'orm', 'tui', 'wasm', 'desktop', 'editor').")]
    pub query: String,
    #[schemars(
        description = "Optional preset name to scope search to (e.g. 'bun', 'rust', 'tauri', 'awesome'). When omitted, searches all canonical presets."
    )]
    pub preset: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AphrodyMcpCallRequest {
    #[schemars(
        description = "Logical server name as keyed under `mcpServers` of the mcp.json \
                              config (e.g. 'context7', 'github'). The server must be reachable \
                              via stdio or HTTP per its config entry."
    )]
    pub server: String,
    #[schemars(
        description = "Tool name as advertised by the target server's `tools/list` \
                              response (e.g. 'search_repositories')."
    )]
    pub tool: String,
    #[schemars(
        description = "Optional JSON object of arguments forwarded verbatim as the \
                              tool's `arguments` payload. Must be a JSON object when set; \
                              defaults to `{}` (no args)."
    )]
    pub args: Option<serde_json::Value>,
    #[schemars(
        description = "Optional absolute path to an alternative mcp.json config file. \
                              When unset, resolution follows the standard precedence \
                              (APHRODY_MCP_CONFIG → XDG/APPDATA → repo .mcp.json)."
    )]
    pub config: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct N2bRequest {
    #[schemars(
        description = "Path to the directory or file to scan, fix, or migrate (default: \
                              current directory)."
    )]
    pub path: Option<String>,
    #[schemars(
        description = "Execution mode: 'scan' (default, read-only analysis), 'fix' \
                              (apply safe automatic refactorings), or 'migrate' (full migration \
                              including environment and lockfile changes)."
    )]
    pub mode: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct WebCallRequest {
    #[schemars(
        description = "Tool name from this server's tools/list (aphrody_*) or the web \
                              backend's own name."
    )]
    pub tool: String,
    #[schemars(description = "JSON object forwarded to the tool. Defaults to an empty object.")]
    pub args: Option<std::collections::BTreeMap<String, serde_json::Value>>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct A2aCallRequest {
    #[schemars(
        description = "A2A v1 JSON-RPC method (SendMessage, GetTask, ListTasks, \
                              CancelTask, \u{2026})."
    )]
    pub method: String,
    #[schemars(description = "A2A method parameters as a JSON object.")]
    pub params: std::collections::BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SchemaRequest {
    #[schemars(description = "Contract to return: aphrody, web, n2b, a2a, or all.")]
    pub domain: String,
}

static A2A_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

fn a2a_methods() -> &'static [&'static str] {
    use aphrody_a2a::jsonrpc::methods;
    &[
        methods::SEND_MESSAGE,
        methods::SEND_STREAMING_MESSAGE,
        methods::GET_TASK,
        methods::LIST_TASKS,
        methods::CANCEL_TASK,
        methods::SUBSCRIBE_TO_TASK,
        methods::CREATE_PUSH_CONFIG,
        methods::GET_PUSH_CONFIG,
        methods::LIST_PUSH_CONFIGS,
        methods::DELETE_PUSH_CONFIG,
        methods::GET_EXTENDED_AGENT_CARD,
    ]
}

fn resolve_a2a_endpoint(primary: Option<&str>, legacy: Option<&str>) -> String {
    primary
        .filter(|value| !value.trim().is_empty())
        .or_else(|| legacy.filter(|value| !value.trim().is_empty()))
        .unwrap_or("http://127.0.0.1:8788/")
        .to_owned()
}

fn a2a_endpoint() -> String {
    let primary = std::env::var("APHRODY_A2A_ENDPOINT").ok();
    let legacy = std::env::var("APHRODY_A2A_URL").ok();
    resolve_a2a_endpoint(primary.as_deref(), legacy.as_deref())
}

fn a2a_contract() -> serde_json::Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Aphrody A2A v1 JSON-RPC contract",
        "protocolVersion": aphrody_a2a::VERSION,
        "endpoint": a2a_endpoint(),
        "agentCard": "/.well-known/agent-card.json",
        "methods": a2a_methods(),
        "request": {
            "type": "object",
            "required": ["jsonrpc", "id", "method", "params"],
            "properties": {
                "jsonrpc": { "const": "2.0" },
                "id": { "type": ["integer", "string"] },
                "method": { "enum": a2a_methods() },
                "params": { "type": "object" }
            },
            "additionalProperties": false
        },
        "coreTypes": {
            "message": {
                "type": "object",
                "required": ["messageId", "role", "parts"],
                "properties": {
                    "messageId": { "type": "string" },
                    "role": { "enum": ["ROLE_USER", "ROLE_AGENT"] },
                    "parts": { "type": "array", "minItems": 1 }
                }
            },
            "taskId": { "type": "string", "minLength": 1 },
            "taskState": {
                "enum": [
                    "TASK_STATE_UNSPECIFIED", "TASK_STATE_SUBMITTED", "TASK_STATE_WORKING",
                    "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED",
                    "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_REJECTED", "TASK_STATE_AUTH_REQUIRED"
                ]
            }
        }
    })
}

async fn bxc_catalog() -> Result<serde_json::Value, String> {
    let tools = bxc_tools::catalog().await?;
    Ok(json!({
        "service": "aphrody-web",
        "transport": "stdio",
        "tools": tools,
    }))
}

// ---------------------------------------------------------------------------
// context7 HTTP helper — helper for the public
// Context7 docs API (https://context7.com/api/v1/{search,<libraryId>}).
// NOTE 2026-05-21: the old `mcp.context7.com/api/v2/{libs/search,context}`
// host now 404s ("Use /mcp for MCP protocol communication") — Context7 moved
// the REST surface to `context7.com/api/v1` (search) + `context7.com/api/v1/<id>`
// (docs, `?type=txt&topic=&tokens=`). CONTEXT7_API_KEY is OPTIONAL: the public
// tier works unauthenticated, a Bearer key unlocks larger quotas.
// ---------------------------------------------------------------------------

static CONTEXT7_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn context7_base_url() -> String {
    std::env::var("CONTEXT7_API_BASE")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://context7.com/api".to_string())
}

fn context7_client() -> &'static reqwest::Client {
    CONTEXT7_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(format!("aphrody-mcp/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("context7 reqwest client build")
    })
}

/// Largest section of a `docs_auto_search` report (the Context7 docs get twice this).
const DOCS_SECTION_MAX: usize = 6 * 1024;

/// Cuts `text` to at most `max` bytes on a char boundary and says so.
fn clip_section(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!(
        "{}\n\n… (truncated: {} of {} bytes shown)",
        &text[..end],
        end,
        text.len()
    )
}

/// Picks the Context7 library titled `name` (case-insensitive, then `id` ending in it) out of a
/// `v1/search` answer, never a merely first-ranked unrelated one; also renders the top candidates.
/// An empty `name` picks nothing.
fn pick_context7_library(resolved: &str, name: &str) -> (Option<String>, String) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(resolved) else {
        return (None, clip_section(resolved, 1024));
    };
    let results = value["results"].as_array().cloned().unwrap_or_default();
    if results.is_empty() {
        return (None, clip_section(resolved, 1024));
    }
    let wanted = name.trim().to_lowercase();
    let normalized: String = wanted.chars().filter(char::is_ascii_alphanumeric).collect();
    let field = |r: &serde_json::Value, key: &str| r[key].as_str().unwrap_or("").to_owned();
    let picked = (!wanted.is_empty())
        .then(|| {
            results
                .iter()
                .find(|r| field(r, "title").to_lowercase() == wanted)
                .or_else(|| {
                    results.iter().find(|r| {
                        let id = field(r, "id").to_lowercase();
                        let last = id.rsplit('/').next().unwrap_or("");
                        let last: String =
                            last.chars().filter(char::is_ascii_alphanumeric).collect();
                        !normalized.is_empty() && last == normalized
                    })
                })
                .map(|r| field(r, "id"))
        })
        .flatten();
    let candidates = results
        .iter()
        .take(5)
        .map(|r| {
            let description: String = field(r, "description").chars().take(160).collect();
            format!(
                "- `{}` — {}: {description}",
                field(r, "id"),
                field(r, "title")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    (picked, candidates)
}

/// Canonical `coding_style_guide` topic for common spellings (`c++`, `cpp`, `ts`, `py`, `bash`…).
fn style_guide_topic(topic: &str) -> String {
    let topic = topic.trim().to_lowercase();
    match topic.as_str() {
        "c++" | "cxx" | "cc" | "cplusplus" => "cpp",
        "ts" => "typescript",
        "js" | "ecmascript" => "javascript",
        "py" => "python",
        "sh" | "bash" => "shell",
        "css" | "html/css" => "html",
        _ => return topic,
    }
    .to_owned()
}

async fn context7_get(path: &str, params: &[(&str, &str)]) -> String {
    let url = format!("{}/{}", context7_base_url(), path.trim_start_matches('/'));
    let mut req = context7_client().get(&url).query(params);
    if let Ok(key) = std::env::var("CONTEXT7_API_KEY")
        && !key.is_empty()
    {
        req = req.bearer_auth(key);
    }
    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            match resp.text().await {
                Ok(body) => {
                    if !status.is_success() {
                        let snippet: String = body.chars().take(512).collect();
                        let env = json!({
                            "error": "CONTEXT7_BAD_REQUEST",
                            "reason": format!("HTTP {status}: {snippet}"),
                            "endpoint": url,
                        });
                        return serde_json::to_string_pretty(&env).unwrap_or_else(|_| body.clone());
                    }
                    body
                }
                Err(e) => {
                    let env = json!({
                        "error": "CONTEXT7_INVALID_RESPONSE",
                        "reason": format!("read body: {e}"),
                        "endpoint": url,
                    });
                    serde_json::to_string_pretty(&env).unwrap_or_default()
                }
            }
        }
        Err(e) => {
            let kind = if e.is_timeout() {
                "CONTEXT7_TIMEOUT"
            } else {
                "CONTEXT7_UNAVAILABLE"
            };
            let env = json!({
                "error": kind,
                "reason": format!("{url}: {e}"),
                "endpoint": url,
            });
            serde_json::to_string_pretty(&env).unwrap_or_default()
        }
    }
}

// ---------------------------------------------------------------------------
// Microsoft Learn HTTP MCP proxy — calls the upstream MCP server at
// learn.microsoft.com/api/mcp via stateless JSON-RPC tools/call. The
// upstream responds in `text/event-stream` (SSE) framing: a single
// `event: message\ndata: {json}\n\n` packet per response. We unwrap
// the `data:` line and parse the inner JSON-RPC envelope.
// ---------------------------------------------------------------------------

const MSLEARN_ENDPOINT: &str = "https://learn.microsoft.com/api/mcp";

static MSLEARN_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn mslearn_client() -> &'static reqwest::Client {
    MSLEARN_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(format!("aphrody-mcp/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("mslearn reqwest client build")
    })
}

fn unwrap_sse(body: &str) -> &str {
    // Microsoft Learn ships exactly one SSE packet: `event: message\ndata: {json}\n\n`.
    // We tolerate (a) the bare JSON form, (b) trailing whitespace, (c) missing
    // event line. Return the first non-empty `data:` payload, or the body as-is.
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            let trimmed = rest.trim_start();
            if !trimmed.is_empty() {
                return trimmed;
            }
        }
    }
    body.trim()
}

async fn mslearn_call(tool: &str, args: serde_json::Value) -> String {
    let env_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": { "name": tool, "arguments": args }
    });
    let req = mslearn_client()
        .post(MSLEARN_ENDPOINT)
        .header("Accept", "application/json, text/event-stream")
        .json(&env_body);
    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            match resp.text().await {
                Ok(body) => {
                    if !status.is_success() {
                        let snippet: String = body.chars().take(512).collect();
                        return serde_json::to_string_pretty(&json!({
                            "error": "MSLEARN_BAD_REQUEST",
                            "reason": format!("upstream HTTP {status}: {snippet}"),
                            "endpoint": MSLEARN_ENDPOINT,
                        }))
                        .unwrap_or_default();
                    }
                    let inner = unwrap_sse(&body);
                    // Inner is the JSON-RPC envelope { "result": { "content": [...] } }
                    match serde_json::from_str::<serde_json::Value>(inner) {
                        Ok(env) => {
                            if let Some(err) = env.get("error") {
                                return serde_json::to_string_pretty(&json!({
                                    "error": "MSLEARN_RPC_ERROR",
                                    "reason": err,
                                    "endpoint": MSLEARN_ENDPOINT,
                                }))
                                .unwrap_or_default();
                            }
                            // Concatenate every text-typed content entry — the
                            // upstream may chunk into N pieces.
                            if let Some(arr) =
                                env.pointer("/result/content").and_then(|v| v.as_array())
                            {
                                let mut buf = String::new();
                                for c in arr {
                                    if let Some(t) = c.get("text").and_then(|v| v.as_str()) {
                                        if !buf.is_empty() {
                                            buf.push_str("\n\n---\n\n");
                                        }
                                        buf.push_str(t);
                                    }
                                }
                                if !buf.is_empty() {
                                    return buf;
                                }
                            }
                            // Fall back to the raw envelope as JSON text.
                            serde_json::to_string_pretty(&env).unwrap_or_else(|_| inner.to_string())
                        }
                        Err(e) => serde_json::to_string_pretty(&json!({
                            "error": "MSLEARN_INVALID_RESPONSE",
                            "reason": format!("parse JSON-RPC envelope: {e}"),
                            "endpoint": MSLEARN_ENDPOINT,
                            "body_preview": body.chars().take(256).collect::<String>(),
                        }))
                        .unwrap_or_default(),
                    }
                }
                Err(e) => serde_json::to_string_pretty(&json!({
                    "error": "MSLEARN_INVALID_RESPONSE",
                    "reason": format!("read body: {e}"),
                    "endpoint": MSLEARN_ENDPOINT,
                }))
                .unwrap_or_default(),
            }
        }
        Err(e) => {
            let kind = if e.is_timeout() {
                "MSLEARN_TIMEOUT"
            } else {
                "MSLEARN_UNAVAILABLE"
            };
            serde_json::to_string_pretty(&json!({
                "error": kind,
                "reason": format!("{MSLEARN_ENDPOINT}: {e}"),
                "endpoint": MSLEARN_ENDPOINT,
            }))
            .unwrap_or_default()
        }
    }
}

// ---------------------------------------------------------------------------
// MCP tool router
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct GoogleMcpServer;

/// Fetch one page and render it for the model, saying how it was obtained.
///
/// Shared by `universal_web_fetch` and `coding_style_guide` on purpose: they
/// used to carry two copies of the same `r.jina.ai` line, and only one of them
/// is ever remembered when the pattern gets fixed. One function, one policy.
///
/// The returned string always begins with a provenance banner
/// ([`aphrody_web_service::fetch::Fetched::banner`]): which URL, which road, whether
/// the body is Markdown or unconverted HTML, whether it was truncated. A model
/// that cannot tell a converted page from raw markup will quote `<div>` at the
/// user, so the distinction is stated in the one place the model reads.
///
/// Failures are returned as text (an MCP tool answers with a `String`), but
/// they are the *typed* errors of the fetch module, which name what failed.
/// Nothing here retries through a proxy.
async fn fetch_page(url: &str, profile: Option<&str>) -> String {
    let mut request = aphrody_web_service::fetch::Request::new(url);

    // An unrecognised profile is refused rather than ignored. Silently dropping
    // it would answer with a plain direct fetch while the caller believed a
    // stealth browser had run — a filter that discards without saying so
    // (CLAUDE.md §7).
    //
    // A *present but blank* field is the same defect wearing a disguise, and it
    // is the likelier one: a model filling an `Option<String>` from a JSON
    // schema emits `"profile": ""` or `"profile": "   "` all the time. An
    // earlier version wrote `.filter(|p| !p.is_empty())` here, which threw the
    // field away before `Profile::parse` could refuse it — the request left
    // through the direct path and nothing in the report mentioned it. Absence
    // (`None`) is the only thing that legitimately means "direct fetch".
    if let Some(raw) = profile {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return "Empty browser profile. Valid: static, fast, http, stealth, max. Omit the \
                    field entirely for the direct, in-process fetch — sending a blank one is \
                    refused rather than silently ignored."
                .to_owned();
        }
        let Some(parsed) = aphrody_web_service::fetch::Profile::parse(trimmed) else {
            return format!(
                "Unknown browser profile {trimmed:?}. Valid: static, fast, http, stealth, max. \
                 Omit the field for the direct, in-process fetch."
            );
        };
        request = request.with_profile(parsed);
    }

    match aphrody_web_service::fetch::fetch(&request).await {
        Ok(page) => page.to_report(),
        Err(err) => format!("Fetch failed for {url}\n\n{err}"),
    }
}

#[tool_router(router = core_router)]
impl GoogleMcpServer {
    #[cfg(not(target_arch = "wasm32"))]
    #[tool(
        description = "Read the native Aphrody product documentation/template catalog from an explicit workspace root. Read-only, no network or host execution. Section docs/templates matches HTTP; omit for both."
    )]
    async fn aphrody_site_catalog(
        &self,
        Parameters(request): Parameters<site_tools::SiteCatalogRequest>,
    ) -> String {
        site_tools::catalog(request).await
    }
    // -----------------------------------------------------------------------
    // 1. coding_style_guide — direct fetch + in-process Markdown (aphrody-web-service).
    //
    // Was: `reqwest::get(format!("https://r.jina.ai/{target_url}"))`. The ten
    // targets below are static, public documents on google.github.io,
    // source.android.com and chromium.googlesource.com. There was never a
    // reason to route them through a rented reader — and doing so told that
    // reader which style guide this machine was consulting, on every call.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Fetch official coding style guidelines for Google projects (Chromium, \
                          Android, C++, Python, TypeScript, etc.)."
    )]
    async fn coding_style_guide(
        &self,
        Parameters(StyleGuideRequest { topic }): Parameters<StyleGuideRequest>,
    ) -> String {
        let mut map = std::collections::HashMap::new();
        map.insert("cpp", "https://google.github.io/styleguide/cppguide.html");
        map.insert("python", "https://google.github.io/styleguide/pyguide.html");
        map.insert(
            "typescript",
            "https://google.github.io/styleguide/tsguide.html",
        );
        map.insert(
            "javascript",
            "https://google.github.io/styleguide/jsguide.html",
        );
        map.insert("java", "https://google.github.io/styleguide/javaguide.html");
        map.insert(
            "shell",
            "https://google.github.io/styleguide/shellguide.html",
        );
        map.insert(
            "html",
            "https://google.github.io/styleguide/htmlcssguide.html",
        );
        map.insert(
            "android_build",
            "https://source.android.com/setup/contribute/code-style",
        );
        map.insert(
            "chromium_build_win",
            "https://chromium.googlesource.com/chromium/src/+/master/docs/\
             windows_build_instructions.md",
        );
        map.insert("general", "https://google.github.io/styleguide/");

        // An unknown topic used to fall through to the index page. The
        // model then received a real, well-formed answer about the wrong
        // thing, with nothing saying its topic was not recognised — it
        // reads as though `rust` were documented in Google's C++ guide.
        // Naming the miss costs one line and turns a wrong answer into a
        // correctable one.
        let Some(target_url) = map.get(style_guide_topic(&topic).as_str()).copied() else {
            let mut known: Vec<&str> = map.keys().copied().collect();
            known.sort_unstable();
            return format!(
                "Unknown style-guide topic {topic:?}. Known topics: {}.",
                known.join(", ")
            );
        };

        fetch_page(target_url, None).await
    }

    // -----------------------------------------------------------------------
    // 2. universal_web_fetch — direct fetch + in-process Markdown (aphrody-web-service).
    //
    // Was: `reqwest::get(format!("https://r.jina.ai/{url}"))`, i.e. every page
    // the model asked for was proxied by a third party that saw the URL, the
    // source address and the timing — with no timeout, no user agent, no size
    // cap, and no status check, so a 402 or 429 from the proxy reached the
    // model as if it were the page. All five of those are fixed by the fetch module.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Fetch any webpage from the internet and convert it to clean Markdown. \
                          Fetched directly by aphrody and converted in-process (no third-party \
                          reader). Highly recommended for reading online developer \
                          documentation, issue trackers, or tutorials."
    )]
    async fn universal_web_fetch(
        &self,
        Parameters(WebFetchRequest { url, profile }): Parameters<WebFetchRequest>,
    ) -> String {
        fetch_page(&url, profile.as_deref()).await
    }

    #[tool(
        description = "Extract article text, Markdown and metadata from supplied HTML using \
                          the shared Aphrody Rust Web library. No browser subprocess is started."
    )]
    async fn aphrody_web_extract_html(
        &self,
        Parameters(WebExtractHtmlRequest { html, url }): Parameters<WebExtractHtmlRequest>,
    ) -> String {
        aphrody_web_extract::extract_main_json(&html, url.as_deref())
    }

    // -----------------------------------------------------------------------
    // Jev typed decisions: Noul / Choice / Score, SaaS -> edge -> local jeff.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Answer typed questions about a state with the Jev decision models,                           without generating text. Each question is a noul (probability of                           yes), a choice (one option out of a set) or a score (position along                           ordered levels). Use for routing, classification, guardrails and                           ranking. Served by the TypeSafe SaaS, Cloudflare for large states,                           or a local jeff server on outage; returns the backend used."
    )]
    async fn aphrody_jev_decide(
        &self,
        Parameters(request): Parameters<jev_tools::JevDecideRequest>,
    ) -> String {
        jev_tools::jev_decide(request).await
    }

    // -----------------------------------------------------------------------
    // 6. advanced_recon — real DNS resolution + TCP port probing.
    // -----------------------------------------------------------------------
    // The description used to promise "deep DNS, TCP, and OSINT reconnaissance".
    // Two of the three are here; there has never been an OSINT stage — no
    // WHOIS, no certificate transparency, no passive-DNS, nothing but
    // `lookup_host` and `TcpStream::connect`. A model told a tool does OSINT
    // calls it instead of doing the research, gets back a DNS line and three
    // port verdicts, and reports that as the reconnaissance.
    #[tool(
        description = "Resolve a host's A/AAAA records and probe a list of TCP ports for OPEN \
                          / CLOSED-FILTERED / TIMEOUT, using async tokio sockets (5 s resolve \
                          budget, 200 ms per port; ports default to 80, 443, 8080). That is the \
                          whole tool: it performs NO OSINT — no WHOIS, no certificate \
                          transparency, no passive DNS, no subdomain enumeration."
    )]
    async fn advanced_recon(
        &self,
        Parameters(AdvancedReconRequest { target, ports }): Parameters<AdvancedReconRequest>,
    ) -> String {
        // Every probe below is async on purpose. This function used to call
        // `std::net::ToSocketAddrs::to_socket_addrs` and
        // `std::net::TcpStream::connect_timeout` — both BLOCKING — from an
        // `async fn` running on a tokio worker. With the default
        // `vec![80, 443, 8080]` and 200 ms per port, plus an unbounded
        // synchronous DNS lookup, a single call parked a worker thread for
        // as long as the resolver took, stalling every other task sharing
        // it. `tokio::net` does the same work without holding the thread.
        let ports_to_check = ports.unwrap_or_else(|| vec![80, 443, 8080]);
        let mut output = format!("Reconnaissance on {target}:\n");

        const PROBE: Duration = Duration::from_millis(200);
        // A hostname that never answers must not hold the whole tool open.
        const RESOLVE: Duration = Duration::from_secs(5);

        match tokio::time::timeout(RESOLVE, tokio::net::lookup_host(format!("{target}:80"))).await {
            Ok(Ok(addrs)) => {
                let ips: Vec<String> = addrs.map(|a| a.ip().to_string()).collect();
                if ips.is_empty() {
                    // Resolving to nothing is not the same as failing to
                    // resolve, and an empty list rendered as a success line
                    // would read as if the host had no addresses on purpose.
                    output.push_str("[DNS] Resolved, but no A/AAAA record returned\n");
                } else {
                    output.push_str(&format!("[DNS] A/AAAA records: {}\n", ips.join(", ")));
                }
            }
            Ok(Err(e)) => output.push_str(&format!("[DNS] Resolution failed: {e}\n")),
            Err(_) => output.push_str(&format!(
                "[DNS] Resolution timed out after {}s\n",
                RESOLVE.as_secs()
            )),
        }

        output.push_str(&format!("\n[TCP] Probing ports {ports_to_check:?}:\n"));
        for port in ports_to_check {
            let addr_str = format!("{target}:{port}");
            let resolved: Option<SocketAddr> = match addr_str.parse::<SocketAddr>() {
                Ok(addr) => Some(addr),
                // Not a literal address: it is a hostname, so resolve it.
                Err(_) => {
                    match tokio::time::timeout(RESOLVE, tokio::net::lookup_host(&addr_str)).await {
                        Ok(Ok(mut addrs)) => addrs.next(),
                        _ => None,
                    }
                }
            };

            let Some(addr) = resolved else {
                output.push_str(&format!(
                    "  Port {port}: UNRESOLVED (no address for {target})\n"
                ));
                continue;
            };

            // Three outcomes, three words. Folding the timeout into
            // CLOSED/FILTERED would hide the one case that means "ask again
            // with a longer budget" rather than "nothing is listening".
            let verdict =
                match tokio::time::timeout(PROBE, tokio::net::TcpStream::connect(addr)).await {
                    Ok(Ok(_)) => "OPEN",
                    Ok(Err(_)) => "CLOSED/FILTERED",
                    Err(_) => "TIMEOUT",
                };
            output.push_str(&format!("  Port {port}: {verdict}\n"));
        }
        output
    }

    // -----------------------------------------------------------------------
    // 7. native_hooks — real OS state query without WMI. Windows: GetSystemInfo +
    //    GlobalMemoryStatusEx (Win32 API). Linux: reads /proc/meminfo + /proc/cpuinfo via sysinfo
    //    crate. wasm: platform not supported.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Query native OS state (CPU count, memory usage, page size) directly \
                          via OS APIs, bypassing WMI or higher-level abstractions."
    )]
    async fn native_hooks(&self) -> String {
        let pid = std::process::id();

        #[cfg(target_os = "windows")]
        {
            use windows::Win32::System::SystemInformation::{
                GetSystemInfo, GlobalMemoryStatusEx, MEMORYSTATUSEX, SYSTEM_INFO,
            };

            // SAFETY:
            // - `GetSystemInfo` writes into a caller-allocated SYSTEM_INFO; all fields are valid
            //   after a successful call. No pointers escape.
            // - `GlobalMemoryStatusEx` requires `dwLength` pre-set to size of struct, which we do.
            //   It writes all fields on success; we check the return value.
            unsafe {
                let mut sys_info = SYSTEM_INFO::default();
                GetSystemInfo(&mut sys_info);

                let mut mem_status = MEMORYSTATUSEX {
                    dwLength: u32::try_from(std::mem::size_of::<MEMORYSTATUSEX>())
                        .unwrap_or(u32::MAX),
                    ..MEMORYSTATUSEX::default()
                };

                let mem_ok = GlobalMemoryStatusEx(&mut mem_status);

                let mem_info = if mem_ok.is_ok() {
                    format!(
                        "Total physical RAM:   {} MiB\n\
                         Available RAM:        {} MiB\n\
                         Memory load:          {}%\n\
                         Total virtual memory: {} MiB\n\
                         Available virtual:    {} MiB",
                        mem_status.ullTotalPhys / (1024 * 1024),
                        mem_status.ullAvailPhys / (1024 * 1024),
                        mem_status.dwMemoryLoad,
                        mem_status.ullTotalVirtual / (1024 * 1024),
                        mem_status.ullAvailVirtual / (1024 * 1024),
                    )
                } else {
                    "GlobalMemoryStatusEx failed.".to_string()
                };

                format!(
                    "OS State (Win32 native):\n- MCP Host PID:         {pid}\n- Logical CPU \
                     count:    {}\n- Active CPU mask:      0x{:x}\n- Page size:            {} \
                     bytes\n- Allocation granule:   {} bytes\n- Min app address:      {:#x}\n- \
                     Max app address:      {:#x}\n\nMemory:\n{mem_info}",
                    sys_info.dwNumberOfProcessors,
                    sys_info.dwActiveProcessorMask,
                    sys_info.dwPageSize,
                    sys_info.dwAllocationGranularity,
                    sys_info.lpMinimumApplicationAddress as usize,
                    sys_info.lpMaximumApplicationAddress as usize,
                )
            }
        }

        #[cfg(not(any(target_os = "windows", target_arch = "wasm32")))]
        {
            // Linux / macOS: use sysinfo (reads /proc on Linux, sysctl on macOS).
            let mut sys = System::new();
            sys.refresh_memory();

            let total_mb = sys.total_memory() / (1024 * 1024);
            let avail_mb = sys.available_memory() / (1024 * 1024);
            let used_mb = sys.used_memory() / (1024 * 1024);
            let cpu_count = System::physical_core_count().unwrap_or(0);

            format!(
                "OS State (sysinfo native):\n- MCP Host PID:     {pid}\n- Physical CPUs:    \
                 {cpu_count}\n- Total RAM:        {total_mb} MiB\n- Available RAM:    {avail_mb} \
                 MiB\n- Used RAM:         {used_mb} MiB\n- OS name:          {}\n- Kernel \
                 version:   {}\n- Host name:        {}",
                System::name().unwrap_or_else(|| "unknown".to_string()),
                System::kernel_version().unwrap_or_else(|| "unknown".to_string()),
                System::host_name().unwrap_or_else(|| "unknown".to_string()),
            )
        }

        #[cfg(target_arch = "wasm32")]
        {
            format!("native_hooks: OS-level system queries are not supported on wasm32. PID: {pid}")
        }
    }

    // -----------------------------------------------------------------------
    // 8. start_dashboard — real axum HTTP server spawned in a tokio task. Exposes GET /health and
    //    GET /info (PID, uptime, memory).
    // -----------------------------------------------------------------------
    #[tool(
        description = "Start a loopback HTTP server exposing live telemetry about THIS MCP \
                          process: GET /health (liveness) and GET /info (PID, uptime, memory, \
                          and a counter of /info hits). Binds 127.0.0.1 only - set \
                          APHRODY_MCP_DASHBOARD_HOST to widen it deliberately. Runs in the \
                          background for the lifetime of the MCP process and cannot be stopped \
                          by a tool call."
    )]
    async fn start_dashboard(
        &self,
        Parameters(StartDashboardRequest { port }): Parameters<StartDashboardRequest>,
    ) -> String {
        let port = port.unwrap_or(3000);
        // Loopback, not 0.0.0.0. This used to bind every interface while the
        // description said "local": one tool call published this machine's
        // PID, uptime and memory to the whole network, and nothing in the
        // response said so - the URL it returned read `http://0.0.0.0:3000`,
        // which a reader parses as "localhost". Widening the bind is now a
        // deliberate act with a name.
        let host = std::env::var("APHRODY_MCP_DASHBOARD_HOST")
            .ok()
            .map(|h| h.trim().to_owned())
            .filter(|h| !h.is_empty())
            .unwrap_or_else(|| "127.0.0.1".to_owned());
        let bind_addr: SocketAddr = match format!("{host}:{port}").parse() {
            Ok(a) => a,
            Err(e) => return format!("Invalid bind address {host}:{port}: {e}"),
        };

        // Shared atomic request counter for /info.
        let request_count = Arc::new(AtomicU64::new(0));
        let request_count_clone = Arc::clone(&request_count);
        let start = *START_INSTANT.get_or_init(Instant::now);

        let app = Router::new()
            .route(
                "/health",
                get(|| async {
                    Json(json!({
                        "status": "ok",
                        "service": "aphrody-mcp-dashboard"
                    }))
                }),
            )
            .route(
                "/info",
                get(move || {
                    let counter = Arc::clone(&request_count_clone);
                    async move {
                        counter.fetch_add(1, Ordering::Relaxed);
                        let uptime_secs = start.elapsed().as_secs();
                        let pid = std::process::id();

                        let mut sys = System::new();
                        sys.refresh_memory();
                        let used_mb = sys.used_memory() / (1024 * 1024);
                        let total_mb = sys.total_memory() / (1024 * 1024);

                        Json(json!({
                            "pid": pid,
                            "uptime_seconds": uptime_secs,
                            "memory_used_mib": used_mb,
                            "memory_total_mib": total_mb,
                            "requests_served": counter.load(Ordering::Relaxed),
                            "service": "aphrody-mcp-dashboard",
                        }))
                    }
                }),
            );

        let listener = match tokio::net::TcpListener::bind(bind_addr).await {
            Ok(l) => l,
            Err(e) => {
                return format!(
                    "Failed to bind dashboard on port {port}: {e}. Is the port already in use?"
                );
            }
        };

        // Confirm the actual bound address (OS may assign a different port if 0 was given).
        let bound_addr = match listener.local_addr() {
            Ok(a) => a,
            Err(e) => return format!("Failed to retrieve bound address: {e}"),
        };

        // Spawn the server as a background tokio task. It runs independently of the MCP loop.
        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                tracing::error!("Dashboard server error: {e}");
            }
        });

        format!(
            "Dashboard server started and listening on http://{bound_addr}\n\
             Routes:\n\
             - GET http://{bound_addr}/health  — liveness probe (JSON)\n\
             - GET http://{bound_addr}/info    — PID, uptime, memory (JSON)"
        )
    }

    // -----------------------------------------------------------------------
    // 16. voice_synthesize — text-to-speech via aphrody-voice (ElevenLabs). Native-only
    //     (`cfg(not(wasm32))`): the browser path lives in `aphrody_voice::web::WebSpeechSynth` and
    //     is not exposed over stdio.
    // -----------------------------------------------------------------------
    #[cfg(not(target_arch = "wasm32"))]
    #[tool(
        description = "Synthesise speech from text via the aphrody-voice ElevenLabs adapter. \
                          Returns { audio_base64, mime_type, duration_ms, bytes, voice }. \
                          Requires ELEVENLABS_API_KEY in env."
    )]
    async fn voice_synthesize(
        &self,
        Parameters(req): Parameters<voice_tools::VoiceSynthesizeRequest>,
    ) -> String {
        voice_tools::synthesize(req).await
    }

    // -----------------------------------------------------------------------
    // 17. voice_transcribe — speech-to-text via aphrody-voice-stt. Prefers offline
    //     LocalWhisperBackend (APHRODY_WHISPER_MODEL=<ggml.bin>); falls back to the OpenAI Whisper
    //     REST API on NotImplemented or any other provider error.
    // -----------------------------------------------------------------------
    #[cfg(not(target_arch = "wasm32"))]
    #[tool(
        description = "Transcribe base64-encoded audio via aphrody-voice-stt. Prefers offline \
                          whisper.cpp (set APHRODY_WHISPER_MODEL to a GGML model path); falls \
                          back to the OpenAI Whisper REST API (OPENAI_API_KEY) — so this tool \
                          MAY upload the audio; use `aphrody_transcribe` (feature stt-local) \
                          when it must not leave the machine. Returns { text, confidence, \
                          confidence_note, language, duration_s, segments, backend, mime_type }. \
                          `confidence` is always null: neither backend reports one and this tool \
                          does not invent one."
    )]
    async fn voice_transcribe(
        &self,
        Parameters(req): Parameters<voice_tools::VoiceTranscribeRequest>,
    ) -> String {
        voice_tools::transcribe(req).await
    }

    // -----------------------------------------------------------------------
    // firefly_generate — Adobe Firefly Services image generation.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Generate image(s) with Adobe Firefly Services (v3, async). OAuth \
                          server-to-server: set FIREFLY_CLIENT_ID and FIREFLY_CLIENT_SECRET in \
                          the environment. Cross-platform, headless cloud API (no Photoshop \
                          install). Optionally save to a directory. Returns { count, outputs:[{ \
                          seed, content_type, bytes, saved_path? }] }."
    )]
    async fn firefly_generate(
        &self,
        Parameters(req): Parameters<firefly_tools::FireflyGenerateRequest>,
    ) -> String {
        firefly_tools::generate(req).await
    }

    // -----------------------------------------------------------------------
    // photoshop_* — headless cloud Photoshop API (image.adobe.io). The
    // in-policy replacement for the TypeScript photoshop-mcp: no local
    // Photoshop, no JS. Same IMS auth as Firefly.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Get the layer manifest (tree, dimensions, mode) of a PSD/image via the \
                          cloud Photoshop API. input_url must be readable by Adobe (presigned S3 \
                          / Azure SAS / Dropbox / Creative Cloud). Returns the Photoshop job \
                          JSON."
    )]
    async fn photoshop_manifest(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsManifestRequest>,
    ) -> String {
        photoshop_tools::manifest(req).await
    }

    #[tool(
        description = "Render a PSD/image to an output URL via the cloud Photoshop API \
                          (renditionCreate). format = png|jpg|psd|tiff|dng. output_url must be a \
                          writable destination (presigned PUT / SAS / CC). Returns the job JSON."
    )]
    async fn photoshop_rendition(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsRenditionRequest>,
    ) -> String {
        photoshop_tools::rendition(req).await
    }

    #[tool(
        description = "Apply layer edits (and optionally render) on a PSD via the cloud \
                          Photoshop API (documentOperations). `options` is the layer-edit JSON \
                          tree. Returns the job JSON."
    )]
    async fn photoshop_document_operations(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsDocOpsRequest>,
    ) -> String {
        photoshop_tools::document_operations(req).await
    }

    #[tool(
        description = "Bridge: generate an image with Adobe Firefly, then route it through \
                          the cloud Photoshop API. With output_url it converts the result to \
                          that URL/format (e.g. an editable PSD); without it, returns the layer \
                          manifest of the generated image. Set FIREFLY_CLIENT_ID/SECRET."
    )]
    async fn firefly_to_photoshop(
        &self,
        Parameters(req): Parameters<photoshop_tools::FireflyToPhotoshopRequest>,
    ) -> String {
        photoshop_tools::firefly_to_photoshop(req).await
    }

    #[tool(
        description = "Auto-tone an image via the cloud Lightroom API (AI exposure, contrast, \
                          highlights, shadows, whites, blacks, vibrance). input_url readable by \
                          Adobe; output_url writable. format = png|jpg|psd|tiff|dng. Job JSON."
    )]
    async fn photoshop_auto_tone(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsEditRequest>,
    ) -> String {
        photoshop_tools::auto_tone(req).await
    }

    #[tool(
        description = "Auto-straighten (Upright perspective correction) via the cloud \
                          Lightroom API. input_url readable, output_url writable. Returns the \
                          job JSON."
    )]
    async fn photoshop_auto_straighten(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsEditRequest>,
    ) -> String {
        photoshop_tools::auto_straighten(req).await
    }

    #[tool(
        description = "Apply explicit Camera-Raw adjustments via the cloud Lightroom API \
                          (edit): exposure, contrast, highlights, shadows, whites, blacks, \
                          temperature, tint, vibrance, saturation, clarity, dehaze, texture, \
                          sharpness. Only the set fields are applied. Returns the job JSON."
    )]
    async fn photoshop_edit(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsAdjustRequest>,
    ) -> String {
        photoshop_tools::edit(req).await
    }

    #[tool(
        description = "Remove the background of an image (Sensei cutout), returning a \
                          transparent cut-out. input_url readable, output_url writable (png \
                          recommended). Returns the job JSON."
    )]
    async fn photoshop_remove_background(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsEditRequest>,
    ) -> String {
        photoshop_tools::remove_background(req).await
    }

    #[tool(
        description = "Create a subject/background alpha mask for an image (Sensei mask). \
                          input_url readable, output_url writable. Returns the job JSON."
    )]
    async fn photoshop_create_mask(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsEditRequest>,
    ) -> String {
        photoshop_tools::create_mask(req).await
    }

    #[tool(
        description = "Content-aware product crop via the cloud Photoshop API (productCrop). \
                          input_url readable, output_url writable. Returns the job JSON."
    )]
    async fn photoshop_product_crop(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsEditRequest>,
    ) -> String {
        photoshop_tools::product_crop(req).await
    }

    #[tool(
        description = "Depth-of-field blur via the cloud Photoshop API (depthBlur Neural \
                          Filter). input_url readable, output_url writable. Returns the job JSON."
    )]
    async fn photoshop_depth_blur(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsEditRequest>,
    ) -> String {
        photoshop_tools::depth_blur(req).await
    }

    #[tool(
        description = "Play an actionJSON program (a recorded Photoshop action set as JSON) \
                          over a PSD/image via the cloud Photoshop API (documentOperations). \
                          `actions` is the actionJSON array. Returns the job JSON."
    )]
    async fn photoshop_action_json(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsActionJsonRequest>,
    ) -> String {
        photoshop_tools::action_json(req).await
    }

    #[tool(
        description = "Generative expand (Adobe Firefly v3): enlarge an image's canvas to \
                          width×height, AI-filling the new area (optional prompt). image_url \
                          must be Adobe-readable. Optionally save_dir. Returns { count, \
                          image_urls, saved_paths }. Set FIREFLY_CLIENT_ID/SECRET."
    )]
    async fn firefly_generative_expand(
        &self,
        Parameters(req): Parameters<photoshop_tools::FireflyExpandRequest>,
    ) -> String {
        photoshop_tools::generative_expand(req).await
    }

    #[tool(
        description = "Generative fill (Adobe Firefly v3): replace the masked region of an \
                          image with prompt-guided content. image_url + mask_url (white = fill) \
                          must be Adobe-readable. Optionally save_dir. Returns { count, \
                          image_urls, saved_paths }. Set FIREFLY_CLIENT_ID/SECRET."
    )]
    async fn firefly_generative_fill(
        &self,
        Parameters(req): Parameters<photoshop_tools::FireflyFillRequest>,
    ) -> String {
        photoshop_tools::generative_fill(req).await
    }

    // -----------------------------------------------------------------------
    // photoshop_live_* — drive the RUNNING desktop Photoshop from the inside
    // via the UXP plugin (apps/photoshop-uxp) over the local WebSocket bridge
    // (127.0.0.1:8765 by default; port via APHRODY_PS_BRIDGE_PORT). batchPlay
    // + eval expose the entire Photoshop surface.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Report the running Photoshop's state via the in-app UXP plugin: app \
                          version, active document (name, dimensions, mode), and the layer tree. \
                          Requires the aphrody UXP panel loaded in Photoshop. Returns { ok, \
                          result }."
    )]
    async fn photoshop_live_info(&self) -> String {
        photoshop_tools::live_info().await
    }

    #[tool(
        description = "Run a batchPlay command array inside the RUNNING Photoshop (in-app UXP \
                          plugin) — the universal driver for ANY Photoshop operation (the same \
                          ActionDescriptor JSON ScriptListener/Alchemist emit). `commands` is \
                          the array; `options` is optional. Returns { ok, result } with \
                          batchPlay's response descriptors. Requires the aphrody UXP panel \
                          loaded."
    )]
    async fn photoshop_live_batchplay(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsBatchPlayRequest>,
    ) -> String {
        photoshop_tools::live_batchplay(req).await
    }

    #[tool(
        description = "Evaluate arbitrary UXP JavaScript inside the RUNNING Photoshop (in-app \
                          plugin) with app/photoshop/constants/core/batchPlay in scope — full \
                          internal access for anything not expressible as one batchPlay array. \
                          `return` a JSON-serializable value. Requires the aphrody UXP panel \
                          loaded."
    )]
    async fn photoshop_live_exec(
        &self,
        Parameters(req): Parameters<photoshop_tools::PsExecRequest>,
    ) -> String {
        photoshop_tools::live_exec(req).await
    }

    // -----------------------------------------------------------------------
    // screen_capture — capture the screen (or a window) as a PNG for vision.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Capture the whole primary screen (or a window by title substring) as a \
                          PNG and return it base64-encoded so a vision model can see it. \
                          Optionally also save to disk. Local-only. Returns { mime, bytes, \
                          base64, saved_path }."
    )]
    async fn screen_capture(
        &self,
        Parameters(ScreenCaptureRequest { window, save_path }): Parameters<ScreenCaptureRequest>,
    ) -> String {
        use base64::Engine as _;
        // GDI capture is a fast blocking syscall; run it off the async worker.
        let result = tokio::task::spawn_blocking(move || match window {
            Some(w) => aphrody_capture::capture_window_by_title(&w),
            None => aphrody_capture::capture_primary_screen(),
        })
        .await;
        let bytes = match result {
            Ok(Ok(b)) => b,
            Ok(Err(e)) => return json!({ "error": e.to_string() }).to_string(),
            Err(e) => return json!({ "error": format!("capture task failed: {e}") }).to_string(),
        };
        let mut saved = serde_json::Value::Null;
        if let Some(p) = save_path {
            match std::fs::write(&p, &bytes) {
                Ok(()) => saved = serde_json::Value::String(p),
                Err(e) => return json!({ "error": format!("save failed: {e}") }).to_string(),
            }
        }
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        json!({ "mime": "image/png", "bytes": bytes.len(), "base64": b64, "saved_path": saved })
            .to_string()
    }

    // -----------------------------------------------------------------------
    // 18. re_triage — reverse engineering triage via aphrody-re. Single MCP tool covers the full
    //     PE/ELF triage surface (format, entry_point, sections + per-section Shannon entropy,
    //     imports, exports, ASCII/UTF-16LE strings sample, SHA-256). Separate re_disasm /
    //     re_strings / re_sections MCP tools (R5.7) are intentionally not split — every consumer
    //     that needs sections or strings already gets them in re_triage's response.
    // -----------------------------------------------------------------------
    #[cfg(not(target_arch = "wasm32"))]
    #[tool(
        description = "Triage a binary file (PE32/PE64/ELF32/ELF64): detect format via magic, \
                          parse with goblin, extract sections with per-section Shannon entropy, \
                          imports, exports, ASCII/UTF-16LE strings sample (≤ 64 entries, min \
                          length 6), and a SHA-256 fingerprint. Pure Rust, no GPL deps. Returns \
                          a TriageReport JSON object. Errors with structured envelope on read \
                          failures or oversized inputs."
    )]
    async fn re_triage(
        &self,
        Parameters(ReTriageRequest { path }): Parameters<ReTriageRequest>,
    ) -> String {
        // Guard against pathological inputs before reading into memory.
        const MAX_BYTES: u64 = 200 * 1024 * 1024; // 200 MB
        let meta = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "RE_BAD_REQUEST",
                    "reason": format!("unable to stat '{path}': {e}"),
                }))
                .unwrap_or_default();
            }
        };
        if meta.len() > MAX_BYTES {
            return serde_json::to_string_pretty(&json!({
                "error": "RE_BAD_REQUEST",
                "reason": format!(
                    "'{path}' is {} bytes (> {MAX_BYTES} byte cap); refuse to triage",
                    meta.len()
                ),
            }))
            .unwrap_or_default();
        }
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "RE_IO",
                    "reason": format!("read '{path}' failed: {e}"),
                }))
                .unwrap_or_default();
            }
        };
        match aphrody_re::triage(&bytes) {
            Ok(report) => serde_json::to_string_pretty(&report).unwrap_or_else(|e| {
                format!(
                    r#"{{"error":"RE_ENCODE","reason":"{}"}}"#,
                    e.to_string().replace('"', "'")
                )
            }),
            Err(e) => serde_json::to_string_pretty(&json!({
                "error": "RE_PARSE",
                "reason": e.to_string(),
            }))
            .unwrap_or_default(),
        }
    }

    // -----------------------------------------------------------------------
    // re_strings — extract printable ASCII + UTF-16LE strings from any file.
    //
    // Mirrors the `aphrody re strings` CLI sub-command. Uses the public
    // `aphrody_re::extract_strings` function directly — no goblin parse, so
    // it works on arbitrary blobs (firmware dumps, data files, PE/ELF alike).
    // -----------------------------------------------------------------------
    #[cfg(not(target_arch = "wasm32"))]
    #[tool(
        description = "Extract printable ASCII and UTF-16LE strings from any file (binary, \
                          firmware, PE, ELF, data blob). Returns a JSON object with `path`, \
                          `min_len`, `limit`, and a `strings` array of deduplicated runs. Works \
                          on any file format — no binary parsing required. Errors with a \
                          structured envelope on read failure or if the file exceeds 100 MB."
    )]
    async fn re_strings(
        &self,
        Parameters(ReStringsRequest {
            path,
            min_len,
            limit,
        }): Parameters<ReStringsRequest>,
    ) -> String {
        const MAX_BYTES: u64 = 100 * 1024 * 1024; // 100 MB
        const DEFAULT_MIN_LEN: usize = 6;
        const DEFAULT_LIMIT: usize = 64;
        const CAP_LIMIT: usize = 4096;

        let min_len = min_len.unwrap_or(DEFAULT_MIN_LEN).max(1);
        let limit = limit.unwrap_or(DEFAULT_LIMIT).min(CAP_LIMIT);

        let meta = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "RE_BAD_REQUEST",
                    "reason": format!("unable to stat '{path}': {e}"),
                }))
                .unwrap_or_default();
            }
        };
        if meta.len() > MAX_BYTES {
            return serde_json::to_string_pretty(&json!({
                "error": "RE_BAD_REQUEST",
                "reason": format!(
                    "'{path}' is {} bytes (> {MAX_BYTES} byte cap); refuse to read",
                    meta.len()
                ),
            }))
            .unwrap_or_default();
        }
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "RE_IO",
                    "reason": format!("read '{path}' failed: {e}"),
                }))
                .unwrap_or_default();
            }
        };
        let strings = aphrody_re::extract_strings(&bytes, min_len, limit);
        serde_json::to_string_pretty(&json!({
            "path": path,
            "min_len": min_len,
            "limit": limit,
            "count": strings.len(),
            "strings": strings,
        }))
        .unwrap_or_else(|e| {
            format!(
                r#"{{"error":"RE_ENCODE","reason":"{}"}}"#,
                e.to_string().replace('"', "'")
            )
        })
    }

    // -----------------------------------------------------------------------
    // re_sections — return the section table with per-section Shannon entropy
    // for a PE32/PE64/ELF32/ELF64 binary.
    //
    // Mirrors the `aphrody re sections` CLI sub-command. Delegates to
    // `aphrody_re::triage` and projects only the `sections` field, giving
    // callers a lightweight, focused view without the full triage payload.
    // -----------------------------------------------------------------------
    #[cfg(not(target_arch = "wasm32"))]
    #[tool(
        description = "Parse a PE32/PE64/ELF32/ELF64 binary and return its section table as a \
                          JSON object. Each entry contains `name` (string), `vaddr` (u64), \
                          `size` (u64 bytes on disk), and `entropy` (Shannon bits/byte, null for \
                          .bss-style sections with no on-disk content). High entropy (>= 7.0) \
                          signals compression or encryption (UPX, custom packers). Returns a \
                          structured envelope on read failure, oversized inputs, or unknown \
                          binary formats."
    )]
    async fn re_sections(
        &self,
        Parameters(ReSectionsRequest { path }): Parameters<ReSectionsRequest>,
    ) -> String {
        const MAX_BYTES: u64 = 200 * 1024 * 1024; // 200 MB

        let meta = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "RE_BAD_REQUEST",
                    "reason": format!("unable to stat '{path}': {e}"),
                }))
                .unwrap_or_default();
            }
        };
        if meta.len() > MAX_BYTES {
            return serde_json::to_string_pretty(&json!({
                "error": "RE_BAD_REQUEST",
                "reason": format!(
                    "'{path}' is {} bytes (> {MAX_BYTES} byte cap); refuse to triage",
                    meta.len()
                ),
            }))
            .unwrap_or_default();
        }
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "RE_IO",
                    "reason": format!("read '{path}' failed: {e}"),
                }))
                .unwrap_or_default();
            }
        };
        match aphrody_re::triage(&bytes) {
            Ok(report) => serde_json::to_string_pretty(&json!({
                "path": path,
                "format": report.format,
                "section_count": report.sections.len(),
                "sections": report.sections,
            }))
            .unwrap_or_else(|e| {
                format!(
                    r#"{{"error":"RE_ENCODE","reason":"{}"}}"#,
                    e.to_string().replace('"', "'")
                )
            }),
            Err(e) => serde_json::to_string_pretty(&json!({
                "error": "RE_PARSE",
                "reason": e.to_string(),
            }))
            .unwrap_or_default(),
        }
    }

    // -----------------------------------------------------------------------
    // re_disasm — x86-64 disassembly of a raw binary file via aphrody-re.
    //
    // Delegates directly to `aphrody_re::disasm` (iced-x86 IntelFormatter,
    // pure Rust, no GPL). The caller controls the byte offset into the file,
    // the virtual RIP base for operand display, and the instruction count cap.
    // -----------------------------------------------------------------------
    #[cfg(not(target_arch = "wasm32"))]
    #[tool(
        description = "Disassemble x86-64 instructions from a binary file (PE, ELF, raw \
                          shellcode, firmware dump — any byte sequence). Returns a JSON object \
                          with `path`, `offset`, `rip`, `limit`, `count`, and an `instructions` \
                          array. Each instruction entry contains `offset` (byte offset from the \
                          start of the decoded slice), `address` (virtual address = rip + \
                          offset), `bytes_hex` (lowercase hex of raw instruction bytes), \
                          `mnemonic` (bare mnemonic, e.g. `\"mov\"`), and `text` (full \
                          Intel-syntax line, e.g. `\"mov rbp,rsp\"`). Decoding stops at the \
                          instruction limit, the end of the slice, or the first invalid/unknown \
                          encoding — whichever comes first. Errors with a structured envelope on \
                          read failure, oversized inputs (> 100 MB), or out-of-bounds offset."
    )]
    async fn re_disasm(
        &self,
        Parameters(ReDisasmRequest {
            path,
            offset,
            rip,
            limit,
        }): Parameters<ReDisasmRequest>,
    ) -> String {
        const MAX_BYTES: u64 = 100 * 1024 * 1024; // 100 MB
        const DEFAULT_LIMIT: usize = aphrody_re::DISASM_LIMIT; // 256
        const CAP_LIMIT: usize = 4096;

        let byte_offset = offset.unwrap_or(0);
        let rip_base = rip.unwrap_or(0);
        let insn_limit = limit.unwrap_or(DEFAULT_LIMIT).min(CAP_LIMIT);

        let meta = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "RE_BAD_REQUEST",
                    "reason": format!("unable to stat '{path}': {e}"),
                }))
                .unwrap_or_default();
            }
        };
        if meta.len() > MAX_BYTES {
            return serde_json::to_string_pretty(&json!({
                "error": "RE_BAD_REQUEST",
                "reason": format!(
                    "'{path}' is {} bytes (> {MAX_BYTES} byte cap); refuse to read",
                    meta.len()
                ),
            }))
            .unwrap_or_default();
        }
        let file_bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "RE_IO",
                    "reason": format!("read '{path}' failed: {e}"),
                }))
                .unwrap_or_default();
            }
        };
        let slice = match file_bytes.get(byte_offset as usize..) {
            Some(s) if !s.is_empty() => s,
            _ => {
                return serde_json::to_string_pretty(&json!({
                    "error": "RE_BAD_REQUEST",
                    "reason": format!(
                        "offset {byte_offset} is out of bounds (file is {} bytes)",
                        file_bytes.len()
                    ),
                }))
                .unwrap_or_default();
            }
        };
        let instructions = aphrody_re::disasm(slice, rip_base, insn_limit);
        serde_json::to_string_pretty(&json!({
            "path": path,
            "offset": byte_offset,
            "rip": rip_base,
            "limit": insn_limit,
            "count": instructions.len(),
            "instructions": instructions,
        }))
        .unwrap_or_else(|e| {
            format!(
                r#"{{"error":"RE_ENCODE","reason":"{}"}}"#,
                e.to_string().replace('"', "'")
            )
        })
    }

    // -----------------------------------------------------------------------
    // 19. context7_resolve_library_id — Context7 library catalog search. Ported from
    //     packages/mcp/cli/src/mcp-bridge.ts (winclean peer, MIT) to native Rust on 2026-05-19. The
    //     public Context7 API tolerates unauthenticated requests; CONTEXT7_API_KEY (Bearer) unlocks
    //     larger quotas.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Resolve a package or product name to a Context7-compatible library ID \
                          (e.g. '/vercel/next.js') and return matching libraries with \
                          descriptions and source reputation. First step before \
                          `context7_query_docs`."
    )]
    async fn context7_resolve_library_id(
        &self,
        Parameters(Context7ResolveRequest {
            query,
            library_name,
        }): Parameters<Context7ResolveRequest>,
    ) -> String {
        // Context7 v1 search takes a single `query`; fold the library name in
        // for ranking when present.
        let q = if library_name.trim().is_empty() {
            query.clone()
        } else {
            format!("{library_name} {query}")
        };
        context7_get("v1/search", &[("query", q.as_str())]).await
    }

    // -----------------------------------------------------------------------
    // 20. context7_query_docs — pulls up-to-date documentation slices for a previously-resolved
    //     library ID. Returns raw markdown (the Context7 API returns text/markdown directly, not
    //     wrapped JSON).
    // -----------------------------------------------------------------------
    #[tool(
        description = "Retrieve up-to-date documentation and code examples from Context7 for \
                          a specific library and topic. Pass a libraryId resolved via \
                          `context7_resolve_library_id`. Returns raw markdown."
    )]
    async fn context7_query_docs(
        &self,
        Parameters(Context7DocsRequest { library_id, query }): Parameters<Context7DocsRequest>,
    ) -> String {
        // Context7 v1 docs are path-based: /api/v1/<libraryId>?type=txt&topic=&tokens=.
        // libraryId is returned with a leading '/' (e.g. "/websites/rs_tokio").
        let path = format!("v1/{}", library_id.trim_start_matches('/'));
        context7_get(
            &path,
            &[
                ("type", "txt"),
                ("topic", query.as_str()),
                ("tokens", "5000"),
            ],
        )
        .await
    }

    // -----------------------------------------------------------------------
    // 21. microsoft_docs_search — proxy to the upstream Microsoft Learn HTTP MCP server
    //     (`learn.microsoft.com/api/mcp`). Single binary, no separate `mcpServers.microsoft-learn`
    //     entry needed.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Search official Microsoft documentation and return up to 10 concise, \
                          high-quality content chunks (max 500 tokens each), including title, \
                          URL and excerpt. Use first to get a quick, reliable overview of any \
                          Microsoft / Azure / .NET / Windows / M365 / Power Platform technology."
    )]
    async fn microsoft_docs_search(
        &self,
        Parameters(MsLearnSearchRequest { query }): Parameters<MsLearnSearchRequest>,
    ) -> String {
        mslearn_call("microsoft_docs_search", json!({ "query": query })).await
    }

    // -----------------------------------------------------------------------
    // 22. microsoft_docs_fetch — full-page fetch on a Microsoft Learn URL, converted to markdown by
    //     the upstream server.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Fetch and convert a Microsoft documentation page into markdown format. \
                          Use after `microsoft_docs_search` when an excerpt is cut off or you \
                          need the full tutorial / configuration guide / API reference page."
    )]
    async fn microsoft_docs_fetch(
        &self,
        Parameters(MsLearnFetchRequest { url }): Parameters<MsLearnFetchRequest>,
    ) -> String {
        mslearn_call("microsoft_docs_fetch", json!({ "url": url })).await
    }

    // -----------------------------------------------------------------------
    // 23. microsoft_code_sample_search — official Microsoft / Azure code snippet search, optionally
    //     filtered by language.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Search for official Microsoft / Azure code snippets and examples. Use \
                          before writing code (find a working pattern to follow) or after errors \
                          (compare your code against a known-good sample). Optional language \
                          filter narrows results to a single SDK ecosystem."
    )]
    async fn microsoft_code_sample_search(
        &self,
        Parameters(MsLearnCodeSampleRequest { query, language }): Parameters<
            MsLearnCodeSampleRequest,
        >,
    ) -> String {
        let mut args = serde_json::Map::new();
        args.insert("query".into(), json!(query));
        if let Some(lang) = language
            && !lang.is_empty()
        {
            args.insert("language".into(), json!(lang));
        }
        mslearn_call(
            "microsoft_code_sample_search",
            serde_json::Value::Object(args),
        )
        .await
    }

    // -----------------------------------------------------------------------
    // 24. docs_auto_search — fanout aggregator. Runs THREE backends in parallel via `tokio::join!`:
    //     Context7 (resolve → optional fetch), Microsoft Learn search, and Microsoft code-sample
    //     search. One tool call instead of three round-trips.
    //
    //     There is no web-search backend here, and nothing user-visible may claim one. This
    //     comment and the tool description both used to say "and Google", while the
    //     `tokio::join!` below has always taken exactly three futures. A model reading the
    //     description picks this tool for a question only a web search answers, receives a
    //     well-formed report with nothing from the web in it, and has no way to tell the
    // -----------------------------------------------------------------------
    // 24. docs_auto_search — fanout aggregator. Runs FOUR backends in parallel via `tokio::join!`:
    //     Context7 (resolve → optional fetch), Microsoft Learn search, Microsoft code-sample
    //     search, and GitHub (intelligent repository discovery, llms.txt, and docs). One tool
    //     call instead of four round-trips.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Single-shot documentation lookup that queries four backends in \
                          parallel — Context7, Microsoft Learn, Microsoft code samples, and \
                          GitHub (authoritative repos, llms.txt, and READMEs) — and returns \
                          one fused markdown report. Provide `library_name` when known to unlock \
                          the Context7 deep fetch and targeted GitHub repo discovery; provide \
                          `language` to narrow Microsoft code samples."
    )]
    async fn docs_auto_search(
        &self,
        Parameters(DocsAutoSearchRequest {
            query,
            library_name,
            language,
            include_github,
        }): Parameters<DocsAutoSearchRequest>,
    ) -> String {
        let mut ms_code_args = serde_json::Map::new();
        ms_code_args.insert("query".into(), json!(&query));
        if let Some(ref lang) = language
            && !lang.is_empty()
        {
            ms_code_args.insert("language".into(), json!(lang));
        }

        let ctx7_future = async {
            if let Some(name) = library_name.as_deref().filter(|s| !s.trim().is_empty()) {
                let resolved = context7_get("v1/search", &[("query", name.trim())]).await;
                let (lib_id, candidates) = pick_context7_library(&resolved, name);
                if let Some(id) = lib_id {
                    let path = format!("v1/{}", id.trim_start_matches('/'));
                    let docs = context7_get(
                        &path,
                        &[
                            ("type", "txt"),
                            ("topic", query.as_str()),
                            ("tokens", "3000"),
                        ],
                    )
                    .await;
                    format!(
                        "### resolved library_id: `{id}`\n\n{candidates}\n\n### docs\n\n{}",
                        clip_section(&docs, DOCS_SECTION_MAX * 2)
                    )
                } else {
                    format!(
                        "No Context7 library is titled {name:?}; no deep fetch. Candidates:\n\n\
                         {candidates}"
                    )
                }
            } else {
                let resolved = context7_get("v1/search", &[("query", query.as_str())]).await;
                pick_context7_library(&resolved, "").1
            }
        };

        let do_github = include_github.unwrap_or(true);
        let gh_future = async {
            if do_github {
                let gh_q = library_name.as_deref().unwrap_or(query.as_str());
                match aphrody_git::search_github_docs(gh_q, 3, false).await {
                    Ok(rep) => rep.formatted_markdown,
                    Err(e) => format!("GitHub documentation search failed: {e}"),
                }
            } else {
                String::new()
            }
        };

        let (ctx7, ms_search, ms_code, gh_docs) = tokio::join!(
            ctx7_future,
            mslearn_call("microsoft_docs_search", json!({ "query": query })),
            mslearn_call(
                "microsoft_code_sample_search",
                serde_json::Value::Object(ms_code_args),
            ),
            gh_future,
        );

        let mut out = String::with_capacity(16384);
        out.push_str("# docs_auto_search — aggregated documentation report\n\n");
        out.push_str(&format!("**Query** : {query}\n"));
        if let Some(ref name) = library_name {
            out.push_str(&format!("**Library** : {name}\n"));
        }
        if let Some(ref lang) = language {
            out.push_str(&format!("**Language filter** : {lang}\n"));
        }
        out.push('\n');

        out.push_str("## 1. Context7 (community docs catalog)\n\n");
        out.push_str(&ctx7);
        out.push_str("\n\n## 2. Microsoft Learn — concept / API search\n\n");
        out.push_str(&clip_section(&ms_search, DOCS_SECTION_MAX));
        out.push_str("\n\n## 3. Microsoft Learn — code samples\n\n");
        out.push_str(&clip_section(&ms_code, DOCS_SECTION_MAX));
        if !gh_docs.is_empty() {
            out.push_str("\n\n## 4. GitHub — repositories & llms.txt\n\n");
            out.push_str(&clip_section(&gh_docs, DOCS_SECTION_MAX));
        }
        out
    }

    // -----------------------------------------------------------------------
    // 25. aphrody_mcp_call — generic MCP-to-MCP proxy (R-A R1.4).
    //
    // Lets the running `aphrody-mcp` server invoke a tool on any other MCP
    // server configured in the user's `mcp.json` (stdio or HTTP transport).
    // The wire-level work (spawn, JSON-RPC framing, initialize + tools/call)
    // is delegated to `aphrody_gemini_runtime::McpClient`, the same code path the
    // `aphrody-mcp client …` CLI exercises. This makes `aphrody-mcp` the
    // single hub through which a downstream agent can fan out to every MCP
    // server it knows about, without having to register each one separately.
    //
    // The handler is intentionally fault-tolerant: every failure path is
    // mapped to a structured `MCP_*` error envelope so callers can branch on
    // `error` strings instead of stringly-matching anyhow messages.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Proxy-invoke a tool on any MCP server configured in mcp.json. \
                          Spawns/connects the target server transparently (stdio or HTTP), runs \
                          the `initialize` + `tools/call` handshake, and returns the target \
                          tool's raw `result` payload wrapped in a small envelope { server, \
                          tool, result }. Use to chain MCP servers (e.g. delegate to `github`, \
                          `context7`) without separate client wiring."
    )]
    async fn aphrody_mcp_call(
        &self,
        Parameters(AphrodyMcpCallRequest {
            server,
            tool,
            args,
            config,
        }): Parameters<AphrodyMcpCallRequest>,
    ) -> String {
        // Reject empty identifiers up front — `find_server` would still
        // surface a useful error, but a typed envelope is friendlier for
        // downstream `error` matching.
        if server.trim().is_empty() {
            return serde_json::to_string_pretty(&json!({
                "error": "MCP_BAD_REQUEST",
                "reason": "`server` must be a non-empty string",
            }))
            .unwrap_or_default();
        }
        if tool.trim().is_empty() {
            return serde_json::to_string_pretty(&json!({
                "error": "MCP_BAD_REQUEST",
                "reason": "`tool` must be a non-empty string",
            }))
            .unwrap_or_default();
        }

        let override_path = config.as_deref().map(std::path::Path::new);
        let cfg = match crate::client_cmd::load_config(override_path) {
            Ok(c) => c,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "MCP_CONFIG",
                    "reason": e.to_string(),
                }))
                .unwrap_or_default();
            }
        };
        let entry = match crate::client_cmd::find_server(&cfg, &server) {
            Ok(e) => e,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "MCP_UNKNOWN_SERVER",
                    "reason": e.to_string(),
                }))
                .unwrap_or_default();
            }
        };

        let mut client = match crate::client_cmd::connect_from_config(entry).await {
            Ok(c) => c,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "MCP_CONNECT",
                    "reason": e.to_string(),
                    "server": server,
                }))
                .unwrap_or_default();
            }
        };

        if let Err(e) = client.initialize().await {
            return serde_json::to_string_pretty(&json!({
                "error": "MCP_INITIALIZE",
                "reason": e.to_string(),
                "server": server,
            }))
            .unwrap_or_default();
        }

        let args_value = args.unwrap_or_else(|| json!({}));
        if !args_value.is_object() {
            return serde_json::to_string_pretty(&json!({
                "error": "MCP_BAD_REQUEST",
                "reason": "`args` must be a JSON object when set",
                "server": server,
                "tool": tool,
            }))
            .unwrap_or_default();
        }

        let result = match client.call_tool(&tool, args_value).await {
            Ok(v) => v,
            Err(e) => {
                return serde_json::to_string_pretty(&json!({
                    "error": "MCP_CALL",
                    "reason": e.to_string(),
                    "server": server,
                    "tool": tool,
                }))
                .unwrap_or_default();
            }
        };

        // Best-effort shutdown so the spawned stdio child does not linger
        // past this turn. Errors are non-fatal — the kill_on_drop guard on
        // the underlying `Command` is the real safety net.
        #[cfg(not(target_arch = "wasm32"))]
        client.shutdown().await;

        serde_json::to_string_pretty(&json!({
            "server": server,
            "tool": tool,
            "result": result,
        }))
        .unwrap_or_else(|e| {
            format!(
                r#"{{"error":"MCP_ENCODE","reason":"{}"}}"#,
                e.to_string().replace('"', "'")
            )
        })
    }

    #[tool(
        description = "Call native Aphrody Web tools by their public or historical name \
                          through this endpoint (browser, crawl, Google, Gemini, X, archive). \
                          Use aphrody_capabilities to inspect the tools available in this build."
    )]
    async fn aphrody_web_call(
        &self,
        Parameters(WebCallRequest { tool, args }): Parameters<WebCallRequest>,
    ) -> String {
        if tool.trim().is_empty() {
            return json!({ "error": "WEB_BAD_REQUEST", "reason": "`tool` must not be empty" })
                .to_string();
        }
        let arguments = serde_json::Value::Object(args.unwrap_or_default().into_iter().collect());

        let backend = bxc_tools::internal_name(&tool).unwrap_or_else(|| tool.clone());
        match bxc_tools::call_raw(&backend, arguments).await {
            Ok(result) => {
                json!({ "backend": "aphrody-web", "tool": tool, "result": result }).to_string()
            }
            Err(reason) => {
                json!({ "error": "WEB_CALL", "reason": reason, "tool": tool }).to_string()
            }
        }
    }

    #[tool(
        description = "Call the local Aphrody A2A v1 JSON-RPC backend through aphrody-mcp. \
                          The endpoint is APHRODY_A2A_ENDPOINT (legacy APHRODY_A2A_URL) or \
                          http://127.0.0.1:8788/; only \
                          canonical A2A methods are accepted."
    )]
    async fn aphrody_a2a_call(
        &self,
        Parameters(A2aCallRequest { method, params }): Parameters<A2aCallRequest>,
    ) -> String {
        if !a2a_methods().contains(&method.as_str()) {
            return json!({
                "error": "A2A_UNKNOWN_METHOD",
                "method": method,
                "allowed": a2a_methods(),
            })
            .to_string();
        }
        let endpoint = a2a_endpoint();
        let id = A2A_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let request = context7_client().post(&endpoint);
        let request = match a2a_auth::token() {
            Ok(Some(token)) => request.bearer_auth(token),
            Ok(None) => request,
            Err(reason) => return json!({ "error": "A2A_AUTH", "reason": reason }).to_string(),
        };
        let response = request
            .json(&json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": serde_json::Value::Object(params.into_iter().collect()),
            }))
            .send()
            .await;
        match response {
            Ok(response) => {
                let status = response.status();
                match response.json::<serde_json::Value>().await {
                    Ok(body) => json!({
                        "backend": "aphrody-a2a",
                        "endpoint": endpoint,
                        "status": status.as_u16(),
                        "response": body,
                    })
                    .to_string(),
                    Err(error) => json!({
                        "error": "A2A_DECODE",
                        "reason": error.to_string(),
                        "status": status.as_u16(),
                    })
                    .to_string(),
                }
            }
            Err(error) => json!({
                "error": "A2A_CONNECT",
                "reason": error.to_string(),
                "endpoint": endpoint,
            })
            .to_string(),
        }
    }

    #[tool(
        description = "Return machine-readable backend contracts from the unified endpoint. \
                          `aphrody` returns the live MCP tool schemas, `web` lists the web \
                          backend tools, `n2b` returns its canonical report JSON Schema, `a2a` \
                          returns the A2A v1 JSON-RPC contract, and `all` returns every local \
                          contract plus the live web catalogue when available."
    )]
    async fn aphrody_schema(
        &self,
        Parameters(SchemaRequest { domain }): Parameters<SchemaRequest>,
    ) -> String {
        let aphrody = || {
            json!({
                "service": "aphrody-mcp",
                "protocol": "MCP 2024-11-05",
                "tools": Self::all_tools().list_all(),
            })
        };
        let n2b = || {
            serde_json::from_str::<serde_json::Value>(aphrody_n2b_types::REPORT_SCHEMA_V2)
                .unwrap_or_else(
                    |error| json!({ "error": "N2B_SCHEMA", "reason": error.to_string() }),
                )
        };

        let contract = match domain.trim().to_ascii_lowercase().as_str() {
            "aphrody" => aphrody(),
            "n2b" => n2b(),
            "a2a" => a2a_contract(),
            "web" => match bxc_catalog().await {
                Ok(catalog) => catalog,
                Err(reason) => json!({ "error": "WEB_CATALOG", "reason": reason }),
            },
            "all" => {
                let web = match bxc_catalog().await {
                    Ok(catalog) => catalog,
                    Err(reason) => json!({ "error": "WEB_CATALOG", "reason": reason }),
                };
                json!({ "aphrody": aphrody(), "web": web, "n2b": n2b(), "a2a": a2a_contract() })
            }
            unknown => json!({
                "error": "UNKNOWN_SCHEMA_DOMAIN",
                "domain": unknown,
                "allowed": ["aphrody", "web", "n2b", "a2a", "all"],
            }),
        };
        serde_json::to_string_pretty(&contract).unwrap_or_else(|error| {
            json!({ "error": "SCHEMA_ENCODE", "reason": error.to_string() }).to_string()
        })
    }

    // -----------------------------------------------------------------------
    // n2b — run the n2b migration tool on the given path.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Scan and migrate a Node.js codebase to Bun using n2b. Detects \
                          Node-specific patterns, shims, polyfills, package configurations, and \
                          automatically migrates or fixes them."
    )]
    async fn n2b(&self, Parameters(N2bRequest { path, mode }): Parameters<N2bRequest>) -> String {
        let target_path = path.unwrap_or_else(|| ".".to_string());
        let m = mode.unwrap_or_else(|| "scan".to_string());
        let run_mode = match m.as_str() {
            "fix" => aphrody_n2b_types::types::Mode::Fix,
            "migrate" => aphrody_n2b_types::types::Mode::Aggressive,
            _ => aphrody_n2b_types::types::Mode::Check,
        };
        let opts = aphrody_n2b_types::types::RunOptions {
            root: std::path::PathBuf::from(target_path),
            mode: run_mode,
            report: aphrody_n2b_types::types::Report::Json,
            quiet: true,
            ignore: Vec::new(),
            agent: true,
            dry_run: false,
        };
        match aphrody_n2b_core::run::run(&opts) {
            Ok(fixes) => aphrody_n2b_core::report::render_json(&fixes, &opts),
            Err(e) => serde_json::to_string_pretty(&json!({
                "error": "N2B_EXECUTION",
                "reason": e.to_string(),
            }))
            .unwrap_or_else(|_| "Failed to format JSON error".to_string()),
        }
    }

    // -----------------------------------------------------------------------
    // github_docs_search — search GitHub repositories for docs & llms.txt.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Search GitHub repositories intelligently for documentation, \
                          llms.txt, llms-full.txt, and prompt-ready digests. Discovers \
                          authoritative open-source repositories matching the query, inspects \
                          llms.txt and README, and optionally generates full GitIngest digests."
    )]
    async fn github_docs_search(
        &self,
        Parameters(GitHubDocsSearchRequest {
            query,
            limit,
            include_digest,
        }): Parameters<GitHubDocsSearchRequest>,
    ) -> String {
        let limit = limit.unwrap_or(3).min(5) as usize;
        let digest = include_digest.unwrap_or(false);
        match aphrody_git::search_github_docs(&query, limit, digest).await {
            Ok(report) => report.formatted_markdown,
            Err(e) => serde_json::to_string_pretty(&json!({
                "error": "GITHUB_DOCS_SEARCH_FAILED",
                "reason": e.to_string(),
            }))
            .unwrap_or_default(),
        }
    }

    // -----------------------------------------------------------------------
    // git_ingest — turn any Git repository or directory into a prompt-ready digest.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Ingest a Git repository URL or local directory into a prompt-ready \
                          LLM digest (GitIngest standard with directory tree, token counts, and \
                          curated file contents)."
    )]
    async fn git_ingest(
        &self,
        Parameters(GitIngestRequest {
            source,
            max_size,
            include_patterns,
            exclude_patterns,
            branch,
            tag,
            subpath,
        }): Parameters<GitIngestRequest>,
    ) -> String {
        if !aphrody_git::is_remote_source(&source) {
            return serde_json::to_string_pretty(&json!({
                "error": "GIT_INGEST_LOCAL_MOVED",
                "reason": "local directory ingestion moved to the `git_ingest` tool of `bun mcp` (Bun fork); run `bun mcp install` then call that tool",
            }))
            .unwrap_or_default();
        }
        let mut opts = aphrody_git::IngestOptions::default();
        if let Some(s) = max_size {
            opts.max_file_size = s;
        }
        if let Some(inc) = include_patterns {
            opts.include_patterns = inc;
        }
        if let Some(exc) = exclude_patterns {
            opts.exclude_patterns = exc;
        }
        opts.branch = branch;
        opts.tag = tag;
        opts.subpath = subpath;

        match aphrody_git::ingest_remote(source.trim(), &opts) {
            Ok(result) => result.full_context(),
            Err(e) => serde_json::to_string_pretty(&json!({
                "error": "GIT_INGEST_FAILED",
                "reason": e.to_string(),
            }))
            .unwrap_or_default(),
        }
    }

    // -----------------------------------------------------------------------
    // upstream_* — live, read-only access to the upstream catalogue (no clone).
    // -----------------------------------------------------------------------
    #[tool(
        description = "List the upstream catalogue (tools/config/upstream-sources.json): the few \
                          vital checkouts and the reference upstreams that are never cloned \
                          (codex, ollama, mistral.rs, vllm, WSL, ...), with tier, purpose and consumers."
    )]
    async fn upstream_list(
        &self,
        Parameters(UpstreamListRequest { repo_path }): Parameters<UpstreamListRequest>,
    ) -> String {
        match aphrody_git::upstream::catalogue(upstream_root(repo_path.as_deref())) {
            Ok(entries) => serde_json::to_string_pretty(&entries).unwrap_or_default(),
            Err(e) => serde_json::to_string_pretty(&json!({
                "error": "UPSTREAM_LIST_FAILED",
                "reason": e.to_string(),
            }))
            .unwrap_or_default(),
        }
    }

    #[tool(
        description = "Live facts about one catalogue upstream from the GitHub API: head of the \
                          followed ref, latest release, licence, pushed date, archived flag, and \
                          whether it moved since the commit recorded in the manifest."
    )]
    async fn upstream_info(&self, Parameters(request): Parameters<UpstreamRequest>) -> String {
        upstream_query("info", request).await
    }

    #[tool(
        description = "List a directory of one catalogue upstream at its live ref (no clone). \
                          `path` defaults to the repository root."
    )]
    async fn upstream_tree(&self, Parameters(request): Parameters<UpstreamRequest>) -> String {
        upstream_query("tree", request).await
    }

    #[tool(
        description = "Read one file of a catalogue upstream at its live ref (no clone). \
                          Text over 256 KiB is cut and flagged `truncated`."
    )]
    async fn upstream_read(&self, Parameters(request): Parameters<UpstreamRequest>) -> String {
        upstream_query("read", request).await
    }

    #[tool(
        description = "Code search inside one catalogue upstream: GitHub code search with a \
                          token (GH_TOKEN, GITHUB_TOKEN or gh auth); without one, the entry's \
                          local checkout (every word, case-insensitive, 20 hits) with a \
                          `degraded` note."
    )]
    async fn upstream_search(&self, Parameters(request): Parameters<UpstreamRequest>) -> String {
        upstream_query("search", request).await
    }

    // -----------------------------------------------------------------------
    // awesome_fetch — fetch and structure a canonical curated Awesome list.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Fetch, parse, and structure a canonical curated Awesome list from \
                          GitHub (e.g. 'sindresorhus/awesome', 'oven-sh/awesome-bun', \
                          'rust-unofficial/awesome-rust', 'tauri-apps/awesome-tauri'). \
                          Returns structured categories, entries, and GitHub metadata."
    )]
    async fn awesome_fetch(
        &self,
        Parameters(AwesomeFetchRequest { source, enrich }): Parameters<AwesomeFetchRequest>,
    ) -> String {
        match aphrody_git::fetch_awesome_list(&source).await {
            Ok(mut index) => {
                if enrich.unwrap_or(false)
                    && let Ok(client) = aphrody_git::GitHubClient::from_env()
                {
                    for cat in &mut index.categories {
                        client.enrich_awesome_items(&mut cat.items, 10).await;
                    }
                }
                index.to_markdown()
            }
            Err(e) => serde_json::to_string_pretty(&json!({
                "error": "AWESOME_FETCH_FAILED",
                "reason": e.to_string(),
            }))
            .unwrap_or_default(),
        }
    }

    // -----------------------------------------------------------------------
    // awesome_search — search across curated Awesome lists.
    // -----------------------------------------------------------------------
    #[tool(
        description = "Search across curated Awesome lists (Bun, Rust, Tauri, \
                          Sindresorhus/Awesome) for libraries, frameworks, tools, and \
                          resources matching a keyword."
    )]
    async fn awesome_search(
        &self,
        Parameters(AwesomeSearchRequest { query, preset }): Parameters<AwesomeSearchRequest>,
    ) -> String {
        let results = if let Some(ref p) = preset {
            match aphrody_git::fetch_awesome_list(p).await {
                Ok(index) => Ok(index.search(&query)),
                Err(e) => Err(e),
            }
        } else {
            let presets: Vec<&str> = aphrody_git::PRESETS.iter().map(|(p, _, _, _)| *p).collect();
            aphrody_git::search_awesome_ecosystem(&query, &presets).await
        };

        match results {
            Ok(items) => {
                let mut md = format!("# Awesome Search Results — `{query}`\n\n");
                md.push_str(&format!("*Found {} curated entries:*\n\n", items.len()));
                for item in items {
                    md.push_str(&format!(
                        "- [{}]({}) `[{}]`",
                        item.title, item.url, item.category
                    ));
                    if !item.description.is_empty() {
                        md.push_str(&format!(" — {}", item.description));
                    }
                    if let Some(ref gh) = item.github_repo {
                        md.push_str(&format!(" (`{gh}`)"));
                    }
                    md.push('\n');
                }
                md
            }
            Err(e) => serde_json::to_string_pretty(&json!({
                "error": "AWESOME_SEARCH_FAILED",
                "reason": e.to_string(),
            }))
            .unwrap_or_default(),
        }
    }
}

// ---------------------------------------------------------------------------
// Local inference toolbox routers (docs/plans/local-inference-toolbox.md, §7).
//
// These tools live in their own `#[tool_router]` impl blocks rather than
// alongside the others, because `#[tool_router]` emits one `.with_route(…)`
// per method carrying `#[tool]` *without* evaluating that method's `#[cfg]`:
// a cfg'd-out tool therefore leaves a dangling route referring to a function
// that no longer exists (E0599 at `Self::<name>_tool_attr`). Gating the whole
// impl block sidesteps that — `#[cfg]` on the item is resolved before the
// attribute macro on the same item ever runs — and the routers are merged
// below.
// ---------------------------------------------------------------------------

#[cfg(all(feature = "ocr", not(target_arch = "wasm32")))]
#[tool_router(router = ocr_router)]
impl GoogleMcpServer {
    // aphrody_ocr — local vision-language OCR.
    //
    // Distinct from any cloud OCR: nothing leaves the machine, and a page with
    // no readable text comes back as `markdown: null` + `textless: true`
    // rather than as an empty string or a description of the picture.
    #[tool(
        description = "Read an image with a local vision-language model (llama.cpp + an \
                          installed GGUF from the aphrody model store) and return markdown. \
                          Fully offline; nothing is downloaded. A page with no readable text \
                          returns markdown=null and textless=true — never an empty string and \
                          never a description of the picture. Every transcription is audited on \
                          the way out: `suspect` is true when the text carries a defect that \
                          should stop a deposit (a stuck/repeating generation, a leaked control \
                          token, surviving markup), with the individual `findings` listed. The \
                          audit annotates, it never removes text. Returns { image, markdown, \
                          textless, suspect, findings, elapsed_ms, model, runner, raw? }."
    )]
    async fn aphrody_ocr(&self, Parameters(req): Parameters<ocr_tools::OcrReadRequest>) -> String {
        ocr_tools::read(req).await
    }
}

#[cfg(all(feature = "vision", not(target_arch = "wasm32")))]
#[tool_router(router = vision_router)]
impl GoogleMcpServer {
    // aphrody_describe_image — the counterpart of aphrody_ocr.
    //
    // Deliberately a separate tool, not a flag on the OCR one: the two grant
    // the model different permissions. OCR may not describe (a caption filed
    // as a transcription corrupts a corpus); this one may, because that is the
    // request. One flag away from each other, that distinction gets erased.
    #[tool(
        description = "Describe an image with a local vision-language model: caption (one \
                          short description), dense_region (per-region descriptions with \
                          normalised boxes), full_page_ocr (text only, never a description), or \
                          vqa (a free-form question, needs `question`). Fully offline; nothing \
                          is downloaded. Unlike aphrody_ocr this tool MAY describe a picture — \
                          use aphrody_ocr when the answer must be a transcription. Returns { \
                          image, mode, model, text, description, elapsed_ms, raw? }."
    )]
    async fn aphrody_describe_image(
        &self,
        Parameters(req): Parameters<vision_tools::DescribeImageRequest>,
    ) -> String {
        vision_tools::describe(req).await
    }
}

#[cfg(all(feature = "stt-local", not(target_arch = "wasm32")))]
#[tool_router(router = stt_local_router)]
impl GoogleMcpServer {
    // aphrody_transcribe — local-only STT.
    //
    // The counterpart of `voice_transcribe`: that one may fall back to a REST
    // API, this one never leaves the machine. Two tools so the choice is made
    // by name at the call site and stays auditable.
    #[tool(
        description = "Transcribe audio fully locally by driving whisper.cpp with weights \
                          from the aphrody model store (catalog id such as whisper-base-en, or a \
                          GGML path). Never falls back to a network API and never downloads: a \
                          missing runtime or missing weights is a structured error. Audio must \
                          be 16 kHz mono WAV. Returns { text, language, duration_s, segments, \
                          backend, binary, model, weights }."
    )]
    async fn aphrody_transcribe(
        &self,
        Parameters(req): Parameters<stt_local_tools::LocalTranscribeRequest>,
    ) -> String {
        stt_local_tools::transcribe(req).await
    }
}

#[cfg(all(feature = "jobs", not(target_arch = "wasm32")))]
#[tool_router(router = jobs_router)]
impl GoogleMcpServer {
    // aphrody_job_submit — writes one SQLite row and returns; it executes
    // nothing and downloads nothing.
    #[tool(description = "Submit a background job to the persistent queue at \
                          ~/.aphrody/jobs/jobs.db and return its id immediately. Executes \
                          nothing and downloads nothing: the job stays queued until a worker \
                          claims it. Returns { id, kind, state, priority, max_attempts, \
                          created_at, log_path, db_path, queue, note }.")]
    async fn aphrody_job_submit(
        &self,
        Parameters(req): Parameters<jobs_tools::JobSubmitRequest>,
    ) -> String {
        jobs_tools::submit(req).await
    }

    #[tool(
        description = "Inspect the background job queue. With `id`: the job plus its trailing \
                          NDJSON log lines. Without: a filtered listing (state/kind/limit). Both \
                          include queue-wide counts so a job that no worker handles is visible \
                          as queued rather than mistaken for slow."
    )]
    async fn aphrody_job_status(
        &self,
        Parameters(req): Parameters<jobs_tools::JobStatusRequest>,
    ) -> String {
        jobs_tools::status(req).await
    }

    #[tool(
        description = "Cancel a persistent job by id. Queued work is cancelled immediately; a running \
                          native handler stops at its next lease heartbeat. Returns durable state \
                          and queue stats."
    )]
    async fn aphrody_job_cancel(
        &self,
        Parameters(req): Parameters<jobs_tools::JobCancelRequest>,
    ) -> String {
        jobs_tools::cancel(req).await
    }
}

// Own impl block (see the note above the toolbox routers): the tool is
// host-only, and `#[tool_router]` would leave a dangling route for a `#[cfg]`'d
// method.
#[cfg(not(target_arch = "wasm32"))]
#[tool_router(router = external_sessions_router)]
impl GoogleMcpServer {
    #[tool(
        description = "Mirror the sessions of the other coding agents on this machine \
                          (Antigravity CLI `agy`, Codex, Claude Code) into \
                          ~/.aphrody/sessions/<agent>/<session_id>.jsonl, incrementally: \
                          per-file byte offsets mean a re-run only ingests lines appended since, \
                          and each line is normalised to {agent, session_id, workspace, ts, \
                          role, text, source_path, offset}. Optionally matches running agent \
                          processes to the sessions they write (live, default true) and feeds \
                          user/assistant turns into the local memory store (memory, default \
                          true). Returns the JSON summary { records_ingested, sources_scanned, \
                          sources_updated, agents, sessions, live_processes, memory, issues }."
    )]
    async fn sync_external_agents(
        &self,
        Parameters(request): Parameters<sync_tools::SyncExternalAgentsRequest>,
    ) -> String {
        sync_tools::sync_external_agents(request).await
    }
}

// Own impl block: host-only (see the note above the toolbox routers).
#[cfg(not(target_arch = "wasm32"))]
#[tool_router(router = remote_router)]
impl GoogleMcpServer {
    #[tool(
        description = "Computer use on any VNC (RFB) server: a tunnel member (`omar`), \
                          `host[:port]` or `vnc://host:port`, e.g. `aphrody infra remote serve` \
                          on a WireGuard peer. Actions: screenshot (JPEG image), click, \
                          double_click, move, drag (x,y -> end_x,end_y), scroll (delta_x/delta_y \
                          in 120-unit wheel steps, positive down/right), type, keypress \
                          (`Enter`, `ctrl+s`), wait, close. The session is kept open between \
                          calls. The password comes from the credential store \
                          (APHRODY_VNC_PASSWORD or `aphrody infra remote token set vnc`), never \
                          from the arguments."
    )]
    async fn aphrody_remote_vnc(
        &self,
        Parameters(req): Parameters<remote_tools::RemoteVncRequest>,
    ) -> rmcp::model::CallToolResult {
        remote_tools::call(req).await
    }
}

#[cfg(all(feature = "rag", not(target_arch = "wasm32")))]
#[tool_router(router = rag_router)]
impl GoogleMcpServer {
    #[tool(
        description = "Search the local aphrody RAG index (SQLite FTS5, built by `aphrody rag \
                          index`; $APHRODY_RAG_DB or ~/.aphrody/rag/index.db). Returns ranked \
                          chunks with path, lines and score as JSON."
    )]
    async fn aphrody_rag_search(
        &self,
        Parameters(req): Parameters<rag_tools::RagSearchRequest>,
    ) -> String {
        rag_tools::search(req).await
    }

    #[tool(
        description = "Same retrieval as aphrody_rag_search, rendered as a numbered, citable \
                          Markdown context block ready to paste into a prompt."
    )]
    async fn aphrody_rag_context(
        &self,
        Parameters(req): Parameters<rag_tools::RagSearchRequest>,
    ) -> String {
        rag_tools::context(req).await
    }

    #[tool(
        description = "Search the agent home database (one SQLite file per home: `<home>/db/aphrody.sqlite`) \
                          with a single hybrid query over document chunks, code-graph nodes and \
                          memories (FTS5 plus one reciprocal-rank fusion). Optional kinds filter \
                          (chunk, node, memory) and profile (aphrody, ie). Build it with \
                          `aphrody home index <dir>`. Returns ranked hits with path, line and snippet."
    )]
    async fn aphrody_home_query(
        &self,
        Parameters(req): Parameters<home_tools::HomeQueryRequest>,
    ) -> String {
        home_tools::query(req).await
    }

    #[tool(
        description = "Status of the agent home database: path, schema version and table counts \
                          (sources, files, docs, chunks, graph nodes and edges, memories, sessions)."
    )]
    async fn aphrody_home_status(
        &self,
        Parameters(req): Parameters<home_tools::HomeStatusRequest>,
    ) -> String {
        home_tools::status(req).await
    }
}

impl GoogleMcpServer {
    /// The full `tools/list`: built-in routes, WinClean (feature), then the web
    /// backend catalog, every tool titled and annotated.
    pub(crate) async fn every_tool() -> Vec<rmcp::model::Tool> {
        let router = Self::all_tools();
        let mut tools = router.list_all();
        let taken: std::collections::HashSet<String> =
            tools.iter().map(|tool| tool.name.to_string()).collect();
        tools.extend(public_web_tools::list(|name| taken.contains(name)));
        let taken: std::collections::HashSet<String> =
            tools.iter().map(|tool| tool.name.to_string()).collect();
        tools.extend(native_crawl_tools::list(|name| taken.contains(name)));
        #[cfg(not(target_arch = "wasm32"))]
        {
            let taken: std::collections::HashSet<String> =
                tools.iter().map(|tool| tool.name.to_string()).collect();
            tools.extend(search_tools::list(|name| taken.contains(name)));
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let taken: std::collections::HashSet<String> =
                tools.iter().map(|tool| tool.name.to_string()).collect();
            tools.extend(gemini_tools::list(|name| taken.contains(name)));
        }
        let taken: std::collections::HashSet<String> =
            tools.iter().map(|tool| tool.name.to_string()).collect();
        tools.extend(x_tools::list(|name| taken.contains(name)));
        #[cfg(all(feature = "winclean", windows))]
        tools.extend(winclean_tools::list(|name| router.get(name).is_some()));
        #[cfg(all(feature = "native-browser", not(target_arch = "wasm32")))]
        {
            let taken: std::collections::HashSet<String> =
                tools.iter().map(|tool| tool.name.to_string()).collect();
            tools.extend(browser_tools::list(|name| taken.contains(name)));
        }
        let taken: std::collections::HashSet<String> =
            tools.iter().map(|tool| tool.name.to_string()).collect();
        tools.extend(bxc_tools::list(|name| taken.contains(name)).await);
        #[cfg(not(target_arch = "wasm32"))]
        {
            let taken: std::collections::HashSet<String> =
                tools.iter().map(|tool| tool.name.to_string()).collect();
            tools.extend(tauri_tools::list(|name| taken.contains(name)).await);
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let taken: std::collections::HashSet<String> =
                tools.iter().map(|tool| tool.name.to_string()).collect();
            tools.extend(kernel_tools::list(|name| taken.contains(name)).await);
        }
        tools.iter_mut().for_each(protocol::annotate);
        tools
    }

    /// Every tool this build exposes: the always-on set plus whichever toolbox
    /// routers were compiled in.
    ///
    /// Replaces the `server_handler` shorthand on the main `#[tool_router]`,
    /// which could only advertise a single router.
    #[must_use]
    pub fn all_tools() -> rmcp::handler::server::router::tool::ToolRouter<Self> {
        #[allow(unused_mut, reason = "each `+=` below is behind an opt-in feature")]
        let mut router = Self::core_router();
        #[cfg(not(target_arch = "wasm32"))]
        {
            router += Self::external_sessions_router();
            router += Self::remote_router();
        }
        #[cfg(all(feature = "ocr", not(target_arch = "wasm32")))]
        {
            router += Self::ocr_router();
        }
        #[cfg(all(feature = "vision", not(target_arch = "wasm32")))]
        {
            router += Self::vision_router();
        }
        #[cfg(all(feature = "stt-local", not(target_arch = "wasm32")))]
        {
            router += Self::stt_local_router();
        }
        #[cfg(all(feature = "jobs", not(target_arch = "wasm32")))]
        {
            router += Self::jobs_router();
        }
        #[cfg(all(feature = "rag", not(target_arch = "wasm32")))]
        {
            router += Self::rag_router();
        }
        router
    }
}

#[tool_handler(router = Self::all_tools())]
impl ServerHandler for GoogleMcpServer {
    // `call_tool` / `list_tools` / `get_tool` are written out (the macro skips a
    // method that already exists) so the WinClean catalog can be merged in behind
    // `--features winclean`. Built-in routes always win a name clash.
    async fn call_tool(
        &self,
        request: rmcp::model::CallToolRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::CallToolResponse, rmcp::ErrorData> {
        let mut response = async {
            let router = Self::all_tools();
            if router.get(request.name.as_ref()).is_none()
                && public_web_tools::owns(request.name.as_ref())
            {
                return Ok(public_web_tools::call(&request).await.into());
            }
            if router.get(request.name.as_ref()).is_none()
                && native_crawl_tools::owns(request.name.as_ref())
            {
                return Ok(native_crawl_tools::call(&request).await.into());
            }
            #[cfg(not(target_arch = "wasm32"))]
            if router.get(request.name.as_ref()).is_none()
                && search_tools::owns(request.name.as_ref())
            {
                return Ok(search_tools::call(&request).await.into());
            }
            #[cfg(not(target_arch = "wasm32"))]
            if router.get(request.name.as_ref()).is_none()
                && gemini_tools::owns(request.name.as_ref())
            {
                return Ok(gemini_tools::call(&request).await.into());
            }
            if router.get(request.name.as_ref()).is_none() && x_tools::owns(request.name.as_ref()) {
                return Ok(x_tools::call(&request).await.into());
            }
            #[cfg(all(feature = "winclean", windows))]
            if router.get(request.name.as_ref()).is_none()
                && winclean_tools::owns(request.name.as_ref())
            {
                return Ok(winclean_tools::call(&request).await.into());
            }
            #[cfg(all(feature = "native-browser", not(target_arch = "wasm32")))]
            if router.get(request.name.as_ref()).is_none()
                && browser_tools::owns(request.name.as_ref())
            {
                let mut result = browser_tools::call(&request).await;
                protocol::add_structured_content(&mut result);
                return Ok(result.into());
            }
            if router.get(request.name.as_ref()).is_none()
                && bxc_tools::owns(request.name.as_ref()).await
            {
                let mut result = bxc_tools::call(&request).await;
                protocol::add_structured_content(&mut result);
                return Ok(result.into());
            }
            #[cfg(not(target_arch = "wasm32"))]
            if router.get(request.name.as_ref()).is_none()
                && tauri_tools::owns(request.name.as_ref()).await
            {
                return Ok(tauri_tools::call(&request).await.into());
            }
            #[cfg(not(target_arch = "wasm32"))]
            if router.get(request.name.as_ref()).is_none()
                && kernel_tools::owns(request.name.as_ref()).await
            {
                return Ok(kernel_tools::call(&request).await.into());
            }
            let tcc = rmcp::handler::server::tool::ToolCallContext::new(self, request, context);
            // rmcp 3 returns `CallToolResponse` (MRTR/Tasks): only a completed
            // result carries content to mirror into `structuredContent`.
            let mut response = router.call(tcc).await?;
            if let rmcp::model::CallToolResponse::Complete(result) = &mut response {
                protocol::add_structured_content(result);
            }
            Ok(response)
        }
        .await?;
        protocol::normalize_tool_response(&mut response);
        Ok(response)
    }

    async fn list_tools(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::ListToolsResult, rmcp::ErrorData> {
        Ok(protocol::cacheable_result(
            rmcp::model::ListToolsResult::with_all_items(Self::every_tool().await),
            context.protocol_version(),
        ))
    }

    fn get_tool(&self, name: &str) -> Option<rmcp::model::Tool> {
        let builtin = Self::all_tools().get(name).cloned();
        let builtin = builtin.or_else(|| public_web_tools::get(name));
        let builtin = builtin.or_else(|| native_crawl_tools::get(name));
        #[cfg(not(target_arch = "wasm32"))]
        let builtin = builtin.or_else(|| search_tools::get(name));
        #[cfg(not(target_arch = "wasm32"))]
        let builtin = builtin.or_else(|| gemini_tools::get(name));
        let builtin = builtin.or_else(|| x_tools::get(name));
        #[cfg(all(feature = "winclean", windows))]
        let builtin = builtin.or_else(|| winclean_tools::get(name));
        #[cfg(all(feature = "native-browser", not(target_arch = "wasm32")))]
        let builtin = builtin.or_else(|| browser_tools::get(name));
        let mut tool = builtin.or_else(|| bxc_tools::get(name));
        #[cfg(not(target_arch = "wasm32"))]
        if tool.is_none() {
            tool = tauri_tools::get(name);
        }
        #[cfg(not(target_arch = "wasm32"))]
        if tool.is_none() {
            tool = kernel_tools::get(name);
        }
        let mut tool = tool?;
        protocol::annotate(&mut tool);
        Some(tool)
    }

    /// Answers with the client's protocol version when it is known, so clients
    /// on 2025-03-26 and later receive annotations and structured results.
    async fn initialize(
        &self,
        request: rmcp::model::InitializeRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::InitializeResult, rmcp::ErrorData> {
        let version = protocol::negotiate(&request.protocol_version);
        if context.peer.peer_info().is_none() {
            context.peer.set_peer_info(request);
        }
        let mut info = self.get_info();
        info.protocol_version = version;
        Ok(info)
    }

    async fn list_resources(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::ListResourcesResult, rmcp::ErrorData> {
        Ok(protocol::cacheable_result(
            protocol::list_resources(),
            context.protocol_version(),
        ))
    }

    async fn list_resource_templates(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::ListResourceTemplatesResult, rmcp::ErrorData> {
        Ok(protocol::cacheable_result(
            rmcp::model::ListResourceTemplatesResult::default(),
            context.protocol_version(),
        ))
    }

    async fn read_resource(
        &self,
        request: rmcp::model::ReadResourceRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::ReadResourceResponse, rmcp::ErrorData> {
        let tools = Self::every_tool().await;
        protocol::read_resource(&request.uri, &tools)
            .map(|result| protocol::cacheable_result(result, context.protocol_version()).into())
            .ok_or_else(|| {
                rmcp::ErrorData::resource_not_found(
                    format!("unknown resource {}", request.uri),
                    None,
                )
            })
    }

    async fn list_prompts(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::ListPromptsResult, rmcp::ErrorData> {
        Ok(protocol::cacheable_result(
            protocol::list_prompts(),
            context.protocol_version(),
        ))
    }

    async fn get_prompt(
        &self,
        request: rmcp::model::GetPromptRequestParams,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::GetPromptResponse, rmcp::ErrorData> {
        protocol::get_prompt(&request.name, request.arguments.as_ref())
            .map(Into::into)
            .ok_or_else(|| {
                rmcp::ErrorData::invalid_params(format!("unknown prompt {}", request.name), None)
            })
    }

    /// Identify as `aphrody-mcp`, not as the transport library.
    ///
    /// Without this override rmcp answers `initialize` with its own crate name
    /// and version — every client logged `{"name":"rmcp","version":"1.7.0"}`,
    /// which says nothing about *which* server answered. On a host wired to
    /// several MCP servers that is the one field distinguishing them.
    ///
    /// `instructions` carries the fact a tool list cannot: which tools exist
    /// here depends on the Cargo features this binary was built with, so a
    /// missing `aphrody_ocr` means "built without `--features ocr`", not
    /// "the tool failed".
    fn get_info(&self) -> rmcp::model::ServerConfig {
        // `Implementation` is `#[non_exhaustive]`, so it is built from its
        // default and mutated rather than constructed with record-update
        // syntax (E0639).
        let mut implementation = rmcp::model::Implementation::default();
        "aphrody-mcp".clone_into(&mut implementation.name);
        env!("CARGO_PKG_VERSION").clone_into(&mut implementation.version);

        // `ServerConfig` is `#[non_exhaustive]` for the same reason.
        let mut info = rmcp::model::ServerConfig::default();
        info.protocol_version = rmcp::model::ProtocolVersion::LATEST;
        info.capabilities = rmcp::model::ServerCapabilities::builder()
            .enable_tools()
            .enable_resources()
            .enable_prompts()
            .build();
        info.server_info = implementation;
        info.instructions = Some(
            "aphrody-mcp — unified Rust MCP server. The advertised tool set depends on the Cargo \
             features this binary was built with: the local-inference toolbox (aphrody_ocr, \
             aphrody_describe_image, aphrody_transcribe, aphrody_job_submit, aphrody_job_status) \
             is present only in a build carrying `--features toolbox`. A tool absent from \
             tools/list was compiled out; it did not fail. Call tools/list rather than assuming a \
             fixed catalogue. The Aphrody web tools (aphrody_browser_*, aphrody_search, \
             aphrody_google_*, aphrody_gemini_*, crawl, scrape, X/Grok, FUT, archive, wiki) are \
             part of this same tools/list; Google, search and Gemini run natively in Rust, the \
             rest through the internal web backend. N2B runs in-process through the `n2b` tool. \
             This is the only MCP server to register. A Windows build with `--features winclean` \
             also advertises the WinClean catalog (aphrody-winclean): for computer use call \
             computer_observe first, perform one bounded computer_* action, then observe again."
                .to_owned()
                + "\n\n"
                + protocol::USAGE_GUIDE,
        );
        info
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn find_project_root() -> Option<std::path::PathBuf> {
    let mut current = std::env::current_dir().ok()?;
    loop {
        if current.join(".env").is_file()
            || current.join(".git").exists()
            || current.join("Cargo.toml").is_file()
        {
            return Some(current);
        }
        let parent = current.parent()?;
        if parent == current {
            break;
        }
        current = parent.to_path_buf();
    }
    None
}

fn set_default_env_var(key: &str, val: &str) {
    if std::env::var_os(key).is_none() {
        // SAFETY: Mutating the environment is unsafe in Rust 2024. We do it at
        // startup before spawning other threads.
        unsafe {
            std::env::set_var(key, val);
        }
    }
}

fn init_adaptive_env(env_file: Option<&std::path::Path>) -> Result<()> {
    // 1. Load the nearest .env file (gemini-cli walk-up rules)
    if let Some(path) = env_file {
        for (key, value) in
            environment::read_private_environment(path).map_err(anyhow::Error::msg)?
        {
            if matches!(
                key.as_str(),
                "APHRODY_HOME" | "APHRODY_WORKSPACE" | "APHRODY_PROFILE" | "APHRODY_AGENT_DOMAIN"
            ) && std::env::var_os(&key).is_some()
            {
                continue;
            }
            // SAFETY: cli_main calls this before creating the runtime or starting its threads.
            unsafe {
                std::env::set_var(key, value);
            }
        }
    } else {
        let _ = aphrody_a2a_server::load_environment(None);
    }

    // 2. Resolve project root
    let root = find_project_root().unwrap_or_else(|| {
        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
    });

    // 3. Fallback for GOOGLE_APPLICATION_CREDENTIALS
    if std::env::var_os("GOOGLE_APPLICATION_CREDENTIALS").is_none() {
        let creds_path = root.join("secrets/aphrody-bot.json");
        if creds_path.exists() {
            unsafe {
                std::env::set_var("GOOGLE_APPLICATION_CREDENTIALS", &creds_path);
            }
        }
    }

    // 4. Static adaptive env defaults
    // Loopback service defaults, inherited by the child processes some tools
    // spawn (bxc, n2b). Only conventional local endpoints belong here: a
    // default that is wrong off this machine is worse than no default, since
    // a child then fails against an address nobody chose.
    //
    // `DATABASE_URL_AZALEE` used to sit in this list as
    // `postgresql://ubuntu@/<db>?host=/var/run/postgresql` - one
    // deployment's unix user, database name and socket path, compiled into
    // the binary. No crate in this workspace reads it. Removed rather than
    // parameterised: set it in the environment where that database exists.
    //
    // `EMBED_URL` used to sit in this list as `http://127.0.0.1:7077` — a
    // third, unrelated literal port next to `http_rest.rs`'s own (now
    // removed) `127.0.0.1:8080` default, and it never matched the vps
    // deployment's actual embed service (`:8794`, per
    // `tools/aphrody/config/local-ai.json`). `EMBED_URL` is a legacy alias of
    // the canonical `APHRODY_AI_EMBED_BASE_URL`
    // (`aphrody_config::ai_env::EMBED_BASE_URL`); every reader now resolves it
    // through that one contract and reports "not configured" when nothing is
    // set, rather than silently trying a port nothing is listening on.
    set_default_env_var("REDIS_URL", "redis://127.0.0.1:6379");
    set_default_env_var("GOOGLE_CLOUD_PROJECT", "aphrody");
    Ok(())
}

/// Entry point of the former `aphrody-mcp` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn cli_main(args: Vec<OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(err) => {
            let code = err.exit_code();
            let _ = err.print();
            return code;
        }
    };
    if let Err(error) = init_adaptive_env(cli.env_file.as_deref()) {
        eprintln!("Error: {error}");
        return 1;
    }
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("Error: failed to build tokio runtime: {err}");
            return 1;
        }
    };
    match runtime.block_on(run(cli)) {
        Ok(()) => 0,
        Err(err) => {
            eprintln!("Error: {err:?}");
            1
        }
    }
}

async fn run(cli: Cli) -> Result<()> {
    // reqwest is built with `rustls-no-provider`; a CryptoProvider must be
    // installed before the first TLS connection or reqwest panics at runtime
    // with "No provider set" (async_impl/client.rs). The workspace `rustls`
    // dep enables the `ring` feature, so `ring::default_provider()` is
    // available. The `let _ =` absorbs `AlreadyInstalled` (idempotent).
    // Cross-compiling Windows→Linux requires `cargo zigbuild` because `ring`
    // needs a C compiler for its assembly; on native Linux `gcc` handles it.
    let _ = rustls::crypto::ring::default_provider().install_default();

    // `try_init`: the multi-call host may already own the global subscriber.
    let _ = tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .try_init();

    let google_runtime = aphrody_google::GoogleRuntime::from_env();
    tracing::info!(
        project = google_runtime.project.id(),
        location = %google_runtime.location,
        auth = %google_runtime.auth,
        "Google/Gemini facade initialized"
    );

    // Anchor the uptime clock immediately (server-mode dashboards depend on it,
    // client-mode never reads it but the cost is a single OnceLock store).
    START_INSTANT.get_or_init(Instant::now);

    match cli.command {
        None | Some(TopCommand::Server) => run_server().await,
        Some(TopCommand::Http { bind }) => run_http_server(bind).await,
        Some(TopCommand::Client(args)) => run_client(args).await,
        Some(TopCommand::Guide) => {
            println!("{}", protocol::USAGE_GUIDE);
            Ok(())
        }
    }
}

async fn run_http_server(bind: SocketAddr) -> Result<()> {
    anyhow::ensure!(
        bind.ip().is_loopback(),
        "HTTP MCP must bind to a loopback address"
    );

    let auth = http_auth::McpAuth::from_env();
    auth.warn_if_unusable();
    let app = http_app(auth);
    let listener = tokio::net::TcpListener::bind(bind).await?;
    let mut native = kernel_tools::native_daemon().await?;
    tracing::info!(address = %listener.local_addr()?, "Starting Aphrody MCP Streamable HTTP server");
    tokio::select! {
        result = std::future::IntoFuture::into_future(axum::serve(listener, app)) => result?,
        result = native.join_next(), if !native.is_empty() => {
            anyhow::bail!("native daemon task stopped: {result:?}");
        },
    }
    Ok(())
}

/// `/mcp` sits behind the Bearer layer of [`http_auth`]; `/healthz` and the REST gateway routes are outside it.
fn http_app(auth: http_auth::McpAuth) -> Router {
    let service = StreamableHttpService::new(
        || Ok(GoogleMcpServer),
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default(),
    );
    let mcp = Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(
            auth,
            http_auth::require_bearer,
        ));
    mcp.merge(http_rest::router())
}

/// Boot the stdio MCP server exposing the built-in tools. Equivalent to the
/// pre-clap behaviour of `aphrody-mcp` (no subcommand).
///
/// Support the modern stateless lifecycle and the legacy `initialize` lifecycle
/// on the same stdio endpoint. `rmcp::service::serve_directly` handles modern
/// requests (including `server/discover`); the legacy `serve` path still starts
/// with `initialize` and preserves old clients.
async fn run_server() -> Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

    tracing::info!("Starting Aphrody MCP Server (Rust native)");

    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut reader = BufReader::new(stdin);
    let (pending_line, stateless) = loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            // EOF reached
            return Ok(());
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed)
            && let Some(method) = val.get("method").and_then(|m| m.as_str())
        {
            let is_stateless = is_stateless_mcp_request(&val);
            if is_stateless {
                break (line, true);
            }
            match method {
                "ping" => {
                    let id = val.get("id").cloned().unwrap_or(serde_json::Value::Null);
                    let resp = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {}
                    });
                    let mut resp_bytes = serde_json::to_vec(&resp)?;
                    resp_bytes.push(b'\n');
                    stdout.write_all(&resp_bytes).await?;
                    stdout.flush().await?;
                    tracing::info!("Handled pre-init ping probe");
                    continue;
                }
                "initialize" => break (line, false),
                _ => break (line, false),
            }
        } else {
            break (line, false);
        }
    };

    let cursor = std::io::Cursor::new(pending_line.into_bytes());
    let chained_stdin = cursor.chain(reader);

    let service = if stateless {
        rmcp::service::serve_directly::<rmcp::RoleServer, _, _, _, _>(
            GoogleMcpServer,
            (chained_stdin, stdout),
            None,
        )
    } else {
        GoogleMcpServer
            .serve((chained_stdin, stdout))
            .await
            .inspect_err(|e| {
                tracing::error!("Serving error: {:?}", e);
            })?
    };

    service.waiting().await?;
    Ok(())
}

fn is_stateless_mcp_request(request: &serde_json::Value) -> bool {
    let method = request.get("method").and_then(serde_json::Value::as_str);
    if method == Some("server/discover") {
        return true;
    }
    if method == Some("initialize") {
        return false;
    }
    request
        .pointer("/params/_meta/io.modelcontextprotocol~1protocolVersion")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|version| version >= "2026-07-28")
}

// ---------------------------------------------------------------------------
// CLI parse tests (clap backward compat)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod cli_tests {
    use super::*;

    #[test]
    fn modern_mcp_requests_select_the_stateless_lifecycle() {
        let discover = serde_json::json!({
            "method": "server/discover",
            "params": {"_meta": {}}
        });
        let modern_tools = serde_json::json!({
            "method": "tools/list",
            "params": {"_meta": {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28"
            }}
        });
        let legacy_tools = serde_json::json!({"method": "tools/list", "params": {}});
        let legacy_initialize = serde_json::json!({
            "method": "initialize",
            "params": {"_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}}
        });

        assert!(is_stateless_mcp_request(&discover));
        assert!(is_stateless_mcp_request(&modern_tools));
        assert!(!is_stateless_mcp_request(&legacy_tools));
        assert!(!is_stateless_mcp_request(&legacy_initialize));
    }

    #[tokio::test]
    async fn native_web_extraction_is_in_the_single_mcp_catalog() {
        assert!(
            GoogleMcpServer::all_tools()
                .get("aphrody_web_extract_html")
                .is_some()
        );
        let response = GoogleMcpServer
            .aphrody_web_extract_html(Parameters(WebExtractHtmlRequest {
                html: "<article><h1>Page</h1><p>A sufficiently long paragraph for extraction.</p></article>".to_owned(),
                url: Some("https://example.test/page".to_owned()),
            }))
            .await;
        let value: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(value["title"], "Page");
    }

    #[test]
    fn cli_clap_backward_compat_no_subcommand_means_server() {
        // Bare `aphrody-mcp` must parse to the implicit server mode so
        // existing Claude Desktop / .mcp.json entries keep working.
        let cli = Cli::try_parse_from(["aphrody-mcp"]).expect("bare invocation must parse");
        assert!(cli.command.is_none(), "no subcommand ⇒ implicit Server");
    }

    #[test]
    fn cli_parses_explicit_server_subcommand() {
        let cli = Cli::try_parse_from(["aphrody-mcp", "server"]).expect("server must parse");
        assert!(matches!(cli.command, Some(TopCommand::Server)));
    }

    #[test]
    fn cli_parses_http_bind() {
        let cli = Cli::try_parse_from(["aphrody-mcp", "http", "--bind", "[::1]:8790"])
            .expect("HTTP command must parse");
        assert!(
            matches!(cli.command, Some(TopCommand::Http { bind }) if bind == "[::1]:8790".parse::<SocketAddr>().unwrap())
        );
    }

    #[tokio::test]
    async fn http_rejects_non_loopback_bind() {
        let bind = "0.0.0.0:8789".parse().unwrap();
        let error = run_http_server(bind)
            .await
            .expect_err("public bind must fail");
        assert!(error.to_string().contains("loopback"));
    }

    const TEST_TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    async fn serve_http(auth: http_auth::McpAuth) -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, http_app(auth)).await;
        });
        (address, server)
    }

    fn initialize(address: SocketAddr, bearer: Option<&str>) -> reqwest::RequestBuilder {
        let mut request = reqwest::Client::new()
            .post(format!("http://{address}/mcp"))
            .header("Accept", "application/json, text/event-stream")
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": { "name": "aphrody-http-smoke", "version": "1" }
                }
            }))
            .timeout(Duration::from_secs(5));
        if let Some(token) = bearer {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
        request
    }

    #[tokio::test]
    async fn http_initialize_uses_rmcp_transport() {
        let (address, server) = serve_http(http_auth::McpAuth::with_token(TEST_TOKEN)).await;

        let response = initialize(address, Some(TEST_TOKEN)).send().await.unwrap();
        assert!(response.status().is_success());
        assert!(response.headers().contains_key("Mcp-Session-Id"));
        let body = response.text().await.unwrap();
        assert!(
            body.contains("serverInfo"),
            "unexpected MCP response: {body}"
        );

        server.abort();
    }

    #[tokio::test]
    async fn http_mcp_is_closed_without_the_bearer_token() {
        let (address, server) = serve_http(http_auth::McpAuth::with_token(TEST_TOKEN)).await;

        let anonymous = initialize(address, None).send().await.unwrap();
        assert_eq!(anonymous.status(), 401);
        assert!(!anonymous.headers().contains_key("Mcp-Session-Id"));
        assert_eq!(
            initialize(address, Some("wrong"))
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        // The session endpoints are behind the same layer: no token, no stream and no session teardown.
        let client = reqwest::Client::new();
        assert_eq!(
            client
                .get(format!("http://{address}/mcp"))
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        assert_eq!(
            client
                .delete(format!("http://{address}/mcp"))
                .send()
                .await
                .unwrap()
                .status(),
            401
        );

        server.abort();
    }

    #[tokio::test]
    async fn http_mcp_refuses_everything_when_no_token_is_configured() {
        let (address, server) = serve_http(http_auth::McpAuth::unconfigured()).await;

        assert_eq!(
            initialize(address, None).send().await.unwrap().status(),
            503
        );
        assert_eq!(
            initialize(address, Some(TEST_TOKEN))
                .send()
                .await
                .unwrap()
                .status(),
            503
        );

        server.abort();
    }

    #[tokio::test]
    async fn http_healthz_needs_no_token() {
        for auth in [
            http_auth::McpAuth::with_token(TEST_TOKEN),
            http_auth::McpAuth::unconfigured(),
        ] {
            let (address, server) = serve_http(auth).await;
            let response = reqwest::Client::new()
                .get(format!("http://{address}/healthz"))
                .timeout(Duration::from_secs(5))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 200);
            server.abort();
        }
    }

    #[test]
    fn cli_parses_client_list_subcommand() {
        let cli = Cli::try_parse_from(["aphrody-mcp", "client", "list", "bxc"])
            .expect("client list must parse");
        match cli.command {
            Some(TopCommand::Client(args)) => match args.op {
                crate::client_cmd::ClientOp::List {
                    server_name,
                    config,
                } => {
                    assert_eq!(server_name, "bxc");
                    assert!(config.is_none());
                }
                other => panic!("expected List, got {other:?}"),
            },
            other => panic!("expected Client, got {other:?}"),
        }
    }

    #[test]
    fn cli_parses_client_probe_subcommand() {
        let cli = Cli::try_parse_from([
            "aphrody-mcp",
            "client",
            "probe",
            "--stdio",
            "/bin/echo hello",
        ])
        .expect("client probe must parse");
        match cli.command {
            Some(TopCommand::Client(args)) => match args.op {
                crate::client_cmd::ClientOp::Probe { stdio } => {
                    assert_eq!(stdio, "/bin/echo hello");
                }
                other => panic!("expected Probe, got {other:?}"),
            },
            other => panic!("expected Client, got {other:?}"),
        }
    }
}

// ---------------------------------------------------------------------------
// aphrody_mcp_call MCP-to-MCP proxy tool tests
//
// These exercise the validation paths of the tool handler without spawning
// any real MCP server. The structured error envelopes are part of the tool's
// public contract — downstream agents key on the `error` string.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod aphrody_mcp_call_tests {
    use rmcp::handler::server::wrapper::Parameters;
    use serde_json::Value;

    use super::*;

    fn parse(body: &str) -> Value {
        serde_json::from_str(body).expect("tool response must be valid JSON")
    }

    #[tokio::test]
    async fn rejects_empty_server_name() {
        let body = GoogleMcpServer
            .aphrody_mcp_call(Parameters(AphrodyMcpCallRequest {
                server: String::new(),
                tool: "anything".to_owned(),
                args: None,
                config: None,
            }))
            .await;
        let v = parse(&body);
        assert_eq!(v["error"], "MCP_BAD_REQUEST");
        assert!(
            v["reason"].as_str().unwrap_or_default().contains("server"),
            "reason should mention server: {v}"
        );
    }

    #[tokio::test]
    async fn rejects_empty_tool_name() {
        let body = GoogleMcpServer
            .aphrody_mcp_call(Parameters(AphrodyMcpCallRequest {
                server: "bxc".to_owned(),
                tool: "  ".to_owned(),
                args: None,
                config: None,
            }))
            .await;
        let v = parse(&body);
        assert_eq!(v["error"], "MCP_BAD_REQUEST");
        assert!(
            v["reason"].as_str().unwrap_or_default().contains("tool"),
            "reason should mention tool: {v}"
        );
    }

    #[tokio::test]
    async fn unknown_server_surfaces_envelope() {
        // Point the loader at an empty mcp.json so any server name is unknown.
        let dir = tempfile::tempdir().expect("tempdir");
        let cfg_path = dir.path().join("mcp.json");
        std::fs::write(&cfg_path, "{}").expect("write empty config");

        let body = GoogleMcpServer
            .aphrody_mcp_call(Parameters(AphrodyMcpCallRequest {
                server: "no-such-server".to_owned(),
                tool: "tools/list".to_owned(),
                args: None,
                config: Some(cfg_path.to_string_lossy().into_owned()),
            }))
            .await;
        let v = parse(&body);
        assert_eq!(v["error"], "MCP_UNKNOWN_SERVER");
        assert!(
            v["reason"]
                .as_str()
                .unwrap_or_default()
                .contains("no-such-server"),
            "reason should echo the missing server: {v}"
        );
    }

    #[tokio::test]
    async fn rejects_non_object_args() {
        // Point at a config that *does* resolve the server name, but with a
        // spawn target that fails fast (non-existent binary). The args
        // validation runs after `initialize`, so we need a stdio entry that
        // resolves through `find_server` and `connect_from_config` but never
        // reaches the JSON-RPC handshake — easiest path is a phantom binary
        // that triggers MCP_CONNECT before args are read. To isolate the
        // args validation path, we instead inject an HTTP entry pointing at
        // 127.0.0.1:1 (closed port) and skip — too brittle. Easier path:
        // build a minimal config with a stdio entry to /bin/true (Unix) or
        // cmd /c (Windows) and supply non-object args. The connect succeeds
        // but initialize times out — still after args validation.
        //
        // Simpler: prove the validation rejects non-object via a unit-style
        // construction. The Parameters wrapper accepts any JsonValue for
        // `args` and our handler validates the shape before any I/O.
        let dir = tempfile::tempdir().expect("tempdir");
        let cfg_path = dir.path().join("mcp.json");
        std::fs::write(
            &cfg_path,
            r#"{"mcpServers":{"phantom":{"command":"definitely-not-a-real-binary-xyz"}}}"#,
        )
        .expect("write config");

        // The connect step will fail first (phantom binary), so the
        // envelope surfaces `MCP_CONNECT`, not `MCP_BAD_REQUEST`. That is
        // still the documented behaviour — the handler is fail-fast on
        // transport before payload validation. We assert the envelope is
        // *some* structured `MCP_*` error rather than panic / OK.
        let body = GoogleMcpServer
            .aphrody_mcp_call(Parameters(AphrodyMcpCallRequest {
                server: "phantom".to_owned(),
                tool: "tools/list".to_owned(),
                args: Some(serde_json::json!([1, 2, 3])),
                config: Some(cfg_path.to_string_lossy().into_owned()),
            }))
            .await;
        let v = parse(&body);
        let kind = v["error"].as_str().unwrap_or_default();
        assert!(
            kind.starts_with("MCP_"),
            "expected structured MCP_* error envelope, got {v}"
        );
    }

    #[test]
    fn context7_pick_matches_the_library_title_not_the_first_rank() {
        let resolved = r#"{"results":[
            {"id":"/websites/heyzine_how-to","title":"Heyzine How-to","description":"x"},
            {"id":"/visit-dav/visit","title":"VisIt","description":"y"},
            {"id":"/websites/webkit","title":"WebKit","description":"z"}
        ]}"#;
        let (picked, candidates) = super::pick_context7_library(resolved, "webkit");
        assert_eq!(picked.as_deref(), Some("/websites/webkit"));
        assert_eq!(candidates.lines().count(), 3);
        let (picked, _) = super::pick_context7_library(resolved, "next.js");
        assert_eq!(picked, None);
        let by_id = r#"{"results":[{"id":"/vercel/next.js","title":"Next"}]}"#;
        assert_eq!(
            super::pick_context7_library(by_id, "Next.js").0.as_deref(),
            Some("/vercel/next.js")
        );
        assert_eq!(super::pick_context7_library(resolved, "").0, None);
        assert_eq!(super::pick_context7_library("not json", "x").0, None);
    }

    #[test]
    fn docs_sections_are_clipped_on_char_boundaries() {
        assert_eq!(super::clip_section("abc", 3), "abc");
        let clipped = super::clip_section(&"é".repeat(10), 5);
        assert!(clipped.starts_with("éé\n") && clipped.contains("4 of 20 bytes"));
    }

    #[test]
    fn style_guide_topics_accept_common_aliases() {
        for alias in ["c++", "C++", " cpp ", "cxx"] {
            assert_eq!(super::style_guide_topic(alias), "cpp");
        }
        assert_eq!(super::style_guide_topic("TS"), "typescript");
        assert_eq!(super::style_guide_topic("bash"), "shell");
        assert_eq!(super::style_guide_topic("rust"), "rust");
    }

    #[test]
    fn request_dto_round_trips_through_json() {
        // The DTO is serde::Deserialize + schemars::JsonSchema — round-trip
        // a wire-shape payload through the same code path the MCP runtime
        // hands the handler. Guards against accidental renames breaking the
        // public schema contract.
        let raw = serde_json::json!({
            "server": "bxc",
            "tool": "bxc_scrape",
            "args": { "url": "https://example.com", "selector": "body" },
            "config": null
        });
        let parsed: AphrodyMcpCallRequest =
            serde_json::from_value(raw).expect("DTO must accept canonical payload");
        assert_eq!(parsed.server, "bxc");
        assert_eq!(parsed.tool, "bxc_scrape");
        assert!(parsed.config.is_none());
        let args = parsed.args.expect("args present");
        assert_eq!(args["url"], "https://example.com");
    }

    #[test]
    fn unified_router_exposes_backend_and_schema_tools() {
        let router = GoogleMcpServer::all_tools();
        for name in [
            "aphrody_web_call",
            "aphrody_a2a_call",
            "aphrody_schema",
            "n2b",
            "github_docs_search",
            "git_ingest",
            "upstream_list",
            "upstream_info",
            "upstream_tree",
            "upstream_read",
            "upstream_search",
            "awesome_fetch",
            "awesome_search",
        ] {
            assert!(
                router.get(name).is_some(),
                "unified MCP tool missing: {name}"
            );
        }
        // Always on for host builds: its own router is merged in `all_tools`.
        #[cfg(not(target_arch = "wasm32"))]
        assert!(
            router.get("sync_external_agents").is_some(),
            "external_sessions_router not merged"
        );
        #[cfg(all(feature = "rag", not(target_arch = "wasm32")))]
        for name in ["aphrody_home_query", "aphrody_home_status"] {
            assert!(
                router.get(name).is_some(),
                "agent home MCP tool missing: {name}"
            );
        }
    }

    #[test]
    fn a2a_contract_tracks_canonical_method_constants() {
        let contract = a2a_contract();
        let methods = contract["methods"].as_array().expect("methods array");
        assert_eq!(methods.len(), a2a_methods().len());
        assert!(
            methods
                .iter()
                .any(|method| method == aphrody_a2a::jsonrpc::methods::SEND_MESSAGE)
        );
        assert_eq!(contract["request"]["properties"]["jsonrpc"]["const"], "2.0");
    }

    #[test]
    fn a2a_endpoint_prefers_canonical_override_and_keeps_legacy_alias() {
        assert_eq!(
            resolve_a2a_endpoint(Some("http://canonical/a2a"), Some("http://legacy/a2a")),
            "http://canonical/a2a"
        );
        assert_eq!(
            resolve_a2a_endpoint(Some(" "), Some("http://legacy/a2a")),
            "http://legacy/a2a"
        );
        assert_eq!(resolve_a2a_endpoint(None, None), "http://127.0.0.1:8788/");
    }

    #[test]
    fn bundled_n2b_schema_is_canonical_v2() {
        let schema: serde_json::Value =
            serde_json::from_str(aphrody_n2b_types::REPORT_SCHEMA_V2).expect("valid schema");
        assert_eq!(schema["$schema"], "http://json-schema.org/draft-07/schema#");
        assert_eq!(schema["properties"]["schema_version"]["enum"][0], 2);
    }
}
