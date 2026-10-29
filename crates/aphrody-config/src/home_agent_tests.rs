// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

#[test]
fn worker_components_round_trip_without_losing_types() {
    let source = r#"
        plugins = ["../worker/plugins/example"]

        [database]
        db_type = "postgres"
        url_env = "DATABASE_URL"
        schema = "worker"
        cache = "sqlite_wal"
        cache_path = "workspace-worker/cache.sqlite3"

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
    let value: toml::Value = toml::from_str(source).expect("parse source");
    let database: DatabaseConfig = value["database"].clone().try_into().expect("database");
    let plugins: PluginConfig = value["plugins"].clone().try_into().expect("plugins");
    let skills: SkillsConfig = value["skills"].clone().try_into().expect("skills");
    let a2a: A2aConfig = value["a2a"].clone().try_into().expect("a2a");
    let ocr: OcrConfig = value["ocr"].clone().try_into().expect("ocr");
    let redis: RedisConfig = value["redis"].clone().try_into().expect("redis");

    assert_eq!(database.db_type, Some(DatabaseType::Postgres));
    assert_eq!(database.cache, Some(DatabaseCache::SqliteWal));
    assert_eq!(plugins.paths.len(), 1);
    assert_eq!(skills.whitelist.len(), 3);
    assert_eq!(a2a.id.as_deref(), Some("worker@example.com"));
    assert_eq!(ocr.engines, vec![OcrEngine::PpOcrV5, OcrEngine::DotsOcr3b]);
    assert_eq!(redis.prefix.as_deref(), Some("worker:"));

    let encoded = toml::to_string(&ocr).expect("serialize OCR");
    assert_eq!(
        toml::from_str::<OcrConfig>(&encoded).expect("round trip"),
        ocr
    );
}

#[test]
fn ocr_engine_serialises_as_the_catalog_id_and_still_accepts_legacy_names() {
    // The catalog id is the primary, round-tripping form.
    let catalog_form: OcrConfig =
        toml::from_str("engines = [\"ppocr-v5-mobile\", \"dots-ocr\"]").expect("catalog ids");
    assert_eq!(
        catalog_form.engines,
        vec![OcrEngine::PpOcrV5, OcrEngine::DotsOcr3b]
    );
    let encoded = toml::to_string(&catalog_form).expect("serialize");
    assert!(encoded.contains("ppocr-v5-mobile"), "{encoded}");
    assert!(encoded.contains("dots-ocr"), "{encoded}");
    assert!(!encoded.contains("dots.ocr-3b"), "{encoded}");

    // The pre-catalog names an older config already carries still parse.
    let legacy_form: OcrConfig =
        toml::from_str("engines = [\"pp-ocr-v5\", \"dots.ocr-3b\"]").expect("legacy aliases");
    assert_eq!(legacy_form.engines, catalog_form.engines);
}

#[test]
fn component_defaults_are_empty_and_side_effect_free() {
    assert_eq!(DatabaseConfig::default().db_type, None);
    assert!(PluginConfig::default().paths.is_empty());
    assert!(SkillsConfig::default().whitelist.is_empty());
    assert_eq!(A2aConfig::default().mailbox, None);
    assert!(OcrConfig::default().engines.is_empty());
    assert_eq!(RedisConfig::default().url, None);
}

#[test]
fn agent_home_table_reads_homes_dir() {
    let value: toml::Value = toml::from_str("[agent_home]\nhomes_dir = \"/data/homes\"\n").unwrap();
    let cfg = AgentHomeConfig::from_toml(&value).unwrap();
    assert_eq!(cfg.homes_dir.as_deref(), Some("/data/homes"));
    let empty: toml::Value = toml::from_str("model = \"x\"\n").unwrap();
    assert_eq!(AgentHomeConfig::from_toml(&empty), None);
    let parsed: crate::ConfigToml = toml::from_str("[agent_home]\nhomes_dir = \"h\"\n").unwrap();
    assert!(parsed.unknown_key_warnings().is_empty());
    assert_eq!(parsed.agent_home.unwrap().homes_dir.as_deref(), Some("h"));
}
