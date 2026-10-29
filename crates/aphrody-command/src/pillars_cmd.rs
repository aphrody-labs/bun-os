// SPDX-License-Identifier: Apache-2.0
//! Canonical Pillar Command Drivers for the Root `aphrody` CLI.
//!
//! Provides top-level entry points for:
//! - `aphrody native` (host platform probes)
//! - `aphrody os` (OS subsystems & WinClean automation)
//! - `aphrody web` (shared Rust fetch, extraction and Obscura browser)
//! - `aphrody infra` (Infrastructure orchestration, SSH, VPN & nodes)
//! - `aphrody shell` (Nushell PTY session & Ratatui interface)

use aphrody_proc::NoWindow as _;
use clap::Subcommand;
use miette::{IntoDiagnostic, miette};

use std::time::Duration;

// --- 1. NATIVE PILLAR ---
#[derive(Debug, Subcommand)]
pub(crate) enum NativeAction {
    /// Diagnostic summary of host platform probes
    Status {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
    /// Check native topology and monotonic clock probes
    SelfTest,
}

pub(crate) fn handle_native(action: NativeAction) -> miette::Result<()> {
    match action {
        NativeAction::Status { json } => {
            let platform_status = aphrody_native::NativePlatform::status();
            let status = platform_status["status"].clone();

            let summary = serde_json::json!({
                "layer": "native",
                "status": status,
                "platform": platform_status,
            });

            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&summary).into_diagnostic()?
                );
            } else {
                println!("=== Aphrody Native Platform ===");
                let topology = &summary["platform"]["topology"];
                println!("  * CPUs: {}", topology["cpu_count"]);
                println!(
                    "  * Memory: {} MiB total, {} MiB available",
                    topology["memory_total_mb"], topology["memory_available_mb"]
                );
                println!("  * AVX2: {}", topology["has_avx2"]);
                println!("  * CUDA devices: {}", topology["cuda_device_count"]);
            }
        }
        NativeAction::SelfTest => {
            let clock_before = aphrody_native::NativePlatform::time_monotonic_ns();
            let topology = aphrody_native::NativePlatform::get_topology();
            let clock_after = aphrody_native::NativePlatform::time_monotonic_ns();
            if clock_after < clock_before {
                return Err(miette!("native monotonic clock moved backwards"));
            }
            if topology.cpu_count == 0 {
                return Err(miette!("native topology reported no available CPUs"));
            }
            if topology.memory_available_mb > topology.memory_total_mb {
                return Err(miette!(
                    "native topology reported more available memory than total memory"
                ));
            }
            if topology.has_cuda != (topology.cuda_device_count > 0) {
                return Err(miette!("native CUDA presence and device count disagree"));
            }
            println!(
                "Native probes passed: monotonic clock, {} CPU(s), {} MiB memory.",
                topology.cpu_count, topology.memory_total_mb
            );
        }
    }
    Ok(())
}

// --- 2. OS PILLAR ---
#[derive(Debug, Subcommand)]
pub(crate) enum OsAction {
    /// Inspect OS kernel status, active subsystems and diagnostics
    Status {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
    /// Run WinClean diagnostics on local Windows machine
    Doctor,
}

pub(crate) async fn handle_os(action: OsAction) -> miette::Result<()> {
    match action {
        OsAction::Status { json } => {
            let mut status = aphrody_diagnostics::os_status().await;
            merge_in_process_winclean(&mut status, in_process_winclean_tools());
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&status).into_diagnostic()?
                );
            } else {
                println!("=== Aphrody OS System Layer ===");
                println!(
                    "  * Kernel:            {}",
                    status["status"].as_str().unwrap_or("unavailable")
                );
                println!(
                    "  * Kernel Subsystems: {} observed",
                    status["subsystems"].as_array().map_or(0, Vec::len)
                );
                println!(
                    "  * WinClean Tools:    {} observed",
                    status["winclean_tools"].as_u64().unwrap_or(0)
                );
                println!("  * Process Isolation: not enforced by kernel");
            }
        }
        OsAction::Doctor => {
            let client = aphrody_diagnostics::os::os_client().await?;
            let snapshot = aphrody_diagnostics::os::os_snapshot(&client).await?;
            if snapshot["winclean_tools"].as_u64().unwrap_or(0) == 0 {
                return Err(miette!("kernel admin subsystem is unavailable"));
            }
            let result = client
                .request(
                    "tools/call",
                    serde_json::json!({"name":"get_os_info","arguments":{}}),
                    Duration::from_secs(10),
                )
                .await
                .into_diagnostic()?;
            if result["isError"] != false || !result["structuredContent"].is_object() {
                return Err(miette!("kernel get_os_info diagnostic failed"));
            }
            println!(
                "Kernel and WinClean OS inventory: healthy ({} tools observed).",
                snapshot["winclean_tools"]
            );
        }
    }
    Ok(())
}

