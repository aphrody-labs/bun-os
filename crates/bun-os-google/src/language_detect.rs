// SPDX-License-Identifier: Apache-2.0
//! Local Google Translate language detection with an optional caller-owned LLM fallback.
//!
//! The lexical and Unicode ranges match the source Web detector. CLI and MCP
//! can add their existing Gemini client through `detect_single_with_fallback`.

use std::future::Future;

use serde::{Deserialize, Serialize};

const STOPWORDS: &[(&str, &[&str])] = &[
    (
        "fr",
        &[
            "le", "la", "les", "de", "des", "un", "une", "et", "en", "du", "je", "tu", "il",
            "elle", "nous", "vous", "ils", "elles", "est", "sont", "qui", "que", "pour", "dans",
            "ce", "cette", "bonjour", "merci",
        ],
    ),
    (
        "en",
        &[
            "the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for", "not",
            "on", "with", "he", "as", "you", "do", "at", "this", "but", "his", "by", "from",
            "they", "hello", "world",
        ],
    ),
    (
        "es",
        &[
            "el", "la", "de", "que", "y", "en", "un", "se", "no", "haber", "por", "con", "su",
            "para", "como", "estar", "tener", "le", "lo", "todo", "pero", "mas", "hola", "mundo",
        ],
    ),
    (
        "de",
        &[
            "das", "ist", "du", "ich", "nicht", "die", "es", "und", "der", "wir", "sie", "von",
            "ein", "eine", "fuer", "auf", "mit", "dem", "den", "im", "hallo", "welt",
        ],
    ),
    (
        "it",
        &[
            "il", "la", "di", "e", "che", "in", "un", "per", "una", "sono", "mi", "si", "ho", "ma",
            "non", "lo", "ciao", "mondo",
        ],
    ),
    (
        "pt",
        &[
            "de", "a", "o", "que", "e", "do", "da", "em", "um", "para", "com", "nao", "uma", "os",
            "no", "se", "na", "por", "mais", "ola", "mundo",
        ],
    ),
    (
        "nl",
        &[
            "de", "van", "ik", "te", "dat", "die", "in", "een", "hij", "het", "niet", "zijn", "is",
            "was", "op", "aan", "met", "als", "voor",
        ],
    ),
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionV2Item {
    pub language: String,
    pub confidence: f64,
    pub is_reliable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DetectLanguageV2Data {
    pub detections: Vec<Vec<DetectionV2Item>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DetectLanguageV2Response {
    pub data: DetectLanguageV2Data,
}

fn script_language(text: &str) -> Option<(&'static str, f64)> {
    let codes: Vec<u32> = text.chars().map(u32::from).collect();
    let has = |range: std::ops::RangeInclusive<u32>| codes.iter().any(|code| range.contains(code));
    // Keep the source detector's fixed precedence for mixed-script text.
    if has(0x3040..=0x30ff) {
        Some(("ja", 0.99))
    } else if has(0xac00..=0xd7ff) || has(0x1100..=0x11ff) {
        Some(("ko", 0.99))
    } else if has(0x4e00..=0x9fff) {
        Some(("zh", 0.95))
    } else if has(0x0400..=0x04ff) {
        Some(("ru", 0.95))
    } else if has(0x0600..=0x06ff) {
        Some(("ar", 0.95))
    } else if has(0x0370..=0x03ff) {
        Some(("el", 0.95))
    } else if has(0x0590..=0x05ff) {
        Some(("he", 0.95))
    } else if has(0x0900..=0x097f) {
        Some(("hi", 0.95))
    } else if has(0x0e00..=0x0e7f) {
        Some(("th", 0.95))
    } else {
        None
    }
}

fn lexical_language(text: &str) -> Option<(&'static str, f64)> {
    let lower = text.to_lowercase();
    let words: Vec<_> = lower
        .split(|character: char| {
            !(character.is_ascii_alphabetic() || ('À'..='ſ').contains(&character))
        })
        .filter(|word| !word.is_empty())
        .collect();
    if words.is_empty() {
        return None;
    }
    let mut best = None;
    let mut highest = 0;
    for (language, stopwords) in STOPWORDS {
        let score = words.iter().filter(|word| stopwords.contains(word)).count();
        if score > highest {
            highest = score;
            best = Some(*language);
        }
    }
    best.map(|language| {
        let confidence = (0.65_f64 + highest as f64 / words.len() as f64 * 0.35).min(0.99);
        (language, (confidence * 100.0).round() / 100.0)
    })
}

/// Detect locally. Uncertain Latin snippets return a marked fallback (`en`).
pub fn detect_single_local(text: &str) -> DetectionV2Item {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return DetectionV2Item { language: "und".to_owned(), confidence: 0.0, is_reliable: false };
    }
    if let Some((language, confidence)) = script_language(trimmed) {
        return DetectionV2Item { language: language.to_owned(), confidence, is_reliable: true };
    }
    if let Some((language, confidence)) = lexical_language(trimmed) {
        if confidence >= 0.7 {
            return DetectionV2Item {
                language: language.to_owned(),
                confidence,
                is_reliable: true,
            };
        }
        return DetectionV2Item {
            language: language.to_owned(),
            confidence: 0.6,
            is_reliable: false,
        };
    }
    DetectionV2Item { language: "en".to_owned(), confidence: 0.6, is_reliable: false }
}

/// Resolve an uncertain snippet through the caller's existing Gemini client.
/// The callback receives the same prompt as the source Web implementation.
pub async fn detect_single_with_fallback<F, Fut>(text: &str, ask: F) -> DetectionV2Item
where
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<String, String>>,
{
    let local = detect_single_local(text);
    if local.is_reliable || text.trim().is_empty() {
        return local;
    }
    let prompt = format!(
        "Detect the ISO 639-1 two-letter language code of the following text. Reply ONLY with the 2-letter code (e.g. en, fr, de, es):\n\n{}",
        text.trim(),
    );
    if let Ok(answer) = ask(prompt).await {
        let code = answer.trim().to_ascii_lowercase();
        if valid_language_answer(&code) {
            return DetectionV2Item { language: code, confidence: 0.95, is_reliable: true };
        }
    }
    local
}

fn valid_language_answer(code: &str) -> bool {
    let bytes = code.as_bytes();
    (bytes.len() == 2 && bytes.iter().all(u8::is_ascii_lowercase))
        || (bytes.len() >= 5
            && bytes.len() <= 7
            && bytes[2] == b'-'
            && bytes[..2].iter().all(u8::is_ascii_lowercase)
            && bytes[3..].iter().all(u8::is_ascii_lowercase))
}

pub fn detect_languages_local<'a>(
    input: impl IntoIterator<Item = &'a str>,
) -> DetectLanguageV2Response {
    DetectLanguageV2Response {
        data: DetectLanguageV2Data {
            detections: input.into_iter().map(|text| vec![detect_single_local(text)]).collect(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_scripts_and_stopwords() {
        assert_eq!(detect_single_local("こんにちは").language, "ja");
        assert_eq!(detect_single_local("안녕하세요").language, "ko");
        assert_eq!(detect_single_local("中国と日本").language, "ja");
        assert_eq!(detect_single_local("bonjour et merci").language, "fr");
        assert_eq!(detect_single_local("hello world").language, "en");
        assert_eq!(detect_single_local("").language, "und");
    }

    #[tokio::test]
    async fn uncertain_text_can_use_shared_gemini_client() {
        let detected =
            detect_single_with_fallback("xyzzy", |_| async { Ok("es".to_owned()) }).await;
        assert_eq!(detected.language, "es");
        assert!(detected.is_reliable);
        let fallback =
            detect_single_with_fallback("xyzzy", |_| async { Ok("invalid".to_owned()) }).await;
        assert_eq!(fallback.language, "en");
        assert!(!fallback.is_reliable);
    }
}
