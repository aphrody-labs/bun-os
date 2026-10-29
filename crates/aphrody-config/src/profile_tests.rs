// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

#[test]
fn profile_parses_overridable_subset() {
    let toml_str = r#"
        model = "qwen2.5-coder:7b"
        model_provider = "ollama"
        approval_policy = "never"
        sandbox_mode = "workspace-write"
        model_reasoning_effort = "high"
    "#;
    let profile: ConfigProfile = toml::from_str(toml_str).expect("parse profile");
    assert_eq!(profile.model.as_deref(), Some("qwen2.5-coder:7b"));
    assert_eq!(profile.model_provider.as_deref(), Some("ollama"));
    assert_eq!(profile.approval_policy, Some(AskForApproval::Never));
    assert_eq!(profile.sandbox_mode, Some(SandboxMode::WorkspaceWrite));
}

#[test]
fn empty_profile_is_all_none() {
    let profile: ConfigProfile = toml::from_str("").expect("parse empty profile");
    assert_eq!(profile, ConfigProfile::default());
}

#[test]
fn explicit_profile_wins_over_environment() {
    assert_eq!(
        select_profile(Some(" niers "), Some("worker")),
        Some("niers".to_owned())
    );
}

#[test]
fn environment_selects_profile_when_cli_is_absent() {
    assert_eq!(
        select_profile(None, Some(" worker ")),
        Some("worker".to_owned())
    );
    assert_eq!(select_profile(None, Some("  ")), None);
    assert_eq!(
        select_profile(Some(""), Some("bxc")),
        Some("bxc".to_owned())
    );
}

#[test]
fn home_agent_profile_round_trip_preserves_all_eight_components() {
    let source = r#"
        plugins = ["../worker/plugins/example"]

        [database]
        db_type = "postgres"
        cache = "sqlite_wal"

        [rag]
        embed_backend = "ort"
        mode = "hybrid+rerank"
        vector_dim = 384

        [mcp_servers.worker]
        command = "bun"
        args = ["apps/mcp/src/index.ts"]

        [skills]
        whitelist = ["rag.canon", "ocr.continuous", "docs-index"]

        [a2a]
        id = "worker@example.com"
        mailbox = ".coord/inbox-from-worker.jsonl"

        [ocr]
        engines = ["pp-ocr-v5", "dots.ocr-3b"]
        state_path = "workspace-worker/ocr"

        [redis]
        url = "redis://127.0.0.1:6379/1"
        prefix = "worker:"
    "#;
    let profile: ConfigProfile = toml::from_str(source).expect("parse profile");
    let encoded = toml::to_string(&profile).expect("serialize profile");
    let decoded: ConfigProfile = toml::from_str(&encoded).expect("round trip profile");

    assert_eq!(decoded, profile);
    assert_eq!(
        decoded.database.expect("database").cache,
        Some(crate::DatabaseCache::SqliteWal)
    );
    assert_eq!(decoded.rag.expect("rag").vector_dim, Some(384));
    assert_eq!(decoded.plugins.expect("plugins").paths.len(), 1);
    assert!(
        decoded
            .mcp_servers
            .expect("MCP servers")
            .contains_key("worker")
    );
    assert_eq!(decoded.skills.expect("skills").whitelist.len(), 3);
    assert_eq!(
        decoded.a2a.expect("A2A").mailbox.as_deref(),
        Some(".coord/inbox-from-worker.jsonl")
    );
    assert_eq!(decoded.ocr.expect("OCR").engines.len(), 2);
    assert_eq!(
        decoded.redis.expect("Redis").prefix.as_deref(),
        Some("worker:")
    );
}
