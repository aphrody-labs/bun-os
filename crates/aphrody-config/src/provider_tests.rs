// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

fn no_env(_: &str) -> Option<String> {
    None
}

#[test]
fn builtin_ids_are_exactly_the_documented_set() {
    let providers = builtin_providers(&no_env);
    let mut ids: Vec<&str> = providers.keys().map(String::as_str).collect();
    ids.sort_unstable();
    assert_eq!(
        ids,
        vec![
            "anthropic",
            "antigravity",
            "chatgpt",
            "llama",
            "lmstudio",
            "ollama",
            "openai",
            "vllm",
        ]
    );
}

#[test]
fn llama_is_managed_and_has_no_fixed_base_url() {
    let providers = builtin_providers(&no_env);
    let llama = &providers["llama"];
    assert_eq!(llama.managed, Some(ManagedRuntime::LlamaServer));
    assert_eq!(llama.base_url, None);
    assert_eq!(llama.wire_api, WireApi::Chat);
}

#[test]
fn ollama_default_base_url() {
    let providers = builtin_providers(&no_env);
    assert_eq!(
        providers["ollama"].base_url.as_deref(),
        Some("http://localhost:11434/v1")
    );
}

#[test]
fn ollama_honours_codex_oss_port() {
    let env = |key: &str| (key == "CODEX_OSS_PORT").then(|| "9999".to_string());
    let providers = builtin_providers(&env);
    assert_eq!(
        providers["ollama"].base_url.as_deref(),
        Some("http://localhost:9999/v1")
    );
}

#[test]
fn ollama_honours_codex_oss_base_url() {
    let env = |key: &str| (key == "CODEX_OSS_BASE_URL").then(|| "http://box:1111/v1".to_string());
    let providers = builtin_providers(&env);
    assert_eq!(
        providers["ollama"].base_url.as_deref(),
        Some("http://box:1111/v1")
    );
}

#[test]
fn aphrody_env_wins_over_codex_env() {
    let env = |key: &str| match key {
        "CODEX_OSS_BASE_URL" => Some("http://codex:1/v1".to_string()),
        "APHRODY_OSS_BASE_URL" => Some("http://aphrody:2/v1".to_string()),
        _ => None,
    };
    let providers = builtin_providers(&env);
    assert_eq!(
        providers["ollama"].base_url.as_deref(),
        Some("http://aphrody:2/v1")
    );
}

#[test]
fn aphrody_oss_port_wins_over_codex_oss_port() {
    let env = |key: &str| match key {
        "CODEX_OSS_PORT" => Some("1111".to_string()),
        "APHRODY_OSS_PORT" => Some("2222".to_string()),
        _ => None,
    };
    let providers = builtin_providers(&env);
    assert_eq!(
        providers["ollama"].base_url.as_deref(),
        Some("http://localhost:2222/v1")
    );
}

#[test]
fn lmstudio_and_vllm_use_fixed_local_ports() {
    let providers = builtin_providers(&no_env);
    assert_eq!(
        providers["lmstudio"].base_url.as_deref(),
        Some("http://localhost:1234/v1")
    );
    assert_eq!(
        providers["vllm"].base_url.as_deref(),
        Some("http://localhost:8000/v1")
    );
}

#[test]
fn vllm_uses_shared_chat_endpoint_and_credential_reference() {
    let env = |key: &str| match key {
        "APHRODY_AI_CHAT_BASE_URL" => Some("http://gpu-host:8180/v1".to_owned()),
        "APHRODY_OSS_BASE_URL" => Some("http://legacy:8000/v1".to_owned()),
        "APHRODY_AI_CHAT_API_KEY" => Some("protected-fixture-token".to_owned()),
        "VLLM_API_KEY" => Some("legacy-fixture-token".to_owned()),
        _ => None,
    };
    let providers = builtin_providers(&env);
    let vllm = &providers["vllm"];
    assert_eq!(vllm.base_url.as_deref(), Some("http://gpu-host:8180/v1"));
    assert_eq!(vllm.env_key.as_deref(), Some("APHRODY_AI_CHAT_API_KEY"));
    assert_eq!(
        vllm.managed, None,
        "remote inference must never spawn a local GPU runtime"
    );
    let serialized = toml::to_string(vllm).unwrap();
    assert!(!serialized.contains("protected-fixture-token"));
    assert!(!serialized.contains("legacy-fixture-token"));
}

