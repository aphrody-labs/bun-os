// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

const FIXTURE: &str = include_str!("../tests/fixtures/upstream_style_config.toml");

#[test]
fn realistic_fixture_parses_with_zero_errors() {
    let config: ConfigToml = toml::from_str(FIXTURE).expect("fixture must parse");
    assert_eq!(config.model.as_deref(), Some("gpt-5-codex"));
    assert_eq!(config.model_provider.as_deref(), Some("openai"));
    assert_eq!(config.approval_policy, Some(AskForApproval::OnRequest));
    assert_eq!(config.sandbox_mode, Some(SandboxMode::WorkspaceWrite));
    assert_eq!(config.notify, vec!["notify-send", "aphrody turn finished"]);
    assert!(config.mcp_servers.contains_key("aphrody"));
    assert!(config.mcp_servers.contains_key("docs"));
    assert!(config.model_providers.contains_key("custom-vllm-cluster"));
    assert!(config.profiles.contains_key("fast-local"));
    assert!(config.rag.is_some());
    assert!(config.llama.is_some());
    assert!(config.train.is_some());
    assert!(!config.compat.read_codex_home);
    assert!(config.computer_use.is_some());
    assert!(config.tools.contains_key("bxc"));
    assert!(config.model_profiles.contains_key("qwen3-coder"));
}

#[test]
fn unknown_top_level_keys_surface_as_warnings_never_as_errors() {
    let config: ConfigToml = toml::from_str(FIXTURE).expect("fixture must parse");
    let warnings = config.unknown_key_warnings();
    let messages: Vec<String> = warnings.iter().map(ToString::to_string).collect();
    assert!(
        messages.iter().any(|m| m.contains("`tui`")),
        "expected a warning about `tui`, got {messages:?}"
    );
    assert!(messages.iter().any(|m| m.contains("`otel`")));
    assert!(messages.iter().any(|m| m.contains("`features`")));
    assert!(
        messages
            .iter()
            .any(|m| m.contains("`hide_agent_reasoning`"))
    );
}

#[test]
fn wire_api_chat_is_accepted_on_a_user_defined_provider() {
    let config: ConfigToml = toml::from_str(FIXTURE).expect("fixture must parse");
    assert_eq!(
        config.model_providers["custom-vllm-cluster"].wire_api,
        crate::wire_api::WireApi::Chat
    );
}

#[test]
fn empty_document_parses_to_all_defaults() {
    let config: ConfigToml = toml::from_str("").expect("empty document parses");
    assert_eq!(config, ConfigToml::default());
    assert!(config.unknown_key_warnings().is_empty());
}

#[test]
fn serde_round_trip_preserves_semantics() {
    let config: ConfigToml = toml::from_str(FIXTURE).expect("fixture must parse");
    let json = serde_json::to_string(&config).expect("serialize to json");
    let back: ConfigToml = serde_json::from_str(&json).expect("deserialize from json");
    assert_eq!(back.model, config.model);
    assert_eq!(back.rag, config.rag);
    assert_eq!(back.mcp_servers.len(), config.mcp_servers.len());
}

#[test]
fn shell_environment_policy_parses_all_fields() {
    let config: ConfigToml = toml::from_str(FIXTURE).expect("fixture must parse");
    let policy = &config.shell_environment_policy;
    assert_eq!(policy.inherit, Some(true));
    assert!(!policy.ignore_default_excludes);
    assert_eq!(policy.exclude, vec!["AWS_*", "*_SECRET_KEY"]);
    assert_eq!(policy.set["APHRODY_HOME"], "~/.aphrody");
}

#[test]
fn sandbox_workspace_write_parses() {
    let config: ConfigToml = toml::from_str(FIXTURE).expect("fixture must parse");
    let sww = config.sandbox_workspace_write.expect("present");
    assert_eq!(sww.writable_roots, vec!["/tmp/aphrody-scratch"]);
    assert!(!sww.network_access);
    assert!(sww.exclude_slash_tmp);
}
