// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;
use crate::{layer::LayerSource, provider::builtin_providers_layer_value};

fn no_env(_: &str) -> Option<String> {
    None
}

fn builtin_layer() -> ConfigLayer {
    ConfigLayer::new(LayerSource::Builtin, builtin_providers_layer_value(&no_env))
}

fn user_layer(toml_str: &str) -> ConfigLayer {
    ConfigLayer::new(
        LayerSource::User,
        toml::from_str(toml_str).expect("valid toml"),
    )
}

fn default_models() -> BTreeMap<String, String> {
    BTreeMap::new()
}

#[test]
fn doctrine_defaults_are_never_and_workspace_write() {
    let (config, warnings) = resolve(
        vec![builtin_layer()],
        &CliOverrides::default(),
        "llama",
        &default_models(),
    )
    .expect("resolve");
    assert!(warnings.is_empty());
    assert_eq!(config.approval_policy, AskForApproval::Never);
    assert_eq!(config.sandbox_mode, SandboxMode::WorkspaceWrite);
    assert_eq!(config.provider.id, "llama");
}

#[test]
fn explicit_config_approval_policy_overrides_doctrine_default() {
    let layers = vec![
        builtin_layer(),
        user_layer(r#"approval_policy = "on-request""#),
    ];
    let (config, _) =
        resolve(layers, &CliOverrides::default(), "llama", &default_models()).expect("resolve");
    assert_eq!(config.approval_policy, AskForApproval::OnRequest);
}

#[test]
fn full_auto_flag_wins_over_config() {
    let layers = vec![
        builtin_layer(),
        user_layer(
            r#"approval_policy = "untrusted"
sandbox_mode = "read-only""#,
        ),
    ];
    let overrides = CliOverrides {
        full_auto: true,
        ..CliOverrides::default()
    };
    let (config, _) = resolve(layers, &overrides, "llama", &default_models()).expect("resolve");
    assert_eq!(config.approval_policy, AskForApproval::Never);
    assert_eq!(config.sandbox_mode, SandboxMode::WorkspaceWrite);
}

#[test]
fn dangerously_bypass_wins_over_full_auto() {
    let overrides = CliOverrides {
        full_auto: true,
        dangerously_bypass: true,
        ..CliOverrides::default()
    };
    let (config, _) = resolve(
        vec![builtin_layer()],
        &overrides,
        "llama",
        &default_models(),
    )
    .expect("resolve");
    assert_eq!(config.sandbox_mode, SandboxMode::DangerFullAccess);
    assert_eq!(config.approval_policy, AskForApproval::Never);
}

#[test]
fn oss_flag_selects_oss_provider_over_configured_provider() {
    let layers = vec![
        builtin_layer(),
        user_layer(
            r#"model_provider = "openai"
oss_provider = "ollama""#,
        ),
    ];
    let overrides = CliOverrides {
        oss: true,
        ..CliOverrides::default()
    };
    let (config, _) = resolve(layers, &overrides, "llama", &default_models()).expect("resolve");
    assert_eq!(config.provider.id, "ollama");
}

#[test]
fn oss_flag_falls_back_to_llama_with_no_oss_provider_configured() {
    let overrides = CliOverrides {
        oss: true,
        ..CliOverrides::default()
    };
    let (config, _) = resolve(
        vec![builtin_layer()],
        &overrides,
        "antigravity",
        &default_models(),
    )
    .expect("resolve");
    assert_eq!(config.provider.id, "llama");
}

#[test]
fn local_provider_flag_wins_over_oss_provider_config() {
    let layers = vec![builtin_layer(), user_layer(r#"oss_provider = "ollama""#)];
    let overrides = CliOverrides {
        oss: true,
        local_provider: Some("vllm".to_string()),
        ..CliOverrides::default()
    };
    let (config, _) = resolve(layers, &overrides, "llama", &default_models()).expect("resolve");
    assert_eq!(config.provider.id, "vllm");
}

#[test]
fn unknown_profile_names_available_profiles() {
    let layers = vec![
        builtin_layer(),
        user_layer(
            r#"
            [profiles.fast]
            model = "a"
            [profiles.slow]
            model = "b"
            "#,
        ),
    ];
    let overrides = CliOverrides {
        profile: Some("ghost".to_string()),
        ..CliOverrides::default()
    };
    let err = resolve(layers, &overrides, "llama", &default_models()).expect_err("unknown profile");
    match err {
        ConfigError::UnknownProfile { name, available } => {
            assert_eq!(name, "ghost");
            assert_eq!(available, vec!["fast".to_string(), "slow".to_string()]);
        }
        other => panic!("expected UnknownProfile, got {other:?}"),
    }
}

#[test]
fn unknown_provider_names_available_providers() {
    let err = resolve(
        vec![builtin_layer()],
        &CliOverrides::default(),
        "does-not-exist",
        &default_models(),
    )
    .expect_err("unknown provider");
    match err {
        ConfigError::UnknownProvider { id, available } => {
            assert_eq!(id, "does-not-exist");
            assert!(available.contains(&"llama".to_string()));
            assert!(available.contains(&"openai".to_string()));
        }
        other => panic!("expected UnknownProvider, got {other:?}"),
    }
}

#[test]
fn profile_selects_model_and_provider() {
    let layers = vec![
        builtin_layer(),
        user_layer(
            r#"
            [profiles.fast-local]
            model = "qwen2.5-coder:7b"
            model_provider = "ollama"
            "#,
        ),
    ];
    let overrides = CliOverrides {
        profile: Some("fast-local".to_string()),
        ..CliOverrides::default()
    };
    let (config, _) = resolve(layers, &overrides, "llama", &default_models()).expect("resolve");
    assert_eq!(config.model.as_deref(), Some("qwen2.5-coder:7b"));
    assert_eq!(config.provider.id, "ollama");
    assert_eq!(config.active_profile.as_deref(), Some("fast-local"));
}

#[test]
fn selected_home_agent_profile_atomically_replaces_isolated_components() {
    let layers = vec![
        builtin_layer(),
        user_layer(
            r#"
            plugins = ["global-plugin"]
            developer_instructions = "root instructions"

            [database]
            db_type = "sqlite"
            cache_path = "global/cache.sqlite3"

            [rag]
            db_path = "global/rag.sqlite3"
            top_k = 99

            [mcp_servers.global]
            command = "global-mcp"

            [redis]
            url = "redis://127.0.0.1:6379/0"
            prefix = "global:"

            [profiles.worker]
            plugins = ["worker-plugin"]
            developer_instructions = "must not escape typed profile"

            [profiles.worker.database]
            db_type = "postgres"
            url_env = "DATABASE_URL"
            schema = "worker"
            cache = "sqlite_wal"

            [profiles.worker.rag]
            embed_backend = "ort"
            mode = "hybrid+rerank"
            vector_dim = 384

            [profiles.worker.mcp_servers.worker]
            command = "bun"
            args = ["apps/mcp/src/index.ts"]

            [profiles.worker.skills]
            whitelist = ["rag.canon", "ocr.continuous", "docs-index"]

            [profiles.worker.a2a]
            id = "worker@example.com"
            mailbox = ".coord/inbox-from-worker.jsonl"

            [profiles.worker.ocr]
            engines = ["pp-ocr-v5", "dots.ocr-3b"]
            state_path = "workspace-worker/ocr"

            [profiles.worker.redis]
            url = "redis://127.0.0.1:6379/1"
            prefix = "worker:"

            [profiles.niers]
            plugins = ["niers-only-plugin"]

            [profiles.niers.a2a]
            id = "niers@aphrody.com"
            mailbox = ".coord/inbox-from-niers.jsonl"
            "#,
        ),
    ];
    let overrides = CliOverrides {
        profile: Some("worker".to_string()),
        ..CliOverrides::default()
    };
    let (config, warnings) =
        resolve(layers, &overrides, "llama", &default_models()).expect("resolve profile");

    assert!(warnings.is_empty());
    assert_eq!(config.database.db_type, Some(crate::DatabaseType::Postgres));
    assert_eq!(
        config.database.cache_path, None,
        "root cache path must not leak"
    );
    assert_eq!(config.rag.db_path, None, "root RAG database must not leak");
    assert_eq!(
        config.rag.top_k, None,
        "root retrieval settings must not leak"
    );
    assert_eq!(config.rag.vector_dim, Some(384));
    assert_eq!(config.plugins.paths, vec!["worker-plugin"]);
    assert_eq!(
        config.skills.whitelist,
        vec!["rag.canon", "ocr.continuous", "docs-index"]
    );
    assert_eq!(config.a2a.id.as_deref(), Some("worker@example.com"));
    assert_ne!(config.a2a.id.as_deref(), Some("niers@aphrody.com"));
    assert_eq!(config.ocr.engines.len(), 2);
    assert_eq!(config.redis.prefix.as_deref(), Some("worker:"));
    assert_eq!(config.mcp_servers.len(), 1);
    assert!(config.mcp_servers.contains_key("worker"));
    assert!(!config.mcp_servers.contains_key("global"));
    assert_eq!(
        config.developer_instructions.as_deref(),
        Some("root instructions")
    );
}

#[test]
fn home_agent_components_default_to_disabled_empty_state() {
    let (config, _) = resolve(
        vec![builtin_layer()],
        &CliOverrides::default(),
        "llama",
        &default_models(),
    )
    .expect("resolve defaults");

    assert_eq!(config.database.db_type, None);
    assert!(config.plugins.paths.is_empty());
    assert!(config.skills.whitelist.is_empty());
    assert_eq!(config.a2a.id, None);
    assert!(config.ocr.engines.is_empty());
    assert_eq!(config.redis.url, None);
}

#[test]
fn cli_override_wins_over_profile() {
    let layers = vec![
        builtin_layer(),
        user_layer(
            r#"
            [profiles.fast-local]
            model = "qwen2.5-coder:7b"
            "#,
        ),
    ];
    let overrides = CliOverrides {
        profile: Some("fast-local".to_string()),
        config_overrides: vec!["model=deepseek-r1".to_string()],
        ..CliOverrides::default()
    };
    let (config, _) = resolve(layers, &overrides, "llama", &default_models()).expect("resolve");
    assert_eq!(config.model.as_deref(), Some("deepseek-r1"));
}

#[test]
fn explicit_model_flag_wins_over_cli_override_and_profile() {
    let layers = vec![
        builtin_layer(),
        user_layer(
            r#"
            [profiles.fast-local]
            model = "qwen2.5-coder:7b"
            "#,
        ),
    ];
    let overrides = CliOverrides {
        profile: Some("fast-local".to_string()),
        config_overrides: vec!["model=deepseek-r1".to_string()],
        model: Some("gpt-5-codex".to_string()),
        ..CliOverrides::default()
    };
    let (config, _) = resolve(layers, &overrides, "llama", &default_models()).expect("resolve");
    assert_eq!(config.model.as_deref(), Some("gpt-5-codex"));
}

#[test]
fn user_provider_field_wise_merge_onto_a_builtin_preserves_untouched_fields() {
    let layers = vec![
        builtin_layer(),
        user_layer(
            r#"
            [model_providers.llama]
            name = "Custom Llama"
            "#,
        ),
    ];
    let (config, _) =
        resolve(layers, &CliOverrides::default(), "llama", &default_models()).expect("resolve");
    assert_eq!(config.provider.info.name, "Custom Llama");
    // `managed` was never mentioned by the user layer; the builtin's value
    // survives the merge (aphrody is more permissive than upstream here).
    assert_eq!(
        config.provider.info.managed,
        Some(crate::provider::ManagedRuntime::LlamaServer)
    );
}

#[test]
fn hardcoded_model_defaults_apply_only_to_ollama_and_lmstudio() {
    let (config, _) = resolve(
        vec![builtin_layer()],
        &CliOverrides::default(),
        "ollama",
        &default_models(),
    )
    .expect("resolve");
    assert_eq!(config.model.as_deref(), Some("gpt-oss:20b"));

    let (config, _) = resolve(
        vec![builtin_layer()],
        &CliOverrides::default(),
        "lmstudio",
        &default_models(),
    )
    .expect("resolve");
    assert_eq!(config.model.as_deref(), Some("openai/gpt-oss-20b"));

    let (config, _) = resolve(
        vec![builtin_layer()],
        &CliOverrides::default(),
        "vllm",
        &default_models(),
    )
    .expect("resolve");
    assert_eq!(config.model, None);
}

#[test]
fn caller_supplied_default_models_take_priority_over_hardcoded_ones() {
    let mut defaults = BTreeMap::new();
    defaults.insert("ollama".to_string(), "llama3.3:70b".to_string());
    let (config, _) = resolve(
        vec![builtin_layer()],
        &CliOverrides::default(),
        "ollama",
        &defaults,
    )
    .expect("resolve");
    assert_eq!(config.model.as_deref(), Some("llama3.3:70b"));
}

#[test]
fn to_json_never_contains_a_literal_secret_only_env_var_names() {
    let (config, _) = resolve(
        vec![builtin_layer()],
        &CliOverrides::default(),
        "openai",
        &default_models(),
    )
    .expect("resolve");
    let json = config.to_json();
    let rendered = json.to_string();
    assert!(rendered.contains("OPENAI_API_KEY"));
    assert!(!rendered.contains("sk-"));
    assert_eq!(
        json["provider"]["info"]["env_key"].as_str(),
        Some("OPENAI_API_KEY")
    );
}
