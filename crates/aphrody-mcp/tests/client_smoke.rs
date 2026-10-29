// SPDX-License-Identifier: Apache-2.0
//! End-to-end smoke tests for the `aphrody mcp-server client …` subcommand (former `aphrody-mcp`).
//!
//! These tests exercise the same code path the CLI dispatches into:
//!   1. Loader resolves a server entry from an in-tree `mcp.json` fixture.
//!   2. Stdio connect handles a missing command gracefully (no panic, typed error).
//!
//! Both rely on the `gemini-runtime` crate that `client_cmd.rs` itself uses,
//! ensuring the contract stays in sync.

use std::{collections::HashMap, process::Stdio};

use aphrody_gemini_runtime::{
    McpClient, McpError, McpTransportConfig, load_mcp_config, parse_mcp_config,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

/// Path of the workspace `aphrody` multi-call binary (the former `aphrody-mcp` binary is its
/// `mcp-server` subcommand). `APHRODY_BIN` overrides; otherwise it is the `aphrody` next to the
/// `deps/` directory of the current test executable (`target/<profile>/aphrody`), so build it
/// first with `scripts/aphrody/build/rust/cargo-serial.sh build -p aphrody`.
fn aphrody_bin() -> std::path::PathBuf {
    if let Some(path) = std::env::var_os("APHRODY_BIN") {
        return path.into();
    }
    let exe = std::env::current_exe().expect("current exe");
    let profile_dir = exe
        .parent()
        .and_then(std::path::Path::parent)
        .expect("target profile dir");
    let bin = profile_dir.join(format!("aphrody{}", std::env::consts::EXE_SUFFIX));
    assert!(
        bin.is_file(),
        "{} not found: build the `aphrody` binary (cargo build -p aphrody) or set APHRODY_BIN",
        bin.display()
    );
    bin
}

/// The loader must accept the Claude Desktop / `.mcp.json` shape and surface
/// the requested entry by name. This is the exact path `aphrody-mcp client
/// list <server-name>` walks before opening a transport.
#[test]
fn client_loader_resolves_server_from_mcp_json() {
    let fixture = r#"{
        "mcpServers": {
            "google_mcp": { "command": "aphrody-mcp", "args": [] },
            "bxc": {
                "type": "stdio",
                "command": "bxc",
                "args": ["serve", "--stdio"],
                "env": { "BXC_LOG": "info" }
            },
            "supabase": {
                "type": "http",
                "url": "https://mcp.example.org/v1/rpc",
                "headers": { "Authorization": "Bearer demo-token" }
            }
        }
    }"#;
    let cfg = parse_mcp_config(fixture).expect("fixture must parse");
    assert_eq!(cfg.servers.len(), 3, "three servers expected");

    // BTreeMap-driven alphabetical ordering.
    let bxc = cfg
        .servers
        .iter()
        .find(|s| s.name == "bxc")
        .expect("bxc present");
    match &bxc.transport {
        McpTransportConfig::Stdio { command, args, env } => {
            assert_eq!(command, "bxc");
            assert_eq!(args, &vec!["serve".to_owned(), "--stdio".to_owned()]);
            assert_eq!(env.get("BXC_LOG").map(String::as_str), Some("info"));
        }
        other => panic!("expected stdio for bxc, got {other:?}"),
    }

    let supa = cfg
        .servers
        .iter()
        .find(|s| s.name == "supabase")
        .expect("supabase present");
    match &supa.transport {
        McpTransportConfig::Http { url, headers } => {
            assert_eq!(url, "https://mcp.example.org/v1/rpc");
            assert!(headers.contains_key("Authorization"));
        }
        other => panic!("expected http for supabase, got {other:?}"),
    }

    // Round-trip via the filesystem loader: same fixture, same shape.
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("mcp.json");
    std::fs::write(&path, fixture).expect("write fixture");
    let cfg2 = load_mcp_config(&path).expect("load ok");
    assert_eq!(cfg2.servers.len(), 3);
    assert!(cfg2.servers.iter().any(|s| s.name == "google_mcp"));
}

