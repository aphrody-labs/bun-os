// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

fn no_env(_: &str) -> Option<String> {
    None
}

fn env_map(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
    move |name| {
        pairs
            .iter()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| (*v).to_owned())
    }
}

#[test]
fn no_backend_and_no_endpoint_degrades_to_lexical_without_error() {
    let config = RagConfig::default();
    assert_eq!(resolve_embed_with(&config, &no_env).unwrap(), None);
}

#[test]
fn canonical_embed_base_url_alone_infers_the_llama_server_backend_and_local_role_default() {
    let config = RagConfig::default();
    let env = env_map(&[("APHRODY_AI_EMBED_BASE_URL", "http://127.0.0.1:9200/v1")]);
    let resolved = resolve_embed_with(&config, &env)
        .unwrap()
        .expect("backend inferred");
    assert_eq!(resolved.backend, EmbedBackend::LlamaServer);
    assert_eq!(resolved.model, LocalRole::Embed.default_model());
    assert_eq!(
        resolved.endpoint.as_deref(),
        Some("http://127.0.0.1:9200/v1")
    );
    assert_eq!(
        resolved.dimension,
        Catalog::builtin()
            .dimensions(LocalRole::Embed.default_model())
            .unwrap()
            .unwrap() as usize
    );
}

#[test]
fn legacy_alias_for_embed_model_is_still_honoured() {
    let config = RagConfig {
        embed_backend: Some(EmbedBackend::LlamaServer),
        embed_endpoint: Some("http://127.0.0.1:9200/v1".to_owned()),
        ..Default::default()
    };
    let env = env_map(&[("APHRODY_RAG_EMBED_MODEL", "bge-small-en-v1.5")]);
    let resolved = resolve_embed_with(&config, &env)
        .unwrap()
        .expect("configured backend");
    assert_eq!(resolved.model, "bge-small-en-v1.5");
}

#[test]
fn canonical_name_wins_over_configured_value() {
    let config = RagConfig {
        embed_backend: Some(EmbedBackend::LlamaServer),
        embed_endpoint: Some("http://127.0.0.1:9200/v1".to_owned()),
        embed_model: Some("configured-model".to_owned()),
        vector_dim: Some(1024),
        ..Default::default()
    };
    let env = env_map(&[("APHRODY_AI_EMBED_MODEL", "canonical-model")]);
    let resolved = resolve_embed_with(&config, &env)
        .unwrap()
        .expect("configured backend");
    assert_eq!(resolved.model, "canonical-model");
}

#[test]
fn ort_backend_needs_no_endpoint() {
    let config = RagConfig {
        embed_backend: Some(EmbedBackend::Ort),
        embed_model: Some("bge-small-en-v1.5".to_owned()),
        ..Default::default()
    };
    let resolved = resolve_embed_with(&config, &no_env)
        .unwrap()
        .expect("ort backend");
    assert_eq!(resolved.endpoint, None);
}

#[test]
fn ort_backend_defaults_to_its_own_whitelist_not_local_role_embed() {
    // `LocalRole::Embed`'s catalog default (qwen3-embedding-0.6b, served by
    // llama-server) is not a model `aphrody-embed`'s in-process ONNX Runtime
    // whitelist accepts. An unconfigured Ort backend must default to that
    // whitelist's own default instead of silently picking an incompatible one.
    let config = RagConfig {
        embed_backend: Some(EmbedBackend::Ort),
        ..Default::default()
    };
    let resolved = resolve_embed_with(&config, &no_env)
        .unwrap()
        .expect("ort backend");
    assert_ne!(resolved.model, LocalRole::Embed.default_model());
    assert_eq!(resolved.model, "bge-small-en-v1.5");
    assert_eq!(resolved.dimension, 384);
}

#[test]
fn http_backend_without_any_endpoint_is_a_clear_error() {
    let config = RagConfig {
        embed_backend: Some(EmbedBackend::LlamaServer),
        ..Default::default()
    };
    let error = resolve_embed_with(&config, &no_env).unwrap_err();
    assert!(matches!(
        error,
        RagError::MissingEmbedEndpoint {
            backend: EmbedBackend::LlamaServer
        }
    ));
}

#[test]
fn dimension_override_matching_the_catalog_is_accepted() {
    let config = RagConfig {
        embed_backend: Some(EmbedBackend::LlamaServer),
        embed_endpoint: Some("http://127.0.0.1:9200/v1".to_owned()),
        ..Default::default()
    };
    let dim = Catalog::builtin()
        .dimensions(LocalRole::Embed.default_model())
        .unwrap()
        .unwrap();
    let env = env_map(&[("APHRODY_AI_EMBED_DIMENSIONS", "1024")]);
    assert_eq!(
        dim, 1024,
        "test assumes the qwen3 embedding default is 1024-wide"
    );
    let resolved = resolve_embed_with(&config, &env)
        .unwrap()
        .expect("configured backend");
    assert_eq!(resolved.dimension, 1024);
}