/// Tools of the in-process `aphrody-winclean` runtime (the live list, else the vendored catalog).
fn in_process_winclean_tools() -> usize {
    aphrody_winclean::shared()
        .ok()
        .and_then(|wc| wc.list_tools().ok())
        .map_or_else(|| aphrody_winclean::catalog().len(), |tools| tools.len())
}

/// `aphrody winclean` runs in-process, so an offline kernel daemon must not hide its tools:
/// keep the larger of the kernel's admin tool count and the in-process count.
fn merge_in_process_winclean(status: &mut serde_json::Value, in_process: usize) {
    let kernel = status["winclean_tools"].as_u64().unwrap_or(0);
    let merged = kernel.max(in_process as u64);
    status["winclean_tools"] = serde_json::json!(merged);
    status["winclean_in_process"] = serde_json::json!(in_process);
}

#[cfg(test)]
mod os_status_tests {
    use super::*;

    #[test]
    fn offline_kernel_still_reports_in_process_winclean_tools() {
        let mut status = serde_json::json!({"status": "offline", "winclean_tools": 0});
        merge_in_process_winclean(&mut status, 166);
        assert_eq!(status["winclean_tools"], 166);
        assert_eq!(status["winclean_in_process"], 166);
        assert_eq!(status["status"], "offline");
    }

    #[test]
    fn larger_kernel_count_is_kept() {
        let mut status = serde_json::json!({"winclean_tools": 200});
        merge_in_process_winclean(&mut status, 166);
        assert_eq!(status["winclean_tools"], 200);
    }

    #[test]
    fn in_process_catalog_is_not_empty() {
        assert!(in_process_winclean_tools() > 0);
    }
}

#[path = "pillars_cmd/web.rs"]
pub(crate) mod web;
pub(crate) use web::{WebAction, handle_web};

// --- 4. INFRA PILLAR: `aphrody infra` is the aphrody-infra control plane (multicall.rs) ---