#[test]
fn vllm_retains_chat_aliases_and_keyless_local_default() {
    let providers = builtin_providers(&|key| match key {
        "APHRODY_OSS_BASE_URL" => Some("http://declared:8180/v1".to_owned()),
        "VLLM_API_KEY" => Some("fixture-token".to_owned()),
        _ => None,
    });
    assert_eq!(
        providers["vllm"].base_url.as_deref(),
        Some("http://declared:8180/v1")
    );
    assert_eq!(providers["vllm"].env_key.as_deref(), Some("VLLM_API_KEY"));
    assert_eq!(builtin_providers(&no_env)["vllm"].env_key, None);
}

#[test]
fn antigravity_is_keyless() {
    let providers = builtin_providers(&no_env);
    let antigravity = &providers["antigravity"];
    assert_eq!(antigravity.env_key, None);
    assert_eq!(antigravity.wire_api, WireApi::Antigravity);
}

#[test]
fn chatgpt_requires_openai_auth_and_never_carries_a_key_env() {
    let providers = builtin_providers(&no_env);
    let chatgpt = &providers["chatgpt"];
    assert!(chatgpt.requires_openai_auth);
    assert_eq!(chatgpt.env_key, None);
    assert_eq!(
        chatgpt.base_url.as_deref(),
        Some("https://chatgpt.com/backend-api/codex")
    );
}

#[test]
fn openai_and_anthropic_carry_only_env_var_names_never_secrets() {
    let providers = builtin_providers(&no_env);
    assert_eq!(
        providers["openai"].env_key.as_deref(),
        Some("OPENAI_API_KEY")
    );
    assert_eq!(
        providers["anthropic"].env_key.as_deref(),
        Some("ANTHROPIC_API_KEY")
    );
    assert_eq!(providers["anthropic"].wire_api, WireApi::Anthropic);
}

#[test]
fn default_retry_and_timeout_accessors_match_upstream_constants() {
    let info = ModelProviderInfo::default();
    assert_eq!(info.request_max_retries(), DEFAULT_REQUEST_MAX_RETRIES);
    assert_eq!(info.stream_max_retries(), DEFAULT_STREAM_MAX_RETRIES);
    assert_eq!(
        info.stream_idle_timeout_ms(),
        DEFAULT_STREAM_IDLE_TIMEOUT_MS
    );
}

#[test]
fn accessors_honour_explicit_overrides() {
    let info = ModelProviderInfo {
        request_max_retries: Some(9),
        stream_max_retries: Some(1),
        stream_idle_timeout_ms: Some(500),
        ..ModelProviderInfo::default()
    };
    assert_eq!(info.request_max_retries(), 9);
    assert_eq!(info.stream_max_retries(), 1);
    assert_eq!(info.stream_idle_timeout_ms(), 500);
}

#[test]
fn builtin_layer_value_round_trips_into_model_provider_info() {
    let layer = builtin_providers_layer_value(&no_env);
    let table = layer.as_table().expect("table");
    let providers = table
        .get("model_providers")
        .and_then(toml::Value::as_table)
        .expect("model_providers table");
    let llama: ModelProviderInfo = providers["llama"].clone().try_into().expect("deserialize");
    assert_eq!(llama.managed, Some(ManagedRuntime::LlamaServer));
}

#[test]
fn managed_runtime_serializes_kebab_case() {
    let json = serde_json::to_string(&ManagedRuntime::LlamaServer).expect("serialize");
    assert_eq!(json, "\"llama-server\"");
}