/// Connecting to a non-existent stdio command must surface a typed
/// `McpError::Spawn` instead of panicking. This guarantees `aphrody-mcp
/// client probe --stdio <missing>` returns a clean exit-non-zero rather than
/// crashing the process.
#[tokio::test]
async fn client_probe_handles_missing_command_gracefully() {
    let env: HashMap<String, String> = HashMap::new();
    let bogus = "definitely-not-a-real-binary-xyz-aphrody-smoke";
    let result = McpClient::from_stdio(bogus, &[], &env).await;
    match result {
        Err(McpError::Spawn { command, .. }) => {
            assert_eq!(command, bogus, "command name must be echoed in error");
        }
        Err(other) => panic!("expected Spawn error, got {other:?}"),
        Ok(_) => panic!("phantom binary somehow spawned"),
    }
}

/// The loader must default to an empty config (not an error) when the target
/// file does not exist. Mirrors the behaviour of `aphrody-terminal-config`
/// and what `aphrody-mcp client list` relies on to print a useful diagnostic
/// (rather than crashing on a fresh install).
#[test]
fn client_loader_returns_empty_on_missing_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("nope.json");
    let cfg = load_mcp_config(&missing).expect("missing file → empty config");
    assert!(cfg.servers.is_empty());
}

/// The standard 2026 MCP lifecycle is stateless: discovery and tools/list both
/// carry their own protocol/client metadata and need no `initialize` request.
#[tokio::test]
async fn stateless_mcp_discovers_and_lists_the_full_shenron_catalog() {
    let mut child = Command::new(aphrody_bin())
        .arg("mcp-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn Aphrody MCP server");
    let mut stdin = child.stdin.take().expect("server stdin");
    let stdout = child.stdout.take().expect("server stdout");
    let mut lines = BufReader::new(stdout).lines();
    let request_meta = serde_json::json!({
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
            "name": "aphrody-mcp-smoke",
            "version": "1.0.0"
        },
        "io.modelcontextprotocol/clientCapabilities": {}
    });

    let discover = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "server/discover",
        "params": {"_meta": request_meta.clone()}
    });
    stdin
        .write_all(format!("{discover}\n").as_bytes())
        .await
        .expect("write discovery request");
    stdin.flush().await.expect("flush discovery request");
    let response = lines
        .next_line()
        .await
        .expect("read discovery response")
        .expect("response");
    let discovery: serde_json::Value = serde_json::from_str(&response).expect("valid JSON-RPC");
    assert_eq!(discovery["id"], 1);
    assert_eq!(discovery["result"]["resultType"], "complete");
    assert!(
        discovery["result"]["supportedVersions"]
            .as_array()
            .is_some_and(|versions| versions.iter().any(|version| version == "2026-07-28"))
    );
    assert_eq!(
        discovery["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]["name"],
        "aphrody-mcp"
    );

    let list = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {"_meta": request_meta}
    });
    stdin
        .write_all(format!("{list}\n").as_bytes())
        .await
        .expect("write stateless tools/list request");
    stdin
        .flush()
        .await
        .expect("flush stateless tools/list request");
    let response = lines
        .next_line()
        .await
        .expect("read tools/list response")
        .expect("response");
    let tools_response: serde_json::Value =
        serde_json::from_str(&response).expect("valid JSON-RPC");
    assert_eq!(tools_response["id"], 2);
    let tools = tools_response["result"]["tools"]
        .as_array()
        .expect("tools array");
    let names: Vec<_> = tools
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert!(!names.is_empty(), "stateless tools/list returned no tools");
    // The Dragon Ball tools are served by shenron-mcp (aphrody-labs/shenron), not this server.
    assert!(
        !names.iter().any(|name| name.starts_with("dragonball.")),
        "dragonball.* tools must not be served by aphrody-mcp"
    );
    for tool in tools {
        let name = tool["name"].as_str().unwrap_or_default();
        assert!(
            tool["inputSchema"].is_object(),
            "{name} must publish an object schema"
        );
    }

    let call = serde_json::json!({
        "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": {
            "_meta": request_meta,
            "name": "bun_docs_search",
            "arguments": {"query": "bun:sqlite", "limit": 1, "include_content": false}
        }
    });
    stdin
        .write_all(format!("{call}\n").as_bytes())
        .await
        .expect("write tool call");
    stdin.flush().await.expect("flush tool call");
    let response = lines
        .next_line()
        .await
        .expect("read tool result")
        .expect("response");
    let response: serde_json::Value = serde_json::from_str(&response).expect("tool JSON-RPC");
    assert_eq!(response["id"], 3);
    assert_eq!(response["result"]["resultType"], "complete");
    assert_eq!(response["result"]["isError"], false);
    assert!(response["result"]["content"].is_array());

    drop(stdin);
    child.kill().await.expect("stop Aphrody MCP server");
}