#[test]
fn dimension_override_disagreeing_with_the_catalog_is_rejected_not_silently_chosen() {
    let config = RagConfig {
        embed_backend: Some(EmbedBackend::LlamaServer),
        embed_endpoint: Some("http://127.0.0.1:9200/v1".to_owned()),
        ..Default::default()
    };
    // The default embed model (qwen3-embedding-0.6b) is catalogued at 1024.
    let env = env_map(&[("APHRODY_AI_EMBED_DIMENSIONS", "384")]);
    let error = resolve_embed_with(&config, &env).unwrap_err();
    match error {
        RagError::EmbedDimensionMismatch {
            env_dim,
            catalog_dim,
            ..
        } => {
            assert_eq!(env_dim, 384);
            assert_eq!(catalog_dim, 1024);
        }
        other => panic!("expected EmbedDimensionMismatch, got {other:?}"),
    }
}

#[test]
fn legacy_dimension_alias_reports_itself_as_the_source_on_mismatch() {
    let config = RagConfig {
        embed_backend: Some(EmbedBackend::LlamaServer),
        embed_endpoint: Some("http://127.0.0.1:9200/v1".to_owned()),
        ..Default::default()
    };
    let env = env_map(&[("APHRODY_RAG_EMBED_DIM", "1")]);
    let error = resolve_embed_with(&config, &env).unwrap_err();
    match error {
        RagError::EmbedDimensionMismatch { env_var, .. } => {
            assert_eq!(env_var, "APHRODY_RAG_EMBED_DIM");
        }
        other => panic!("expected EmbedDimensionMismatch, got {other:?}"),
    }
}

#[test]
fn uncatalogued_model_without_any_dimension_source_is_a_clear_error() {
    let config = RagConfig {
        embed_backend: Some(EmbedBackend::LlamaServer),
        embed_endpoint: Some("http://127.0.0.1:9200/v1".to_owned()),
        embed_model: Some("hf:someone/unlisted-model".to_owned()),
        ..Default::default()
    };
    let error = resolve_embed_with(&config, &no_env).unwrap_err();
    assert!(matches!(error, RagError::UnknownEmbedDimension { .. }));
}

#[test]
fn uncatalogued_model_falls_back_to_configured_vector_dim() {
    let config = RagConfig {
        embed_backend: Some(EmbedBackend::LlamaServer),
        embed_endpoint: Some("http://127.0.0.1:9200/v1".to_owned()),
        embed_model: Some("hf:someone/unlisted-model".to_owned()),
        vector_dim: Some(256),
        ..Default::default()
    };
    let resolved = resolve_embed_with(&config, &no_env)
        .unwrap()
        .expect("configured backend");
    assert_eq!(resolved.dimension, 256);
}

#[test]
fn invalid_dimension_override_is_reported_not_panicked() {
    let config = RagConfig {
        embed_backend: Some(EmbedBackend::LlamaServer),
        embed_endpoint: Some("http://127.0.0.1:9200/v1".to_owned()),
        ..Default::default()
    };
    let env = env_map(&[("APHRODY_AI_EMBED_DIMENSIONS", "not-a-number")]);
    let error = resolve_embed_with(&config, &env).unwrap_err();
    assert!(matches!(error, RagError::InvalidEmbedDimension { .. }));
}

#[test]
fn rerank_available_probes_without_erroring_or_defaulting_a_model() {
    let config = RagConfig::default();
    assert!(!rerank_available_with(&config, &no_env));

    let env = env_map(&[("APHRODY_AI_RERANK_BASE_URL", "http://127.0.0.1:9300")]);
    assert!(rerank_available_with(&config, &env));

    let configured = RagConfig {
        rerank_endpoint: Some("http://127.0.0.1:9300".to_owned()),
        ..Default::default()
    };
    assert!(rerank_available_with(&configured, &no_env));
}

#[test]
fn rerank_disabled_never_touches_the_environment_or_errors() {
    let config = RagConfig::default();
    assert_eq!(resolve_rerank_with(&config, false, &no_env).unwrap(), None);
}

#[test]
fn rerank_enabled_without_any_endpoint_is_a_clear_error() {
    let config = RagConfig::default();
    let error = resolve_rerank_with(&config, true, &no_env).unwrap_err();
    assert!(matches!(error, RagError::MissingRerankEndpoint));
}

#[test]
fn rerank_enabled_resolves_canonical_endpoint_and_local_role_default_model() {
    let config = RagConfig::default();
    let env = env_map(&[("APHRODY_AI_RERANK_BASE_URL", "http://127.0.0.1:9300")]);
    let resolved = resolve_rerank_with(&config, true, &env)
        .unwrap()
        .expect("endpoint resolved");
    assert_eq!(resolved.model, LocalRole::Rerank.default_model());
    assert_eq!(resolved.endpoint, "http://127.0.0.1:9300");
}

#[test]
fn rerank_legacy_alias_and_api_key_are_honoured() {
    let config = RagConfig {
        rerank_model: Some("configured-reranker".to_owned()),
        ..Default::default()
    };
    let env = env_map(&[
        ("RERANK_URL", "http://127.0.0.1:9300/v1/rerank"),
        ("APHRODY_RAG_API_KEY", "secret-token"),
    ]);
    let resolved = resolve_rerank_with(&config, true, &env)
        .unwrap()
        .expect("endpoint resolved");
    assert_eq!(resolved.model, "configured-reranker");
    assert_eq!(resolved.endpoint, "http://127.0.0.1:9300/v1/rerank");
    assert_eq!(resolved.api_key.as_deref(), Some("secret-token"));
}
