// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

#[test]
fn stdio_transport_parses() {
    let toml_str = r#"
        command = "aphrody-mcp"
        args = ["--stdio"]
        env = { RUST_LOG = "info" }
        cwd = "../aphrody-ai"
        enabled_tools = ["rag_search"]
    "#;
    let cfg: McpServerConfig = toml::from_str(toml_str).expect("parse stdio server");
    match cfg.transport {
        McpServerTransportConfig::Stdio {
            command,
            args,
            env,
            cwd,
        } => {
            assert_eq!(command, "aphrody-mcp");
            assert_eq!(args, vec!["--stdio".to_string()]);
            assert_eq!(env.unwrap()["RUST_LOG"], "info");
            assert_eq!(cwd.as_deref(), Some("../aphrody-ai"));
        }
        McpServerTransportConfig::StreamableHttp { .. } => panic!("expected stdio"),
    }
    assert!(cfg.enabled);
    assert_eq!(cfg.enabled_tools, Some(vec!["rag_search".to_string()]));
}

#[test]
fn streamable_http_transport_parses() {
    let toml_str = r#"
        url = "https://mcp.example.com/mcp"
        bearer_token_env_var = "DOCS_MCP_TOKEN"
        enabled = false
        tool_timeout_sec = 30
        disabled_tools = ["dangerous_tool"]
    "#;
    let cfg: McpServerConfig = toml::from_str(toml_str).expect("parse http server");
    match cfg.transport {
        McpServerTransportConfig::StreamableHttp {
            url,
            bearer_token_env_var,
            http_headers,
        } => {
            assert_eq!(url, "https://mcp.example.com/mcp");
            assert_eq!(bearer_token_env_var.as_deref(), Some("DOCS_MCP_TOKEN"));
            assert_eq!(http_headers, None);
        }
        McpServerTransportConfig::Stdio { .. } => panic!("expected streamable http"),
    }
    assert!(!cfg.enabled);
    assert_eq!(cfg.tool_timeout_sec, Some(30));
    assert_eq!(cfg.disabled_tools, Some(vec!["dangerous_tool".to_string()]));
}

#[test]
fn enabled_defaults_true() {
    let cfg: McpServerConfig = toml::from_str(r#"command = "true""#).expect("parse minimal");
    assert!(cfg.enabled);
}

#[test]
fn bearer_token_env_var_name_never_a_secret_value() {
    let cfg: McpServerConfig = toml::from_str(
        r#"
        url = "https://example.com/mcp"
        bearer_token_env_var = "EXAMPLE_TOKEN"
        "#,
    )
    .expect("parse");
    let McpServerTransportConfig::StreamableHttp {
        bearer_token_env_var,
        ..
    } = cfg.transport
    else {
        panic!("expected streamable http");
    };
    // Only the variable *name* is stored; assert it looks like an env var
    // name, not a token (no whitespace, uppercase-ish convention respected).
    let name = bearer_token_env_var.expect("name present");
    assert!(!name.contains(' '));
    assert_eq!(name, "EXAMPLE_TOKEN");
}
