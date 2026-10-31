// SPDX-License-Identifier: Apache-2.0
//! CLI implementation for `aphrody codex …` and the multi-call `codex` command.
//!
//! Compatibility parser backed by Aphrody's native capability owners.
//! `exec`, `resume` and `fork` dispatch to the real Codex binary (CODEX_BIN, then the standalone install under
//! `~/.codex`, then PATH) so they use `~/.codex/config.toml` and its login; `agent` runs the Codex Luna sub-agent
//! dispatcher (factory/codex-agent). App-server transport and configuration inspection are implemented natively.
//! - App-server protocol v2 JSON-RPC daemon (`crates/ai/app-server`)
//! - Inspection of Windows elevation and configured model
//! - Read-only MCP, plugins, marketplaces and feature configuration
//! - Git patch application with an explicit file

use aphrody_proc::NoWindow as _;
use std::{net::SocketAddr, path::PathBuf, process::Command};

use clap::{Args, Subcommand};
use miette::Result;
use serde_json::json;

#[derive(Args, Debug, Clone)]
pub struct CodexArgs {
    #[command(subcommand)]
    pub action: Option<CodexSubcommand>,

    /// Optional prompt to start an interactive or non-interactive turn if no subcommand was given.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub prompt: Vec<String>,
}

#[derive(Subcommand, Debug, Clone)]
pub enum CodexSubcommand {
    /// Run Codex non-interactively (dispatches to the real Codex binary and ~/.codex/config.toml).
    #[command(alias = "e")]
    Exec(ExecArgs),
    /// Codex Luna sub-agents: `agent run|queue|status|roles|daemon|lint-sweep|doc-sync|gate-triage`.
    Agent {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Run the local app-server daemon (stdio JSON-RPC v2 or loopback HTTP).
    AppServer(AppServerArgs),
    /// Run a code review non-interactively on the current repository or diff.
    Review(ReviewArgs),
    /// Resume a previous session by id or --last.
    Resume(SessionArgs),
    /// Fork a previous session by id or --last.
    Fork(SessionArgs),
    /// Apply an explicit patch file to the local working tree.
    #[command(alias = "a")]
    Apply(ApplyArgs),
    /// Manage external Model Context Protocol (MCP) servers.
    Mcp {
        #[command(subcommand)]
        action: McpSubcommand,
    },
    /// Manage Codex plugins and configured marketplaces.
    Plugin {
        #[command(subcommand)]
        action: PluginSubcommand,
    },
    /// Diagnose local installation, elevation status, config, auth and runtime health.
    Doctor(DoctorArgs),
    /// Inspect or toggle feature flags.
    Features(FeaturesArgs),
}

#[derive(Args, Debug, Clone)]
pub struct ExecArgs {
    /// Prompt; when omitted the prompt is read from stdin.
    pub prompt: Option<String>,
    /// Model identifier to use (default: the model of ~/.codex/config.toml).
    #[arg(short = 'm', long)]
    pub model: Option<String>,
    /// Override a configuration key=value from config.toml.
    #[arg(short = 'c', long = "config")]
    pub config: Vec<String>,
    /// Sandbox policy (read-only, workspace-write, danger-full-access).
    #[arg(short = 's', long)]
    pub sandbox: Option<String>,
    /// Run without background daemon (mandatory in elevated Windows terminals).
    #[arg(long)]
    pub no_daemon: bool,
    /// Use open-source local provider.
    #[arg(long)]
    pub oss: bool,
    /// Working directory root.
    #[arg(short = 'C', long)]
    pub cd: Option<PathBuf>,
    /// Output structured JSON instead of human-readable text.
    #[arg(long)]
    pub json: bool,
    /// Reasoning effort level (low, medium, high, max).
    #[arg(long)]
    pub reasoning_effort: Option<String>,
}

#[derive(Args, Debug, Clone)]
pub struct AppServerArgs {
    /// Bind address for HTTP service (e.g. 127.0.0.1:8787).
    #[arg(long)]
    pub http: Option<SocketAddr>,
    /// Port for HTTP loopback service (defaults to 8787).
    #[arg(short, long)]
    pub port: Option<u16>,
    /// Run over standard I/O (JSON-RPC 2.0 dialect). Default if no HTTP address given.
    #[arg(long)]
    pub stdio: bool,
}

#[derive(Args, Debug, Clone)]
pub struct ReviewArgs {
    /// Review uncommitted git changes.
    #[arg(long)]
    pub uncommitted: bool,
    /// Git branch to compare against.
    #[arg(long)]
    pub branch: Option<String>,
    /// Specific commit to review.
    #[arg(long)]
    pub commit: Option<String>,
}

#[derive(Args, Debug, Clone)]
pub struct SessionArgs {
    /// Session ID.
    pub session_id: Option<String>,
    /// Continue or fork the most recent session.
    #[arg(long)]
    pub last: bool,
}

#[derive(Args, Debug, Clone)]
pub struct ApplyArgs {
    /// Patch file to apply via git apply.
    pub file: Option<PathBuf>,
}

#[derive(Subcommand, Debug, Clone)]
pub enum McpSubcommand {
    /// List configured MCP servers.
    List {
        #[arg(long)]
        json: bool,
    },
    /// Get details for a configured MCP server.
    Get { name: String },
    /// Add an external MCP server to config.toml.
    Add {
        name: String,
        #[arg(long)]
        url: Option<String>,
        #[arg(trailing_var_arg = true)]
        command: Vec<String>,
    },
    /// Remove an external MCP server from config.toml.
    Remove { name: String },
}

#[derive(Subcommand, Debug, Clone)]
pub enum PluginSubcommand {
    /// List plugins available and installed from configured marketplaces.
    List {
        #[arg(long)]
        json: bool,
    },
    /// Manage configured plugin marketplaces.
    Marketplace {
        #[command(subcommand)]
        action: MarketplaceSubcommand,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub enum MarketplaceSubcommand {
    /// List configured plugin marketplaces.
    List {
        #[arg(long)]
        json: bool,
    },
}

#[derive(Args, Debug, Clone)]
pub struct DoctorArgs {
    /// Output diagnostics as structured JSON.
    #[arg(long)]
    pub json: bool,
}

#[derive(Args, Debug, Clone)]
pub struct FeaturesArgs {
    /// List all feature flags and their current state.
    #[arg(long)]
    pub list: bool,
    /// Enable a feature flag.
    #[arg(long)]
    pub enable: Option<String>,
    /// Disable a feature flag.
    #[arg(long)]
    pub disable: Option<String>,
}

/// Helper to detect if running in an elevated Windows shell.
#[cfg(windows)]
pub fn is_windows_elevated() -> bool {
    Command::new("net")
        .no_window()
        .arg("session")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub fn is_windows_elevated() -> bool {
    false
}

fn codex_config_path() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CODEX_HOME") {
        let p = PathBuf::from(dir).join("config.toml");
        if p.exists() {
            return Some(p);
        }
    }
    let home = if cfg!(windows) {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    } else {
        std::env::var("HOME").ok().map(PathBuf::from)
    };
    home.map(|h| h.join(".codex").join("config.toml"))
        .filter(|p| p.exists())
}

/// Main execution entry point for `aphrody codex …`.
pub async fn run(args: CodexArgs) -> Result<()> {
    match args.action {
        Some(CodexSubcommand::AppServer(app_args)) => run_app_server(app_args).await,
        Some(CodexSubcommand::Doctor(doc_args)) => run_doctor(doc_args).await,
        Some(CodexSubcommand::Exec(exec_args)) => run_exec(exec_args).await,
        Some(CodexSubcommand::Agent { args }) => run_agent(args),
        Some(CodexSubcommand::Review(review_args)) => run_review(review_args).await,
        Some(CodexSubcommand::Resume(session_args)) => run_resume(session_args).await,
        Some(CodexSubcommand::Fork(session_args)) => run_fork(session_args).await,
        Some(CodexSubcommand::Apply(apply_args)) => run_apply(apply_args).await,
        Some(CodexSubcommand::Mcp { action }) => run_mcp(action).await,
        Some(CodexSubcommand::Plugin { action }) => run_plugin(action).await,
        Some(CodexSubcommand::Features(feat_args)) => run_features(feat_args).await,
        None => {
            if !args.prompt.is_empty() {
                let prompt = args.prompt.join(" ");
                run_exec(ExecArgs {
                    prompt: Some(prompt),
                    model: None,
                    config: Vec::new(),
                    sandbox: None,
                    no_daemon: false,
                    oss: false,
                    cd: None,
                    json: false,
                    reasoning_effort: None,
                })
                .await
            } else {
                run_exec(ExecArgs {
                    prompt: None,
                    model: None,
                    config: Vec::new(),
                    sandbox: None,
                    no_daemon: false,
                    oss: false,
                    cd: None,
                    json: false,
                    reasoning_effort: None,
                })
                .await
            }
        }
    }
}

async fn run_app_server(args: AppServerArgs) -> Result<()> {
    if let Some(http_addr) = args.http {
        println!("Starting Aphrody Codex App-Server HTTP listener on {http_addr}...");
        aphrody_app_server::serve_http(http_addr)
            .await
            .map_err(|e| miette::miette!("app-server http failed: {e}"))?;
    } else if let Some(port) = args.port {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        println!("Starting Aphrody Codex App-Server HTTP listener on {addr}...");
        aphrody_app_server::serve_http(addr)
            .await
            .map_err(|e| miette::miette!("app-server http failed: {e}"))?;
    } else {
        // Default: stdio JSON-RPC v2 server loop
        let stdin = tokio::io::BufReader::new(tokio::io::stdin());
        let stdout = tokio::io::stdout();
        aphrody_app_server::serve_stdio(stdin, stdout)
            .await
            .map_err(|e| miette::miette!("app-server stdio failed: {e}"))?;
    }
    Ok(())
}

async fn run_doctor(args: DoctorArgs) -> Result<()> {
    let elevated = is_windows_elevated();
    let config_path = codex_config_path();

    let mut model_found: Option<String> = None;
    let mut effort_found: Option<String> = None;
    let mut plugins_count = 0;
    let mut mcp_count = 0;

    if let Some(ref p) = config_path
        && let Ok(content) = std::fs::read_to_string(p)
        && let Ok(doc) = content.parse::<toml::Value>()
    {
        if let Some(m) = doc.get("model").and_then(|v| v.as_str()) {
            model_found = Some(m.to_string());
        }
        if let Some(e) = doc.get("model_reasoning_effort").and_then(|v| v.as_str()) {
            effort_found = Some(e.to_string());
        }
        if let Some(plugins) = doc.get("plugins").and_then(|v| v.as_table()) {
            plugins_count = plugins.len();
        }
        if let Some(mcp) = doc.get("mcp_servers").and_then(|v| v.as_table()) {
            mcp_count = mcp.len();
        }
    }

    let bin = codex_bin();
    let version = bin.as_ref().and_then(|b| first_line(b, &["--version"]));
    let login = bin
        .as_ref()
        .and_then(|b| first_line(b, &["login", "status"]));
    let (ws_addr, ws_ready) = app_server_probe();
    let execution = if bin.is_some() {
        "codex_binary"
    } else {
        "not_wired"
    };

    if args.json {
        let report = json!({
            "service": "aphrody-agent",
            "windows_elevated": elevated,
            "config_path": config_path.map(|p| p.display().to_string()),
            "configured_model": model_found,
            "configured_plugins_count": plugins_count,
            "configured_mcp_count": mcp_count,
            "app_server": "Pure v2 JSON-RPC (crates/contracts/app-protocol)",
            "reasoning_effort": effort_found,
            "codex_bin": bin.as_ref().map(|p| p.display().to_string()),
            "codex_version": version,
            "login": login,
            "app_server_ws": { "addr": ws_addr, "ready": ws_ready },
            "agent_execution": execution,
            "status": if bin.is_some() { "ready" } else { "codex_binary_missing" }
        });
        println!("{report}");
    } else {
        println!("=== Aphrody Local Agent Doctor ===");
        println!(
            "Status               : {}",
            if bin.is_some() {
                "ready (exec dispatches to the Codex binary)"
            } else {
                "Codex binary not found"
            }
        );
        println!(
            "Windows Elevated     : {}",
            if elevated {
                "Yes"
            } else {
                "No (standard user)"
            }
        );
        println!(
            "Config Path          : {}",
            config_path
                .as_deref()
                .map_or("Not found", |p| p.to_str().unwrap_or(""))
        );
        println!(
            "Configured Model     : {}",
            model_found.as_deref().unwrap_or("not configured")
        );
        println!("Configured Plugins   : {} enabled", plugins_count);
        println!("Configured MCP       : {} servers", mcp_count);
        println!("App-Server Protocol  : Pure v2 JSON-RPC (crates/contracts/app-protocol)");
        println!(
            "Reasoning Effort     : {}",
            effort_found.as_deref().unwrap_or("not configured")
        );
        println!(
            "Codex Binary         : {} ({})",
            bin.as_deref()
                .map_or("not found", |p| p.to_str().unwrap_or("")),
            version.as_deref().unwrap_or("unknown version")
        );
        println!(
            "Login                : {}",
            login.as_deref().unwrap_or("unknown")
        );
        println!(
            "Codex App-Server     : ws://{ws_addr} ({})",
            if ws_ready { "ready" } else { "not reachable" }
        );
        println!("Execution Runtime    : {execution}");
    }
    Ok(())
}

/// The real Codex binary: CODEX_BIN, the standalone install under CODEX_HOME (default ~/.codex), then PATH. Never this
/// executable itself (the multi-call `codex` name would loop).
pub fn codex_bin() -> Option<PathBuf> {
    let me = std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok());
    let exe = if cfg!(windows) { "codex.exe" } else { "codex" };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = std::env::var_os("CODEX_BIN") {
        candidates.push(PathBuf::from(p));
    }
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            let user = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
            std::env::var_os(user).map(|h| PathBuf::from(h).join(".codex"))
        });
    if let Some(h) = home {
        candidates.push(h.join("packages/standalone/current/bin").join(exe));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|d| d.join(exe)));
    }
    candidates
        .into_iter()
        .find(|p| p.is_file() && p.canonicalize().ok() != me)
}

