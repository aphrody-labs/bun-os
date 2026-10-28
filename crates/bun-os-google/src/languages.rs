// SPDX-License-Identifier: Apache-2.0
//! Google Translation language registry shared by Rust clients and MCP.
//!
//! Data copied unchanged from aphrody-web commit
//! bbeb5ef4c497f7d27f546ad2cc15a250dcc93c83,
//! original Web translation language registry (SHA-256
//! 14cadff303788b87aa9e48be9af5c3e010013861a2a1c465f21421b294cdef65).

use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SupportedLanguage {
    pub language: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SupportedLanguagesData {
    pub languages: Vec<SupportedLanguage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SupportedLanguagesResponse {
    pub data: SupportedLanguagesData,
}

#[derive(Deserialize)]
struct LanguageSets {
    raw: Vec<SupportedLanguage>,
    #[serde(rename = "localizedFr")]
    localized_fr: Vec<SupportedLanguage>,
}

static LANGUAGES: LazyLock<LanguageSets> = LazyLock::new(|| {
    serde_json::from_str(include_str!("languages.json"))
        .expect("bundled Google language registry must remain valid JSON")
});

/// Return the same v2 response shape as the source registry. Only targets
/// beginning with `fr` select its French display names.
pub fn supported_languages(target: Option<&str>) -> SupportedLanguagesResponse {
    let list = if target.is_some_and(|target| target.to_ascii_lowercase().starts_with("fr")) {
        &LANGUAGES.localized_fr
    } else {
        &LANGUAGES.raw
    };
    SupportedLanguagesResponse { data: SupportedLanguagesData { languages: list.clone() } }
}

/// Check a code against the raw source registry, ignoring ASCII case.
pub fn is_valid_language_code(code: &str) -> bool {
    LANGUAGES.raw.iter().any(|item| item.language.eq_ignore_ascii_case(code))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_registry_has_195_codes_and_french_names() {
        let raw = supported_languages(None);
        let french = supported_languages(Some("fr-FR"));
        assert_eq!(raw.data.languages.len(), 195);
        assert_eq!(french.data.languages.len(), 195);
        assert_eq!(raw.data.languages[0].language, "ab");
        assert_eq!(raw.data.languages[0].name, None);
        assert_eq!(french.data.languages[0].name.as_deref(), Some("Abkhaze"));
        assert_eq!(supported_languages(Some("en")), raw);
    }

    #[test]
    fn code_lookup_matches_source_case_insensitivity() {
        assert!(is_valid_language_code("FR"));
        assert!(is_valid_language_code("zh-cn"));
        assert!(!is_valid_language_code("not-a-language"));
    }
}