// --- 5. SHELL PILLAR ---
#[derive(Debug, Subcommand)]
pub(crate) enum ShellAction {
    /// Inspect Aphrody Shell capabilities (Nushell, Bun Shell through `bun exec`, PTY, TUI)
    Status {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
    /// Start interactive Nushell / Ratatui terminal session
    Start {
        /// Arguments passed to the shell engine
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Evaluate a command or pipeline (Nushell, or Bun Shell through `bun exec`)
    Eval {
        /// Shell code/pipeline to evaluate
        pipeline: String,
        /// Emit result as JSON
        #[arg(long)]
        json: bool,
        /// Run it with Bun Shell (`bun exec`) instead of Nushell
        #[arg(long)]
        bun: bool,
    },
    /// Run a command with Bun Shell (`bun exec`)
    Bun {
        /// Shell script or command to execute
        command: String,
        /// Emit result as JSON
        #[arg(long)]
        json: bool,
    },
    /// Run a command in a headless Aphrody Term PTY and print the settled screen
    Term {
        /// Command and arguments to run (without one, only the empty grid state is printed)
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Start the default shell in a headless Aphrody Term PTY, optionally send one action, print the screen
    ComputerUse {
        /// Optional action to dispatch: "type <text>" or "key <key>"
        #[arg(long)]
        action: Option<String>,
        /// Emit result as JSON
        #[arg(long)]
        json: bool,
    },
    /// Start the Aphrody Terminal Backend WebSocket server
    Serve {
        /// IP address to bind
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        /// Port to listen on
        #[arg(long, default_value_t = 8790)]
        port: u16,
    },
}

/// Runs `script` with Bun Shell (`bun exec`) in `root`; with `json`, prints `{exit_code, stdout, stderr, duration_ms}`.
/// Polls the screen until it stops changing for 300 ms (or `max` elapses).
fn settle_term(term: &aphrody_term::AphrodyTerm, max: Duration) {
    let deadline = std::time::Instant::now() + max;
    let mut last = term.scrape_text();
    let mut stable = 0;
    while stable < 3 && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
        let now = term.scrape_text();
        if now == last && !now.trim().is_empty() {
            stable += 1;
        } else {
            stable = 0;
            last = now;
        }
    }
}

fn bun_exec(script: &str, root: &std::path::Path, json: bool) -> miette::Result<()> {
    let bun = which::which("bun").unwrap_or_else(|_| std::path::PathBuf::from("bun"));
    let mut cmd = std::process::Command::new(&bun).no_window();
    cmd.arg("exec").arg(script).current_dir(root);
    if !json {
        let status = cmd
            .status()
            .map_err(|e| miette::miette!("Failed to launch bun exec: {}", e))?;
        if !status.success() {
            std::process::exit(status.code().unwrap_or(1));
        }
        return Ok(());
    }
    let started = std::time::Instant::now();
    let out = cmd
        .output()
        .map_err(|e| miette::miette!("Failed to launch bun exec: {}", e))?;
    let exit_code = out.status.code().unwrap_or(1);
    let report = serde_json::json!({
        "exit_code": exit_code,
        "stdout": String::from_utf8_lossy(&out.stdout),
        "stderr": String::from_utf8_lossy(&out.stderr),
        "duration_ms": started.elapsed().as_secs_f64() * 1000.0,
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&report).into_diagnostic()?
    );
    if exit_code != 0 {
        std::process::exit(exit_code);
    }
    Ok(())
}

pub(crate) fn handle_shell(action: ShellAction) -> miette::Result<()> {
    match action {
        ShellAction::Status { json } => {
            let status = serde_json::json!({
                "layer": "shell",
                "terminal_engine": "aphrody-term",
                "backend": "aphrody-terminal-backend",
                "tui": "not_wired",
                "engine": "nushell",
                "bun_shell": "Bun.$ (upstream Bun)",
                "status": "capabilities_declared_not_probed"
            });
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&status).into_diagnostic()?
                );
            } else {
                println!("=== Aphrody Shell & Terminal Environment ===");
                println!("  * Terminal:      aphrody-term");
                println!("  * Shell:         Nushell (eval, start)");
                println!("  * Bun Shell:     bun exec (shell bun, shell eval --bun)");
                println!("  * TUI:           Dashboard not wired");
                println!("  * PTY Bridge:    aphrody-terminal-backend (WebSocket/Local)");
            }
        }
        ShellAction::Start { args } => {
            let nu_path = which::which("nu").unwrap_or_else(|_| std::path::PathBuf::from("nu"));
            let mut cmd = std::process::Command::new(&nu_path).no_window();
            let root = std::env::var("APHRODY_ROOT")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| {
                    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
                });
            cmd.current_dir(&root);
            if !args.is_empty() {
                cmd.args(&args);
            }
            cmd.stdin(std::process::Stdio::inherit())
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::inherit());
            let mut child = cmd
                .spawn()
                .map_err(|e| miette::miette!("Failed to launch Aphrody shell: {}", e))?;
            let status = child
                .wait()
                .map_err(|e| miette::miette!("Shell session error: {}", e))?;
            if !status.success() {
                std::process::exit(status.code().unwrap_or(1));
            }
        }
        ShellAction::Eval {
            pipeline,
            json,
            bun,
        } => {
            let root = std::env::var("APHRODY_ROOT")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| {
                    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
                });

            if bun {
                return bun_exec(&pipeline, &root, json);
            }

            let nu_path = which::which("nu").unwrap_or_else(|_| std::path::PathBuf::from("nu"));
            let mut cmd = std::process::Command::new(&nu_path).no_window();
            let code = if json {
                format!("{} | to json", pipeline)
            } else {
                pipeline
            };
            cmd.arg("-c").arg(&code);
            cmd.current_dir(&root);
            cmd.stdin(std::process::Stdio::inherit())
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::inherit());
            let mut child = cmd
                .spawn()
                .map_err(|e| miette::miette!("Failed to launch Nushell eval: {}", e))?;
            let status = child
                .wait()
                .map_err(|e| miette::miette!("Shell eval error: {}", e))?;
            if !status.success() {
                std::process::exit(status.code().unwrap_or(1));
            }
        }
        ShellAction::Bun { command, json } => {
            let root = std::env::var("APHRODY_ROOT")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| {
                    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
                });

            bun_exec(&command, &root, json)?;
        }
        ShellAction::Term { args } => {
            let cols = 80;
            let rows = 24;
            let config = aphrody_term::TermConfig {
                cols,
                rows,
                ..Default::default()
            };
            let term = match args.split_first() {
                Some((program, rest)) => {
                    let rest: Vec<&str> = rest.iter().map(String::as_str).collect();
                    let term = aphrody_term::AphrodyTerm::spawn_pty(program, &rest, config)
                        .map_err(|e| miette!("cannot start {program} in a PTY: {e}"))?;
                    settle_term(&term, Duration::from_secs(10));
                    term
                }
                None => aphrody_term::AphrodyTerm::new(config),
            };
            let (col, row, visible) = term.cursor();
            println!("=== Aphrody Term {cols}x{rows} (cursor {col}:{row}, visible: {visible}) ===");
            println!("{}", term.scrape_text());
        }
        ShellAction::ComputerUse { action, json } => {
            let config = aphrody_term::TermConfig {
                cols: 80,
                rows: 24,
                ..Default::default()
            };
            #[cfg(windows)]
            let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
            #[cfg(not(windows))]
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
            let term = aphrody_term::AphrodyTerm::spawn_pty(&shell, &[], config)
                .map_err(|e| miette!("cannot start {shell} in a PTY: {e}"))?;
            settle_term(&term, Duration::from_secs(5));
            if let Some(ref act) = action {
                let action = if let Some(text) = act.strip_prefix("type ") {
                    aphrody_term::computer_use::ComputerAction::TypeText(text.to_string())
                } else if let Some(key) = act.strip_prefix("key ") {
                    aphrody_term::computer_use::ComputerAction::PressKey(key.to_string())
                } else {
                    return Err(miette!(
                        "unknown action {act:?}: expected \"type <text>\" or \"key <key>\""
                    ));
                };
                term.computer_use()
                    .dispatch_action(action)
                    .into_diagnostic()?;
                settle_term(&term, Duration::from_secs(5));
            }
            let text = term.scrape_text();
            let (col, row, visible) = term.cursor();
            if json {
                let out = serde_json::json!({
                    "cursor": { "col": col, "row": row, "visible": visible },
                    "screen": text,
                    "dirty_mask": format!("0x{:016x}", term.dirty_mask()),
                });
                println!("{}", serde_json::to_string_pretty(&out).into_diagnostic()?);
            } else {
                println!("=== Aphrody Computer-Use State ===");
                println!("Cursor: {}:{} (visible: {})", col, row, visible);
                println!("Dirty mask: 0x{:016x}", term.dirty_mask());
                println!("--- Screen Buffer ---");
                println!("{}", text);
            }
        }
        ShellAction::Serve { host, port } => {
            let addr: std::net::SocketAddr = format!("{}:{}", host, port)
                .parse()
                .map_err(|e| miette::miette!("Invalid socket address: {}", e))?;
            println!("Starting Aphrody Terminal Backend on ws://{}", addr);
            let runtime = tokio::runtime::Runtime::new()
                .map_err(|e| miette::miette!("Tokio runtime error: {}", e))?;
            runtime
                .block_on(async {
                    let cfg = aphrody_terminal_backend::PtyConfig::default().with_env_limits();
                    aphrody_terminal_backend::serve(addr, cfg).await
                })
                .map_err(|e| miette::miette!("Terminal server error: {}", e))?;
        }
    }
    Ok(())
}