fn first_line(bin: &std::path::Path, args: &[&str]) -> Option<String> {
    let out = Command::new(bin).no_window().args(args).output().ok()?;
    let text = String::from_utf8_lossy(if out.stdout.is_empty() {
        &out.stderr
    } else {
        &out.stdout
    })
    .to_string();
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_string)
}

/// Probe the Codex app-server service (aphrody-codex-app-server.service) on loopback; `CODEX_APP_SERVER_ADDR` overrides it.
fn app_server_probe() -> (String, bool) {
    use std::io::{Read, Write};
    let addr =
        std::env::var("CODEX_APP_SERVER_ADDR").unwrap_or_else(|_| "127.0.0.1:4500".to_string());
    let ready = addr
        .parse::<SocketAddr>()
        .ok()
        .and_then(|a| {
            std::net::TcpStream::connect_timeout(&a, std::time::Duration::from_millis(500)).ok()
        })
        .map(|mut s| {
            let _ = s.set_read_timeout(Some(std::time::Duration::from_millis(1500)));
            let _ = s
                .write_all(b"GET /readyz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
            let mut buf = String::new();
            let _ = s.read_to_string(&mut buf);
            buf.starts_with("HTTP/1.1 200")
        })
        .unwrap_or(false);
    (addr, ready)
}

fn dispatch_codex(mut cmd: Command) -> Result<()> {
    let status = cmd
        .status()
        .map_err(|e| miette::miette!("failed to run the Codex binary: {e}"))?;
    if !status.success() {
        std::process::exit(status.code().unwrap_or(1));
    }
    Ok(())
}

fn require_codex() -> Result<Command> {
    let bin = codex_bin().ok_or_else(|| {
        miette::miette!(
            "Codex binary not found (set CODEX_BIN or install it under ~/.codex/packages/standalone/current/bin)"
        )
    })?;
    Ok(Command::new(bin).no_window())
}

async fn run_exec(args: ExecArgs) -> Result<()> {
    let mut cmd = require_codex()?;
    cmd.arg("exec");
    if let Some(m) = &args.model {
        cmd.args(["-m", m]);
    }
    if let Some(e) = &args.reasoning_effort {
        cmd.arg("-c").arg(format!("model_reasoning_effort=\"{e}\""));
    }
    for c in &args.config {
        cmd.args(["-c", c]);
    }
    if let Some(s) = &args.sandbox {
        cmd.args(["-s", s]);
    }
    if args.oss {
        cmd.arg("--oss");
    }
    if let Some(d) = &args.cd {
        cmd.arg("-C").arg(d);
    }
    if args.json {
        cmd.arg("--json");
    }
    cmd.arg(args.prompt.as_deref().unwrap_or("-"));
    dispatch_codex(cmd)
}

/// `aphrody codex agent …`: the Codex Luna sub-agent dispatcher (factory/codex-agent/dispatch.ts) on Bun.
fn run_agent(args: Vec<String>) -> Result<()> {
    let script = std::env::var_os("BUNOS_REPO")
        .map(PathBuf::from)
        .into_iter()
        .chain(
            std::env::current_dir()
                .ok()
                .into_iter()
                .flat_map(|d| d.ancestors().map(PathBuf::from).collect::<Vec<_>>()),
        )
        .chain(std::env::var_os("HOME").map(|h| PathBuf::from(h).join("src/bun-os")))
        .map(|r| r.join("factory/codex-agent/dispatch.ts"))
        .find(|p| p.is_file())
        .ok_or_else(|| {
            miette::miette!("factory/codex-agent/dispatch.ts not found; set BUNOS_REPO")
        })?;
    let bun = std::env::var_os("BUN").unwrap_or_else(|| "bun".into());
    let mut cmd = Command::new(bun).no_window();
    cmd.arg(script).args(args);
    dispatch_codex(cmd)
}

async fn run_review(args: ReviewArgs) -> Result<()> {
    println!("=== Git diff summary (no automated code review) ===");
    let mut cmd = Command::new("git").no_window();
    cmd.args(["diff", "--stat"]);
    if let Some(ref b) = args.branch {
        cmd.arg(b);
    }
    if let Some(ref c) = args.commit {
        cmd.arg(c);
    }
    let output = cmd.output().map_err(|e| miette::miette!("git diff: {e}"))?;
    if !output.status.success() {
        return Err(miette::miette!(
            "git diff failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    if !output.stdout.is_empty() {
        println!("{}", String::from_utf8_lossy(&output.stdout));
    } else {
        println!("No changes detected for review.");
    }
    Ok(())
}

async fn run_resume(args: SessionArgs) -> Result<()> {
    let mut cmd = require_codex()?;
    cmd.arg("resume");
    if let Some(id) = &args.session_id {
        cmd.arg(id);
    }
    if args.last {
        cmd.arg("--last");
    }
    dispatch_codex(cmd)
}

async fn run_fork(args: SessionArgs) -> Result<()> {
    let mut cmd = require_codex()?;
    cmd.arg("fork");
    if let Some(id) = &args.session_id {
        cmd.arg(id);
    }
    if args.last {
        cmd.arg("--last");
    }
    dispatch_codex(cmd)
}

async fn run_apply(args: ApplyArgs) -> Result<()> {
    if let Some(ref f) = args.file {
        println!("Applying diff from {} to working tree...", f.display());
        let status = Command::new("git")
            .no_window()
            .args(["apply"])
            .arg(f)
            .status()
            .map_err(|e| miette::miette!("git apply: {e}"))?;
        if !status.success() {
            return Err(miette::miette!("git apply failed"));
        }
        println!("Diff applied successfully.");
    } else {
        return Err(miette::miette!(
            "A patch file is required; no implicit latest patch store is wired and no patch was applied."
        ));
    }
    Ok(())
}

async fn run_mcp(action: McpSubcommand) -> Result<()> {
    match action {
        McpSubcommand::List { json } => {
            let config_path = codex_config_path();
            if let Some(ref p) = config_path
                && let Ok(content) = std::fs::read_to_string(p)
                && let Ok(doc) = content.parse::<toml::Value>()
                && let Some(mcp) = doc.get("mcp_servers").and_then(|v| v.as_table())
            {
                if json {
                    println!("{}", serde_json::to_string_pretty(&mcp).unwrap());
                } else {
                    println!("NAME                  STATUS      TARGET");
                    for (k, v) in mcp {
                        let enabled = v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true);
                        let target = v
                            .get("url")
                            .and_then(|u| u.as_str())
                            .or_else(|| v.get("command").and_then(|c| c.as_str()))
                            .unwrap_or("-");
                        println!(
                            "{:<22} {:<11} {}",
                            k,
                            if enabled { "enabled" } else { "disabled" },
                            target
                        );
                    }
                }
                return Ok(());
            }
            println!("No MCP servers found in configuration.");
        }
        McpSubcommand::Get { name } => {
            return Err(miette::miette!(
                "MCP detail lookup is not wired by this compatibility command: {name}"
            ));
        }
        McpSubcommand::Add {
            name,
            url: _url,
            command: _command,
        } => {
            return Err(miette::miette!(
                "MCP configuration mutation is not wired by this compatibility command; server '{name}' was not added."
            ));
        }
        McpSubcommand::Remove { name } => {
            return Err(miette::miette!(
                "MCP configuration mutation is not wired by this compatibility command; server '{name}' was not removed."
            ));
        }
    }
    Ok(())
}

async fn run_plugin(action: PluginSubcommand) -> Result<()> {
    match action {
        PluginSubcommand::List { json } => {
            let config_path = codex_config_path();
            if let Some(ref p) = config_path
                && let Ok(content) = std::fs::read_to_string(p)
                && let Ok(doc) = content.parse::<toml::Value>()
                && let Some(plugins) = doc.get("plugins").and_then(|v| v.as_table())
            {
                if json {
                    println!("{}", serde_json::to_string_pretty(&plugins).unwrap());
                } else {
                    println!("PLUGIN                                                  STATUS");
                    for (k, v) in plugins {
                        let enabled = v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true);
                        println!(
                            "{:<55} {}",
                            k,
                            if enabled {
                                "installed, enabled"
                            } else {
                                "installed, disabled"
                            }
                        );
                    }
                }
                return Ok(());
            }
            println!("No plugins found in configuration.");
        }
        PluginSubcommand::Marketplace { action } => match action {
            MarketplaceSubcommand::List { json } => {
                let config_path = codex_config_path();
                if let Some(ref p) = config_path
                    && let Ok(content) = std::fs::read_to_string(p)
                    && let Ok(doc) = content.parse::<toml::Value>()
                    && let Some(mkts) = doc.get("marketplaces").and_then(|v| v.as_table())
                {
                    if json {
                        println!("{}", serde_json::to_string_pretty(&mkts).unwrap());
                    } else {
                        println!("MARKETPLACE             ROOT");
                        for (k, v) in mkts {
                            let src = v.get("source").and_then(|s| s.as_str()).unwrap_or("-");
                            println!("{:<24} {}", k, src);
                        }
                    }
                    return Ok(());
                }
            }
        },
    }
    Ok(())
}

async fn run_features(args: FeaturesArgs) -> Result<()> {
    if args.enable.is_some() || args.disable.is_some() {
        return Err(miette::miette!(
            "Feature flag mutation is not wired by this command; configuration was not changed."
        ));
    }
    let config_path = codex_config_path();
    if let Some(ref p) = config_path
        && let Ok(content) = std::fs::read_to_string(p)
        && let Ok(doc) = content.parse::<toml::Value>()
        && let Some(features) = doc.get("features").and_then(|v| v.as_table())
    {
        println!("FEATURE                                 STATE");
        for (k, v) in features {
            let state = v.as_bool().unwrap_or(false);
            println!("{:<40} {}", k, if state { "enabled" } else { "disabled" });
        }
        return Ok(());
    }
    println!("No feature flags found in configuration.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser, Debug)]
    struct TestCli {
        #[command(subcommand)]
        command: TestCommands,
    }

    #[derive(Subcommand, Debug)]
    enum TestCommands {
        Codex(CodexArgs),
    }

    #[test]
    fn test_elevation_check_succeeds_without_panic() {
        let _ = is_windows_elevated();
    }

    #[test]
    fn test_cli_parser_codex_exec() {
        let cli = TestCli::parse_from([
            "test",
            "codex",
            "exec",
            "ping",
            "-m",
            "gpt-6-sol",
            "--no-daemon",
        ]);
        match cli.command {
            TestCommands::Codex(args) => match args.action {
                Some(CodexSubcommand::Exec(e)) => {
                    assert_eq!(e.prompt.as_deref(), Some("ping"));
                    assert_eq!(e.model.as_deref(), Some("gpt-6-sol"));
                    assert!(e.no_daemon);
                }
                _ => panic!("expected Exec subcommand"),
            },
        }
    }

    #[test]
    fn test_cli_parser_codex_app_server() {
        let cli = TestCli::parse_from(["test", "codex", "app-server", "--port", "8799"]);
        match cli.command {
            TestCommands::Codex(args) => match args.action {
                Some(CodexSubcommand::AppServer(s)) => {
                    assert_eq!(s.port, Some(8799));
                }
                _ => panic!("expected AppServer subcommand"),
            },
        }
    }

    #[test]
    fn test_cli_parser_codex_doctor() {
        let cli = TestCli::parse_from(["test", "codex", "doctor", "--json"]);
        match cli.command {
            TestCommands::Codex(args) => match args.action {
                Some(CodexSubcommand::Doctor(d)) => {
                    assert!(d.json);
                }
                _ => panic!("expected Doctor subcommand"),
            },
        }
    }

    #[test]
    fn test_cli_parser_codex_mcp_and_plugins() {
        let cli_mcp = TestCli::parse_from(["test", "codex", "mcp", "list"]);
        match cli_mcp.command {
            TestCommands::Codex(args) => match args.action {
                Some(CodexSubcommand::Mcp {
                    action: McpSubcommand::List { json: false },
                }) => {}
                _ => panic!("expected Mcp::List subcommand"),
            },
        }

        let cli_plug = TestCli::parse_from(["test", "codex", "plugin", "list"]);
        match cli_plug.command {
            TestCommands::Codex(args) => match args.action {
                Some(CodexSubcommand::Plugin {
                    action: PluginSubcommand::List { json: false },
                }) => {}
                _ => panic!("expected Plugin::List subcommand"),
            },
        }
    }

    #[tokio::test]
    async fn test_doctor_execution() {
        let res = run_doctor(DoctorArgs { json: true }).await;
        assert!(res.is_ok(), "doctor should execute without error");
    }

    #[tokio::test]
    async fn unsupported_execution_and_mutations_do_not_report_success() {
        for argv in [
            vec!["test", "codex", "apply"],
            vec!["test", "codex", "mcp", "add", "audit-test"],
            vec!["test", "codex", "mcp", "remove", "audit-test"],
            vec!["test", "codex", "features", "--enable", "audit-test"],
        ] {
            let TestCommands::Codex(args) = TestCli::parse_from(argv.clone()).command;
            assert!(
                run(args).await.is_err(),
                "unsupported request must fail: {argv:?}"
            );
        }
    }
}
